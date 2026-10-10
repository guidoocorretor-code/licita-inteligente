// Testes de integração REAIS contra as APIs oficiais. Não usam simulação.
// Se a rede não alcançar a fonte, o teste FALHA (não é marcado como aprovado).
// Execute: NODE_USE_ENV_PROXY=1 npm run test:integration   (NODE_USE_ENV_PROXY só é necessário atrás de proxy)
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, setDb } from '../../server/db/index.js';
import { conectorPncp, buscarItens, buscarDocumentos } from '../../server/connectors/pncp.js';
import { conectorCompras14133, conectorComprasLegado } from '../../server/connectors/comprasgov.js';
import { sincronizarFonte } from '../../server/services/sync.js';

test('PNCP: consulta real de contratações publicadas', async () => {
  const r = await conectorPncp.testar();
  assert.equal(r.ok, true);
  assert.ok(r.totalRegistros >= 0);
});

test('PNCP: itens e documentos reais de uma contratação conhecida', async () => {
  const itens = await buscarItens('28127603014802', 2026, 3);
  assert.ok(itens.length >= 1);
  assert.ok(itens[0].descricao);
  const docs = await buscarDocumentos('28127603014802', 2026, 3);
  assert.ok(docs.length >= 1);
});

test('PNCP: sincronização real (abertas no ES, pregão eletrônico) persiste e deduplica', async () => {
  const db = abrirBanco(':memory:'); setDb(db);
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ ufs: ['ES'], modalidades: [6], maxPaginasPorConsulta: 2, sincronizarDetalhes: true }));
  const r1 = await sincronizarFonte(db, 'pncp', { modo: 'abertas', limiteDetalhes: 5 });
  assert.notEqual(r1.status, 'erro', r1.mensagem);
  assert.ok(r1.inseridos > 0);
  const n = db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n;
  const r2 = await sincronizarFonte(db, 'pncp', { modo: 'abertas', limiteDetalhes: 0 });
  assert.equal(r2.inseridos, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n, n);
});

test('Compras.gov.br 14.133: consulta real', async () => {
  const r = await conectorCompras14133.testar();
  assert.equal(r.ok, true);
});

test('Compras.gov.br legado: consulta real', async () => {
  const r = await conectorComprasLegado.testar();
  assert.equal(r.ok, true);
});
