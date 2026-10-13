import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { bancoMemoria, fixture } from '../helpers.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens } from '../../server/services/repositorio.js';
import { montarEmailInteresse, resumoLicitacoes, faltam, ordenarPorPrazo, excluirEnvios, criarEnvio, dadosEnvio, jornalPublico, responderJornal, pdfJornal, sistemaDaLicitacao, montarEmailJornal, listarEnvios, ordenarPorCidade, salvarDadosAssessoria } from '../../server/services/jornal-cliente.js';

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
  const objeto = db.prepare('SELECT objeto FROM licitacoes WHERE id=?').get(lic).objeto;
  assert.ok(n[0].mensagem.includes(objeto.slice(0, 60)));                      // o alerta diz QUAL licitação
  assert.deepEqual(r.notificacoes, [n[0].id]);
  const ops = db.prepare('SELECT o.*, e.ordem FROM oportunidades o JOIN kanban_etapas e ON e.id = o.etapa_id').all();
  assert.equal(ops.length, 1); assert.equal(ops[0].cliente_id, cli); assert.equal(ops[0].licitacao_id, lic); assert.equal(ops[0].ordem, 0); // entra no Kanban, 1ª etapa
  responderJornal(db, e.token, { interesses: [lic], respondente: 'João' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM oportunidades').get().n, 1);                     // responder de novo não duplica
  const env = listarEnvios(db, emp);
  assert.deepEqual(env[0].interesses.map((l) => l.id), [lic]); assert.ok(env[0].interesses[0].objeto); assert.equal(env[0].respondente, 'João');
  assert.throws(() => criarEnvio(db, { empresaId: emp, usuarioId: uid, ids: [] }), /pelo menos uma/);
});

