import test from 'node:test';
import assert from 'node:assert/strict';
import { aliquotaSimples, calcularTributos } from '../../web/js/tributos.js';

test('Simples Nacional: alíquota efetiva = (RBT12 × nominal − dedução) ÷ RBT12', () => {
  assert.equal(aliquotaSimples('I', 100000).aliquota, 4);               // 1ª faixa = nominal
  assert.equal(aliquotaSimples('I', 500000).aliquota, 6.73);            // (500.000 × 9,5% − 13.860) ÷ 500.000
  assert.equal(aliquotaSimples('I', 2000000).aliquota, 9.94);           // (2.000.000 × 14,3% − 87.300) ÷ 2.000.000 = 9,935
  assert.equal(aliquotaSimples('III', 360000).aliquota, 8.6);           // limite da 2ª faixa: (360.000 × 11,2% − 9.360) ÷ 360.000
  assert.equal(aliquotaSimples('I', '').faixa, 1);                      // empresa nova: 1ª faixa, com aviso
  assert.match(aliquotaSimples('I', '').aviso, /1ª faixa/);
  assert.match(aliquotaSimples('I', 5000000).erro, /sai do Simples/);
  assert.match(calcularTributos({ regime: 'simples', anexo: 'I', rbt12: 4000000 }).aviso, /sublimite/);
});

test('Lucro Presumido e Real: soma das partes, sem inventar ICMS', () => {
  const p = calcularTributos({ regime: 'presumido', atividade: 'comercio', icms: 17 });
  assert.equal(p.aliquota, 22.93);                                      // 0,65 + 3 + 1,2 + 1,08 + 17
  const semIcms = calcularTributos({ regime: 'presumido', atividade: 'comercio' });
  assert.equal(semIcms.aliquota, 5.93);
  assert.match(semIcms.aviso, /ICMS/);
  assert.equal(calcularTributos({ regime: 'presumido', atividade: 'servicos', iss: 5 }).aliquota, 16.33); // 3,65 + 4,8 + 2,88 + 5
  assert.equal(calcularTributos({ regime: 'real', icms: 12 }).aliquota, 21.25);   // 9,25 + 12
  assert.equal(calcularTributos({ regime: 'real', pis_cofins: 4, ir_csll: 3 }).aliquota, 7);
  assert.equal(calcularTributos({ regime: 'manual', aliquota: 8 }).aliquota, 8);
  assert.ok(calcularTributos({}).erro);
});
