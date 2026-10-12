// Alertas de pesquisas salvas: gera notificação no sistema para novas licitações compatíveis.
// E-mail: enviado somente quando SMTP_URL estiver configurado (ver docs). WhatsApp: depende de provedor autorizado.
import { montarFiltro } from './busca.js';

export function avaliarAlertasPesquisas(db) {
  const pesquisas = db.prepare('SELECT * FROM pesquisas_salvas WHERE alertar=1').all();
  let geradas = 0;
  for (const ps of pesquisas) {
    const filtros = JSON.parse(ps.filtros_json || '{}');
    const desde = ps.ultimo_alerta_em || ps.criado_em;
    const { where, params } = montarFiltro({ ...filtros, criado_apos: desde });
    const novos = db.prepare(`SELECT l.id, l.objeto, l.orgao_nome, l.uf FROM licitacoes l ${where} ORDER BY l.id DESC LIMIT 50`).all(...params);
    const ins = db.prepare(`INSERT INTO notificacoes (empresa_id, usuario_id, cliente_id, tipo, titulo, mensagem, licitacao_id) VALUES (?,?,?,?,?,?,?)`);
    for (const n of novos) {
      ins.run(ps.empresa_id, ps.usuario_id, ps.cliente_id || 0, 'pesquisa_salva', `Nova oportunidade: ${ps.nome}`,
        `${(n.objeto || '').slice(0, 200)} — ${n.orgao_nome || ''} ${n.uf ? '(' + n.uf + ')' : ''}`, n.id);
      geradas++;
    }
    db.prepare("UPDATE pesquisas_salvas SET ultimo_alerta_em=datetime('now') WHERE id=?").run(ps.id);
  }
  return geradas;
}

// ---------- Fase 3: alertas das licitações acompanhadas (favoritas e Kanban) ----------
// Quem recebe: favorita → o próprio usuário; Kanban → o responsável, ou todos os usuários ativos
// da empresa quando não há responsável. Cada aviso é gerado uma única vez (tabela alertas_gerados).
const TIPOS_EVENTO_ALERTA = { alteracao: 'Edital alterado', situacao: 'Mudança de situação', resultado: 'Resultado publicado', documento: 'Novo documento' };

/**
 * Gera notificações de prazo (3 dias e 1 dia antes do fim das propostas, prazo interno no dia anterior)
 * e de mudanças detectadas na sincronização. `agora` em horário de Brasília (AAAA-MM-DDTHH:MM:SS).
 */
export function avaliarAlertasAcompanhadas(db, agora) {
  const lic = db.prepare('SELECT id, objeto, orgao_nome, uf, data_encerramento_proposta, status_calculado FROM licitacoes WHERE id = ?');
  const jaGerado = db.prepare('SELECT 1 FROM alertas_gerados WHERE usuario_id = ? AND chave = ?');
  const marcar = db.prepare('INSERT OR IGNORE INTO alertas_gerados (usuario_id, chave) VALUES (?, ?)');
  const notificar = db.prepare('INSERT INTO notificacoes (empresa_id, usuario_id, cliente_id, tipo, titulo, mensagem, licitacao_id) VALUES (?,?,?,?,?,?,?)');
  const eventos = db.prepare(`SELECT id, tipo, descricao FROM licitacao_eventos WHERE licitacao_id = ? AND tipo IN ('alteracao','situacao','resultado','documento')
    AND detectado_em > ? AND detectado_em > datetime('now','-7 days') ORDER BY id`);
  const base = Date.parse(`${agora}Z`);
  const hoje = agora.slice(0, 10);
  const amanha = new Date(base + 86400000).toISOString().slice(0, 10);
  let geradas = 0;
  const emitir = (a, chaveBase, tipo, titulo, mensagem) => {
    // Mesma licitação acompanhada para duas empresas assessoradas: um aviso para cada uma
    const chave = a.cliente_id ? `${chaveBase}:c${a.cliente_id}` : chaveBase;
    if (jaGerado.get(a.usuario_id, chave)) return;
    marcar.run(a.usuario_id, chave);
    notificar.run(a.empresa_id, a.usuario_id, a.cliente_id || 0, tipo, titulo, mensagem, a.licitacao_id);
    geradas++;
  };
  for (const a of acompanhamentosAtivos(db)) {
    const l = lic.get(a.licitacao_id);
    if (!l) continue;
    const resumo = `${(l.objeto || '').slice(0, 160)} — ${l.orgao_nome || ''}${l.uf ? ` (${l.uf})` : ''}`;
    const fim = l.data_encerramento_proposta;
    if (fim && ['aguardando_propostas', 'aberta'].includes(l.status_calculado)) {
      const horas = (Date.parse(`${fim.slice(0, 19)}Z`) - base) / 3600000;
      const quando = `${fim.slice(8, 10)}/${fim.slice(5, 7)} às ${fim.slice(11, 16)}`;
      if (horas > 0 && horas <= 24) emitir(a, `prazo1:${l.id}:${fim}`, 'prazo', `Propostas encerram em menos de 24h (${quando})`, resumo);
      else if (horas > 24 && horas <= 72) emitir(a, `prazo3:${l.id}:${fim}`, 'prazo', `Propostas encerram em até 3 dias (${quando})`, resumo);
    }
    if (a.prazo_interno && (a.prazo_interno.slice(0, 10) === hoje || a.prazo_interno.slice(0, 10) === amanha)) {
      const dia = a.prazo_interno.slice(0, 10) === hoje ? 'hoje' : 'amanhã';
      emitir(a, `interno:${a.oportunidade_id}:${a.prazo_interno.slice(0, 10)}`, 'prazo_interno', `Prazo interno vence ${dia}`, resumo);
    }
    for (const e of eventos.all(l.id, a.desde)) {
      emitir(a, `evento:${e.id}`, 'mudanca', `${TIPOS_EVENTO_ALERTA[e.tipo]}: ${(l.objeto || '').slice(0, 60)}`, e.descricao);
    }
  }
  return geradas;
}

