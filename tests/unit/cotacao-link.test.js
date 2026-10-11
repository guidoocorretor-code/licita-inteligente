import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture } from '../helpers.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens } from '../../server/services/repositorio.js';
import { criarFornecedor, cotacoesDaOportunidade, registrarCotacoes, registrarPedido, listarPedidos, mudarStatusPedido } from '../../server/services/fornecedores.js';
import { linkDoFornecedor, cotacaoPublica, responderCotacao, revogarLink } from '../../server/services/cotacao-link.js';

// Base de TESTE com itens de exemplo
function preparar({ encerra = '2099-12-31T10:00:00' } = {}) {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Conta Teste')").run().lastInsertRowid);
  const outra = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Outra')").run().lastInsertRowid);
  const u = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@teste.com', senha: 'SenhaForte123', papel: 'admin' });
  const bruto = fixture('pncp-contratacao-real');
  const lic = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, '2026-10-10T12:00:00').id;
  db.prepare('UPDATE licitacoes SET data_encerramento_proposta=? WHERE id=?').run(encerra, lic);
  const item = (n, descricao, valor) => ({ numero_item: n, descricao, quantidade: 10, unidade_medida: 'UN', valor_unitario_estimado: valor, valor_total_estimado: valor * 10, material_servico: 'Material' });
  salvarItens(db, lic, [item(1, 'PAPEL A4', 30), item(2, 'TONER HP 85A', 250), item(3, 'CANETA AZUL', 2)], 'pncp', '2026-10-10T12:00:00');
  const et = Number(db.prepare("INSERT INTO kanban_etapas (empresa_id, nome, ordem) VALUES (?, 'Nova', 0)").run(emp).lastInsertRowid);
  const op = Number(db.prepare('INSERT INTO oportunidades (empresa_id, licitacao_id, etapa_id) VALUES (?,?,?)').run(emp, lic, et).lastInsertRowid);
  const uid = typeof u === 'object' ? u.id : u;
  const forn = criarFornecedor(db, emp, { razao_social: 'Fornecedor Teste' });
  return { db, emp, outra, u: uid, op, forn };
}

test('link do fornecedor: mesmo link nos reenvios, só os itens pedidos e sem valor estimado', () => {
  const { db, emp, u, op, forn } = preparar();
  const a = linkDoFornecedor(db, emp, op, u, { fornecedor_id: forn, itens: [1] });
  const b = linkDoFornecedor(db, emp, op, u, { fornecedor_id: forn, itens: [2] });
  assert.equal(a.token, b.token);
  const pub = cotacaoPublica(db, a.token);
  assert.deepEqual(pub.itens.map((i) => i.numero_item), [2]);          // nada enviado ainda: só o marcado agora
  registrarPedido(db, emp, op, u, { fornecedor_id: forn, canal: 'email', itens: [2] });
  linkDoFornecedor(db, emp, op, u, { fornecedor_id: forn, itens: [3] });
  assert.deepEqual(cotacaoPublica(db, a.token).itens.map((i) => i.numero_item), [2, 3]); // o já pedido continua no link
  assert.ok(!JSON.stringify(pub).includes('valor_unitario_estimado'));
  assert.ok(!JSON.stringify(pub).includes('250'));                       // estimado do toner não vaza
  assert.equal(pub.fornecedor, 'Fornecedor Teste');
  assert.equal(pub.licitacao, undefined);                                // nada da licitação vai para o fornecedor
  assert.ok(!/orgao|municipio|objeto|propostas|expira/.test(JSON.stringify(pub)));
});

test('link: assinatura, revogação, prazo e outra conta', () => {
  const { db, emp, outra, u, op, forn } = preparar();
  const { token } = linkDoFornecedor(db, emp, op, u, { fornecedor_id: forn, itens: [1] });
  const [nonce] = token.split('.');
  assert.throws(() => cotacaoPublica(db, `${nonce}.${'A'.repeat(32)}`), /inválido/);   // assinatura errada
  assert.throws(() => cotacaoPublica(db, 'lixo'), /inválido/);
  assert.throws(() => linkDoFornecedor(db, outra, op, u, { fornecedor_id: forn, itens: [1] }), /não encontrada/);
  assert.equal(revogarLink(db, outra, op, forn), false);
  assert.equal(revogarLink(db, emp, op, forn), true);
  assert.throws(() => cotacaoPublica(db, token), /não está mais ativo/);
  const v = preparar({ encerra: '2020-01-01T10:00:00' });
  const t2 = linkDoFornecedor(v.db, v.emp, v.op, v.u, { fornecedor_id: v.forn, itens: [1] }).token;
  assert.throws(() => cotacaoPublica(v.db, t2), (e) => e.status === 410);
});

