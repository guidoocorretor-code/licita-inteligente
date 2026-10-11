// Pagômetro: Capacidade de Pagamento (CAPAG) calculada pelo Tesouro Nacional para estados e municípios.
// Fonte oficial (dados abertos, CKAN do Tesouro Transparente):
//   https://www.tesourotransparente.gov.br/ckan/dataset/capag-municipios  (XLSX, divulgação quadrimestral)
//   https://www.tesourotransparente.gov.br/ckan/dataset/capag-estados     (CSV, anual)
// Nota A (melhor) a D; "n.d." = não calculada (ex.: dados inconsistentes no Siconfi). "+" = boa qualidade da informação.
// Indicadores: 1 = endividamento, 2 = poupança corrente, 3 = liquidez (caixa frente às obrigações de curto prazo).
// A CAPAG mede a saúde fiscal do ente; não é o histórico de pagamento a fornecedores de um órgão específico.
import ExcelJS from 'exceljs';
import { getJson } from '../lib/http.js';
import { config } from '../config.js';

const CKAN = 'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id=';
export const FONTES_CAPAG = {
  M: { pacote: 'capag-municipios', formato: 'XLSX', pagina: 'https://www.tesourotransparente.gov.br/ckan/dataset/capag-municipios' },
  E: { pacote: 'capag-estados', formato: 'CSV', pagina: 'https://www.tesourotransparente.gov.br/ckan/dataset/capag-estados' },
};

const sem = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const texto = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') v = v.result ?? v.text ?? v.richText?.map((r) => r.text).join('') ?? '';
  const t = String(v).trim();
  return t === '' ? null : t;
};
/** "34,95%" → 34.95; 0.3495 (célula de porcentagem do Excel) → 34.95 */
export function percentual(v, celulaExcel = false) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round((celulaExcel && Math.abs(v) <= 10 ? v * 100 : v) * 100) / 100;
  const t = String(v).replace('%', '').replace(/\./g, '').replace(',', '.').trim();
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** Nota normalizada: A, B, C, D, com "+" quando houver; outros valores viram null (n.d.). */
export function nota(v) {
  const t = String(texto(v) ?? '').toUpperCase().replace(/\s/g, '');
  const m = t.match(/^([ABCD])(\+)?/);
  return m ? m[1] + (m[2] || '') : null;
}

const CABECALHOS = {
  cod: /c[oó]d.*munic/, nome: /nome.*munic/, uf: /^uf$/, capag: /^capag$|classifica[cç][aã]o da capag/,
  ind1: /^indicador 1$/, nota1: /^nota 1$/, ind2: /^indicador 2$/, nota2: /^nota 2$/, ind3: /^indicador 3$/, nota3: /^nota 3$/,
  icf: /^icf$|qualidade da informa/, obs: /^observa/,
};
function mapear(cabecalho) {
  const m = {};
  cabecalho.forEach((c, i) => {
    const t = sem(texto(c));
    for (const [k, re] of Object.entries(CABECALHOS)) if (m[k] == null && re.test(t)) m[k] = i;
  });
  return m;
}

/** Planilha de municípios: procura a aba/linha de cabeçalho com "Código Município" e "CAPAG". */
export async function lerCapagMunicipios(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let melhor = [];
  wb.eachSheet((ws) => {
    let mapa = null; const linhas = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const vals = row.values.slice(1);
      if (!mapa) {
        if (n > 20) return;
        const m = mapear(vals);
        if (m.cod != null && m.capag != null) mapa = m;
        return;
      }
      const cod = String(texto(vals[mapa.cod]) ?? '').replace(/\D/g, '');
      if (cod.length !== 7) return;
      linhas.push({
        esfera: 'M', chave: cod, nome: texto(vals[mapa.nome]), uf: texto(vals[mapa.uf])?.toUpperCase() ?? null,
        capag: nota(vals[mapa.capag]), capag_texto: texto(vals[mapa.capag]),
        ind1: percentual(vals[mapa.ind1], true), nota1: nota(vals[mapa.nota1]),
        ind2: percentual(vals[mapa.ind2], true), nota2: nota(vals[mapa.nota2]),
        ind3: percentual(vals[mapa.ind3], true), nota3: nota(vals[mapa.nota3]),
        icf: texto(vals[mapa.icf]), observacao: texto(vals[mapa.obs]),
      });
    });
    if (linhas.length > melhor.length) melhor = linhas;
  });
  return melhor;
}

/** CSV dos estados (separador ";", percentuais com vírgula). */
export function lerCapagEstados(csv) {
  const linhas = String(csv).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  // o cabeçalho pode quebrar a linha antes de "Observação"
  let i = linhas.findIndex((l) => /^\s*UF\s*;/i.test(l));
  if (i < 0) return [];
  const cab = linhas[i].split(';');
  if (!/observa/i.test(linhas[i]) && /^\s*observa/i.test(linhas[i + 1] || '')) { cab.push(linhas[i + 1]); i++; }
  const m = mapear(cab);
  const out = [];
  for (const l of linhas.slice(i + 1)) {
    const c = l.split(';');
    const uf = (c[m.uf] || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) continue;
    out.push({
      esfera: 'E', chave: uf, nome: uf, uf, capag: nota(c[m.capag]), capag_texto: texto(c[m.capag]),
      ind1: percentual(c[m.ind1]), nota1: nota(c[m.nota1]), ind2: percentual(c[m.ind2]), nota2: nota(c[m.nota2]),
      ind3: percentual(c[m.ind3]), nota3: nota(c[m.nota3]), icf: texto(c[m.icf]), observacao: texto(c[m.obs]),
    });
  }
  return out;
}

