// Agendador simples em processo: dispara cada fonte habilitada conforme frequência.
// Em produção com várias instâncias, rode apenas UMA instância com SCHEDULER=on
// (ou use o script `npm run sync` em um cron do sistema).
import { sincronizarFonte, completarItensAbertas } from './sync.js';
import { atualizarCapag, precisaAtualizarCapag } from './capag.js';
import { recalcularStatusTemporais } from './repositorio.js';
import { CONECTORES } from '../connectors/registro.js';
import { avaliarAlertasAcompanhadas, avaliarAlertasNotaFiscal } from './alertas.js';
import { enviarAlertasPendentes } from './email.js';
import { agoraBrasilia } from './status.js';
import { precisaAtualizarCatalogo, sincronizarCatalogo } from './precos.js';
import { espacoEmDisco } from '../lib/disco.js';
import { avaliarAlertasVencimentos } from './clientes.js';

export function iniciarAgendador(db, { intervaloMs = 60_000 } = {}) {
  let ultimoEmail = 0;
  let ultimaVerificacaoCatalogo = 0;
  let ultimoAvisoDisco = 0;
  let ultimaVerificacaoCapag = 0;
  const tick = async () => {
    // Alertas de prazo/mudança e e-mail rodam antes das sincronizações, que podem demorar
    try { avaliarAlertasAcompanhadas(db, agoraBrasilia()); } catch (e) { console.error('[alertas]', e.message); }
    try { avaliarAlertasVencimentos(db, agoraBrasilia().slice(0, 10)); } catch (e) { console.error('[vencimentos]', e.message); }
    try { avaliarAlertasNotaFiscal(db, agoraBrasilia().slice(0, 10)); } catch (e) { console.error('[nota fiscal]', e.message); }
    if (Date.now() - ultimoEmail >= 10 * 60_000) {
      ultimoEmail = Date.now();
      enviarAlertasPendentes(db).catch((e) => console.error('[email]', e.message));
    }
    // Disco quase cheio: para de baixar dados novos (alertas e o site continuam) até alguém liberar espaço
    const disco = espacoEmDisco();
    if (disco?.baixo) {
      if (Date.now() - ultimoAvisoDisco >= 3600_000) {
        ultimoAvisoDisco = Date.now();
        console.error(`[disco] só ${disco.livre_mb} MB livres de ${disco.total_mb} MB (${disco.livre_pct}%): sincronizações pausadas.`);
      }
      return;
    }
    // Catálogo do Compras.gov.br (para a pesquisa de preços): baixa se vazio ou com mais de 30 dias
    if (Date.now() - ultimaVerificacaoCatalogo >= 6 * 3600_000) {
      ultimaVerificacaoCatalogo = Date.now();
      try {
        if (precisaAtualizarCatalogo(db)) {
          sincronizarCatalogo(db).then((r) => console.log('[catalogo]', JSON.stringify(r))).catch((e) => console.error('[catalogo]', e.message));
        }
      } catch (e) { console.error('[catalogo]', e.message); }
    }
    // Pagômetro: CAPAG do Tesouro (divulgação quadrimestral); confere a cada 12 h e baixa se tiver mais de 7 dias
    if (Date.now() - ultimaVerificacaoCapag >= 12 * 3600_000) {
      ultimaVerificacaoCapag = Date.now();
      try {
        if (precisaAtualizarCapag(db)) atualizarCapag(db).then((r) => console.log('[capag]', JSON.stringify(r))).catch((e) => console.error('[capag]', e.message));
      } catch (e) { console.error('[capag]', e.message); }
    }
    // Itens das licitações abertas (para a busca achar "mouse" dentro de "materiais de informática"): sem esperar o tick
    completarItensAbertas(db).then((r) => { if (r.baixadas || r.falhas) console.log('[itens]', JSON.stringify(r)); })
      .catch((e) => console.error('[itens]', e.message));
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
