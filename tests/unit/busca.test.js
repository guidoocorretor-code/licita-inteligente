import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture, clonar } from '../helpers.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { normalizarItemPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens, salvarDocumentos } from '../../server/services/repositorio.js';
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

test('palavra no singular acha o plural e termos em -ção acham -ções', () => {
  const db = bancoMemoria(); popular(db);
  assert.equal(buscar(db, { q: 'medicamento' }).total, 1);           // objeto diz "medicamentos"
  assert.equal(buscar(db, { q: 'computador' }).total, 1);
  assert.equal(buscar(db, { q: 'conservações' }).total, 1);          // objeto diz "conservação"
  assert.equal(buscar(db, { excluir: 'aquisições' }).total, 3);
});

test('filtros por itens, documentos, regime legal, ME/EPP e datas de abertura', () => {
  const db = bancoMemoria(); popular(db);
  const ids = db.prepare('SELECT id FROM licitacoes ORDER BY id').all().map((r) => r.id);
  const item = { ...normalizarItemPncp(fixture('pncp-item-real')), catalogo_codigo: '12345' };
  salvarItens(db, ids[0], [item], 'pncp', '2026-10-10T12:00:00');                       // item de serviço
  salvarItens(db, ids[1], [{ ...item, material_servico: 'Material', catalogo_codigo: '999' }], 'pncp', '2026-10-10T12:00:00');
  salvarDocumentos(db, ids[2], [{ sequencial: 1, url: 'https://x/1', tipo: 'Edital' }]);
  db.prepare('UPDATE licitacoes SET me_epp_exclusivo = 1 WHERE id = ?').run(ids[3]);
  assert.equal(buscar(db, { tipo_item: 'Serviço' }).total, 1);
  assert.equal(buscar(db, { tipo_item: 'Material' }).total, 1);
  assert.equal(buscar(db, { catalogo: '12345' }).total, 1);
  assert.equal(buscar(db, { com_documentos: '1' }).total, 1);
  assert.equal(buscar(db, { me_epp: '1' }).total, 1);
  assert.equal(buscar(db, { regime_legal: 'Lei 14.133/2021' }).total, 5);
  assert.equal(buscar(db, { regime_legal: 'Lei 8.666/1993' }).total, 0);
  assert.equal(buscar(db, { abertura_ate: '2026-09-30' }).total, 0);
  assert.equal(buscar(db, { abertura_de: '2026-10-01', abertura_ate: '2026-10-01' }).total, 5);
  const agora = '2026-10-10T12:00:00';
  assert.equal(buscar(db, { prazo_min_dias: 9 }, { agora }).total, 2);   // encerram em 20/10 e 30/10
  assert.equal(buscar(db, { sessao_proxima: '1' }, { agora }).total, 2); // encerram em 12/10 e 15/10
});

