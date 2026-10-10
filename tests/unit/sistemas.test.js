import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { sistemaDe, classificarSistemasPendentes, catalogoSistemas } from '../../server/services/sistemas.js';
import { buscar as buscarLicitacoes } from '../../server/services/busca.js';

test('identifica o sistema pelo nome publicado no PNCP e pelo link', () => {
  assert.equal(sistemaDe('Licitações-E BB', null), 'licitacoes_e');
  assert.equal(sistemaDe('BLL Compras', null), 'bll');
  assert.equal(sistemaDe('Bolsa Nacional De Compras - BNC', null), 'bnc');
  assert.equal(sistemaDe('Novo BBMNET Licitações', null), 'bbmnet');
  assert.equal(sistemaDe('Compras.gov.br', null), 'comprasgov');
  assert.equal(sistemaDe('Licitanet Licitações Eletrônicas LTDA', null), 'licitanet');
  assert.equal(sistemaDe('Portal de Compras Públicas do Estado do Rio de Janeiro', null), 'compras_rj'); // não é o PCP privado
  assert.equal(sistemaDe('Portal de Compras Públicas', null), 'pcp');
  // ERP da prefeitura: o link mostra onde é a disputa
  assert.equal(sistemaDe('E & L PRODUCOES DE SOFTWARE LTDA', 'https://www.portaldecompraspublicas.com.br/processos/es/x'), 'pcp');
  assert.equal(sistemaDe('AZ INFORMATICA LTDA', 'https://transparencia.municipio.gov.br/x'), 'outro');
  assert.equal(sistemaDe(null, null), null);
  // Só marca "pago"/"gratuito" com fonte
  for (const s of Object.values(catalogoSistemas())) if (s.custo !== 'nao_verificado') assert.ok(s.fonte, s.nome);
});

test('classifica licitações antigas e filtra por sistema e por custo', () => {
  const db = bancoMemoria();
  const ins = db.prepare(`INSERT INTO licitacoes (chave_canonica, objeto, plataforma_origem, link_origem, status_calculado) VALUES (?,?,?,?, 'aberta')`);
  ins.run('t:1', 'mouse óptico', 'Licitações-E BB', null);
  ins.run('t:2', 'mouse sem fio', 'Compras.gov.br', null);
  ins.run('t:3', 'mouse gamer', 'Betha Sistemas', 'https://bll.org.br/processo/1');
  assert.equal(classificarSistemasPendentes(db), 3);
  assert.equal(classificarSistemasPendentes(db), 0);
  const sis = (id) => db.prepare('SELECT sistema_eletronico s FROM licitacoes WHERE chave_canonica=?').get(id).s;
  assert.deepEqual([sis('t:1'), sis('t:2'), sis('t:3')], ['licitacoes_e', 'comprasgov', 'bll']);
  assert.equal(buscarLicitacoes(db, { sistema: 'bll', visao: '' }).total, 1);
  assert.equal(buscarLicitacoes(db, { sistema_custo: 'pago', visao: '' }).total, 2);
  assert.equal(buscarLicitacoes(db, { sistema_custo: 'gratuito', visao: '' }).total, 1);
});
