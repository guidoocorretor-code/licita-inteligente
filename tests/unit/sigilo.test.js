import test from 'node:test';
import assert from 'node:assert/strict';
import { trechosSensiveis, destacarTrechos, removerTrechos } from '../../web/js/sigilo.js';

// Descrição real de edital (obra de pontes, Bernardo Sayão-TO) que cita município, prefeitura e convênio
const PONTES = 'Contratação de empresa especializada para execução de obra de construção de pontes em concreto armado no Município de Bernardo Sayão - TO, compreendendo a construção de uma ponte na região da Gleba M, com extensão de 6,00 m, para atender as demandas da Prefeitura Municipal de Bernardo Sayão - TO. Convenio transferegov.br nº 980858/2025.';

test('acha órgão, município e convênio na descrição do item', () => {
  const t = trechosSensiveis(PONTES, { municipio: 'Bernardo Sayão' }).map((x) => x.texto);
  assert.deepEqual(t, ['Município de Bernardo Sayão - TO', 'Prefeitura Municipal de Bernardo Sayão - TO', 'Convenio transferegov.br nº 980858/2025']);
});

test('negrito no WhatsApp e remoção que deixa o texto legível', () => {
  const t = trechosSensiveis(PONTES, {});
  assert.match(destacarTrechos(PONTES, t), /demandas da \*Prefeitura Municipal de Bernardo Sayão - TO\*\. \*Convenio/);
  const limpo = removerTrechos(PONTES, t);
  assert.ok(!/Sayão|Prefeitura|Convenio|980858/.test(limpo));
  assert.match(limpo, /pontes em concreto armado, compreendendo/);
  assert.match(limpo, /para atender as demandas\.$/);
});

test('processo, secretaria, CNPJ e nome da cidade sem acento', () => {
  const d = 'Notebook i5 16GB conforme Termo de Referência, Pregão Eletrônico nº 12/2026, para a Secretaria Municipal de Saúde de VILA VELHA, CNPJ 27.165.554/0001-03.';
  const t = trechosSensiveis(d, { municipio: 'Vila Velha' }).map((x) => x.texto);
  assert.ok(t.includes('Pregão Eletrônico nº 12/2026'));
  assert.ok(t.some((x) => x.startsWith('Secretaria Municipal de Saúde')));
  assert.ok(t.some((x) => x.includes('VILA VELHA')));
  assert.ok(t.includes('CNPJ 27.165.554/0001-03'));
  assert.equal(removerTrechos(d, trechosSensiveis(d, { municipio: 'Vila Velha' })), 'Notebook i5 16GB conforme Termo de Referência.');
});

test('descrição comum fica intacta', () => {
  assert.deepEqual(trechosSensiveis('Papel A4 75g, caixa com 10 resmas. Entrega no Município.', {}), []);
  assert.deepEqual(trechosSensiveis('', {}), []);
});
