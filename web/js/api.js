// Cliente da API. Cookies HttpOnly carregam a sessão; o cabeçalho X-Requested-With protege contra CSRF.
export class ErroApi extends Error {
  constructor(msg, status, dados = {}) { super(msg); this.status = status; this.dados = dados; }
}

// Empresa assessorada selecionada no topo (vazio = todas). Fica só neste navegador.
export function clienteSelecionado() { try { return localStorage.getItem('licita.cliente') || ''; } catch { return ''; } }
export function selecionarCliente(id) { try { if (id) localStorage.setItem('licita.cliente', String(id)); else localStorage.removeItem('licita.cliente'); } catch { /* ignora */ } }

export async function api(caminho, { metodo = 'GET', corpo, bruto = false } = {}) {
  let resp;
  const multipart = corpo instanceof FormData;
  const cli = clienteSelecionado();
  try {
    resp = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'licita', ...(cli ? { 'x-cliente': cli } : {}), ...(corpo !== undefined && !multipart ? { 'content-type': 'application/json' } : {}) },
      body: corpo === undefined ? undefined : multipart ? corpo : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi('Sem conexão com o servidor. Verifique sua internet.', 0);
  }
  if (resp.status === 401 && !caminho.startsWith('/auth/login')) {
    window.dispatchEvent(new CustomEvent('sessao-expirada'));
  }
  if (bruto) return resp;
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 404 && cli && /^Empresa selecionada/.test(dados.erro || '')) { selecionarCliente(''); location.reload(); }
  if (!resp.ok) throw new ErroApi(dados.erro || `Erro ${resp.status}`, resp.status, dados);
  return dados;
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== '' && v != null && v !== false) p.set(k, Array.isArray(v) ? v.join(',') : v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
