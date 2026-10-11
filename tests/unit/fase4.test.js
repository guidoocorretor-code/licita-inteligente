import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture, clonar, fetchFalso } from '../helpers.js';
import { sincronizarFonte } from '../../server/services/sync.js';
import { buscarContratos, contratosDaLicitacao } from '../../server/services/contratos.js';
import { sincronizarCatalogo, buscarCatalogo, consultarPrecos, analisarPrecos, estatisticas, validarConsulta, filtrarPorEspecificacao } from '../../server/services/precos.js';
import { normalizarPncp, normalizarPrecoCompras } from '../../server/services/normalizacao.js';
import { salvarLicitacao } from '../../server/services/repositorio.js';
import { _reiniciarLimitador } from '../../server/lib/http.js';
import { criarApp } from '../../server/app.js';
import { criarUsuario } from '../../server/lib/auth.js';

process.env.HTTP_MIN_INTERVAL_MS = '0';
process.env.HTTP_BASE_ESPERA_MS = '1';

// Base de TESTE derivada de registros reais do PNCP e do Compras.gov.br (identificada como dado de teste)
function contrato(dia, i, extra = {}) {
  const r = clonar(fixture('pncp-contrato-real'));
  r.numeroControlePNCP = `TESTE-CTR-${dia}-${i}`; r.sequencialContrato = i;
  r.dataPublicacaoPncp = `${dia.slice(0, 4)}-${dia.slice(4, 6)}-${dia.slice(6, 8)}T10:00:00`;
  return Object.assign(r, extra);
}

// Simula /v1/contratos: 2 páginas no dia 08/10, 1 página nos dias 09 e 10/10
function simuladorContratos({ falharDia } = {}) {
  return fetchFalso((url) => {
    const u = new URL(url);
    if (!u.pathname.endsWith('/v1/contratos')) return { status: 404, body: '' };
    const dia = u.searchParams.get('dataInicial'); const pag = Number(u.searchParams.get('pagina'));
    assert.equal(u.searchParams.get('dataFinal'), dia);
    if (dia === falharDia) return { status: 400, body: 'erro' };
    if (dia === '20261008') {
      const d = pag === 1 ? [contrato(dia, 1), contrato(dia, 2, { unidadeOrgao: { ...fixture('pncp-contrato-real').unidadeOrgao, ufSigla: 'ES', municipioNome: 'Vila Velha' } })] : [contrato(dia, 3)];
      return { status: 200, body: { data: d, totalRegistros: 3, totalPaginas: 2, numeroPagina: pag, paginasRestantes: 2 - pag, empty: false } };
    }
    if (dia === '20261009') return { status: 200, body: { data: [contrato(dia, 1)], totalRegistros: 1, totalPaginas: 1, numeroPagina: 1, paginasRestantes: 0 } };
    return { status: 204, body: '' };
  });
}

