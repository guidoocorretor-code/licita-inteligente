// Kanban: senha do administrador em "Nota fiscal emitida"/"Recebido", justificativa no descarte,
// aviso de licitação já na esteira e Dashboard por período. DADOS DE TESTE fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'licita-kregras-'));
process.env.STORAGE_DIR = PASTA;
const { bancoMemoria } = await import('../helpers.js');
const { criarApp } = await import('../../server/app.js');
const { criarUsuario } = await import('../../server/lib/auth.js');
const { precisaSenhaAdmin } = await import('../../server/services/kanban-regras.js');

const SENHA = 'SenhaForte123'; const SENHA_ADMIN = 'AdminForte456';
let base; let servidor; let db;

test.before(() => {
  db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  criarUsuario(db, { empresaId: emp, nome: 'Dono', email: 'admin@a.com', senha: SENHA_ADMIN, papel: 'admin' });
  criarUsuario(db, { empresaId: emp, nome: 'Gestora', email: 'gestor@a.com', senha: SENHA, papel: 'gestor' });
  const lic = db.prepare('INSERT INTO licitacoes (chave_canonica, objeto, orgao_nome, status_calculado, valor_estimado) VALUES (?,?,?,?,?)');
  for (let i = 1; i <= 6; i++) lic.run(`k${i}`, `Objeto de teste ${i}`, `Órgão ${i}`, 'aberta', 1000 * i);
  servidor = criarApp().listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { servidor.close(); fs.rmSync(PASTA, { recursive: true, force: true }); });

async function entrar(email, senha) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email, senha }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (p, opts = {}, cliente) => {
    const r2 = await fetch(`${base}/api${p}`, { ...opts, headers: { cookie, 'x-requested-with': 'licita', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(cliente ? { 'x-cliente': String(cliente) } : {}) } });
    return { status: r2.status, corpo: await r2.json() };
  };
}
const corpo = (o) => ({ method: 'PATCH', body: JSON.stringify(o) });

test('regra pura: o que trava em nota emitida / recebido', () => {
  const op = { fase: 'faturada', etapa_id: 1, nf_valor: 100, recebido_valor: null };
  assert.equal(precisaSenhaAdmin({ ...op, fase: 'disputa' }, { excluir: true }), false);
  assert.equal(precisaSenhaAdmin(op, { destino: { id: 2, fase: 'recebida' } }), false);      // passo natural
  assert.equal(precisaSenhaAdmin(op, { destino: { id: 3, fase: 'entregue' } }), true);       // voltar
  assert.equal(precisaSenhaAdmin(op, { campos: { recebido_valor: 90 } }), false);            // completar campo vazio
  assert.equal(precisaSenhaAdmin(op, { campos: { nf_valor: 120 } }), true);                  // trocar valor gravado
  assert.equal(precisaSenhaAdmin(op, { campos: { nf_valor: 100 } }), false);                 // mesmo valor
  assert.equal(precisaSenhaAdmin(op, { excluir: true }), true);
});

test('nota emitida e recebido só mudam com a senha do administrador', async () => {
  const g = await entrar('gestor@a.com', SENHA);
  const { etapas } = (await g('/kanban')).corpo;
  const etapa = (f) => etapas.find((e) => e.fase === f).id;
  const { id } = (await g('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: 1 }) })).corpo;
  assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: etapa('faturada'), nf_valor: 1000, nf_data: '2026-03-10' }))).status, 200);
  // Trocar o valor da nota: pede senha
  const sem = await g(`/kanban/${id}`, corpo({ nf_valor: 1 }));
  assert.equal(sem.status, 423); assert.match(sem.corpo.erro, /senha do administrador/);
  assert.equal((await g(`/kanban/${id}`, corpo({ nf_valor: 1, senha_admin: 'errada' }))).status, 423);
  assert.equal((await g(`/kanban/${id}`, corpo({ nf_valor: 1, senha_admin: SENHA }))).status, 423);   // senha de quem não é admin não serve
  assert.equal((await g(`/kanban/${id}`, corpo({ nf_valor: 1100, senha_admin: SENHA_ADMIN }))).status, 200);
  const hist = (await g(`/kanban/${id}/historico`)).corpo;
  assert.ok(hist.some((x) => x.tipo === 'autorizacao' && /Dono/.test(x.texto)));
  // Nota emitida → Recebido é o passo normal e completar o recebimento também
  assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: etapa('recebida') }))).status, 200);
  assert.equal((await g(`/kanban/${id}`, corpo({ recebido_valor: 1100, recebido_data: '2026-04-02' }))).status, 200);
  // Voltar de Recebido, trocar responsável ou excluir: pede senha
  assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: etapa('faturada') }))).status, 423);
  assert.equal((await g(`/kanban/${id}`, corpo({ prazo_interno: '2026-05-01' }))).status, 423);
  assert.equal((await g(`/kanban/${id}`, { method: 'DELETE', body: '{}' })).status, 423);
  assert.equal((await g(`/kanban/${id}`, { method: 'DELETE', body: JSON.stringify({ senha_admin: SENHA_ADMIN }) })).status, 200);
});

