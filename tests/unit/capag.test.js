import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { bancoMemoria } from '../helpers.js';
import { lerCapagMunicipios, lerCapagEstados, nota, percentual, atualizarCapag, pagometroDaLicitacao, recursoMaisRecente } from '../../server/services/capag.js';
import { buscar } from '../../server/services/busca.js';
import { _reiniciarLimitador } from '../../server/lib/http.js';

// Layout dos arquivos do Tesouro (DADOS DE TESTE com nomes reais de municípios e notas fictícias)
async function xlsxMunicipios() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Ranking').addRow(['Código Município Completo', 'Nome_Município', 'UF', 'Ranking']);
  const ws = wb.addWorksheet('Prévia da Capag');
  ws.addRow(['Capacidade de Pagamento - posição 01/09/2026']);
  ws.addRow(['Código Município Completo', 'Nome_Município', 'UF', 'CAPAG', 'Indicador 1', 'Nota 1', 'Indicador 2', 'Nota 2', 'Indicador 3', 'Nota 3', 'ICF', 'Observação']);
  ws.addRow([3205200, 'Vila Velha', 'ES', 'A', 0.2512, 'A', 0.8811, 'A', 0.0712, 'A', 'Aicf', null]);
  ws.addRow([3205309, 'Vitória', 'ES', 'B+', 0.401, 'A', 0.93, 'B', 0.01, 'A', 'Aicf', null]);
  ws.addRow([3201209, 'Cachoeiro de Itapemirim', 'ES', 'C', 0.9, 'B', 0.99, 'C', -0.05, 'C', 'Bicf', null]);
  ws.addRow([3200102, 'Afonso Cláudio', 'ES', 'n.d.', null, null, null, null, null, null, null, 'Dados inconsistentes no Siconfi']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const CSV_ESTADOS = 'UF;Indicador 1;Nota 1;Indicador 2;Nota 2;Indicador 3;Nota 3;Classificação da CAPAG;Qualidade da informação contábil e fiscal;\nObservação\nAC;34,95%;A;92,29%;B;-1,03%;C;C;Bicf;\nES;20,00%;A;85,00%;A;5,00%;A;A+;Aicf;\n';

test('lê planilha de municípios e CSV de estados no formato do Tesouro', async () => {
  const m = await lerCapagMunicipios(await xlsxMunicipios());
  assert.equal(m.length, 4);
  const vv = m.find((x) => x.chave === '3205200');
  assert.deepEqual([vv.nome, vv.uf, vv.capag, vv.ind1, vv.nota3], ['Vila Velha', 'ES', 'A', 25.12, 'A']);
  assert.equal(m.find((x) => x.chave === '3200102').capag, null); // n.d. não vira nota
  const e = lerCapagEstados(CSV_ESTADOS);
  assert.deepEqual(e.map((x) => [x.chave, x.capag, x.ind3]), [['AC', 'C', -1.03], ['ES', 'A+', 5]]);
  assert.equal(nota(' b+ '), 'B+'); assert.equal(nota('n.d.'), null); assert.equal(percentual('1.234,5%'), 1234.5);
});

test('atualiza pelo CKAN, mostra no Pagômetro e filtra a busca por nota', async () => {
  process.env.HTTP_MIN_INTERVAL_MS = '0'; _reiniciarLimitador();
  const db = bancoMemoria();
  const xlsx = await xlsxMunicipios();
  const pacote = (fmt, url) => ({ success: true, result: { resources: [{ format: fmt, url: url + '-velho', created: '2025-01-01' }, { format: fmt, url, name: 'Posição 2026', created: '2026-09-15' }] } });
  const fetchImpl = async (u) => {
    const json = (o) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(o) });
    if (u.includes('capag-municipios')) return json(pacote('XLSX', 'https://tt/m.xlsx'));
    if (u.includes('capag-estados')) return json(pacote('CSV', 'https://tt/e.csv'));
    if (u === 'https://tt/m.xlsx') return { ok: true, status: 200, arrayBuffer: async () => xlsx };
    if (u === 'https://tt/e.csv') return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(CSV_ESTADOS.repeat(1)) };
    return { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) };
  };
  const r = await atualizarCapag(db, { fetchImpl });
  // Arquivos de teste são pequenos: a trava de "poucas linhas" impede gravar planilha com formato estranho
  assert.match(r.M.erro, /poucas linhas/); assert.match(r.E.erro, /poucas linhas/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM capag').get().n, 0);

  const ok = await atualizarCapag(db, { fetchImpl, minimos: { M: 1, E: 1 } });
  assert.deepEqual([ok.M.linhas, ok.E.linhas, ok.M.referencia], [4, 2, 'Posição 2026']);
  const lic = db.prepare("INSERT INTO licitacoes (chave_canonica, objeto, esfera, uf, municipio, codigo_ibge, status_calculado) VALUES (?,?,?,?,?,?, 'aberta')");
  lic.run('t:1', 'mouse', 'M', 'ES', 'Vila Velha', '3205200');
  lic.run('t:2', 'mouse', 'M', 'ES', 'Cachoeiro de Itapemirim', null); // sem IBGE: casa por nome + UF
  lic.run('t:3', 'mouse', 'E', 'ES', 'Vitória', null);
  lic.run('t:4', 'mouse', 'F', 'DF', 'Brasília', null);
  const notas = Object.fromEntries(buscar(db, { visao: '', tamanho: 10 }).dados.map((d) => [d.id, d.capag]));
  assert.deepEqual(Object.values(notas).sort(), ['A', 'A+', 'C', null].sort());
  assert.equal(buscar(db, { visao: '', capag: 'A,B' }).total, 2);
  assert.equal(buscar(db, { visao: '', capag: 'sem' }).total, 1);
  const fed = pagometroDaLicitacao(db, db.prepare("SELECT * FROM licitacoes WHERE chave_canonica='t:4'").get());
  assert.equal(fed.aplica, false);
  const cach = pagometroDaLicitacao(db, db.prepare("SELECT * FROM licitacoes WHERE chave_canonica='t:2'").get());
  assert.equal(cach.capag, 'C'); assert.equal(cach.nota3, 'C');
  assert.equal(recursoMaisRecente({ resources: [{ format: 'CSV', url: 'a', created: '2024' }, { format: 'CSV', url: 'b', created: '2026' }] }, 'CSV').url, 'b');
});
