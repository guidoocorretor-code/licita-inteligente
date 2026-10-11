// Fornecedores (de quem as empresas assessoradas compram para revender ao governo) e cotações por item.
// Tudo aqui é digitado pelo usuário: nada é inventado. Preço não informado fica NULL, nunca zero.
import { validarCnpj } from './clientes.js';
import { calcularTributos } from '../../web/js/tributos.js';

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const dataOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
const colunas = (conn, t) => conn.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
export const FRETES = { CIF: 'CIF (frete por conta do fornecedor)', FOB: 'FOB (frete por nossa conta)' };
export const FORMAS_PAGAMENTO = { boleto: 'Boleto', pix: 'Pix', ted: 'TED', cartao: 'Cartão' };
export const PRAZOS_BOLETO = ['0', '30', '30/60', '30/60/90', '30/60/90/120', '30/60/90/120/150'];

/** Bancos antigos: parâmetros de preço (impostos e margem) na oportunidade. */
export function migrarFornecedores(conn) {
  const op = colunas(conn, 'oportunidades');
  for (const c of ['cot_impostos_pct', 'cot_margem_pct']) if (!op.includes(c)) conn.exec(`ALTER TABLE oportunidades ADD COLUMN ${c} REAL`);
  if (!op.includes('cot_tributos')) conn.exec('ALTER TABLE oportunidades ADD COLUMN cot_tributos TEXT');
  if (!colunas(conn, 'clientes').includes('tributos_json')) conn.exec('ALTER TABLE clientes ADD COLUMN tributos_json TEXT');
  const fo = colunas(conn, 'fornecedores');
  for (const [c, t] of [['formas_pagamento', 'TEXT'], ['boleto_prazo', 'TEXT'], ['venda_a_ordem', 'INTEGER'], ['cartao_parcelas', 'INTEGER'], ['cartao_juros', 'INTEGER']]) if (!fo.includes(c)) conn.exec(`ALTER TABLE fornecedores ADD COLUMN ${c} ${t}`);
}

