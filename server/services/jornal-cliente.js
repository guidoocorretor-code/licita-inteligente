// Jornal para o cliente (empresário assessorado): licitações escolhidas no Jornal, impressas, em PDF clicável
// ou por e-mail ao representante legal, com um link sem login em que ele marca as que tem interesse.
// Cada envio fica registrado (jornal_envios). O banco guarda só um identificador aleatório; o link leva esse
// identificador assinado com JWT_SECRET (o mesmo esquema do link de cotação).
// Só dados públicos das licitações (PNCP). Nada de cotações, custos ou concorrentes.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { SISTEMAS } from './sistemas.js';
import { criarPdf } from '../lib/pdf-simples.js';
import { enviarEmail } from './email.js';
import { ETAPAS_PADRAO } from './execucao.js';
import { SQL_CAPAG_LIC } from './capag.js';
import { itensDoPerfil } from './jornal-perfis.js';

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const assinar = (nonce) => crypto.createHmac('sha256', config.jwtSecret).update(`jornal-link:${nonce}`).digest('base64url').slice(0, 32);
const tokenDe = (nonce) => `${nonce}.${assinar(nonce)}`;
const DIAS_VALIDADE = 60;
export const MAX_ITENS_ENVIO = 60;

// Até 4 casas: o órgão publica valor unitário com 4 casas (ex.: R$ 139,0815) e o lance aceita 0,0001; arredondar a 2 mostra valor errado
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const cnpjFmt = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
/** Data do PNCP (horário de Brasília, sem fuso) em dd/mm/aaaa hh:mm. */
export const dataBr = (iso) => {
  if (!iso) return null;
  const [d, t] = String(iso).replace(' ', 'T').split('T'); const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a}${t && t.slice(0, 5) !== '00:00' ? ` ${t.slice(0, 5)}` : ''}`;
};

export function migrarJornalEnvios(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS jornal_envios (
    id INTEGER PRIMARY KEY,
    nonce TEXT NOT NULL UNIQUE,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id INTEGER,                       -- empresa assessorada (NULL = sem empresa escolhida)
    licitacoes TEXT NOT NULL,                 -- JSON [ids] na ordem escolhida
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    expira_em TEXT NOT NULL,
    email_para TEXT,
    email_status TEXT,                        -- NULL (não enviado por e-mail) | enviado | erro | sem_smtp
    email_em TEXT,
    email_erro TEXT,
    ultimo_acesso TEXT,
    respondido_em TEXT,
    respondente TEXT,
    interesses TEXT,                          -- JSON [ids] marcados pelo cliente
    observacao TEXT,
    revogado INTEGER NOT NULL DEFAULT 0
  )`);
  conn.exec('CREATE INDEX IF NOT EXISTS ix_jornal_envios_emp ON jornal_envios(empresa_id, criado_em)');
  // Jornal salvo de onde saiu a seleção: o PDF lista os itens que batem com os produtos/itens dele
  const cols = conn.prepare('PRAGMA table_info(jornal_envios)').all().map((c) => c.name);
  if (!cols.includes('perfil_id')) conn.exec('ALTER TABLE jornal_envios ADD COLUMN perfil_id INTEGER');
  // E-mail de contato da assessoria (rodapé do jornal); vazio = e-mail de quem montou o jornal
  const colsEmp = conn.prepare('PRAGMA table_info(empresas)').all().map((c) => c.name);
  if (!colsEmp.includes('email_contato')) conn.exec('ALTER TABLE empresas ADD COLUMN email_contato TEXT');
}

/** Participação no sistema da disputa: gratuita / paga / não verificada (só marcamos com fonte, ver sistemas.js). */
export function sistemaDaLicitacao(l) {
  const chave = l.sistema_eletronico && SISTEMAS[l.sistema_eletronico] ? l.sistema_eletronico : null;
  const s = chave && chave !== 'outro' ? SISTEMAS[chave] : null;
  const custo = s?.custo || 'nao_verificado';
  return {
    nome: s?.nome || (l.plataforma_origem ? `Confira no edital (publicado por ${l.plataforma_origem})` : 'Confira no edital'),
    custo,
    participacao: custo === 'gratuito' ? 'Gratuita' : custo === 'pago' ? 'Paga (taxa do sistema)' : 'Não verificada: confira no edital',
    resumo: s?.resumo || SISTEMAS.outro.resumo,
    fonte: s?.fonte || null,
  };
}

/** "90012/2026": o PNCP às vezes já manda o ano dentro do número. */
export const numeroCompra = (l) => (!l.numero_compra ? null : /\/\d{4}$/.test(l.numero_compra) || !l.ano ? l.numero_compra : `${l.numero_compra}/${l.ano}`);

const valorTexto = (l) => (l.valor_estimado_situacao === 'sigiloso' ? 'Sigiloso'
  : l.valor_estimado != null && l.valor_estimado_situacao !== 'nao_informado' ? BRL.format(l.valor_estimado) : 'Não informado');

/** Quanto falta para o fim das propostas (data do PNCP em horário de Brasília). null = data não informada. */
export function faltam(iso, agora = new Date()) {
  if (!iso) return null;
  const s = String(iso).replace(' ', 'T');
  const fim = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.length <= 10 ? `${s}T23:59:59` : s}-03:00`);
  if (Number.isNaN(fim.getTime())) return null;
  const ms = fim - agora;
  if (ms <= 0) return { dias: 0, horas: 0, texto: 'Prazo encerrado', urgencia: 'encerrada' };
  const dias = Math.floor(ms / 86400000); const horas = Math.floor(ms / 3600000);
  const texto = dias >= 2 ? `Faltam ${dias} dias` : dias === 1 ? 'Falta 1 dia' : horas >= 1 ? `Faltam ${horas} h` : 'Encerra em menos de 1 h';
  return { dias, horas, texto, urgencia: dias < 3 ? 'alta' : dias < 7 ? 'media' : 'baixa' };
}

/** Prazo mais curto primeiro; sem data e já encerradas no fim. */
export const ordenarPorPrazo = (itens) => [...itens].sort((a, b) => {
  const peso = (l) => (!l.faltam ? 2 : l.faltam.urgencia === 'encerrada' ? 3 : 1);
  return peso(a) - peso(b) || String(a.data_encerramento_proposta || '').localeCompare(String(b.data_encerramento_proposta || ''));
});

const semAc = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const cidadesDoPerfil = (db, perfilId) => {
  const p = perfilId ? db.prepare('SELECT filtros FROM jornal_perfis WHERE id=?').get(perfilId) : null;
  return p ? JSON.parse(p.filtros).cidades || [] : [];
};
/**
 * Agrupa por cidade: primeiro as cidades na ordem em que estão no jornal salvo (ex.: Vila Velha, Vitória, Cariacica…),
 * depois as demais em ordem alfabética (UF e cidade). Dentro da cidade mantém a ordem recebida (prazo mais curto antes).
 */
export function ordenarPorCidade(itens, cidades = []) {
  const pos = new Map(cidades.map((c, i) => [semAc(c), i]));
  const chave = (l) => { const c = semAc(l.municipio); return pos.has(c) ? [0, pos.get(c), ''] : [1, 0, `${l.uf || ''} ${c}`]; };
  return itens.map((l, i) => ({ l, i, k: chave(l) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2].localeCompare(b.k[2], 'pt-BR') || a.i - b.i).map((x) => x.l);
}

/** Dados de cada licitação para o card do jornal, na ordem dos ids. */
export function cartoes(db, ids) {
  if (!ids.length) return [];
  const linhas = db.prepare(`SELECT l.id, l.objeto, l.orgao_nome, l.unidade_nome, l.municipio, l.uf, l.modalidade_nome, l.numero_compra, l.ano, l.valor_estimado, l.valor_estimado_situacao,
      l.data_abertura_proposta, l.data_encerramento_proposta, l.sistema_eletronico, l.plataforma_origem, l.link_origem, l.link_pncp, l.status_calculado,
      l.me_epp_exclusivo, l.srp, l.criterio_julgamento, l.modo_disputa_nome, l.informacao_complementar, l.esfera, l.detalhes_sincronizados_em,
      ${SQL_CAPAG_LIC} AS capag
    FROM licitacoes l WHERE l.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return ids.map((id) => porId.get(id)).filter(Boolean).map((l) => ({
    ...l, numero_texto: numeroCompra(l), valor_texto: valorTexto(l), prazo_texto: dataBr(l.data_encerramento_proposta) || 'Não informado', sistema: sistemaDaLicitacao(l),
    faltam: faltam(l.data_encerramento_proposta),
  }));
}

