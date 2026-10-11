import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import api from './routes/api.js';
import { exigirCabecalhoAjax } from './lib/auth.js';
import { getDb } from './db/index.js';
import { usuarioDoToken, eventosCalendario, gerarIcs } from './services/calendario.js';
import { cotacaoPublica, responderCotacao } from './services/cotacao-link.js';

// Limite simples por IP para as páginas públicas (sem login): evita robô testando links ou enchendo a cotação
const acessos = new Map();
function limitar(max, janelaMs) {
  return (req, res, next) => {
    const agora = Date.now(); const chave = `${req.ip}|${max}`;
    const lista = (acessos.get(chave) || []).filter((t) => agora - t < janelaMs);
    if (lista.length >= max) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    lista.push(agora); acessos.set(chave, lista);
    if (acessos.size > 5000) acessos.clear();
    next();
  };
}

export function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (config.producao) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.get('/saude', (req, res) => res.json({ ok: true, app: config.appName }));
  // Assinatura do calendário (Google Agenda, Outlook, celular): link secreto e revogável, somente leitura
  app.get('/calendario/:token.ics', (req, res) => {
    const u = usuarioDoToken(getDb(), req.params.token);
    if (!u) return res.status(404).type('text/plain').send('Calendário não encontrado ou link revogado.');
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(gerarIcs(eventosCalendario(getDb(), { empresaId: u.empresa_id, usuarioId: u.id }), { nome: `Licitações — ${u.nome}`, urlBase: base }));
  });
  // Resposta de cotação pelo fornecedor (link sem login, assinado e com prazo)
  const publico = (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); };
  app.get('/cotar/:token', publico, (req, res) => res.sendFile(path.join(config.raiz, 'web', 'cotar.html')));
  const responderPublico = (fn) => (req, res) => {
    try { res.json(fn()); } catch (e) { res.status(e.status || 500).json({ erro: e.status ? e.message : 'Erro ao processar. Tente de novo.' }); if (!e.status) console.error('[cotar]', e); }
  };
  app.get('/publico/cotacao/:token', publico, limitar(120, 10 * 60000), (req, res) => responderPublico(() => cotacaoPublica(getDb(), req.params.token))(req, res));
  app.post('/publico/cotacao/:token', publico, limitar(20, 10 * 60000), express.json({ limit: '200kb' }), exigirCabecalhoAjax,
    (req, res) => responderPublico(() => responderCotacao(getDb(), req.params.token, req.body || {}))(req, res));
  const jsonPadrao = express.json({ limit: '1mb' });
  app.use('/api', (req, res, next) => (req.path === '/fontes/importar-json' ? next() : jsonPadrao(req, res, next)), exigirCabecalhoAjax, api);
  // Código da tela (HTML/JS/CSS) é sempre revalidado pelo ETag, para uma publicação nova aparecer no
  // próximo carregamento; só ícones e imagens podem ficar 1h no cache do navegador.
  const revalidar = /\.(html|js|css|webmanifest)$/;
  app.use(express.static(path.join(config.raiz, 'web'), {
    maxAge: config.producao ? '1h' : 0,
    setHeaders: (res, arquivo) => { if (revalidar.test(arquivo)) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get(/^\/(?!api\/|publico\/).*/, (req, res) => res.sendFile(path.join(config.raiz, 'web', 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  return app;
}
