// PDF do relatório de mercado (Análise de mercado), nos modos "interno" e "lead".
import { criarPdf } from '../lib/pdf-simples.js';
import { PERIODOS } from './relatorio-mercado.js';

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

export function pdfRelatorio(r, { modo = 'interno', para = '', preparadoPor = '' } = {}) {
  const lead = modo === 'lead';
  const pdf = criarPdf();
  const nome = r.consulta.nome || `Código ${r.consulta.codigo}`;
  const onde = r.estado ? r.estado.uf : 'Brasil';
  const p12 = (r.estado || r.brasil).periodos[12];
  const b24 = r.brasil.periodos[24];

  pdf.texto(lead ? 'OPORTUNIDADE NO MERCADO PÚBLICO' : 'ANÁLISE DE MERCADO · USO INTERNO', { tam: 9, negrito: true, cor: [0.45, 0.45, 0.45] });
  pdf.texto(nome, { tam: 17, negrito: true, depois: 2 });
  pdf.texto(`${r.termo ? `Pesquisa: "${r.termo}" · ` : ''}Unidade de fornecimento: ${r.unidade || 'não informada'} · Gerado em ${dataBr(r.gerado_em.slice(0, 10))}`, { tam: 9, cor: [0.35, 0.35, 0.35] });
  if (para) pdf.texto(`Preparado para: ${para}`, { tam: 10, negrito: true });
  if (preparadoPor) pdf.texto(`Preparado por: ${preparadoPor}`, { tam: 10 });
  pdf.linha();

  if (lead) {
    pdf.secao('Resumo');
    pdf.texto(`Nos últimos 12 meses, órgãos públicos ${r.estado ? `do ${onde}` : 'do Brasil'} registraram ${num(p12.compras)} compra(s) de ${nome.toLowerCase()}, somando ${num(p12.quantidade)} unidade(s) (${r.unidade || 'unidade'}) e cerca de ${curto(p12.valor)}.`, { tam: 11 });
    pdf.texto(`No Brasil, em 24 meses, foram ${num(b24.parcial ? b24.total_fonte : b24.compras)} compra(s) registradas desse item no Compras.gov.br.`, { tam: 11 });
    if (r.tendencia.variacao_pct != null) pdf.texto(`Tendência: ${r.tendencia.ultimos6} compra(s) nos últimos 6 meses contra ${r.tendencia.anteriores6} nos 6 meses anteriores (${r.tendencia.variacao_pct >= 0 ? '+' : ''}${r.tendencia.variacao_pct}%).`, { tam: 11 });
    if (r.abertas.total) pdf.texto(`Agora mesmo há ${r.abertas.total} licitação(ões) aberta(s) ${r.estado ? `no ${onde}` : ''} com esse tipo de produto.`, { tam: 11, negrito: true });
  }

  pdf.secao(`Volume de compras: ${r.estado ? `${onde} e Brasil` : 'Brasil'}`);
  pdf.tabela(['Onde', 'Período', 'Compras', 'Quantidade', 'Valor movimentado', 'Preço mediano', 'Órgãos'], linhasVolume(r),
    { larguras: [0.14, 0.12, 0.16, 0.14, 0.17, 0.15, 0.12], alinhar: ['', '', 'r', 'r', 'r', 'r', 'r'] });
  if ([r.brasil, r.estado].some((e) => e && PERIODOS.some((m) => e.periodos[m].parcial))) {
    pdf.texto('* Período com mais compras do que o limite baixado: quantidade e valor contam as mais recentes; entre parênteses, o total de compras registradas.', { tam: 7.5, cor: [0.4, 0.4, 0.4] });
  }

  pdf.secao(`Quem compra${r.estado ? ` no ${onde}` : ''}`);
  pdf.barras(r.esferas.map((e) => ({ rotulo: e.nome, n: e.compras, texto: `${num(e.compras)} compra(s)` })));
  pdf.tabela(['Órgão comprador', 'Esfera', 'Local', 'Compras', 'Valor', 'Última'], r.orgaos_top.map((o) => [o.nome, o.esfera, o.local, num(o.compras), curto(o.valor), dataBr(o.ultima)]),
    { larguras: [0.38, 0.12, 0.17, 0.09, 0.12, 0.12], alinhar: ['', '', '', 'r', 'r', ''] });

  pdf.secao('Últimas compras');
  pdf.tabela(lead ? ['Data', 'Órgão', 'Esfera', 'Qtd.', 'Preço unit.', 'Marca'] : ['Data', 'Órgão', 'Esfera', 'Qtd.', 'Preço unit.', 'Marca / fornecedor'],
    r.ultimas_compras.map((u) => [dataBr(u.data), `${u.orgao || '-'}${u.local ? ` (${u.local})` : ''}`, u.esfera, num(u.quantidade), `${brl(u.preco)}${u.fora_da_curva ? ' (fora da curva)' : ''}`, lead ? (u.marca || '-') : `${u.marca || '-'} / ${u.fornecedor || '-'}`]),
    { larguras: [0.1, 0.36, 0.1, 0.08, 0.12, 0.24], alinhar: ['', '', '', 'r', 'r', ''] });

  pdf.secao('Preço praticado');
  const e = r.precos;
  if (e.n) {
    pdf.campo('Faixa usual (metade central das compras):', `${brl(e.q1)} a ${brl(e.q3)}`);
    pdf.campo('Preço mediano:', brl(e.mediana));
    pdf.campo('Menor e maior preço:', `${brl(e.menor)} e ${brl(e.maior)}${e.fora_da_curva ? ` (${e.fora_da_curva} preço(s) fora da curva)` : ''}`);
  } else pdf.texto('Sem preços no período.');

  pdf.secao('Marcas mais vendidas');
  pdf.barras(r.marcas_top.map((m) => ({ rotulo: m.nome, n: m.quantidade || m.compras, texto: `${num(m.quantidade)} un.` })));
  pdf.texto(`${num(r.marcas_total)} marca(s) diferente(s) vencedoras · ${num(r.fornecedores_total)} fornecedor(es) vencedor(es) no período.`, { tam: 9, cor: [0.35, 0.35, 0.35] });

  if (!lead && r.fornecedores.length) {
    pdf.secao('Melhores preços por fornecedor (concorrência)');
    pdf.tabela(['#', 'Fornecedor', 'Vendas', 'Menor', 'Mediana', 'Último', 'Marcas'], r.fornecedores.map((f, k) => [`${k + 1}º`, f.nome, num(f.compras), brl(f.menor), brl(f.mediana), brl(f.ultimo_preco), f.marcas.join(', ')]),
      { larguras: [0.05, 0.31, 0.08, 0.12, 0.12, 0.12, 0.2], alinhar: ['', '', 'r', 'r', 'r', 'r', ''] });
  }

  if (r.abertas.total) {
    pdf.secao(`Licitações abertas agora (${r.abertas.total})`);
    pdf.tabela(['Objeto', 'Órgão', 'Propostas até', 'Estimado'], r.abertas.dados.map((l) => [String(l.objeto || '-').slice(0, 160), `${l.orgao || '-'}${l.local ? ` (${l.local})` : ''}`, dataBr(l.encerramento), l.valor ? brl(l.valor) : '-']),
      { larguras: [0.44, 0.3, 0.12, 0.14], alinhar: ['', '', '', 'r'] });
  }

  if (lead) {
    pdf.secao('Como a assessoria ajuda sua empresa a vender para o governo');
    for (const t of ['Encontrar as licitações certas para o seu produto, todos os dias, no Brasil todo ou na sua região.',
      'Cadastro e documentação (SICAF, certidões e habilitação) em dia, com alertas de vencimento.',
      'Cotação com fornecedores, cálculo de custo, impostos e margem antes de entrar na disputa.',
      'Proposta de preços e acompanhamento da disputa até o contrato e o pagamento.']) pdf.texto(`• ${t}`, { tam: 10.5 });
  }
  pdf.espaco(6);
  pdf.texto('Fonte: Compras.gov.br, Dados Abertos (módulo Pesquisa de Preços): compras de órgãos federais e de estados e municípios que usam o Compras.gov.br. Compras feitas em outros sistemas não aparecem. Valores sem os preços fora da curva (critério estatístico).',
    { tam: 7.5, cor: [0.4, 0.4, 0.4] });
  return pdf.gerar({ titulo: `${lead ? 'Oportunidade' : 'Análise de mercado'} - ${nome}`, rodape: lead ? (preparadoPor || 'Licita Inteligente') : 'Uso interno - Licita Inteligente' });
}
