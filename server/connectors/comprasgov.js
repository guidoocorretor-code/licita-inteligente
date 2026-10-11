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

// ---------- Pesquisa de preços (Fase 4) ----------
// Módulo 03: materiais por PDM ou código CATMAT (tipo + codigo); serviços por código CATSER (codigoItemCatalogo).
// Verificado em 10/10/2026: tamanhoPagina vai de 10 a 500; os resultados vêm dos mais antigos para os mais novos,
// por isso a consulta sempre usa um período (dataCompraInicio/dataCompraFim).
export function urlPrecos({ tipo, codigo, uf, desde, ate, pagina = 1, tamanhoPagina = 500 }) {
  const comum = { pagina, tamanhoPagina, estado: uf, dataCompraInicio: desde, dataCompraFim: ate };
  if (tipo === 'servico') return `${BASE_COMPRAS}/modulo-pesquisa-preco/3_consultarServico?${qs({ ...comum, codigoItemCatalogo: codigo })}`;
  const t = tipo === 'material_item' ? 'codigoItemCatalogo' : 'codigoPdm';
  return `${BASE_COMPRAS}/modulo-pesquisa-preco/1_consultarMaterial?${qs({ tipo: t, codigo, ...comum })}`;
}

/**
 * Baixa os preços mais recentes. A fonte devolve do mais antigo para o mais novo; quando há mais páginas do que
 * o limite, busca as ÚLTIMAS páginas (compras mais novas) e descarta as antigas. Páginas em paralelo (3 por vez).
 */
export async function baixarPrecos(params, { maxPaginas = 6, concorrencia = 3, fetchImpl } = {}) {
  const pag = async (pagina) => {
    const { vazio, dados } = await getJson(urlPrecos({ ...params, pagina }), { fetchImpl });
    return vazio || !Array.isArray(dados?.resultado) ? { lista: [], dados } : { lista: dados.resultado, dados };
  };
  const primeira = await pag(1);
  if (!primeira.lista.length) return { registros: [], totalRegistros: primeira.dados?.totalRegistros ?? 0, truncado: false };
  const totalPaginas = primeira.dados.totalPaginas || (1 + (primeira.dados.paginasRestantes || 0));
  const truncado = totalPaginas > maxPaginas;
  const paginas = truncado
    ? Array.from({ length: maxPaginas }, (_, k) => totalPaginas - k).reverse()   // as mais novas
    : Array.from({ length: totalPaginas - 1 }, (_, k) => k + 2);
  const resultados = new Map();
  if (!truncado) resultados.set(1, primeira.lista);
  for (let k = 0; k < paginas.length; k += concorrencia) {
    const lote = paginas.slice(k, k + concorrencia);
    const r = await Promise.all(lote.map((p) => pag(p)));
    lote.forEach((p, j) => resultados.set(p, r[j].lista));
  }
  const registros = [...resultados.keys()].sort((a, b) => a - b).flatMap((p) => resultados.get(p));
  return { registros, totalRegistros: primeira.dados.totalRegistros ?? registros.length, truncado };
}

// Catálogo: PDM de materiais (módulo 01, item 3) e itens de serviço (módulo 02, item 6)
export async function* paginarCatalogo(tipo, { maxPaginas = 400, fetchImpl } = {}) {
  const caminho = tipo === 'servico' ? '/modulo-servico/6_consultarItemServico' : '/modulo-material/3_consultarPdmMaterial';
  const filtro = tipo === 'servico' ? { statusServico: true } : { statusPdm: true };
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${BASE_COMPRAS}${caminho}?${qs({ ...filtro, pagina, tamanhoPagina: 500 })}`;
    const { vazio, dados } = await getJson(url, { fetchImpl });
    const lista = dados?.resultado;
    if (vazio || !Array.isArray(lista) || lista.length === 0) return;
    yield lista;
    if (dados.paginasRestantes === 0 || lista.length < 500) return;
  }
}
