import { config } from './config.js';
import { getDb } from './db/index.js';
import { criarApp } from './app.js';
import { iniciarAgendador } from './services/scheduler.js';

const db = getDb();
const app = criarApp();
app.listen(config.port, () => {
  console.log(`${config.appName} em http://localhost:${config.port}`);
  if (config.schedulerAtivo) { iniciarAgendador(db); console.log('Agendador de sincronização ativo.'); }
});
