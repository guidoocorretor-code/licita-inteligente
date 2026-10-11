import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture } from '../helpers.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens } from '../../server/services/repositorio.js';
import { criarFornecedor, registrarCotacoes, salvarParametros } from '../../server/services/fornecedores.js';
import { propostaDaOportunidade, salvarProposta, mudarStatusProposta, listarPropostas, centavoAcima } from '../../server/services/propostas.js';
import { reaisPorExtenso, inteiroPorExtenso } from '../../web/js/extenso.js';

test('valor por extenso', () => {
  assert.equal(reaisPorExtenso(1234.56), 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos');
  assert.equal(reaisPorExtenso(479810.45), 'quatrocentos e setenta e nove mil oitocentos e dez reais e quarenta e cinco centavos');
  assert.equal(reaisPorExtenso(1), 'um real');
  assert.equal(reaisPorExtenso(0.01), 'um centavo');
  assert.equal(reaisPorExtenso(2020), 'dois mil e vinte reais');
  assert.equal(reaisPorExtenso(1000000), 'um milhão de reais');
  assert.equal(reaisPorExtenso(1500000), 'um milhão e quinhentos mil reais');
  assert.equal(reaisPorExtenso(100), 'cem reais');
  assert.equal(reaisPorExtenso(101), 'cento e um reais');
  assert.equal(inteiroPorExtenso(60), 'sessenta');
});

test('preço sugerido arredonda para cima no centavo', () => {
  assert.equal(centavoAcima(10.123), 10.13);
  assert.equal(centavoAcima(10.12), 10.12);
  assert.equal(centavoAcima(0.1 + 0.2), 0.3);
});

function preparar() {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Conta Teste')").run().lastInsertRowid);
  const outra = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Outra')").run().lastInsertRowid);
  const u = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@teste.com', senha: 'SenhaForte123', papel: 'admin' });
  const uid = typeof u === 'object' ? u.id : u;
  const bruto = fixture('pncp-contratacao-real');
  const lic = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, '2026-10-10T12:00:00').id;
  const item = (n, descricao, valor) => ({ numero_item: n, descricao, quantidade: 10, unidade_medida: 'UN', valor_unitario_estimado: valor, valor_total_estimado: valor * 10, material_servico: 'Material' });
  salvarItens(db, lic, [item(1, 'PAPEL A4', 30), item(2, 'TONER HP 85A', 250), item(3, 'CANETA AZUL', 2)], 'pncp', '2026-10-10T12:00:00');
  const cli = Number(db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social, porte) VALUES (?, '11222333000181', 'Empresa Teste', 'ME')").run(emp).lastInsertRowid);
  const et = Number(db.prepare("INSERT INTO kanban_etapas (empresa_id, nome, ordem) VALUES (?, 'Nova', 0)").run(emp).lastInsertRowid);
  const op = Number(db.prepare('INSERT INTO oportunidades (empresa_id, licitacao_id, etapa_id, cliente_id) VALUES (?,?,?,?)').run(emp, lic, et, cli).lastInsertRowid);
  const forn = criarFornecedor(db, emp, { razao_social: 'Fornecedor Teste' });
  registrarCotacoes(db, emp, op, uid, { fornecedor_id: forn, prazo_entrega_dias: '15', itens: [{ numero_item: 1, preco_unitario: '20', marca_modelo: 'Chamex' }, { numero_item: 2, preco_unitario: '240' }] });
  salvarParametros(db, emp, op, { impostos_pct: 10, margem_pct: 15 });
  return { db, emp, outra, uid, op };
}

test('sugestão da proposta vem das cotações: preço mínimo, marca, prazo e declaração ME/EPP', () => {
  const { db, emp, op } = preparar();
  const d = propostaDaOportunidade(db, emp, op);
  assert.equal(d.proposta.id, null);
  const [i1, i2, i3] = d.itens;
  assert.equal(i1.preco_unitario, centavoAcima(20 / 0.75));          // custo ÷ (1 − 10% − 15%)
  assert.equal(i1.marca, 'Chamex');
  assert.equal(i1.incluir, true);
  assert.equal(i3.incluir, false);                                    // sem cotação: fica de fora
  assert.equal(i2.acima_estimado, true);                              // 240/0,75 = 320 > 250
  assert.equal(d.resumo.acima_estimado, 1);
  assert.match(d.proposta.prazo_entrega, /^15 dias/);
  assert.ok(d.proposta.declaracoes.includes('me_epp'));
  assert.equal(d.proposta.validade_dias, 60);
});

test('salvar, mudar situação e listar; outra conta não vê', () => {
  const { db, emp, outra, uid, op } = preparar();
  assert.throws(() => mudarStatusProposta(db, emp, op, uid, 'pronta'), /Salve a proposta/);
  assert.throws(() => salvarProposta(db, emp, op, uid, { itens: [{ numero_item: 1, incluir: true, preco_unitario: '-1' }] }), /preço inválido/);
  salvarProposta(db, emp, op, uid, { validade_dias: '90', declaracoes: ['tributos', 'xxx'], itens: [
    { numero_item: 1, incluir: true, preco_unitario: '29,90', marca: 'Chamex', modelo: 'A4 75g' },
    { numero_item: 2, incluir: true, preco_unitario: null },
    { numero_item: 3, incluir: false },
  ] });
  let d = propostaDaOportunidade(db, emp, op);
  assert.equal(d.proposta.validade_dias, 90);
  assert.deepEqual(d.proposta.declaracoes, ['tributos']);
  assert.equal(d.itens[0].preco_unitario, 29.9);
  assert.equal(d.itens[0].modelo, 'A4 75g');
  assert.throws(() => mudarStatusProposta(db, emp, op, uid, 'pronta'), /sem preço/);
  salvarProposta(db, emp, op, uid, { validade_dias: '90', itens: [{ numero_item: 2, incluir: false }] });
  mudarStatusProposta(db, emp, op, uid, 'enviada');
  d = propostaDaOportunidade(db, emp, op);
  assert.equal(d.proposta.status, 'enviada');
  assert.ok(d.proposta.enviada_em);
  assert.equal(d.resumo.total, 299);
  const l = listarPropostas(db, emp, {});
  assert.equal(l.propostas.length, 1);
  assert.equal(l.propostas[0].total, 299);
  assert.equal(l.contagem.enviada, 1);
  assert.equal(listarPropostas(db, outra, {}).propostas.length, 0);
  assert.throws(() => propostaDaOportunidade(db, outra, op), /não encontrada/);
});