async function baixar(url, fetchImpl = globalThis.fetch) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(config.httpTimeoutMs, 120_000));
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal, headers: { 'user-agent': config.userAgent } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar ${url}`);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

/** Recurso mais recente do pacote no CKAN, no formato esperado. */
export function recursoMaisRecente(pacote, formato) {
  const rs = (pacote?.resources || []).filter((r) => String(r.format || '').toUpperCase() === formato && r.url);
  rs.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  return rs[0] || null;
}

function gravar(db, esfera, linhas, recurso) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM capag WHERE esfera=?').run(esfera);
    const ins = db.prepare(`INSERT INTO capag (esfera, chave, nome, uf, capag, capag_texto, ind1, nota1, ind2, nota2, ind3, nota3, icf, observacao, referencia, fonte_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of linhas) {
      ins.run(r.esfera, r.chave, r.nome, r.uf, r.capag, r.capag_texto, r.ind1, r.nota1, r.ind2, r.nota2, r.ind3, r.nota3, r.icf, r.observacao, recurso.name || null, recurso.url);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Baixa a CAPAG mais recente de municípios e estados e substitui a tabela. */
export async function atualizarCapag(db, { fetchImpl, minimos = { M: 1000, E: 20 } } = {}) {
  const resultado = {};
  for (const [esfera, f] of Object.entries(FONTES_CAPAG)) {
    try {
      const { dados } = await getJson(CKAN + f.pacote, { tentativas: 3, ...(fetchImpl ? { fetchImpl } : {}) });
      const rec = recursoMaisRecente(dados?.result, f.formato);
      if (!rec) throw new Error(`nenhum arquivo ${f.formato} no pacote ${f.pacote}`);
      const buf = await baixar(rec.url, fetchImpl);
      const linhas = esfera === 'M' ? await lerCapagMunicipios(buf) : lerCapagEstados(buf.toString('utf8'));
      if (linhas.length < minimos[esfera]) throw new Error(`arquivo com poucas linhas reconhecidas (${linhas.length}); formato pode ter mudado`);
      gravar(db, esfera, linhas, rec);
      resultado[esfera] = { linhas: linhas.length, referencia: rec.name };
    } catch (e) {
      resultado[esfera] = { erro: e.message };
    }
  }
  return resultado;
}

/** Atualiza se a tabela está vazia ou com mais de 7 dias. */
export function precisaAtualizarCapag(db) {
  const r = db.prepare("SELECT COUNT(*) n, MIN(atualizado_em) quando FROM capag").get();
  if (!r.n) return true;
  return Date.now() - Date.parse(r.quando.replace(' ', 'T') + 'Z') > 7 * 86400_000;
}

/** Expressão SQL que devolve a nota CAPAG do ente da licitação `l` (município pelo IBGE ou nome+UF; estado/DF pela UF). */
export const SQL_CAPAG_LIC = `(SELECT c.capag FROM capag c WHERE
  (l.esfera='M' AND c.esfera='M' AND (c.chave=l.codigo_ibge OR (l.codigo_ibge IS NULL AND c.uf=l.uf AND c.nome=l.municipio COLLATE NOCASE)))
  OR (l.esfera IN ('E','D') AND c.esfera='E' AND c.chave=l.uf) LIMIT 1)`;

/** Ficha completa do Pagômetro para uma licitação. */
export function pagometroDaLicitacao(db, l) {
  if (!l) return null;
  if (l.esfera === 'F') return { aplica: false, motivo: 'Órgão federal: a CAPAG do Tesouro só existe para estados e municípios.' };
  if (!['M', 'E', 'D'].includes(l.esfera)) return { aplica: false, motivo: 'Esfera não informada ou não se aplica (ex.: empresa estatal, consórcio).' };
  const r = l.esfera === 'M'
    ? db.prepare(`SELECT * FROM capag WHERE esfera='M' AND (chave=? OR (? IS NULL AND uf=? AND nome=? COLLATE NOCASE)) LIMIT 1`).get(l.codigo_ibge ?? null, l.codigo_ibge ?? null, l.uf ?? null, l.municipio ?? null)
    : db.prepare(`SELECT * FROM capag WHERE esfera='E' AND chave=?`).get(l.uf ?? null);
  if (!r) {
    const vazia = !db.prepare('SELECT 1 FROM capag LIMIT 1').get();
    return { aplica: true, encontrado: false, motivo: vazia ? 'Dados da CAPAG ainda não baixados.' : 'Ente não encontrado na planilha da CAPAG.' };
  }
  return { aplica: true, encontrado: true, ...r, fonte_pagina: FONTES_CAPAG[r.esfera].pagina };
}
