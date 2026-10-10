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
    const ins = db.prepare(`INSERT INTO notificacoes (empresa_id, usuario_id, tipo, titulo, mensagem, licitacao_id) VALUES (?,?,?,?,?,?)`);
    for (const n of novos) {
      ins.run(ps.empresa_id, ps.usuario_id, 'pesquisa_salva', `Nova oportunidade: ${ps.nome}`,
        `${(n.objeto || '').slice(0, 200)} — ${n.orgao_nome || ''} ${n.uf ? '(' + n.uf + ')' : ''}`, n.id);
      geradas++;
    }
    db.prepare("UPDATE pesquisas_salvas SET ultimo_alerta_em=datetime('now') WHERE id=?").run(ps.id);
  }
  return geradas;
}
