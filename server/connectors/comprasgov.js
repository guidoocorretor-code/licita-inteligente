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
// Verificado em 10/10/2026: tamanhoPagina vai de 10 a 500. Verificado em 12/10/2026: a ORDEM dos resultados não é
// garantida (a consulta do Brasil inteiro vem das mais novas para as mais antigas; outras, ao contrário). Por isso
// nunca se usa "só algumas páginas" como amostra: o período é baixado inteiro e, se for grande, dividido em partes.
export function urlPrecos({ tipo, codigo, uf, desde, ate, pagina = 1, tamanhoPagina = 500 }) {
  const comum = { pagina, tamanhoPagina, estado: uf, dataCompraInicio: desde, dataCompraFim: ate };
  if (tipo === 'servico') return `${BASE_COMPRAS}/modulo-pesquisa-preco/3_consultarServico?${qs({ ...comum, codigoItemCatalogo: codigo })}`;
  const t = tipo === 'material_item' ? 'codigoItemCatalogo' : 'codigoPdm';
  return `${BASE_COMPRAS}/modulo-pesquisa-preco/1_consultarMaterial?${qs({ tipo: t, codigo, ...comum })}`;
}

const diaIso = (d) => d.toISOString().slice(0, 10);
const somarDias = (dia, n) => diaIso(new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86400000));

/**
 * Baixa TODOS os preços do período. Quando o período tem mais páginas do que `maxPaginas`, divide o período ao
 * meio (repetidamente) e baixa cada parte inteira, até o limite total de `maxTotalPaginas`. Só fica "truncado"
 * quando uma parte de 1 dia ainda passa do limite ou quando o limite total acaba (nesse caso o total da fonte
 * continua certo em `totalRegistros`). Páginas em paralelo (`concorrencia` por vez).
 */
export async function baixarPrecos(params, { maxPaginas = 10, maxTotalPaginas = 60, concorrencia = 4, fetchImpl } = {}) {
  const pag = async (p, pagina) => {
    const { vazio, dados } = await getJson(urlPrecos({ ...p, pagina }), { fetchImpl });
    return vazio || !Array.isArray(dados?.resultado) ? { lista: [], dados } : { lista: dados.resultado, dados };
  };
  let usadas = 0; let truncado = false;
  const parte = async (p) => {
    const primeira = await pag(p, 1); usadas++;
    if (!primeira.lista.length) return { registros: [], total: primeira.dados?.totalRegistros ?? 0 };
    const totalPaginas = primeira.dados.totalPaginas || (1 + (primeira.dados.paginasRestantes || 0));
    const total = primeira.dados.totalRegistros ?? primeira.lista.length;
    // Grande demais: divide o período (se ainda dá para dividir)
    if (totalPaginas > maxPaginas && p.desde && p.ate && p.desde < p.ate) {
      const dias = Math.round((Date.parse(p.ate) - Date.parse(p.desde)) / 86400000);
      const meio = somarDias(p.desde, Math.floor(dias / 2));
      const a = await parte({ ...p, ate: meio });
      const b = await parte({ ...p, desde: somarDias(meio, 1) });
      return { registros: [...a.registros, ...b.registros], total };
    }
    const quer = Math.min(totalPaginas, maxPaginas, Math.max(1, maxTotalPaginas - usadas + 1));
    if (quer < totalPaginas) truncado = true;
    const resto = Array.from({ length: quer - 1 }, (_, k) => k + 2);
    const listas = [primeira.lista];
    for (let k = 0; k < resto.length; k += concorrencia) {
      const lote = resto.slice(k, k + concorrencia);
      const r = await Promise.all(lote.map((n) => pag(p, n)));
      usadas += lote.length;
      listas.push(...r.map((x) => x.lista));
    }
    return { registros: listas.flat(), total };
  };
  const r = await parte(params);
  return { registros: r.registros, totalRegistros: r.total, truncado };
}

/** Só o total de compras registradas no período (1 página pequena), para quando a amostra baixada é parcial. */
export async function contarCompras(params, { fetchImpl } = {}) {
  const { dados } = await getJson(urlPrecos({ ...params, pagina: 1, tamanhoPagina: 10 }), { fetchImpl });
  return dados?.totalRegistros ?? 0;
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