const idsValidos = (db, ids) => {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!lista.length) throw erro(400, 'Marque pelo menos uma licitação.');
  if (lista.length > MAX_ITENS_ENVIO) throw erro(400, `Escolha no máximo ${MAX_ITENS_ENVIO} licitações por jornal.`);
  const existe = new Set(db.prepare(`SELECT id FROM licitacoes WHERE id IN (${lista.map(() => '?').join(',')})`).all(...lista).map((r) => r.id));
  return lista.filter((n) => existe.has(n));
};

/** Registra o jornal e devolve o link (token) que o cliente usa para ver os resumos e marcar o interesse. */
export function criarEnvio(db, { empresaId, clienteId = null, usuarioId, ids, perfilId = null }) {
  const lista = idsValidos(db, ids);
  if (!lista.length) throw erro(400, 'Licitações não encontradas.');
  if (clienteId && !db.prepare('SELECT 1 FROM clientes WHERE id=? AND empresa_id=?').get(clienteId, empresaId)) throw erro(404, 'Empresa não encontrada.');
  // Jornal salvo de outra empresa (ou inexistente) é ignorado: o PDF sai com os primeiros itens do edital
  const perfil = Number(perfilId) > 0 && db.prepare('SELECT id FROM jornal_perfis WHERE id=? AND empresa_id=?').get(Number(perfilId), empresaId) ? Number(perfilId) : null;
  // Mesma seleção, mesma empresa e mesmo usuário nas últimas 24h: reaproveita o jornal (imprimir, PDF e e-mail usam o mesmo link)
  const igual = db.prepare(`SELECT id, nonce, expira_em FROM jornal_envios WHERE empresa_id=? AND cliente_id IS ? AND criado_por IS ? AND licitacoes=? AND revogado=0
    AND criado_em > datetime('now','-1 day') ORDER BY id DESC LIMIT 1`).get(empresaId, clienteId || null, usuarioId ?? null, JSON.stringify(lista));
  if (igual) {
    if (perfil) db.prepare('UPDATE jornal_envios SET perfil_id=? WHERE id=?').run(perfil, igual.id);
    return { id: igual.id, token: tokenDe(igual.nonce), expira_em: igual.expira_em };
  }
  const nonce = crypto.randomBytes(16).toString('base64url');
  const expira = new Date(Date.now() + DIAS_VALIDADE * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const id = Number(db.prepare('INSERT INTO jornal_envios (nonce, empresa_id, cliente_id, licitacoes, criado_por, expira_em, perfil_id) VALUES (?,?,?,?,?,?,?)')
    .run(nonce, empresaId, clienteId || null, JSON.stringify(lista), usuarioId, expira, perfil).lastInsertRowid);
  return { id, token: tokenDe(nonce), expira_em: expira };
}

/** Tudo o que o jornal impresso / PDF / e-mail mostra. */
export function dadosEnvio(db, envioId) {
  const e = db.prepare('SELECT * FROM jornal_envios WHERE id=?').get(envioId);
  if (!e) return null;
  const emp = db.prepare('SELECT nome, cnpj, email_contato FROM empresas WHERE id=?').get(e.empresa_id);
  const u = e.criado_por ? db.prepare('SELECT nome, email FROM usuarios WHERE id=?').get(e.criado_por) : null;
  const cli = e.cliente_id ? db.prepare(`SELECT razao_social, nome_fantasia, cnpj, municipio, uf, endereco, cep, email, telefone, resp_nome, resp_cargo, resp_email
    FROM clientes WHERE id=?`).get(e.cliente_id) : null;
  return {
    envio: e, token: tokenDe(e.nonce),
    assessoria: { nome: emp?.nome || null, cnpj: emp?.cnpj || null, responsavel: u?.nome || null, email: emp?.email_contato || u?.email || null },
    cliente: cli, itens: comItens(db, ordenarPorCidade(ordenarPorPrazo(cartoes(db, JSON.parse(e.licitacoes))), cidadesDoPerfil(db, e.perfil_id)), e.perfil_id),
  };
}

const MAX_ITENS_CARD = 5;
export const MAX_PDF_BUSCA = 200;

/** Dados do PDF do resultado da busca: os mesmos cartões do jornal; itens = os que têm as palavras buscadas. */
export function dadosBusca(db, lics, { empresaId, usuarioId, itensEncontrados = new Map(), agora = new Date() } = {}) {
  const emp = empresaId ? db.prepare('SELECT nome, cnpj, email_contato FROM empresas WHERE id=?').get(empresaId) : null;
  const u = usuarioId ? db.prepare('SELECT nome, email FROM usuarios WHERE id=?').get(usuarioId) : null;
  const cols = 'numero_item, descricao, quantidade, unidade_medida, valor_unitario_estimado, valor_total_estimado';
  const escolhidos = db.prepare(`SELECT ${cols} FROM licitacao_itens WHERE licitacao_id=? AND numero_item IN (SELECT value FROM json_each(?)) ORDER BY numero_item`);
  const total = db.prepare('SELECT COUNT(*) n FROM licitacao_itens WHERE licitacao_id=?');
  const base = comItens(db, ordenarPorCidade(ordenarPorPrazo(cartoes(db, lics.map((l) => l.id))), []));
  const itens = base.map((l) => {
    const e = itensEncontrados.get(l.id);
    if (!e || !e.itens.length) return l;
    return { ...l, itens_card: { tipo: 'filtro', itens: escolhidos.all(l.id, JSON.stringify(e.itens.map((i) => i.numero_item))), total: e.total, no_edital: total.get(l.id).n } };
  });
  return {
    envio: { criado_em: agora.toISOString() }, token: null, cliente: null, itens,
    assessoria: { nome: emp?.nome || null, cnpj: emp?.cnpj || null, responsavel: u?.nome || null, email: emp?.email_contato || u?.email || null },
  };
}
/**
 * Itens de cada licitação para o card: os que batem com os produtos/itens do jornal salvo (quando a seleção veio
 * de um); sem isso, os primeiros do edital. Só texto da fonte; sem itens baixados, diz isso.
 */
export function comItens(db, lics, perfilId = null) {
  const p = perfilId ? db.prepare('SELECT filtros FROM jornal_perfis WHERE id=?').get(perfilId) : null;
  const batem = p && lics.length ? itensDoPerfil(db, JSON.parse(p.filtros), lics.map((l) => l.id), { limite: MAX_ITENS_CARD }) : new Map();
  const cols = 'numero_item, descricao, quantidade, unidade_medida, valor_unitario_estimado, valor_total_estimado';
  const primeiros = db.prepare(`SELECT ${cols} FROM licitacao_itens WHERE licitacao_id=? ORDER BY numero_item LIMIT ?`);
  const escolhidos = db.prepare(`SELECT ${cols} FROM licitacao_itens WHERE licitacao_id=? AND numero_item IN (SELECT value FROM json_each(?)) ORDER BY numero_item`);
  const total = db.prepare('SELECT COUNT(*) n FROM licitacao_itens WHERE licitacao_id=?');
  return lics.map((l) => {
    const n = total.get(l.id).n; const b = batem.get(l.id);
    if (b) return { ...l, itens_card: { tipo: 'filtro', itens: escolhidos.all(l.id, JSON.stringify(b.itens.map((i) => i.numero_item))), total: b.total, no_edital: n } };
    if (!n) return { ...l, itens_card: { tipo: l.detalhes_sincronizados_em ? 'sem_itens' : 'nao_baixados', itens: [], total: 0, no_edital: 0 } };
    return { ...l, itens_card: { tipo: 'primeiros', itens: primeiros.all(l.id, MAX_ITENS_CARD), total: n, no_edital: n } };
  });
}

// Confere a assinatura em tempo constante e devolve o envio válido
function envioDoToken(db, token) {
  const [nonce, sig] = String(token || '').split('.');
  if (!nonce || !sig || !/^[A-Za-z0-9_-]{16,40}$/.test(nonce) || !/^[A-Za-z0-9_-]{32}$/.test(sig)) throw erro(404, 'Link inválido.');
  const certo = Buffer.from(assinar(nonce)); const veio = Buffer.from(sig);
  if (certo.length !== veio.length || !crypto.timingSafeEqual(certo, veio)) throw erro(404, 'Link inválido.');
  const e = db.prepare('SELECT * FROM jornal_envios WHERE nonce=?').get(nonce);
  if (!e || e.revogado) throw erro(404, 'Este link não está mais ativo. Fale com a sua assessoria.');
  if (e.expira_em < new Date().toISOString().slice(0, 19).replace('T', ' ')) throw erro(410, 'Este jornal expirou. Peça um novo à sua assessoria.');
  return e;
}

/** O que o empresário vê pelo link: resumo de cada licitação, itens e o link do PNCP para baixar o edital. */
export function jornalPublico(db, token) {
  const e = envioDoToken(db, token);
  db.prepare("UPDATE jornal_envios SET ultimo_acesso=datetime('now') WHERE id=?").run(e.id);
  const d = dadosEnvio(db, e.id);
  const itensDe = db.prepare('SELECT numero_item, descricao, quantidade, unidade_medida FROM licitacao_itens WHERE licitacao_id=? ORDER BY numero_item LIMIT 15');
  const totalItens = db.prepare('SELECT COUNT(*) n FROM licitacao_itens WHERE licitacao_id=?');
  return {
    assessoria: { nome: d.assessoria.nome, responsavel: d.assessoria.responsavel, email: d.assessoria.email },
    cliente: d.cliente ? (d.cliente.nome_fantasia || d.cliente.razao_social) : null,
    criado_em: e.criado_em, respondido_em: e.respondido_em, respondente: e.respondente, observacao: e.observacao,
    interesses: e.interesses ? JSON.parse(e.interesses) : [],
    licitacoes: d.itens.map((l) => ({
      id: l.id, objeto: l.objeto, orgao: l.orgao_nome, unidade: l.unidade_nome, local: [l.municipio, l.uf].filter(Boolean).join('/'),
      modalidade: l.modalidade_nome, numero: numeroCompra(l),
      valor: l.valor_texto, abertura: dataBr(l.data_abertura_proposta), prazo: l.prazo_texto, faltam: l.faltam, sistema: l.sistema,
      me_epp: l.me_epp_exclusivo == null ? null : !!l.me_epp_exclusivo, srp: l.srp == null ? null : !!l.srp,
      criterio: l.criterio_julgamento, modo: l.modo_disputa_nome, link_pncp: l.link_pncp,
      itens: itensDe.all(l.id), total_itens: totalItens.get(l.id).n,
    })),
  };
}

/** O empresário marca as licitações de interesse; avisamos quem montou o jornal (sino e e-mail de alertas). */
export function responderJornal(db, token, b = {}) {
  const e = envioDoToken(db, token);
  const permitidos = new Set(JSON.parse(e.licitacoes));
  const marcadas = [...new Set((Array.isArray(b.interesses) ? b.interesses : []).map(Number))].filter((n) => permitidos.has(n));
  const respondente = String(b.respondente || '').trim().slice(0, 120);
  if (!respondente) throw erro(400, 'Informe o seu nome.');
  const obs = String(b.observacao || '').trim().slice(0, 2000) || null;
  db.prepare("UPDATE jornal_envios SET respondido_em=datetime('now'), respondente=?, interesses=?, observacao=? WHERE id=?")
    .run(respondente, JSON.stringify(marcadas), obs, e.id);
  const cli = e.cliente_id ? db.prepare('SELECT COALESCE(nome_fantasia, razao_social) n FROM clientes WHERE id=?').get(e.cliente_id)?.n : null;
  const quem = cli ? `${respondente} (${cli})` : respondente;
  const lics = resumoLicitacoes(db, marcadas);
  const notificacoes = [];
  if (e.criado_por) {
    // Um alerta por licitação marcada, já dizendo qual é (objeto e local), para não precisar abrir o jornal
    const ins = db.prepare("INSERT INTO notificacoes (empresa_id, usuario_id, cliente_id, tipo, titulo, mensagem, licitacao_id) VALUES (?,?,?,'jornal','Interesse do cliente',?,?)");
    if (marcadas.length) {
      for (const l of lics) {
        const msg = `${quem} tem interesse em: ${(l.objeto || 'licitação sem objeto informado').slice(0, 200)}${l.local ? ` · ${l.local}` : ''}${obs ? ` · Obs.: ${obs}` : ''}`;
        notificacoes.push(Number(ins.run(e.empresa_id, e.criado_por, e.cliente_id || 0, msg, l.id).lastInsertRowid));
      }
    } else notificacoes.push(Number(ins.run(e.empresa_id, e.criado_por, e.cliente_id || 0, `${quem} respondeu o jornal sem marcar licitações.${obs ? ` Obs.: ${obs}` : ''}`, null).lastInsertRowid));
    // As marcadas entram no Kanban da empresa, na primeira etapa (o que já está na esteira, inclusive descartado, não se mexe)
    if (marcadas.length) entrarNoKanban(db, e, marcadas, respondente);
  }
  return { interesses: marcadas.length, envio_id: e.id, notificacoes };
}

function entrarNoKanban(db, e, ids, respondente) {
  if (!db.prepare('SELECT 1 FROM kanban_etapas WHERE empresa_id=?').get(e.empresa_id)) {
    const ins = db.prepare('INSERT INTO kanban_etapas (empresa_id, nome, ordem, fase) VALUES (?,?,?,?)');
    ETAPAS_PADRAO.forEach(([nome, fase], i) => ins.run(e.empresa_id, nome, i, fase));
  }
  const primeira = db.prepare('SELECT id FROM kanban_etapas WHERE empresa_id=? ORDER BY ordem LIMIT 1').get(e.empresa_id);
  const existe = db.prepare('SELECT 1 FROM oportunidades WHERE empresa_id=? AND licitacao_id=? AND cliente_id=?');
  const ins = db.prepare('INSERT INTO oportunidades (empresa_id, cliente_id, licitacao_id, etapa_id, responsavel_id) VALUES (?,?,?,?,?)');
  const hist = db.prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'criacao',?)");
  for (const id of ids) {
    if (existe.get(e.empresa_id, id, e.cliente_id || 0)) continue;
    const op = Number(ins.run(e.empresa_id, e.cliente_id || 0, id, primeira.id, e.criado_por).lastInsertRowid);
    hist.run(op, e.criado_por, `Interesse marcado por ${respondente} no jornal de licitações`);
  }
}

