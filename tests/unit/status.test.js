import test from 'node:test';
import assert from 'node:assert/strict';
import { classificarStatus } from '../../server/services/status.js';

const base = { situacao_oficial_id: 1, data_abertura_proposta: '2026-10-01T09:00:00', data_encerramento_proposta: '2026-10-23T13:30:00' };
const it = (...ids) => ids.map((id) => ({ situacao_item_id: id }));

test('situação oficial prevalece', () => {
  assert.equal(classificarStatus({ ...base, situacao_oficial_id: 2 }, null, '2026-10-10T00:00:00').status, 'revogada');
  assert.equal(classificarStatus({ ...base, situacao_oficial_id: 3 }, null, '2026-10-10T00:00:00').status, 'anulada');
  assert.equal(classificarStatus({ ...base, situacao_oficial_id: 4 }, it(4, 4), '2026-10-10T00:00:00').status, 'suspensa');
});

test('classificação por datas', () => {
  assert.equal(classificarStatus(base, null, '2026-09-30T10:00:00').status, 'aguardando_propostas');
  assert.equal(classificarStatus(base, null, '2026-10-10T10:00:00').status, 'aberta');
  assert.equal(classificarStatus({ situacao_oficial_id: 1 }, null, '2026-10-10T10:00:00').status, 'indeterminada');
});

test('prazo encerrado SEM evidência NÃO vira deserta', () => {
  const r = classificarStatus(base, null, '2026-11-01T00:00:00');
  assert.equal(r.status, 'prazo_encerrado');
  const r2 = classificarStatus(base, [], '2026-11-01T00:00:00'); // nenhum item retornado
  assert.equal(r2.status, 'prazo_encerrado');
});

test('deserta/fracassada somente com situação oficial dos itens', () => {
  assert.equal(classificarStatus(base, it(4, 4), '2026-11-01T00:00:00').status, 'deserta');
  assert.equal(classificarStatus(base, it(5), '2026-11-01T00:00:00').status, 'fracassada');
  assert.equal(classificarStatus(base, it(4, 5), '2026-11-01T00:00:00').status, 'deserta_fracassada');
  assert.equal(classificarStatus(base, it(2, 4), '2026-11-01T00:00:00').status, 'encerrada');
  assert.equal(classificarStatus(base, it(2, 1), '2026-11-01T00:00:00').status, 'resultado_parcial');
  assert.equal(classificarStatus(base, it(1, 1), '2026-11-01T00:00:00').status, 'prazo_encerrado');
  assert.equal(classificarStatus(base, it(1, 1), '2026-10-10T00:00:00').status, 'aberta');
  assert.equal(classificarStatus(base, it(3, 3), '2026-11-01T00:00:00').status, 'encerrada_sem_itens_validos');
});

test('fontes sem código: usa texto da situação', () => {
  assert.equal(classificarStatus({ situacao_oficial_nome: 'Licitação Deserta' }, null, '2026-11-01T00:00:00').status, 'deserta');
  assert.equal(classificarStatus({ situacao_oficial_nome: 'Publicado' }, null, '2026-11-01T00:00:00').status, 'indeterminada');
});

test('em disputa só no dia em que o prazo de propostas encerra (sessão do dia); depois, aguardando resultado', () => {
  assert.equal(classificarStatus(base, null, '2026-10-23T13:29:59').status, 'aberta');
  assert.equal(classificarStatus(base, null, '2026-10-23T13:30:00').status, 'em_disputa');
  assert.equal(classificarStatus(base, it(1, 1), '2026-10-23T18:00:00').status, 'em_disputa');
  assert.equal(classificarStatus(base, null, '2026-10-24T08:00:00').status, 'prazo_encerrado');
  // licitação antiga sem resultado na fonte nunca aparece como "em disputa"
  assert.equal(classificarStatus({ ...base, data_encerramento_proposta: '2022-10-10T09:00:00' }, it(1), '2026-10-12T10:00:00').status, 'prazo_encerrado');
});