test('contratos PNCP: dia a dia, paginação, vínculo com a licitação, cursor e sem duplicar', async () => {
  _reiniciarLimitador();
  const db = bancoMemoria();
  // licitação de origem já no banco (mesmo numeroControlePncpCompra do contrato real)
  const lic = clonar(fixture('pncp-contratacao-real'));
  lic.numeroControlePNCP = '13880257000127-1-000062/2026';
  const licId = salvarLicitacao(db, normalizarPncp(lic), 'pncp', lic).id;
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp_contratos'").run(JSON.stringify({ diasRetroativos: 2, tamanhoPagina: 500 }));

  const fetchImpl = simuladorContratos();
  const r = await sincronizarFonte(db, 'pncp_contratos', { fetchImpl, agora: new Date('2026-10-10T15:00:00Z') });
  assert.equal(r.status, 'sucesso');
  assert.equal(r.inseridos, 4);
  assert.ok(fetchImpl.chamadas.every((u) => u.includes('tamanhoPagina=500')));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM contratos').get().n, 4);
  assert.equal(contratosDaLicitacao(db, licId).length, 4);
  const f = db.prepare("SELECT * FROM fontes WHERE codigo='pncp_contratos'").get();
  assert.equal(JSON.parse(f.cursor_json).data, '20261010');          // hoje volta a ser consultado na próxima vez
  assert.equal(f.registros_importados, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n, 1); // não cria licitação a partir de contrato

  const c = db.prepare("SELECT * FROM contratos WHERE numero_controle_pncp='TESTE-CTR-20261008-1'").get();
  assert.equal(c.fornecedor_ni, '44281151000130');
  assert.equal(c.valor_global, 28608);
  assert.equal(c.link_pncp, 'https://pncp.gov.br/app/contratos/13880257000127/2026/1');

  const r2 = await sincronizarFonte(db, 'pncp_contratos', { fetchImpl: simuladorContratos(), agora: new Date('2026-10-10T18:00:00Z') });
  assert.equal(r2.inseridos, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM contratos').get().n, 4);
});

test('contratos PNCP: dia que falha não perde os dias já concluídos; filtro de UF ao salvar', async () => {
  _reiniciarLimitador();
  const db = bancoMemoria();
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp_contratos'").run(JSON.stringify({ diasRetroativos: 2, ufs: ['ES'] }));
  const r = await sincronizarFonte(db, 'pncp_contratos', { fetchImpl: simuladorContratos({ falharDia: '20261009' }), agora: new Date('2026-10-10T15:00:00Z') });
  assert.equal(r.status, 'parcial');
  assert.deepEqual(db.prepare('SELECT uf FROM contratos').all().map((x) => x.uf), ['ES']);   // só o de Vila Velha
  assert.equal(JSON.parse(db.prepare("SELECT cursor_json FROM fontes WHERE codigo='pncp_contratos'").get().cursor_json).data, '20261008');
});

test('busca de contratos: texto, fornecedor, vigentes e maiores fornecedores', async () => {
  _reiniciarLimitador();
  const db = bancoMemoria();
  db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp_contratos'").run(JSON.stringify({ diasRetroativos: 2 }));
  await sincronizarFonte(db, 'pncp_contratos', { fetchImpl: simuladorContratos(), agora: new Date('2026-10-10T15:00:00Z') });
  db.prepare("UPDATE contratos SET fornecedor_ni='11111111000111', fornecedor_nome='OUTRA EMPRESA LTDA', valor_global=100000, vigencia_fim='2026-01-31' WHERE numero_controle_pncp='TESTE-CTR-20261009-1'").run();
  assert.equal(buscarContratos(db, { q: 'transportes escolares' }).total, 4);             // plural e sem acento acham
  assert.equal(buscarContratos(db, { q: 'outra empresa' }).total, 1);
  assert.equal(buscarContratos(db, { fornecedor: '44.281.151/0001-30' }).total, 3);
  assert.equal(buscarContratos(db, { vigentes: '1' }, { hoje: '2026-10-10' }).total, 3);
  assert.equal(buscarContratos(db, { uf: 'ES' }).total, 1);
  const r = buscarContratos(db, {});
  assert.equal(r.soma_valor_global, 28608 * 3 + 100000);
  assert.equal(r.fornecedores[0].ni, '11111111000111');                                   // maior soma primeiro
  assert.equal(r.fornecedores[1].n, 3);
});

test('catálogo do Compras.gov.br: baixa PDM e serviços e acha pela descrição ou pelo código', async () => {
  _reiniciarLimitador();
  const db = bancoMemoria();
  const cat = fixture('compras-catalogo-real');
  const fetchImpl = fetchFalso((url) => {
    if (url.includes('3_consultarPdmMaterial')) return { status: 200, body: { resultado: [cat.pdm, { ...cat.pdm, codigoPdm: 15779, nomePdm: 'BOTOM', nomeClasse: 'DISTINTIVOS E INSÍGNIAS' }], totalRegistros: 2, totalPaginas: 1, paginasRestantes: 0 } };
    if (url.includes('6_consultarItemServico')) return { status: 200, body: { resultado: [cat.servico], totalRegistros: 1, totalPaginas: 1, paginasRestantes: 0 } };
    return { status: 404, body: '' };
  });
  assert.deepEqual(await sincronizarCatalogo(db, { fetchImpl }), { material: 2, servico: 1 });
  assert.equal(buscarCatalogo(db, 'cartuchos caneta')[0].codigo, 281);
  assert.equal(buscarCatalogo(db, 'endoscopia')[0].tipo, 'servico');
  assert.equal(buscarCatalogo(db, '15779')[0].nome, 'BOTOM');
  assert.deepEqual(buscarCatalogo(db, ''), []);
  await sincronizarCatalogo(db, { fetchImpl });                                            // atualizar não duplica
  assert.equal(db.prepare('SELECT COUNT(*) n FROM catalogo_compras').get().n, 3);
  assert.equal(buscarCatalogo(db, 'botom').length, 1);
});

test('estatística de preços: mediana, média, quartis e fora da curva (Tukey)', () => {
  const e = estatisticas([10, 11, 12, 13, 14, 100, null, 0]);
  assert.equal(e.n, 6);                      // nulo e zero não entram
  assert.equal(e.menor, 10); assert.equal(e.maior, 100);
  assert.equal(e.mediana, 12.5);
  assert.equal(e.media, 26.6667);
  assert.equal(e.fora_da_curva, 1);
  assert.equal(e.media_sem_fora_da_curva, 12);
  assert.deepEqual(estatisticas([]), { n: 0 });
});

test('pesquisa de preços: parâmetros oficiais, período, cache de 24h e análise por unidade', async () => {
  _reiniciarLimitador();
  const db = bancoMemoria();
  const base = fixture('compras-preco-material-real');
  const reg = (preco, unidade = 'UN', item = 150420, data = '2026-05-10') =>
    ({ ...clonar(base), precoUnitario: preco, siglaUnidadeFornecimento: unidade, codigoItemCatalogo: item, dataCompra: data });
  const fetchImpl = fetchFalso((url) => {
    const p = Number(new URL(url).searchParams.get('pagina'));
    const lista = p === 1 ? [reg(8.97), reg(9.5, 'UN', 150420, '2026-09-01'), reg(10), reg(11), reg(60), reg(120, 'CX', 150421)] : [];
    return { status: 200, body: { resultado: lista, totalRegistros: 6, totalPaginas: 1, paginasRestantes: 0 } };
  });
  const consulta = validarConsulta({ tipo: 'material_pdm', codigo: '15779', uf: 'es', meses: '12' });
  assert.deepEqual(consulta, { tipo: 'material_pdm', codigo: 15779, uf: 'ES', meses: 12 });
  assert.equal(validarConsulta({ tipo: 'x', codigo: '1' }), null);

  const r = await consultarPrecos(db, consulta, { fetchImpl, agora: new Date('2026-10-10T12:00:00Z') });
  const u = new URL(fetchImpl.chamadas[0]);
  assert.match(u.pathname, /1_consultarMaterial$/);
  assert.equal(u.searchParams.get('tipo'), 'codigoPdm');
  assert.equal(u.searchParams.get('codigo'), '15779');
  assert.equal(u.searchParams.get('estado'), 'ES');
  assert.equal(u.searchParams.get('dataCompraFim'), '2026-10-10');
  assert.equal(u.searchParams.get('dataCompraInicio'), '2025-10-10');
  assert.equal(r.registros.length, 6);
  assert.equal(r.registros[0].data_compra, '2026-09-01');                                // mais novo primeiro

  const r2 = await consultarPrecos(db, consulta, { fetchImpl, agora: new Date('2026-10-10T12:00:00Z') });
  assert.equal(r2.cache, true);
  assert.equal(fetchImpl.chamadas.length, 1);                                            // não consultou de novo

  const a = analisarPrecos(r.registros, {});
  assert.equal(a.unidade, 'UN');                                                         // unidade com mais preços
  assert.equal(a.estatisticas.n, 5);
  assert.deepEqual(a.unidades.map((x) => x.unidade), ['UN', 'CX']);
  assert.ok(a.registros.find((x) => x.preco_unitario === 60).fora_da_curva);
  assert.ok(!a.registros.find((x) => x.preco_unitario === 10).fora_da_curva);
  assert.deepEqual(a.itens_catalogo.map((x) => [x.codigo, x.n]), [[150420, 5], [150421, 1]]);
  assert.equal(analisarPrecos(r.registros, { item: '150421' }).unidade, 'CX');

  // serviço: endpoint e parâmetro próprios
  const f2 = fetchFalso(() => ({ status: 200, body: { resultado: [fixture('compras-preco-servico-real')], totalRegistros: 1, paginasRestantes: 0 } }));
  const s = await consultarPrecos(db, { tipo: 'servico', codigo: 5380, uf: null, meses: 6 }, { fetchImpl: f2, agora: new Date('2026-10-10T12:00:00Z') });
  assert.match(f2.chamadas[0], /3_consultarServico\?.*codigoItemCatalogo=5380/);
  assert.equal(s.registros[0].preco_unitario, 49816.6);
  assert.equal(normalizarPrecoCompras(fixture('compras-preco-servico-real')).unidade, 'UN');
});

test('API: pesquisa de preços (cache), exportação CSV, contratos e contratos na licitação', async () => {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Empresa Teste')").run().lastInsertRowid);
  criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@teste.com', senha: 'SenhaForte123', papel: 'analista' });
  db.prepare("INSERT INTO catalogo_compras (tipo, codigo, nome, classe) VALUES ('material', 15779, 'BOTOM', 'DISTINTIVOS E INSÍGNIAS')").run();
  const regs = [8.97, 9.5, 10].map((p) => ({ ...normalizarPrecoCompras(fixture('compras-preco-material-real')), preco_unitario: p }));
  db.prepare("INSERT INTO precos_consultas (chave, registros_json, total_fonte) VALUES ('material_pdm:15779:BR:12', ?, 3)").run(JSON.stringify(regs));
  const lic = clonar(fixture('pncp-contratacao-real')); lic.numeroControlePNCP = '13880257000127-1-000062/2026';
  const licId = salvarLicitacao(db, normalizarPncp(lic), 'pncp', lic).id;
  const { salvarContrato } = await import('../../server/services/contratos.js');
  const { normalizarContratoPncp } = await import('../../server/services/normalizacao.js');
  salvarContrato(db, normalizarContratoPncp(fixture('pncp-contrato-real')));

  const servidor = criarApp().listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email: 'ana@teste.com', senha: 'SenhaForte123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const get = (p) => fetch(`${base}/api${p}`, { headers: { cookie, 'x-requested-with': 'licita' } });

    const cat = await (await get('/precos/catalogo?q=botons')).json();
    assert.equal(cat.resultados[0].codigo, 15779);
    const p = await (await get('/precos?tipo=material_pdm&codigo=15779')).json();
    assert.equal(p.cache, true);
    assert.equal(p.consulta.nome, 'BOTOM');
    assert.equal(p.estatisticas.mediana, 9.5);
    assert.equal((await get('/precos?tipo=material_pdm')).status, 400);
    const bytes = Buffer.from(await (await get('/precos/exportar?tipo=material_pdm&codigo=15779')).arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);                         // BOM: acentos certos no Excel
    const csv = bytes.toString('utf8');
    assert.match(csv, /Data da compra;/);
    assert.match(csv, /;8,97;/);
    assert.match(csv, /IN SEGES\/ME 65\/2021/);

    const c = await (await get('/contratos?q=transporte')).json();
    assert.equal(c.total, 1);
    assert.equal(c.linhas[0].licitacao_id, licId);
    assert.equal((await (await get(`/licitacoes/${licId}`)).json()).contratos.length, 1);
    assert.match(await (await get('/contratos/exportar?uf=BA')).text(), /MARIA FEITOZA DOS SANTOS/);
    assert.equal((await fetch(`${base}/api/contratos`)).status, 401);                       // exige login
  } finally { servidor.close(); }
});