test('PDF do jornal tem cabeçalho da empresa e links clicáveis (resumo e PNCP); e-mail pergunta o interesse', () => {
  const { db, emp, uid, lic, cli } = preparar();
  const e = criarEnvio(db, { empresaId: emp, clienteId: cli, usuarioId: uid, ids: [lic] });
  const d = dadosEnvio(db, e.id);
  const pdf = pdfJornal(d, { urlBase: 'https://exemplo.app' }).toString('latin1');
  assert.match(pdf, /EMPRESA EXEMPLO LTDA/);
  assert.match(pdf, /CNPJ 11\.222\.333\/0001-81/);
  assert.match(pdf, /A\/C Jo\xe3o Exemplo/);
  assert.ok(pdf.includes(`/URI (https://exemplo.app/j/${e.token}#lic-${lic})`));
  assert.match(pdf, /\/URI \(https:\/\/pncp\.gov\.br\/app\/editais\//);
  assert.match(pdf, /\(Participa\xe7\xe3o gratuita\)/);
  assert.match(pdf, /\(Tenho interesse\)/);
  assert.match(pdf, /\(R\$\s12\.345,60\)/);
  const m = montarEmailJornal(d, { urlBase: 'https://exemplo.app' });
  assert.match(m.assunto, /tem interesse em participar/);
  assert.ok(m.html.includes(`https://exemplo.app/j/${e.token}`));
  assert.match(m.texto, /Valor do edital: R\$\s12\.345,60/);
  assert.ok(inflateSync); // (PDF sem compressão: o texto acima é lido direto)
});

test('prazo: conta em horário de Brasília e ordena do mais curto para o mais longo', () => {
  const agora = new Date('2026-10-12T12:00:00-03:00');
  assert.deepEqual(faltam('2026-10-20T10:00:00', agora), { dias: 7, horas: 190, texto: 'Faltam 7 dias', urgencia: 'baixa' });
  assert.equal(faltam('2026-10-13T11:00:00', agora).texto, 'Faltam 23 h');
  assert.equal(faltam('2026-10-14', agora).urgencia, 'alta');            // só a data: vale até o fim do dia
  assert.equal(faltam('2026-10-12T11:00:00', agora).texto, 'Prazo encerrado');
  assert.equal(faltam(null, agora), null);
  const itens = [{ id: 1, faltam: null }, { id: 2, faltam: { urgencia: 'baixa' }, data_encerramento_proposta: '2026-11-01' },
    { id: 3, faltam: { urgencia: 'encerrada' }, data_encerramento_proposta: '2026-10-01' }, { id: 4, faltam: { urgencia: 'alta' }, data_encerramento_proposta: '2026-10-13' }];
  assert.deepEqual(ordenarPorPrazo(itens).map((l) => l.id), [4, 2, 1, 3]);
});

test('excluir envios: só da própria empresa; o link deixa de funcionar', () => {
  const { db, emp, uid, lic, cli } = preparar();
  const e = criarEnvio(db, { empresaId: emp, clienteId: cli, usuarioId: uid, ids: [lic] });
  assert.equal(excluirEnvios(db, emp + 1, [e.id]), 0);                      // outra empresa não apaga
  assert.equal(excluirEnvios(db, emp, [e.id, 'x']), 1);
  assert.throws(() => jornalPublico(db, e.token), /inválido|ativo/);
  assert.throws(() => excluirEnvios(db, emp, []), /pelo menos um/);
});

test('paginação numerada: primeira, última e vizinhas da atual, resto vira "…"', async () => {
  const { numerosPaginas } = await import('../../web/js/ui.js');
  assert.deepEqual(numerosPaginas(1, 6), [1, 2, 3, '…', 6]);
  assert.deepEqual(numerosPaginas(3, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(numerosPaginas(10, 20), [1, '…', 8, 9, 10, 11, 12, '…', 20]);
  assert.deepEqual(numerosPaginas(1, 1), [1]);
});

test('e-mail de interesse do cliente lista as licitações marcadas com link e observação', () => {
  const { db, lic } = preparar();
  const lics = resumoLicitacoes(db, [lic, 999999]);
  assert.equal(lics.length, 1);                                               // id inexistente não vira linha inventada
  const m = montarEmailInteresse({ respondente: 'Alexandre', cliente: 'DAF', observacao: 'Ligar amanhã', lics }, { urlBase: 'https://x.app/' });
  assert.match(m.assunto, /Alexandre \(DAF\) marcou 1 licitação/);
  assert.ok(m.texto.includes(lics[0].objeto.slice(0, 60)));
  assert.ok(m.html.includes(`https://x.app/#/licitacao/${lic}`));
  assert.match(m.texto, /Observação: Ligar amanhã/);
  const vazio = montarEmailInteresse({ respondente: 'Ana', cliente: null, observacao: null, lics: [] });
  assert.match(vazio.assunto, /sem marcar/);
});

test('PDF/impressão: agrupa por cidade na ordem do jornal salvo e lista os itens que batem com ele', async () => {
  const { salvarPerfil } = await import('../../server/services/jornal-perfis.js');
  const { db, emp, uid } = preparar();
  const ins = db.prepare(`INSERT INTO licitacoes (chave_canonica, objeto, uf, municipio, modalidade_id, status_calculado, data_encerramento_proposta, detalhes_sincronizados_em)
    VALUES (?,?,'ES',?,6,'aberta',?,'2026-10-12 10:00:00')`);
  const lic = (k, mun, fim) => Number(ins.run(k, 'Aquisição de gêneros alimentícios', mun, fim).lastInsertRowid);
  const vit = lic('v', 'Vitória', '2026-10-20T10:00:00'); const vv1 = lic('a', 'Vila Velha', '2026-10-25T10:00:00');
  const vv2 = lic('b', 'Vila Velha', '2026-10-21T10:00:00'); const ab = lic('c', 'Afonso Cláudio', '2026-10-19T10:00:00');
  const it = db.prepare('INSERT INTO licitacao_itens (licitacao_id, numero_item, descricao, quantidade, unidade_medida) VALUES (?,?,?,?,?)');
  ['Arroz tipo 1', 'Carne bovina moída', 'Carne bovina em cubos'].forEach((d, i) => it.run(vit, i + 1, d, 100, 'KG'));
  it.run(vv1, 1, 'Feijão preto', 50, 'KG');
  const p = salvarPerfil(db, emp, uid, { nome: 'Grupo B', filtros: { ufs: ['ES'], cidades: ['Vila Velha', 'Vitória'], produtos: 'carne bovina' } });
  const e = criarEnvio(db, { empresaId: emp, usuarioId: uid, ids: [vit, vv1, vv2, ab], perfilId: p.id ?? p });
  const d = dadosEnvio(db, e.id);
  // Vila Velha (prazo mais curto antes), Vitória, depois as cidades fora do jornal em ordem alfabética
  assert.deepEqual(d.itens.map((l) => l.id), [vv2, vv1, vit, ab]);
  const v = d.itens.find((l) => l.id === vit).itens_card;
  assert.equal(v.tipo, 'filtro'); assert.deepEqual(v.itens.map((i) => i.numero_item), [2, 3]); assert.equal(v.no_edital, 3);
  assert.equal(d.itens.find((l) => l.id === vv1).itens_card.tipo, 'primeiros'); // nada bate: primeiros do edital
  assert.equal(d.itens.find((l) => l.id === vv2).itens_card.tipo, 'sem_itens');
  assert.ok(pdfJornal(d, { urlBase: 'https://x.app' }).length > 1000);
  // Jornal salvo de outra empresa não vale
  const outra = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Outra')").run().lastInsertRowid);
  const e2 = criarEnvio(db, { empresaId: outra, usuarioId: uid, ids: [vit], perfilId: p.id ?? p });
  assert.equal(db.prepare('SELECT perfil_id FROM jornal_envios WHERE id=?').get(e2.id).perfil_id, null);
  assert.deepEqual(ordenarPorCidade([{ municipio: 'Serra' }, { municipio: 'Vitória' }], []).map((l) => l.municipio), ['Serra', 'Vitória']);
});

test('dados da assessoria: nome e e-mail de contato vão para o jornal; e-mail inválido é recusado', () => {
  const { db, emp, uid, lic } = preparar();
  const e = criarEnvio(db, { empresaId: emp, usuarioId: uid, ids: [lic] });
  assert.equal(dadosEnvio(db, e.id).assessoria.email, 'ana@teste.com'); // sem e-mail de contato: o de quem montou
  salvarDadosAssessoria(db, emp, { nome: 'LicitPro', email_contato: 'guidolicitacoes@gmail.com' });
  const a = dadosEnvio(db, e.id).assessoria;
  assert.equal(a.nome, 'LicitPro'); assert.equal(a.email, 'guidolicitacoes@gmail.com');
  assert.throws(() => salvarDadosAssessoria(db, emp, { nome: 'LicitPro', email_contato: 'sem-arroba' }), /inválido/);
  assert.throws(() => salvarDadosAssessoria(db, emp, { nome: '' }), /nome/);
});
