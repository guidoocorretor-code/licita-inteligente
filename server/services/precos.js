// Pesquisa de preços praticados pela Administração (Compras.gov.br, módulo 03 de Dados Abertos).
// Referências: Lei 14.133/2021, art. 23, §1º, II (contratações similares da Administração no último ano)
// e IN SEGES/ME 65/2021, art. 5º e 6º (média, mediana ou menor valor, desconsiderando preços
// inexequíveis, inconsistentes ou excessivamente elevados — a análise crítica é sempre humana).
import { baixarPrecos, paginarCatalogo } from '../connectors/comprasgov.js';
import { normalizarPrecoCompras } from './normalizacao.js';
import { radical } from './busca.js';

const CACHE_HORAS = 24;
const MAX_PAGINAS = 10; // páginas de 500 por parte do período; períodos maiores são divididos (baixarPrecos)
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

// Nomes do dia a dia que no catálogo oficial ficam em outro PDM. Ex.: quase toda compra de papel A4 é registrada no
// PDM 19746 "PAPEL PARA IMPRESSÃO FORMATADO"; o PDM 127 "PAPEL A4" tem poucas compras (conferido em 11/10/2026:
// 204 compras no ES no PDM 19746 e nenhuma no PDM 127 no último ano).
const SINONIMOS = [
  { quando: /\ba4\b|sulfite|papel (oficio|carta)|resma/, buscar: 'papel impressao formatado', motivo: 'É onde a maioria das compras de papel A4/sulfite é registrada' },
  { quando: /notebook|laptop/, buscar: 'microcomputador portatil', motivo: 'Nome oficial de notebook no catálogo' },
  { quando: /\bdesktop\b|computador de mesa/, buscar: 'microcomputador', motivo: 'Nome oficial de computador no catálogo' },
  { quando: /\bnobreak\b|no-break/, buscar: 'no break', motivo: 'Nome oficial no catálogo' },
];
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function ftsCatalogo(db, texto, { limite, ou = false }) {
  const termos = texto.split(/\s+/).filter(Boolean).map((x) => `"${radical(x)}"*`);
  if (!termos.length) return [];
  return db.prepare(`SELECT c.tipo, c.codigo, c.nome, c.classe FROM catalogo_fts f JOIN catalogo_compras c ON c.rowid=f.rowid
    WHERE catalogo_fts MATCH ? ORDER BY bm25(catalogo_fts, 5, 1), length(c.nome) LIMIT ?`).all(termos.join(ou ? ' OR ' : ' '), limite);
}

export function buscarCatalogo(db, q, { limite = 30 } = {}) {
  const t = String(q || '').trim();
  if (!t) return [];
  if (/^\d+$/.test(t)) {
    return db.prepare('SELECT tipo, codigo, nome, classe FROM catalogo_compras WHERE codigo=? ORDER BY tipo').all(Number(t));
  }
  const vistos = new Set(); const saida = [];
  const juntar = (lista, extra = {}) => lista.forEach((r) => { const k = `${r.tipo}:${r.codigo}`; if (!vistos.has(k)) { vistos.add(k); saida.push({ ...r, ...extra }); } });
  const base = semAcento(t);
  for (const s of SINONIMOS) if (s.quando.test(base)) juntar(ftsCatalogo(db, s.buscar, { limite: 3 }), { sugerido: s.motivo });
  juntar(ftsCatalogo(db, t, { limite }));
  // Nenhum PDM com TODAS as palavras: tenta com qualquer uma (ex.: "caneta esferográfica azul")
  if (saida.length < 3) juntar(ftsCatalogo(db, t, { limite, ou: true }));
  return saida.slice(0, limite);
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
  // v2: a partir de 12/10/2026 o período é baixado inteiro (as amostras antigas, parciais, deixam de ser usadas)
  const chave = `v2:${tipo}:${codigo}:${uf || 'BR'}:${meses}`;
  const cache = db.prepare(`SELECT * FROM precos_consultas WHERE chave=? AND consultado_em > datetime('now', ?)`).get(chave, `-${CACHE_HORAS} hours`);
  if (cache && !forcar) {
    return { registros: JSON.parse(cache.registros_json), total_fonte: cache.total_fonte, truncado: !!cache.truncado, consultado_em: cache.consultado_em, cache: true, desde, ate };
  }
  const baixado = await baixarPrecos({ tipo, codigo, uf, desde, ate }, { maxPaginas: MAX_PAGINAS, fetchImpl });
  const registros = baixado.registros.map(normalizarPrecoCompras);
  const total = baixado.totalRegistros; const { truncado } = baixado;
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
    panorama: panoramaMercado(lista),
  };
}

