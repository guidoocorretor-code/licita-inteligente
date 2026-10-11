// Link para o fornecedor responder a cotação sem login.
// Um link por fornecedor em cada oportunidade; mostra só os itens pedidos a ele e nunca o valor estimado do órgão
// (mostrar o teto faz o fornecedor cotar perto dele). Expira quando encerram as propostas.
// O banco guarda só um identificador aleatório; o link leva esse identificador assinado com JWT_SECRET,
// então quem lê o banco não consegue montar um link válido.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { registrarCotacoes } from './fornecedores.js';

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const assinar = (nonce) => crypto.createHmac('sha256', config.jwtSecret).update(`cotacao-link:${nonce}`).digest('base64url').slice(0, 32);
const tokenDe = (nonce) => `${nonce}.${assinar(nonce)}`;
const DIAS_SEM_PRAZO = 30;

export function migrarCotacaoLinks(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS cotacao_links (
    id INTEGER PRIMARY KEY,
    nonce TEXT NOT NULL UNIQUE,
    oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
    fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
    itens TEXT NOT NULL,
    expira_em TEXT NOT NULL,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    ultimo_acesso TEXT,
    respondido_em TEXT,
    revogado INTEGER NOT NULL DEFAULT 0,
    UNIQUE (oportunidade_id, fornecedor_id)
  )`);
  const cols = conn.prepare('PRAGMA table_info(cotacoes)').all().map((c) => c.name);
  if (!cols.includes('origem')) conn.exec('ALTER TABLE cotacoes ADD COLUMN origem TEXT'); // NULL = digitada pela equipe; 'fornecedor' = pelo link
  for (const c of ['condicoes_pagamento', 'respondente']) if (!cols.includes(c)) conn.exec(`ALTER TABLE cotacoes ADD COLUMN ${c} TEXT`);
}

// Fim do prazo: encerramento das propostas (horário de Brasília) ou 30 dias, em UTC no formato do SQLite
function expiracao(op) {
  if (op.data_encerramento_proposta) {
    const d = new Date(`${String(op.data_encerramento_proposta).replace(' ', 'T').slice(0, 19)}-03:00`);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return new Date(Date.now() + DIAS_SEM_PRAZO * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

/** Cria (ou reaproveita) o link do fornecedor nesta oportunidade e junta os itens pedidos. Devolve o token. */
export function linkDoFornecedor(db, empresaId, oportunidadeId, usuarioId, b) {
  const op = db.prepare(`SELECT o.id, o.licitacao_id, l.data_encerramento_proposta FROM oportunidades o JOIN licitacoes l ON l.id = o.licitacao_id
    WHERE o.id=? AND o.empresa_id=?`).get(oportunidadeId, empresaId);
  if (!op) throw erro(404, 'Oportunidade não encontrada.');
  const forn = db.prepare('SELECT id FROM fornecedores WHERE id=? AND empresa_id=?').get(Number(b.fornecedor_id), empresaId);
  if (!forn) throw erro(400, 'Escolha um fornecedor cadastrado.');
  const existe = new Set(db.prepare('SELECT numero_item FROM licitacao_itens WHERE licitacao_id=?').all(op.licitacao_id).map((r) => r.numero_item));
  const itens = [...new Set((Array.isArray(b.itens) ? b.itens : []).map(Number))].filter((n) => existe.has(n));
  if (!itens.length) throw erro(400, 'Marque pelo menos um item.');
  // Itens do link = os marcados agora + os de pedidos já enviados a este fornecedor (um link antigo continua mostrando o que foi pedido)
  const jaPedidos = db.prepare('SELECT itens FROM cotacao_pedidos WHERE oportunidade_id=? AND fornecedor_id=?').all(op.id, forn.id).flatMap((p) => JSON.parse(p.itens));
  const todos = JSON.stringify([...new Set([...itens, ...jaPedidos])].sort((x, y) => x - y));
  const atual = db.prepare('SELECT * FROM cotacao_links WHERE oportunidade_id=? AND fornecedor_id=?').get(op.id, forn.id);
  const expira = expiracao(op);
  if (atual) {
    db.prepare('UPDATE cotacao_links SET itens=?, expira_em=?, revogado=0 WHERE id=?').run(todos, expira, atual.id);
    return { token: tokenDe(atual.nonce), expira_em: expira };
  }
  const nonce = crypto.randomBytes(16).toString('base64url');
  db.prepare('INSERT INTO cotacao_links (nonce, oportunidade_id, fornecedor_id, itens, expira_em, criado_por) VALUES (?,?,?,?,?,?)')
    .run(nonce, op.id, forn.id, todos, expira, usuarioId);
  return { token: tokenDe(nonce), expira_em: expira };
}

export function revogarLink(db, empresaId, oportunidadeId, fornecedorId) {
  return db.prepare(`UPDATE cotacao_links SET revogado=1 WHERE oportunidade_id=? AND fornecedor_id=?
    AND oportunidade_id IN (SELECT id FROM oportunidades WHERE empresa_id=?)`).run(oportunidadeId, fornecedorId, empresaId).changes > 0;
}

// Confere a assinatura em tempo constante e devolve o link válido (ou erro com a mensagem para o fornecedor)
function linkDoToken(db, token) {
  const [nonce, sig] = String(token || '').split('.');
  if (!nonce || !sig || !/^[A-Za-z0-9_-]{16,40}$/.test(nonce) || !/^[A-Za-z0-9_-]{32}$/.test(sig)) throw erro(404, 'Link inválido.');
  const certo = Buffer.from(assinar(nonce)); const veio = Buffer.from(sig);
  if (certo.length !== veio.length || !crypto.timingSafeEqual(certo, veio)) throw erro(404, 'Link inválido.');
  const l = db.prepare('SELECT * FROM cotacao_links WHERE nonce=?').get(nonce);
  if (!l || l.revogado) throw erro(404, 'Este link não está mais ativo. Fale com quem pediu a cotação.');
  if (l.expira_em < new Date().toISOString().slice(0, 19).replace('T', ' ')) throw erro(410, 'O prazo para responder esta cotação terminou. Obrigado!');
  return l;
}

/** O que o fornecedor vê: quem pede e a descrição dos itens (sem dados da licitação nem valor estimado). */
export function cotacaoPublica(db, token) {
  const l = linkDoToken(db, token);
  db.prepare("UPDATE cotacao_links SET ultimo_acesso=datetime('now') WHERE id=?").run(l.id);
  const op = db.prepare(`SELECT l.orgao_nome, l.municipio, l.uf, l.modalidade_nome, l.numero_compra, l.ano, l.data_encerramento_proposta, l.objeto, l.id licitacao_id,
      COALESCE(cl.razao_social, cl.nome_fantasia) cliente, cl.cnpj cliente_cnpj, e.nome conta
    FROM oportunidades o JOIN licitacoes l ON l.id = o.licitacao_id LEFT JOIN clientes cl ON cl.id = o.cliente_id JOIN empresas e ON e.id = o.empresa_id
    WHERE o.id=?`).get(l.oportunidade_id);
  const forn = db.prepare('SELECT COALESCE(nome_fantasia, razao_social) nome, frete FROM fornecedores WHERE id=?').get(l.fornecedor_id);
  const numeros = JSON.parse(l.itens);
  const itens = db.prepare(`SELECT numero_item, descricao, quantidade, unidade_medida FROM licitacao_itens WHERE licitacao_id=? AND numero_item IN (${numeros.map(() => '?').join(',')}) ORDER BY numero_item`)
    .all(op.licitacao_id, ...numeros);
  const ja = db.prepare('SELECT numero_item, preco_unitario, marca_modelo, prazo_entrega_dias, validade, frete_incluso, condicoes_pagamento, observacoes, respondente FROM cotacoes WHERE oportunidade_id=? AND fornecedor_id=?')
    .all(l.oportunidade_id, l.fornecedor_id);
  const fr = db.prepare('SELECT tipo FROM cotacao_fretes WHERE oportunidade_id=? AND fornecedor_id=?').get(l.oportunidade_id, l.fornecedor_id);
  return {
    solicitante: op.cliente || op.conta, solicitante_cnpj: op.cliente_cnpj || null, fornecedor: forn.nome,
    // Nada da licitação (órgão, número, cidade, objeto, datas) vai para o fornecedor: só os itens
    respondido_em: l.respondido_em,
    itens: itens.map((i) => ({ ...i, resposta: ja.find((c) => c.numero_item === i.numero_item) || null })),
    resposta_anterior: ja[0] ? { prazo_entrega_dias: ja[0].prazo_entrega_dias, validade: ja[0].validade, frete: fr?.tipo || null,
      condicoes_pagamento: ja[0].condicoes_pagamento, observacoes: ja[0].observacoes, respondente: ja[0].respondente } : null,
  };
}

const texto = (v, max) => { const t = String(v ?? '').trim().slice(0, max); return t || null; };

/** Grava a resposta do fornecedor na cotação da equipe (marcada como vinda pelo link) e avisa quem pediu. */
export function responderCotacao(db, token, b) {
  const l = linkDoToken(db, token);
  const op = db.prepare('SELECT id, empresa_id, licitacao_id FROM oportunidades WHERE id=?').get(l.oportunidade_id);
  const permitidos = new Set(JSON.parse(l.itens));
  const itens = (Array.isArray(b.itens) ? b.itens : []).filter((i) => permitidos.has(Number(i.numero_item)) && String(i.preco_unitario ?? '').trim() !== '');
  if (!itens.length) throw erro(400, 'Informe o preço de pelo menos um item.');
  const respondente = texto(b.respondente, 120);
  if (!respondente) throw erro(400, 'Informe o seu nome.');
  if (b.frete && !['CIF', 'FOB'].includes(b.frete)) throw erro(400, 'Frete inválido.');
  const r = registrarCotacoes(db, op.empresa_id, op.id, null, {
    fornecedor_id: l.fornecedor_id, prazo_entrega_dias: b.prazo_entrega_dias, validade: b.validade || null,
    frete: b.frete || undefined, observacoes: texto(b.observacoes, 500),
    itens: itens.map((i) => ({ numero_item: Number(i.numero_item), preco_unitario: i.preco_unitario, marca_modelo: i.marca_modelo })),
  }, { origem: 'fornecedor', condicoes_pagamento: texto(b.condicoes_pagamento, 300), respondente });
  db.prepare("UPDATE cotacao_links SET respondido_em=datetime('now') WHERE id=?").run(l.id);
  const forn = db.prepare('SELECT COALESCE(nome_fantasia, razao_social) nome FROM fornecedores WHERE id=?').get(l.fornecedor_id);
  const msg = `${forn.nome} respondeu a cotação pelo link (${r.gravados} item(ns), por ${respondente}).`;
  db.prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,NULL,'cotacao',?)").run(op.id, msg);
  // Avisa quem gerou o link e quem está atribuído ao card (sino e, se configurado, e-mail de alertas)
  const avisar = new Set([l.criado_por, db.prepare('SELECT responsavel_id FROM oportunidades WHERE id=?').get(op.id)?.responsavel_id].filter(Boolean));
  const ins = db.prepare("INSERT INTO notificacoes (empresa_id, usuario_id, tipo, titulo, mensagem, licitacao_id) VALUES (?,?,'cotacao','Cotação recebida',?,?)");
  for (const u of avisar) ins.run(op.empresa_id, u, msg, op.licitacao_id);
  return { gravados: r.gravados };
}
