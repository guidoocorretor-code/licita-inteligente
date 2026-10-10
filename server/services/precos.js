// Pesquisa de preços praticados pela Administração (Compras.gov.br, módulo 03 de Dados Abertos).
// Referências: Lei 14.133/2021, art. 23, §1º, II (contratações similares da Administração no último ano)
// e IN SEGES/ME 65/2021, art. 5º e 6º (média, mediana ou menor valor, desconsiderando preços
// inexequíveis, inconsistentes ou excessivamente elevados — a análise crítica é sempre humana).
import { paginarPrecos, paginarCatalogo } from '../connectors/comprasgov.js';
import { normalizarPrecoCompras } from './normalizacao.js';
import { radical } from './busca.js';

const CACHE_HORAS = 24;
const MAX_PAGINAS = 4; // até 2.000 registros por consulta (500 por página)
let catalogoEmAndamento = false;

// ---------- Catálogo ----------
export function statusCatalogo(db) {
  const r = db.prepare(`SELECT COUNT(*) n, SUM(tipo='material') materiais, SUM(tipo='servico') servicos, MIN(atualizado_em) mais_antigo, MAX(atualizado_em) mais_novo
    FROM catalogo_compras`).get();
  return { ...r, em_andamento: catalogoEmAndamento };
}

export async function sincronizarCatalogo(db, { fetchImpl } = {}) {
  if (catalogoEmAndamento) return { ignorado: true };
  catalogoEmAndamento = true;
  const up = db.prepare(`INSERT INTO catalogo_compras (tipo, codigo, nome, classe, grupo) VALUES (?,?,?,?,?)
    ON CONFLICT(tipo, codigo) DO UPDATE SET nome=excluded.nome, classe=excluded.classe, grupo=excluded.grupo, atualizado_em=datetime('now')`);
  const cont = { material: 0, servico: 0 };
  try {
    for (const tipo of ['material', 'servico']) {
      for await (const lista of paginarCatalogo(tipo, { fetchImpl })) {
        db.exec('BEGIN');
        try {
          for (const r of lista) {
            const codigo = tipo === 'servico' ? r.codigoServico : r.codigoPdm;
            const nome = tipo === 'servico' ? r.nomeServico : r.nomePdm;
            if (codigo == null || !nome) continue;
            up.run(tipo, codigo, String(nome).trim(), r.nomeClasse ?? null, r.nomeGrupo ?? null);
            cont[tipo]++;
          }
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
    }
    return cont;
  } finally { catalogoEmAndamento = false; }
}

export function precisaAtualizarCatalogo(db) {
  const s = statusCatalogo(db);
  return !s.n || !s.mais_antigo || Date.parse(s.mais_antigo.replace(' ', 'T') + 'Z') < Date.now() - 30 * 86400000;
}

export function buscarCatalogo(db, q, { limite = 30 } = {}) {
  const t = String(q || '').trim();
  if (!t) return [];
  if (/^\d+$/.test(t)) {
    return db.prepare('SELECT tipo, codigo, nome, classe FROM catalogo_compras WHERE codigo=? ORDER BY tipo').all(Number(t));
  }
  const termos = t.split(/\s+/).map((x) => `"${radical(x)}"*`).join(' ');
  return db.prepare(`SELECT c.tipo, c.codigo, c.nome, c.classe FROM catalogo_fts f JOIN catalogo_compras c ON c.rowid=f.rowid
    WHERE catalogo_fts MATCH ? ORDER BY bm25(catalogo_fts, 5, 1), length(c.nome) LIMIT ?`).all(termos, limite);
}

// ---------- Estatística ----------
function quantil(ordenados, q) {
  if (!ordenados.length) return null;
  const pos = (ordenados.length - 1) * q;
  const b = Math.floor(pos); const r = pos - b;
  return ordenados[b + 1] !== undefined ? ordenados[b] + r * (ordenados[b + 1] - ordenados[b]) : ordenados[b];
}
const arred = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

/**
 * Estatística de um conjunto de preços unitários da MESMA unidade.
 * "Fora da curva": abaixo de Q1 − 1,5×AIQ ou acima de Q3 + 1,5×AIQ (critério de Tukey). É só uma sugestão
 * para a análise crítica exigida pela IN 65/2021; nenhum preço é descartado automaticamente.
 */
export function estatisticas(precos) {
  const v = precos.filter((x) => typeof x === 'number' && Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q1 = quantil(v, 0.25); const q3 = quantil(v, 0.75); const aiq = q3 - q1;
  const lim = { inferior: q1 - 1.5 * aiq, superior: q3 + 1.5 * aiq };
  const dentro = v.filter((x) => x >= lim.inferior && x <= lim.superior);
  const media = (a) => a.reduce((t, x) => t + x, 0) / a.length;
  return {
    n: v.length, menor: v[0], q1: arred(q1), mediana: arred(quantil(v, 0.5)), media: arred(media(v)), q3: arred(q3), maior: v[v.length - 1],
    limite_inferior: arred(Math.max(0, lim.inferior)), limite_superior: arred(lim.superior),
    fora_da_curva: v.length - dentro.length, media_sem_fora_da_curva: dentro.length ? arred(media(dentro)) : null,
    // Média puxada por valores extremos (ex.: valor total lançado como unitário): não serve como referência
    media_distorcida: v.length >= 4 && media(v) > 1.5 * quantil(v, 0.5),
  };
}
export const foraDaCurva = (preco, est) => est?.n >= 4 && preco != null && (preco < est.limite_inferior || preco > est.limite_superior);

// ---------- Consulta ----------
const iso = (d) => d.toISOString().slice(0, 10);
const TIPOS = ['material_pdm', 'material_item', 'servico'];

export function validarConsulta(p) {
  const tipo = TIPOS.includes(p.tipo) ? p.tipo : null;
  const codigo = /^\d{1,9}$/.test(String(p.codigo || '')) ? Number(p.codigo) : null;
  const uf = /^[A-Za-z]{2}$/.test(p.uf || '') ? p.uf.toUpperCase() : null;
  const meses = [3, 6, 12, 24].includes(Number(p.meses)) ? Number(p.meses) : 12;
  if (!tipo || !codigo) return null;
  return { tipo, codigo, uf, meses };
}

/** Busca no Compras.gov.br (com cache de 24h) e devolve registros normalizados, do mais novo para o mais antigo. */
export async function consultarPrecos(db, consulta, { fetchImpl, agora = new Date(), forcar = false } = {}) {
  const { tipo, codigo, uf, meses } = consulta;
  const ate = iso(agora);
  const desde = iso(new Date(agora.getTime() - meses * 30.44 * 86400000));
  const chave = `${tipo}:${codigo}:${uf || 'BR'}:${meses}`;
  const cache = db.prepare(`SELECT * FROM precos_consultas WHERE chave=? AND consultado_em > datetime('now', ?)`).get(chave, `-${CACHE_HORAS} hours`);
  if (cache && !forcar) {
    return { registros: JSON.parse(cache.registros_json), total_fonte: cache.total_fonte, truncado: !!cache.truncado, consultado_em: cache.consultado_em, cache: true, desde, ate };
  }
  const registros = []; let total = null; let truncado = false;
  for await (const p of paginarPrecos({ tipo, codigo, uf, desde, ate }, { maxPaginas: MAX_PAGINAS, fetchImpl })) {
    total = p.totalRegistros ?? total;
    registros.push(...p.registros.map(normalizarPrecoCompras));
    truncado = p.pagina === MAX_PAGINAS && p.paginasRestantes > 0;
  }
  registros.sort((a, b) => String(b.data_compra || '').localeCompare(String(a.data_compra || '')));
  db.prepare(`INSERT INTO precos_consultas (chave, registros_json, total_fonte, truncado, consultado_em) VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(chave) DO UPDATE SET registros_json=excluded.registros_json, total_fonte=excluded.total_fonte, truncado=excluded.truncado, consultado_em=excluded.consultado_em`)
    .run(chave, JSON.stringify(registros), total ?? registros.length, truncado ? 1 : 0);
  const salvo = db.prepare('SELECT consultado_em FROM precos_consultas WHERE chave=?').get(chave);
  db.prepare("DELETE FROM precos_consultas WHERE consultado_em < datetime('now','-7 days')").run();
  return { registros, total_fonte: total ?? registros.length, truncado, consultado_em: salvo.consultado_em, cache: false, desde, ate };
}

/**
 * Análise: agrupa por unidade de fornecimento (preços de unidades diferentes não se comparam),
 * aplica os filtros de item do catálogo e de unidade, e marca os preços fora da curva.
 */
// Texto sem acento, minúsculo e com "32 gb" = "32gb", para comparar especificações
const normalizarTexto = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/(\d)\s+(gb|tb|mb|ghz|pol|polegadas|w|v|ml|l|kg|g|mm|cm|m)\b/g, '$1$2');

/** Mantém só os registros cuja descrição (ou marca) contém TODOS os termos do filtro. */
export function filtrarPorEspecificacao(registros, filtro) {
  const termos = normalizarTexto(filtro).split(/\s+/).filter(Boolean);
  if (!termos.length) return registros;
  return registros.filter((r) => {
    const alvo = normalizarTexto(`${r.descricao || ''} ${r.descricao_detalhada || ''} ${r.marca || ''}`);
    return termos.every((t) => alvo.includes(t));
  });
}

export function analisarPrecos(registros, { item, unidade, filtro } = {}) {
  registros = filtrarPorEspecificacao(registros, filtro);
  const porItem = new Map();
  for (const r of registros) {
    const k = r.codigo_item ?? 'sem código';
    const atual = porItem.get(k) || { codigo: r.codigo_item, descricao: r.descricao, n: 0 };
    atual.n++; porItem.set(k, atual);
  }
  let lista = item ? registros.filter((r) => String(r.codigo_item) === String(item)) : registros;
  const grupos = new Map();
  for (const r of lista) {
    const u = r.unidade || 'Unidade não informada';
    if (!grupos.has(u)) grupos.set(u, []);
    grupos.get(u).push(r);
  }
  const unidades = [...grupos.entries()].map(([u, rs]) => ({ unidade: u, ...estatisticas(rs.map((r) => r.preco_unitario)) }))
    .sort((a, b) => b.n - a.n);
  const unidadeSel = unidade && grupos.has(unidade) ? unidade : unidades[0]?.unidade || null;
  if (unidadeSel) lista = grupos.get(unidadeSel);
  const est = unidades.find((u) => u.unidade === unidadeSel) || { n: 0 };
  return {
    itens_catalogo: [...porItem.values()].sort((a, b) => b.n - a.n),
    unidades,
    unidade: unidadeSel,
    estatisticas: est,
    registros: lista.map((r) => ({ ...r, fora_da_curva: foraDaCurva(r.preco_unitario, est) })),
  };
}
