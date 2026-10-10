// Conectores Compras.gov.br — API de Dados Abertos.
// Documentação: https://dadosabertos.compras.gov.br/swagger-ui/index.html
import { getJson } from '../lib/http.js';
import { normalizarCompras14133, normalizarComprasLegado } from '../services/normalizacao.js';

export const BASE_COMPRAS = process.env.COMPRAS_DADOS_URL || 'https://dadosabertos.compras.gov.br';
const isoDia = (d) => d.toISOString().slice(0, 10);
const qs = (p) => Object.entries(p).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function* paginar(caminho, params, { maxPaginas = 10, tamanhoPagina = 100, fetchImpl } = {}) {
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${BASE_COMPRAS}${caminho}?${qs({ ...params, pagina, tamanhoPagina })}`;
    const { vazio, dados } = await getJson(url, { fetchImpl });
    const lista = dados?.resultado;
    if (vazio || !Array.isArray(lista) || lista.length === 0) return;
    yield { pagina, url, registros: lista, totalPaginas: dados.totalPaginas, totalRegistros: dados.totalRegistros };
    if (!dados.paginasRestantes) return;
  }
}

export const conectorCompras14133 = {
  codigo: 'comprasgov_14133',
  async testar({ fetchImpl } = {}) {
    const d = new Date();
    const url = `${BASE_COMPRAS}/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?${qs({ pagina: 1, tamanhoPagina: 10, dataPublicacaoPncpInicial: isoDia(new Date(d - 86400000)), dataPublicacaoPncpFinal: isoDia(d), codigoModalidade: 6 })}`;
    const { dados } = await getJson(url, { fetchImpl, tentativas: 2 });
    return { ok: true, url, totalRegistros: dados?.totalRegistros ?? 0 };
  },
  async *coletar(fonte, { fetchImpl, agora = new Date() } = {}) {
    const cfg = fonte.config;
    for (const mod of cfg.modalidades?.length ? cfg.modalidades : [6]) {
      const chave = `mod:${mod}`;
      const desde = fonte.cursor[chave] || isoDia(new Date(agora.getTime() - (cfg.diasRetroativos ?? 2) * 86400000));
      const ate = isoDia(agora);
      for await (const p of paginar('/modulo-contratacoes/1_consultarContratacoes_PNCP_14133',
        { dataPublicacaoPncpInicial: desde, dataPublicacaoPncpFinal: ate, codigoModalidade: mod }, { maxPaginas: cfg.maxPaginas || 20, fetchImpl })) {
        yield { ...p, itens: p.registros.map((r) => ({ bruto: r, canonico: normalizarCompras14133(r) })).filter((x) => !x.canonico.excluida) };
      }
      yield { cursor: { [chave]: ate } };
    }
  },
};

export const conectorComprasLegado = {
  codigo: 'comprasgov_legado',
  async testar({ fetchImpl } = {}) {
    const d = new Date();
    const url = `${BASE_COMPRAS}/modulo-legado/1_consultarLicitacao?${qs({ pagina: 1, tamanhoPagina: 10, data_publicacao_inicial: isoDia(new Date(d - 86400000)), data_publicacao_final: isoDia(d) })}`;
    const { dados } = await getJson(url, { fetchImpl, tentativas: 2 });
    return { ok: true, url, totalRegistros: dados?.totalRegistros ?? 0 };
  },
  async *coletar(fonte, { fetchImpl, agora = new Date() } = {}) {
    const cfg = fonte.config;
    const desde = fonte.cursor.data || isoDia(new Date(agora.getTime() - (cfg.diasRetroativos ?? 2) * 86400000));
    const ate = isoDia(agora);
    for await (const p of paginar('/modulo-legado/1_consultarLicitacao',
      { data_publicacao_inicial: desde, data_publicacao_final: ate }, { maxPaginas: cfg.maxPaginas || 10, fetchImpl })) {
      yield { ...p, itens: p.registros.map((r) => ({ bruto: r, canonico: normalizarComprasLegado(r) })) };
    }
    yield { cursor: { data: ate } };
  },
};

// Pesquisa de preços (Fase 4): consulta sob demanda por código CATMAT/CATSER
export async function consultarPrecosMaterial(codigoItemCatalogo, { pagina = 1, fetchImpl } = {}) {
  const url = `${BASE_COMPRAS}/modulo-pesquisa-preco/1_consultarMaterial?${qs({ pagina, tamanhoPagina: 100, codigoItemCatalogo })}`;
  const { dados } = await getJson(url, { fetchImpl });
  return dados;
}
