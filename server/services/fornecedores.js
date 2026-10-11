// Fornecedores (de quem as empresas assessoradas compram para revender ao governo) e cotações por item.
// Tudo aqui é digitado pelo usuário: nada é inventado. Preço não informado fica NULL, nunca zero.
import { validarCnpj } from './clientes.js';

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const dataOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
const colunas = (conn, t) => conn.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
export const FRETES = { CIF: 'CIF (frete por conta do fornecedor)', FOB: 'FOB (frete por nossa conta)' };

/** Bancos antigos: parâmetros de preço (impostos e margem) na oportunidade. */
export function migrarFornecedores(conn) {
  const op = colunas(conn, 'oportunidades');
  for (const c of ['cot_impostos_pct', 'cot_margem_pct']) if (!op.includes(c)) conn.exec(`ALTER TABLE oportunidades ADD COLUMN ${c} REAL`);
}

// Número opcional: vazio = não informado (NULL); negativo ou absurdo = erro
function numeroOuNulo(v, rotulo, { max = 1e12, inteiro = false } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) throw erro(400, `${rotulo} inválido.`);
  return inteiro ? Math.round(n) : n;
}

// "papel A4; toner, cartucho" -> "papel A4; toner; cartucho"
const listaProdutos = (v) => {
  const l = String(v ?? '').split(/[;,\n]+/).map((x) => x.trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean);
  return l.length ? [...new Set(l)].slice(0, 40).join('; ') : null;
};

function dadosFornecedor(db, empresaId, b) {
  let cnpj = null;
  if (b.cnpj && String(b.cnpj).replace(/\D/g, '')) {
    cnpj = validarCnpj(b.cnpj);
    if (!cnpj) throw erro(400, 'CNPJ inválido. Confira os 14 números (ou deixe em branco).');
  }
  const razao = texto(b.razao_social);
  if (!razao) throw erro(400, 'Informe o nome do fornecedor.');
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw erro(400, 'E-mail inválido.');
  if (b.frete && !FRETES[b.frete]) throw erro(400, 'Frete inválido.');
  const clienteId = Number(b.cliente_id) || 0;
  if (clienteId && !db.prepare('SELECT 1 FROM clientes WHERE id=? AND empresa_id=?').get(clienteId, empresaId)) throw erro(400, 'Empresa inválida.');
  return {
    cliente_id: clienteId, cnpj, razao_social: razao, nome_fantasia: texto(b.nome_fantasia),
    uf: texto(b.uf, 2)?.toUpperCase() || null, municipio: texto(b.municipio, 100),
    contato_nome: texto(b.contato_nome, 150), email: texto(b.email, 150), telefone: texto(b.telefone, 30), whatsapp: texto(b.whatsapp, 30), site: texto(b.site, 200),
    produtos: listaProdutos(b.produtos),
    prazo_entrega_dias: numeroOuNulo(b.prazo_entrega_dias, 'Prazo de entrega', { max: 3650, inteiro: true }),
    pedido_minimo: numeroOuNulo(b.pedido_minimo, 'Pedido mínimo'),
    condicoes_pagamento: texto(b.condicoes_pagamento, 150), frete: b.frete || null,
    observacoes: texto(b.observacoes, 2000),
  };
}

