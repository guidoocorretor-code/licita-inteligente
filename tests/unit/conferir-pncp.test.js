import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture, clonar, fetchFalso } from '../helpers.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao } from '../../server/services/repositorio.js';
import { conferirComPncp, partesDoControle } from '../../server/services/conferir-pncp.js';
import { varreduraVencida } from '../../server/services/scheduler.js';
import { CONECTORES } from '../../server/connectors/registro.js';
import { _reiniciarLimitador } from '../../server/lib/http.js';

process.env.HTTP_MIN_INTERVAL_MS = '0';
process.env.HTTP_BASE_ESPERA_MS = '1';

// Registros de TESTE derivados do registro real do PNCP (identificados como dados de teste)
function registro(cnpj, seq, objeto, orgao = 'MUNICIPIO DE TESTE') {
  const r = clonar(fixture('pncp-contratacao-real'));
  r.numeroControlePNCP = `${cnpj}-1-${String(seq).padStart(6, '0')}/2026`; r.sequencialCompra = seq; r.anoCompra = 2026;
  r.orgaoEntidade = { ...r.orgaoEntidade, cnpj, razaoSocial: orgao };
  r.unidadeOrgao = { ...r.unidadeOrgao, ufSigla: 'ES', municipioNome: 'Vila Velha' };
  r.objetoCompra = objeto; r.dataEncerramentoProposta = '2027-06-24T14:00:00'; r.dataAberturaProposta = '2026-10-01T08:00:00';
  r.situacaoCompraId = 1;
  return r;
}

test('número de controle do PNCP vira CNPJ, ano e sequencial', () => {
  assert.deepEqual(partesDoControle('27165638000139-1-000153/2024'), { cnpj: '27165638000139', seq: 153, ano: 2024 });
  assert.equal(partesDoControle('qualquer'), null);
});

test('conferir com o PNCP: importa o que falta, baixa itens e explica o que continua só no PNCP', async () => {
  _reiniciarLimitador?.();
  const db = bancoMemoria();
  const naBase = registro('11111111000111', 1, 'Aquisição de água mineral');
  salvarLicitacao(db, normalizarPncp(naBase), 'pncp', naBase);
  const semItens = registro('22222222000122', 2, 'Aquisição de coffee break');            // "água" só nos itens
  salvarLicitacao(db, normalizarPncp(semItens), 'pncp', semItens);
  const faltando = registro('33333333000133', 3, 'Registro de preços de água em garrafão'); // prazo longo, não estava na base
  const soOrgao = registro('44444444000144', 4, 'Veiculação de mídia em TV'); // PNCP achou a palavra em outro texto
  salvarLicitacao(db, normalizarPncp(soOrgao), 'pncp', soOrgao);
  db.prepare("UPDATE licitacoes SET detalhes_sincronizados_em = datetime('now') WHERE numero_controle_pncp = ?").run(soOrgao.numeroControlePNCP);

  const itemReal = fixture('pncp-item-real');
  const f = fetchFalso((url) => {
    if (url.includes('/api/search/')) {
      return { status: 200, body: { total: 4, items: [naBase, semItens, faltando, soOrgao].map((r) => ({ numero_controle_pncp: r.numeroControlePNCP, orgao_nome: r.orgaoEntidade.razaoSocial, description: r.objetoCompra })) } };
    }
    if (url.includes('/v1/orgaos/33333333000133/compras/2026/3')) return { status: 200, body: faltando };
    if (url.includes('/22222222000122/compras/2026/2/itens')) return { status: 200, body: [{ ...itemReal, numeroItem: 1, descricao: 'Água mineral sem gás 500 ml' }] };
    if (url.includes('/itens')) return { status: 200, body: [{ ...itemReal, numeroItem: 1, descricao: 'Garrafão de água 20 litros' }] };
    if (url.includes('/arquivos')) return { status: 200, body: [] };
    return { status: 404, body: '' };
  });
  const r = await conferirComPncp(db, { q: 'agua', uf: 'ES', fetchImpl: f });
  assert.equal(r.pncp, 4);
  assert.equal(r.importadas, 1);
  assert.equal(r.itens_baixados, 2);       // a importada e a que não tinha itens
  assert.equal(r.em_comum, 3);
  assert.equal(r.agora_aparecem, 2);
  assert.equal(r.so_pncp.length, 1);
  assert.equal(r.so_pncp[0].numero, soOrgao.numeroControlePNCP);
  assert.match(r.so_pncp[0].motivo, /outro campo/);
  assert.ok(f.chamadas.some((u) => u.includes('ufs=ES') && u.includes('status=recebendo_proposta')));
});

test('conferir exige a palavra-chave', async () => {
  await assert.rejects(conferirComPncp(bancoMemoria(), { q: ' ' }), /palavra-chave/);
});

test('varredura semanal das abertas do PNCP', () => {
  const agora = new Date('2026-10-13T12:00:00Z');
  assert.equal(varreduraVencida('{}', agora), true);
  assert.equal(varreduraVencida(JSON.stringify({ varredura_abertas: '20261010' }), agora), false);
  assert.equal(varreduraVencida(JSON.stringify({ varredura_abertas: '20261006' }), agora), true);
});

test('carga das abertas pede prazo de propostas até 3 anos à frente, em todas as modalidades configuradas', async () => {
  const f = fetchFalso(() => ({ status: 204, body: '' }));
  const fonte = { config: { ufs: ['ES'], modalidades: [6, 15] }, cursor: {} };
  const lotes = [];
  for await (const l of CONECTORES.pncp.coletar(fonte, { modo: 'abertas', fetchImpl: f, agora: new Date('2026-10-13T12:00:00Z') })) lotes.push(l);
  assert.equal(f.chamadas.length, 2);
  assert.ok(f.chamadas.every((u) => u.includes('dataFinal=2029')));
  assert.ok(f.chamadas.some((u) => u.includes('codigoModalidadeContratacao=15')));
  assert.deepEqual(lotes, [{ cursor: { varredura_abertas: '2026-10-13'.replace(/-/g, '') } }]);
});
