// Cliente HTTP com timeout, tentativas com espera progressiva (backoff exponencial + jitter)
// e limitador simples de taxa por host.
import { config } from '../config.js';

const ultimoPorHost = new Map();
const intervaloExtraPorHost = new Map(); // aumenta após HTTP 429 (o servidor pediu para ir mais devagar)
const intervaloMin = () => Number(process.env.HTTP_MIN_INTERVAL_MS ?? 1000);
const espera429Padrao = () => Number(process.env.HTTP_ESPERA_429_MS ?? 15000);
const penalidade429 = () => Number(process.env.HTTP_PENALIDADE_429_MS ?? 1000);
const ESPERA_MAX_MS = 120_000;

export class ErroHttp extends Error {
  constructor(msg, { status = null, url, corpo = null, tipo = 'http' } = {}) {
    super(msg); this.status = status; this.url = url; this.corpo = corpo; this.tipo = tipo;
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function respeitarTaxa(host) {
  const agora = Date.now();
  const ult = ultimoPorHost.get(host) || 0;
  const intervalo = intervaloMin() + (intervaloExtraPorHost.get(host) || 0);
  const espera = ult + intervalo - agora;
  ultimoPorHost.set(host, Math.max(agora, ult + intervalo));
  if (espera > 0) await dormir(espera);
}

export function classificarErroRede(e) {
  const causa = e?.cause?.message || e?.message || String(e);
  if (/403|tunnel|CONNECT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|proxy|Request was cancelled/i.test(causa)) return 'bloqueada_rede';
  return 'erro';
}

/**
 * GET com JSON. Erros 5xx e de rede: até `tentativas` com espera progressiva.
 * HTTP 429 (limite de requisições): espera mais longa (Retry-After ou 15s, 30s, 60s...),
 * até `tentativas429` vezes, e o intervalo entre chamadas ao host aumenta daí em diante.
 */
export async function getJson(url, {
  tentativas = 4, tentativas429 = 6, fetchImpl = globalThis.fetch,
  baseEsperaMs = Number(process.env.HTTP_BASE_ESPERA_MS ?? 1000), espera429Ms = espera429Padrao(),
} = {}) {
  const host = new URL(url).host;
  let ultimoErro;
  let falhas = 0; let limites = 0;
  for (;;) {
    await respeitarTaxa(host);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), config.httpTimeoutMs);
    let resp; let texto;
    try {
      resp = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': config.userAgent } });
      texto = resp.status === 204 ? '' : await resp.text();
    } catch (e) {
      clearTimeout(t);
      ultimoErro = new ErroHttp(`Falha de rede ao acessar ${host}: ${e?.cause?.message || e.message}`, { url, tipo: classificarErroRede(e) });
      falhas++;
      if (ultimoErro.tipo === 'bloqueada_rede' && falhas >= 2) throw ultimoErro; // bloqueio de política: não insistir
      if (falhas >= tentativas) throw ultimoErro;
      await dormir(baseEsperaMs * 2 ** (falhas - 1) + Math.random() * 250);
      continue;
    }
    clearTimeout(t);
    if (resp.status === 204) return { vazio: true, dados: null };
    if (resp.ok) {
      if (!texto) return { vazio: true, dados: null };
      try { return { vazio: false, dados: JSON.parse(texto) }; }
      catch { throw new ErroHttp('Resposta não é JSON válido', { status: resp.status, url, corpo: texto.slice(0, 300), tipo: 'formato' }); }
    }
    ultimoErro = new ErroHttp(`HTTP ${resp.status} em ${url}`, { status: resp.status, url, corpo: texto.slice(0, 300) });
    if (resp.status === 429) {
      limites++;
      if (limites >= tentativas429) throw ultimoErro;
      intervaloExtraPorHost.set(host, Math.min(5 * penalidade429(), Math.max(penalidade429(), (intervaloExtraPorHost.get(host) || 0) * 2)));
      const retryAfter = Number(resp.headers.get('retry-after'));
      const espera = retryAfter > 0 ? retryAfter * 1000 : espera429Ms * 2 ** (limites - 1);
      await dormir(Math.min(ESPERA_MAX_MS, espera));
      continue;
    }
    if (resp.status < 500) throw ultimoErro; // 4xx: erro de parâmetro, repetir não resolve
    falhas++;
    if (falhas >= tentativas) throw ultimoErro;
    await dormir(baseEsperaMs * 2 ** (falhas - 1) + Math.random() * 250);
  }
}

/** Só para testes: zera o estado do limitador de taxa. */
export function _reiniciarLimitador() { ultimoPorHost.clear(); intervaloExtraPorHost.clear(); }