export function criarFornecedor(db, empresaId, b) {
  const d = dadosFornecedor(db, empresaId, b);
  if (d.cnpj && db.prepare('SELECT 1 FROM fornecedores WHERE empresa_id=? AND cnpj=?').get(empresaId, d.cnpj)) throw erro(409, 'Este fornecedor já está cadastrado.');
  const cols = Object.keys(d);
  const out = db.prepare(`INSERT INTO fornecedores (empresa_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(empresaId, ...Object.values(d));
  return Number(out.lastInsertRowid);
}

export function atualizarFornecedor(db, empresaId, id, b) {
  const atual = db.prepare('SELECT * FROM fornecedores WHERE id=? AND empresa_id=?').get(id, empresaId);
  if (!atual) return false;
  if (b.ativo !== undefined && Object.keys(b).length === 1) {
    db.prepare("UPDATE fornecedores SET ativo=?, atualizado_em=datetime('now') WHERE id=?").run(b.ativo ? 1 : 0, id);
    return true;
  }
  const d = dadosFornecedor(db, empresaId, { ...atual, ...b });
  if (d.cnpj && db.prepare('SELECT 1 FROM fornecedores WHERE empresa_id=? AND cnpj=? AND id<>?').get(empresaId, d.cnpj, id)) throw erro(409, 'Outro fornecedor já tem este CNPJ.');
  db.prepare(`UPDATE fornecedores SET ${Object.keys(d).map((k) => `${k}=?`).join(', ')}, atualizado_em=datetime('now') WHERE id=?`).run(...Object.values(d), id);
  return true;
}

/** Excluir só sem cotações; com cotações, desativar (as cotações antigas continuam valendo como histórico). */
export function excluirFornecedor(db, empresaId, id) {
  if (!db.prepare('SELECT 1 FROM fornecedores WHERE id=? AND empresa_id=?').get(id, empresaId)) return false;
  const n = db.prepare('SELECT COUNT(*) n FROM cotacoes WHERE fornecedor_id=?').get(id).n;
  if (n) throw erro(409, `Este fornecedor tem ${n} cotação(ões) registrada(s). Desative em vez de excluir.`);
  db.prepare('DELETE FROM fornecedores WHERE id=?').run(id);
  return true;
}

/** Lista da conta. Com uma empresa selecionada: os dela e os que valem para todas (cliente_id 0). */
export function listarFornecedores(db, empresaId, { clienteId = null, q = '', ativos = false } = {}) {
  const w = ['f.empresa_id = ?']; const p = [empresaId];
  if (clienteId) { w.push('f.cliente_id IN (0, ?)'); p.push(clienteId); }
  if (ativos) w.push('f.ativo = 1');
  const termo = String(q || '').trim();
  if (termo) {
    w.push("(f.razao_social LIKE ? OR COALESCE(f.nome_fantasia,'') LIKE ? OR COALESCE(f.produtos,'') LIKE ? OR COALESCE(f.cnpj,'') LIKE ?)");
    const like = `%${termo}%`; p.push(like, like, like, `%${termo.replace(/\D/g, '') || termo}%`);
  }
  return db.prepare(`SELECT f.*, COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome,
      (SELECT COUNT(*) FROM cotacoes c WHERE c.fornecedor_id = f.id) cotacoes,
      (SELECT MAX(c.atualizado_em) FROM cotacoes c WHERE c.fornecedor_id = f.id) ultima_cotacao
    FROM fornecedores f LEFT JOIN clientes cl ON cl.id = f.cliente_id
    WHERE ${w.join(' AND ')} ORDER BY f.ativo DESC, COALESCE(f.nome_fantasia, f.razao_social) COLLATE NOCASE`).all(...p);
}

// ---------- Combinação fornecedor x item (pelas palavras de "produtos") ----------
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'para', 'com', 'em', 'a', 'o', 'tipo']);
// singular/plural simples: "cartuchos" casa com "cartucho"
const raiz = (w) => (w.length >= 5 ? w.replace(/(oes|aes)$/, 'a').replace(/(res|zes)$/, (m) => m[0]).replace(/s$/, '') : w);
const palavras = (t) => (normalizar(t).match(/[a-z0-9]{2,}/g) || []).filter((w) => !VAZIAS.has(w)).map(raiz);

/** Números dos itens cuja descrição tem todas as palavras de alguma expressão de "produtos". */
export function itensQueCombinam(produtos, itens) {
  const exprs = String(produtos || '').split(';').map(palavras).filter((x) => x.length);
  if (!exprs.length) return [];
  return itens.filter((i) => {
    const desc = new Set(palavras(i.descricao));
    return exprs.some((ws) => ws.every((w) => [...desc].some((d) => d.startsWith(w))));
  }).map((i) => i.numero_item);
}

// ---------- Cotações ----------
function oportunidadeDaConta(db, empresaId, id) {
  const op = db.prepare(`SELECT o.id, o.licitacao_id, o.cliente_id, o.cot_impostos_pct, o.cot_margem_pct, o.valor_proposta,
      l.objeto, l.orgao_nome, l.municipio, l.uf, l.numero_compra, l.ano, l.data_encerramento_proposta, l.detalhes_sincronizados_em, l.numero_controle_pncp,
      COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome
    FROM oportunidades o JOIN licitacoes l ON l.id = o.licitacao_id LEFT JOIN clientes cl ON cl.id = o.cliente_id
    WHERE o.id=? AND o.empresa_id=?`).get(id, empresaId);
  if (!op) throw erro(404, 'Oportunidade não encontrada.');
  return op;
}

/**
 * Preço mínimo de venda pelo divisor: custo ÷ (1 − impostos − margem).
 * Ex.: custo R$ 80, impostos 10%, margem 15% -> 80 ÷ 0,75 = R$ 106,67.
 * Sem impostos e margem informados, devolve só o custo (o usuário vê que faltam os parâmetros).
 */
export function precoMinimo(custo, impostosPct, margemPct) {
  if (custo == null) return null;
  const soma = (impostosPct || 0) + (margemPct || 0);
  if (soma >= 100) return null;
  return Math.round((custo / (1 - soma / 100)) * 100) / 100;
}

/** Itens da licitação com as cotações e o resumo de custo, margem e preço mínimo. */
export function cotacoesDaOportunidade(db, empresaId, id) {
  const op = oportunidadeDaConta(db, empresaId, id);
  const itens = db.prepare(`SELECT numero_item, descricao, material_servico, quantidade, unidade_medida, valor_unitario_estimado, valor_total_estimado, orcamento_sigiloso
    FROM licitacao_itens WHERE licitacao_id=? ORDER BY numero_item`).all(op.licitacao_id);
  const cot = db.prepare(`SELECT c.*, COALESCE(f.nome_fantasia, f.razao_social) fornecedor_nome, f.ativo fornecedor_ativo
    FROM cotacoes c JOIN fornecedores f ON f.id = c.fornecedor_id WHERE c.oportunidade_id=? ORDER BY c.numero_item, c.preco_unitario`).all(id);
  const fornecedores = listarFornecedores(db, empresaId, { clienteId: op.cliente_id || null, ativos: true })
    .map((f) => ({ ...f, combina: itensQueCombinam(f.produtos, itens) }))
    .sort((a, b) => b.combina.length - a.combina.length);
  const imp = op.cot_impostos_pct; const mar = op.cot_margem_pct;
  const linhas = itens.map((i) => {
    const doItem = cot.filter((c) => c.numero_item === i.numero_item);
    const usada = doItem.find((c) => c.escolhida) || doItem[0] || null; // escolhida pelo usuário ou a mais barata
    const estimado = i.orcamento_sigiloso ? null : i.valor_unitario_estimado;
    const minimo = usada ? precoMinimo(usada.preco_unitario, imp, mar) : null;
    const qtd = i.quantidade;
    let situacao = 'sem_cotacao';
    if (usada) situacao = estimado == null ? 'sem_referencia' : (minimo ?? usada.preco_unitario) > estimado ? 'acima' : 'ok';
    return {
      ...i, cotacoes: doItem, usada_id: usada?.id ?? null, custo_unitario: usada?.preco_unitario ?? null,
      custo_total: usada && qtd != null ? round2(usada.preco_unitario * qtd) : null,
      margem_bruta_pct: usada && estimado ? round2(((estimado - usada.preco_unitario) / estimado) * 100) : null,
      preco_minimo: minimo, preco_minimo_total: minimo != null && qtd != null ? round2(minimo * qtd) : null, situacao,
    };
  });
  const cotados = linhas.filter((l) => l.usada_id);
  const soma = (k, ls = cotados) => (ls.some((l) => l[k] == null) ? null : round2(ls.reduce((s, l) => s + l[k], 0)));
  const comRef = cotados.filter((l) => l.valor_unitario_estimado != null && !l.orcamento_sigiloso && l.quantidade != null);
  return {
    oportunidade: op, itens: linhas, fornecedores, fretes: FRETES,
    parametros: { impostos_pct: imp, margem_pct: mar },
    resumo: {
      itens: linhas.length, cotados: cotados.length, acima: linhas.filter((l) => l.situacao === 'acima').length,
      custo_total: cotados.length ? soma('custo_total') : null,
      preco_minimo_total: cotados.length ? soma('preco_minimo_total') : null,
      // estimado só dos itens cotados que têm referência, para comparar banana com banana
      estimado_cotados: comRef.length ? round2(comRef.reduce((s, l) => s + l.valor_unitario_estimado * l.quantidade, 0)) : null,
      custo_cotados_com_ref: comRef.length ? soma('custo_total', comRef) : null,
      itens_com_ref: comRef.length,
    },
  };
}
const round2 = (v) => Math.round(v * 100) / 100;

/** Grava a resposta de um fornecedor para um ou mais itens (preço vazio = remove a cotação daquele item). */
export function registrarCotacoes(db, empresaId, oportunidadeId, usuarioId, b) {
  const op = oportunidadeDaConta(db, empresaId, oportunidadeId);
  const forn = db.prepare('SELECT id FROM fornecedores WHERE id=? AND empresa_id=?').get(Number(b.fornecedor_id), empresaId);
  if (!forn) throw erro(400, 'Escolha um fornecedor cadastrado.');
  if (b.validade && !dataOk(b.validade)) throw erro(400, 'Validade da cotação inválida.');
  const frete = b.frete_incluso === true || b.frete_incluso === 1 || b.frete_incluso === '1' ? 1
    : b.frete_incluso === false || b.frete_incluso === 0 || b.frete_incluso === '0' ? 0 : null;
  const prazo = numeroOuNulo(b.prazo_entrega_dias, 'Prazo de entrega', { max: 3650, inteiro: true });
  const itens = Array.isArray(b.itens) ? b.itens.slice(0, 2000) : [];
  if (!itens.length) throw erro(400, 'Informe o preço de pelo menos um item.');
  const existe = new Set(db.prepare('SELECT numero_item FROM licitacao_itens WHERE licitacao_id=?').all(op.licitacao_id).map((r) => r.numero_item));
  let gravados = 0; let removidos = 0;
  const up = db.prepare(`INSERT INTO cotacoes (oportunidade_id, numero_item, fornecedor_id, preco_unitario, marca_modelo, prazo_entrega_dias, validade, frete_incluso, observacoes, criado_por)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (oportunidade_id, numero_item, fornecedor_id) DO UPDATE SET preco_unitario=excluded.preco_unitario, marca_modelo=excluded.marca_modelo,
      prazo_entrega_dias=excluded.prazo_entrega_dias, validade=excluded.validade, frete_incluso=excluded.frete_incluso, observacoes=excluded.observacoes,
      atualizado_em=datetime('now')`);
  const del = db.prepare('DELETE FROM cotacoes WHERE oportunidade_id=? AND numero_item=? AND fornecedor_id=?');
  db.exec('BEGIN');
  try {
    for (const it of itens) {
      const n = Number(it.numero_item);
      if (!existe.has(n)) throw erro(400, `Item ${it.numero_item} não existe nesta licitação.`);
      const preco = numeroOuNulo(it.preco_unitario, `Preço do item ${n}`);
      if (preco == null) { removidos += Number(del.run(op.id, n, forn.id).changes); continue; }
      if (preco === 0) throw erro(400, `Preço do item ${n}: zero não é cotação. Deixe em branco se o fornecedor não cotou.`);
      up.run(op.id, n, forn.id, round4(preco), texto(it.marca_modelo, 150), prazo, b.validade || null, frete, texto(it.observacoes ?? b.observacoes, 500), usuarioId);
      gravados++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { gravados, removidos };
}
const round4 = (v) => Math.round(v * 10000) / 10000;

/** Marca qual cotação vale para o item (a escolha pode não ser a mais barata: prazo, marca, confiança). */
export function escolherCotacao(db, empresaId, oportunidadeId, cotacaoId) {
  oportunidadeDaConta(db, empresaId, oportunidadeId);
  const c = db.prepare('SELECT * FROM cotacoes WHERE id=? AND oportunidade_id=?').get(cotacaoId, oportunidadeId);
  if (!c) throw erro(404, 'Cotação não encontrada.');
  db.prepare('UPDATE cotacoes SET escolhida = (id = ?) WHERE oportunidade_id=? AND numero_item=?').run(c.id, oportunidadeId, c.numero_item);
}

export function excluirCotacao(db, empresaId, oportunidadeId, cotacaoId) {
  oportunidadeDaConta(db, empresaId, oportunidadeId);
  return Number(db.prepare('DELETE FROM cotacoes WHERE id=? AND oportunidade_id=?').run(cotacaoId, oportunidadeId).changes) > 0;
}

export function salvarParametros(db, empresaId, oportunidadeId, b) {
  oportunidadeDaConta(db, empresaId, oportunidadeId);
  const imp = numeroOuNulo(b.impostos_pct, 'Impostos (%)', { max: 99 });
  const mar = numeroOuNulo(b.margem_pct, 'Margem (%)', { max: 99 });
  if ((imp || 0) + (mar || 0) >= 100) throw erro(400, 'Impostos + margem precisam somar menos de 100%.');
  db.prepare('UPDATE oportunidades SET cot_impostos_pct=?, cot_margem_pct=? WHERE id=?').run(imp, mar, oportunidadeId);
}
