import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture } from '../helpers.js';
import { criarApp } from '../../server/app.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens } from '../../server/services/repositorio.js';
import { criarFornecedor, atualizarFornecedor, excluirFornecedor, listarFornecedores, itensQueCombinam, precoMinimo,
  cotacoesDaOportunidade, registrarCotacoes, escolherCotacao, salvarParametros } from '../../server/services/fornecedores.js';

// Base de TESTE: registro real do PNCP com itens de exemplo (identificados como dados de teste)
function preparar() {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Empresa Teste')").run().lastInsertRowid);
  const outra = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Outra conta')").run().lastInsertRowid);
  const u = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@teste.com', senha: 'SenhaForte123', papel: 'admin' });
  const bruto = fixture('pncp-contratacao-real');
  const lic = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, '2026-10-10T12:00:00').id;
  const item = (n, descricao, quantidade, valor) => ({ numero_item: n, descricao, quantidade, unidade_medida: 'UN', valor_unitario_estimado: valor, valor_total_estimado: valor == null ? null : valor * quantidade, material_servico: 'Material' });
  salvarItens(db, lic, [item(1, 'PAPEL A4 BRANCO 75G RESMA 500 FOLHAS', 100, 30), item(2, 'TONER HP 85A ORIGINAL', 10, 250), item(3, 'CANETA ESFEROGRAFICA AZUL', 500, null)], 'pncp', '2026-10-10T12:00:00');
  const et = Number(db.prepare("INSERT INTO kanban_etapas (empresa_id, nome, ordem) VALUES (?, 'Nova', 0)").run(emp).lastInsertRowid);
  const op = Number(db.prepare('INSERT INTO oportunidades (empresa_id, licitacao_id, etapa_id) VALUES (?,?,?)').run(emp, lic, et).lastInsertRowid);
  return { db, emp, outra, u: typeof u === 'object' ? u.id : u, lic, op };
}

test('cadastro de fornecedor: CNPJ opcional mas válido, sem duplicar, excluir só sem cotação', () => {
  const { db, emp, outra, u, op } = preparar();
  assert.throws(() => criarFornecedor(db, emp, { razao_social: 'X', cnpj: '11.111.111/1111-11' }), /CNPJ inválido/);
  assert.throws(() => criarFornecedor(db, emp, { cnpj: '' }), /nome do fornecedor/);
  const a = criarFornecedor(db, emp, { razao_social: 'Distribuidora Papel', cnpj: '01107321000152', produtos: 'papel A4, resma; papel A4', pedido_minimo: '500' });
  assert.throws(() => criarFornecedor(db, emp, { razao_social: 'Repetido', cnpj: '01.107.321/0001-52' }), /já está cadastrado/);
  assert.ok(criarFornecedor(db, outra, { razao_social: 'Mesmo CNPJ em outra conta', cnpj: '01107321000152' }));  // contas separadas
  const b = criarFornecedor(db, emp, { razao_social: 'Sem CNPJ Ltda' });
  const f = db.prepare('SELECT * FROM fornecedores WHERE id=?').get(a);
  assert.equal(f.produtos, 'papel A4; resma');          // vírgula vira ";" e repetido sai
  assert.equal(f.pedido_minimo, 500);
  assert.equal(f.prazo_entrega_dias, null);              // não informado, não zero
  assert.equal(listarFornecedores(db, emp).length, 2);
  assert.equal(listarFornecedores(db, emp, { q: 'resma' }).length, 1);
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, itens: [{ numero_item: 1, preco_unitario: '22,5' }] });
  assert.throws(() => excluirFornecedor(db, emp, a), /Desative/);
  assert.ok(atualizarFornecedor(db, emp, a, { ativo: false }));
  assert.equal(listarFornecedores(db, emp, { ativos: true }).length, 1);
  assert.ok(excluirFornecedor(db, emp, b));
  assert.equal(excluirFornecedor(db, outra, a), false);  // outra conta não mexe
});

test('fornecedor sugerido pelos produtos que combinam com a descrição do item', () => {
  const itens = [{ numero_item: 1, descricao: 'PAPEL A4 BRANCO 75G RESMA' }, { numero_item: 2, descricao: 'TONER HP 85A ORIGINAL' }, { numero_item: 3, descricao: 'Cartuchos de tinta preta' }];
  assert.deepEqual(itensQueCombinam('papel A4; toner', itens), [1, 2]);
  assert.deepEqual(itensQueCombinam('cartucho', itens), [3]);          // singular acha plural
  assert.deepEqual(itensQueCombinam('papel A3', itens), []);           // todas as palavras da expressão
  assert.deepEqual(itensQueCombinam(null, itens), []);
});

test('preço mínimo pelo divisor: custo ÷ (1 − impostos − margem)', () => {
  assert.equal(precoMinimo(80, 8, 15), 103.9);
  assert.equal(precoMinimo(80, null, null), 80);
  assert.equal(precoMinimo(80, 60, 40), null);
  assert.equal(precoMinimo(null, 8, 15), null);
});