test('descartar exige justificativa; subir de novo avisa que está nos descartados', async () => {
  const g = await entrar('gestor@a.com', SENHA);
  const { etapas } = (await g('/kanban')).corpo;
  const desc = etapas.find((e) => e.fase === 'descartada').id;
  const { id } = (await g('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: 2 }) })).corpo;
  assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: desc }))).status, 400);
  assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: desc, justificativa: 'curto' }))).status, 400);
  assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: desc, justificativa: 'Exige atestado que a empresa não tem' }))).status, 200);
  const de = await g('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: 2 }) });
  assert.equal(de.corpo.existente, true); assert.equal(de.corpo.fase, 'descartada');
  assert.equal(de.corpo.motivo, 'Exige atestado que a empresa não tem');
  assert.equal((await g('/kanban')).corpo.cards.filter((c) => c.licitacao_id === 2).length, 1);   // não duplicou
  // Voltar para a esteira limpa o motivo do card (fica no histórico)
  const nova = etapas[0].id;
  assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: nova }))).status, 200);
  assert.equal(db.prepare('SELECT descarte_motivo FROM oportunidades WHERE id=?').get(id).descarte_motivo, null);
  assert.ok((await g(`/kanban/${id}/historico`)).corpo.some((x) => x.tipo === 'descarte'));
});

test('dashboard por período: cada card conta pela data da sua fase; faturamento pela data da nota', async () => {
  const g = await entrar('gestor@a.com', SENHA);
  const cli = (await g('/clientes', { method: 'POST', body: JSON.stringify({ cnpj: '11222333000181', razao_social: 'Gama (TESTE)' }) })).corpo.id;
  const { etapas } = (await g('/kanban')).corpo;
  const etapa = (f) => etapas.find((e) => e.fase === f).id;
  const card = async (lic, fase, v) => {
    const { id } = (await g('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: lic }) }, cli)).corpo;
    assert.equal((await g(`/kanban/${id}`, corpo({ etapa_id: etapa(fase), ...v }))).status, 200);
  };
  await card(3, 'recebida', { nf_valor: 300, nf_data: '2026-01-20', recebido_valor: 300, recebido_data: '2026-02-05' });
  await card(4, 'recebida', { nf_valor: 400, nf_data: '2026-03-01', recebido_valor: 400, recebido_data: '2026-04-10' });
  await card(5, 'faturada', { nf_valor: 500, nf_data: '2026-02-15' });
  await card(6, 'faturada', { nf_valor: 600 });                                   // nota sem data
  const tudo = (await g('/painel/empresas')).corpo.empresas.find((e) => e.id === cli);
  assert.equal(tudo.execucao.recebido_total.valor, 700); assert.equal(tudo.faturamento.valor, 1200); assert.equal(tudo.faturamento.sem_data, 1);
  const fev = (await g('/painel/empresas?de=2026-02-01&ate=2026-02-28')).corpo;
  const e = fev.empresas.find((x) => x.id === cli);
  assert.equal(e.execucao.recebido_total.valor, 300);                              // recebido em fevereiro
  assert.equal(e.execucao.a_receber.valor, 500);                                   // nota de fevereiro ainda não paga
  assert.equal(e.faturamento.valor, 500); assert.equal(e.faturamento.n, 1);         // notas emitidas em fevereiro
  assert.ok(fev.periodo.fora_sem_data >= 1);                                        // a nota sem data fica de fora, avisada
  assert.deepEqual(e.por_etapa.find((x) => x.fase === 'recebida'), { ...e.por_etapa.find((x) => x.fase === 'recebida'), n: 1, valor: 300 });
  assert.equal((await g('/painel/empresas?de=2026-03-01&ate=2026-02-01')).status, 400);
});

test('período do dashboard: mês (fevereiro e bissexto), trimestre, semestre, ano e datas livres', async () => {
  const { intervaloPeriodo: f } = await import('../../web/js/painel.js');
  assert.deepEqual(f({ tipo: 'mes', ano: '2026', mes: '2' }), { de: '2026-02-01', ate: '2026-02-28' });
  assert.deepEqual(f({ tipo: 'mes', ano: '2028', mes: '2' }), { de: '2028-02-01', ate: '2028-02-29' });
  assert.deepEqual(f({ tipo: 'tri', ano: '2026', tri: '4' }), { de: '2026-10-01', ate: '2026-12-31' });
  assert.deepEqual(f({ tipo: 'sem', ano: '2026', sem: '2' }), { de: '2026-07-01', ate: '2026-12-31' });
  assert.deepEqual(f({ tipo: 'ano', ano: '2025' }), { de: '2025-01-01', ate: '2025-12-31' });
  assert.deepEqual(f({ tipo: 'livre', de: '2026-01-05', ate: '' }), { de: '2026-01-05', ate: null });
  assert.deepEqual(f({ tipo: 'tudo' }), { de: null, ate: null });
});
