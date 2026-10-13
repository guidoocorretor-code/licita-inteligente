// Confere a busca do LicitPro com a busca do site do PNCP (pncp.gov.br/app/editais) para a mesma palavra e UF.
// O que o PNCP achou e não está no LicitPro é importado na hora (API de consulta oficial do PNCP) e os itens
// das que ainda não tinham itens baixados são baixados, para a busca nos itens funcionar.
// A busca do site usa o endpoint /api/search do próprio portal (não faz parte da API de consulta documentada):
// se ele mudar ou falhar, a conferência avisa e nada é alterado.
import { getJson } from '../lib/http.js';
import { BASE_CONSULTA } from '../connectors/pncp.js';
import { CONECTORES } from '../connectors/registro.js';
import { normalizarPncp } from './normalizacao.js';
import { salvarLicitacao, salvarItens, salvarDocumentos, recalcularStatusDe } from './repositorio.js';
import { buscarTodos } from './busca.js';
import { agoraBrasilia } from './status.js';

const BASE_SITE = process.env.PNCP_SITE_URL || 'https://pncp.gov.br';
const TAM = 100;
const MAX_RESULTADOS = 1000;

// "27165638000139-1-000153/2024" -> { cnpj, ano, seq }
export function partesDoControle(n) {
  const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(String(n || '').trim());
  return m ? { cnpj: m[1], seq: Number(m[2]), ano: Number(m[3]) } : null;
}

/** Lista do site do PNCP: editais recebendo propostas com a palavra, na UF. */
export async function buscaDoSite(q, uf, { fetchImpl } = {}) {
  const lista = [];
  let total = null;
  for (let pagina = 1; pagina <= MAX_RESULTADOS / TAM; pagina++) {
    const params = new URLSearchParams({ q, tipos_documento: 'edital', ordenacao: '-data', pagina, tam_pagina: TAM, status: 'recebendo_proposta' });
    if (uf) params.set('ufs', uf);
    const { dados } = await getJson(`${BASE_SITE}/api/search/?${params}`, { fetchImpl });
    const itens = Array.isArray(dados?.items) ? dados.items : [];
    if (total == null) total = Number(dados?.total) || 0;
    for (const it of itens) if (it.numero_controle_pncp) lista.push({ numero: it.numero_controle_pncp, orgao: it.orgao_nome || null, objeto: it.description || null });
    if (!itens.length || lista.length >= total) break;
  }
  return { total: total ?? 0, lista };
}

/**
 * @returns {{ pncp, licitpro, em_comum, importadas, itens_baixados, faltando: [], so_pncp: [] }}
 * faltando = o que o PNCP lista e o LicitPro ainda não mostra, com o motivo.
 */
export async function conferirComPncp(db, { q, uf, fetchImpl, limiteChamadas = 60 } = {}) {
  const termo = String(q || '').trim();
  if (termo.length < 2) throw new Error('Digite a palavra-chave para conferir com o PNCP.');
  const sigla = uf ? String(uf).trim().toUpperCase() : '';
  const site = await buscaDoSite(termo, sigla, { fetchImpl });
  const filtro = { q: termo, uf: sigla || undefined, visao: 'abertas' };
  const nossas = () => new Set(buscarTodos(db, filtro, 10000).map((l) => l.numero_controle_pncp).filter(Boolean));
  let antes = nossas();
  let chamadas = 0;
  const r = { pncp: site.total, lidos_pncp: site.lista.length, importadas: 0, itens_baixados: 0, sem_tempo: 0 };
  const agora = agoraBrasilia();

  for (const s of site.lista) {
    if (antes.has(s.numero)) continue;
    if (chamadas >= limiteChamadas) { r.sem_tempo++; continue; }
    let lic = db.prepare('SELECT * FROM licitacoes WHERE numero_controle_pncp = ?').get(s.numero);
    try {
      if (!lic) {
        const p = partesDoControle(s.numero);
        if (!p) continue;
        chamadas++;
        const { dados } = await getJson(`${BASE_CONSULTA}/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.seq}`, { fetchImpl });
        if (!dados?.numeroControlePNCP) continue;
        const res = salvarLicitacao(db, normalizarPncp(dados), 'pncp', dados, agora);
        lic = db.prepare('SELECT * FROM licitacoes WHERE id = ?').get(res.id);
        r.importadas++;
      }
      if (lic && !lic.detalhes_sincronizados_em) {
        chamadas += 2;
        const d = await CONECTORES.pncp.detalhes(lic, { fetchImpl });
        if (d) { salvarItens(db, lic.id, d.itens, 'pncp', agora); salvarDocumentos(db, lic.id, d.documentos, 'pncp'); r.itens_baixados++; }
        recalcularStatusDe(db, lic.id, agora);
      }
    } catch (e) {
      if (e.tipo === 'bloqueada_rede') throw e;
    }
  }

  const depois = nossas();
  r.licitpro = depois.size;
  r.em_comum = site.lista.filter((s) => depois.has(s.numero)).length;
  r.agora_aparecem = site.lista.filter((s) => depois.has(s.numero) && !antes.has(s.numero)).length;
  // O que continua só no PNCP: diz por quê, sem inventar (só o que dá para verificar na nossa base)
  r.so_pncp = site.lista.filter((s) => !depois.has(s.numero)).map((s) => {
    const l = db.prepare('SELECT id, objeto, orgao_nome, status_calculado, detalhes_sincronizados_em FROM licitacoes WHERE numero_controle_pncp = ?').get(s.numero);
    let motivo;
    if (!l) motivo = 'Ainda não importada (limite desta conferência; clique de novo para continuar)';
    else if (!['aberta', 'aguardando_propostas'].includes(l.status_calculado)) motivo = 'No LicitPro está com prazo de propostas encerrado ou outra situação';
    else if (!l.detalhes_sincronizados_em) motivo = 'Itens ainda não baixados';
    else motivo = 'A palavra não está no objeto, no órgão nem nos itens; o PNCP achou em outro campo (ex.: texto do edital)';
    return { numero: s.numero, id: l?.id ?? null, orgao: l?.orgao_nome || s.orgao, objeto: (l?.objeto || s.objeto || '').slice(0, 200), motivo };
  });
  // O inverso: o LicitPro mostra e o site do PNCP não (geralmente palavra só nos itens)
  const doSite = new Set(site.lista.map((s) => s.numero));
  r.so_licitpro = [...depois].filter((n) => !doSite.has(n)).length;
  return r;
}