test('cotações: usa a escolhida ou a mais barata, compara com o estimado e não inventa referência', () => {
  const { db, emp, u, op } = preparar();
  const a = criarFornecedor(db, emp, { razao_social: 'A', produtos: 'papel A4' });
  const b = criarFornecedor(db, emp, { razao_social: 'B', produtos: 'toner; caneta' });
  assert.throws(() => registrarCotacoes(db, emp, op, u, { fornecedor_id: a, itens: [{ numero_item: 9, preco_unitario: 1 }] }), /não existe/);
  assert.throws(() => registrarCotacoes(db, emp, op, u, { fornecedor_id: a, itens: [{ numero_item: 1, preco_unitario: 0 }] }), /zero não é cotação/);
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, frete_incluso: '1', validade: '2026-11-10', itens: [{ numero_item: 1, preco_unitario: '24' }, { numero_item: 2, preco_unitario: '' }] });
  registrarCotacoes(db, emp, op, u, { fornecedor_id: b, itens: [{ numero_item: 1, preco_unitario: 22 }, { numero_item: 2, preco_unitario: '260' }, { numero_item: 3, preco_unitario: '0,80' }] });
  let r = cotacoesDaOportunidade(db, emp, op);
  const [i1, i2, i3] = r.itens;
  assert.equal(i1.custo_unitario, 22);                    // B é mais barato
  assert.equal(i1.margem_bruta_pct, 26.67);               // (30 − 22) ÷ 30
  assert.equal(i1.situacao, 'ok');
  assert.equal(i2.situacao, 'acima');                     // 260 > 250
  assert.equal(i3.situacao, 'sem_referencia');            // item sem valor estimado
  assert.equal(i3.margem_bruta_pct, null);
  assert.equal(r.resumo.cotados, 3);
  assert.equal(r.resumo.custo_total, 22 * 100 + 260 * 10 + 0.8 * 500);
  assert.equal(r.resumo.estimado_cotados, 30 * 100 + 250 * 10);   // só itens com referência
  assert.deepEqual(r.fornecedores.find((f) => f.id === b).combina, [2, 3]);

  // escolher a cotação mais cara (ex.: prazo ou marca melhor)
  const cotA = i1.cotacoes.find((c) => c.fornecedor_id === a);
  escolherCotacao(db, emp, op, cotA.id);
  salvarParametros(db, emp, op, { impostos_pct: '8', margem_pct: '15' });
  r = cotacoesDaOportunidade(db, emp, op);
  assert.equal(r.itens[0].custo_unitario, 24);
  assert.equal(r.itens[0].preco_minimo, 31.17);           // 24 ÷ 0,77
  assert.equal(r.itens[0].situacao, 'acima');             // 31,17 > 30
  assert.throws(() => salvarParametros(db, emp, op, { impostos_pct: 50, margem_pct: 50 }), /menos de 100/);

  // apagar o preço remove a cotação daquele item
  const out = registrarCotacoes(db, emp, op, u, { fornecedor_id: b, itens: [{ numero_item: 3, preco_unitario: '' }] });
  assert.equal(out.removidos, 1);
  assert.equal(cotacoesDaOportunidade(db, emp, op).itens[2].situacao, 'sem_cotacao');
});

test('API: cotações e fornecedores ficam na conta de quem cadastrou', async () => {
  const { db, emp, outra, op } = preparar();
  criarUsuario(db, { empresaId: outra, nome: 'Bruno', email: 'b@outra.com', senha: 'SenhaForte123', papel: 'admin' });
  const servidor = criarApp().listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const entrar = async (email) => {
      const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email, senha: 'SenhaForte123' }) });
      const cookie = r.headers.get('set-cookie').split(';')[0];
      return (p, o = {}) => fetch(`${base}/api${p}`, { ...o, headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'licita' } });
    };
    const ana = await entrar('ana@teste.com'); const bruno = await entrar('b@outra.com');
    const cri = await ana('/fornecedores', { method: 'POST', body: JSON.stringify({ razao_social: 'Papelaria Teste', produtos: 'papel A4' }) });
    assert.equal(cri.status, 201);
    const { id } = await cri.json();
    const reg = await ana(`/kanban/${op}/cotacoes`, { method: 'POST', body: JSON.stringify({ fornecedor_id: id, itens: [{ numero_item: 1, preco_unitario: '21,90' }] }) });
    assert.equal(reg.status, 200);
    const d = await (await ana(`/kanban/${op}/cotacoes`)).json();
    assert.equal(d.itens[0].custo_unitario, 21.9);
    assert.equal((await bruno(`/kanban/${op}/cotacoes`)).status, 404);
    assert.equal((await bruno(`/kanban/${op}/cotacoes`, { method: 'POST', body: JSON.stringify({ fornecedor_id: id, itens: [{ numero_item: 1, preco_unitario: 1 }] }) })).status, 404);
    assert.equal((await (await bruno('/fornecedores')).json()).fornecedores.length, 0);
    const hist = db.prepare("SELECT texto FROM oportunidade_historico WHERE oportunidade_id=? AND tipo='cotacao'").all(op);
    assert.match(hist[0].texto, /Papelaria Teste: 1 item/);
  } finally { servidor.close(); }
});
