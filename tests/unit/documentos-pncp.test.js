// Arquivos do edital via servidor: endereço só do PNCP, nome do arquivo e página de falha (sem tela em branco).
import test from 'node:test';
import assert from 'node:assert/strict';
import { urlDoDocumento, nomeDoArquivo, buscarArquivo, paginaFalha } from '../../server/services/documentos-pncp.js';

const lic = { orgao_cnpj: '00394452000103', ano: 2026, sequencial: 21859 };
test('endereço do arquivo: o do PNCP, http vira https, monta pelo identificador e recusa outro host', () => {
  assert.equal(urlDoDocumento(lic, { url: 'http://pncp.gov.br/pncp-api/v1/orgaos/x/compras/2026/1/arquivos/2', sequencial: 2 }), 'https://pncp.gov.br/pncp-api/v1/orgaos/x/compras/2026/1/arquivos/2');
  assert.equal(urlDoDocumento(lic, { url: '', sequencial: 3 }), 'https://pncp.gov.br/pncp-api/v1/orgaos/00394452000103/compras/2026/21859/arquivos/3');
  assert.equal(urlDoDocumento(lic, { url: 'https://site-estranho.com/a.pdf', sequencial: 4 }), 'https://pncp.gov.br/pncp-api/v1/orgaos/00394452000103/compras/2026/21859/arquivos/4');
  assert.equal(urlDoDocumento({}, { url: 'https://site-estranho.com/a.pdf', sequencial: 4 }), null);
});

test('nome do arquivo: o do PNCP ou o título com extensão', () => {
  assert.equal(nomeDoArquivo({}, 'attachment; filename="Termo de Referência.pdf"', 'application/pdf'), 'Termo de Referencia.pdf');
  assert.equal(nomeDoArquivo({ titulo: 'Aviso de Contratação Direta 30/2026' }, null, 'application/pdf'), 'Aviso de Contratacao Direta 30 2026.pdf');
});

test('PNCP fora do ar ou arquivo removido: motivo claro', async () => {
  const r404 = await buscarArquivo('https://pncp.gov.br/x', { fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(r404.ok, false); assert.match(r404.motivo, /não existe mais/);
  const rede = await buscarArquivo('https://pncp.gov.br/x', { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.match(rede.motivo, /Não foi possível/);
  const ok = await buscarArquivo('https://pncp.gov.br/x', { fetchImpl: async () => ({ ok: true, status: 200 }) });
  assert.equal(ok.ok, true); ok.fim();
  const html = paginaFalha({ motivo: 'O PNCP respondeu com erro 500.', doc: { tipo: 'Edital', titulo: '<b>x' }, linkPncp: 'https://pncp.gov.br/app/editais/1/2026/3', urlArquivo: 'https://pncp.gov.br/x' });
  assert.match(html, /página oficial do PNCP/); assert.match(html, /&lt;b&gt;x/);
});
