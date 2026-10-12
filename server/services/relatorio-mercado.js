// Relatório de mercado de um item (Análise de mercado): Brasil × estado, 6/12/24 meses, quem compra, marcas,
// fornecedores e licitações abertas. Serve à tela, à impressão e ao PDF em dois modos:
//  - "interno": tudo (inclusive nomes dos fornecedores vencedores);
//  - "lead": o que convence uma empresa a vender ao governo (sem expor concorrentes pelo nome).
// Fonte: Compras.gov.br, Dados Abertos (Pesquisa de Preços) — compras de órgãos que usam o Compras.gov.br.
import { consultarPrecos, analisarPrecos, panoramaMercado, estatisticas, foraDaCurva } from './precos.js';
import { contarCompras } from '../connectors/comprasgov.js';
import { buscar } from './busca.js';

export const PERIODOS = [6, 12, 24];
const ESF = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };
const r2 = (v) => Math.round(v * 100) / 100;
const REGIAO = Object.fromEntries([['Norte', 'AC AM AP PA RO RR TO'], ['Nordeste', 'AL BA CE MA PB PE PI RN SE'], ['Centro-Oeste', 'DF GO MS MT'],
  ['Sudeste', 'ES MG RJ SP'], ['Sul', 'PR RS SC']].flatMap(([r, ufs]) => ufs.split(' ').map((u) => [u, r])));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const fmtPct = (v) => `${String(v).replace('.', ',')}%`;
/** Compras de um período: o total oficial quando a amostra é parcial. */
const comprasOficiais = (p) => (p.parcial && p.total_fonte != null ? p.total_fonte : p.compras);
const iso = (d) => d.toISOString().slice(0, 10);

function resumoPeriodo(lista, desde) {
  const rs = lista.filter((r) => r.data_compra && r.data_compra >= desde);
  const e = estatisticas(rs.map((r) => r.preco_unitario));
  // Valor movimentado sem os preços fora da curva (um valor total lançado como unitário distorce tudo)
  const validos = rs.filter((r) => !(e.n >= 4 && (r.preco_unitario < e.limite_inferior || r.preco_unitario > e.limite_superior)));
  return {
    compras: rs.length,
    quantidade: rs.reduce((t, r) => t + (Number(r.quantidade) || 0), 0),
    valor: r2(validos.reduce((t, r) => t + (Number(r.quantidade) || 0) * (Number(r.preco_unitario) || 0), 0)),
    mediana: e.mediana ?? null,
    orgaos: new Set(rs.map((r) => r.uasg || r.orgao_nome)).size,
    desconsiderados: rs.length - validos.length,
  };
}

async function escopo(db, c, uf, opcoes, { fetchImpl, agora }) {
  const r = await consultarPrecos(db, { tipo: c.tipo, codigo: c.codigo, uf, meses: 24 }, { fetchImpl, agora });
  const a = analisarPrecos(r.registros, opcoes);
  const lista = a.registros;
  const maisAntiga = r.registros.length ? r.registros[r.registros.length - 1].data_compra : null;
  const periodos = {};
  for (const m of PERIODOS) {
    const desde = iso(new Date(agora.getTime() - m * 30.44 * 86400000));
    // Amostra parcial: a fonte tinha mais compras do que baixamos e a mais antiga baixada é mais nova que o início do período
    const parcial = r.truncado && maisAntiga && maisAntiga > desde;
    periodos[m] = { ...resumoPeriodo(lista, desde), parcial,
      total_fonte: parcial ? await contarCompras({ tipo: c.tipo, codigo: c.codigo, uf, desde, ate: iso(agora) }, { fetchImpl }).catch(() => null) : null };
  }
  return { uf: uf || null, unidade: a.unidade, unidades: a.unidades.map((u) => u.unidade), lista, periodos, truncado: r.truncado, consultado_em: r.consultado_em };
}

