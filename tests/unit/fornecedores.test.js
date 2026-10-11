import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture } from '../helpers.js';
import { criarApp } from '../../server/app.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens } from '../../server/services/repositorio.js';
import { criarFornecedor, atualizarFornecedor, excluirFornecedor, listarFornecedores, itensQueCombinam, precoMinimo,
  cotacoesDaOportunidade, registrarCotacoes, escolherCotacao, salvarParametros, margemNoPreco, registrarPedido, mudarStatusPedido } from '../../server/services/fornecedores.js';

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
  assert.equal(i1.margem_estimado_pct, 26.67);               // (30 − 22) ÷ 30
  assert.equal(i1.situacao, 'ok');
  assert.equal(i2.situacao, 'acima');                     // 260 > 250
  assert.equal(i3.situacao, 'sem_referencia');            // item sem valor estimado
  assert.equal(i3.margem_estimado_pct, null);
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

test('pagamento: formas marcadas, prazo do boleto só com boleto e venda à ordem', () => {
  const { db, emp } = preparar();
  const ler = (id) => db.prepare('SELECT formas_pagamento, boleto_prazo, venda_a_ordem, condicoes_pagamento FROM fornecedores WHERE id=?').get(id);
  const a = criarFornecedor(db, emp, { razao_social: 'A', formas_pagamento: ['pix', 'boleto'], boleto_prazo: '30 / 60 / 90', venda_a_ordem: '1' });
  assert.deepEqual({ ...ler(a) }, { formas_pagamento: 'boleto,pix', boleto_prazo: '30/60/90', venda_a_ordem: 1, condicoes_pagamento: null });
  const b = criarFornecedor(db, emp, { razao_social: 'B', formas_pagamento: ['pix'], boleto_prazo: '30' });
  assert.equal(ler(b).boleto_prazo, null);                         // sem boleto marcado, prazo não vale
  assert.equal(ler(b).venda_a_ordem, null);                        // não informado, não "não"
  assert.equal(ler(criarFornecedor(db, emp, { razao_social: 'C', formas_pagamento: 'boleto', boleto_prazo: '28 dias' })).boleto_prazo, '28');
  assert.equal(ler(criarFornecedor(db, emp, { razao_social: 'D', formas_pagamento: 'boleto', boleto_prazo: 'à vista' })).boleto_prazo, '0');
  assert.throws(() => criarFornecedor(db, emp, { razao_social: 'E', formas_pagamento: 'boleto', boleto_prazo: '60/30' }), /depois da anterior/);
  assert.throws(() => criarFornecedor(db, emp, { razao_social: 'F', formas_pagamento: ['cheque'] }), /inválida/);
  // edição mantém o texto antigo e troca as opções
  db.prepare("UPDATE fornecedores SET condicoes_pagamento='28 DIAS' WHERE id=?").run(b);
  atualizarFornecedor(db, emp, b, { formas_pagamento: ['boleto', 'cartao'], boleto_prazo: '30/60', venda_a_ordem: '0' });
  assert.deepEqual({ ...ler(b) }, { formas_pagamento: 'boleto,cartao', boleto_prazo: '30/60', venda_a_ordem: 0, condicoes_pagamento: '28 DIAS' });
});

test('cartão: parcelas e juros só valem com cartão marcado', () => {
  const { db, emp } = preparar();
  const ler = (id) => ({ ...db.prepare('SELECT cartao_parcelas, cartao_juros FROM fornecedores WHERE id=?').get(id) });
  assert.deepEqual(ler(criarFornecedor(db, emp, { razao_social: 'A', formas_pagamento: ['cartao'], cartao_parcelas: '10', cartao_juros: '0' })), { cartao_parcelas: 10, cartao_juros: 0 });
  assert.deepEqual(ler(criarFornecedor(db, emp, { razao_social: 'B', formas_pagamento: ['pix'], cartao_parcelas: '10', cartao_juros: '1' })), { cartao_parcelas: null, cartao_juros: null });
  assert.deepEqual(ler(criarFornecedor(db, emp, { razao_social: 'C', formas_pagamento: ['cartao'] })), { cartao_parcelas: null, cartao_juros: null }); // não informado
  assert.throws(() => criarFornecedor(db, emp, { razao_social: 'D', formas_pagamento: ['cartao'], cartao_parcelas: '30' }), /Parcelas do cartão/);
});

test('margem no estimado desconta os impostos e é comparável com a margem desejada', () => {
  // Caso real do Guido: estimado 479.810,45, custo 380.000, impostos 5% -> ~15,8% (e não 20,8% bruto)
  assert.equal(Math.round(margemNoPreco(479810.45, 380000, 5) * 10) / 10, 15.8);
  assert.equal(Math.round(margemNoPreco(479810.45, 380000, null) * 10) / 10, 20.8);
  // vendendo exatamente pelo preço mínimo, a margem é a desejada
  const min = precoMinimo(80, 8, 15);
  assert.equal(Math.round(margemNoPreco(min, 80, 8) * 100) / 100, 15);
  const { db, emp, u, op } = preparar();
  const a = criarFornecedor(db, emp, { razao_social: 'A' });
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, itens: [{ numero_item: 1, preco_unitario: '20' }] });
  salvarParametros(db, emp, op, { impostos_pct: '10', margem_pct: '15' });
  assert.equal(cotacoesDaOportunidade(db, emp, op).itens[0].margem_estimado_pct, 23.33); // (30×0,9 − 20) ÷ 30
});