test('filtro por especificação e aviso de média distorcida (valor total lançado como unitário)', () => {
  const base = normalizarPrecoCompras(fixture('compras-preco-material-real'));
  const reg = (descricao_detalhada, preco_unitario, marca = 'X') => ({ ...base, descricao: 'NOTEBOOK', descricao_detalhada, preco_unitario, marca });
  const regs = [reg('Processador Intel Core Ultra 7, memória 32 GB, SSD 1 TB', 12500), reg('Core Ultra 7 155H, 32GB RAM', 11800, 'Dell'),
    reg('Processador Core Ultra 5, memória 16 GB', 6100), reg('Processador Intel Core i5, 8 GB', 4200), reg('Notebook i5 8gb', 89750000)];
  assert.equal(filtrarPorEspecificacao(regs, 'ultra 7 32gb').length, 2);           // "32 GB" e "32GB" são iguais
  assert.equal(filtrarPorEspecificacao(regs, 'ULTRA 7 32 gb').length, 2);
  assert.equal(filtrarPorEspecificacao(regs, 'dell').length, 1);                   // marca também conta
  assert.equal(filtrarPorEspecificacao(regs, '').length, 5);
  const a = analisarPrecos(regs, { filtro: 'ultra 7' });
  assert.equal(a.estatisticas.n, 2);
  assert.equal(a.estatisticas.mediana, 12150);
  const tudo = analisarPrecos([...regs, reg('i5', 4300), reg('i5', 4400)], {});
  assert.equal(tudo.estatisticas.media_distorcida, true);
  assert.ok(tudo.registros.find((r) => r.preco_unitario === 89750000).fora_da_curva);
  assert.equal(estatisticas([10, 11, 12, 13]).media_distorcida, false);
});

