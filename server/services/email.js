// Envio dos alertas por e-mail (resumo agrupado por usuário).
// Só funciona com SMTP_URL configurado em variável de ambiente, ex.: smtps://usuario:senha-de-app@smtp.gmail.com:465
// A URL contém a senha: nunca é registrada em log nem devolvida pela API.
import nodemailer from 'nodemailer';

let transporte = null;
const estado = { ultimoEnvio: null, ultimoErro: null, enviados: 0 };

export const emailConfigurado = () => !!process.env.SMTP_URL;

function obterTransporte() {
  if (!emailConfigurado()) return null;
  if (!transporte) transporte = nodemailer.createTransport(process.env.SMTP_URL);
  return transporte;
}

// Remetente: EMAIL_REMETENTE, ou o usuário da própria SMTP_URL
function remetente() {
  if (process.env.EMAIL_REMETENTE) return process.env.EMAIL_REMETENTE;
  try { return decodeURIComponent(new URL(process.env.SMTP_URL).username); } catch { return undefined; }
}

// Mensagem de erro sem credenciais (a URL do SMTP nunca aparece)
const erroSeguro = (e) => String(e?.message || e).replace(/smtps?:\/\/[^\s]+/gi, 'smtp://***').slice(0, 300);

export function statusEmail() {
  return { configurado: emailConfigurado(), remetente: emailConfigurado() ? remetente() || null : null, ...estado };
}

export function _reiniciarEmail(t = null) { transporte = t; estado.ultimoEnvio = null; estado.ultimoErro = null; estado.enviados = 0; }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function montarEmail(usuario, notificacoes, { urlBase = '', appName = 'Licita Inteligente' } = {}) {
  const max = 30;
  const lista = notificacoes.slice(0, max);
  const resto = notificacoes.length - lista.length;
  const link = (n) => (urlBase && n.licitacao_id ? `${urlBase}/#/licitacao/${n.licitacao_id}` : null);
  const assunto = notificacoes.length === 1 ? `[${appName}] ${notificacoes[0].titulo}` : `[${appName}] ${notificacoes.length} novos alertas`;
  const texto = [`Olá, ${usuario.nome}.`, '', ...lista.flatMap((n) => [`• ${n.titulo}`, `  ${n.mensagem || ''}`, link(n) ? `  ${link(n)}` : '', '']),
    resto > 0 ? `… e mais ${resto} alerta(s) no sistema.` : '', '',
    'Confira sempre o edital e o sistema oficial antes de agir.', 'Para parar de receber, desative em Configurações > Alertas por e-mail.'].join('\n');
  const html = `<p>Olá, ${esc(usuario.nome)}.</p><ul>${lista.map((n) => `<li style="margin-bottom:10px"><strong>${esc(n.titulo)}</strong><br>${esc(n.mensagem || '')}${link(n) ? `<br><a href="${esc(link(n))}">Abrir no sistema</a>` : ''}</li>`).join('')}</ul>`
    + (resto > 0 ? `<p>… e mais ${resto} alerta(s) no sistema.</p>` : '')
    + '<p style="color:#666;font-size:12px">Confira sempre o edital e o sistema oficial antes de agir. Para parar de receber, desative em Configurações &gt; Alertas por e-mail.</p>';
  return { assunto, texto, html };
}

/** Envia um resumo por usuário com as notificações ainda não enviadas (últimos 2 dias). */
export async function enviarAlertasPendentes(db, { urlBase = process.env.APP_URL || '', appName } = {}) {
  const t = obterTransporte();
  if (!t) return { enviados: 0, motivo: 'SMTP_URL não configurado' };
  const usuarios = db.prepare(`SELECT DISTINCT u.id, u.nome, COALESCE(NULLIF(p.email_alertas, ''), u.email) email FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_id
    LEFT JOIN usuario_preferencias p ON p.usuario_id = u.id
    WHERE n.enviada_email = 0 AND n.criado_em > datetime('now','-2 days') AND u.ativo = 1 AND COALESCE(p.alertas_email, 1) = 1`).all();
  let enviados = 0;
  for (const u of usuarios) {
    const ns = db.prepare(`SELECT * FROM notificacoes WHERE usuario_id = ? AND enviada_email = 0 AND criado_em > datetime('now','-2 days') ORDER BY id`).all(u.id);
    if (!ns.length) continue;
    const m = montarEmail(u, ns, { urlBase, appName });
    try {
      await t.sendMail({ from: remetente(), to: u.email, subject: m.assunto, text: m.texto, html: m.html });
      const marcar = db.prepare('UPDATE notificacoes SET enviada_email = 1 WHERE id = ?');
      for (const n of ns) marcar.run(n.id);
      enviados++; estado.enviados++; estado.ultimoEnvio = new Date().toISOString(); estado.ultimoErro = null;
    } catch (e) {
      estado.ultimoErro = erroSeguro(e);
      console.error('[email] falha ao enviar:', estado.ultimoErro);
      break; // provável problema de configuração: tenta de novo no próximo ciclo
    }
  }
  return { enviados };
}

export async function enviarEmailTeste(usuario) {
  const t = obterTransporte();
  if (!t) throw new Error('E-mail não configurado: defina SMTP_URL nas variáveis do servidor.');
  try {
    await t.sendMail({ from: remetente(), to: usuario.email, subject: '[Licita Inteligente] E-mail de teste',
      text: `Olá, ${usuario.nome}. Se você recebeu esta mensagem, os alertas por e-mail estão funcionando.` });
    estado.ultimoEnvio = new Date().toISOString(); estado.ultimoErro = null;
  } catch (e) {
    estado.ultimoErro = erroSeguro(e);
    throw new Error(`Falha ao enviar: ${estado.ultimoErro}`);
  }
}

/** E-mail avulso (ex.: comprovante para o fornecedor). Lança erro sem expor credenciais. */
export async function enviarEmail({ para, assunto, texto, html, anexos = [], responderPara, nomeRemetente }) {
  const t = obterTransporte();
  if (!t) throw Object.assign(new Error('E-mail não configurado (SMTP_URL).'), { semSmtp: true });
  const de = remetente();
  try {
    await t.sendMail({ from: nomeRemetente && de ? { name: nomeRemetente, address: de } : de, to: para, replyTo: responderPara || undefined,
      subject: assunto, text: texto, html, attachments: anexos });
    estado.enviados++; estado.ultimoEnvio = new Date().toISOString(); estado.ultimoErro = null;
  } catch (e) {
    estado.ultimoErro = erroSeguro(e);
    throw new Error(estado.ultimoErro);
  }
}
