import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarPncp, normalizarCompras14133, normalizarItemPncp, normalizarDocumentoPncp, extrairRegimeLegal, dataIso } from '../../server/services/normalizacao.js';
import { fixture } from '../helpers.js';

test('normaliza registro real do PNCP sem inventar campos', () => {
  const c = normalizarPncp(fixture('pncp-contratacao-real'));
  assert.equal(c.chave_canonica, 'pncp:28127603014802-1-000003/2026');
  assert.equal(c.orgao_cnpj, '28127603014802');
  assert.equal(c.uf, 'ES');
  assert.equal(c.municipio, 'Vitória');
  assert.equal(c.modalidade_nome, 'Pregão - Eletrônico');
  assert.equal(c.regime_legal, 'Lei 14.133/2021');            // vem do amparo legal, não do texto livre
  assert.equal(c.plataforma_origem, 'Compras.gov.br');
  assert.equal(c.valor_estimado, 0);                           // zero informado pela fonte ≠ não informado
  assert.equal(c.valor_estimado_situacao, 'informado');
  assert.equal(c.valor_homologado, null);                      // ausente => null
  assert.equal(c.data_sessao, null);                           // PNCP não informa: não inventamos
  assert.equal(c.link_pncp, 'https://pncp.gov.br/app/editais/28127603014802/2026/3');
  assert.equal(c.data_encerramento_proposta, '2026-10-23T13:30:00');
});

test('normaliza registro real do Compras.gov.br 14.133 com mesma chave do PNCP', () => {
  const c = normalizarCompras14133(fixture('compras14133-real'));
  assert.equal(c.chave_canonica, 'pncp:05055128000176-1-000108/2026');
  assert.equal(c.modalidade_id, 8);
  assert.equal(c.esfera, 'F');
  assert.equal(c.valor_estimado, 6351.15);
  assert.equal(c.valor_homologado, 6195.2);
  assert.equal(c.codigo_ibge, '2512101');
});

test('item com orçamento sigiloso não expõe valor 0 como estimativa', () => {
  const i = normalizarItemPncp(fixture('pncp-item-real'));
  assert.equal(i.orcamento_sigiloso, 1);
  assert.equal(i.valor_unitario_estimado, null);
  assert.equal(i.situacao_item_id, 1);
  assert.equal(i.material_servico, 'Serviço');
});

test('documento real é normalizado com URL', () => {
  const d = normalizarDocumentoPncp(fixture('pncp-arquivo-real'));
  assert.equal(d.sequencial, 2);
  assert.equal(d.tipo, 'Edital');
  assert.match(d.url, /^https:\/\/pncp\.gov\.br\//);
});

test('extração de regime legal e datas', () => {
  assert.equal(extrairRegimeLegal('Lei nº 13303/2016, art. 29'), 'Lei 13.303/2016');
  assert.equal(extrairRegimeLegal('sem lei'), null);
  assert.equal(dataIso('2025-01-24'), '2025-01-24T00:00:00');
  assert.equal(dataIso(''), null);
  assert.equal(dataIso('20261010'), '2026-10-10T00:00:00');
});
