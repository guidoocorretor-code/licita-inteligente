import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// PDFs de teste vão para uma pasta temporária (STORAGE_DIR precisa existir antes de carregar a configuração)
const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'licita-cli-'));
process.env.STORAGE_DIR = PASTA;
const { bancoMemoria, fixture, clonar } = await import('../helpers.js');
const { criarApp } = await import('../../server/app.js');
const { criarUsuario } = await import('../../server/lib/auth.js');
const { normalizarPncp } = await import('../../server/services/normalizacao.js');
const { salvarLicitacao } = await import('../../server/services/repositorio.js');
const { validarCnpj, situacaoValidade, avaliarAlertasVencimentos } = await import('../../server/services/clientes.js');
const { eventosCalendario } = await import('../../server/services/calendario.js');
const { abrirBanco } = await import('../../server/db/index.js');

// DADOS DE TESTE: CNPJs de exemplo com dígitos válidos (não são empresas reais cadastradas aqui)
const CNPJ_A = '11.222.333/0001-81'; const CNPJ_B = '11444777000161';
const SENHA = 'SenhaForte123';
const PDF = Buffer.from('%PDF-1.4\n% documento de teste\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
let base; let servidor; let db; let licA; let licB;

test.before(async () => {
  db = bancoMemoria();
  const e1 = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  const e2 = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Outra conta')").run().lastInsertRowid);
  criarUsuario(db, { empresaId: e1, nome: 'Guido Teste', email: 'g@a.com', senha: SENHA, papel: 'admin' });
  criarUsuario(db, { empresaId: e2, nome: 'Intruso', email: 'i@b.com', senha: SENHA, papel: 'admin' });
  const r = fixture('pncp-contratacao-real');
  licA = salvarLicitacao(db, normalizarPncp(r), 'pncp', r).id;
  const r2 = clonar(r); r2.numeroControlePNCP = 'TESTE-EMP-2'; r2.sequencialCompra = 999;
  licB = salvarLicitacao(db, normalizarPncp(r2), 'pncp', r2).id;
  servidor = criarApp().listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { servidor.close(); fs.rmSync(PASTA, { recursive: true, force: true }); });

async function entrar(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email, senha: SENHA }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const api = (p, opts = {}, cliente) => fetch(`${base}/api${p}`, { ...opts, headers: { cookie, 'x-requested-with': 'licita',
    ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(cliente ? { 'x-cliente': String(cliente) } : {}), ...(opts.headers || {}) } });
  api.json = async (...a) => { const r = await api(...a); return { status: r.status, corpo: await r.json() }; };
  return api;
}
const enviarDoc = (api, cli, dados, arquivo = PDF, nome = 'sicaf.pdf') => {
  const fd = new FormData();
  fd.append('dados', JSON.stringify(dados));
  if (arquivo) fd.append('arquivo', new Blob([arquivo], { type: 'application/pdf' }), nome);
  return api.json(`/clientes/${cli}/documentos`, { method: 'POST', body: fd });
};

test('CNPJ: confere os dígitos verificadores', () => {
  assert.equal(validarCnpj(CNPJ_A), '11222333000181');
  assert.equal(validarCnpj('11.222.333/0001-82'), null);
  assert.equal(validarCnpj('00000000000000'), null);
  assert.equal(validarCnpj('123'), null);
});

test('situação da validade: vencido, 7/15/30 dias e em dia', () => {
  const s = (v) => situacaoValidade(v, '2026-10-10').situacao;
  assert.equal(s('2026-10-09'), 'vencido');
  assert.equal(s('2026-10-10'), 'vence_7');
  assert.equal(s('2026-10-25'), 'vence_15');
  assert.equal(s('2026-11-09'), 'vence_30');
  assert.equal(s('2026-12-31'), 'em_dia');
  assert.equal(s(null), 'sem_validade');
});

test('cadastro de empresas, SICAF em PDF com várias validades e isolamento entre contas', async () => {
  const g = await entrar('g@a.com'); const intruso = await entrar('i@b.com');
  assert.equal((await g.json('/clientes', { method: 'POST', body: JSON.stringify({ cnpj: '11.222.333/0001-82', razao_social: 'X' }) })).status, 400);
  const a = await g.json('/clientes', { method: 'POST', body: JSON.stringify({ cnpj: CNPJ_A, razao_social: 'Alfa Comércio de Informática LTDA', nome_fantasia: 'Alfa Info', porte: 'ME',
    resp_nome: 'Responsável Teste', resp_email: 'resp@teste.com', resp_telefone: '(27) 99999-0000' }) });
  assert.equal(a.status, 201);
  assert.equal((await g.json('/clientes', { method: 'POST', body: JSON.stringify({ cnpj: CNPJ_A, razao_social: 'Repetida' }) })).status, 400);
  const b = await g.json('/clientes', { method: 'POST', body: JSON.stringify({ cnpj: CNPJ_B, razao_social: 'Beta Serviços LTDA' }) });

  // Um PDF do SICAF com as validades de cada certidão
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const mais = (d) => new Date(Date.parse(hoje) + d * 86400000).toISOString().slice(0, 10);
  const r = await enviarDoc(g, a.corpo.id, { itens: [{ tipo: 'sicaf', validade: mais(200) }, { tipo: 'estadual', validade: mais(5) }, { tipo: 'municipal', validade: mais(-2) }, { tipo: 'fgts', validade: mais(20) }] });
  assert.equal(r.status, 201); assert.equal(r.corpo.ids.length, 4);
  assert.equal((await enviarDoc(g, a.corpo.id, { itens: [{ tipo: 'outro' }] }, Buffer.from('não é pdf'), 'x.pdf')).status, 400);
  assert.equal((await enviarDoc(g, a.corpo.id, { itens: [{ tipo: 'inventado' }] }, null)).status, 400);

  const det = await g.json(`/clientes/${a.corpo.id}`);
  const porTipo = Object.fromEntries(det.corpo.documentos.map((d) => [d.tipo, d]));
  assert.equal(porTipo.municipal.situacao, 'vencido');
  assert.equal(porTipo.estadual.situacao, 'vence_7');
  assert.equal(porTipo.fgts.situacao, 'vence_30');
  assert.equal(porTipo.sicaf.arquivo_caminho, undefined); // caminho interno não vai para a tela
  const lista = (await g.json('/clientes')).corpo.clientes.find((c) => c.id === a.corpo.id);
  assert.deepEqual([lista.vencidos, lista.vencendo], [1, 2]);

  // PDF: abre para a conta dona, nunca para outra conta
  const pdf = await g(`/clientes/${a.corpo.id}/documentos/${porTipo.sicaf.id}/arquivo`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok(Buffer.from(await pdf.arrayBuffer()).equals(PDF));
  assert.equal((await intruso(`/clientes/${a.corpo.id}/documentos/${porTipo.sicaf.id}/arquivo`)).status, 404);
  assert.equal((await intruso.json(`/clientes/${a.corpo.id}`)).status, 404);
  assert.equal((await intruso.json('/kanban', {}, a.corpo.id)).status, 404); // não pode "selecionar" empresa de outra conta

  // O mesmo PDF serve a 4 documentos: só é apagado do disco quando o último sai
  const arquivos = () => fs.readdirSync(path.join(PASTA, 'clientes', String(a.corpo.id))).length;
  assert.equal(arquivos(), 1);
  for (const d of det.corpo.documentos.slice(0, 3)) await g(`/clientes/${a.corpo.id}/documentos/${d.id}`, { method: 'DELETE' });
  assert.equal(arquivos(), 1);
  await g(`/clientes/${a.corpo.id}/documentos/${det.corpo.documentos[3].id}`, { method: 'DELETE' });
  assert.equal(arquivos(), 0);

  // Renovação: a certidão nova substitui a antiga
  const v1 = await enviarDoc(g, b.corpo.id, { itens: [{ tipo: 'municipal', validade: mais(3) }] });
  await enviarDoc(g, b.corpo.id, { itens: [{ tipo: 'municipal', validade: mais(90) }], substitui: v1.corpo.ids });
  const docsB = (await g.json(`/clientes/${b.corpo.id}`)).corpo.documentos;
  assert.deepEqual(docsB.map((d) => d.validade), [mais(90)]);
});

test('empresa selecionada: Kanban, favoritos e alertas só dela; a mesma licitação pode estar em duas empresas', async () => {
  const g = await entrar('g@a.com');
  const { clientes } = (await g.json('/clientes')).corpo;
  const [alfa, beta] = clientes.map((c) => c.id).sort((x, y) => x - y);
  // Mesma licitação no Kanban das duas empresas + uma só na Beta
  assert.equal((await g.json('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: licA }) }, alfa)).status, 201);
  assert.equal((await g.json('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: licA }) }, beta)).status, 201);
  assert.equal((await g.json('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: licB }) }, beta)).status, 201);
  assert.equal((await g.json('/kanban', {}, alfa)).corpo.cards.length, 1);
  assert.equal((await g.json('/kanban', {}, beta)).corpo.cards.length, 2);
  const todas = (await g.json('/kanban')).corpo.cards;
  assert.equal(todas.length, 3);
  assert.ok(todas.every((c) => c.cliente_nome)); // em "Todas", o card diz de qual empresa é

  await g.json('/favoritos', { method: 'POST', body: JSON.stringify({ tipo: 'licitacao', referencia: String(licB) }) }, alfa);
  assert.equal((await g.json('/favoritos', {}, alfa)).corpo.favoritos.length, 1);
  assert.equal((await g.json('/favoritos', {}, beta)).corpo.favoritos.length, 0);
  const det = (await g.json(`/licitacoes/${licA}`, {}, alfa)).corpo;
  assert.ok(det.oportunidade); assert.equal(det.empresas.length, 2);
  assert.equal((await g.json(`/licitacoes/${licB}`, {}, alfa)).corpo.favorito, true);
  assert.equal((await g.json(`/licitacoes/${licB}`, {}, beta)).corpo.favorito, false);
  // Remover com a empresa selecionada tira só o dela
  await g(`/favoritos?tipo=licitacao&referencia=${licB}`, { method: 'DELETE' }, beta);
  assert.equal((await g.json('/favoritos', {}, alfa)).corpo.favoritos.length, 1);

  // Pesquisa salva fica na empresa selecionada
  await g.json('/pesquisas', { method: 'POST', body: JSON.stringify({ nome: 'Informática', filtros: { q: 'mouse' } }) }, alfa);
  assert.equal((await g.json('/pesquisas', {}, alfa)).corpo.length, 1);
  assert.equal((await g.json('/pesquisas', {}, beta)).corpo.length, 0);

  // Excluir a empresa não apaga o Kanban: os cards voltam para "sem empresa"
  assert.equal((await g(`/clientes/${beta}`, { method: 'DELETE' })).status, 200);
  const depois = (await g.json('/kanban')).corpo.cards;
  assert.equal(depois.length, 3);
  assert.equal(depois.filter((c) => c.cliente_id === 0).length, 2);

  // Card "Sem empresa" pode ser vinculado a uma empresa cadastrada
  const semB = depois.find((c) => c.cliente_id === 0 && c.licitacao_id === licB);
  const semA = depois.find((c) => c.cliente_id === 0 && c.licitacao_id === licA);
  assert.equal((await g.json(`/kanban/${semB.id}`, { method: 'PATCH', body: JSON.stringify({ cliente_id: alfa }) })).status, 200);
  assert.equal((await g.json('/kanban', {}, alfa)).corpo.cards.length, 2);
  const hist = (await g.json(`/kanban/${semB.id}/historico`)).corpo;
  assert.ok(hist.some((x) => x.tipo === 'empresa'));
  // A Alfa já tem essa licitação no Kanban: não duplica
  const dup = await g.json(`/kanban/${semA.id}`, { method: 'PATCH', body: JSON.stringify({ cliente_id: alfa }) });
  assert.equal(dup.status, 409); assert.match(dup.corpo.erro, /já está no Kanban/);
  // Empresa que não existe (ou de outra conta) é recusada
  assert.equal((await g.json(`/kanban/${semA.id}`, { method: 'PATCH', body: JSON.stringify({ cliente_id: 999999 }) })).status, 400);
  // Desvincular volta para "Sem empresa"
  assert.equal((await g.json(`/kanban/${semB.id}`, { method: 'PATCH', body: JSON.stringify({ cliente_id: 0 }) })).status, 200);
  assert.equal((await g.json('/kanban', {}, alfa)).corpo.cards.length, 1);
});

test('avisos de vencimento: 30, 15, 7 dias e vencido, uma vez cada, só para a conta dona', () => {
  const emp = db.prepare("INSERT INTO empresas (nome) VALUES ('Conta avisos')").run().lastInsertRowid;
  const u1 = criarUsuario(db, { empresaId: Number(emp), nome: 'U1', email: 'u1@c.com', senha: SENHA, papel: 'analista' });
  const cli = db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social) VALUES (?, '11444777000161', 'Gama LTDA')").run(emp).lastInsertRowid;
  db.prepare("INSERT INTO cliente_documentos (cliente_id, tipo, validade) VALUES (?, 'municipal', '2026-11-30')").run(cli);
  const notifs = () => db.prepare("SELECT titulo, cliente_id FROM notificacoes WHERE usuario_id=? AND tipo='vencimento' ORDER BY id").all(u1);
  avaliarAlertasVencimentos(db, '2026-10-01'); assert.equal(notifs().length, 0);   // 60 dias: nada
  avaliarAlertasVencimentos(db, '2026-11-01'); assert.equal(notifs().length, 1);   // 29 dias
  avaliarAlertasVencimentos(db, '2026-11-02'); assert.equal(notifs().length, 1);   // não repete
  avaliarAlertasVencimentos(db, '2026-11-16'); assert.equal(notifs().length, 2);   // 14 dias
  avaliarAlertasVencimentos(db, '2026-11-25'); assert.equal(notifs().length, 3);   // 5 dias
  avaliarAlertasVencimentos(db, '2026-11-30'); assert.match(notifs()[3].titulo, /vence HOJE/);
  avaliarAlertasVencimentos(db, '2026-12-01'); assert.match(notifs()[4].titulo, /VENCEU/);
  avaliarAlertasVencimentos(db, '2026-12-20'); assert.equal(notifs().length, 5);
  assert.ok(notifs().every((n) => n.cliente_id === Number(cli)));
  const ev = eventosCalendario(db, { empresaId: Number(emp), usuarioId: u1 });
  assert.deepEqual(ev.map((e) => [e.tipo, e.quando]), [['vencimento', '2026-11-30']]);
});

test('banco antigo: favoritos e Kanban ganham a empresa sem perder nada', () => {
  const arq = path.join(PASTA, 'antigo.db');
  const v = abrirBanco(arq);
  // Volta favoritos e oportunidades para o formato anterior (sem cliente_id, regra de repetição antiga)
  v.exec(`PRAGMA foreign_keys=OFF; DROP TABLE favoritos; DROP TABLE oportunidades;
    CREATE TABLE favoritos (id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, tipo TEXT NOT NULL, referencia TEXT NOT NULL,
      lista TEXT NOT NULL DEFAULT 'Geral', nota TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (usuario_id, tipo, referencia, lista));
    CREATE TABLE oportunidades (id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id), licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id),
      etapa_id INTEGER NOT NULL REFERENCES kanban_etapas(id), responsavel_id INTEGER, prazo_interno TEXT, posicao INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (empresa_id, licitacao_id));
    INSERT INTO empresas (id, nome) VALUES (1, 'Conta');
    INSERT INTO usuarios (id, empresa_id, nome, email, senha_hash, papel) VALUES (1, 1, 'U', 'u@u.com', 'x', 'admin');
    INSERT INTO licitacoes (id, chave_canonica) VALUES (7, 'k7');
    INSERT INTO kanban_etapas (id, empresa_id, nome, ordem) VALUES (1, 1, 'Nova', 0);
    INSERT INTO oportunidades (id, empresa_id, licitacao_id, etapa_id) VALUES (42, 1, 7, 1);
    INSERT INTO oportunidade_historico (oportunidade_id, tipo, texto) VALUES (42, 'criacao', 'ok');
    INSERT INTO favoritos (id, empresa_id, usuario_id, tipo, referencia) VALUES (5, 1, 1, 'licitacao', '7');`);
  v.close();
  const n = abrirBanco(arq);
  assert.deepEqual(n.prepare('SELECT id, cliente_id FROM oportunidades').all().map((x) => ({ ...x })), [{ id: 42, cliente_id: 0 }]);
  assert.deepEqual(n.prepare('SELECT id, cliente_id FROM favoritos').all().map((x) => ({ ...x })), [{ id: 5, cliente_id: 0 }]);
  assert.equal(n.prepare('SELECT COUNT(*) n FROM oportunidade_historico WHERE oportunidade_id=42').get().n, 1);
  // Agora a mesma licitação pode entrar no Kanban de uma empresa assessorada
  n.prepare("INSERT INTO clientes (id, empresa_id, cnpj, razao_social) VALUES (3, 1, '11222333000181', 'Alfa')").run();
  n.prepare('INSERT INTO oportunidades (empresa_id, cliente_id, licitacao_id, etapa_id) VALUES (1, 3, 7, 1)').run();
  assert.throws(() => n.prepare('INSERT INTO oportunidades (empresa_id, cliente_id, licitacao_id, etapa_id) VALUES (1, 3, 7, 1)').run(), /UNIQUE/);
  assert.deepEqual(n.prepare('PRAGMA foreign_key_check').all(), []);
  n.close();
  abrirBanco(arq).close(); // abrir de novo não migra outra vez
});
