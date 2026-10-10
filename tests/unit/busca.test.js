import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture, clonar } from '../helpers.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao } from '../../server/services/repositorio.js';
import { buscar } from '../../server/services/busca.js';
import { paraCsv, paraXlsx } from '../../server/services/exportacao.js';

// Base de TESTE: variações do registro real (identificadas como dados de teste)
function popular(db) {
  const base = fixture('pncp-contratacao-real');
  const objs = [
    ['Aquisição de medicamentos para farmácia básica', 'ES', 'Vila Velha', 150000, '2026-10-20T10:00:00'],
    ['Serviço de limpeza e conservação predial', 'ES', 'Vitória', 80000, '2026-10-12T10:00:00'],
    ['Aquisição de notebooks e computadores', 'SP', 'Campinas', 300000, '2026-10-30T10:00:00'],
    ['Reforma de unidade de saúde (obra de engenharia)', 'ES', 'Serra', null, '2026-10-15T10:00:00'],
    ['Gêneros alimentícios para merenda escolar', 'MG', 'Uberlândia', 50000, '2026-10-09T10:00:00'],
  ];
  objs.forEach(([obj, uf, mun, valor, enc], i) => {
    const r = clonar(base);
    r.numeroControlePNCP = `TESTE-${i}`; r.sequencialCompra = 100 + i; r.objetoCompra = obj;
    r.unidadeOrgao = { ...r.unidadeOrgao, ufSigla: uf, municipioNome: mun };
    r.valorTotalEstimado = valor; r.dataEncerramentoProposta = enc; r.dataPublicacaoPncp = `2026-10-0${i + 1}T08:00:00`;
    salvarLicitacao(db, normalizarPncp(r), 'pncp', r, '2026-10-10T12:00:00');
  });
}

test('busca textual sem acento, palavras obrigatórias e excluídas', () => {
  const db = bancoMemoria(); popular(db);
  assert.equal(buscar(db, { q: 'generos alimenticios' }).total, 1);
  assert.equal(buscar(db, { q: 'aquisicao' }).total, 2);
  assert.equal(buscar(db, { q: 'aquisicao', excluir: 'notebooks' }).total, 1);
  assert.equal(buscar(db, { excluir: 'aquisicao' }).total, 3);
  assert.equal(buscar(db, { obrigatorias: 'reforma saude' }).total, 1);
});

test('filtros combinados, visões, ordenação e paginação', () => {
  const db = bancoMemoria(); popular(db);
  const agora = '2026-10-10T12:00:00';
  assert.equal(buscar(db, { uf: 'ES' }, { agora }).total, 3);
  assert.equal(buscar(db, { uf: 'ES,SP', valor_min: 100000 }, { agora }).total, 2);
  assert.equal(buscar(db, { visao: 'abertas' }).total, 4);              // 1 com prazo encerrado
  assert.equal(buscar(db, { visao: 'em_disputa' }).total, 1);
  assert.equal(buscar(db, { segmento: 'Saúde' }).total, 1);
  const p1 = buscar(db, { tamanho: 2, pagina: 1, ordenar: 'valor_desc' });
  assert.equal(p1.paginas, 3);
  assert.equal(p1.dados[0].valor_estimado, 300000);
  const p3 = buscar(db, { tamanho: 2, pagina: 3, ordenar: 'valor_desc' });
  assert.equal(p3.dados.length, 1);
  assert.equal(p3.dados[0].valor_estimado, null);                      // sem valor vai para o fim
  assert.equal(buscar(db, { municipio: 'vila' }).total, 1);
});

test('exportação CSV (BOM, separador ;) e XLSX', async () => {
  const db = bancoMemoria(); popular(db);
  const linhas = buscar(db, {}).dados;
  const csv = paraCsv(linhas);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.trim().split('\r\n').length, 6);
  assert.match(csv, /Não informado/);   // valor nulo é rotulado, não vira 0
  const xlsx = await paraXlsx(linhas);
  assert.ok(xlsx.byteLength > 1000);
  assert.equal(Buffer.from(xlsx).subarray(0, 2).toString(), 'PK');
});
