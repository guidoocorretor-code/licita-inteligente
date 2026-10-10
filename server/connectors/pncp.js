// Conector PNCP — API pública de consultas (sem autenticação).
// Documentação: https://pncp.gov.br/api/consulta/swagger-ui/index.html
//               https://pncp.gov.br/manual/pt-br/latest/index.html
import { getJson } from '../lib/http.js';
import { normalizarPncp, normalizarItemPncp, normalizarDocumentoPncp } from '../services/normalizacao.js';

export const BASE_CONSULTA = process.env.PNCP_CONSULTA_URL || 'https://pncp.gov.br/api/consulta';
export const BASE_PNCP = process.env.PNCP_API_URL || 'https://pncp.gov.br/api/pncp';
const TAM_PAGINA = 50; // máximo aceito pelos endpoints de contratações

const yyyymmdd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

function qs(params) {
  return Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** Itera páginas de um endpoint de contratações. */
export async function* paginarContratacoes(endpoint, params, { maxPaginas = 20, fetchImpl } = {}) {
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${BASE_CONSULTA}/v1/contratacoes/${endpoint}?${qs({ ...params, pagina, tamanhoPagina: TAM_PAGINA })}`;
    const { vazio, dados } = await getJson(url, { fetchImpl });
    if (vazio || !dados || !Array.isArray(dados.data) || dados.data.length === 0) return;
    yield { pagina, url, registros: dados.data, totalPaginas: dados.totalPaginas, totalRegistros: dados.totalRegistros };
    if (!dados.paginasRestantes || pagina >= dados.totalPaginas) return;
  }
}

export async function buscarItens(cnpj, ano, seq, { fetchImpl } = {}) {
  const todos = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const url = `${BASE_PNCP}/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=${pagina}&tamanhoPagina=500`;
    const { vazio, dados } = await getJson(url, { fetchImpl });
    if (vazio || !Array.isArray(dados) || dados.length === 0) break;
    todos.push(...dados);
    if (dados.length < 500) break;
  }
  return todos.map(normalizarItemPncp);
}

export async function buscarDocumentos(cnpj, ano, seq, { fetchImpl } = {}) {
  const url = `${BASE_PNCP}/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;
  const { vazio, dados } = await getJson(url, { fetchImpl });
  if (vazio || !Array.isArray(dados)) return [];
  return dados.map(normalizarDocumentoPncp);
}

export const conectorPncp = {
  codigo: 'pncp',

  async testar({ fetchImpl } = {}) {
    const hoje = new Date();
    const url = `${BASE_CONSULTA}/v1/contratacoes/publicacao?${qs({ dataInicial: yyyymmdd(new Date(hoje - 86400000)), dataFinal: yyyymmdd(hoje), codigoModalidadeContratacao: 6, pagina: 1, tamanhoPagina: 10 })}`;
    const { dados } = await getJson(url, { fetchImpl, tentativas: 2 });
    return { ok: true, url, totalRegistros: dados?.totalRegistros ?? 0 };
  },

  /**
   * Gera lotes de registros normalizados.
   * modo 'incremental': /atualizacao desde o cursor (pega novas e alteradas)
   * modo 'abertas': /proposta (contratações com recebimento de propostas em aberto)
   */
  async *coletar(fonte, { modo = 'incremental', fetchImpl, agora = new Date() } = {}) {
    const cfg = fonte.config;
    const cursor = fonte.cursor;
    const ufs = cfg.ufs?.length ? cfg.ufs : [null];
    const modalidades = cfg.modalidades?.length ? cfg.modalidades : [6];
    const maxPaginas = cfg.maxPaginasPorConsulta || 20;

    if (modo === 'abertas') {
      const dataFinal = yyyymmdd(new Date(agora.getTime() + 90 * 86400000));
      for (const uf of ufs) for (const mod of modalidades) {
        for await (const p of paginarContratacoes('proposta', { dataFinal, codigoModalidadeContratacao: mod, uf }, { maxPaginas, fetchImpl })) {
          yield { ...p, itens: p.registros.map((r) => ({ bruto: r, canonico: normalizarPncp(r) })) };
        }
      }
      return;
    }

    const fim = yyyymmdd(agora);
    for (const uf of ufs) for (const mod of modalidades) {
      const chave = `${uf || 'BR'}:${mod}`;
      const desde = cursor[chave] || yyyymmdd(new Date(agora.getTime() - (cfg.diasRetroativos ?? 3) * 86400000));
      for await (const p of paginarContratacoes('atualizacao', { dataInicial: desde, dataFinal: fim, codigoModalidadeContratacao: mod, uf }, { maxPaginas, fetchImpl })) {
        yield { ...p, itens: p.registros.map((r) => ({ bruto: r, canonico: normalizarPncp(r) })) };
      }
      yield { cursor: { [chave]: fim } };
    }
  },

  async detalhes(lic, { fetchImpl } = {}) {
    if (!lic.orgao_cnpj || !lic.ano || !lic.sequencial) return null;
    const itens = await buscarItens(lic.orgao_cnpj, lic.ano, lic.sequencial, { fetchImpl });
    const documentos = await buscarDocumentos(lic.orgao_cnpj, lic.ano, lic.sequencial, { fetchImpl });
    return { itens, documentos };
  },
};
