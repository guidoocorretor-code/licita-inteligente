import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { bancoMemoria, fixture } from '../helpers.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens } from '../../server/services/repositorio.js';
import { criarEnvio, dadosEnvio, jornalPublico, responderJornal, pdfJornal, sistemaDaLicitacao, montarEmailJornal, listarEnvios } from '../../server/services/jornal-cliente.js';

// Base de TESTE: uma licitação real do fixture do PNCP e uma empresa assessorada de exemplo
function preparar() {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria Teste')").run().lastInsertRowid);
  const u = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@teste.com', senha: 'SenhaForte123', papel: 'admin' });
  const uid = typeof u === 'object' ? u.id : u;
  const bruto = fixture('pncp-contratacao-real');
  const lic = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, '2026-10-10T12:00:00').id;
  db.prepare("UPDATE licitacoes SET sistema_eletronico='comprasgov', valor_estimado=12345.6, valor_estimado_situacao='informado', data_encerramento_proposta='2099-12-31T10:00:00' WHERE id=?").run(lic);
  salvarItens(db, lic, [{ numero_item: 1, descricao: 'PAPEL A4', quantidade: 10, unidade_medida: 'RESMA', material_servico: 'Material' }], 'pncp', '2026-10-10T12:00:00');
  const cli = Number(db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social, resp_nome, resp_email) VALUES (?, '11222333000181', 'EMPRESA EXEMPLO LTDA', 'João Exemplo', 'joao@exemplo.com')").run(emp).lastInsertRowid);
  return { db, emp, uid, lic, cli };
}

test('participação: gratuita só com fonte; sistema desconhecido fica "não verificada"', () => {
  assert.equal(sistemaDaLicitacao({ sistema_eletronico: 'comprasgov' }).participacao, 'Gratuita');
  assert.equal(sistemaDaLicitacao({ sistema_eletronico: 'bll' }).custo, 'pago');
  const outro = sistemaDaLicitacao({ sistema_eletronico: 'outro', plataforma_origem: 'E&L' });
  assert.equal(outro.custo, 'nao_verificado');
  assert.match(outro.nome, /confira no edital/i);
});

test('jornal: link assinado, resumo público com PNCP e resposta de interesse vira alerta e favorito', () => {
  const { db, emp, uid, lic, cli } = preparar();
  const e = criarEnvio(db, { empresaId: emp, clienteId: cli, usuarioId: uid, ids: [lic, lic, 999999] });
  assert.equal(criarEnvio(db, { empresaId: emp, clienteId: cli, usuarioId: uid, ids: [lic] }).id, e.id); // mesma seleção: mesmo jornal
  const d = dadosEnvio(db, e.id);
  assert.equal(d.itens.length, 1);
  assert.match(d.itens[0].valor_texto, /^R\$\s12\.345,60$/);
  assert.equal(d.itens[0].sistema.participacao, 'Gratuita');
  assert.equal(d.cliente.resp_email, 'joao@exemplo.com');
  const pub = jornalPublico(db, e.token);
  assert.equal(pub.cliente, 'EMPRESA EXEMPLO LTDA');
  assert.equal(pub.licitacoes[0].itens[0].descricao, 'PAPEL A4');
  assert.match(pub.licitacoes[0].link_pncp || '', /pncp\.gov\.br\/app\/editais/);
  assert.ok(!/cnpj|resp_email|11222333000181/.test(JSON.stringify(pub)));   // dados cadastrais não vão para a página pública
  assert.throws(() => jornalPublico(db, `${e.token.split('.')[0]}.${'A'.repeat(32)}`), /inválido/);
  assert.throws(() => responderJornal(db, e.token, { interesses: [lic] }), /nome/);
  const r = responderJornal(db, e.token, { interesses: [lic, 424242], respondente: 'João', observacao: 'Ligar à tarde' });
  assert.equal(r.interesses, 1);                                              // só conta o que estava no jornal
  const n = db.prepare("SELECT * FROM notificacoes WHERE tipo='jornal'").all();
  assert.equal(n.length, 1); assert.equal(n[0].usuario_id, uid); assert.equal(n[0].licitacao_id, lic);
  assert.match(n[0].mensagem, /João \(EMPRESA EXEMPLO LTDA\).*Ligar à tarde/);
  const fav = db.prepare("SELECT * FROM favoritos WHERE lista='Interesse do cliente'").all();
  assert.equal(fav.length, 1); assert.equal(fav[0].cliente_id, cli);
  const env = listarEnvios(db, emp);
  assert.deepEqual(env[0].interesses, [lic]); assert.equal(env[0].respondente, 'João');
  assert.throws(() => criarEnvio(db, { empresaId: emp, usuarioId: uid, ids: [] }), /pelo menos uma/);
});

test('PDF do jornal tem cabeçalho da empresa e links clicáveis (resumo e PNCP); e-mail pergunta o interesse', () => {
  const { db, emp, uid, lic, cli } = preparar();
  const e = criarEnvio(db, { empresaId: emp, clienteId: cli, usuarioId: uid, ids: [lic] });
  const d = dadosEnvio(db, e.id);
  const pdf = pdfJornal(d, { urlBase: 'https://exemplo.app' }).toString('latin1');
  assert.match(pdf, /EMPRESA EXEMPLO LTDA/);
  assert.match(pdf, /CNPJ 11\.222\.333\/0001-81/);
  assert.match(pdf, /Representante legal: Jo\xe3o Exemplo/);
  assert.ok(pdf.includes(`/URI (https://exemplo.app/j/${e.token}#lic-${lic})`));
  assert.match(pdf, /\/URI \(https:\/\/pncp\.gov\.br\/app\/editais\//);
  assert.match(pdf, /\(Participa\xe7\xe3o: \) Tj ET\nBT \/F1 10 Tf 0 0 0 rg [\d.]+ [\d.]+ Td \(Gratuita\)/);
  const m = montarEmailJornal(d, { urlBase: 'https://exemplo.app' });
  assert.match(m.assunto, /tem interesse em participar/);
  assert.ok(m.html.includes(`https://exemplo.app/j/${e.token}`));
  assert.match(m.texto, /Valor do edital: R\$\s12\.345,60/);
  assert.ok(inflateSync); // (PDF sem compressão: o texto acima é lido direto)
});
