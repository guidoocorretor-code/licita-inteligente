// Fase 5: honorários da assessoria e lucro real por contrato. DADOS DE TESTE fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { garantirEtapas } from '../../server/routes/api.js';
import { salvarContrato, gerarCobrancas, resumoHonorarios, atualizarCobranca, criarCobrancaAvulsa, cancelarCobranca,
  lancarCusto, lucroPorContrato, mesesEntre, excluirCobranca } from '../../server/services/financeiro.js';

function cenario() {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  const cli = Number(db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social) VALUES (?, '00000000000191', 'Empresa Teste Ltda')").run(emp).lastInsertRowid);
  garantirEtapas(db, emp);
  const etapa = (f) => db.prepare('SELECT id FROM kanban_etapas WHERE empresa_id=? AND fase=?').get(emp, f).id;
  const card = (k, fase, campos = {}) => {
    const lic = Number(db.prepare("INSERT INTO licitacoes (chave_canonica, objeto, orgao_nome) VALUES (?,?, 'Prefeitura')").run(k, `Objeto ${k}`).lastInsertRowid);
    const id = Number(db.prepare('INSERT INTO oportunidades (empresa_id, cliente_id, licitacao_id, etapa_id) VALUES (?,?,?,?)').run(emp, cli, lic, etapa(fase)).lastInsertRowid);
    for (const [c, v] of Object.entries(campos)) db.prepare(`UPDATE oportunidades SET ${c}=? WHERE id=?`).run(v, id);
    return id;
  };
  return { db, emp, cli, etapa, card };
}

