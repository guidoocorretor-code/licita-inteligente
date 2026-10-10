// Contratos públicos (PNCP): gravação, vínculo com a licitação de origem e consulta.
import { radical } from './busca.js';

const COLS = ['numero_controle_pncp', 'numero_controle_compra', 'ano', 'sequencial', 'numero_contrato', 'processo', 'tipo_contrato',
  'categoria', 'orgao_cnpj', 'orgao_nome', 'unidade_nome', 'esfera', 'uf', 'municipio', 'codigo_ibge', 'fornecedor_ni', 'fornecedor_nome',
  'tipo_pessoa', 'objeto', 'valor_inicial', 'valor_global', 'valor_acumulado', 'numero_parcelas', 'data_assinatura', 'vigencia_inicio',
  'vigencia_fim', 'data_publicacao', 'data_atualizacao', 'plataforma_origem', 'link_pncp'];

/** Insere ou atualiza pelo número de controle PNCP do contrato. */
export function salvarContrato(db, c) {
  if (!c?.numero_controle_pncp) throw new Error('Contrato sem número de controle PNCP.');
  const lic = c.numero_controle_compra
    ? db.prepare('SELECT id FROM licitacoes WHERE numero_controle_pncp=?').get(c.numero_controle_compra) : null;
  const atual = db.prepare('SELECT id, data_atualizacao FROM contratos WHERE numero_controle_pncp=?').get(c.numero_controle_pncp);
  if (!atual) {
    const cols = [...COLS, 'licitacao_id'];
    const r = db.prepare(`INSERT INTO contratos (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...COLS.map((k) => c[k] ?? null), lic?.id ?? null);
    return { acao: 'inserido', id: Number(r.lastInsertRowid) };
  }
  if (atual.data_atualizacao && c.data_atualizacao && c.data_atualizacao <= atual.data_atualizacao) return { acao: 'inalterado', id: atual.id };
  db.prepare(`UPDATE contratos SET ${COLS.map((k) => `${k}=?`).join(',')}, licitacao_id=COALESCE(?, licitacao_id), atualizado_em=datetime('now') WHERE id=?`)
    .run(...COLS.map((k) => c[k] ?? null), lic?.id ?? null, atual.id);
  return { acao: 'atualizado', id: atual.id };
}

/** Liga contratos já gravados a licitações que chegaram depois. */
export function vincularContratos(db) {
  return Number(db.prepare(`UPDATE contratos SET licitacao_id=(SELECT l.id FROM licitacoes l WHERE l.numero_controle_pncp=contratos.numero_controle_compra)
    WHERE licitacao_id IS NULL AND numero_controle_compra IS NOT NULL
      AND EXISTS (SELECT 1 FROM licitacoes l WHERE l.numero_controle_pncp=contratos.numero_controle_compra)`).run().changes);
}

const ORDENS = {
  assinatura_desc: 'c.data_assinatura DESC, c.id DESC', valor_desc: 'c.valor_global DESC', valor_asc: 'c.valor_global ASC',
  vigencia_asc: 'c.vigencia_fim ASC', publicacao_desc: 'c.data_publicacao DESC, c.id DESC',
};

function montarFiltro(f, hoje) {
  const where = []; const p = [];
  if (f.q?.trim()) {
    const termos = f.q.trim().split(/\s+/).filter(Boolean).map((t) => `"${radical(t)}"*`).join(' ');
    where.push('c.id IN (SELECT rowid FROM contratos_fts WHERE contratos_fts MATCH ?)'); p.push(termos);
  }
  if (f.uf) { const ufs = String(f.uf).split(',').map((u) => u.trim().toUpperCase()).filter(Boolean); where.push(`c.uf IN (${ufs.map(() => '?').join(',')})`); p.push(...ufs); }
  if (f.municipio) { where.push('c.municipio = ? COLLATE NOCASE'); p.push(f.municipio); }
  const ni = String(f.fornecedor || '').replace(/\D/g, '');
  if (ni) { where.push(ni.length >= 14 || ni.length === 11 ? 'c.fornecedor_ni = ?' : 'c.fornecedor_ni LIKE ?'); p.push(ni.length >= 14 || ni.length === 11 ? ni : `${ni}%`); }
  const orgao = String(f.orgao || '').replace(/\D/g, '');
  if (orgao) { where.push('c.orgao_cnpj = ?'); p.push(orgao); }
  if (f.esfera) { where.push('c.esfera = ?'); p.push(f.esfera); }
  if (f.assinatura_de) { where.push('c.data_assinatura >= ?'); p.push(f.assinatura_de); }
  if (f.assinatura_ate) { where.push('c.data_assinatura <= ?'); p.push(f.assinatura_ate); }
  if (f.valor_min != null && f.valor_min !== '') { where.push('c.valor_global >= ?'); p.push(Number(f.valor_min)); }
  if (f.valor_max != null && f.valor_max !== '') { where.push('c.valor_global <= ?'); p.push(Number(f.valor_max)); }
  if (f.vigentes === '1' || f.vigentes === true) { where.push('c.vigencia_fim >= ?'); p.push(hoje); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', p };
}

/** Consulta com resumo: total, soma dos valores informados e maiores fornecedores do resultado. */
export function buscarContratos(db, f = {}, { hoje = new Date().toISOString().slice(0, 10), limite } = {}) {
  const { sql, p } = montarFiltro(f, hoje);
  const pagina = Math.max(1, parseInt(f.pagina, 10) || 1);
  const porPagina = limite ?? Math.min(100, Math.max(10, parseInt(f.por_pagina, 10) || 30));
  const ordem = ORDENS[f.ordenar] || ORDENS.assinatura_desc;
  const resumo = db.prepare(`SELECT COUNT(*) total, SUM(c.valor_global) soma, COUNT(c.valor_global) com_valor FROM contratos c ${sql}`).get(...p);
  const fornecedores = db.prepare(`SELECT c.fornecedor_ni ni, MAX(c.fornecedor_nome) nome, COUNT(*) n, SUM(c.valor_global) soma
    FROM contratos c ${sql} ${sql ? 'AND' : 'WHERE'} c.fornecedor_ni IS NOT NULL GROUP BY c.fornecedor_ni ORDER BY soma DESC NULLS LAST LIMIT 10`).all(...p);
  const linhas = db.prepare(`SELECT c.* FROM contratos c ${sql} ORDER BY ${ordem} LIMIT ? OFFSET ?`).all(...p, porPagina, (pagina - 1) * porPagina);
  return { total: resumo.total, soma_valor_global: resumo.soma, com_valor: resumo.com_valor, fornecedores, pagina, por_pagina: porPagina, linhas };
}

export const contratosDaLicitacao = (db, licId) =>
  db.prepare('SELECT * FROM contratos WHERE licitacao_id=? ORDER BY data_assinatura, id').all(licId);