test('filtros combinados, visões, ordenação e paginação', () => {
  const db = bancoMemoria(); popular(db);
  const agora = '2026-10-10T12:00:00';
  assert.equal(buscar(db, { uf: 'ES' }, { agora }).total, 3);
  assert.equal(buscar(db, { uf: 'ES,SP', valor_min: 100000 }, { agora }).total, 2);
  assert.equal(buscar(db, { visao: 'abertas' }).total, 4);              // 1 com prazo encerrado
  assert.equal(buscar(db, { visao: 'aguardando_resultado' }).total, 1); // prazo encerrado em outro dia
  assert.equal(buscar(db, { visao: 'em_disputa' }).total, 0);
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

test('períodos: abertura da sessão nos próximos 7/15/30 dias e publicadas nos últimos N dias', async () => {
  const { montarFiltro } = await import('../../server/services/busca.js');
  const db = bancoMemoria(); popular(db);
  const agora = '2026-10-10T12:00:00';
  const conta = (f) => { const { where, params } = montarFiltro(f, agora); return db.prepare(`SELECT COUNT(*) n FROM licitacoes l ${where}`).get(...params).n; };
  assert.equal(conta({ sessao_dias: '7' }), 2);    // 12/10 e 15/10 (09/10 já passou)
  assert.equal(conta({ sessao_dias: '15' }), 3);   // + 20/10
  assert.equal(conta({ sessao_dias: '30' }), 4);   // + 30/10
  assert.equal(conta({ sessao_proxima: '1' }), 2); // link antigo continua valendo 7 dias
  assert.equal(conta({ sessao_dias: '9' }), 5);    // período fora da lista é ignorado
  assert.equal(conta({ publicadas_dias: '7' }), 3); // publicadas desde 03/10
});

test('credenciamentos: esconder, mostrar só eles e marcar no resultado', () => {
  const db = bancoMemoria(); popular(db);
  const ids = db.prepare('SELECT id FROM licitacoes ORDER BY id').all().map((r) => r.id);
  db.prepare("UPDATE licitacoes SET modalidade_id = 12, modalidade_nome = 'Credenciamento' WHERE id = ?").run(ids[0]);
  // Publicado como inexigibilidade, mas com amparo no art. 79 da Lei 14.133 (credenciamento)
  db.prepare("UPDATE licitacoes SET modalidade_id = 9, amparo_legal = 'Lei 14.133/2021, Art. 79, II' WHERE id = ?").run(ids[1]);
  // Art. 74 não é credenciamento; amparo nulo não pode sumir ao esconder
  db.prepare("UPDATE licitacoes SET modalidade_id = 9, amparo_legal = 'Lei 14.133/2021, Art. 74, I' WHERE id = ?").run(ids[2]);
  db.prepare('UPDATE licitacoes SET amparo_legal = NULL WHERE id = ?').run(ids[3]);
  assert.equal(buscar(db, { credenciamento: 'so' }).total, 2);
  assert.equal(buscar(db, { credenciamento: 'ocultar' }).total, 3);
  assert.equal(buscar(db, {}).total, 5);
  const marcados = buscar(db, {}).dados.filter((d) => d.credenciamento === 1).map((d) => d.id).sort();
  assert.deepEqual(marcados, [ids[0], ids[1]].sort());
});

test('Grande Vitória, várias modalidades e tipo de disputa', () => {
  const db = bancoMemoria(); popular(db);
  const ids = db.prepare('SELECT id FROM licitacoes ORDER BY id').all().map((r) => r.id);
  // "Viana" do MA não pode entrar na Grande Vitória
  db.prepare("UPDATE licitacoes SET municipio = 'Viana', uf = 'MA' WHERE id = ?").run(ids[4]);
  assert.equal(buscar(db, { municipio: 'Grande Vitória' }).total, 3);       // Vila Velha, Vitória, Serra (ES)
  assert.equal(buscar(db, { municipio: 'grande vitoria' }).total, 3);
  assert.equal(buscar(db, { municipio: 'Vila Velha' }).total, 1);           // texto comum continua por trecho
  db.prepare('UPDATE licitacoes SET modalidade_id = 8 WHERE id = ?').run(ids[0]);
  db.prepare('UPDATE licitacoes SET modalidade_id = 4 WHERE id = ?').run(ids[1]);
  db.prepare('UPDATE licitacoes SET modalidade_id = 6 WHERE id IN (?, ?, ?)').run(ids[2], ids[3], ids[4]);
  assert.equal(buscar(db, { modalidade: '8,4' }).total, 2);
  assert.equal(buscar(db, { modalidade: '6' }).total, 3);
  const modos = ['Aberto', 'Aberto-Fechado', 'Fechado-Aberto', 'Dispensa Com Disputa', null];
  ids.forEach((id, i) => db.prepare('UPDATE licitacoes SET modo_disputa_nome = ? WHERE id = ?').run(modos[i], id));
  assert.equal(buscar(db, { modo_disputa: 'Aberto' }).total, 1);
  assert.equal(buscar(db, { modo_disputa: 'Aberto-Fechado,Fechado-Aberto' }).total, 2);
  assert.equal(buscar(db, { modo_disputa: 'Dispensa Com Disputa' }).total, 1);
  assert.equal(buscar(db, { modo_disputa: 'Qualquer coisa' }).total, 5);    // valor fora da lista é ignorado
});

test('poucos resultados: quantas viriam sem cada filtro', async () => {
  const { semCadaFiltro } = await import('../../server/services/busca.js');
  const db = bancoMemoria(); popular(db);
  const f = { uf: 'ES', municipio: 'Vila Velha', ordenar: 'valor_desc', pagina: '2' };
  assert.equal(buscar(db, f).total, 1);
  assert.deepEqual(semCadaFiltro(db, f), { uf: 1, municipio: 3 });   // paginação e ordenação não contam
});
