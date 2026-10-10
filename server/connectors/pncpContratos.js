// Conector PNCP — contratos publicados (/v1/contratos), consulta pública por data de publicação.
// Documentação: https://pncp.gov.br/api/consulta/swagger-ui/index.html
// O endpoint não filtra por UF (testado em 10/10/2026): o filtro de UFs, se configurado, é aplicado ao salvar.
import { getJson } from '../lib/http.js';
import { BASE_CONSULTA } from './pncp.js';
import { normalizarContratoPncp } from '../services/normalizacao.js';
import { salvarContrato } from '../services/contratos.js';

const yyyymmdd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const deYyyymmdd = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00Z`);
const qs = (p) => Object.entries(p).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function* paginarDia(dia, { tamanhoPagina, maxPaginas, fetchImpl }) {
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${BASE_CONSULTA}/v1/contratos?${qs({ dataInicial: dia, dataFinal: dia, pagina, tamanhoPagina })}`;
    const { vazio, dados } = await getJson(url, { fetchImpl });
    if (vazio || !dados || !Array.isArray(dados.data) || dados.data.length === 0) return;
    yield { pagina, url, registros: dados.data, totalPaginas: dados.totalPaginas, totalRegistros: dados.totalRegistros };
    if (!dados.paginasRestantes || pagina >= dados.totalPaginas) return;
  }
  yield { truncado: true };
}

export const conectorPncpContratos = {
  codigo: 'pncp_contratos',
  segundoPlano: true,   // cargas de vários dias demoram: a tela não espera
  cursorParcial: true,  // cada dia concluído fica salvo mesmo se um dia seguinte falhar

  async testar({ fetchImpl } = {}) {
    const ontem = yyyymmdd(new Date(Date.now() - 86400000));
    const url = `${BASE_CONSULTA}/v1/contratos?${qs({ dataInicial: ontem, dataFinal: ontem, pagina: 1, tamanhoPagina: 10 })}`;
    const { dados } = await getJson(url, { fetchImpl, tentativas: 2 });
    return { ok: true, url, totalRegistros: dados?.totalRegistros ?? 0 };
  },

  async *coletar(fonte, { fetchImpl, agora = new Date() } = {}) {
    const cfg = fonte.config;
    const hoje = yyyymmdd(agora);
    let dia = fonte.cursor.data || yyyymmdd(new Date(agora.getTime() - (cfg.diasRetroativos ?? 30) * 86400000));
    const opts = { tamanhoPagina: cfg.tamanhoPagina || 500, maxPaginas: cfg.maxPaginasPorDia || 400, fetchImpl };
    while (dia <= hoje) {
      let truncado = false;
      for await (const p of paginarDia(dia, opts)) {
        if (p.truncado) { truncado = true; continue; }
        yield { ...p, itens: p.registros.map((r) => ({ bruto: r, canonico: normalizarContratoPncp(r) })) };
      }
      if (truncado) throw new Error(`Dia ${dia} com mais páginas que o limite de segurança (${opts.maxPaginas}); aumente maxPaginasPorDia.`);
      yield { cursor: { data: dia } }; // o dia de hoje é consultado de novo na próxima vez (ainda recebe publicações)
      dia = yyyymmdd(new Date(deYyyymmdd(dia).getTime() + 86400000));
    }
  },

  salvar(db, c, fonte) {
    const ufs = fonte?.config?.ufs;
    if (ufs?.length && c.uf && !ufs.includes(c.uf)) return { acao: 'ignorado' };
    return salvarContrato(db, c);
  },

  contar(db) { return db.prepare('SELECT COUNT(*) n FROM contratos').get().n; },
  normalizar: normalizarContratoPncp,
};
