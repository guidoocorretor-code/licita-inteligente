// Sincronização via linha de comando (para cron do sistema).
// Uso: npm run sync -- pncp [incremental|abertas]
import { getDb } from '../server/db/index.js';
import { sincronizarFonte } from '../server/services/sync.js';

const [codigo = 'pncp', modo = 'incremental'] = process.argv.slice(2);
const r = await sincronizarFonte(getDb(), codigo, { modo });
console.log(JSON.stringify(r, null, 2));
process.exit(r.status === 'erro' ? 2 : 0);