test('meses do contrato', () => {
  assert.deepEqual(mesesEntre('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('contrato valida os campos', () => {
  const { db, emp, cli } = cenario();
  assert.throws(() => salvarContrato(db, emp, cli, { inicio: '2026-08-01' }), /mensalidade, o percentual/);
  assert.throws(() => salvarContrato(db, emp, cli, { inicio: '2026-08-01', mensalidade: 500 }), /dia de vencimento/);
  assert.throws(() => salvarContrato(db, emp, cli, { mensalidade: 500, dia_vencimento: 10 }), /início/);
  assert.throws(() => salvarContrato(db, emp, cli, { inicio: '2026-08-01', percentual_exito: 120 }), /inválido/);
});

test('mensalidades por mês, êxito sobre o recebido, pagamento e período', () => {
  const { db, emp, cli, etapa, card } = cenario();
  salvarContrato(db, emp, cli, { inicio: '2026-08-01', mensalidade: '800', dia_vencimento: 31, percentual_exito: '3', prazo_exito_dias: 10 });
  const rec = card('a', 'recebida', { recebido_valor: 50000, recebido_data: '2026-09-20' });
  card('b', 'recebida', { recebido_valor: 9999, recebido_data: '2026-07-10' }); // antes do contrato: sem êxito
  card('c', 'faturada', { nf_valor: 20000, nf_data: '2026-10-01' });          // ainda não recebido: sem êxito

  assert.equal(gerarCobrancas(db, emp, '2026-10-12'), 4); // ago, set, out + 1 êxito
  assert.equal(gerarCobrancas(db, emp, '2026-10-12'), 0); // idempotente
  const cob = db.prepare('SELECT * FROM honorarios_cobrancas ORDER BY id').all();
  assert.deepEqual(cob.filter((c) => c.tipo === 'mensalidade').map((c) => c.vencimento), ['2026-08-31', '2026-09-30', '2026-10-31']);
  const ex = cob.find((c) => c.tipo === 'exito');
  assert.equal(ex.valor, 1500); assert.equal(ex.vencimento, '2026-09-30'); assert.equal(ex.oportunidade_id, rec);

  // paga agosto
  const ago = cob[0].id;
  atualizarCobranca(db, emp, ago, { pago_em: '2026-09-02', forma_pagamento: 'pix' });
  assert.throws(() => atualizarCobranca(db, emp, ago, { valor: 10 }), /paga/);
  assert.throws(() => atualizarCobranca(db, emp, ex.id, { valor: 10 }), /Kanban/);

  const r = resumoHonorarios(db, emp, { hoje: '2026-10-12' });
  assert.equal(r.total.previsto, 3900);       // 3 × 800 + 1500
  assert.equal(r.total.recebido, 800);
  assert.equal(r.total.em_aberto, 3100);
  assert.equal(r.total.vencido, 2300);        // setembro + êxito (venceu 30/09)
  assert.equal(r.total.n_vencidas, 2);

  // Período = setembro: previsto pelo vencimento, recebido pela data do pagamento (agosto pago em 02/09)
  const set = resumoHonorarios(db, emp, { de: '2026-09-01', ate: '2026-09-30', hoje: '2026-10-12' });
  assert.equal(set.total.previsto, 2300); assert.equal(set.total.recebido, 800);

  // Valor recebido corrigido no card → êxito em aberto acompanha; card volta de etapa → êxito cancelado
  db.prepare('UPDATE oportunidades SET recebido_valor=60000 WHERE id=?').run(rec);
  gerarCobrancas(db, emp, '2026-10-12');
  assert.equal(db.prepare('SELECT valor FROM honorarios_cobrancas WHERE id=?').get(ex.id).valor, 1800);
  db.prepare('UPDATE oportunidades SET etapa_id=? WHERE id=?').run(etapa('faturada'), rec);
  gerarCobrancas(db, emp, '2026-10-12');
  assert.ok(db.prepare('SELECT cancelada_em FROM honorarios_cobrancas WHERE id=?').get(ex.id).cancelada_em);

  // Avulsa e cancelamento com motivo
  const av = criarCobrancaAvulsa(db, emp, null, { cliente_id: cli, descricao: 'Cadastro no SICAF', valor: '350,00', vencimento: '2026-10-20' });
  assert.throws(() => cancelarCobranca(db, emp, av, ''), /motivo/);
  cancelarCobranca(db, emp, av, 'Cobrado em duplicidade');
});

test('lucro por contrato: sem custo não há lucro; com custo e êxito, lucro e margem', () => {
  const { db, emp, cli, card } = cenario();
  salvarContrato(db, emp, cli, { inicio: '2026-01-01', percentual_exito: 5 });
  const a = card('a', 'recebida', { recebido_valor: 10000, recebido_data: '2026-09-10', nf_valor: 10000 });
  const b = card('b', 'a_entregar', { empenho_valor: 4000, empenho_data: '2026-10-01' });
  card('c', 'disputa'); // ainda não é contrato
  gerarCobrancas(db, emp, '2026-10-12');
  lancarCusto(db, emp, null, a, { categoria: 'produto', valor: 6000 });
  lancarCusto(db, emp, null, a, { categoria: 'impostos', valor: '600' });
  assert.throws(() => lancarCusto(db, emp, null, a, { categoria: 'x', valor: 1 }), /categoria/);

  const r = lucroPorContrato(db, emp);
  assert.equal(r.contratos.length, 2);
  const la = r.contratos.find((c) => c.oportunidade_id === a);
  assert.deepEqual(la.custos, { produto: 6000, impostos: 600, honorarios: 500 });
  assert.equal(la.lucro, 2900); assert.equal(la.margem_pct, 29); assert.equal(la.realizado, true);
  const lb = r.contratos.find((c) => c.oportunidade_id === b);
  assert.equal(lb.receita, 4000); assert.equal(lb.lucro, null); assert.equal(lb.receita_origem, 'empenho');
  assert.equal(r.total.sem_custo, 1); assert.equal(r.total.lucro, 2900); assert.equal(r.total.receita, 10000);

  // Só com o honorário automático (nenhum custo lançado) o lucro continua em branco
  const c = card('d', 'recebida', { recebido_valor: 2000, recebido_data: '2026-09-15' });
  gerarCobrancas(db, emp, '2026-10-12');
  const ld = lucroPorContrato(db, emp).contratos.find((x) => x.oportunidade_id === c);
  assert.equal(ld.custos.honorarios, 100); assert.equal(ld.lucro, null); assert.equal(ld.total_custos, null);

  // Período: o card a_entregar conta pela data do empenho
  assert.equal(lucroPorContrato(db, emp, { de: '2026-10-01', ate: '2026-10-31' }).contratos.length, 1);
});

test('excluir lançamento: some dos totais e não é gerado de novo', () => {
  const { db, emp, cli, card } = cenario();
  salvarContrato(db, emp, cli, { inicio: '2026-08-01', mensalidade: '800', dia_vencimento: 10, percentual_exito: '3' });
  const rec = card('x', 'recebida', { recebido_valor: 10000, recebido_data: '2026-08-20' });
  const hoje = '2026-09-15';
  const antes = resumoHonorarios(db, emp, { hoje });
  const mensal = antes.cobrancas.find((c) => c.tipo === 'mensalidade' && c.competencia === '2026-09');
  const exito = antes.cobrancas.find((c) => c.tipo === 'exito' && c.oportunidade_id === rec);
  const avulsa = criarCobrancaAvulsa(db, emp, null, { cliente_id: cli, valor: 500, vencimento: '2026-09-12', descricao: 'cadastro sicaf' });
  atualizarCobranca(db, emp, avulsa, { pago_em: '2026-09-12' });
  for (const id of [mensal.id, exito.id, avulsa]) excluirCobranca(db, emp, id, null);
  const depois = resumoHonorarios(db, emp, { hoje });
  assert.equal(depois.cobrancas.some((c) => [mensal.id, exito.id, avulsa].includes(c.id)), false);
  assert.equal(depois.total.recebido, 0);
  assert.equal(depois.total.previsto, antes.total.previsto - 800 - exito.valor);
  // A geração seguinte não recria a mensalidade nem o êxito excluídos
  gerarCobrancas(db, emp, hoje);
  assert.equal(resumoHonorarios(db, emp, { hoje }).cobrancas.length, depois.cobrancas.length);
  assert.throws(() => excluirCobranca(db, emp, avulsa, null), /não encontrada/);
});
