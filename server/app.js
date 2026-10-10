import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import api from './routes/api.js';
import { exigirCabecalhoAjax } from './lib/auth.js';

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
  const jsonPadrao = express.json({ limit: '1mb' });
  app.use('/api', (req, res, next) => (req.path === '/fontes/importar-json' ? next() : jsonPadrao(req, res, next)), exigirCabecalhoAjax, api);
  // Código da tela (HTML/JS/CSS) é sempre revalidado pelo ETag, para uma publicação nova aparecer no
  // próximo carregamento; só ícones e imagens podem ficar 1h no cache do navegador.
  const revalidar = /\.(html|js|css|webmanifest)$/;
  app.use(express.static(path.join(config.raiz, 'web'), {
    maxAge: config.producao ? '1h' : 0,
    setHeaders: (res, arquivo) => { if (revalidar.test(arquivo)) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(config.raiz, 'web', 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  return app;
}