/** Objeto, órgão e local das licitações (na ordem dos ids), para mostrar o que o cliente marcou. */
export function resumoLicitacoes(db, ids) {
  if (!ids?.length) return [];
  const linhas = db.prepare(`SELECT id, objeto, orgao_nome, municipio, uf, data_encerramento_proposta FROM licitacoes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return ids.map((id) => porId.get(id)).filter(Boolean)
    .map((l) => ({ id: l.id, objeto: l.objeto, orgao: l.orgao_nome, local: [l.municipio, l.uf].filter(Boolean).join('/'), prazo: l.data_encerramento_proposta }));
}

/** E-mail imediato para quem montou o jornal, dizendo quais licitações o cliente marcou (respeita "Receber alertas por e-mail"). */
export function montarEmailInteresse(d, { urlBase = '' } = {}) {
  const base = urlBase.replace(/\/$/, '');
  const quem = d.cliente ? `${d.respondente} (${d.cliente})` : d.respondente;
  const assunto = d.lics.length ? `Interesse do cliente: ${quem} marcou ${d.lics.length} licitação(ões)` : `${quem} respondeu o jornal sem marcar licitações`;
  const linha = (l) => `${(l.objeto || '').slice(0, 220)}${l.local ? ` · ${l.local}` : ''}${l.prazo ? ` · propostas até ${dataBr(l.prazo)}` : ''}`;
  const texto = [`${quem} respondeu o jornal de licitações.`, '',
    ...(d.lics.length ? d.lics.map((l, i) => `${i + 1}. ${linha(l)}${base ? `\n   ${base}/#/licitacao/${l.id}` : ''}`) : ['Nenhuma licitação marcada.']),
    d.observacao ? `\nObservação: ${d.observacao}` : '', '', 'As marcadas já estão no Kanban da empresa, na primeira etapa.'].join('\n');
  const html = `<p><strong>${esc(quem)}</strong> respondeu o jornal de licitações.</p>`
    + (d.lics.length ? `<ol>${d.lics.map((l) => `<li style="margin-bottom:10px">${esc(linha(l))}${base ? `<br><a href="${esc(`${base}/#/licitacao/${l.id}`)}">Abrir no sistema</a>` : ''}</li>`).join('')}</ol>` : '<p>Nenhuma licitação marcada.</p>')
    + (d.observacao ? `<p><strong>Observação:</strong> ${esc(d.observacao)}</p>` : '')
    + '<p style="color:#666;font-size:12px">As marcadas já estão no Kanban da empresa, na primeira etapa.</p>';
  return { assunto, texto, html };
}

export async function avisarInteresse(db, envioId, notificacoes = [], { urlBase = process.env.APP_URL || '' } = {}) {
  const e = db.prepare('SELECT * FROM jornal_envios WHERE id=?').get(envioId);
  if (!e?.criado_por) return { enviado: false };
  const u = db.prepare(`SELECT u.nome, COALESCE(NULLIF(p.email_alertas, ''), u.email) email, COALESCE(p.alertas_email, 1) quer FROM usuarios u
    LEFT JOIN usuario_preferencias p ON p.usuario_id = u.id WHERE u.id=? AND u.ativo=1`).get(e.criado_por);
  if (!u || !u.quer) return { enviado: false };
  const cliente = e.cliente_id ? db.prepare('SELECT COALESCE(nome_fantasia, razao_social) n FROM clientes WHERE id=?').get(e.cliente_id)?.n : null;
  const m = montarEmailInteresse({ respondente: e.respondente, cliente, observacao: e.observacao, lics: resumoLicitacoes(db, JSON.parse(e.interesses || '[]')) }, { urlBase });
  await enviarEmail({ para: u.email, assunto: m.assunto, texto: m.texto, html: m.html });
  // Já avisado agora: não repete no resumo de alertas
  const marcar = db.prepare('UPDATE notificacoes SET enviada_email = 1 WHERE id = ?');
  for (const id of notificacoes) marcar.run(id);
  return { enviado: true, para: u.email };
}

/** Nome e e-mail de contato da assessoria (aparecem no jornal do cliente: capa, rodapé e e-mail). */
export function dadosAssessoria(db, empresaId) {
  const e = db.prepare('SELECT nome, email_contato FROM empresas WHERE id=?').get(empresaId);
  return { nome: e?.nome || '', email_contato: e?.email_contato || '' };
}
export function salvarDadosAssessoria(db, empresaId, b = {}) {
  const nome = String(b.nome ?? '').trim().slice(0, 120);
  if (nome.length < 2) throw erro(400, 'Informe o nome da assessoria (aparece no jornal).');
  const email = String(b.email_contato ?? '').trim().slice(0, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro(400, 'E-mail de contato inválido.');
  db.prepare('UPDATE empresas SET nome=?, email_contato=? WHERE id=?').run(nome, email || null, empresaId);
  return dadosAssessoria(db, empresaId);
}

/** Envios recentes (para a tela mostrar quem respondeu). */
export function listarEnvios(db, empresaId, clienteId = null) {
  return db.prepare(`SELECT e.id, e.cliente_id, COALESCE(c.nome_fantasia, c.razao_social) cliente, e.criado_em, e.email_para, e.email_status, e.email_erro,
      e.ultimo_acesso, e.respondido_em, e.respondente, e.interesses, e.observacao, e.licitacoes, e.expira_em
    FROM jornal_envios e LEFT JOIN clientes c ON c.id = e.cliente_id
    WHERE e.empresa_id=? ${clienteId ? 'AND e.cliente_id=?' : ''} ORDER BY e.id DESC LIMIT 20`).all(empresaId, ...(clienteId ? [clienteId] : []))
    .map((r) => ({ ...r, licitacoes: JSON.parse(r.licitacoes).length, interesses: r.interesses ? resumoLicitacoes(db, JSON.parse(r.interesses)) : null }));
}

/** Apaga envios da empresa (o link do cliente deixa de funcionar). Interesses já recebidos continuam no Kanban. */
export function excluirEnvios(db, empresaId, ids) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  if (!lista.length) throw erro(400, 'Marque pelo menos um envio.');
  return Number(db.prepare(`DELETE FROM jornal_envios WHERE empresa_id=? AND id IN (${lista.map(() => '?').join(',')})`).run(empresaId, ...lista).changes);
}

// ---------------- PDF ----------------
const AZUL = [0.06, 0.24, 0.43]; const CINZA = [0.38, 0.4, 0.44];

/** PDF do jornal: cabeçalho com os dados da empresa; cada licitação leva link para o resumo e para o PNCP. */
// O mesmo PDF serve para o jornal e para o resultado de "Buscar licitações" (opções "busca": textos próprios,
// sem "Tenho interesse" porque não há página de resposta).
export function pdfJornal(d, { urlBase = '', busca = null } = {}) {
  const T = busca ? { selo: 'RESULTADO DA BUSCA', chamada: 'Licitações encontradas', edicao: 'Gerado em', kpi1: ['licitação encontrada', 'licitações encontradas'],
    itens: 'PALAVRAS BUSCADAS', nome: 'Busca de licitações' }
    : { selo: 'JORNAL DE LICITAÇÕES', chamada: 'Oportunidades para vender ao governo', edicao: 'Edição de', kpi1: ['oportunidade selecionada', 'oportunidades selecionadas'],
      itens: 'PALAVRAS DO JORNAL', nome: 'Jornal de licitações' };
  // Margem estreita (24 pt ≈ 8,5 mm): o empresário imprime gastando menos papel
  const pdf = criarPdf({ margem: 24 });
  const pagina = urlBase && d.token ? `${urlBase.replace(/\/$/, '')}/j/${d.token}` : null;
  const c = d.cliente; const a = d.assessoria;
  const nomeCli = c ? (c.nome_fantasia || c.razao_social) : null;
  const BRANCO = [1, 1, 1]; const AZUL2 = [0.12, 0.37, 0.64]; const CLARO = [0.93, 0.96, 0.98]; const LINHA = [0.84, 0.88, 0.92];
  const COR_URG = { alta: [0.71, 0.14, 0.09], media: [0.6, 0.36, 0], baixa: [0.07, 0.47, 0.36], encerrada: [0.6, 0.64, 0.7], sem: [0.6, 0.64, 0.7] };
  const ROT_URG = { alta: 'Urgente', media: 'Esta semana', baixa: 'No prazo', encerrada: 'Encerrada' };
  const abertas = d.itens.filter((l) => !l.faltam || l.faltam.urgencia !== 'encerrada');
  const comValor = abertas.filter((l) => l.valor_estimado != null && !['sigiloso', 'nao_informado'].includes(l.valor_estimado_situacao));
  const soma = comValor.reduce((s, l) => s + Number(l.valor_estimado), 0);
  // Agrupado por cidade: a próxima a encerrar é a de menor prazo entre as abertas
  const proxima = d.itens.filter((l) => l.faltam && l.faltam.urgencia !== 'encerrada').sort((x, y) => String(x.data_encerramento_proposta).localeCompare(String(y.data_encerramento_proposta)))[0];
  const gratuitas = d.itens.filter((l) => l.sistema?.custo === 'gratuito').length;

  // Capa
  pdf.bloco(78, (t) => {
    t.ret(0 + t.x, 0, t.largura, 78, { cor: AZUL, raio: 8 });
    t.txt(T.selo, t.x + 16, 12, { tam: 8, negrito: true, cor: [0.75, 0.84, 0.95] });
    t.txt(T.chamada, t.x + 16, 25, { tam: 17, negrito: true, cor: BRANCO, maxW: t.largura - 150 });
    if (nomeCli) t.txt(`Selecionadas para ${nomeCli}`, t.x + 16, 52, { tam: 10.5, cor: BRANCO, maxW: t.largura - 150, max: 1 });
    t.txt(`${T.edicao} ${dataBr(d.envio.criado_em.slice(0, 10))}`, t.x + t.largura - 146, 52, { tam: 8.5, cor: [0.85, 0.9, 0.97], maxW: 130, alinhar: 'r' });
    if (a.nome) t.txt(a.nome, t.x + t.largura - 146, 63, { tam: 8.5, cor: [0.85, 0.9, 0.97], maxW: 130, alinhar: 'r', max: 1 });
  }, { depois: 4 });
  if (busca?.resumo) pdf.texto(busca.resumo, { tam: 8.5, cor: CINZA, depois: 6 });
  if (c) {
    pdf.texto([c.razao_social, c.cnpj ? `CNPJ ${cnpjFmt(c.cnpj)}` : null, [c.municipio, c.uf].filter(Boolean).join('/') || null,
      c.resp_nome ? `A/C ${c.resp_nome}${c.resp_cargo ? ` (${c.resp_cargo})` : ''}` : null].filter(Boolean).join(' · '), { tam: 8.5, cor: CINZA, depois: 6 });
  }
  // Números do jornal
  const kpis = [
    [String(d.itens.length), d.itens.length === 1 ? T.kpi1[0] : T.kpi1[1]],
    [comValor.length ? BRL.format(soma) : '-', `em valor estimado${abertas.length < d.itens.length ? ' das abertas' : ''}${comValor.length < abertas.length ? ` (${comValor.length} de ${abertas.length} informam)` : ''}`],
    [proxima ? proxima.faltam.texto.replace(/^Faltam? /, '') : '-', proxima ? `para a próxima encerrar (${proxima.prazo_texto})` : 'nenhuma com prazo em aberto'],
    [String(gratuitas), 'com participação gratuita'],
  ];
  pdf.bloco(46, (t) => {
    const g = 6; const w = (t.largura - 3 * g) / 4;
    kpis.forEach(([n, r], i) => {
      const x = t.x + i * (w + g);
      t.ret(x, 0, w, 46, { cor: CLARO, borda: LINHA, raio: 6 });
      // Valor longo (ex.: R$ 3.783.537,24) diminui a fonte até caber, em vez de virar "R$..."
      let tam = 13; while (tam > 7 && t.larguraDe(n, tam, true) > w - 14) tam -= 0.5;
      t.txt(n, x + 8, 7 + (13 - tam) / 2, { tam, negrito: true, cor: AZUL, maxW: w - 14, max: 1 });
      t.txt(r, x + 8, 25, { tam: 7.2, cor: CINZA, maxW: w - 14, max: 2, espaco: 1.2 });
    });
  }, { depois: 8 });
  // Como responder
  if (pagina) {
    pdf.bloco(40, (t) => {
      t.ret(t.x, 0, t.largura, 40, { borda: AZUL2, raio: 6, espessura: 0.8 });
      t.txt('1. Leia os cards: valor, prazo e se a participação é gratuita.', t.x + 10, 6, { tam: 8.5, maxW: t.largura - 140 });
      t.txt('2. Clique em "Tenho interesse" nas que combinam com a sua empresa.', t.x + 10, 17, { tam: 8.5, maxW: t.largura - 140 });
      t.txt('3. A assessoria cuida do resto: documentos, proposta e disputa.', t.x + 10, 28, { tam: 8.5, maxW: t.largura - 140 });
      const bw = 112; const bx = t.x + t.largura - bw - 10;
      t.ret(bx, 9, bw, 22, { cor: AZUL, raio: 5 });
      t.txt('Responder agora >', bx, 15, { tam: 9.5, negrito: true, cor: BRANCO, maxW: bw, alinhar: 'c' });
      t.link(bx, 9, bw, 22, pagina);
    }, { depois: 10 });
  }
  // Cards agrupados por cidade (na ordem do jornal salvo); dentro da cidade, prazo mais curto antes.
  // Fonte menor que a da tela para sobrar espaço aos itens; modalidade, sistema e CAPAG em três quadros.
  const PALAVRA_CAPAG = { A: 'boa', B: 'razoável', C: 'fraca', D: 'muito fraca' };
  const textoCapag = (l) => (l.esfera === 'F' ? 'Federal: CAPAG não se aplica' : l.capag ? `CAPAG ${l.capag} (${PALAVRA_CAPAG[l.capag[0]] || 'ver nota'})` : 'Sem nota CAPAG publicada');
  // Tabela de itens igual à do PNCP: Número, Descrição, Quantidade, Valor unitário estimado, Valor total estimado
  // A descrição fica com a sobra da largura da página
  const COLS_ITENS = [['Número', 34, ''], ['Descrição', pdf.largura - 36 - 34 - 62 - 76 - 84, ''], ['Quantidade', 62, 'r'], ['Valor unitário estimado', 76, 'r'], ['Valor total estimado', 84, 'r']];
  const celulas = (i) => [String(i.numero_item ?? ''), i.descricao || '(sem descrição)', i.quantidade != null ? QTD.format(i.quantidade) : 'Não informado',
    i.valor_unitario_estimado != null ? BRL.format(i.valor_unitario_estimado) : 'Não informado', i.valor_total_estimado != null ? BRL.format(i.valor_total_estimado) : 'Não informado'];
  const MAX_LINHAS_DESC = 2; // enxuto: detalhes no "Ver resumo do edital" ou no PNCP
  const altLinha = (i) => pdf.linhasDe(i.descricao || '(sem descrição)', 7, false, COLS_ITENS[1][1] - 6, MAX_LINHAS_DESC) * 8.6 + 6;
  const tituloItens = (c) => (c.tipo === 'filtro' ? `ITENS COM AS ${T.itens} (${c.total} de ${c.no_edital} no edital)`
    : c.tipo === 'primeiros' ? `ITENS DO EDITAL (${c.itens.length < c.total ? `primeiros ${c.itens.length} de ${c.total}` : c.total})`
      : c.tipo === 'sem_itens' ? 'O ÓRGÃO NÃO PUBLICOU ITENS NO PNCP: CONFIRA NO EDITAL' : 'ITENS AINDA NÃO BAIXADOS DO PNCP: CONFIRA NO EDITAL');
  let cidadeAtual = null;
  for (const l of d.itens) {
    const cidade = [l.municipio, l.uf].filter(Boolean).join('/') || 'Local não informado';
    const f = l.faltam; const urg = f?.urgencia || 'sem'; const cor = COR_URG[urg];
    const link = pagina ? `${pagina}#lic-${l.id}` : null;
    const L = pdf.largura; const wDir = 120; const wEsq = L - wDir - 34;
    const tags = [l.sistema.custo === 'gratuito' ? ['Participação gratuita', [0.07, 0.47, 0.36], [0.93, 0.97, 0.95]]
      : l.sistema.custo === 'pago' ? ['Sistema cobra taxa', [0.6, 0.36, 0], [0.99, 0.96, 0.92]] : ['Taxa do sistema: verificar', CINZA, [0.96, 0.97, 0.98]],
    l.me_epp_exclusivo ? ['Exclusiva ME/EPP', [0.36, 0.24, 0.66], [0.96, 0.94, 0.99]] : null].filter(Boolean);
    const c = l.itens_card || { tipo: 'nao_baixados', itens: [], total: 0, no_edital: 0 };
    const altObj = pdf.linhasDe(l.objeto || '(objeto não informado)', 8.5, true, wEsq, 3) * 10.5;
    const altItens = c.itens.length ? 18 + c.itens.reduce((s2, i) => s2 + altLinha(i), 0) : 0;
    const maisItens = c.tipo === 'filtro' && c.total > c.itens.length;
    const altCaixaItens = 6 + 9 + altItens + (maisItens ? 9 : 0) + 3;
    const topo = Math.max(20 + altObj + 12, 20 + 50);
    const alt = topo + 4 + 30 + 5 + altCaixaItens + 5 + 16 + 8;
    if (cidade !== cidadeAtual) {
      cidadeAtual = cidade;
      // Título da cidade nunca fica sozinho no pé da página: vai junto com o primeiro card
      if (pdf.restante() < 21 + alt) pdf.novaPagina();
      const qtd = d.itens.filter((x) => ([x.municipio, x.uf].filter(Boolean).join('/') || 'Local não informado') === cidade).length;
      pdf.bloco(16, (t) => {
        t.txt(cidade.toUpperCase(), t.x, 3, { tam: 9.5, negrito: true, cor: AZUL, maxW: t.largura - 120, max: 1 });
        t.txt(`${qtd} ${qtd === 1 ? 'oportunidade' : 'oportunidades'}`, t.x + t.largura - 120, 4, { tam: 7.5, cor: CINZA, maxW: 120, alinhar: 'r' });
        t.ret(t.x, 15, t.largura, 1, { cor: AZUL2 });
      }, { depois: 5 });
    }
    pdf.bloco(alt, (t) => {
      const x = t.x;
      t.ret(x, 0, t.largura, alt, { cor: BRANCO, borda: LINHA, raio: 6 });
      t.ret(x, 0, t.largura, 15, { cor: [0.965, 0.973, 0.984], raio: 0 });
      t.ret(x, 0, 4, alt, { cor });
      t.txt(`${l.modalidade_nome || 'Licitação'}${l.numero_texto ? ` nº ${l.numero_texto}` : ''}   ${cidade}`, x + 12, 3.8, { tam: 7.5, negrito: true, cor: AZUL, maxW: 300, max: 1 });
      t.txt(!f ? 'Prazo não informado' : urg === 'encerrada' ? 'Prazo encerrado' : `${f.texto} · ${ROT_URG[urg]}`, x + 300, 3.8, { tam: 7.5, negrito: true, cor, maxW: t.largura - 312, alinhar: 'r', max: 1 });
      t.txt(l.objeto || '(objeto não informado)', x + 12, 20, { tam: 8.5, negrito: true, maxW: wEsq, max: 3, url: link });
      t.txt(l.orgao_nome || 'Órgão não informado', x + 12, 20 + altObj + 1, { tam: 7, cor: CINZA, maxW: wEsq, max: 1 });
      const xd = x + t.largura - wDir - 10;
      t.txt('VALOR ESTIMADO', xd, 20, { tam: 6.5, cor: CINZA, maxW: wDir, alinhar: 'r' });
      let tv = 11.5; while (tv > 7 && t.larguraDe(l.valor_texto, tv, true) > wDir) tv -= 0.5;
      t.txt(l.valor_texto, xd, 29, { tam: tv, negrito: true, cor: AZUL, maxW: wDir, alinhar: 'r', max: 1 });
      t.txt('PROPOSTAS ATÉ', xd, 47, { tam: 6.5, cor: CINZA, maxW: wDir, alinhar: 'r' });
      t.txt(l.prazo_texto, xd, 55, { tam: 8.5, negrito: true, maxW: wDir, alinhar: 'r', max: 1 });
      // Modalidade · Sistema eletrônico · Pagômetro
      let dy = topo + 4;
      const g = 6; const wq = (t.largura - 24 - 2 * g) / 3;
      [['MODALIDADE', l.modalidade_nome || 'Não informada'], ['SISTEMA ELETRÔNICO', `${l.sistema.nome} · ${l.sistema.participacao}`], ['PAGÔMETRO', textoCapag(l)]]
        .forEach(([rot, val], k) => {
          const qx = x + 12 + k * (wq + g);
          t.ret(qx, dy, wq, 30, { cor: CLARO, borda: LINHA, raio: 4, espessura: 0.5 });
          t.txt(rot, qx + 6, dy + 3.5, { tam: 6, negrito: true, cor: CINZA, maxW: wq - 12, max: 1 });
          t.txt(val, qx + 6, dy + 11.5, { tam: 7, negrito: true, cor: AZUL, maxW: wq - 12, max: 2, espaco: 1.2 });
        });
      dy += 30 + 5;
      // Itens (os que batem com o jornal; sem filtro, os primeiros do edital)
      t.ret(x + 12, dy, t.largura - 24, altCaixaItens, { borda: LINHA, raio: 4, espessura: 0.5 });
      t.txt(tituloItens(c), x + 18, dy + 5, { tam: 6.5, negrito: true, cor: AZUL2, maxW: t.largura - 36, max: 1 });
      let iy = dy + 15;
      if (c.itens.length) {
        const x0 = x + 18; const wT = COLS_ITENS.reduce((s2, k) => s2 + k[1], 0);
        // Cabeçalho da tabela (como no PNCP) e linhas separadas por um fio
        let cx = x0;
        for (const [rot, w, al] of COLS_ITENS) { t.txt(rot, cx, iy + 1, { tam: 6.3, negrito: true, cor: CINZA, maxW: w - 6, alinhar: al, max: 2, espaco: 1.15 }); cx += w; }
        iy += 16; t.ret(x0, iy, wT, 0.6, { cor: LINHA });
        for (const i of c.itens) {
          const vals = celulas(i); cx = x0; iy += 3;
          COLS_ITENS.forEach(([, w, al], k) => {
            t.txt(vals[k], cx, iy, { tam: 7, maxW: w - 6, alinhar: al, max: k === 1 ? MAX_LINHAS_DESC : 1, espaco: 1.23, cor: k === 1 || k === 0 ? [0, 0, 0] : [0.15, 0.17, 0.2] });
            cx += w;
          });
          iy += altLinha(i) - 3; t.ret(x0, iy, wT, 0.4, { cor: LINHA });
        }
        iy += 3;
      }
      if (maisItens) t.txt(`e mais ${c.total - c.itens.length} item(ns) com as ${T.itens.toLowerCase()}: veja ${link ? 'no resumo do edital' : 'no edital'}.`, x + 18, iy, { tam: 6.5, cor: CINZA, maxW: t.largura - 36, max: 1 });
      dy += altCaixaItens + 5;
      const ya = dy;
      // Etiquetas (Participação gratuita, ME/EPP) no canto direito, na linha dos botões
      const larg = tags.map(([rot]) => t.larguraDe(rot, 6.8, true) + 10);
      let tx = x + t.largura - 12 - larg.reduce((s2, w) => s2 + w + 5, 0) + 5;
      tags.forEach(([rot, ct, fundo], k) => {
        const w = larg[k];
        t.ret(tx, ya + 2, w, 12, { cor: fundo, borda: ct, raio: 6, espessura: 0.5 });
        t.txt(rot, tx, ya + 4.8, { tam: 6.8, negrito: true, cor: ct, maxW: w, alinhar: 'c', max: 1 });
        tx += w + 5;
      });
      if (link) {
        t.ret(x + 12, ya, 96, 16, { cor: AZUL, raio: 8 });
        t.txt('Tenho interesse', x + 12, ya + 4, { tam: 8, negrito: true, cor: BRANCO, maxW: 96, alinhar: 'c' });
        t.link(x + 12, ya, 96, 16, link);
        t.txt('Ver resumo do edital', x + 118, ya + 4, { tam: 8, cor: AZUL2, url: link, maxW: 110 });
      }
      if (l.link_pncp) t.txt('Edital completo no PNCP', x + (link ? 222 : 12), ya + 4, { tam: 8, cor: AZUL2, url: l.link_pncp, maxW: 140 });
    }, { depois: 7 });
  }
  pdf.linha({ cor: AZUL, antes: 2, depois: 6 });
  pdf.texto([a.responsavel, a.nome].filter(Boolean).join(' · ') + (a.email ? ` · ${a.email}` : ''), { tam: 9, negrito: true, depois: 2 });
  pdf.texto('Dados públicos do PNCP, organizados por cidade e, dentro de cada cidade, do prazo mais curto para o mais longo. Confira sempre o edital: datas, valores e o sistema da disputa podem mudar por retificação. "Participação gratuita" quer dizer que o sistema eletrônico não cobra taxa do fornecedor.', { tam: 7.5, cor: CINZA });
  return pdf.gerar({ titulo: `${T.nome}${nomeCli ? ` - ${nomeCli}` : ''}`, rodape: `${T.nome}${nomeCli ? ` · ${nomeCli}` : ''}${a.nome ? ` · ${a.nome}` : ''}` });
}