// Marcas que não identificam produto ("conforme edital", "própria", "-")
const MARCA_VAZIA = /^(-+|\.+|n\/?a|nao (se )?aplica|nao informad[ao]|sem marca|conforme (o )?(edital|termo|tr|especificacao)|generic[oa]|propria|diversas|varias|\d+)$/;
export function marcaNormal(m) {
  const t = semAcento(m).replace(/\s+/g, ' ').trim();
  if (!t || MARCA_VAZIA.test(t) || t.length > 40 || /[,;]/.test(t)) return null; // lista de marcas não identifica o produto
  return t.toUpperCase();
}

/**
 * Panorama do mercado do item (mesma unidade de fornecimento): marcas mais vendidas, últimas marcas entregues,
 * fornecedores com seus melhores preços, compras por esfera/UF/mês. Preços fora da curva não entram nos
 * menores preços por fornecedor, para não premiar erro de digitação da fonte.
 */
export function panoramaMercado(lista) {
  const est = estatisticas(lista.map((r) => r.preco_unitario));
  const validos = lista.filter((r) => r.preco_unitario > 0 && !foraDaCurva(r.preco_unitario, est));
  const somaQtd = (rs) => rs.reduce((t, r) => t + (Number(r.quantidade) || 0), 0);
  const agrupar = (rs, chave) => { const m = new Map(); for (const r of rs) { const k = chave(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const resumo = (k, rs) => {
    const e = estatisticas(rs.map((r) => r.preco_unitario));
    const ultimo = [...rs].sort((a, b) => String(b.data_compra).localeCompare(String(a.data_compra)))[0];
    return { nome: k, compras: rs.length, quantidade: somaQtd(rs), menor: e.menor ?? null, mediana: e.mediana ?? null, ultima_data: ultimo?.data_compra || null, ultimo_preco: ultimo?.preco_unitario ?? null };
  };
  const marcas = [...agrupar(lista, (r) => marcaNormal(r.marca))].map(([k, rs]) => resumo(k, rs)).sort((a, b) => b.quantidade - a.quantidade || b.compras - a.compras);
  const fornecedores = [...agrupar(validos, (r) => r.fornecedor_ni || r.fornecedor_nome)].map(([, rs]) => ({
    ...resumo(rs[0].fornecedor_nome || 'Fornecedor não informado', rs), ni: rs[0].fornecedor_ni || null,
    marcas: [...new Set(rs.map((r) => marcaNormal(r.marca)).filter(Boolean))].slice(0, 3),
  })).sort((a, b) => a.mediana - b.mediana);
  const ESF = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };
  const contar = (m) => [...m].map(([k, rs]) => ({ nome: k, compras: rs.length, quantidade: somaQtd(rs) })).sort((a, b) => b.compras - a.compras);
  return {
    compras: lista.length,
    quantidade: somaQtd(lista),
    valor_total: Math.round(lista.reduce((t, r) => t + (Number(r.quantidade) || 0) * (Number(r.preco_unitario) || 0), 0) * 100) / 100,
    sem_marca: lista.filter((r) => !marcaNormal(r.marca)).length,
    marcas_top: marcas.slice(0, 10),
    marcas_total: marcas.length,
    ultimas_marcas: [...lista].filter((r) => marcaNormal(r.marca)).sort((a, b) => String(b.data_compra).localeCompare(String(a.data_compra))).slice(0, 10)
      .map((r) => ({ data: r.data_compra, fora_da_curva: foraDaCurva(r.preco_unitario, est), marca: marcaNormal(r.marca), fornecedor: r.fornecedor_nome, orgao: r.orgao_nome || r.uasg_nome, local: [r.municipio, r.uf].filter(Boolean).join('/'), preco: r.preco_unitario, quantidade: r.quantidade })),
    fornecedores: fornecedores.slice(0, 15),
    fornecedores_total: fornecedores.length,
    por_esfera: contar(agrupar(lista, (r) => ESF[r.esfera] || 'Não informada')),
    por_uf: contar(agrupar(lista, (r) => r.uf || null)).slice(0, 10),
    por_mes: [...agrupar(lista, (r) => (r.data_compra ? r.data_compra.slice(0, 7) : null))].map(([k, rs]) => ({ mes: k, compras: rs.length, quantidade: somaQtd(rs) })).sort((a, b) => a.mes.localeCompare(b.mes)),
    // Preços vencedores (sem os fora da curva), para o simulador "com este preço, em que posição eu ficaria?"
    precos: validos.map((r) => r.preco_unitario).sort((a, b) => a - b),
  };
}
