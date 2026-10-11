// Busca avançada combinável sobre licitações (todas as fontes, já deduplicadas).
import { statusDaVisao, agoraBrasilia } from './status.js';
import { SQL_CAPAG_LIC } from './capag.js';
import { SISTEMAS } from './sistemas.js';

const lista = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
const termos = (v) => (v ? String(v).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [] : []);
// Busca por prefixo para pegar plural e variações: "serviço" acha "serviços"; termos em -ção/-são
// e -ções viram o radical ("locação"/"locações" -> "locac*") e acham as duas formas.
// Plural digitado também acha o singular: "transportes" -> "transporte*", "escolares" -> "escolar*",
// "itens" -> "item*" (só em palavras com 5+ letras, para não cortar "mês", "gás" etc.).
export const radical = (t) => {
  let r = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/"/g, '').toLowerCase();
  if (/(cao|coes|sao|soes)$/.test(r)) return r.replace(/([cs])(ao|oes)$/, '$1');
  if (r.length >= 5) r = r.replace(/([aeiou])ns$/, '$1m').replace(/([rz])es$/, '$1').replace(/([aeiou])s$/, '$1');
  return r;
};
const fts = (t) => `"${radical(t)}"*`;
/** "informática; papelaria, material de escritório" -> [['informática'], ['papelaria'], ['material', 'escritório']] (até 30 expressões). */
export const expressoesRamo = (v) => String(v ?? "").split(/[;,\n]+/).map((x) => termos(x).filter((t) => !PALAVRAS_VAZIAS.has(t))).filter((x) => x.length).slice(0, 30);
const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'ou', 'a', 'o', 'as', 'os', 'por']);
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
    const pos = [...gerais, ...obrig].map(fts).join(' AND ');
    if (f.nos_itens === '0' || f.nos_itens === false) {
      w.push('l.id IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)'); p.push(pos);
    } else {
      // Todas as palavras no objeto/órgão OU todas na descrição de um mesmo item (igual à busca do portal PNCP)
      w.push(`(l.id IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)
        OR l.id IN (SELECT licitacao_id FROM licitacao_itens WHERE id IN (SELECT rowid FROM itens_fts WHERE itens_fts MATCH ?)))`);
      p.push(pos, pos);
    }
    if (excl.length) { w.push('l.id NOT IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)'); p.push(excl.map(fts).join(' OR ')); }
  } else if (excl.length) {
    w.push(`l.id NOT IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)`); p.push(excl.map(fts).join(' OR '));
  }

  // Ramo: qualquer uma das expressões (separadas por ";"); dentro de cada expressão, todas as palavras.
  // Usado no painel de Empresas (palavras-chave do ramo de cada empresa) e no campo "Qualquer destas".
  // Mais estrito que a busca livre, para não trazer licitação que só cita a palavra de passagem:
  // - no objeto (e só no objeto, não no órgão nem na informação complementar), palavras de uma
  //   expressão precisam estar próximas ("material de expediente" não casa com "material ... expediente" soltos);
  // - nos itens, a expressão precisa começar a descrição do item, que é onde fica o produto
  //   ("NOTEBOOK CORE I5" conta; "DJ com equipamentos próprios (mesa de som, notebook)" não conta).
  const ramo = expressoesRamo(f.ramo);
  if (ramo.length) {
    const noObjeto = `objeto : (${ramo.map((ws) => (ws.length > 1 ? `NEAR(${ws.map(fts).join(' ')}, 3)` : fts(ws[0]))).join(' OR ')})`;
    const noItem = ramo.map((ws) => `(^${ws.map(fts).join(' AND ')})`).join(' OR ');
    w.push(`(l.id IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)
      OR l.id IN (SELECT licitacao_id FROM licitacao_itens WHERE id IN (SELECT rowid FROM itens_fts WHERE itens_fts MATCH ?)))`);
    p.push(noObjeto, noItem);
  }

  const inList = (col, vals) => { if (vals.length) { w.push(`${col} IN (${vals.map(() => '?').join(',')})`); p.push(...vals); } };
  inList('l.uf', lista(f.uf).map((s) => s.toUpperCase()));
  inList('l.esfera', lista(f.esfera));
  inList('l.modalidade_id', lista(f.modalidade).map(Number).filter(Number.isFinite));
  inList('l.plataforma_origem', lista(f.plataforma));
  inList('l.sistema_eletronico', lista(f.sistema));
  if (f.sistema_custo) inList('l.sistema_eletronico', Object.entries(SISTEMAS).filter(([, x]) => lista(f.sistema_custo).includes(x.custo)).map(([k]) => k));
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
  // Abertura da sessão nos próximos N dias. O PNCP não informa a data da sessão de disputa separadamente:
  // usa o fim do recebimento de propostas, que é quando a sessão abre. "sessao_proxima=1" (antigo) = 7 dias.
  const PERIODOS = [7, 15, 30];
  const sessaoDias = f.sessao_proxima === '1' || f.sessao_proxima === true ? 7 : PERIODOS.includes(Number(f.sessao_dias)) ? Number(f.sessao_dias) : null;
  if (sessaoDias) {
    const base = Date.parse(agora + 'Z');
    w.push('l.data_encerramento_proposta BETWEEN ? AND ?'); p.push(agora, new Date(base + sessaoDias * 86400000).toISOString().slice(0, 19));
  }
  // Publicadas nos últimos N dias
  const pubDias = PERIODOS.includes(Number(f.publicadas_dias)) ? Number(f.publicadas_dias) : null;
  if (pubDias) { w.push('l.data_publicacao >= ?'); p.push(new Date(Date.parse(agora + 'Z') - pubDias * 86400000).toISOString().slice(0, 10) + 'T00:00:00'); }

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
  // Pagômetro (CAPAG do Tesouro): "A,B" = só entes com nota A ou B; "sem" = sem nota (federal, n.d. ou não encontrado)
  if (f.capag) {
    const v = lista(f.capag).map((x) => x.toUpperCase());
    const letras = v.filter((x) => /^[ABCD]$/.test(x));
    const conds = [];
    if (letras.length) { conds.push(`substr(${SQL_CAPAG_LIC},1,1) IN (${letras.map(() => '?').join(',')})`); p.push(...letras); }
    if (v.includes('SEM')) conds.push(`${SQL_CAPAG_LIC} IS NULL`);
    if (conds.length) w.push(`(${conds.join(' OR ')})`);
  }

  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