/** Formas aceitas, na ordem fixa: ["pix","boleto"] -> "boleto,pix"; nenhuma marcada = NULL (não informado). */
function formasPagamento(v) {
  const l = (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const invalida = l.find((x) => !FORMAS_PAGAMENTO[x]);
  if (invalida) throw erro(400, `Forma de pagamento inválida: ${invalida}.`);
  const ok = Object.keys(FORMAS_PAGAMENTO).filter((k) => l.includes(k));
  return ok.length ? ok.join(',') : null;
}
/** Prazo do boleto em dias por parcela: "30/60/90". "à vista" = "0". Cada parcela depois da anterior, até 720 dias. */
function prazoBoleto(v) {
  const t = String(v ?? '').trim().replace(/\s+/g, '').replace(/[-,;]/g, '/').replace(/dias?$/i, '');
  if (!t) return null;
  if (/^(a|à)vista$/i.test(t)) return '0';
  if (!/^\d{1,3}(\/\d{1,3}){0,11}$/.test(t)) throw erro(400, 'Prazo do boleto inválido. Use os dias das parcelas, ex.: 30/60/90.');
  const d = t.split('/').map(Number);
  if (d.some((x, i) => x > 720 || (i && x <= d[i - 1]))) throw erro(400, 'Prazo do boleto inválido: cada parcela precisa vencer depois da anterior.');
  return d.join('/');
}
const simNao = (v) => (v === true || v === 1 || v === '1' ? 1 : v === false || v === 0 || v === '0' ? 0 : null);

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
  const formas = formasPagamento(b.formas_pagamento);
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
    formas_pagamento: formas,
    boleto_prazo: formas?.split(',').includes('boleto') ? prazoBoleto(b.boleto_prazo) : null,
    cartao_parcelas: formas?.split(',').includes('cartao') ? numeroOuNulo(b.cartao_parcelas, 'Parcelas do cartão', { max: 24, inteiro: true }) || null : null,
    cartao_juros: formas?.split(',').includes('cartao') ? simNao(b.cartao_juros) : null,
    venda_a_ordem: simNao(b.venda_a_ordem),
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
  const op = db.prepare(`SELECT o.id, o.licitacao_id, o.cliente_id, o.cot_impostos_pct, o.cot_margem_pct, o.cot_tributos, cl.tributos_json cliente_tributos, o.valor_proposta,
      l.objeto, l.orgao_nome, l.municipio, l.uf, l.numero_compra, l.ano, l.data_encerramento_proposta, l.detalhes_sincronizados_em, l.numero_controle_pncp,
      l.modalidade_nome, l.link_pncp, l.processo, l.unidade_nome,
      COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome, cl.razao_social cliente_razao, cl.cnpj cliente_cnpj
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
  const pedidos = db.prepare(`SELECT p.*, COALESCE(f.nome_fantasia, f.razao_social) fornecedor_nome, u.nome usuario_nome
    FROM cotacao_pedidos p JOIN fornecedores f ON f.id = p.fornecedor_id LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.oportunidade_id=? ORDER BY p.enviado_em DESC, p.id DESC`).all(id).map((p) => ({ ...p, itens: JSON.parse(p.itens) }));
  // Dados completos dos fornecedores que cotaram (também os desativados), para a impressão
  const idsCotados = [...new Set(cot.map((c) => c.fornecedor_id))];
  const fornecedoresCotados = idsCotados.length
    ? db.prepare(`SELECT * FROM fornecedores WHERE id IN (${idsCotados.map(() => '?').join(',')})`).all(...idsCotados) : [];
  const fretes = db.prepare(`SELECT fr.*, COALESCE(f.nome_fantasia, f.razao_social) fornecedor_nome FROM cotacao_fretes fr JOIN fornecedores f ON f.id = fr.fornecedor_id
    WHERE fr.oportunidade_id=?`).all(id);
  const freteDe = new Map(fretes.map((f) => [f.fornecedor_id, f]));
  const usadas = itens.map((i) => {
    const doItem = cot.filter((c) => c.numero_item === i.numero_item);
    return { i, doItem, usada: doItem.find((c) => c.escolhida) || doItem[0] || null }; // escolhida pelo usuário ou a mais barata
  });
  // Frete FOB: o valor informado é rateado entre os itens em que aquele fornecedor é o usado, pelo valor de cada item
  const baseFrete = new Map();
  for (const { i, usada } of usadas) {
    if (usada && i.quantidade != null && freteDe.get(usada.fornecedor_id)?.tipo === 'FOB' && freteDe.get(usada.fornecedor_id).valor != null) baseFrete.set(usada.fornecedor_id, (baseFrete.get(usada.fornecedor_id) || 0) + usada.preco_unitario * i.quantidade);
  }
  const linhas = usadas.map(({ i, doItem, usada }) => {
    const estimado = i.orcamento_sigiloso ? null : i.valor_unitario_estimado;
    const qtd = i.quantidade;
    // cotação antiga, sem frete por fornecedor: usa o "frete incluso" do item (FOB sem valor fica pendente)
    const fr = !usada ? null : freteDe.get(usada.fornecedor_id) || (usada.frete_incluso === 1 ? { tipo: 'CIF' } : usada.frete_incluso === 0 ? { tipo: 'FOB', valor: null } : null);
    let freteUnit = 0; let fretePendente = false;
    if (fr?.tipo === 'FOB') {
      if (fr.valor == null || qtd == null) fretePendente = true;
      else freteUnit = (fr.valor * (usada.preco_unitario * qtd) / baseFrete.get(usada.fornecedor_id)) / qtd;
    }
    const custo = usada ? round4(usada.preco_unitario + freteUnit) : null;
    const minimo = usada ? precoMinimo(custo, imp, mar) : null;
    let situacao = 'sem_cotacao';
    if (usada) situacao = estimado == null ? 'sem_referencia' : (minimo ?? custo) > estimado ? 'acima' : 'ok';
    return {
      ...i, cotacoes: doItem, usada_id: usada?.id ?? null,
      preco_fornecedor: usada?.preco_unitario ?? null,
      frete: usada ? (fr?.tipo || null) : null, frete_unitario: freteUnit ? round4(freteUnit) : (fr?.tipo === 'CIF' ? 0 : null), frete_pendente: fretePendente,
      custo_unitario: custo, // preço do fornecedor + frete FOB rateado
      custo_total: usada && qtd != null ? round2((usada.preco_unitario + freteUnit) * qtd) : null,
      // Margem que sobra se vender pelo valor estimado, já descontados os impostos informados:
      // (estimado × (1 − impostos) − custo) ÷ estimado. É comparável com a margem desejada.
      margem_estimado_pct: usada && estimado ? round2(margemNoPreco(estimado, custo, imp)) : null,
      preco_minimo: minimo, preco_minimo_total: minimo != null && qtd != null ? round2(minimo * qtd) : null, situacao,
    };
  });
  const cotados = linhas.filter((l) => l.usada_id);
  const soma = (k, ls = cotados) => (ls.some((l) => l[k] == null) ? null : round2(ls.reduce((s, l) => s + l[k], 0)));
  const comRef = cotados.filter((l) => l.valor_unitario_estimado != null && !l.orcamento_sigiloso && l.quantidade != null);
  return {
    oportunidade: op, itens: linhas, fornecedores, fretes: FRETES,
    parametros: { impostos_pct: imp, margem_pct: mar, tributos: lerJson(op.cot_tributos) || lerJson(op.cliente_tributos) },
    fretes_fornecedor: fretes,
    resumo: {
      itens: linhas.length, cotados: cotados.length, acima: linhas.filter((l) => l.situacao === 'acima').length,
      custo_total: cotados.length ? soma('custo_total') : null,
      preco_minimo_total: cotados.length ? soma('preco_minimo_total') : null,
      // estimado só dos itens cotados que têm referência, para comparar banana com banana
      estimado_cotados: comRef.length ? round2(comRef.reduce((s, l) => s + l.valor_unitario_estimado * l.quantidade, 0)) : null,
      custo_cotados_com_ref: comRef.length ? soma('custo_total', comRef) : null,
      itens_com_ref: comRef.length,
      frete_total: round2(linhas.reduce((s, l) => s + (l.frete_unitario && l.quantidade != null ? l.frete_unitario * l.quantidade : 0), 0)),
      fretes_pendentes: linhas.filter((l) => l.frete_pendente).length,
    },
    pedidos, fornecedores_cotados: fornecedoresCotados,
  };
}
const round2 = (v) => Math.round(v * 100) / 100;
const lerJson = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
/** Margem (%) de vender a `preco` com `custo`, descontando os impostos sobre a venda. */
export const margemNoPreco = (preco, custo, impostosPct) => ((preco * (1 - (impostosPct || 0) / 100) - custo) / preco) * 100;

/** Grava a resposta de um fornecedor para um ou mais itens (preço vazio = remove a cotação daquele item). */
export function registrarCotacoes(db, empresaId, oportunidadeId, usuarioId, b) {
  const op = oportunidadeDaConta(db, empresaId, oportunidadeId);
  const forn = db.prepare('SELECT id FROM fornecedores WHERE id=? AND empresa_id=?').get(Number(b.fornecedor_id), empresaId);
  if (!forn) throw erro(400, 'Escolha um fornecedor cadastrado.');
  if (b.validade && !dataOk(b.validade)) throw erro(400, 'Validade da cotação inválida.');
  // Frete: 'CIF' (incluso) ou 'FOB' (por nossa conta, com transportadora e valor); aceita o antigo frete_incluso
  const tipoFrete = b.frete === 'CIF' || b.frete === 'FOB' ? b.frete
    : b.frete_incluso === true || b.frete_incluso === 1 || b.frete_incluso === '1' ? 'CIF'
      : b.frete_incluso === false || b.frete_incluso === 0 || b.frete_incluso === '0' ? 'FOB' : null;
  if (b.frete && !tipoFrete) throw erro(400, 'Frete inválido: use CIF ou FOB.');
  const frete = tipoFrete === 'CIF' ? 1 : tipoFrete === 'FOB' ? 0 : null;
  const valorFrete = tipoFrete === 'FOB' ? numeroOuNulo(b.valor_frete, 'Valor do frete') : null;
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
    if (tipoFrete) {
      db.prepare(`INSERT INTO cotacao_fretes (oportunidade_id, fornecedor_id, tipo, transportadora, valor) VALUES (?,?,?,?,?)
        ON CONFLICT (oportunidade_id, fornecedor_id) DO UPDATE SET tipo=excluded.tipo, transportadora=excluded.transportadora, valor=excluded.valor, atualizado_em=datetime('now')`)
        .run(op.id, forn.id, tipoFrete, tipoFrete === 'FOB' ? texto(b.transportadora, 150) : null, valorFrete);
    } else db.prepare('DELETE FROM cotacao_fretes WHERE oportunidade_id=? AND fornecedor_id=?').run(op.id, forn.id);
    if (gravados) db.prepare("UPDATE cotacao_pedidos SET status='respondido', respondido_em=datetime('now') WHERE oportunidade_id=? AND fornecedor_id=? AND status='aguardando'").run(op.id, forn.id);
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
  const op = oportunidadeDaConta(db, empresaId, oportunidadeId);
  let imp = numeroOuNulo(b.impostos_pct, 'Impostos (%)', { max: 99 });
  let tributos = null;
  if (b.tributos && typeof b.tributos === 'object') {
    const t = b.tributos;
    tributos = { regime: t.regime, anexo: t.anexo, atividade: t.atividade };
    for (const k of ['rbt12', 'icms', 'iss', 'pis_cofins', 'ir_csll', 'aliquota']) tributos[k] = numeroOuNulo(t[k], `Campo ${k}`, { max: k === 'rbt12' ? 1e10 : 99 });
    const c = calcularTributos(tributos);
    if (c.erro) throw erro(400, c.erro);
    imp = c.aliquota; // a alíquota vem do regime; o servidor refaz a conta
    if (op.cliente_id) db.prepare('UPDATE clientes SET tributos_json=? WHERE id=? AND empresa_id=?').run(JSON.stringify(tributos), op.cliente_id, empresaId);
  }
  const mar = numeroOuNulo(b.margem_pct, 'Margem (%)', { max: 99 });
  if ((imp || 0) + (mar || 0) >= 100) throw erro(400, 'Impostos + margem precisam somar menos de 100%.');
  db.prepare('UPDATE oportunidades SET cot_impostos_pct=?, cot_margem_pct=?, cot_tributos=? WHERE id=?').run(imp, mar, tributos ? JSON.stringify(tributos) : null, oportunidadeId);
  return { impostos_pct: imp };
}

// ---------- Pedidos de cotação (enviados pelo usuário fora do sistema) ----------
export const CANAIS_PEDIDO = { whatsapp: 'WhatsApp', email: 'e-mail', outro: 'outro meio' };

/** Registra que o usuário confirmou ter enviado o pedido: a cotação fica "aguardando retorno do fornecedor". */
export function registrarPedido(db, empresaId, oportunidadeId, usuarioId, b) {
  const op = oportunidadeDaConta(db, empresaId, oportunidadeId);
  const forn = db.prepare('SELECT id, COALESCE(nome_fantasia, razao_social) nome FROM fornecedores WHERE id=? AND empresa_id=?').get(Number(b.fornecedor_id), empresaId);
  if (!forn) throw erro(400, 'Escolha um fornecedor cadastrado.');
  if (!CANAIS_PEDIDO[b.canal]) throw erro(400, 'Canal inválido.');
  const existe = new Set(db.prepare('SELECT numero_item FROM licitacao_itens WHERE licitacao_id=?').all(op.licitacao_id).map((r) => r.numero_item));
  const itens = [...new Set((Array.isArray(b.itens) ? b.itens : []).map(Number))].filter((n) => existe.has(n)).sort((x, y) => x - y);
  if (!itens.length) throw erro(400, 'Marque pelo menos um item.');
  db.prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'cotacao',?)")
    .run(op.id, usuarioId, `Pedido de cotação enviado para ${forn.nome} por ${CANAIS_PEDIDO[b.canal]} (${itens.length} item(ns))`);
  // Reenvio ao mesmo fornecedor ainda sem resposta: junta os itens no pedido aberto (uma linha por fornecedor na espera)
  const aberto = db.prepare("SELECT id, itens FROM cotacao_pedidos WHERE oportunidade_id=? AND fornecedor_id=? AND status='aguardando' ORDER BY id DESC LIMIT 1").get(op.id, forn.id);
  if (aberto) {
    const todos = [...new Set([...JSON.parse(aberto.itens), ...itens])].sort((x, y) => x - y);
    db.prepare("UPDATE cotacao_pedidos SET itens=?, canal=?, enviado_em=datetime('now'), usuario_id=? WHERE id=?").run(JSON.stringify(todos), b.canal, usuarioId, aberto.id);
    return aberto.id;
  }
  const out = db.prepare('INSERT INTO cotacao_pedidos (oportunidade_id, fornecedor_id, itens, canal, usuario_id) VALUES (?,?,?,?,?)')
    .run(op.id, forn.id, JSON.stringify(itens), b.canal, usuarioId);
  return Number(out.lastInsertRowid);
}

/** "Sem retorno" (desistiu de esperar) ou volta para "aguardando". */
export function mudarStatusPedido(db, empresaId, oportunidadeId, pedidoId, status) {
  oportunidadeDaConta(db, empresaId, oportunidadeId);
  if (!['sem_retorno', 'aguardando'].includes(status)) throw erro(400, 'Situação inválida.');
  const n = db.prepare('UPDATE cotacao_pedidos SET status=? WHERE id=? AND oportunidade_id=?').run(status, pedidoId, oportunidadeId).changes;
  if (!n) throw erro(404, 'Pedido não encontrado.');
}
