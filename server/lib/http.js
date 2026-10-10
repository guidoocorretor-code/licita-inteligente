// Cliente HTTP com timeout, tentativas com espera progressiva (backoff exponencial + jitter)
// e limitador simples de taxa por host.
import { config } from '../config.js';

const ultimoPorHost = new Map();
const intervaloMin = () => Number(process.env.HTTP_MIN_INTERVAL_MS ?? 300);

export class ErroHttp extends Error {
  constructor(msg, { status = null, url, corpo = null, tipo = 'http' } = {}) {
    super(msg); this.status = status; this.url = url; this.corpo = corpo; this.tipo = tipo;
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function respeitarTaxa(host) {
  const agora = Date.now();
  const ult = ultimoPorHost.get(host) || 0;
  const espera = ult + intervaloMin() - agora;
  ultimoPorHost.set(host, Math.max(agora, ult + intervaloMin()));
  if (espera > 0) await dormir(espera);
}

export function classificarErroRede(e) {
  const causa = e?.cause?.message || e?.message || String(e);
  if (/403|tunnel|CONNECT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|proxy|Request was cancelled/i.test(causa)) return 'bloqueada_rede';
  return 'erro';
}

export async function getJson(url, { tentativas = 4, fetchImpl = globalThis.fetch, baseEsperaMs = Number(process.env.HTTP_BASE_ESPERA_MS ?? 1000) } = {}) {
  const host = new URL(url).host;
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    await respeitarTaxa(host);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), config.httpTimeoutMs);
    try {
      const resp = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': config.userAgent } });
      clearTimeout(t);
      if (resp.status === 204) return { vazio: true, dados: null };
      const texto = await resp.text();
      if (resp.ok) {
        if (!texto) return { vazio: true, dados: null };
        try { return { vazio: false, dados: JSON.parse(texto) }; }
        catch { throw new ErroHttp('Resposta não é JSON válido', { status: resp.status, url, corpo: texto.slice(0, 300), tipo: 'formato' }); }
      }
      const reexecutavel = resp.status === 429 || resp.status >= 500;
      ultimoErro = new ErroHttp(`HTTP ${resp.status} em ${url}`, { status: resp.status, url, corpo: texto.slice(0, 300) });
      if (!reexecutavel) throw ultimoErro;
      const retryAfter = Number(resp.headers.get('retry-after'));
      await dormir(retryAfter ? retryAfter * 1000 : baseEsperaMs * 2 ** (i - 1) + Math.random() * 250);
    } catch (e) {
      clearTimeout(t);
      if (e instanceof ErroHttp && e.tipo !== 'http') throw e;
      if (e instanceof ErroHttp && e.status && e.status < 500 && e.status !== 429) throw e;
      ultimoErro = e instanceof ErroHttp ? e
        : new ErroHttp(`Falha de rede ao acessar ${host}: ${e?.cause?.message || e.message}`, { url, tipo: classificarErroRede(e) });
      if (ultimoErro.tipo === 'bloqueada_rede' && i >= 2) break; // bloqueio de política: não insistir
      if (i < tentativas) await dormir(baseEsperaMs * 2 ** (i - 1) + Math.random() * 250);
    }
  }
  throw ultimoErro;
}
