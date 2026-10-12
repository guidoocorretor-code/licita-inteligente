// Aviso por e-mail quando o cliente responde o jornal (Brevo simulado: nada sai para a internet)
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.BREVO_API_KEY = 'xkeysib-teste'; process.env.EMAIL_REMETENTE = 'Assessoria <assessoria@exemplo.com>';
delete process.env.SMTP_URL;
const enviados = [];
globalThis.fetch = async (url, o) => { enviados.push({ url, corpo: JSON.parse(o.body) }); return { ok: true, status: 201, json: async () => ({ messageId: 'x' }) }; };
const { bancoMemoria, fixture } = await import('../helpers.js');
const { criarUsuario } = await import('../../server/lib/auth.js');
const { normalizarPncp } = await import('../../server/services/normalizacao.js');
const { salvarLicitacao } = await import('../../server/services/repositorio.js');
const { criarEnvio, responderJornal, avisarInteresse } = await import('../../server/services/jornal-cliente.js');

test('cliente marca interesse: e-mail vai para o destino dos alertas, com a licitação, e não repete no resumo', async () => {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria Teste')").run().lastInsertRowid);
  const u = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@teste.com', senha: 'SenhaForte123', papel: 'admin' });
  const uid = typeof u === 'object' ? u.id : u;
  db.prepare("INSERT INTO usuario_preferencias (usuario_id, alertas_email, email_alertas) VALUES (?, 1, 'alertas@teste.com')").run(uid);
  const bruto = fixture('pncp-contratacao-real');
  const lic = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, '2026-10-10T12:00:00').id;
  const cli = Number(db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social) VALUES (?, '11222333000181', 'EMPRESA EXEMPLO LTDA')").run(emp).lastInsertRowid);
  const e = criarEnvio(db, { empresaId: emp, clienteId: cli, usuarioId: uid, ids: [lic] });
  const r = responderJornal(db, e.token, { interesses: [lic], respondente: 'Alexandre', observacao: 'Ligar amanhã' });
  const x = await avisarInteresse(db, r.envio_id, r.notificacoes, { urlBase: 'https://app.exemplo' });
  assert.equal(x.para, 'alertas@teste.com');
  assert.equal(enviados.length, 1);
  const c = enviados[0].corpo;
  assert.deepEqual(c.to, [{ email: 'alertas@teste.com' }]);
  assert.match(c.subject, /Alexandre \(EMPRESA EXEMPLO LTDA\) marcou 1 licitação/);
  const objeto = db.prepare('SELECT objeto FROM licitacoes WHERE id=?').get(lic).objeto;
  assert.ok(c.textContent.includes(objeto.slice(0, 60)));
  assert.ok(c.htmlContent.includes(`https://app.exemplo/#/licitacao/${lic}`));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE tipo='jornal' AND enviada_email=0").get().n, 0);
  // Quem desligou os alertas por e-mail não recebe
  db.prepare('UPDATE usuario_preferencias SET alertas_email=0 WHERE usuario_id=?').run(uid);
  assert.equal((await avisarInteresse(db, r.envio_id, [])).enviado, false);
  assert.equal(enviados.length, 1);
});
