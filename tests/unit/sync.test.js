import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture, clonar, fetchFalso } from '../helpers.js';
import { sincronizarFonte, reprocessarFalhas, testarFonte, sincronizarDetalhesDe, baixarFalhasJaResolvidas } from '../../server/services/sync.js';
import { _reiniciarLimitador, getJson } from '../../server/lib/http.js';

process.env.HTTP_MIN_INTERVAL_MS = '0';
process.env.HTTP_BASE_ESPERA_MS = '1';
process.env.HTTP_PENALIDADE_429_MS = '0';

// Simula a API do PNCP com o formato real de resposta (2 páginas + itens + arquivos)
function simuladorPncp({ falharDetalhe = false } = {}) {
  const reg = fixture('pncp-contratacao-real');
  const pag = (n) => Array.from({ length: n }, (_, i) => { const r = clonar(reg); r.numeroControlePNCP = `${reg.numeroControlePNCP}-${n}-${i}`; r.sequencialCompra = n * 100 + i; return r; });
  return fetchFalso((url) => {
    if (url.includes('/contratacoes/atualizacao')) {
      const p = Number(new URL(url).searchParams.get('pagina'));
      if (p === 1) return { status: 200, body: { data: pag(50), totalRegistros: 53, totalPaginas: 2, numeroPagina: 1, paginasRestantes: 1, empty: false } };
      return { status: 200, body: { data: pag(3), totalRegistros: 53, totalPaginas: 2, numeroPagina: 2, paginasRestantes: 0, empty: false } };
    }
    if (url.includes('/itens')) return falharDetalhe ? { status: 500, body: 'erro' } : { status: 200, body: [fixture('pncp-item-real')] };
    if (url.includes('/arquivos')) return { status: 200, body: [fixture('pncp-arquivo-real')] };
    return { status: 404, body: '' };
  });
}

test('sincronização PNCP: paginação, persistência, detalhes, cursor e log', async () => {
  const db = bancoMemoria();
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ modalidades: [6], diasRetroativos: 1, sincronizarDetalhes: true }));
  const fetchImpl = simuladorPncp();
  const r = await sincronizarFonte(db, 'pncp', { fetchImpl, agora: new Date('2026-10-10T15:00:00Z') });
  assert.equal(r.status, 'sucesso');
  assert.equal(r.lidos, 53);
  assert.equal(r.inseridos, 53);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n, 53);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacao_itens').get().n, 53);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacao_documentos').get().n, 53);
  const f = db.prepare("SELECT * FROM fontes WHERE codigo='pncp'").get();
  assert.equal(f.situacao_conexao, 'ok');
  assert.equal(f.registros_importados, 53);
  assert.deepEqual(JSON.parse(f.cursor_json), { 'BR:6': '20261010' });
  assert.ok(fetchImpl.chamadas[0].includes('dataInicial=20261009'));
  assert.ok(fetchImpl.chamadas[0].includes('tamanhoPagina=50'));
  // segunda execução: usa o cursor e não duplica
  const r2 = await sincronizarFonte(db, 'pncp', { fetchImpl: simuladorPncp(), agora: new Date('2026-10-10T16:00:00Z') });
  assert.equal(r2.inseridos, 0);
  assert.equal(r2.inalterados, 53);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n, 53);
});

test('API indisponível: execução registrada como erro, cursor não avança, nada é inventado', async () => {
  const db = bancoMemoria();
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ modalidades: [6] }));
  const bloqueio = Object.assign(new TypeError('fetch failed'), { cause: new Error('CONNECT tunnel failed, response 403') });
  const r = await sincronizarFonte(db, 'pncp', { fetchImpl: fetchFalso(() => bloqueio) });
  assert.equal(r.status, 'erro');
  const f = db.prepare("SELECT * FROM fontes WHERE codigo='pncp'").get();
  assert.equal(f.situacao_conexao, 'bloqueada_rede');
  assert.equal(f.cursor_json, '{}');
  assert.equal(f.ultima_sincronizacao_ok, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n, 0);
  const t = await testarFonte(db, 'pncp', { fetchImpl: fetchFalso(() => bloqueio) });
  assert.equal(t.ok, false);
  assert.equal(t.situacao, 'bloqueada_rede');
});

test('falhas em detalhes ficam registradas e podem ser reprocessadas', async () => {
  const db = bancoMemoria();
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ modalidades: [6], sincronizarDetalhes: true }));
  const r = await sincronizarFonte(db, 'pncp', { fetchImpl: simuladorPncp({ falharDetalhe: true }), limiteDetalhes: 3 });
  assert.equal(r.status, 'parcial');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_falhas WHERE resolvida=0').get().n, 3);
  const rp = await reprocessarFalhas(db, 'pncp', { fetchImpl: simuladorPncp() });
  assert.equal(rp.reprocessadas, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_falhas WHERE resolvida=0').get().n, 0);
});