// ---------------- E-mail ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function montarEmailJornal(d, { urlBase }) {
  const pagina = `${urlBase.replace(/\/$/, '')}/j/${d.token}`;
  const c = d.cliente; const a = d.assessoria;
  const saud = c?.resp_nome ? `Olá, ${c.resp_nome.split(' ')[0]}!` : 'Olá!';
  const assunto = `Licitações selecionadas para ${c ? (c.nome_fantasia || c.razao_social) : 'você'}: tem interesse em participar?`;
  const texto = [saud, '',
    `Separamos ${d.itens.length} licitação(ões) com o perfil da sua empresa. Tem interesse em participar de alguma dispensa ou pregão?`,
    `Abra o link, marque as que interessam e clique em "Enviar meu interesse": ${pagina}`, '',
    ...d.itens.flatMap((l, k) => [`${k + 1}. ${l.objeto || ''}`, `   ${l.orgao_nome || ''} · ${[l.municipio, l.uf].filter(Boolean).join('/')}`,
      `   Valor do edital: ${l.valor_texto} · Propostas até: ${l.prazo_texto}`, `   Sistema: ${l.sistema.nome} · Participação: ${l.sistema.participacao}`, '']),
    'O jornal em PDF segue em anexo.', '', `${[a.responsavel, a.nome].filter(Boolean).join(' · ')}`].join('\n');
  const html = `<p>${esc(saud)}</p><p>Separamos <strong>${d.itens.length} licitação(ões)</strong> com o perfil da sua empresa. <strong>Tem interesse em participar de alguma dispensa ou pregão?</strong></p>`
    + `<p><a href="${esc(pagina)}" style="display:inline-block;background:#0f3d6e;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Ver o jornal e marcar meu interesse</a></p>`
    + d.itens.map((l) => {
      const f = l.faltam; const corPrazo = !f ? '#5b6876' : { alta: '#b42318', media: '#9a5b00', baixa: '#13795b' }[f.urgencia] || '#5b6876';
      const prazo = !f ? 'Prazo não informado' : f.urgencia === 'encerrada' ? 'Prazo encerrado' : f.texto;
      const part = l.sistema.custo === 'gratuito' ? '<span style="color:#13795b;font-weight:bold">✓ Participação gratuita</span>' : l.sistema.custo === 'pago' ? 'Sistema cobra taxa' : 'Taxa do sistema: verificar';
      return `<div style="border:1px solid #d7e0ea;border-left:5px solid ${corPrazo};border-radius:8px;padding:10px 12px;margin:10px 0">`
        + `<div style="font-size:12px;color:#5b6876">${esc(l.modalidade_nome || 'Licitação')} · ${esc([l.municipio, l.uf].filter(Boolean).join('/'))} · <strong style="color:${corPrazo}">${esc(prazo)}</strong></div>`
        + `<div style="font-weight:bold;margin:4px 0"><a href="${esc(`${pagina}#lic-${l.id}`)}" style="color:#14212e;text-decoration:none">${esc(l.objeto || '')}</a></div>`
        + `<div style="color:#5b6876;font-size:13px">${esc(l.orgao_nome || '')}</div>`
        + `<div style="font-size:14px;margin-top:6px">Valor do edital: <strong style="color:#0f3d6e">${esc(l.valor_texto)}</strong> · Propostas até: <strong>${esc(l.prazo_texto)}</strong></div>`
        + `<div style="font-size:13px;margin-top:2px">${part} · ${esc(l.sistema.nome)}${l.me_epp_exclusivo ? ' · <strong style="color:#5b3ea8">Exclusiva ME/EPP</strong>' : ''}</div>`
        + `<div style="margin-top:8px"><a href="${esc(`${pagina}#lic-${l.id}`)}" style="display:inline-block;background:#0f3d6e;color:#fff;padding:6px 14px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:13px">Tenho interesse</a></div></div>`;
    }).join('')
    + `<p>O jornal em PDF segue em anexo.</p><p>${esc([a.responsavel, a.nome].filter(Boolean).join(' · '))}</p>`
    + '<p style="color:#777;font-size:12px">Dados públicos do PNCP. Confira sempre o edital: datas e valores podem mudar por retificação.</p>';
  return { assunto, texto, html };
}

/** Envia o jornal ao representante legal e grava o resultado no envio. */
export async function enviarJornal(db, envioId, { para, urlBase }) {
  const d = dadosEnvio(db, envioId);
  const marcar = (status, erroMsg = null) => db.prepare("UPDATE jornal_envios SET email_para=?, email_status=?, email_erro=?, email_em=CASE WHEN ?='enviado' THEN datetime('now') ELSE email_em END WHERE id=?")
    .run(para, status, erroMsg, status, envioId);
  const m = montarEmailJornal(d, { urlBase });
  try {
    await enviarEmail({ para, assunto: m.assunto, texto: m.texto, html: m.html, responderPara: d.assessoria.email, nomeRemetente: d.assessoria.nome || undefined,
      anexos: [{ filename: 'jornal-de-licitacoes.pdf', content: pdfJornal(d, { urlBase }), contentType: 'application/pdf' }] });
    marcar('enviado'); return 'enviado';
  } catch (e) {
    if (e.semSmtp) { marcar('sem_smtp'); return 'sem_smtp'; }
    marcar('erro', String(e.message).slice(0, 300)); return 'erro';
  }
}
