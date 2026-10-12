// PDF do relatório de mercado (Análise de mercado), nos modos "interno" e "lead".
import { criarPdf } from '../lib/pdf-simples.js';
import { PERIODOS, leituraMercado } from './relatorio-mercado.js';

const brl = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const dataBr = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '-');
const curto = (v) => (v == null ? '-' : v >= 1e9 ? `R$ ${num(Math.round(v / 1e8) / 10)} bi` : v >= 1e6 ? `R$ ${num(Math.round(v / 1e5) / 10)} mi` : v >= 1e4 ? `R$ ${num(Math.round(v / 100) / 10)} mil` : brl(v));
const NOME_ESCOPO = (uf) => (uf ? `Estado (${uf})` : 'Brasil');

/** Linhas da tabela "Brasil × estado" (compartilhada com a impressão). */
export function linhasVolume(r) {
  const escopos = [[r.estado?.uf, r.estado], [null, r.brasil]].filter(([, e]) => e);
  const linhas = [];
  for (const [uf, e] of escopos) {
    for (const m of PERIODOS) {
      const p = e.periodos[m];
      linhas.push([NOME_ESCOPO(uf), `${m} meses`, `${num(p.compras)}${p.parcial ? ` (de ${num(p.total_fonte)})*` : ''}`, num(p.quantidade), curto(p.valor), brl(p.mediana), num(p.orgaos)]);
    }
  }
  return linhas;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// Paleta categórica validada (ordem fixa) e cinza para "resto"/"outras"
export const CORES_PIZZA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
export const CINZA_PIZZA = '#b8bfc9';
const AZUL = [0.06, 0.24, 0.43]; const CINZA = [0.38, 0.4, 0.44]; const CLARO = [0.93, 0.96, 0.98]; const LINHA = [0.84, 0.88, 0.92];
const pctTxt = (n, t) => `${(t ? (n / t) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const comprasOf = (p) => (p.parcial && p.total_fonte != null ? p.total_fonte : p.compras);

/** Tabela curta do lead: compras (total oficial) por período e valor em 12 meses. */
export function linhasTamanho(r) {
  return [[r.estado?.uf, r.estado], [null, r.brasil]].filter(([, e]) => e).map(([uf, e]) => [uf || 'Brasil',
    ...PERIODOS.map((m) => num(comprasOf(e.periodos[m]))), curto(e.periodos[12].valor) + (e.periodos[12].parcial ? '*' : '')]);
}

/** As duas pizzas do resumo: quem compra (esfera) e peso do estado no Brasil (ou regiões, sem estado). */
export function pizzasResumo(r) {
  const esf = r.esferas.map((e, k) => ({ rotulo: e.nome, n: e.compras, cor: CORES_PIZZA[k % CORES_PIZZA.length] }));
  const segunda = r.participacao
    ? { titulo: `Peso do ${r.participacao.uf} nas compras do Brasil`, fatias: [{ rotulo: r.participacao.uf, n: r.participacao.estado, cor: CORES_PIZZA[0] }, { rotulo: 'Demais estados', n: r.participacao.brasil - r.participacao.estado, cor: CINZA_PIZZA }] }
    : r.regioes?.length ? { titulo: 'Compras por região do Brasil', fatias: r.regioes.map((x, k) => ({ rotulo: x.nome, n: x.compras, cor: CORES_PIZZA[k % CORES_PIZZA.length] })) } : null;
  return [{ titulo: `Quem compra${r.estado ? ` no ${r.estado.uf}` : ''} (esfera)`, fatias: esf }, segunda].filter((x) => x && x.fatias.some((f) => f.n > 0));
}

/** Os quatro números do topo do resumo. */
export function kpisResumo(r) {
  const foco = (r.estado || r.brasil).periodos; const onde = r.estado ? `no ${r.estado.uf}` : 'no Brasil';
  const t = r.tendencia;
  return [
    [curto(foco[12].valor) + (foco[12].parcial ? '*' : ''), `comprados ${onde} em 12 meses`],
    [num(comprasOf(foco[12])), `compras de ${num(foco[12].orgaos)} órgão(s) em 12 meses`],
    [t.variacao_pct == null ? '-' : `${t.variacao_pct >= 0 ? '+' : ''}${t.variacao_pct}%`, 'compras nos últimos 6 meses x 6 anteriores'],
    [num(r.abertas.total), `licitação(ões) aberta(s) agora ${onde}`],
  ];
}

export function pdfRelatorio(r, { modo = 'interno', para = '', preparadoPor = '' } = {}) {
  const lead = modo === 'lead';
  const pdf = criarPdf();
  const nome = r.consulta.nome || `Código ${r.consulta.codigo}`;
  const onde = r.estado ? r.estado.uf : 'Brasil';
  const leitura = r.leitura || leituraMercado(r);
  const parcial = [r.brasil, r.estado].some((e) => e && PERIODOS.some((m) => e.periodos[m].parcial));

  // Capa
  const sub = `${r.termo ? `Pesquisa: "${r.termo}" · ` : ''}Unidade: ${r.unidade || 'não informada'} · ${onde} · ${dataBr(r.gerado_em.slice(0, 10))}`;
  pdf.bloco(76, (t) => {
    t.ret(t.x, 0, t.largura, 76, { cor: AZUL, raio: 8 });
    t.txt(lead ? 'OPORTUNIDADE NO MERCADO PÚBLICO' : 'ANÁLISE DE MERCADO · USO INTERNO', t.x + 16, 11, { tam: 8, negrito: true, cor: [0.75, 0.84, 0.95] });
    t.txt(nome, t.x + 16, 24, { tam: 16, negrito: true, cor: [1, 1, 1], maxW: t.largura - 32, max: 2, espaco: 1.15 });
    t.txt(sub, t.x + 16, 60, { tam: 8.5, cor: [0.85, 0.9, 0.97], maxW: t.largura - 32, max: 1 });
  }, { depois: 4 });
  if (para || preparadoPor) pdf.texto([para ? `Preparado para: ${para}` : null, preparadoPor ? `Preparado por: ${preparadoPor}` : null].filter(Boolean).join('   ·   '), { tam: 9, cor: CINZA, depois: 6 });

  // Resumo: números, pizzas e leitura
  pdf.secao('Resumo', { minimo: 300 });
  const kp = kpisResumo(r);
  pdf.bloco(48, (t) => {
    const g = 6; const w = (t.largura - 3 * g) / 4;
    kp.forEach(([v, rot], i) => {
      const x = t.x + i * (w + g);
      t.ret(x, 0, w, 48, { cor: CLARO, borda: LINHA, raio: 6 });
      t.txt(v, x + 8, 7, { tam: 14, negrito: true, cor: AZUL, maxW: w - 14, max: 1 });
      t.txt(rot, x + 8, 27, { tam: 7.2, cor: CINZA, maxW: w - 14, max: 2, espaco: 1.2 });
    });
  }, { depois: 10 });
  const pz = pizzasResumo(r);
  if (pz.length) {
    pdf.bloco(118, (t) => {
      const w = t.largura / pz.length;
      pz.forEach((p, i) => {
        const x = t.x + i * w; const total = p.fatias.reduce((a, f) => a + f.n, 0);
        t.txt(p.titulo, x, 0, { tam: 9, negrito: true, cor: AZUL, maxW: w - 10, max: 1 });
        t.pizza(x + 46, 62, 42, p.fatias.map((f) => ({ valor: f.n, cor: hex(f.cor) })));
        p.fatias.slice(0, 6).forEach((f, k) => {
          const ly = 26 + k * 14;
          t.ret(x + 100, ly + 1.5, 8, 8, { cor: hex(f.cor), raio: 1.5 });
          t.txt(`${f.rotulo}  ${pctTxt(f.n, total)}`, x + 112, ly, { tam: 8.5, maxW: w - 120, max: 1 });
        });
      });
    }, { depois: 8 });
  }
  if (leitura.length) {
    pdf.texto('Em poucas palavras', { tam: 10, negrito: true, cor: AZUL, depois: 2 });
    for (const l of leitura) pdf.texto(`\x95 ${l}`, { tam: 9.5, depois: 1.5 });
  }

  if (lead) {
    pdf.secao('Tamanho do mercado');
    pdf.tabela(['Onde', 'Compras em 6 meses', 'Em 12 meses', 'Em 24 meses', 'Valor em 12 meses'], linhasTamanho(r),
      { larguras: [0.2, 0.2, 0.18, 0.18, 0.24], alinhar: ['', 'r', 'r', 'r', 'r'] });
    pdf.secao('O que a assessoria entrega para a sua empresa', { minimo: 150 });
    pdf.texto('Este resumo mostra o tamanho da oportunidade. No estudo completo, a assessoria entrega:', { tam: 9.5, depois: 3 });
    for (const t of [`Quais órgãos compram esse produto${r.estado ? ` no ${onde}` : ''} e com que frequência.`,
      'O preço praticado nas compras públicas e a margem possível para a sua empresa.',
      'As marcas que vencem e o que os órgãos costumam exigir no edital.',
      r.abertas.total ? `As ${r.abertas.total} licitação(ões) aberta(s) agora, com prazos e documentos para participar.` : 'As novas licitações desse produto assim que forem publicadas.',
      'Cadastro (SICAF), certidões, proposta e acompanhamento da disputa até o contrato.']) pdf.texto(`\x95 ${t}`, { tam: 9.5, depois: 1.5 });
    if (preparadoPor) pdf.espaco(4).texto(`Fale com ${preparadoPor}.`, { tam: 10, negrito: true, cor: AZUL });
  } else {
    pdf.secao(`Volume de compras: ${r.estado ? `${onde} e Brasil` : 'Brasil'}`);
    pdf.tabela(['Onde', 'Período', 'Compras', 'Quantidade', 'Valor movimentado', 'Preço mediano', 'Órgãos'], linhasVolume(r),
      { larguras: [0.14, 0.12, 0.16, 0.14, 0.17, 0.15, 0.12], alinhar: ['', '', 'r', 'r', 'r', 'r', 'r'] });
    pdf.secao('Preço praticado');
    const e = r.precos;
    if (e.n) {
      pdf.campo('Faixa usual (metade central das compras):', `${brl(e.q1)} a ${brl(e.q3)}`);
      pdf.campo('Preço mediano:', brl(e.mediana));
      pdf.campo('Menor e maior preço:', `${brl(e.menor)} e ${brl(e.maior)}${e.fora_da_curva ? ` (${e.fora_da_curva} preço(s) fora da curva)` : ''}`);
    } else pdf.texto('Sem preços no período.');
    pdf.secao(`Órgãos que mais compram${r.estado ? ` no ${onde}` : ''}`);
    pdf.tabela(['Órgão comprador', 'Esfera', 'Local', 'Compras', 'Valor', 'Última'], r.orgaos_top.map((o) => [o.nome, o.esfera, o.local, num(o.compras), curto(o.valor), dataBr(o.ultima)]),
      { larguras: [0.38, 0.12, 0.17, 0.09, 0.12, 0.12], alinhar: ['', '', '', 'r', 'r', ''] });
    pdf.secao('Últimas compras');
    pdf.tabela(['Data', 'Órgão', 'Esfera', 'Qtd.', 'Preço unit.', 'Marca / fornecedor'],
      r.ultimas_compras.map((u) => [dataBr(u.data), `${u.orgao || '-'}${u.local ? ` (${u.local})` : ''}`, u.esfera, num(u.quantidade), `${brl(u.preco)}${u.fora_da_curva ? ' (fora da curva)' : ''}`, `${u.marca || '-'} / ${u.fornecedor || '-'}`]),
      { larguras: [0.1, 0.36, 0.1, 0.08, 0.12, 0.24], alinhar: ['', '', '', 'r', 'r', ''] });
    pdf.secao('Marcas mais vendidas');
    pdf.barras(r.marcas_top.map((m) => ({ rotulo: m.nome, n: m.quantidade || m.compras, texto: `${num(m.quantidade)} un.` })));
    pdf.texto(`${num(r.marcas_total)} marca(s) diferente(s) vencedoras · ${num(r.fornecedores_total)} fornecedor(es) vencedor(es) no período.`, { tam: 9, cor: CINZA });
    if (r.fornecedores.length) {
      pdf.secao('Melhores preços por fornecedor (concorrência)');
      pdf.tabela(['#', 'Fornecedor', 'Vendas', 'Menor', 'Mediana', 'Último', 'Marcas'], r.fornecedores.map((f, k) => [`${k + 1}º`, f.nome, num(f.compras), brl(f.menor), brl(f.mediana), brl(f.ultimo_preco), f.marcas.join(', ')]),
        { larguras: [0.05, 0.31, 0.08, 0.12, 0.12, 0.12, 0.2], alinhar: ['', '', 'r', 'r', 'r', 'r', ''] });
    }
    if (r.abertas.total) {
      pdf.secao(`Licitações abertas agora (${r.abertas.total})`);
      pdf.tabela(['Objeto', 'Órgão', 'Propostas até', 'Estimado'], r.abertas.dados.map((l) => [String(l.objeto || '-').slice(0, 160), `${l.orgao || '-'}${l.local ? ` (${l.local})` : ''}`, dataBr(l.encerramento), l.valor ? brl(l.valor) : '-']),
        { larguras: [0.44, 0.3, 0.12, 0.14], alinhar: ['', '', '', 'r'] });
    }
  }
  pdf.espaco(6);
  pdf.texto(`Fonte: Compras.gov.br, Dados Abertos (módulo Pesquisa de Preços): compras de órgãos federais e de estados e municípios que usam o Compras.gov.br. Compras feitas em outros sistemas não aparecem. Valores sem os preços fora da curva (critério estatístico).${parcial ? ' * Amostra parcial: o valor soma só as compras baixadas; o número de compras é o total oficial.' : ''}`,
    { tam: 7.5, cor: [0.4, 0.4, 0.4] });
  return pdf.gerar({ titulo: `${lead ? 'Oportunidade' : 'Análise de mercado'} - ${nome}`, rodape: lead ? (preparadoPor || 'Licita Inteligente') : 'Uso interno - Licita Inteligente' });
}
