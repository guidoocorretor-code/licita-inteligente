import test from 'node:test';
import assert from 'node:assert/strict';
import { consultarCnpj, deBrasilApi, deCnpjWs, portePadrao, responsavelProvavel, _limparCacheCnpj } from '../../server/services/cnpj.js';
import { _reiniciarLimitador } from '../../server/lib/http.js';

// Formatos de resposta das bases públicas (DADOS DE TESTE, empresa fictícia)
const BRASILAPI = {
  cnpj: '11222333000181', razao_social: 'ALFA COMERCIO DE INFORMATICA LTDA', nome_fantasia: 'ALFA INFO', uf: 'ES', municipio: 'VILA VELHA',
  ddd_telefone_1: '2733334444', ddd_telefone_2: '', email: 'CONTATO@ALFA.COM.BR', porte: 'MICRO EMPRESA', opcao_pelo_mei: false,
  descricao_situacao_cadastral: 'ATIVA', cnae_fiscal_descricao: 'Comércio varejista de equipamentos de informática',
  qsa: [{ nome_socio: 'MARIA SOCIA', qualificacao_socio: 'Sócio' }, { nome_socio: 'JOAO ADMIN', qualificacao_socio: 'Sócio-Administrador' }],
};
const CNPJWS = {
  razao_social: 'BETA SERVICOS LTDA', porte: { descricao: 'Empresa de Pequeno Porte' }, simples: { mei: 'Não' },
  socios: [{ nome: 'ANA TITULAR', qualificacao_socio: { descricao: 'Administrador' } }],
  estabelecimento: { cnpj: '11444777000161', nome_fantasia: null, email: 'beta@beta.com', ddd1: '27', telefone1: '999998888',
    estado: { sigla: 'ES' }, cidade: { nome: 'Vitória' }, situacao_cadastral: 'Baixada', atividade_principal: { descricao: 'Serviços' } },
};
const resposta = (status, corpo) => ({ ok: status < 300, status, headers: new Headers(), text: async () => JSON.stringify(corpo) });

test('normaliza BrasilAPI e CNPJ.ws', () => {
  const a = deBrasilApi(BRASILAPI);
  assert.equal(a.porte, 'ME'); assert.equal(a.telefone, '(27) 3333-4444'); assert.equal(a.email, 'contato@alfa.com.br');
  assert.equal(responsavelProvavel(a.socios).nome, 'JOAO ADMIN');
  const b = deCnpjWs(CNPJWS);
  assert.equal(b.porte, 'EPP'); assert.equal(b.telefone, '(27) 99999-8888'); assert.equal(b.municipio, 'Vitória'); assert.equal(b.situacao, 'Baixada');
  assert.equal(portePadrao('DEMAIS'), 'Demais'); assert.equal(portePadrao('x', true), 'MEI'); assert.equal(portePadrao(''), null);
});

test('consulta usa a segunda fonte quando a primeira falha, e 404 vira "não encontrado"', async () => {
  process.env.HTTP_MIN_INTERVAL_MS = '0'; _reiniciarLimitador(); _limparCacheCnpj();
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); return u.includes('brasilapi') ? resposta(503, {}) : resposta(200, CNPJWS); };
  const r = await consultarCnpj('11.444.777/0001-61', { fetchImpl });
  assert.equal(r.fonte, 'CNPJ.ws (pública)'); assert.equal(r.responsavel.nome, 'ANA TITULAR');
  assert.ok(urls.some((u) => u.includes('brasilapi')));
  _limparCacheCnpj();
  await assert.rejects(consultarCnpj('11222333000181', { fetchImpl: async () => resposta(404, { message: 'not found' }) }), /não encontrado/);
  await assert.rejects(consultarCnpj('11222333000182'), /CNPJ inválido/);
});
