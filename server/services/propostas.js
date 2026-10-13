// Fase 4 · Propostas: proposta de preços de uma oportunidade, montada a partir das cotações.
// O sistema monta o documento; quem confere e envia no portal do governo é a pessoa (não há envio automático).
import { cotacoesDaOportunidade, margemNoPreco } from './fornecedores.js';

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 500) => { const t = String(v ?? '').trim().slice(0, max); return t || null; };
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().includes(',') ? String(v).replace(/\./g, '').replace(',', '.') : v);
  return Number.isFinite(n) ? n : NaN;
};
const round2 = (v) => Math.round(v * 100) / 100;
// Preço e total com até 4 casas: o Compras.gov.br aceita valor unitário com 4 casas (lance mínimo de R$ 0,0001)
const round4 = (v) => Math.round(v * 10000) / 10000;
/** Arredonda para cima no centavo (o preço mínimo não pode cair abaixo da margem por arredondamento). */
export const centavoAcima = (v) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100;

export const STATUS_PROPOSTA = { rascunho: 'Rascunho', pronta: 'Pronta para enviar', enviada: 'Enviada no portal', cancelada: 'Cancelada' };

// Declarações comuns em propostas (Lei 14.133/2021). O edital manda: o usuário marca as que ele pede.
export const DECLARACOES = {
  tributos: 'Nos preços propostos estão incluídos todos os custos diretos e indiretos, tributos, encargos sociais, trabalhistas, fretes, seguros e demais despesas necessárias ao fornecimento.',
  edital: 'Declaramos que conhecemos e aceitamos todas as condições do edital e seus anexos.',
  me_epp: 'Declaramos, sob as penas da lei, que a empresa se enquadra como microempresa ou empresa de pequeno porte, nos termos da Lei Complementar nº 123/2006, e não está incursa nas vedações do art. 3º, § 4º.',
  menor: 'Declaramos que não empregamos menor de 18 anos em trabalho noturno, perigoso ou insalubre, nem menor de 16 anos, salvo na condição de aprendiz, a partir de 14 anos (art. 7º, XXXIII, da Constituição Federal).',
  reserva_cargos: 'Declaramos que cumprimos as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social (art. 63, IV, da Lei 14.133/2021).',
};