test('Análise de mercado: sinônimo do A4, marcas e panorama', async () => {
  const { buscarCatalogo, panoramaMercado, marcaNormal } = await import('../../server/services/precos.js');
  assert.equal(marcaNormal('Conforme edital'), null);
  assert.equal(marcaNormal('papeis a3, a4, recic'), null);
  assert.equal(marcaNormal(' chamex '), 'CHAMEX');
  const regs = [
    { preco_unitario: 20, quantidade: 10, marca: 'Chamex', fornecedor_ni: '1', fornecedor_nome: 'A', data_compra: '2026-01-10', esfera: 'F', uf: 'ES' },
    { preco_unitario: 22, quantidade: 30, marca: 'Report', fornecedor_ni: '2', fornecedor_nome: 'B', data_compra: '2026-02-10', esfera: 'E', uf: 'ES' },
    { preco_unitario: 21, quantidade: 5, marca: 'CHAMEX', fornecedor_ni: '1', fornecedor_nome: 'A', data_compra: '2026-03-10', esfera: 'F', uf: 'ES' },
    { preco_unitario: 23, quantidade: 5, marca: 'conforme edital', fornecedor_ni: '3', fornecedor_nome: 'C', data_compra: '2026-03-11', esfera: 'M', uf: 'ES' },
  ];
  const p = panoramaMercado(regs);
  assert.equal(p.compras, 4); assert.equal(p.quantidade, 50); assert.equal(p.sem_marca, 1);
  assert.equal(p.marcas_top[0].nome, 'REPORT');                       // 30 unidades
  assert.equal(p.marcas_top[1].quantidade, 15);                        // CHAMEX somado sem diferenciar maiúsculas
  assert.equal(p.fornecedores[0].nome, 'A');                           // menor mediana primeiro
  assert.equal(p.ultimas_marcas[0].marca, 'CHAMEX');                   // "conforme edital" fica de fora
  assert.deepEqual(p.precos, [20, 21, 22, 23]);

  // "papel A4": o PDM 19746 (onde a maioria das compras é registrada) vem primeiro, marcado como sugerido
  const db = bancoMemoria();
  const ins = db.prepare('INSERT INTO catalogo_compras (tipo, codigo, nome, classe) VALUES (?,?,?,?)');
  ins.run('material', 127, 'PAPEL A4', 'ARTIGOS PARA ESCRITÓRIO'); ins.run('material', 19746, 'PAPEL PARA IMPRESSÃO FORMATADO', 'PAPEL');
  const r = buscarCatalogo(db, 'papel A4');
  assert.equal(r[0].codigo, 19746); assert.ok(r[0].sugerido);
  assert.ok(r.some((x) => x.codigo === 127));
});

test('preços: com muitas páginas, baixa as mais novas (a fonte vem da mais antiga para a mais nova)', async () => {
  _reiniciarLimitador();
  const { baixarPrecos } = await import('../../server/connectors/comprasgov.js');
  const fetchImpl = fetchFalso((url) => {
    const pag = Number(new URL(url).searchParams.get('pagina'));
    return { status: 200, body: { resultado: [{ idCompra: `P${pag}` }], totalRegistros: 10, totalPaginas: 10, paginasRestantes: 10 - pag } };
  });
  const r = await baixarPrecos({ tipo: 'material_pdm', codigo: 1 }, { maxPaginas: 3, fetchImpl });
  assert.equal(r.truncado, true);
  assert.deepEqual(r.registros.map((x) => x.idCompra), ['P8', 'P9', 'P10']);
  const r2 = await baixarPrecos({ tipo: 'material_pdm', codigo: 1 }, { maxPaginas: 20, fetchImpl });
  assert.equal(r2.registros.length, 10); assert.equal(r2.truncado, false);
});