// Alertas de prazo e de mudança valem enquanto a licitação continua acompanhada PELA MESMA EMPRESA:
// card no Kanban dessa empresa (fora de "perdida"/"descartada") ou favorito com essa empresa.
// Saiu do Kanban, trocou de empresa ou foi descartada → o alerta antigo deixa de aparecer.
const TIPOS_DE_ACOMPANHAMENTO = new Set(['prazo', 'prazo_interno', 'mudanca']);
const FASES_ENCERRADAS = new Set(['perdida', 'descartada']);

/** Notificações do usuário (opcionalmente de uma empresa), com a origem: etapa do Kanban ou favorito. */
export function listarNotificacoes(db, usuarioId, clienteId = null, { limite = 100 } = {}) {
  const linhas = db.prepare(`SELECT n.*, COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome,
      (SELECT ke.nome FROM oportunidades o JOIN kanban_etapas ke ON ke.id = o.etapa_id
        WHERE o.empresa_id = n.empresa_id AND o.licitacao_id = n.licitacao_id AND o.cliente_id = n.cliente_id) kanban_etapa,
      (SELECT ke.fase FROM oportunidades o JOIN kanban_etapas ke ON ke.id = o.etapa_id
        WHERE o.empresa_id = n.empresa_id AND o.licitacao_id = n.licitacao_id AND o.cliente_id = n.cliente_id) kanban_fase,
      EXISTS (SELECT 1 FROM favoritos f WHERE f.usuario_id = n.usuario_id AND f.tipo = 'licitacao'
        AND f.referencia = CAST(n.licitacao_id AS TEXT) AND f.cliente_id = n.cliente_id) favorito
    FROM notificacoes n LEFT JOIN clientes cl ON cl.id = n.cliente_id
    WHERE n.usuario_id = ?${clienteId ? ' AND n.cliente_id = ?' : ''} ORDER BY n.id DESC LIMIT ?`).all(usuarioId, ...(clienteId ? [clienteId] : []), limite * 3);
  return linhas.filter((n) => !TIPOS_DE_ACOMPANHAMENTO.has(n.tipo) || !n.licitacao_id
    || n.favorito || (n.kanban_etapa != null && !FASES_ENCERRADAS.has(n.kanban_fase))).slice(0, limite)
    .map((n) => ({ ...n, favorito: !!n.favorito }));
}

function acompanhamentosAtivos(db) {
  return db.prepare(`
    SELECT usuario_id, empresa_id, cliente_id, licitacao_id, MIN(desde) desde, MAX(oportunidade_id) oportunidade_id, MAX(prazo_interno) prazo_interno FROM (
      SELECT f.usuario_id, u.empresa_id, f.cliente_id, CAST(f.referencia AS INTEGER) licitacao_id, f.criado_em desde, NULL oportunidade_id, NULL prazo_interno
        FROM favoritos f JOIN usuarios u ON u.id = f.usuario_id AND u.ativo = 1 WHERE f.tipo = 'licitacao'
      UNION ALL
      SELECT u.id, o.empresa_id, o.cliente_id, o.licitacao_id, o.criado_em, o.id, o.prazo_interno
        FROM oportunidades o JOIN usuarios u ON u.empresa_id = o.empresa_id AND u.ativo = 1
        LEFT JOIN kanban_etapas ke ON ke.id = o.etapa_id
        WHERE (o.responsavel_id IS NULL OR o.responsavel_id = u.id) AND COALESCE(ke.fase, '') NOT IN ('perdida', 'descartada')
    ) GROUP BY usuario_id, cliente_id, licitacao_id`).all();
}
