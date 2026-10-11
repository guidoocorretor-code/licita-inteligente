import test from 'node:test';
import assert from 'node:assert/strict';
import { identificacaoGoverno } from '../../web/js/ui.js';

test('UASG e número saem do código "compra=" do link do Compras.gov.br', () => {
  const link = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=15842606001622026';
  assert.deepEqual(identificacaoGoverno({ link_origem: link }), { uasg: '158426', numero: '00162/2026', comprasgov: true });
});

test('sem link: UASG só quando o sistema é o Compras.gov.br; outro sistema fica só com o número', () => {
  assert.equal(identificacaoGoverno({ sistema_eletronico: 'comprasgov', unidade_codigo: '931396', numero_compra: '25', ano: 2026 }).uasg, '931396');
  const outro = identificacaoGoverno({ sistema_eletronico: 'bll', unidade_codigo: '1', numero_compra: '010/2026', ano: 2026 });
  assert.equal(outro.uasg, null);
  assert.equal(outro.numero, '010/2026');
  assert.deepEqual(identificacaoGoverno({}), { uasg: null, numero: null, comprasgov: false });
});
