import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'licita-painel-'));
process.env.STORAGE_DIR = PASTA;
const { bancoMemoria } = await import('../helpers.js');
const { criarApp } = await import('../../server/app.js');
const { criarUsuario } = await import('../../server/lib/auth.js');
const { abrirBanco } = await import('../../server/db/index.js');
const { resumir } = await import('../../server/services/painel-empresas.js');
const { sugerirPalavras, deBrasilApi, deCnpjWs, fmtCnae } = await import('../../server/services/cnpj.js');
const { agoraBrasilia } = await import('../../server/services/status.js');

// DADOS DE TESTE: empresas e licitações fictícias
const SENHA = 'SenhaForte123';
const hoje = agoraBrasilia().slice(0, 10);
const dia = (d) => new Date(Date.parse(hoje) + d * 86400000).toISOString().slice(0, 10);
let base; let servidor; let db;

test.before(() => {
  db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  criarUsuario(db, { empresaId: emp, nome: 'Guido Teste', email: 'g@a.com', senha: SENHA, papel: 'admin' });
  const lic = db.prepare(`INSERT INTO licitacoes (chave_canonica, objeto, orgao_nome, status_calculado, data_publicacao, data_encerramento_proposta, valor_estimado)
    VALUES (?,?,?,?,?,?,?)`);
  const amanha = `${dia(1)}T10:00:00`;
  for (let i = 1; i <= 12; i++) lic.run(`t${i}`, i <= 3 ? `Aquisição de equipamentos de informática lote ${i}` : `Serviço de limpeza ${i}`, `Prefeitura ${i}`, 'aberta', `${dia(-2)}T09:00:00`, amanha, i * 1000);
  lic.run('t13', 'Material de papelaria e escritório', 'Câmara', 'encerrada', `${dia(-40)}T09:00:00`, `${dia(-30)}T09:00:00`, 500);
  servidor = criarApp().listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { servidor.close(); fs.rmSync(PASTA, { recursive: true, force: true }); });

async function entrar(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email, senha: SENHA }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const api = async (p, opts = {}, cliente) => {
    const r2 = await fetch(`${base}/api${p}`, { ...opts, headers: { cookie, 'x-requested-with': 'licita', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(cliente ? { 'x-cliente': String(cliente) } : {}) } });
    return { status: r2.status, corpo: await r2.json() };
  };
  return api;
}

test('CNAEs da Receita e palavras do ramo sugeridas', () => {
  assert.equal(fmtCnae('4751201'), '4751-2/01'); assert.equal(fmtCnae(0), null);
  const a = deBrasilApi({ razao_social: 'X', cnae_fiscal: 4751201, cnae_fiscal_descricao: 'Comércio varejista especializado de equipamentos e suprimentos de informática',
    cnaes_secundarios: [{ codigo: 4761003, descricao: 'Comércio varejista de artigos de papelaria' }, { codigo: 0, descricao: '' }] });
  assert.deepEqual(a.cnaes.map((c) => [c.codigo, c.principal]), [['4751-2/01', true], ['4761-0/03', false]]);
  const b = deCnpjWs({ razao_social: 'Y', estabelecimento: { atividade_principal: { id: '8121400', descricao: 'Limpeza em prédios e em domicílios' }, atividades_secundarias: [] } });
  assert.equal(b.cnaes[0].codigo, '8121-4/00');
  assert.deepEqual(sugerirPalavras(a.cnaes), ['informática', 'papelaria']);
  assert.deepEqual(sugerirPalavras([{ descricao: 'Comércio atacadista de material elétrico' }]), ['material elétrico']);
});

test('banco antigo: Kanban ganha as 5 etapas de execução depois de "Vencida", com a fase de cada etapa', () => {
  const arq = path.join(PASTA, 'antigo.db');
  const v = abrirBanco(arq);
  v.exec(`INSERT INTO empresas (id, nome) VALUES (1, 'Conta');`);
  const antigas = ['Nova oportunidade', 'Em análise', 'Aguardando decisão', 'Documentação em preparação', 'Proposta em elaboração', 'Pronta para envio',
    'Participação confirmada', 'Em disputa', 'Aguardando resultado', 'Vencida', 'Perdida', 'Descartada'];
  const ins = v.prepare('INSERT INTO kanban_etapas (empresa_id, nome, ordem) VALUES (1, ?, ?)');
  antigas.forEach((n, i) => ins.run(n, i));
  v.close();
  const n = abrirBanco(arq);
  const et = n.prepare('SELECT nome, fase FROM kanban_etapas WHERE empresa_id=1 ORDER BY ordem').all().map((x) => [x.nome, x.fase]);
  assert.equal(et.length, 17);
  assert.deepEqual(et.slice(9, 17), [['Vencida', 'ganha'], ['Aguardando empenho', 'empenho'], ['Empenhado (a entregar)', 'a_entregar'],
    ['Produto enviado / serviço executado', 'entregue'], ['Nota fiscal emitida', 'faturada'], ['Recebido', 'recebida'], ['Perdida', 'perdida'], ['Descartada', 'descartada']]);
  assert.equal(et[7][1], 'disputa');
  n.close();
  const reaberto = abrirBanco(arq);
  assert.equal(reaberto.prepare('SELECT COUNT(*) n FROM kanban_etapas').get().n, 17); // não repete
  reaberto.close();
});