test('pedido de cotação: aguardando até a resposta, sem retorno e isolado por conta', () => {
  const { db, emp, outra, u, op } = preparar();
  const a = criarFornecedor(db, emp, { razao_social: 'A' });
  const b = criarFornecedor(db, outra, { razao_social: 'De outra conta' });
  assert.throws(() => registrarPedido(db, emp, op, u, { fornecedor_id: a, canal: 'whatsapp', itens: [] }), /pelo menos um item/);
  assert.throws(() => registrarPedido(db, emp, op, u, { fornecedor_id: a, canal: 'pombo', itens: [1] }), /Canal/);
  assert.throws(() => registrarPedido(db, emp, op, u, { fornecedor_id: b, canal: 'email', itens: [1] }), /fornecedor/);
  assert.throws(() => registrarPedido(db, outra, op, u, { fornecedor_id: b, canal: 'email', itens: [1] }), /não encontrada/);
  const p1 = registrarPedido(db, emp, op, u, { fornecedor_id: a, canal: 'email', itens: [2, 1, 99, 1] });
  let d = cotacoesDaOportunidade(db, emp, op);
  assert.deepEqual(d.pedidos[0].itens, [1, 2]);                       // item inexistente sai, repetido sai
  assert.equal(d.pedidos[0].status, 'aguardando');
  assert.match(db.prepare("SELECT texto FROM oportunidade_historico WHERE tipo='cotacao'").get().texto, /e-mail \(2 item/);
  assert.equal(registrarPedido(db, emp, op, u, { fornecedor_id: a, canal: 'whatsapp', itens: [3] }), p1); // reenvio junta no pedido aberto
  assert.deepEqual(cotacoesDaOportunidade(db, emp, op).pedidos.map((p) => p.itens), [[1, 2, 3]]);
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, itens: [{ numero_item: 1, preco_unitario: '20' }] });
  d = cotacoesDaOportunidade(db, emp, op);
  assert.equal(d.pedidos[0].status, 'respondido');
  assert.ok(d.pedidos[0].respondido_em);
  assert.equal(d.fornecedores_cotados[0].id, a);
  const p2 = registrarPedido(db, emp, op, u, { fornecedor_id: a, canal: 'whatsapp', itens: [3] });
  mudarStatusPedido(db, emp, op, p2, 'sem_retorno');
  assert.equal(cotacoesDaOportunidade(db, emp, op).pedidos.find((p) => p.id === p2).status, 'sem_retorno');
  assert.throws(() => mudarStatusPedido(db, emp, op, p1, 'respondido'), /inválida/);
  assert.throws(() => mudarStatusPedido(db, outra, op, p2, 'aguardando'), /não encontrada/);
});

test('frete FOB entra no custo, rateado pelo valor dos itens; FOB sem valor fica pendente', () => {
  const { db, emp, u, op } = preparar();
  const a = criarFornecedor(db, emp, { razao_social: 'A' });
  // itens 1 (100 × 20 = 2.000) e 2 (10 × 200 = 2.000): frete 400 → 200 para cada → +2,00/un no item 1 e +20,00/un no item 2
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, frete: 'FOB', transportadora: 'Transp X', valor_frete: '400', itens: [{ numero_item: 1, preco_unitario: '20' }, { numero_item: 2, preco_unitario: '200' }] });
  let d = cotacoesDaOportunidade(db, emp, op);
  assert.equal(d.itens[0].custo_unitario, 22); assert.equal(d.itens[0].preco_fornecedor, 20); assert.equal(d.itens[0].frete, 'FOB');
  assert.equal(d.itens[1].custo_unitario, 220);
  assert.equal(d.resumo.frete_total, 400);
  assert.equal(d.resumo.custo_total, 4400);
  assert.equal(d.fretes_fornecedor[0].transportadora, 'Transp X');
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, frete: 'FOB', itens: [{ numero_item: 1, preco_unitario: '21' }] });
  assert.equal(cotacoesDaOportunidade(db, emp, op).resumo.frete_total, 400);      // sem transportadora/valor no envio: mantém o informado
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, frete: 'FOB', transportadora: '', valor_frete: '', itens: [{ numero_item: 1, preco_unitario: '20' }] });
  d = cotacoesDaOportunidade(db, emp, op);
  assert.equal(d.itens[0].frete_pendente, true);                     // FOB sem valor: avisa, não inventa zero
  assert.equal(d.resumo.fretes_pendentes, 2);
  registrarCotacoes(db, emp, op, u, { fornecedor_id: a, frete: 'CIF', itens: [{ numero_item: 1, preco_unitario: '20' }] });
  d = cotacoesDaOportunidade(db, emp, op);
  assert.equal(d.itens[0].custo_unitario, 20); assert.equal(d.itens[0].frete_unitario, 0); assert.equal(d.itens[0].frete_pendente, false);
  assert.throws(() => registrarCotacoes(db, emp, op, u, { fornecedor_id: a, frete: 'XYZ', itens: [{ numero_item: 1, preco_unitario: '20' }] }), /CIF ou FOB/);
});

test('regime tributário calcula os impostos no servidor', () => {
  const { db, emp, op } = preparar();
  assert.deepEqual(salvarParametros(db, emp, op, { margem_pct: '15', tributos: { regime: 'simples', anexo: 'I', rbt12: '500000', impostos_pct: '99' } }), { impostos_pct: 6.73 });
  const d = cotacoesDaOportunidade(db, emp, op);
  assert.equal(d.parametros.impostos_pct, 6.73);
  assert.equal(d.parametros.tributos.regime, 'simples');
  assert.throws(() => salvarParametros(db, emp, op, { tributos: { regime: 'simples', anexo: 'I', rbt12: '9000000' } }), /sai do Simples/);
});
