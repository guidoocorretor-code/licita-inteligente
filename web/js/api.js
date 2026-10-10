// Cliente da API. Cookies HttpOnly carregam a sessão; o cabeçalho X-Requested-With protege contra CSRF.
export class ErroApi extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

export async function api(caminho, { metodo = 'GET', corpo, bruto = false } = {}) {
  let resp;
  try {
    resp = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'licita', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi('Sem conexão com o servidor. Verifique sua internet.', 0);
  }
  if (resp.status === 401 && !caminho.startsWith('/auth/login')) {
    window.dispatchEvent(new CustomEvent('sessao-expirada'));
  }
  if (bruto) return resp;
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroApi(dados.erro || `Erro ${resp.status}`, resp.status);
  return dados;
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== '' && v != null && v !== false) p.set(k, Array.isArray(v) ? v.join(',') : v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
