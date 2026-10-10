import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bancoMemoria, fixture, clonar, fetchFalso } from '../helpers.js';
import { normalizarPncp, normalizarItemPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens } from '../../server/services/repositorio.js';
import { buscar } from '../../server/services/busca.js';
import { completarItensAbertas } from '../../server/services/sync.js';
import { espacoEmDisco } from '../../server/lib/disco.js';
import { abrirBanco, indexarItensPendentes, indexarItensEmSegundoPlano } from '../../server/db/index.js';

process.env.HTTP_MIN_INTERVAL_MS = '0';
process.env.HTTP_BASE_ESPERA_MS = '1';

// Base de TESTE derivada de registros reais do PNCP (identificada como dado de teste).
// Caso real de 10/10/2026: o portal PNCP acha "mouse" em pregões cujo objeto é só "materiais de informática".
function lic(db, i, objeto, enc = '2026-10-20T10:00:00') {
  const r = clonar(fixture('pncp-contratacao-real'));
  r.numeroControlePNCP = `TESTE-IT-${i}`; r.sequencialCompra = 500 + i; r.objetoCompra = objeto;
  r.dataEncerramentoProposta = enc; r.dataPublicacaoPncp = '2026-10-05T08:00:00';
  return salvarLicitacao(db, normalizarPncp(r), 'pncp', r, '2026-10-10T12:00:00').id;
}
const item = (n, descricao) => normalizarItemPncp({ ...fixture('pncp-item-real'), numeroItem: n, descricao });

test('busca acha a palavra na descrição dos itens e diz em qual item', () => {
  const db = bancoMemoria();
  const a = lic(db, 1, 'Aquisição de materiais de informática');
  lic(db, 2, 'Aquisição de mouse e teclado');
  lic(db, 3, 'Serviço de limpeza predial');
  salvarItens(db, a, [item(1, 'NOTEBOOK CORE I5'), item(2, 'MOUSE ÓPTICO USB'), item(3, 'Mouse sem fio'), item(4, 'Mouses pad'), item(5, 'TECLADO ABNT2')]);

  const r = buscar(db, { q: 'mouse' }, { agora: '2026-10-10T12:00:00' });
  assert.equal(r.total, 2);
  const achada = r.dados.find((d) => d.id === a);
  assert.deepEqual(achada.itens_encontrados.map((i) => i.numero_item), [2, 3, 4]);
  assert.equal(achada.itens_encontrados_total, 3);
  assert.equal(r.dados.find((d) => d.id !== a).itens_encontrados, undefined); // achada pelo objeto

  // Todas as palavras no mesmo item; "Só no objeto" volta ao comportamento antigo; exclusão continua valendo
  assert.equal(buscar(db, { q: 'mouse optico' }).total, 1);
  assert.equal(buscar(db, { q: 'mouse notebook' }).total, 0);
  assert.equal(buscar(db, { q: 'mouse', nos_itens: '0' }).total, 1);
  assert.equal(buscar(db, { q: 'mouse', excluir: 'informatica' }).total, 1);

  // Cobertura: só 1 das 3 licitações tem itens baixados; o sistema avisa em vez de esconder
  assert.deepEqual(r.cobertura_itens, { total: 3, com_itens: 1 });
  assert.equal(buscar(db, { uf: 'ES' }).cobertura_itens, undefined); // sem texto, sem aviso

  // Item alterado sai/entra do índice
  db.prepare("UPDATE licitacao_itens SET descricao='CABO HDMI' WHERE licitacao_id=?").run(a);
  assert.equal(buscar(db, { q: 'mouse' }).total, 1);
});

