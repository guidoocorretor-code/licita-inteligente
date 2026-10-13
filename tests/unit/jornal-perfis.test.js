// Jornais salvos: filtros do perfil, edição diária só com novidades e aviso. DADOS DE TESTE fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { normalizarFiltros, filtroDoPerfil, funilDoPerfil, salvarPerfil, perfilDaEmpresa, gerarEdicao, gerarEdicoesDoDia, idsDoPerfil, resumoFiltros, motivosDoPerfil, idsQueBatem, pendentesDeItens } from '../../server/services/jornal-perfis.js';
import { criarUsuario } from '../../server/lib/auth.js';

const AGORA = '2026-10-12T08:00:00';
function cenario() {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  const u = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@a.com', senha: 'SenhaForte123', papel: 'admin' });
  const ins = db.prepare(`INSERT INTO licitacoes (chave_canonica, objeto, orgao_nome, uf, municipio, modalidade_id, valor_estimado, status_calculado, data_encerramento_proposta, sistema_eletronico, criado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const lic = (k, o) => Number(ins.run(k, o.objeto, 'Prefeitura', o.uf ?? 'ES', o.mun ?? 'Vila Velha', o.mod ?? 6, o.valor ?? 10000, o.status ?? 'aberta',
    o.fim ?? '2026-10-20T10:00:00', o.sis ?? 'comprasgov', o.criado ?? '2026-10-11 10:00:00').lastInsertRowid);
  return { db, emp, uid: typeof u === 'object' ? u.id : u, lic };
}

test('formulário: exige algum recorte e valida valores', () => {
  assert.throws(() => normalizarFiltros({}), /Brasil inteiro/);
  assert.throws(() => normalizarFiltros({ ufs: ['ES'], valor_min: 10, valor_max: 5 }), /mínimo/);
  assert.throws(() => normalizarFiltros({ ufs: ['ES'], encerramento: { modo: 'dia' } }), /data/);
  const f = normalizarFiltros({ ufs: ['es', 'XX'], modalidades: ['pregao', 'nada'] });
  assert.deepEqual(f.ufs, ['ES']); assert.deepEqual(f.modalidades, ['pregao']); assert.equal(f.fases.length, 2);
});

test('filtros do perfil: cidade, modalidade, valor, portal, fase, encerramento e itens', () => {
  const { db, lic } = cenario();
  const a = lic('a', { objeto: 'Aquisição de papel A4', mod: 8 });
  const b = lic('b', { objeto: 'Aquisição de papel A4', mun: 'Serra', valor: 90000 });
  lic('c', { objeto: 'Papel A4', uf: 'MG', mun: 'Belo Horizonte' });
  lic('d', { objeto: 'Papel A4', status: 'encerrada' });
  const e = lic('e', { objeto: 'Material de expediente', fim: '2026-10-15T09:00:00', sis: 'bll' });
  const it = db.prepare('INSERT INTO licitacao_itens (licitacao_id, numero_item, descricao) VALUES (?,?,?)');
  it.run(e, 1, 'NOTEBOOK CORE I5 8GB'); it.run(a, 1, 'Resma papel A4 75g');
  const ids = (b0) => idsQueBatem(db, normalizarFiltros(b0), { agora: AGORA }).ids.sort((x, y) => x - y);
  assert.deepEqual(ids({ ufs: ['ES'] }), [a, b, e]);
  assert.deepEqual(ids({ ufs: ['ES'], cidades: ['serra'] }), [b]);
  assert.deepEqual(ids({ ufs: ['ES'], modalidades: ['dispensa'] }), [a]);
  assert.deepEqual(ids({ ufs: ['ES'], valor_max: 50000 }), [a, e]);
  assert.deepEqual(ids({ ufs: ['ES'], sistemas: ['bll'] }), [e]);
  assert.deepEqual(ids({ itens: 'notebook' }), [e]);
  assert.deepEqual(ids({ ufs: ['ES'], produtos: 'papel a4' }), [a, b]);
  assert.deepEqual(ids({ ufs: ['ES'], encerramento: { modo: 'ate', data: '2026-10-15', hora: '10:00' } }), [e]);
  assert.deepEqual(ids({ ufs: ['ES'], encerramento: { modo: 'dia', data: '2026-10-15', hora: '08:00' } }), []);
  assert.deepEqual(ids({ ufs: ['ES'], fases: ['aguardando_propostas'] }), []);
});

test('edição diária: a primeira traz as abertas; as seguintes só as novas; aviso no sino com link', () => {
  const { db, emp, uid, lic } = cenario();
  lic('a', { objeto: 'Papel A4' }); lic('b', { objeto: 'Toner' });
  const id = salvarPerfil(db, emp, uid, { nome: 'Papelaria ES', filtros: { ufs: ['ES'] } });
  const p = perfilDaEmpresa(db, emp, id);
  assert.match(resumoFiltros(p.filtros), /ES · Todas as modalidades/);
  // Antes das 7h não gera
  assert.equal(gerarEdicoesDoDia(db, '2026-10-12T06:59:00'), 0);
  assert.equal(gerarEdicoesDoDia(db, AGORA), 1);
  assert.equal(gerarEdicoesDoDia(db, AGORA), 0); // uma por dia
  const n1 = db.prepare("SELECT * FROM notificacoes WHERE tipo='jornal_diario'").all();
  assert.equal(n1.length, 1); assert.match(n1[0].titulo, /2 oportunidade\(s\) aberta/); assert.equal(n1[0].link, `#/jornal?perfil=${id}&edicao=2026-10-12`);

  // Dia seguinte: só a que entrou depois da edição anterior
  assert.equal(db.prepare('SELECT gerado_em FROM jornal_edicoes').get().gerado_em, '2026-10-12 11:00:00'); // 08h Brasília = 11h UTC
  const c = lic('c', { objeto: 'Caneta', criado: '2026-10-12 20:00:00' });
  gerarEdicoesDoDia(db, '2026-10-13T07:05:00');
  assert.deepEqual(idsDoPerfil(db, p, { edicao: '2026-10-13', agora: '2026-10-13T07:05:00' }).ids, [c]);
  assert.match(db.prepare("SELECT titulo FROM notificacoes WHERE tipo='jornal_diario' ORDER BY id DESC").get().titulo, /1 oportunidade\(s\) nova/);
  assert.equal(idsDoPerfil(db, p, { edicao: 'todas', agora: '2026-10-13T07:05:00' }).total, 3);

  // Sem novidade: edição gravada, sem aviso
  gerarEdicoesDoDia(db, '2026-10-14T07:00:00');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE tipo='jornal_diario'").get().n, 2);
  assert.equal(gerarEdicao(db, p, '2026-10-14T09:00:00').total, 0);
});

