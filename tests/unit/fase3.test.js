import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture, clonar } from '../helpers.js';
import { normalizarPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao } from '../../server/services/repositorio.js';
import { criarUsuario } from '../../server/lib/auth.js';
import { eventosCalendario, gerarIcs, gerarTokenCalendario, usuarioDoToken, revogarTokenCalendario } from '../../server/services/calendario.js';
import { avaliarAlertasAcompanhadas, listarNotificacoes } from '../../server/services/alertas.js';
import { enviarAlertasPendentes, montarEmail, _reiniciarEmail } from '../../server/services/email.js';

const AGORA = '2026-10-10T12:00:00'; // horário de Brasília

// Base de TESTE derivada do registro real do PNCP (identificada como dado de teste)
function preparar() {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Empresa Teste')").run().lastInsertRowid);
  const u1 = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@teste.com', senha: 'SenhaForte123', papel: 'admin' });
  const u2 = criarUsuario(db, { empresaId: emp, nome: 'Bia', email: 'bia@teste.com', senha: 'SenhaForte123', papel: 'analista' });
  const base = fixture('pncp-contratacao-real');
  const ids = [['2026-10-11T09:00:00', 'Aquisição de medicamentos'], ['2026-10-12T15:30:00', 'Serviço de limpeza'], ['2026-10-25T10:00:00', 'Obra de reforma']]
    .map(([enc, obj], i) => {
      const r = clonar(base);
      r.numeroControlePNCP = `TESTE-F3-${i}`; r.sequencialCompra = 900 + i; r.objetoCompra = obj;
      r.dataAberturaProposta = '2026-10-01T08:00:00'; r.dataEncerramentoProposta = enc;
      return salvarLicitacao(db, normalizarPncp(r), 'pncp', r, AGORA).id;
    });
  const idDe = (u) => (typeof u === 'object' ? u.id : u);
  return { db, emp, u1: idDe(u1), u2: idDe(u2), ids };
}
const favoritar = (db, emp, usuario, licId) =>
  db.prepare("INSERT INTO favoritos (empresa_id, usuario_id, tipo, referencia, criado_em) VALUES (?,?,'licitacao',?,'2026-10-01 00:00:00')").run(emp, usuario, String(licId));
function kanban(db, emp, licId, { responsavel = null, prazo = null } = {}) {
  let et = db.prepare('SELECT id FROM kanban_etapas WHERE empresa_id=? LIMIT 1').get(emp);
  if (!et) et = { id: Number(db.prepare("INSERT INTO kanban_etapas (empresa_id, nome, ordem) VALUES (?, 'Nova oportunidade', 0)").run(emp).lastInsertRowid) };
  return Number(db.prepare("INSERT INTO oportunidades (empresa_id, licitacao_id, etapa_id, responsavel_id, prazo_interno, criado_em) VALUES (?,?,?,?,?,'2026-10-01 00:00:00')")
    .run(emp, licId, et.id, responsavel, prazo).lastInsertRowid);
}

test('calendário: só licitações acompanhadas, com abertura, encerramento e prazo interno', () => {
  const { db, emp, u1, u2, ids } = preparar();
  favoritar(db, emp, u1, ids[0]);
  kanban(db, emp, ids[1], { prazo: '2026-10-11' });
  const ev = eventosCalendario(db, { empresaId: emp, usuarioId: u1 });
  assert.equal(ev.filter((e) => e.tipo === 'encerramento').length, 2);           // favorita + Kanban
  assert.equal(ev.filter((e) => e.tipo === 'prazo_interno').length, 1);
  assert.ok(!ev.some((e) => e.licitacao_id === ids[2]));                        // não acompanhada
  // favorito é pessoal; Kanban é da empresa
  assert.deepEqual([...new Set(eventosCalendario(db, { empresaId: emp, usuarioId: u2 }).map((e) => e.licitacao_id))], [ids[1]]);
  // filtro por período
  assert.equal(eventosCalendario(db, { empresaId: emp, usuarioId: u1, de: '2026-10-12', ate: '2026-10-12' }).length, 1);
});