test('falha de itens some da contagem quando os itens chegam depois por outro caminho', async () => {
  const db = bancoMemoria();
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ modalidades: [6], sincronizarDetalhes: true }));
  await sincronizarFonte(db, 'pncp', { fetchImpl: simuladorPncp({ falharDetalhe: true }), limiteDetalhes: 3 });
  const pend = () => db.prepare('SELECT COUNT(*) n FROM sync_falhas WHERE resolvida=0').get().n;
  assert.equal(pend(), 3);
  // Download contínuo/manual traz os itens de uma delas: a falha correspondente deixa de ser pendência
  const id = JSON.parse(db.prepare('SELECT payload_json FROM sync_falhas LIMIT 1').get().payload_json).licitacao_id;
  await sincronizarDetalhesDe(db, id, { fetchImpl: simuladorPncp() });
  assert.equal(pend(), 2);
  // Falhas antigas (antes desta correção) cujos itens já estão na base são baixadas de uma vez
  const outro = JSON.parse(db.prepare('SELECT payload_json FROM sync_falhas WHERE resolvida=0 LIMIT 1').get().payload_json).licitacao_id;
  db.prepare("UPDATE licitacoes SET detalhes_sincronizados_em=datetime('now') WHERE id=?").run(outro);
  assert.equal(baixarFalhasJaResolvidas(db), 1);
  assert.equal(pend(), 1);
});

test('cliente HTTP: repete em 5xx/429 com espera e não repete em 4xx', async () => {
  let n = 0;
  const f1 = fetchFalso(() => (++n < 3 ? { status: 503, body: 'x' } : { status: 200, body: { ok: 1 } }));
  const r = await getJson('https://exemplo.gov.br/a', { fetchImpl: f1, baseEsperaMs: 1 });
  assert.deepEqual(r.dados, { ok: 1 });
  assert.equal(f1.chamadas.length, 3);
  const f2 = fetchFalso(() => ({ status: 400, body: 'parâmetro inválido' }));
  await assert.rejects(getJson('https://exemplo.gov.br/b', { fetchImpl: f2, baseEsperaMs: 1 }), /HTTP 400/);
  assert.equal(f2.chamadas.length, 1);
  const f3 = fetchFalso(() => ({ status: 204 }));
  assert.equal((await getJson('https://exemplo.gov.br/c', { fetchImpl: f3 })).vazio, true);
});

test('cliente HTTP: HTTP 429 espera mais e tenta além do limite de falhas comuns', async () => {
  _reiniciarLimitador();
  let n = 0;
  const f = fetchFalso(() => (++n <= 4 ? { status: 429, body: 'Too Many Requests' } : { status: 200, body: { ok: 1 } }));
  const inicio = Date.now();
  const r = await getJson('https://limite.gov.br/a', { fetchImpl: f, baseEsperaMs: 1, espera429Ms: 20 });
  assert.deepEqual(r.dados, { ok: 1 });
  assert.equal(f.chamadas.length, 5, '4 respostas 429 não esgotam as tentativas');
  assert.ok(Date.now() - inicio >= 20 + 40 + 80 + 160, 'espera progressiva no 429');
  _reiniciarLimitador();
  const sempre = fetchFalso(() => ({ status: 429, body: 'x' }));
  await assert.rejects(getJson('https://limite.gov.br/b', { fetchImpl: sempre, espera429Ms: 1, tentativas429: 3 }), /HTTP 429/);
  assert.equal(sempre.chamadas.length, 3);
  _reiniciarLimitador();
});

test('consulta cortada pelo limite de páginas não avança o cursor (nada fica para trás)', async () => {
  const db = bancoMemoria();
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ modalidades: [6], diasRetroativos: 1, maxPaginasPorConsulta: 1, sincronizarDetalhes: false }));
  const r = await sincronizarFonte(db, 'pncp', { fetchImpl: simuladorPncp(), agora: new Date('2026-10-10T15:00:00Z') });
  assert.equal(r.lidos, 50);
  assert.deepEqual(JSON.parse(db.prepare("SELECT cursor_json FROM fontes WHERE codigo='pncp'").get().cursor_json || '{}'), {});
});

test('banco antigo com limite de 20 páginas no PNCP passa para 2000 ao reabrir', async () => {
  const { abrirBanco } = await import('../../server/db/index.js');
  const os = await import('node:os'); const path = await import('node:path'); const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'licita-'));
  const arq = path.join(dir, 'b.db');
  const a = abrirBanco(arq);
  a.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ ufs: ['ES'], maxPaginasPorConsulta: 20 }));
  a.close();
  const b = abrirBanco(arq);
  const cfg = JSON.parse(b.prepare("SELECT config_json FROM fontes WHERE codigo='pncp'").get().config_json);
  b.close(); fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(cfg.maxPaginasPorConsulta, 2000);
  assert.deepEqual(cfg.ufs, ['ES']);   // o resto da configuração do administrador é mantido
});