test('valor não informado não vira zero; taxa de vitória só projeta com 5 resultados', () => {
  const r = resumir([
    { fase: 'disputa', valor_proposta: null, valor_estimado: 10000 }, { fase: 'disputa', valor_proposta: 2000 },
    { fase: 'ganha', valor_ganho: null, valor_proposta: null }, { fase: 'perdida' },
  ], hoje);
  assert.equal(r.disputa.valor, 12000); assert.equal(r.disputa.pelo_edital, 1);
  assert.equal(r.execucao.vencida.sem_valor, 1); assert.equal(r.execucao.vencida.valor, 0);
  assert.equal(r.taxa_vitoria.pct, 0.5); assert.equal(r.taxa_vitoria.confiavel, false);
  assert.equal(r.projecao.potencial, null);
});

test('painel de empresas: do edital ao recebimento, por empresa', async () => {
  const g = await entrar('g@a.com');
  const alfa = (await g('/clientes', { method: 'POST', body: JSON.stringify({ cnpj: '11222333000181', razao_social: 'Alfa Informática (TESTE)',
    cnaes: [{ codigo: '4751-2/01', descricao: 'Comércio varejista de equipamentos de informática', principal: true }], palavras_chave: 'informática; papelaria' }) })).corpo.id;
  const beta = (await g('/clientes', { method: 'POST', body: JSON.stringify({ cnpj: '11444777000161', razao_social: 'Beta (TESTE)' }) })).corpo.id;
  const { etapas } = (await g('/kanban')).corpo;
  const etapa = (fase) => etapas.find((e) => e.fase === fase).id;
  const card = async (lic, cli, fase, valores = {}) => {
    const { id } = (await g('/kanban', { method: 'POST', body: JSON.stringify({ licitacao_id: lic }) }, cli)).corpo;
    const r = await g(`/kanban/${id}`, { method: 'PATCH', body: JSON.stringify({ etapa_id: etapa(fase), ...valores }) });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    return id;
  };
  await card(1, alfa, 'disputa', { valor_proposta: 900 });
  await card(2, alfa, 'disputa');                                          // sem proposta: usa o edital (2.000), marcado
  await card(3, alfa, 'prospeccao');
  await card(4, alfa, 'empenho', { valor_ganho: 4000, entrega_prazo: dia(2) });
  await card(5, alfa, 'a_entregar', { valor_ganho: 5000, empenho_valor: 4800, entrega_prazo: dia(-1) });
  await card(6, alfa, 'faturada', { nf_numero: '123', nf_valor: 6000, nf_data: dia(-45) });
  await card(7, alfa, 'faturada', { nf_valor: 700, nf_data: dia(-3) });
  await card(8, alfa, 'recebida', { nf_valor: 800, recebido_valor: 790, recebido_data: dia(-10) });
  await card(9, alfa, 'perdida');
  await card(10, alfa, 'perdida');
  await card(11, beta, 'ganha');                                             // ganhou sem valor informado
  await card(12, 0, 'disputa');                                              // sem empresa
  // Valor inválido é recusado
  const ruim = await g('/kanban', {}, alfa);
  const um = ruim.corpo.cards[0].id;
  assert.equal((await g(`/kanban/${um}`, { method: 'PATCH', body: JSON.stringify({ nf_valor: -5 }) })).status, 400);
  assert.equal((await g(`/kanban/${um}`, { method: 'PATCH', body: JSON.stringify({ nf_data: '31/12/2026' }) })).status, 400);

  const p = (await g('/painel/empresas')).corpo;
  assert.equal(p.empresas.length, 2); assert.equal(p.sem_empresa, 1);
  const a = p.empresas.find((e) => e.id === alfa);
  assert.equal(p.empresas[0].id, alfa); // mais dinheiro em jogo primeiro
  assert.equal(a.disputa.n, 2); assert.equal(a.disputa.valor, 2900); assert.equal(a.disputa.pelo_edital, 1);
  assert.equal(a.prospeccao.n, 1);
  assert.deepEqual([a.taxa_vitoria.ganhas, a.taxa_vitoria.perdidas], [5, 2]);
  assert.equal(a.taxa_vitoria.confiavel, true);
  assert.equal(a.execucao.aguardando_empenho.valor, 4000);
  assert.equal(a.execucao.a_entregar.valor, 4800);            // empenho vale mais que o valor ganho
  assert.equal(a.execucao.a_receber.valor, 6700);
  assert.deepEqual(a.execucao.a_receber.mais_30d, { n: 1, valor: 6000 });
  assert.equal(a.execucao.recebido_12m.valor, 790);
  assert.equal(a.projecao.garantido, 4000 + 4800 + 6700);
  assert.equal(Math.round(a.projecao.potencial), Math.round(2900 * 5 / 7));
  assert.equal(a.cnaes[0].codigo, '4751-2/01');
  assert.equal(a.ramo.abertas, 3);                              // "informática" em 3 abertas; "papelaria" só numa encerrada
  assert.equal(a.ramo.valor_abertas, 6000);
  const tipos = a.proximos.map((x) => x.tipo);
  assert.ok(tipos.includes('entrega') && tipos.includes('recebimento') && tipos.includes('sessao'));
  assert.ok(a.proximos.find((x) => x.tipo === 'entrega' && /ATRASADA/.test(x.texto)));
  const b = p.empresas.find((e) => e.id === beta);
  assert.equal(b.execucao.vencida.n, 1); assert.equal(b.execucao.vencida.sem_valor, 1); assert.equal(b.ramo, null);
  // Total = só as empresas cadastradas (o card sem empresa fica de fora e é avisado à parte)
  assert.equal(p.total.oportunidades, 11);
  // Empresa selecionada no topo: só ela
  const so = (await g('/painel/empresas', {}, beta)).corpo;
  assert.deepEqual(so.empresas.map((e) => e.id), [beta]);
  // Histórico registra os valores
  const hist = (await g(`/kanban/${um}/historico`)).corpo;
  assert.ok(hist.some((h) => h.tipo === 'valores'));
});