test('resposta pelo link entra na cotação, marca o pedido como respondido e avisa a equipe', () => {
  const { db, emp, u, op, forn } = preparar();
  registrarPedido(db, emp, op, u, { fornecedor_id: forn, canal: 'whatsapp', itens: [1, 2] });
  registrarCotacoes(db, emp, op, u, { fornecedor_id: forn, frete: 'FOB', transportadora: 'Transp', valor_frete: '50', itens: [{ numero_item: 3, preco_unitario: '1' }] });
  const { token } = linkDoFornecedor(db, emp, op, u, { fornecedor_id: forn, itens: [1, 2] });
  assert.throws(() => responderCotacao(db, token, { itens: [{ numero_item: 1, preco_unitario: '20' }] }), /seu nome/);
  assert.throws(() => responderCotacao(db, token, { respondente: 'Zé', itens: [{ numero_item: 1, preco_unitario: '' }] }), /pelo menos um item/);
  const r = responderCotacao(db, token, { respondente: 'Zé Vendas', frete: 'FOB', prazo_entrega_dias: '7', condicoes_pagamento: 'boleto 30',
    itens: [{ numero_item: 1, preco_unitario: '20,50', marca_modelo: 'Chamex' }, { numero_item: 3, preco_unitario: '0,01' }, { numero_item: 2, preco_unitario: '' }] });
  assert.equal(r.gravados, 1);                                             // item 3 não foi pedido no link: ignorado
  const d = cotacoesDaOportunidade(db, emp, op);
  const c = d.itens[0].cotacoes[0];
  assert.equal(c.preco_unitario, 20.5); assert.equal(c.origem, 'fornecedor'); assert.equal(c.respondente, 'Zé Vendas'); assert.equal(c.condicoes_pagamento, 'boleto 30');
  assert.equal(d.itens[2].cotacoes[0].preco_unitario, 1);                   // cotação do item 3 da equipe intacta
  assert.equal(d.fretes_fornecedor[0].valor, 50);                           // FOB pelo fornecedor não apaga o valor que a equipe informou
  assert.equal(d.pedidos[0].status, 'respondido');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE tipo='cotacao' AND usuario_id=?").get(u).n, 1);
  assert.ok(cotacaoPublica(db, token).respondido_em);
  assert.equal(cotacaoPublica(db, token).itens[0].resposta.preco_unitario, 20.5); // pode corrigir depois
});

test('página do link tira da descrição os trechos que citam órgão, cidade ou convênio', () => {
  const { db, emp, u, op, forn } = preparar();
  db.prepare("UPDATE licitacao_itens SET descricao=? WHERE numero_item=1").run('Papel A4 75g para atender a Prefeitura Municipal de Bernardo Sayão - TO. Convênio nº 980858/2025.');
  const { token } = linkDoFornecedor(db, emp, op, u, { fornecedor_id: forn, itens: [1] });
  const desc = cotacaoPublica(db, token).itens[0].descricao;
  assert.equal(desc, 'Papel A4 75g para atender.');
});

test('lista de pedidos da conta: filtro por situação, contagem e outra conta', () => {
  const { db, emp, outra, u, op, forn } = preparar();
  const f2 = criarFornecedor(db, emp, { razao_social: 'Segundo Fornecedor' });
  registrarPedido(db, emp, op, u, { fornecedor_id: forn, canal: 'whatsapp', itens: [1, 2] });
  const p2 = registrarPedido(db, emp, op, u, { fornecedor_id: f2, canal: 'email', itens: [3] });
  mudarStatusPedido(db, emp, op, p2, 'sem_retorno');
  const ag = listarPedidos(db, emp, {});
  assert.deepEqual(ag.contagem, { aguardando: 1, sem_retorno: 1, respondido: 0 });
  assert.equal(ag.pedidos.length, 1);
  assert.deepEqual(ag.pedidos[0].itens, [1, 2]);
  assert.equal(ag.pedidos[0].fornecedor_nome, 'Fornecedor Teste');
  assert.equal(ag.pedidos[0].itens_licitacao, 3);
  assert.equal(listarPedidos(db, emp, { status: 'todos' }).pedidos.length, 2);
  assert.equal(listarPedidos(db, emp, { status: 'sem_retorno' }).pedidos[0].fornecedor_nome, 'Segundo Fornecedor');
  assert.equal(listarPedidos(db, emp, { clienteId: 999 }).pedidos.length, 0);  // empresa em foco sem pedidos
  assert.equal(listarPedidos(db, outra, { status: 'todos' }).pedidos.length, 0);
});
