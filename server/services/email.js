// Envio de e-mail do sistema (alertas, comprovantes, jornal). Dois caminhos, ambos por variável de ambiente:
// - BREVO_API_KEY (+ EMAIL_REMETENTE verificado no Brevo): envia pela API HTTPS do Brevo. É o caminho que funciona
//   no Railway Hobby, que bloqueia SMTP de saída ("SMTP is only available on the Pro plan and above",
//   https://docs.railway.com/reference/outbound-networking).
// - SMTP_URL, ex.: smtps://usuario:senha-de-app@smtp.gmail.com:465 (Railway Pro, servidor próprio etc.).
// Chave e URL contêm segredo: nunca são registradas em log nem devolvidas pela API.
import nodemailer from 'nodemailer';
import { listarNotificacoes } from './alertas.js';

let transporte = null;
const estado = { ultimoEnvio: null, ultimoErro: null, enviados: 0 };

export const provedorEmail = () => (process.env.BREVO_API_KEY ? 'brevo' : process.env.SMTP_URL ? 'smtp' : null);
export const emailConfigurado = () => !!provedorEmail();

// "Nome <email@x>" ou só o e-mail → { name, address }
function separarEndereco(v) {
  if (!v) return null;
  if (typeof v === 'object') { const a = separarEndereco(v.address) || {}; return { name: v.name || a.name, address: a.address }; }
  // Aceita "Nome <email>", "Nome <email" (sem o > final) e só o e-mail
  const m = String(v).match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>?\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, address: m[2].trim() } : { address: String(v).trim() };
}

/** Transporte HTTPS do Brevo com a mesma interface sendMail do nodemailer. Doc: https://developers.brevo.com/reference/send-transac-email */
export function transporteBrevo(chave, { fetchImpl = fetch, tempoLimiteMs = 20000 } = {}) {
  return {
    async sendMail(m) {
      const de = separarEndereco(m.from);
      if (!de?.address) throw new Error('Defina EMAIL_REMETENTE com um remetente verificado no Brevo.');
      const destinos = (Array.isArray(m.to) ? m.to : String(m.to).split(',')).map(separarEndereco).filter((x) => x?.address)
        .map((x) => ({ email: x.address, ...(x.name ? { name: x.name } : {}) }));
      const corpo = {
        sender: { email: de.address, ...(de.name ? { name: de.name } : {}) },
        to: destinos, subject: m.subject,
        ...(m.html ? { htmlContent: m.html } : {}), ...(m.text ? { textContent: m.text } : {}),
        ...(m.replyTo ? { replyTo: { email: separarEndereco(m.replyTo).address } } : {}),
        ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ name: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
      };
      let r;
      try {
        r = await fetchImpl('https://api.brevo.com/v3/smtp/email', { method: 'POST', signal: AbortSignal.timeout(tempoLimiteMs),
          headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': chave }, body: JSON.stringify(corpo) });
      } catch (e) { throw new Error(`Brevo fora do ar ou sem rede: ${e?.cause?.message || e.message}`); }
      if (!r.ok) {
        let msg = ''; try { const j = await r.json(); msg = j.message || j.code || ''; } catch { /* corpo vazio */ }
        throw new Error(`Brevo recusou o envio (HTTP ${r.status})${msg ? `: ${msg}` : ''}`);
      }
      return r.json().catch(() => ({}));
    },
  };
}

function obterTransporte() {
  if (transporte) return transporte;
  const p = provedorEmail();
  if (p === 'brevo') transporte = transporteBrevo(process.env.BREVO_API_KEY);
  else if (p === 'smtp') transporte = nodemailer.createTransport(process.env.SMTP_URL, { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
  return transporte;
}

// Remetente: EMAIL_REMETENTE, ou o usuário da própria SMTP_URL
function remetente() {
  if (process.env.EMAIL_REMETENTE) return process.env.EMAIL_REMETENTE;
  try { return decodeURIComponent(new URL(process.env.SMTP_URL).username) || undefined; } catch { return undefined; }
}

// Mensagem de erro sem credenciais (URL do SMTP e chave do Brevo nunca aparecem); timeout de SMTP vira explicação
function erroSeguro(e) {
  let m = String(e?.message || e).replace(/smtps?:\/\/[^\s]+/gi, 'smtp://***');
  if (process.env.BREVO_API_KEY) m = m.split(process.env.BREVO_API_KEY).join('***');
  m = m.replace(/xkeysib-[\w-]+/gi, '***');
  if (provedorEmail() === 'smtp' && /timeout|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/i.test(m)) {
    m += ' (o servidor não conseguiu falar com o SMTP. No Railway Hobby o SMTP de saída é bloqueado: configure BREVO_API_KEY)';
  }
  return m.slice(0, 400);
}

export function statusEmail() {
  return { configurado: emailConfigurado(), provedor: provedorEmail(), remetente: emailConfigurado() ? remetente() || null : null, ...estado };
}

export function _reiniciarEmail(t = null) { transporte = t; estado.ultimoEnvio = null; estado.ultimoErro = null; estado.enviados = 0; }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function montarEmail(usuario, notificacoes, { urlBase = '', appName = 'Licita Inteligente' } = {}) {
  const max = 30;
  const lista = notificacoes.slice(0, max);
  const resto = notificacoes.length - lista.length;
  const link = (n) => (!urlBase ? null : n.licitacao_id ? `${urlBase}/#/licitacao/${n.licitacao_id}` : n.link ? `${urlBase}/${n.link}` : null);
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
  if (!t) return { enviados: 0, motivo: 'E-mail não configurado' };
  const usuarios = db.prepare(`SELECT DISTINCT u.id, u.nome, COALESCE(NULLIF(p.email_alertas, ''), u.email) email FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_id
    LEFT JOIN usuario_preferencias p ON p.usuario_id = u.id
    WHERE n.enviada_email = 0 AND n.criado_em > datetime('now','-2 days') AND u.ativo = 1 AND COALESCE(p.alertas_email, 1) = 1`).all();
  let enviados = 0;
  for (const u of usuarios) {
    // Só o que ainda vale: alerta de licitação que saiu do Kanban/favoritos da empresa não vai por e-mail
    const validas = new Set(listarNotificacoes(db, u.id, null, { limite: 500 }).map((n) => n.id));
    const todas = db.prepare(`SELECT * FROM notificacoes WHERE usuario_id = ? AND enviada_email = 0 AND criado_em > datetime('now','-2 days') ORDER BY id`).all(u.id);
    const ns = todas.filter((n) => validas.has(n.id));
    const marcarObsoleta = db.prepare('UPDATE notificacoes SET enviada_email = 1 WHERE id = ?');
    for (const n of todas) if (!validas.has(n.id)) marcarObsoleta.run(n.id);
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
  if (!t) throw new Error('E-mail não configurado: defina BREVO_API_KEY e EMAIL_REMETENTE (ou SMTP_URL) nas variáveis do servidor.');
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
  if (!t) throw Object.assign(new Error('E-mail não configurado no servidor (BREVO_API_KEY ou SMTP_URL).'), { semSmtp: true });
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