export async function relatorioMercado(db, c, { filtro, item, unidade, termo, fetchImpl, agora = new Date() } = {}) {
  const opcoes = { filtro, item, unidade };
  const local = c.uf ? await escopo(db, c, c.uf, opcoes, { fetchImpl, agora }) : null;
  // O Brasil usa a mesma unidade de fornecimento do estado, para os números serem comparáveis
  const brasil = await escopo(db, c, null, { ...opcoes, unidade: local?.unidade || unidade }, { fetchImpl, agora });
  // Conferência: o Brasil contém o estado. Se um período do Brasil vier menor (amostra incompleta da fonte),
  // ele passa a mostrar o total oficial de compras e fica marcado como parcial, em vez de um número errado.
  if (local) {
    for (const m of PERIODOS) {
      const b = brasil.periodos[m]; const e = local.periodos[m];
      if (b.compras < e.compras || b.quantidade < e.quantidade) {
        b.parcial = true;
        if (b.total_fonte == null) {
          const desde = iso(new Date(agora.getTime() - m * 30.44 * 86400000));
          b.total_fonte = await contarCompras({ tipo: c.tipo, codigo: c.codigo, desde, ate: iso(agora) }, { fetchImpl }).catch(() => null);
        }
      }
    }
  }
  const foco = local || brasil;
  // Regiões do Brasil (24 meses), pela UF do órgão comprador
  const regioes = {};
  for (const r of brasil.lista) { const k = REGIAO[r.uf] || 'Não informada'; regioes[k] = (regioes[k] || 0) + 1; }
  // Peso do estado no Brasil (24 meses), em número de compras oficiais
  const participacao = local ? { uf: local.uf, estado: comprasOficiais(local.periodos[24]), brasil: comprasOficiais(brasil.periodos[24]) } : null;
  const pan = panoramaMercado(foco.lista);
  const estFoco = estatisticas(foco.lista.map((r) => r.preco_unitario));
  const recentes = [...foco.lista].sort((a, b) => String(b.data_compra).localeCompare(String(a.data_compra)));
  const orgaos = new Map();
  for (const r of foco.lista) {
    const k = r.uasg || r.orgao_nome; if (!k) continue;
    const o = orgaos.get(k) || { nome: r.orgao_nome || r.uasg_nome, unidade: r.uasg_nome, esfera: ESF[r.esfera] || 'Não informada', local: [r.municipio, r.uf].filter(Boolean).join('/'), compras: 0, quantidade: 0, valor: 0, ultima: null };
    o.compras++; o.quantidade += Number(r.quantidade) || 0;
    if (!pan.precos.length || (r.preco_unitario >= pan.precos[0] && r.preco_unitario <= pan.precos[pan.precos.length - 1])) o.valor += (Number(r.quantidade) || 0) * (Number(r.preco_unitario) || 0);
    if (!o.ultima || r.data_compra > o.ultima) o.ultima = r.data_compra;
    orgaos.set(k, o);
  }
  const esferas = {};
  for (const r of foco.lista) {
    const k = ESF[r.esfera] || 'Não informada';
    esferas[k] = esferas[k] || { nome: k, compras: 0, quantidade: 0 };
    esferas[k].compras++; esferas[k].quantidade += Number(r.quantidade) || 0;
  }
  // Tendência: compras dos últimos 6 meses × os 6 anteriores
  const p6 = foco.periodos[6].compras; const ant6 = foco.periodos[12].compras - p6;
  // Licitações abertas agora (base do sistema) com as palavras pesquisadas
  let abertas = { total: 0, dados: [] };
  if (termo) {
    try {
      const b = buscar(db, { q: termo, uf: c.uf || undefined, visao: 'abertas', tamanho: 5, ordenar: 'encerramento_asc' });
      abertas = { total: b.total, dados: b.dados.map((l) => ({ id: l.id, objeto: l.objeto, orgao: l.orgao_nome, local: [l.municipio, l.uf].filter(Boolean).join('/'), encerramento: l.data_encerramento_proposta, valor: l.valor_estimado })) };
    } catch { /* busca indisponível não derruba o relatório */ }
  }
  const rel = {
    consulta: c, termo: termo || null, gerado_em: agora.toISOString(), unidade: foco.unidade,
    brasil: { periodos: brasil.periodos, truncado: brasil.truncado },
    estado: local ? { uf: local.uf, periodos: local.periodos, truncado: local.truncado } : null,
    tendencia: { ultimos6: p6, anteriores6: ant6, variacao_pct: ant6 > 0 ? Math.round(((p6 - ant6) / ant6) * 100) : null },
    precos: estFoco,
    esferas: Object.values(esferas).sort((a, b) => b.compras - a.compras),
    orgaos_top: [...orgaos.values()].map((o) => ({ ...o, valor: r2(o.valor) })).sort((a, b) => b.valor - a.valor || b.compras - a.compras).slice(0, 10),
    orgaos_total: orgaos.size,
    ultimas_compras: recentes.slice(0, 12).map((r) => ({ data: r.data_compra, orgao: r.orgao_nome || r.uasg_nome, esfera: ESF[r.esfera] || 'Não informada', local: [r.municipio, r.uf].filter(Boolean).join('/'),
      quantidade: r.quantidade, preco: r.preco_unitario, fora_da_curva: foraDaCurva(r.preco_unitario, estFoco), marca: r.marca || null, fornecedor: r.fornecedor_nome || null })),
    marcas_top: pan.marcas_top, marcas_total: pan.marcas_total,
    fornecedores: pan.fornecedores, fornecedores_total: pan.fornecedores_total,
    abertas,
    regioes: Object.entries(regioes).map(([nome, compras]) => ({ nome, compras })).sort((a, b) => b.compras - a.compras),
    participacao: participacao && participacao.brasil >= participacao.estado ? participacao : null,
  };
  rel.leitura = leituraMercado(rel);
  return rel;
}