export function migrarPropostas(conn) {
  const cols = conn.prepare('PRAGMA table_info(clientes)').all().map((c) => c.name);
  // Dados da empresa que aparecem na proposta
  for (const c of ['endereco', 'cep', 'resp_cpf', 'banco', 'agencia', 'conta']) if (!cols.includes(c)) conn.exec(`ALTER TABLE clientes ADD COLUMN ${c} TEXT`);
  // Sócios (lista em JSON) e contato do responsável financeiro
  for (const c of ['socios_json', 'fin_nome', 'fin_cargo', 'fin_email', 'fin_telefone', 'pix']) if (!cols.includes(c)) conn.exec(`ALTER TABLE clientes ADD COLUMN ${c} TEXT`);
  conn.exec(`CREATE TABLE IF NOT EXISTS propostas (
    id INTEGER PRIMARY KEY,
    oportunidade_id INTEGER NOT NULL UNIQUE REFERENCES oportunidades(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'rascunho',      -- rascunho | pronta | enviada | cancelada
    validade_dias INTEGER,                        -- validade da proposta (o edital costuma pedir no mínimo 60 dias)
    prazo_entrega TEXT,
    condicoes_pagamento TEXT,
    local_entrega TEXT,
    garantia TEXT,
    observacoes TEXT,
    declaracoes TEXT,                             -- JSON com as chaves de DECLARACOES marcadas
    enviada_em TEXT,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  conn.exec(`CREATE TABLE IF NOT EXISTS proposta_itens (
    proposta_id INTEGER NOT NULL REFERENCES propostas(id) ON DELETE CASCADE,
    numero_item INTEGER NOT NULL,
    incluir INTEGER NOT NULL DEFAULT 1,           -- 0 = a empresa não vai cotar este item
    marca TEXT,
    modelo TEXT,
    preco_unitario REAL,                          -- preço de venda ao órgão
    PRIMARY KEY (proposta_id, numero_item)
  )`);
}

const lerJson = (t, padrao) => { try { return t ? JSON.parse(t) : padrao; } catch { return padrao; } };

/**
 * Proposta da oportunidade (a gravada, ou a sugestão a partir das cotações se ainda não existe),
 * com os itens, a margem de cada preço e os dados da empresa para o cabeçalho.
 */
export function propostaDaOportunidade(db, empresaId, oportunidadeId) {
  const c = cotacoesDaOportunidade(db, empresaId, oportunidadeId);
  const op = c.oportunidade;
  const cliente = op.cliente_id ? db.prepare(`SELECT id, cnpj, razao_social, nome_fantasia, porte, uf, municipio, email, telefone, resp_nome, resp_cargo, resp_cpf,
      endereco, cep, banco, agencia, conta, pix FROM clientes WHERE id=? AND empresa_id=?`).get(op.cliente_id, empresaId) : null;
  const lic = db.prepare('SELECT unidade_codigo, link_origem, sistema_eletronico, plataforma_origem, modalidade_nome, numero_compra, ano, processo, orgao_cnpj, unidade_nome FROM licitacoes WHERE id=?').get(op.licitacao_id);
  const p = db.prepare('SELECT * FROM propostas WHERE oportunidade_id=?').get(op.id);
  const gravados = new Map(p ? db.prepare('SELECT * FROM proposta_itens WHERE proposta_id=?').all(p.id).map((i) => [i.numero_item, i]) : []);
  const imp = c.parametros.impostos_pct;
  const maiorPrazo = Math.max(...c.itens.flatMap((i) => i.cotacoes.filter((x) => x.id === i.usada_id).map((x) => x.prazo_entrega_dias ?? -1)), -1);
  const itens = c.itens.map((i) => {
    const g = gravados.get(i.numero_item);
    const usada = i.cotacoes.find((x) => x.id === i.usada_id);
    const sugerido = i.preco_minimo != null ? centavoAcima(i.preco_minimo) : null;
    const preco = g ? g.preco_unitario : sugerido;
    const estimado = i.orcamento_sigiloso ? null : i.valor_unitario_estimado;
    return {
      numero_item: i.numero_item, descricao: i.descricao, unidade_medida: i.unidade_medida, quantidade: i.quantidade,
      estimado_unitario: estimado, orcamento_sigiloso: !!i.orcamento_sigiloso,
      custo_unitario: i.custo_unitario, preco_minimo: sugerido,
      incluir: g ? !!g.incluir : i.usada_id != null,      // sem cotação: fora da proposta até alguém decidir
      marca: g ? g.marca : usada?.marca_modelo || null, modelo: g ? g.modelo : null,
      preco_unitario: preco,
      total: preco != null && i.quantidade != null ? round4(preco * i.quantidade) : null,
      margem_pct: preco && i.custo_unitario != null ? round2(margemNoPreco(preco, i.custo_unitario, imp)) : null,
      acima_estimado: preco != null && estimado != null && preco > estimado,
      abaixo_custo: preco != null && i.custo_unitario != null && preco < i.custo_unitario,
    };
  });
  const incluidos = itens.filter((i) => i.incluir);
  const total = incluidos.every((i) => i.total != null) && incluidos.length ? round4(incluidos.reduce((s, i) => s + i.total, 0)) : null;
  return {
    oportunidade: { id: op.id, licitacao_id: op.licitacao_id, objeto: op.objeto, orgao_nome: op.orgao_nome, unidade_nome: lic.unidade_nome, municipio: op.municipio, uf: op.uf,
      modalidade_nome: lic.modalidade_nome, numero_compra: lic.numero_compra, ano: lic.ano, processo: lic.processo, data_encerramento_proposta: op.data_encerramento_proposta,
      link_origem: lic.link_origem, unidade_codigo: lic.unidade_codigo, sistema_eletronico: lic.sistema_eletronico, plataforma_origem: lic.plataforma_origem, link_pncp: op.link_pncp },
    cliente,
    impostos_pct: imp,
    proposta: p ? { ...p, declaracoes: lerJson(p.declaracoes, []) } : {
      id: null, status: 'rascunho', validade_dias: 60,
      prazo_entrega: maiorPrazo >= 0 ? `${maiorPrazo} dias corridos após o recebimento da nota de empenho/ordem de fornecimento` : null,
      condicoes_pagamento: 'Conforme edital', local_entrega: 'Conforme edital', garantia: null, observacoes: null,
      declaracoes: ['tributos', 'edital', ...(cliente && ['ME', 'EPP', 'MEI'].includes(cliente.porte) ? ['me_epp'] : [])],
    },
    itens,
    resumo: {
      incluidos: incluidos.length, total,
      sem_preco: incluidos.filter((i) => i.preco_unitario == null).length,
      acima_estimado: incluidos.filter((i) => i.acima_estimado).length,
      abaixo_custo: incluidos.filter((i) => i.abaixo_custo).length,
      margem_pct: total && incluidos.every((i) => i.custo_unitario != null && i.quantidade != null)
        ? round2(margemNoPreco(total, incluidos.reduce((s, i) => s + i.custo_unitario * i.quantidade, 0), imp)) : null,
    },
    declaracoes: DECLARACOES, status: STATUS_PROPOSTA,
  };
}

/** Grava a proposta (cria na primeira vez). */
export function salvarProposta(db, empresaId, oportunidadeId, usuarioId, b) {
  const base = propostaDaOportunidade(db, empresaId, oportunidadeId); // confere a conta e traz os itens
  const validade = b.validade_dias === '' || b.validade_dias == null ? null : Number(b.validade_dias);
  if (validade != null && (!Number.isInteger(validade) || validade < 1 || validade > 365)) throw erro(400, 'Validade da proposta: informe os dias (1 a 365).');
  const decl = (Array.isArray(b.declaracoes) ? b.declaracoes : []).filter((k) => DECLARACOES[k]);
  const existe = new Set(base.itens.map((i) => i.numero_item));
  const itens = (Array.isArray(b.itens) ? b.itens : []).filter((i) => existe.has(Number(i.numero_item))).map((i) => {
    const preco = num(i.preco_unitario);
    if (Number.isNaN(preco) || (preco != null && preco <= 0)) throw erro(400, `Item ${i.numero_item}: preço inválido.`);
    return { numero_item: Number(i.numero_item), incluir: i.incluir ? 1 : 0, marca: texto(i.marca, 120), modelo: texto(i.modelo, 160), preco_unitario: preco == null ? null : round4(preco) };
  });
  const campos = { validade_dias: validade, prazo_entrega: texto(b.prazo_entrega, 300), condicoes_pagamento: texto(b.condicoes_pagamento, 300),
    local_entrega: texto(b.local_entrega, 300), garantia: texto(b.garantia, 300), observacoes: texto(b.observacoes, 2000), declaracoes: JSON.stringify(decl) };
  let id = base.proposta.id;
  if (id) {
    db.prepare(`UPDATE propostas SET ${Object.keys(campos).map((k) => `${k}=?`).join(', ')}, atualizado_em=datetime('now') WHERE id=?`).run(...Object.values(campos), id);
  } else {
    id = Number(db.prepare(`INSERT INTO propostas (oportunidade_id, criado_por, ${Object.keys(campos).join(', ')}) VALUES (?, ?, ${Object.keys(campos).map(() => '?').join(', ')})`)
      .run(oportunidadeId, usuarioId, ...Object.values(campos)).lastInsertRowid);
    db.prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'proposta','Proposta de preços criada')").run(oportunidadeId, usuarioId);
  }
  const up = db.prepare(`INSERT INTO proposta_itens (proposta_id, numero_item, incluir, marca, modelo, preco_unitario) VALUES (?,?,?,?,?,?)
    ON CONFLICT(proposta_id, numero_item) DO UPDATE SET incluir=excluded.incluir, marca=excluded.marca, modelo=excluded.modelo, preco_unitario=excluded.preco_unitario`);
  for (const i of itens) up.run(id, i.numero_item, i.incluir, i.marca, i.modelo, i.preco_unitario);
  return id;
}

/** Muda a situação. "Enviada" só depois que a pessoa enviou de fato no portal (o sistema não envia). */
export function mudarStatusProposta(db, empresaId, oportunidadeId, usuarioId, status) {
  if (!STATUS_PROPOSTA[status]) throw erro(400, 'Situação inválida.');
  const d = propostaDaOportunidade(db, empresaId, oportunidadeId);
  if (!d.proposta.id) throw erro(400, 'Salve a proposta antes.');
  if (['pronta', 'enviada'].includes(status)) {
    if (!d.resumo.incluidos) throw erro(400, 'Inclua pelo menos um item.');
    if (d.resumo.sem_preco) throw erro(400, `${d.resumo.sem_preco} item(ns) incluído(s) sem preço.`);
  }
  db.prepare(`UPDATE propostas SET status=?, enviada_em=CASE WHEN ?='enviada' THEN datetime('now') ELSE enviada_em END, atualizado_em=datetime('now') WHERE id=?`).run(status, status, d.proposta.id);
  db.prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'proposta',?)")
    .run(oportunidadeId, usuarioId, `Proposta: ${STATUS_PROPOSTA[status]}${d.resumo.total != null ? ` (total R$ ${d.resumo.total.toFixed(2).replace('.', ',')})` : ''}`);
}

/** Propostas da conta (página Propostas). */
export function listarPropostas(db, empresaId, { clienteId = null, status = 'todas' } = {}) {
  const w = ['o.empresa_id = ?']; const p = [empresaId];
  if (clienteId) { w.push('o.cliente_id = ?'); p.push(clienteId); }
  const contagem = Object.fromEntries(Object.keys(STATUS_PROPOSTA).map((k) => [k, 0]));
  for (const r of db.prepare(`SELECT pr.status, COUNT(*) n FROM propostas pr JOIN oportunidades o ON o.id = pr.oportunidade_id WHERE ${w.join(' AND ')} GROUP BY pr.status`).all(...p)) contagem[r.status] = r.n;
  if (STATUS_PROPOSTA[status]) { w.push('pr.status = ?'); p.push(status); }
  const propostas = db.prepare(`SELECT pr.id, pr.oportunidade_id, pr.status, pr.enviada_em, pr.atualizado_em, l.id licitacao_id, l.orgao_nome, l.modalidade_nome, l.numero_compra, l.ano,
      l.objeto, l.data_encerramento_proposta, l.link_origem, l.unidade_codigo, l.sistema_eletronico, l.plataforma_origem, COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome,
      (SELECT COUNT(*) FROM proposta_itens pi WHERE pi.proposta_id = pr.id AND pi.incluir = 1) itens,
      (SELECT SUM(pi.preco_unitario * li.quantidade) FROM proposta_itens pi JOIN licitacao_itens li ON li.licitacao_id = l.id AND li.numero_item = pi.numero_item
        WHERE pi.proposta_id = pr.id AND pi.incluir = 1) total,
      (SELECT COUNT(*) FROM proposta_itens pi WHERE pi.proposta_id = pr.id AND pi.incluir = 1 AND pi.preco_unitario IS NULL) sem_preco
    FROM propostas pr JOIN oportunidades o ON o.id = pr.oportunidade_id JOIN licitacoes l ON l.id = o.licitacao_id LEFT JOIN clientes cl ON cl.id = o.cliente_id
    WHERE ${w.join(' AND ')}
    ORDER BY CASE pr.status WHEN 'rascunho' THEN 0 WHEN 'pronta' THEN 1 WHEN 'enviada' THEN 2 ELSE 3 END,
      CASE WHEN l.data_encerramento_proposta IS NULL THEN 1 ELSE 0 END, l.data_encerramento_proposta LIMIT 500`).all(...p)
    .map((r) => ({ ...r, total: r.total == null ? null : round4(r.total) }));
  return { propostas, contagem };
}