test('jornal de obras (caso real do Guido): cidade sem acento, "o que" soma, funil mostra o filtro que zera', () => {
  const { db, emp, uid, lic } = cenario();
  const seg = db.prepare('UPDATE licitacoes SET segmento=? WHERE id=?');
  const a = lic('a', { objeto: 'Reforma da escola municipal', mun: 'Vitória', mod: 4 }); seg.run('Obras e engenharia', a);
  const b = lic('b', { objeto: 'Contratação de empresa de engenharia', mun: 'Vila Velha', mod: 6 }); seg.run('Obras e engenharia', b);
  const c = lic('c', { objeto: 'Aquisição de tintas', mun: 'Cariacica', mod: 8 });
  const it = db.prepare('INSERT INTO licitacao_itens (licitacao_id, numero_item, descricao) VALUES (?,?,?)');
  it.run(c, 1, 'Pintura de parede interna com tinta acrílica');
  // "pintura" no meio da descrição de um móvel não é item de pintura
  const m = lic('m', { objeto: 'Aquisição de mobiliário', mun: 'Vitória', mod: 6 });
  it.run(m, 1, 'Armário de aço com pintura epóxi');
  lic('d', { objeto: 'Reforma de praça', mun: 'Linhares', mod: 4 });
  const filtros = { ufs: ['ES'], cidades: ['Vila velha', 'vitoria', 'serra', 'cariacica'], segmentos: ['Obras e engenharia'],
    produtos: 'obra civil; construção; reforma; pintura', itens: 'obra civil; construção; reforma; pintura', modalidades: ['dispensa', 'pregao'] };
  const ids = (b0) => idsQueBatem(db, normalizarFiltros(b0), { agora: AGORA }).ids.sort((x, y) => x - y);
  // "vitoria" acha "Vitória"; nicho OU produtos OU itens (a de tintas entra pelo item)
  assert.deepEqual(ids({ ...filtros, modalidades: [] }), [a, b, c]);
  // Sem Concorrência a reforma da escola sai
  assert.deepEqual(ids(filtros), [b, c]);
  const funil = funilDoPerfil(db, normalizarFiltros(filtros), AGORA);
  assert.deepEqual(funil.map((e) => e.etapa), ['Estado(s)', 'Cidade(s)', 'Nicho, produtos ou itens', 'Modalidade', 'Fase']);
  assert.deepEqual(funil.map((e) => e.total), [5, 4, 3, 2, 2]);
  // Palavras excluídas tiram pelo objeto
  assert.deepEqual(ids({ ...filtros, modalidades: [], excluir: 'escola; tintas' }), [b]);
  // Primeira edição vazia é refeita quando passa a haver resultado no mesmo dia
  const id = salvarPerfil(db, emp, uid, { nome: 'Obras', filtros: { ufs: ['ES'], cidades: ['Serra'] } });
  assert.equal(gerarEdicao(db, perfilDaEmpresa(db, emp, id), AGORA).total, 0);
  lic('e', { objeto: 'Pavimentação', mun: 'Serra' });
  assert.equal(gerarEdicao(db, perfilDaEmpresa(db, emp, id), AGORA).total, 1);
});

