import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture } from '../helpers.js';
import { criarApp } from '../../server/app.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao } from '../../server/services/repositorio.js';
import { avaliarAlertasPesquisas } from '../../server/services/alertas.js';

let base; let servidor; let db;
const SENHA = 'SenhaForte123';

test.before(async () => {
  db = bancoMemoria();
  const e1 = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Empresa A')").run().lastInsertRowid);
  const e2 = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Empresa B')").run().lastInsertRowid);
  criarUsuario(db, { empresaId: e1, nome: 'Admin A', email: 'a@a.com', senha: SENHA, papel: 'admin' });
  criarUsuario(db, { empresaId: e1, nome: 'Leitor A', email: 'l@a.com', senha: SENHA, papel: 'leitor' });
  criarUsuario(db, { empresaId: e2, nome: 'Admin B', email: 'b@b.com', senha: SENHA, papel: 'admin' });
  const bruto = fixture('pncp-contratacao-real');
  salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto);
  servidor = criarApp().listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

async function entrar(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email, senha: SENHA }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return (path, opts = {}) => fetch(`${base}/api${path}`, { ...opts, headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'licita', ...(opts.headers || {}) } });
}

test('rotas exigem login e cookie é HttpOnly/SameSite', async () => {
  assert.equal((await fetch(`${base}/api/licitacoes`)).status, 401);
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email: 'a@a.com', senha: SENHA }) });
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
});

test('senha errada repetida bloqueia a conta', async () => {
  criarUsuario(db, { empresaId: 1, nome: 'X', email: 'x@a.com', senha: SENHA, papel: 'leitor' });
  for (let i = 0; i < 5; i++) {
    await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email: 'x@a.com', senha: 'errada' }) });
  }
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email: 'x@a.com', senha: SENHA }) });
  assert.equal(r.status, 401);
  assert.match((await r.json()).erro, /bloqueada/);
});

test('proteção CSRF: alteração sem cabeçalho é recusada', async () => {
  const api = await entrar('a@a.com');
  const r = await api('/favoritos', { method: 'POST', headers: { 'x-requested-with': '' }, body: JSON.stringify({ tipo: 'licitacao', referencia: '1' }) });
  assert.equal(r.status, 403);
});

test('busca, detalhe e favoritos funcionam e ficam isolados por usuário/empresa', async () => {
  const a = await entrar('a@a.com'); const b = await entrar('b@b.com');
  const busca = await (await a('/licitacoes?q=cartoes&uf=ES')).json();
  assert.equal(busca.total, 1);
  const id = busca.dados[0].id;
  assert.equal((await a('/favoritos', { method: 'POST', body: JSON.stringify({ tipo: 'licitacao', referencia: String(id) }) })).status, 201);
  assert.equal((await (await a('/favoritos')).json()).licitacoes.length, 1);
  assert.equal((await (await b('/favoritos')).json()).licitacoes.length, 0);
  const det = await (await a(`/licitacoes/${id}`)).json();
  assert.equal(det.favorito, true);
  assert.equal(det.licitacao.status_calculado !== undefined, true);
});

test('Kanban: criação, movimentação com histórico e isolamento entre empresas', async () => {
  const a = await entrar('a@a.com'); const b = await entrar('b@b.com');
  const k = await (await a('/kanban')).json();
  assert.equal(k.etapas.length, 12);
  const { id } = await (await a('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: 1 }) })).json();
  const alvo = k.etapas.find((e) => e.nome === 'Em análise');
  assert.equal((await a(`/kanban/${id}`, { method: 'PATCH', body: JSON.stringify({ etapa_id: alvo.id }) })).status, 200);
  const hist = await (await a(`/kanban/${id}/historico`)).json();
  assert.ok(hist.some((h) => h.tipo === 'movimento' && h.texto.includes('Em análise')));
  // Empresa B não vê nem altera o cartão da empresa A
  assert.equal((await (await b('/kanban')).json()).cards.length, 0);
  assert.equal((await b(`/kanban/${id}`, { method: 'PATCH', body: JSON.stringify({ etapa_id: alvo.id }) })).status, 404);
  // Empresa B não pode mover para etapa de outra empresa
  const kb = await (await b('/kanban')).json();
  const { id: idB } = await (await b('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: 1 }) })).json();
  assert.equal((await b(`/kanban/${idB}`, { method: 'PATCH', body: JSON.stringify({ etapa_id: alvo.id }) })).status, 400);
  assert.ok(kb.etapas.length === 12);
});

test('controle de acesso por papel', async () => {
  const leitor = await entrar('l@a.com');
  assert.equal((await leitor('/fontes/pncp/sincronizar', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await leitor('/usuarios')).status, 403);
  assert.equal((await leitor('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: 1 }) })).status, 403);
  const admin = await entrar('a@a.com');
  const us = await (await admin('/usuarios')).json();
  assert.ok(us.every((u) => u.email.endsWith('@a.com')));     // só usuários da própria empresa
  assert.ok(us.every((u) => !('senha_hash' in u)));
  assert.equal((await admin('/fontes/bll', { method: 'PATCH', body: JSON.stringify({ habilitada: true }) })).status, 400);
});

test('importação de JSON oficial e pesquisa salva com alerta', async () => {
  const a = await entrar('a@a.com');
  assert.equal((await a('/pesquisas', { method: 'POST', body: JSON.stringify({ nome: 'Dispensas PB', filtros: { uf: 'PB' }, alertar: true }) })).status, 201);
  await new Promise((r) => setTimeout(r, 1100)); // garante criado_em posterior ao marco do alerta
  const corpo = { resultado: [fixture('compras14133-real')], totalRegistros: 1, totalPaginas: 1, paginasRestantes: 0 };
  const imp = await (await a('/fontes/importar-json', { method: 'POST', body: JSON.stringify(corpo) })).json();
  assert.equal(imp.inseridos, 1);
  assert.equal(avaliarAlertasPesquisas(db), 1);
  const notifs = await (await a('/notificacoes')).json();
  assert.equal(notifs.length, 1);
  assert.match(notifs[0].titulo, /Dispensas PB/);
  const ruim = await a('/fontes/importar-json', { method: 'POST', body: JSON.stringify({ foo: 1 }) });
  assert.equal(ruim.status, 400);
});

test('exportação via API e dashboard calculado do banco', async () => {
  const a = await entrar('a@a.com');
  const csv = await a('/licitacoes/exportar?formato=csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const xlsx = await a('/licitacoes/exportar?formato=xlsx');
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
  const d = await (await a('/dashboard')).json();
  assert.equal(d.total, db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n);
  assert.ok(Array.isArray(d.por_uf));
});

test('código da tela é sempre revalidado, para publicação nova aparecer sem limpar cache', async () => {
  for (const caminho of ['/', '/js/paginas.js', '/css/app.css', '/sw.js', '/dashboard']) {
    const r = await fetch(`${base}${caminho}`);
    assert.equal(r.status, 200, caminho);
    assert.equal(r.headers.get('cache-control'), 'no-cache', caminho);
  }
});
