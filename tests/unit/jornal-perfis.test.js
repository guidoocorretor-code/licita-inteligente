// Jornais salvos: filtros do perfil, edição diária só com novidades e aviso. DADOS DE TESTE fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { normalizarFiltros, filtroDoPerfil, salvarPerfil, perfilDaEmpresa, gerarEdicao, gerarEdicoesDoDia, idsDoPerfil, resumoFiltros } from '../../server/services/jornal-perfis.js';
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
  const ids = (b0) => { const { where, params } = filtroDoPerfil(normalizarFiltros(b0), { agora: AGORA }); return db.prepare(`SELECT l.id FROM licitacoes l ${where} ORDER BY l.id`).all(...params).map((x) => x.id); };
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
