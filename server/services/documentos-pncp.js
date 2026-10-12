// Arquivos do edital (PNCP) baixados pelo próprio sistema e entregues ao navegador.
// Antes o link ia direto para a API do PNCP: quando o PNCP demorava, recusava ou o arquivo tinha sido trocado,
// a aba abria em branco ou com erro técnico. Agora o servidor busca o arquivo, entrega com nome certo e,
// se o PNCP falhar, mostra uma página explicando e com o link da página oficial do edital.
import { config } from '../config.js';

const HOSTS_PNCP = new Set(['pncp.gov.br', 'www.pncp.gov.br']);
const TIMEOUT_MS = 60_000;

/** URL do arquivo no PNCP: a gravada na sincronização ou, se faltar, montada pelo identificador da compra. */
export function urlDoDocumento(lic, doc) {
  if (doc?.url) {
    try {
      const u = new URL(doc.url.replace(/^http:\/\//i, 'https://'));
      if (HOSTS_PNCP.has(u.host)) return u.toString();
    } catch { /* cai para a montada */ }
  }
  if (lic?.orgao_cnpj && lic?.ano && lic?.sequencial && doc?.sequencial != null) {
    return `https://pncp.gov.br/pncp-api/v1/orgaos/${lic.orgao_cnpj}/compras/${lic.ano}/${lic.sequencial}/arquivos/${doc.sequencial}`;
  }
  return null; // só baixamos do PNCP (nunca de outro endereço gravado no banco)
}

const limparNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Nome do arquivo: o que o PNCP informar; senão o título do documento com a extensão pelo tipo. */
export function nomeDoArquivo(doc, contentDisposition, contentType) {
  const m = /filename\*=(?:UTF-8'')?([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition || '');
  let nome = m ? decodeURIComponent((m[1] || m[2]).trim()) : '';
  nome = limparNome(nome);
  if (!nome) {
    const ext = /pdf/i.test(contentType || '') ? '.pdf' : /zip/i.test(contentType || '') ? '.zip' : '';
    nome = `${limparNome(doc?.titulo || doc?.tipo || 'documento') || 'documento'}${ext}`;
  }
  return nome;
}

/** Busca o arquivo no PNCP. Devolve { ok, resp } ou { ok:false, motivo }. */
export async function buscarArquivo(url, { fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': config.userAgent, accept: '*/*' } });
    if (!resp.ok) {
      clearTimeout(t);
      return { ok: false, motivo: resp.status === 404 ? 'O PNCP informa que este arquivo não existe mais (pode ter sido substituído ou excluído pelo órgão).' : `O PNCP respondeu com erro ${resp.status}.` };
    }
    return { ok: true, resp, fim: () => clearTimeout(t) };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, motivo: e?.name === 'AbortError' ? 'O PNCP demorou mais de 60 segundos para responder.' : 'Não foi possível falar com o PNCP agora.' };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Página exibida quando o arquivo não pôde ser baixado (nada de tela em branco). */
export function paginaFalha({ motivo, doc, linkPncp, urlArquivo }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arquivo indisponível</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1d2433;line-height:1.5}
a.btn{display:inline-block;margin:6px 8px 0 0;padding:10px 14px;border-radius:8px;background:#1e4f9c;color:#fff;text-decoration:none}a.sec{background:#e8edf5;color:#1e4f9c}</style></head><body>
<h1>Não consegui abrir este arquivo agora</h1>
<p><b>${esc(doc?.tipo || 'Documento')}</b>${doc?.titulo ? ` — ${esc(doc.titulo)}` : ''}</p>
<p>${esc(motivo)}</p>
<p>${linkPncp ? `<a class="btn" href="${esc(linkPncp)}" target="_blank" rel="noopener">Abrir o edital na página oficial do PNCP</a>` : ''}
${urlArquivo ? `<a class="btn sec" href="${esc(urlArquivo)}" rel="noopener">Tentar o arquivo direto no PNCP</a>` : ''}</p>
<p style="color:#5b6577;font-size:14px">Na página oficial, a lista de arquivos fica na aba "Arquivos" do edital.</p></body></html>`;
}
