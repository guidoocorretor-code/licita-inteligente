import { config } from './config.js';
import { getDb, indexarItensEmSegundoPlano, conferirIndiceBusca } from './db/index.js';
import { classificarSistemasEmSegundoPlano } from './services/sistemas.js';
import { reclassificarSegmentosEmSegundoPlano } from './services/segmentos.js';
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
  classificarSistemasEmSegundoPlano(db);
  reclassificarSegmentosEmSegundoPlano(db);
  // Índice de busca desalinhado traz licitação errada na busca e nos jornais: confere e, se preciso, refaz
  setTimeout(() => { try { conferirIndiceBusca(db); } catch (e) { console.error('[indice]', e.message); } }, 15_000).unref();
});
