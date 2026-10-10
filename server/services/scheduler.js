// Agendador simples em processo: dispara cada fonte habilitada conforme frequência.
// Em produção com várias instâncias, rode apenas UMA instância com SCHEDULER=on
// (ou use o script `npm run sync` em um cron do sistema).
import { sincronizarFonte } from './sync.js';
import { recalcularStatusTemporais } from './repositorio.js';
import { CONECTORES } from '../connectors/registro.js';

export function iniciarAgendador(db, { intervaloMs = 60_000 } = {}) {
  const tick = async () => {
    try {
      recalcularStatusTemporais(db);
      const fontes = db.prepare(`SELECT codigo, frequencia_minutos, ultima_sincronizacao, ultima_sincronizacao_ok FROM fontes
        WHERE habilitada=1 AND frequencia_minutos > 0`).all();
      for (const f of fontes) {
        if (!CONECTORES[f.codigo]) continue;
        const ultima = f.ultima_sincronizacao ? Date.parse(f.ultima_sincronizacao.replace(' ', 'T') + 'Z') : 0;
        if (Date.now() - ultima >= f.frequencia_minutos * 60_000) {
          // Primeira carga: traz todas as contratações com propostas abertas; depois, só o incremental.
          const modo = f.ultima_sincronizacao_ok ? 'incremental' : 'abertas';
          const r = await sincronizarFonte(db, f.codigo, { modo });
          console.log(`[agendador] ${f.codigo}: ${r.status ?? ''} ${r.mensagem ?? ''}`);
        }
      }
    } catch (e) { console.error('[agendador]', e.message); }
  };
  const h = setInterval(tick, intervaloMs);
  setTimeout(tick, 5_000);
  return () => clearInterval(h);
}
