// Configuração centralizada. Segredos vêm SOMENTE de variáveis de ambiente.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Carrega .env simples (KEY=VALUE) se existir, sem sobrescrever o ambiente.
const envPath = path.join(raiz, '.env');
if (fs.existsSync(envPath)) {
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const producao = process.env.NODE_ENV === 'production';
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (producao) throw new Error('JWT_SECRET é obrigatório em produção.');
  jwtSecret = crypto.randomBytes(32).toString('hex'); // dev: muda a cada reinício
}

export const config = {
  raiz,
  producao,
  appName: process.env.APP_NAME || 'Licita Inteligente',
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(raiz, 'storage', 'licita.db'),
  storageDir: process.env.STORAGE_DIR || path.join(raiz, 'storage'),
  jwtSecret,
  jwtExpira: process.env.JWT_EXPIRA || '12h',
  schedulerAtivo: process.env.SCHEDULER !== 'off',
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 30000),
  userAgent: process.env.HTTP_USER_AGENT || 'LicitaInteligente/0.2 (+contato: configure HTTP_USER_AGENT)',
  smtpUrl: process.env.SMTP_URL || null,
};