/** Leitura em frases curtas (mesma para tela, impressão e PDF). Só afirma o que os números mostram. */
export function leituraMercado(r) {
  const out = [];
  const foco = (r.estado || r.brasil).periodos; const onde = r.estado ? `no ${r.estado.uf}` : 'no Brasil';
  const t = r.tendencia;
  if (t.variacao_pct != null) {
    const sentido = t.variacao_pct >= 10 ? 'em alta' : t.variacao_pct <= -10 ? 'em queda' : 'estável';
    out.push(`Demanda ${sentido} ${onde}: ${t.ultimos6} compra(s) nos últimos 6 meses contra ${t.anteriores6} nos 6 anteriores (${t.variacao_pct >= 0 ? '+' : ''}${t.variacao_pct}%).`);
  } else if (foco[6].compras) out.push(`${foco[6].compras} compra(s) ${onde} nos últimos 6 meses.`);
  const totEsf = r.esferas.reduce((a, e) => a + e.compras, 0);
  if (r.esferas[0] && totEsf) out.push(`A esfera ${r.esferas[0].nome.toLowerCase()} responde por ${fmtPct(pct(r.esferas[0].compras, totEsf))} das compras ${onde} em 24 meses.`);
  if (r.participacao) out.push(`O ${r.participacao.uf} fez ${fmtPct(pct(r.participacao.estado, r.participacao.brasil))} das compras do Brasil em 24 meses (${r.participacao.estado} de ${r.participacao.brasil}).`);
  else if (r.regioes[0]) { const tot = r.regioes.reduce((a, x) => a + x.compras, 0); out.push(`A região ${r.regioes[0].nome} concentra ${fmtPct(pct(r.regioes[0].compras, tot))} das compras do Brasil em 24 meses.`); }
  if (foco[12].orgaos > 1) out.push(`${foco[12].orgaos} órgãos diferentes compraram ${onde} nos últimos 12 meses: a demanda não depende de um só comprador.`);
  if (r.abertas.total) out.push(`Há ${r.abertas.total} licitação(ões) aberta(s) agora ${onde} com esse produto.`);
  return out;
}

/** Remove o que não vai para a empresa prospectada (nomes de concorrentes). */
// Fica de fora o "ouro": quem compra (nomes dos órgãos), preços praticados, marcas, fornecedores e quais
// licitações estão abertas. Vai só o tamanho do mercado, a tendência e as proporções.
export function paraLead(r) {
  const semPreco = (e) => e && { ...e, periodos: Object.fromEntries(Object.entries(e.periodos).map(([m, p]) => [m, { ...p, mediana: null }])) };
  return { ...r, brasil: semPreco(r.brasil), estado: semPreco(r.estado), precos: { n: r.precos?.n || 0 },
    orgaos_top: [], ultimas_compras: [], marcas_top: [], fornecedores: [], abertas: { total: r.abertas.total, dados: [] }, lead: true };
}