export const COLUNAS_LISTA = `l.id, l.numero_controle_pncp, l.numero_compra, l.ano, l.processo, l.orgao_nome, l.orgao_cnpj, l.esfera,
  l.uf, l.municipio, l.modalidade_nome, l.objeto, l.segmento, l.valor_estimado, l.valor_estimado_situacao, l.valor_homologado,
  l.data_publicacao, l.data_abertura_proposta, l.data_encerramento_proposta, l.status_calculado, l.status_motivo,
  l.situacao_oficial_nome, l.plataforma_origem, l.sistema_eletronico, l.link_origem, l.link_pncp, l.ultima_verificacao, l.me_epp_exclusivo,
  l.num_itens, l.tem_documentos, l.regime_legal, l.criterio_julgamento, l.modo_disputa_nome, l.srp, l.codigo_ibge,
  ${SQL_CAPAG_LIC} AS capag,
  (SELECT group_concat(fonte_codigo) FROM licitacao_fontes lf WHERE lf.licitacao_id = l.id) AS fontes`;

export function buscar(db, f = {}, { agora } = {}) {
  const { where, params } = montarFiltro(f, agora);
  const pagina = Math.max(1, parseInt(f.pagina, 10) || 1);
  const tam = Math.min(100, Math.max(1, parseInt(f.tamanho, 10) || 20));
  const ordem = ORDENACOES[f.ordenar] || ORDENACOES.publicacao_desc;
  const total = db.prepare(`SELECT COUNT(*) n FROM licitacoes l ${where}`).get(...params).n;
  const dados = db.prepare(`SELECT ${COLUNAS_LISTA} FROM licitacoes l ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .all(...params, tam, (pagina - 1) * tam);
  const r = { total, pagina, tamanho: tam, paginas: Math.ceil(total / tam), dados };
  if (termos(f.q).length || termos(f.obrigatorias).length) {
    marcarItensEncontrados(db, f, dados);
    r.cobertura_itens = coberturaItens(db, f, agora);
  }
  return r;
}

/** Para cada licitação da página, os itens cuja descrição tem as palavras buscadas (até 3). */
export function marcarItensEncontrados(db, f, dados) {
  if (!dados.length || f.nos_itens === '0') return;
  const pos = [...termos(f.q), ...termos(f.obrigatorias)].map(fts).join(' AND ');
  const ids = dados.map((d) => d.id);
  const linhas = db.prepare(`SELECT licitacao_id, numero_item, descricao FROM licitacao_itens
    WHERE licitacao_id IN (${ids.map(() => '?').join(',')}) AND id IN (SELECT rowid FROM itens_fts WHERE itens_fts MATCH ?)
    ORDER BY licitacao_id, numero_item`).all(...ids, pos);
  const por = new Map();
  for (const l of linhas) { const a = por.get(l.licitacao_id) || []; a.push({ numero_item: l.numero_item, descricao: l.descricao }); por.set(l.licitacao_id, a); }
  for (const d of dados) {
    const a = por.get(d.id);
    if (a) { d.itens_encontrados = a.slice(0, 3); d.itens_encontrados_total = a.length; }
  }
}

/** Quantas licitações do filtro (sem o texto) já têm os itens baixados. A busca nos itens só alcança essas. */
export function coberturaItens(db, f, agora) {
  const { where, params } = montarFiltro({ ...f, q: '', obrigatorias: '', excluir: '' }, agora);
  const r = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN l.detalhes_sincronizados_em IS NOT NULL THEN 1 ELSE 0 END) com_itens
    FROM licitacoes l ${where}`).get(...params);
  return { total: r.total, com_itens: r.com_itens || 0 };
}

export function buscarTodos(db, f = {}, limite = 10000) {
  const { where, params } = montarFiltro(f);
  const ordem = ORDENACOES[f.ordenar] || ORDENACOES.publicacao_desc;
  return db.prepare(`SELECT ${COLUNAS_LISTA} FROM licitacoes l ${where} ORDER BY ${ordem} LIMIT ?`).all(...params, limite);
}
