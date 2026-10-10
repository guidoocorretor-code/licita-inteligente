import { config } from './config.js';
import { getDb, indexarItensEmSegundoPlano } from './db/index.js';
import { criarApp } from './app.js';
import { iniciarAgendador } from './services/scheduler.js';
import { configuracaoInicial } from './bootstrap.js';

const db = getDb();
for (const m of configuracaoInicial(db)) console.log(m);
const app = criarApp();
app.listen(config.port, () => {
  console.log(`${config.appName} em http://localhost:${config.port}`);
  if (config.schedulerAtivo) { iniciarAgendador(db); console.log('Agendador de sincronização ativo.'); }
  indexarItensEmSegundoPlano(db);
});