test('excluir olha só o objeto; motivos dizem o que puxou cada licitação', () => {
  const { db, lic } = cenario();
  const ins = db.prepare('UPDATE licitacoes SET informacao_complementar=?, orgao_nome=? WHERE id=?');
  const refeicao = lic('r', { objeto: 'Fornecimento de alimentação (refeições almoço e janta)' });
  ins.run('Não se aplica a obras nem a seguro garantia.', 'Secretaria de Obras', refeicao);
  const bloco = lic('b', { objeto: 'Insumos para produção de blocos estruturais' });
  const it = db.prepare('INSERT INTO licitacao_itens (licitacao_id, numero_item, descricao) VALUES (?,?,?)');
  it.run(bloco, 1, 'Óleo desmoldante para formas');
  const obra = lic('o', { objeto: 'Contratação de obra civil na escola' });
  const f = normalizarFiltros({ ufs: ['ES'], produtos: 'alimentação; refeição; óleo' });
  const ids = (x) => idsQueBatem(db, normalizarFiltros(x), { agora: AGORA }).ids.sort((a, b) => a - b);
  assert.deepEqual(ids(f), [refeicao, bloco]);
  // "obra" e "seguro" no órgão / informação complementar não tiram a de refeições
  assert.deepEqual(ids({ ...f, excluir: 'obra, obra civil, seguro, mobiliario, blocos' }), [refeicao]);
  assert.deepEqual(ids({ ufs: ['ES'], produtos: 'obra', excluir: 'obra civil' }), []);
  const m = motivosDoPerfil(db, f, [refeicao, bloco, obra]);
  assert.match(m.get(refeicao).join(), /produto "alimentação" no objeto/);
  assert.match(m.get(bloco).join(), /produto "óleo" no item "Óleo desmoldante/);
});

test('índice de busca apontando para a linha errada não põe licitação no jornal nem inventa motivo', () => {
  const { db, lic } = cenario();
  const alimento = lic('a', { objeto: 'Aquisição de gêneros alimentícios para merenda' });
  const bloco = lic('b', { objeto: 'Aquisição de insumos para produção de blocos estruturais' });
  // Simula o índice desalinhado visto em produção (13/10/2026): o texto de alimentos indexado na linha dos blocos
  db.prepare('INSERT INTO licitacoes_fts(rowid, objeto, orgao_nome, municipio, informacao_complementar) VALUES (?,?,?,?,?)')
    .run(bloco, 'Aquisição de gêneros alimentícios', '', '', '');
  const f = normalizarFiltros({ ufs: ['ES'], produtos: 'gêneros alimentícios; aquisição de alimentos' });
  assert.deepEqual(idsQueBatem(db, f, { agora: AGORA }).ids, [alimento]);
  const m = motivosDoPerfil(db, f, [alimento, bloco]);
  assert.deepEqual(m.get(bloco), []);
  assert.deepEqual(m.get(alimento), ['produto "gêneros alimentícios" no objeto', 'produto "aquisição alimentos" no objeto']);
});

test('conferência do índice de busca: desalinhado é refeito e volta a achar a linha certa', async () => {
  const { conferirIndiceBusca } = await import('../../server/db/index.js');
  const { db, lic } = cenario();
  lic('a', { objeto: 'Aquisição de gêneros alimentícios' });
  const bloco = lic('b', { objeto: 'Blocos estruturais' });
  assert.equal(conferirIndiceBusca(db, { log: () => {} }).refeito, false);
  db.prepare('INSERT INTO licitacoes_fts(rowid, objeto, orgao_nome, municipio, informacao_complementar) VALUES (?,?,?,?,?)').run(bloco, 'gêneros alimentícios', '', '', '');
  const achar = () => db.prepare("SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH 'genero*'").all().map((x) => x.rowid).sort();
  assert.ok(achar().includes(bloco));
  assert.equal(conferirIndiceBusca(db, { log: () => {} }).refeito, true);
  assert.ok(!achar().includes(bloco));
});

test('produto só no item: entra na edição seguinte quando os itens chegam, sem repetir', () => {
  const { db, emp, uid, lic } = cenario();
  const merenda = lic('m', { objeto: 'Aquisição de gêneros alimentícios', criado: '2026-10-10 10:00:00' });
  const id = salvarPerfil(db, emp, uid, { nome: 'Grupo B', filtros: { ufs: ['ES'], produtos: 'carnes bovinas; carne suína' } });
  const p = () => perfilDaEmpresa(db, emp, id);
  assert.equal(gerarEdicao(db, p(), '2026-10-11T08:00:00').total, 0);
  assert.deepEqual(pendentesDeItens(db, p().filtros, '2026-10-11T08:00:00'), { abertas: 1, sem_itens: 1 });
  // Itens chegam do PNCP depois da edição de 11/10
  db.prepare('INSERT INTO licitacao_itens (licitacao_id, numero_item, descricao) VALUES (?,?,?)').run(merenda, 1, 'CARNE BOVINA tipo acém, congelada');
  db.prepare("UPDATE licitacoes SET detalhes_sincronizados_em='2026-10-11 15:00:00' WHERE id=?").run(merenda);
  const ed = gerarEdicao(db, p(), '2026-10-12T08:00:00');
  assert.deepEqual(JSON.parse(ed.licitacoes), [merenda]);
  assert.equal(gerarEdicao(db, p(), '2026-10-13T08:00:00').total, 0);
});

test('carnes: plural e gênero não importam; expressão de várias palavras vale no meio do item', () => {
  const { db, lic } = cenario();
  const a = lic('a', { objeto: 'Aquisição de gêneros alimentícios' });
  const b = lic('b', { objeto: 'Aquisição de gêneros alimentícios para merenda' });
  const c = lic('c', { objeto: 'Aquisição de material de pintura' });
  const it = db.prepare('INSERT INTO licitacao_itens (licitacao_id, numero_item, descricao) VALUES (?,?,?)');
  it.run(a, 1, 'PEITO DE FRANGO CONGELADO, embalagem 1 kg');
  it.run(b, 1, 'Carne suíno, pernil sem osso');
  it.run(c, 1, 'Armário de aço com pintura epóxi');
  const ids = (x) => idsQueBatem(db, normalizarFiltros(x), { agora: AGORA }).ids.sort((p, q) => p - q);
  assert.deepEqual(ids({ ufs: ['ES'], produtos: 'frango congelado; carne suína' }), [a, b]);
  assert.deepEqual(ids({ ufs: ['ES'], itens: 'frango congelado' }), [a]);
  // Palavra única continua tendo de abrir o item
  assert.deepEqual(ids({ ufs: ['ES'], itens: 'pintura' }), []);
});

test('cidades: nome oficial é exato (Serra não pega Serra do Salitre); lista do IBGE tem os 78 do ES', async () => {
  const { MUNICIPIOS_IBGE } = await import('../../server/services/municipios.js');
  assert.equal(MUNICIPIOS_IBGE.ES.length, 78);
  for (const c of ['Vila Velha', 'Vitória', 'Cariacica', 'Serra', 'Guarapari', 'Viana', 'Fundão']) assert.ok(MUNICIPIOS_IBGE.ES.includes(c), c);
  const { db, lic } = cenario();
  const serra = lic('s', { objeto: 'Papel A4', mun: 'Serra' });
  lic('x', { objeto: 'Papel A4', uf: 'MG', mun: 'Serra do Salitre' });
  const gv = lic('g', { objeto: 'Papel A4', mun: 'Guarapari' });
  const ids = (x) => idsQueBatem(db, normalizarFiltros(x), { agora: AGORA }).ids.sort((a, b) => a - b);
  assert.deepEqual(ids({ ufs: [], cidades: ['Serra'] }), [serra]);
  assert.deepEqual(ids({ ufs: ['ES'], cidades: ['serra', 'GUARAPARI'] }), [serra, gv]);
});