test('arquivo .ics: horário de Brasília convertido para UTC, dia inteiro, escape e linhas ≤ 75 octetos', () => {
  const { db, emp, u1, ids } = preparar();
  favoritar(db, emp, u1, ids[1]);
  kanban(db, emp, ids[1], { prazo: '2026-10-11' });
  const ics = gerarIcs(eventosCalendario(db, { empresaId: emp, usuarioId: u1 }), { urlBase: 'https://exemplo.app', agora: new Date('2026-10-10T15:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261012T183000Z/);                               // 15:30 em Brasília = 18:30 UTC
  assert.match(ics, /DTSTART;VALUE=DATE:20261011\r\nDTEND;VALUE=DATE:20261012/);
  assert.match(ics, /TRIGGER:-P1D/);                                            // lembrete 1 dia antes do fim
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 3);
  for (const linha of ics.split('\r\n')) assert.ok(Buffer.byteLength(linha) <= 75, linha);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('link de assinatura: só o hash fica no banco, novo link invalida o anterior, revogação funciona', () => {
  const { db, u1 } = preparar();
  const t1 = gerarTokenCalendario(db, u1);
  assert.equal(usuarioDoToken(db, t1).id, u1);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM calendario_tokens').all()).includes(t1));
  const t2 = gerarTokenCalendario(db, u1);
  assert.equal(usuarioDoToken(db, t1), null);
  assert.equal(usuarioDoToken(db, t2).id, u1);
  revogarTokenCalendario(db, u1);
  assert.equal(usuarioDoToken(db, t2), null);
  assert.equal(usuarioDoToken(db, '../../etc/passwd'), null);
});

test('alertas de prazo: 1 dia e 3 dias antes, sem repetir, e quem recebe cada um', () => {
  const { db, emp, u1, u2, ids } = preparar();
  favoritar(db, emp, u1, ids[0]);                 // encerra em 21h → alerta de 24h (só para Ana)
  kanban(db, emp, ids[1]);                        // encerra em ~2 dias, sem responsável → todos
  kanban(db, emp, ids[2], { responsavel: u2 });   // encerra em 15 dias → nenhum alerta ainda
  assert.equal(avaliarAlertasAcompanhadas(db, AGORA), 3);
  const n = db.prepare('SELECT usuario_id, titulo, licitacao_id FROM notificacoes ORDER BY usuario_id, licitacao_id').all();
  assert.deepEqual(n.map((x) => [x.usuario_id, x.licitacao_id]), [[u1, ids[0]], [u1, ids[1]], [u2, ids[1]]]);
  assert.match(n[0].titulo, /menos de 24h \(11\/10 às 09:00\)/);
  assert.match(n[1].titulo, /até 3 dias/);
  assert.equal(avaliarAlertasAcompanhadas(db, AGORA), 0);                        // não repete
  assert.equal(avaliarAlertasAcompanhadas(db, '2026-10-11T16:00:00'), 2);        // a de 12/10 entra em < 24h
  // prazo alterado pela fonte gera novo aviso
  db.prepare("UPDATE licitacoes SET data_encerramento_proposta='2026-10-11T23:00:00' WHERE id=?").run(ids[0]);
  assert.equal(avaliarAlertasAcompanhadas(db, '2026-10-11T16:00:00'), 1);
});

test('alertas de prazo interno e de mudança no edital (só eventos depois de começar a acompanhar)', () => {
  const { db, emp, u1, u2, ids } = preparar();
  kanban(db, emp, ids[2], { responsavel: u1, prazo: '2026-10-11' });
  db.prepare("INSERT INTO licitacao_eventos (licitacao_id, tipo, descricao, detectado_em) VALUES (?, 'alteracao', 'Data de encerramento alterada', datetime('now','-1 hour'))").run(ids[2]);
  db.prepare("INSERT INTO licitacao_eventos (licitacao_id, tipo, descricao, detectado_em) VALUES (?, 'documento', 'Antigo', '2026-09-01 00:00:00')").run(ids[2]);
  avaliarAlertasAcompanhadas(db, AGORA);
  const n = db.prepare('SELECT usuario_id, tipo, titulo FROM notificacoes ORDER BY id').all();
  assert.deepEqual(n.map((x) => x.tipo).sort(), ['mudanca', 'prazo_interno']);
  assert.ok(n.every((x) => x.usuario_id === u1));                               // responsável definido: só ele
  assert.match(n.find((x) => x.tipo === 'prazo_interno').titulo, /amanhã/);
  assert.ok(!n.some((x) => /Antigo/.test(x.titulo)));
  assert.equal(u2 > 0, true);
});

test('e-mail: resumo por usuário, respeita preferência e destino de alertas, marca como enviado', async () => {
  const { db, emp, u1, u2, ids } = preparar();
  favoritar(db, emp, u1, ids[0]); favoritar(db, emp, u2, ids[0]);
  avaliarAlertasAcompanhadas(db, AGORA);
  db.prepare('INSERT INTO usuario_preferencias (usuario_id, alertas_email, email_alertas) VALUES (?, 1, ?)').run(u1, 'licitacoes@teste.com');
  db.prepare('INSERT INTO usuario_preferencias (usuario_id, alertas_email) VALUES (?, 0)').run(u2);
  const enviados = [];
  process.env.SMTP_URL = 'smtps://remetente%40teste.com:segredo@smtp.teste.com:465';
  _reiniciarEmail({ sendMail: async (m) => { enviados.push(m); } });
  try {
    const r = await enviarAlertasPendentes(db, { urlBase: 'https://exemplo.app' });
    assert.equal(r.enviados, 1);
    assert.equal(enviados[0].to, 'licitacoes@teste.com');
    assert.equal(enviados[0].from, 'remetente@teste.com');
    assert.match(enviados[0].text, /https:\/\/exemplo\.app\/#\/licitacao\//);
    assert.ok(!JSON.stringify(enviados).includes('segredo'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notificacoes WHERE usuario_id=? AND enviada_email=1').get(u1).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notificacoes WHERE usuario_id=? AND enviada_email=0').get(u2).n, 1);
    assert.equal((await enviarAlertasPendentes(db)).enviados, 0);              // nada repetido
  } finally { delete process.env.SMTP_URL; _reiniciarEmail(); }
});

test('e-mail: sem SMTP_URL nada é enviado; texto escapa HTML e limita a 30 itens', async () => {
  const { db } = preparar();
  assert.deepEqual(await enviarAlertasPendentes(db), { enviados: 0, motivo: 'E-mail não configurado' });
  const ns = Array.from({ length: 35 }, (_, i) => ({ titulo: `<b>Alerta ${i}</b>`, mensagem: 'x', licitacao_id: i }));
  const m = montarEmail({ nome: 'Ana' }, ns);
  assert.match(m.assunto, /35 novos alertas/);
  assert.ok(!m.html.includes('<b>Alerta'));
  assert.match(m.texto, /mais 5 alerta/);
});

test('alertas só da empresa que acompanha: saiu do Kanban, trocou de empresa ou foi descartada → some', () => {
  const { db, emp, u1, ids } = preparar();
  const cliA = Number(db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social) VALUES (?, '11111111000191', 'EMPRESA A (TESTE)')").run(emp).lastInsertRowid);
  const cliB = Number(db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social) VALUES (?, '22222222000191', 'EMPRESA B (TESTE)')").run(emp).lastInsertRowid);
  const op0 = kanban(db, emp, ids[0], { responsavel: u1 });
  const op1 = kanban(db, emp, ids[1], { responsavel: u1 });
  db.prepare('UPDATE oportunidades SET cliente_id=? WHERE id IN (?,?)').run(cliA, op0, op1);
  assert.equal(avaliarAlertasAcompanhadas(db, AGORA), 2);
  const lista = listarNotificacoes(db, u1, cliA);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].kanban_etapa, 'Nova oportunidade');
  // card 0 removido do Kanban; card 1 passou para a empresa B
  db.prepare('DELETE FROM oportunidades WHERE id=?').run(op0);
  db.prepare('UPDATE oportunidades SET cliente_id=? WHERE id=?').run(cliB, op1);
  assert.equal(listarNotificacoes(db, u1, cliA).length, 0);
  assert.equal(listarNotificacoes(db, u1, cliB).length, 0);                    // o aviso antigo era da empresa A
  // favorito da empresa A traz o alerta da licitação 0 de volta, marcado como favorito
  db.prepare("INSERT INTO favoritos (empresa_id, usuario_id, cliente_id, tipo, referencia) VALUES (?,?,?,'licitacao',?)").run(emp, u1, cliA, String(ids[0]));
  const fav = listarNotificacoes(db, u1, cliA);
  assert.equal(fav.length, 1); assert.equal(fav[0].favorito, true);
  // etapa "descartada" não gera nem mostra alerta
  const desc = Number(db.prepare("INSERT INTO kanban_etapas (empresa_id, nome, ordem, fase) VALUES (?, 'Descartada', 9, 'descartada')").run(emp).lastInsertRowid);
  db.prepare('UPDATE oportunidades SET etapa_id=? WHERE id=?').run(desc, op1);
  assert.equal(avaliarAlertasAcompanhadas(db, '2026-10-11T16:00:00'), 0);
  assert.equal(listarNotificacoes(db, u1, cliB).length, 0);
});

test('e-mail: Brevo envia pela API HTTPS com anexo em base64 e não vaza a chave', async () => {
  const { transporteBrevo } = await import('../../server/services/email.js');
  const chamadas = [];
  const okFetch = async (url, op) => { chamadas.push({ url, op }); return { ok: true, status: 201, json: async () => ({ messageId: 'x' }) }; };
  const t = transporteBrevo('xkeysib-segredo', { fetchImpl: okFetch });
  await t.sendMail({ from: { name: 'Assessoria', address: 'guido@teste.com' }, to: 'cliente@teste.com', replyTo: 'resp@teste.com',
    subject: 'Jornal', html: '<p>oi</p>', text: 'oi', attachments: [{ filename: 'j.pdf', content: Buffer.from('%PDF') }] });
  const c = JSON.parse(chamadas[0].op.body);
  assert.equal(chamadas[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(chamadas[0].op.headers['api-key'], 'xkeysib-segredo');
  assert.deepEqual(c.sender, { email: 'guido@teste.com', name: 'Assessoria' });
  assert.deepEqual(c.to, [{ email: 'cliente@teste.com' }]);
  assert.deepEqual(c.replyTo, { email: 'resp@teste.com' });
  assert.deepEqual(c.attachment, [{ name: 'j.pdf', content: Buffer.from('%PDF').toString('base64') }]);
  const falha = transporteBrevo('xkeysib-segredo', { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) }) });
  await assert.rejects(falha.sendMail({ from: 'Nome <a@b.com>', to: 'c@d.com', subject: 's', text: 't' }), /HTTP 401.*Key not found/);
  await assert.rejects(t.sendMail({ to: 'c@d.com', subject: 's' }), /EMAIL_REMETENTE/);
  await t.sendMail({ from: 'Guido - Assessoria <guido@teste.com', to: 'c@d.com', subject: 's', text: 't' });   // sem o ">" final
  assert.deepEqual(JSON.parse(chamadas.at(-1).op.body).sender, { email: 'guido@teste.com', name: 'Guido - Assessoria' });
  await t.sendMail({ from: { name: 'Assessoria X', address: 'Guido <guido@teste.com>' }, to: 'c@d.com', subject: 's', text: 't' }); // jornal: nome da assessoria + EMAIL_REMETENTE completo
  assert.deepEqual(JSON.parse(chamadas.at(-1).op.body).sender, { email: 'guido@teste.com', name: 'Assessoria X' });
});
