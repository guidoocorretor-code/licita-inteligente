// Busca avançada combinável sobre licitações (todas as fontes, já deduplicadas).
import { statusDaVisao, agoraBrasilia } from './status.js';

const lista = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
const termos = (v) => (v ? String(v).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [] : []);
const fts = (t) => `"${t.replace(/"/g, '')}"`;
const dataOk = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? String(v).slice(0, 10) : null);
const numOk = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export const ORDENACOES = {
  publicacao_desc: 'l.data_publicacao DESC, l.id DESC',
  publicacao_asc: 'l.data_publicacao ASC, l.id ASC',
  encerramento_asc: "CASE WHEN l.data_encerramento_proposta IS NULL THEN 1 ELSE 0 END, l.data_encerramento_proposta ASC",
  valor_desc: 'CASE WHEN l.valor_estimado IS NULL THEN 1 ELSE 0 END, l.valor_estimado DESC',
  valor_asc: 'CASE WHEN l.valor_estimado IS NULL THEN 1 ELSE 0 END, l.valor_estimado ASC',
  atualizacao_desc: 'l.ultima_verificacao DESC',
};

/** Constrói WHERE + parâmetros a partir dos filtros. Exportado para testes. */
export function montarFiltro(f = {}, agora = agoraBrasilia()) {
  const w = []; const p = [];

  // Texto: palavras gerais (todas), obrigatórias (todas), excluídas (nenhuma)
  const gerais = termos(f.q); const obrig = termos(f.obrigatorias); const excl = termos(f.excluir);
  if (gerais.length || obrig.length) {
    let expr = [...gerais, ...obrig].map(fts).join(' AND ');
    if (excl.length) expr += ' ' + excl.map((t) => `NOT ${fts(t)}`).join(' ');
    w.push('l.id IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)'); p.push(expr);
  } else if (excl.length) {
    w.push(`l.id NOT IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)`); p.push(excl.map(fts).join(' OR '));
  }

  const inList = (col, vals) => { if (vals.length) { w.push(`${col} IN (${vals.map(() => '?').join(',')})`); p.push(...vals); } };
  inList('l.uf', lista(f.uf).map((s) => s.toUpperCase()));
  inList('l.esfera', lista(f.esfera));
  inList('l.modalidade_id', lista(f.modalidade).map(Number).filter(Number.isFinite));
  inList('l.plataforma_origem', lista(f.plataforma));
  inList('l.segmento', lista(f.segmento));

  let status = lista(f.status);
  if (f.visao) status = [...status, ...statusDaVisao(f.visao)];
  inList('l.status_calculado', status);

  if (f.municipio) { w.push('l.municipio LIKE ?'); p.push(`%${String(f.municipio).trim()}%`); }
  if (f.codigo_ibge) { w.push('l.codigo_ibge = ?'); p.push(String(f.codigo_ibge)); }
  if (f.orgao) {
    const d = String(f.orgao).replace(/\D/g, '');
    if (d.length === 14) { w.push('l.orgao_cnpj = ?'); p.push(d); } else { w.push('l.orgao_nome LIKE ?'); p.push(`%${String(f.orgao).trim()}%`); }
  }
  if (f.regime_legal) { w.push('l.regime_legal = ?'); p.push(f.regime_legal); }

  const vmin = numOk(f.valor_min); const vmax = numOk(f.valor_max);
  if (vmin != null) { w.push('l.valor_estimado >= ?'); p.push(vmin); }
  if (vmax != null) { w.push('l.valor_estimado <= ?'); p.push(vmax); }

  const pd = dataOk(f.publicacao_de); const pa = dataOk(f.publicacao_ate);
  if (pd) { w.push('l.data_publicacao >= ?'); p.push(`${pd}T00:00:00`); }
  if (pa) { w.push('l.data_publicacao <= ?'); p.push(`${pa}T23:59:59`); }
  const ad = dataOk(f.abertura_de); const aa = dataOk(f.abertura_ate);
  if (ad) { w.push('l.data_abertura_proposta >= ?'); p.push(`${ad}T00:00:00`); }
  if (aa) { w.push('l.data_abertura_proposta <= ?'); p.push(`${aa}T23:59:59`); }

  // Prazo restante para participar (dias) — exige prazo futuro
  const prazoMin = numOk(f.prazo_min_dias); const prazoMax = numOk(f.prazo_max_dias);
  if (prazoMin != null || prazoMax != null) {
    w.push('l.data_encerramento_proposta >= ?'); p.push(agora);
    const base = Date.parse(agora + 'Z');
    if (prazoMin != null) { w.push('l.data_encerramento_proposta >= ?'); p.push(new Date(base + prazoMin * 86400000).toISOString().slice(0, 19)); }
    if (prazoMax != null) { w.push('l.data_encerramento_proposta <= ?'); p.push(new Date(base + prazoMax * 86400000).toISOString().slice(0, 19)); }
  }
  if (f.sessao_proxima === '1' || f.sessao_proxima === true) {
    const base = Date.parse(agora + 'Z');
    w.push('l.data_encerramento_proposta BETWEEN ? AND ?'); p.push(agora, new Date(base + 7 * 86400000).toISOString().slice(0, 19));
  }

  if (f.me_epp === '1') w.push('l.me_epp_exclusivo = 1');
  if (f.me_epp === '0') w.push('l.me_epp_exclusivo = 0');
  if (f.srp === '1') w.push('l.srp = 1');
  if (f.com_documentos === '1') w.push('l.tem_documentos = 1');
  if (f.criterio) { w.push('l.criterio_julgamento LIKE ?'); p.push(`%${f.criterio}%`); }
  if (f.tipo_item === 'Material' || f.tipo_item === 'Serviço') {
    w.push('l.id IN (SELECT licitacao_id FROM licitacao_itens WHERE material_servico = ?)'); p.push(f.tipo_item);
  }
  if (f.catalogo) { w.push('l.id IN (SELECT licitacao_id FROM licitacao_itens WHERE catalogo_codigo = ?)'); p.push(String(f.catalogo)); }
  if (f.fonte) { w.push('l.id IN (SELECT licitacao_id FROM licitacao_fontes WHERE fonte_codigo = ?)'); p.push(f.fonte); }
  if (f.criado_apos) { w.push('l.criado_em > ?'); p.push(f.criado_apos); }

  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

export const COLUNAS_LISTA = `l.id, l.numero_controle_pncp, l.numero_compra, l.ano, l.processo, l.orgao_nome, l.orgao_cnpj, l.esfera,
  l.uf, l.municipio, l.modalidade_nome, l.objeto, l.segmento, l.valor_estimado, l.valor_estimado_situacao, l.valor_homologado,
  l.data_publicacao, l.data_abertura_proposta, l.data_encerramento_proposta, l.status_calculado, l.status_motivo,
  l.situacao_oficial_nome, l.plataforma_origem, l.link_origem, l.link_pncp, l.ultima_verificacao, l.me_epp_exclusivo,
  l.num_itens, l.tem_documentos, l.regime_legal, l.criterio_julgamento, l.modo_disputa_nome, l.srp,
  (SELECT group_concat(fonte_codigo) FROM licitacao_fontes lf WHERE lf.licitacao_id = l.id) AS fontes`;

export function buscar(db, f = {}, { agora } = {}) {
  const { where, params } = montarFiltro(f, agora);
  const pagina = Math.max(1, parseInt(f.pagina, 10) || 1);
  const tam = Math.min(100, Math.max(1, parseInt(f.tamanho, 10) || 20));
  const ordem = ORDENACOES[f.ordenar] || ORDENACOES.publicacao_desc;
  const total = db.prepare(`SELECT COUNT(*) n FROM licitacoes l ${where}`).get(...params).n;
  const dados = db.prepare(`SELECT ${COLUNAS_LISTA} FROM licitacoes l ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .all(...params, tam, (pagina - 1) * tam);
  return { total, pagina, tamanho: tam, paginas: Math.ceil(total / tam), dados };
}

export function buscarTodos(db, f = {}, limite = 10000) {
  const { where, params } = montarFiltro(f);
  const ordem = ORDENACOES[f.ordenar] || ORDENACOES.publicacao_desc;
  return db.prepare(`SELECT ${COLUNAS_LISTA} FROM licitacoes l ${where} ORDER BY ${ordem} LIMIT ?`).all(...params, limite);
}