test('banco antigo: itens já baixados entram no índice em segundo plano, sem atrasar o início', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'licita-'));
  const arq = path.join(dir, 'b.db');
  const db1 = abrirBanco(arq);
  const a = lic(db1, 1, 'Aquisição de materiais de informática');
  salvarItens(db1, a, [item(1, 'MOUSE ÓPTICO USB')]);
  // Estado do banco em produção após o deploy que não subiu: tabela e gatilhos antigos criados, índice vazio
  db1.exec(`DROP TRIGGER trg_itens_ad2; DROP TRIGGER trg_itens_au2; INSERT INTO itens_fts(itens_fts) VALUES('delete-all');
    CREATE TRIGGER trg_itens_ad AFTER DELETE ON licitacao_itens BEGIN
      INSERT INTO itens_fts(itens_fts, rowid, descricao) VALUES ('delete', old.id, old.descricao); END;
    CREATE TRIGGER trg_itens_au AFTER UPDATE OF descricao ON licitacao_itens BEGIN
      INSERT INTO itens_fts(itens_fts, rowid, descricao) VALUES ('delete', old.id, old.descricao);
      INSERT INTO itens_fts(rowid, descricao) VALUES (new.id, new.descricao); END;`);
  db1.close();
  const db2 = abrirBanco(arq);
  assert.equal(buscar(db2, { q: 'mouse' }).total, 0); // a abertura não indexa (não pode atrasar o início do site)
  // Antes de o lote passar, o item é atualizado pela sincronização: não pode corromper nem duplicar
  salvarItens(db2, a, [item(1, 'MOUSE ÓPTICO USB'), item(2, 'TECLADO')]);
  assert.equal(await indexarItensEmSegundoPlano(db2, { lote: 1, log: () => {} }), 0);
  assert.equal(buscar(db2, { q: 'mouse' }).total, 1);
  assert.equal(db2.prepare('SELECT COUNT(*) n FROM itens_fts_docsize').get().n, 2);
  db2.exec("INSERT INTO itens_fts(itens_fts) VALUES('integrity-check')");
  db2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('baixa os itens das licitações abertas em segundo plano, prazo mais próximo primeiro, sem insistir em falha', async () => {
  const db = bancoMemoria();
  const tarde = lic(db, 1, 'Materiais de informática', '2026-10-30T10:00:00');
  const cedo = lic(db, 2, 'Materiais de expediente', '2026-10-15T10:00:00');
  const ruim = lic(db, 3, 'Material elétrico', '2026-10-12T10:00:00');
  const seqRuim = db.prepare('SELECT sequencial FROM licitacoes WHERE id=?').get(ruim).sequencial;
  const f = fetchFalso((url) => {
    if (url.includes(`/compras/`) && url.includes(`/${seqRuim}/`)) return { status: 500, body: 'erro' };
    if (url.includes('/itens')) return { status: 200, body: [{ ...fixture('pncp-item-real'), numeroItem: 1, descricao: 'MOUSE ÓPTICO USB' }] };
    if (url.includes('/arquivos')) return { status: 200, body: [] };
    return { status: 404, body: '' };
  });
  const r1 = await completarItensAbertas(db, { limite: 2, fetchImpl: f });
  assert.equal(r1.falhas, 1); assert.equal(r1.baixadas, 1);
  assert.ok(f.chamadas[0].includes(`/${seqRuim}/`)); // prazo mais próximo primeiro
  const r2 = await completarItensAbertas(db, { limite: 5, fetchImpl: f });
  assert.equal(r2.baixadas, 1); assert.equal(r2.falhas, 0); // não repete a que falhou
  assert.equal(r2.pendentes, 1);
  assert.equal(buscar(db, { q: 'mouse' }).total, 2);
  assert.ok([tarde, cedo].every((id) => db.prepare('SELECT detalhes_sincronizados_em d FROM licitacoes WHERE id=?').get(id).d));
});

test('indexação em lotes: só os itens que faltam, sem duplicar', () => {
  const db = bancoMemoria();
  const a = lic(db, 1, 'Materiais diversos');
  db.exec('DROP TRIGGER trg_itens_ai');
  salvarItens(db, a, [item(1, 'MOUSE'), item(2, 'TECLADO'), item(3, 'MONITOR')]);
  db.exec("INSERT INTO itens_fts(rowid, descricao) SELECT id, descricao FROM licitacao_itens WHERE numero_item = 2");
  const r1 = indexarItensPendentes(db, { lote: 2 });
  assert.deepEqual([r1.indexados, r1.fim], [1, false]);
  const r2 = indexarItensPendentes(db, { aposId: r1.ultimoId, lote: 2 });
  assert.deepEqual([r2.indexados, r2.fim], [1, true]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM itens_fts_docsize').get().n, 3);
  db.exec("INSERT INTO itens_fts(itens_fts) VALUES('integrity-check')");
});

test('espaço em disco: avisa quando o volume está quase cheio', () => {
  const fs = (livre) => () => ({ blocks: 512, bsize: 1048576, bavail: livre }); // volume de 512 MB
  assert.deepEqual(espacoEmDisco('/x', fs(300)), { total_mb: 512, livre_mb: 300, livre_pct: 58.6, baixo: false });
  assert.equal(espacoEmDisco('/x', fs(40)).baixo, true);   // menos de 10%
  assert.equal(espacoEmDisco('/x', () => { throw new Error('sem acesso'); }), null);
});
