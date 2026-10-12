// Análise de mercado · relatório do item: Brasil × estado em 6/12/24 meses, quem compra, últimas compras,
// licitações abertas, e o relatório para imprimir ou baixar em PDF em dois modos:
//  - "Para uso interno": tudo, inclusive os fornecedores concorrentes;
//  - "Para captação de lead": o que convence uma empresa a vender ao governo, sem nomes de concorrentes.
import { api, qs } from './api.js';
import { h, render, toast, carregando, erroBox, numero, data, moeda } from './ui.js';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => (v == null ? '—' : BRL.format(v));
const curto = (v) => (v == null ? '—' : v >= 1e9 ? `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`
  : v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e4 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBr = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const PERIODOS = [6, 12, 24];
const CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#7a5af8'];

const parametros = (q) => ({ tipo: q.tipo, codigo: q.codigo, uf: q.uf, item: q.item, unidade: q.unidade, filtro: q.filtro, termo: q.q });

/** Bloco da tela: volume Brasil × estado, tendência, quem compra, últimas compras, licitações abertas e o relatório. */
export function blocoRelatorio(q, est) {
  const caixa = h('div', { class: 'relatorio-mercado', style: { marginTop: '14px' } }, carregando('Comparando Brasil e estado em 6, 12 e 24 meses…'));
  api(`/precos/relatorio${qs(parametros(q))}`).then((r) => render(caixa, ...conteudo(r, q, est))).catch((e) => render(caixa, erroBox(e)));
  return caixa;
}

function tabelaVolume(r) {
  const escopos = [[r.estado ? `Estado (${r.estado.uf})` : null, r.estado], ['Brasil', r.brasil]].filter(([n, e]) => n && e);
  const parcial = escopos.some(([, e]) => PERIODOS.some((m) => e.periodos[m].parcial));
  return [h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-volume' },
    h('thead', {}, h('tr', {}, ['Onde', 'Período', 'Compras', 'Quantidade', 'Valor movimentado', 'Preço mediano', 'Órgãos'].map((t) => h('th', {}, t)))),
    h('tbody', {}, escopos.flatMap(([nome, e]) => PERIODOS.map((m, k) => {
      const p = e.periodos[m];
      return h('tr', { class: k === 0 ? 'inicio-grupo' : '' },
        k === 0 ? h('td', { rowspan: 3 }, h('strong', {}, nome)) : null,
        h('td', {}, `${m} meses`),
        h('td', { class: 'num' }, numero(p.compras), p.parcial ? h('div', { class: 'suave pequeno', title: 'Amostra parcial: a fonte tem mais compras do que foi possível baixar. Quantidade e valor somam só a amostra; "de N" é o total oficial.' }, `de ${numero(p.total_fonte)} *`) : null),
        h('td', { class: 'num' }, numero(p.quantidade)),
        h('td', { class: 'num', title: brl(p.valor) }, curto(p.valor)),
        h('td', { class: 'num' }, brl(p.mediana)),
        h('td', { class: 'num' }, numero(p.orgaos)));
    }))))),
  parcial ? h('div', { class: 'suave pequeno' }, '* Amostra parcial: a fonte tem mais compras do que foi possível baixar. Quantidade e valor somam só a amostra; "de N" é o total oficial de compras.') : null];
}

function conteudo(r, q, est) {
  const un = r.unidade ? ` (${r.unidade})` : '';
  const t = r.tendencia;
  const modo = { v: 'interno' };
  const para = h('input', { type: 'text', placeholder: 'ex.: Papelaria Exemplo Ltda', style: { minWidth: '220px' } });
  const assinatura = h('input', { type: 'text', value: [est.usuario.nome, est.empresa?.nome].filter(Boolean).join(' · '), style: { minWidth: '260px' } });
  const campoPara = h('div', { class: 'campo-lead', hidden: true }, h('label', { class: 'pequeno' }, 'Empresa que vai receber'), para);
  const campoAss = h('div', { class: 'campo-lead', hidden: true }, h('label', { class: 'pequeno' }, 'Assinatura (quem apresenta)'), assinatura);
  const flag = (v, rot, dica) => h('label', { class: 'flag-relatorio', title: dica },
    h('input', { type: 'radio', name: 'modo-relatorio', value: v, checked: v === 'interno', onchange: () => { modo.v = v; campoPara.hidden = v !== 'lead'; campoAss.hidden = v !== 'lead'; } }), ' ', rot);
  const extras = () => (modo.v === 'lead' ? { para: para.value.trim(), assinatura: assinatura.value.trim() } : {});
  const baixar = () => { location.href = `/api/precos/relatorio.pdf${qs({ ...parametros(q), modo: modo.v, ...extras() })}`; toast('Gerando o PDF…'); };
  const imprimir = async () => {
    const janela = window.open('', '_blank');
    if (!janela) return toast('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.', 7000);
    try {
      const dados = modo.v === 'lead' ? await api(`/precos/relatorio${qs({ ...parametros(q), modo: 'lead' })}`) : r;
      imprimirRelatorio(janela, dados, { modo: modo.v, ...extras() });
    } catch (e) { janela.close(); toast(e.message, 6000); }
  };

  return [
    h('div', { class: 'cartao destaque-relatorio' },
      h('h2', { style: { margin: '0 0 6px' } }, 'Relatório para imprimir ou baixar'),
      h('div', { class: 'linha' }, flag('interno', 'Para uso interno', 'Tudo: volumes, órgãos, marcas, preços e os fornecedores concorrentes'),
        flag('lead', 'Para captação de lead', 'Para apresentar a uma empresa: oportunidade, quem compra, preço e marcas, sem os nomes dos concorrentes')),
      h('div', { class: 'linha', style: { marginTop: '8px' } }, campoPara, campoAss),
      h('div', { class: 'linha', style: { marginTop: '8px' } },
        h('button', { class: 'btn', onclick: imprimir }, '🖨 Imprimir'),
        h('button', { class: 'btn primario', onclick: baixar }, '⬇ Baixar PDF'))),
    h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('h2', { style: { margin: '0 0 4px' } }, `Quanto foi comprado${un}`),
      h('div', { class: 'suave pequeno', style: { marginBottom: '8px' } }, 'Quantidade e valor de compras registradas no Compras.gov.br. Valor sem os preços fora da curva.'),
      ...tabelaVolume(r),
      t.variacao_pct != null ? h('div', { class: 'pequeno', style: { marginTop: '8px' } }, h('strong', {}, 'Tendência: '),
        `${numero(t.ultimos6)} compra(s) nos últimos 6 meses contra ${numero(t.anteriores6)} nos 6 anteriores `,
        h('span', { class: t.variacao_pct >= 0 ? 'texto-sucesso' : 'texto-perigo' }, `(${t.variacao_pct >= 0 ? '+' : ''}${t.variacao_pct}%)`), '.') : null),
    h('div', { class: 'grade duas', style: { marginTop: '14px' } },
      h('div', { class: 'cartao' }, h('h3', { style: { margin: '0 0 8px' } }, `Órgãos que mais compram${r.estado ? ` no ${r.estado.uf}` : ''}`),
        h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Órgão', 'Esfera', 'Compras', 'Valor'].map((x) => h('th', {}, x)))),
          h('tbody', {}, r.orgaos_top.map((o) => h('tr', {}, h('td', {}, o.nome, h('div', { class: 'suave pequeno' }, [o.local, o.ultima ? `última em ${dataBr(o.ultima)}` : null].filter(Boolean).join(' · '))),
            h('td', {}, h('span', { class: `etiqueta esfera-${o.esfera.toLowerCase()}` }, o.esfera)), h('td', { class: 'num' }, numero(o.compras)), h('td', { class: 'num' }, curto(o.valor)))))))),
      h('div', { class: 'cartao' }, h('h3', { style: { margin: '0 0 8px' } }, 'Últimas compras'),
        h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Data', 'Órgão', 'Esfera', 'Qtd.', 'Preço'].map((x) => h('th', {}, x)))),
          h('tbody', {}, r.ultimas_compras.map((u) => h('tr', {}, h('td', {}, dataBr(u.data)), h('td', { class: 'pequeno' }, u.orgao || '—', u.local ? h('div', { class: 'suave' }, u.local) : null),
            h('td', {}, h('span', { class: `etiqueta esfera-${u.esfera.toLowerCase()}` }, u.esfera)), h('td', { class: 'num' }, numero(u.quantidade)), h('td', { class: 'num' }, brl(u.preco), u.fora_da_curva ? h('div', {}, h('span', { class: 'etiqueta vermelha', title: 'Provável erro de lançamento na fonte' }, 'fora da curva')) : null)))))))),
    r.abertas.total ? h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('h3', { style: { margin: '0 0 8px' } }, `Licitações abertas agora com "${r.termo}"${r.estado ? ` no ${r.estado.uf}` : ''}: ${numero(r.abertas.total)}`),
      h('ul', {}, r.abertas.dados.map((l) => h('li', {}, h('a', { href: `#/licitacao/${l.id}` }, (l.objeto || '').slice(0, 140)), h('span', { class: 'suave pequeno' }, ` · ${l.orgao || ''}${l.local ? ` (${l.local})` : ''}${l.encerramento ? ` · propostas até ${data(l.encerramento)}` : ''}${l.valor ? ` · ${moeda(l.valor)}` : ''}`)))),
      r.abertas.total > r.abertas.dados.length ? h('a', { href: `#/buscar${qs({ q: r.termo, uf: r.estado?.uf, visao: 'abertas' })}` }, 'Ver todas na busca') : null) : null,
  ];
}

/** Página A4 para imprimir (ou salvar em PDF pelo navegador), no modo escolhido. */
export function imprimirRelatorio(janela, r, { modo = 'interno', para = '', assinatura = '' } = {}) {
  const lead = modo === 'lead';
  const nome = r.consulta.nome || `Código ${r.consulta.codigo}`;
  const onde = r.estado ? r.estado.uf : 'Brasil';
  const foco = (r.estado || r.brasil).periodos;
  const pizza = (itens) => {
    const total = itens.reduce((t, i) => t + i.n, 0) || 1;
    let acc = 0;
    const fatias = itens.map((i, k) => { const ini = (acc / total) * 100; acc += i.n; return `${CORES[k % CORES.length]} ${ini.toFixed(2)}% ${((acc / total) * 100).toFixed(2)}%`; });
    return `<div class="pizza-bloco"><div class="pizza" style="background: conic-gradient(${fatias.join(', ')})"></div><ul class="legenda">${itens.map((i, k) => `<li><span class="cor" style="background:${CORES[k % CORES.length]}"></span>${esc(i.rotulo)} <b>${((i.n / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b></li>`).join('')}</ul></div>`;
  };
  const marcas = r.marcas_top.slice(0, 5).map((m) => ({ rotulo: m.nome, n: m.quantidade || m.compras }));
  const outrasMarcas = r.marcas_top.slice(5).reduce((t, m) => t + (m.quantidade || m.compras), 0);
  if (outrasMarcas) marcas.push({ rotulo: 'Outras', n: outrasMarcas });
  const barras = (itens) => { const max = Math.max(1, ...itens.map((i) => i.n)); return `<div class="barras">${itens.map((i) => `<div class="b"><span class="r">${esc(i.rotulo)}</span><span class="t"><span style="width:${((i.n / max) * 100).toFixed(1)}%"></span></span><span class="n">${esc(i.texto)}</span></div>`).join('')}</div>`; };
  const volume = [[r.estado ? `Estado (${r.estado.uf})` : null, r.estado], ['Brasil', r.brasil]].filter(([n, e]) => n && e)
    .flatMap(([n, e]) => PERIODOS.map((m, k) => { const p = e.periodos[m]; return `<tr>${k === 0 ? `<td rowspan="3"><b>${esc(n)}</b></td>` : ''}<td>${m} meses</td><td class="n">${numero(p.compras)}${p.parcial ? ` <small>(de ${numero(p.total_fonte)})*</small>` : ''}</td><td class="n">${numero(p.quantidade)}</td><td class="n">${curto(p.valor)}</td><td class="n">${brl(p.mediana)}</td><td class="n">${numero(p.orgaos)}</td></tr>`; })).join('');
  const t = r.tendencia;
  const resumoLead = lead ? `<div class="resumo">
    <div class="kpi"><div class="v">${curto(foco[12].valor)}</div><div class="l">comprados em 12 meses ${r.estado ? `no ${esc(onde)}` : 'no Brasil'}</div></div>
    <div class="kpi"><div class="v">${numero(foco[12].compras)}</div><div class="l">compras de ${numero(foco[12].orgaos)} órgão(s)</div></div>
    <div class="kpi"><div class="v">${numero(r.brasil.periodos[24].parcial ? r.brasil.periodos[24].total_fonte : r.brasil.periodos[24].compras)}</div><div class="l">compras no Brasil em 24 meses</div></div>
    <div class="kpi"><div class="v">${numero(r.abertas.total)}</div><div class="l">licitações abertas agora</div></div></div>` : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${lead ? 'Oportunidade' : 'Análise de mercado'} · ${esc(nome)}${r.estado ? ` · ${esc(onde)}` : ''}</title>
<style>
@page { size: A4 portrait; margin: 14mm 12mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font: 10pt/1.4 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
.barra { position: sticky; top: 0; background: #0f3d6e; color: #fff; padding: 8px 14px; display: flex; gap: 12px; align-items: center; z-index: 2; }
.barra button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; cursor: pointer; }
.pagina { max-width: 186mm; margin: 0 auto; padding: 10px 0; }
.topo { border-bottom: 3px solid #0f3d6e; padding-bottom: 8px; margin-bottom: 10px; }
.sobre { font-size: 8.5pt; font-weight: 700; color: #6b7280; letter-spacing: .06em; text-transform: uppercase; }
h1 { font-size: 18pt; margin: 2px 0 4px; } .meta { color: #555; font-size: 9pt; }
h2 { font-size: 11pt; background: #0f3d6e; color: #fff; padding: 4px 8px; margin: 14px 0 6px; border-radius: 3px; }
table { width: 100%; border-collapse: collapse; font-size: 8.8pt; } th, td { border-bottom: 1px solid #d6dbe3; padding: 3px 5px; text-align: left; vertical-align: top; }
th { background: #eef2f7; } td.n { text-align: right; white-space: nowrap; } small { color: #666; }
.resumo { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
.kpi { border: 1px solid #c9d3e0; border-radius: 6px; padding: 8px; } .kpi .v { font-size: 15pt; font-weight: 700; color: #0f3d6e; } .kpi .l { font-size: 8.5pt; color: #444; }
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pizza-bloco { display: flex; gap: 12px; align-items: center; } .pizza { width: 110px; height: 110px; border-radius: 50%; flex: none; }
.legenda { list-style: none; padding: 0; margin: 0; font-size: 8.8pt; } .legenda li { margin: 2px 0; } .cor { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
.barras .b { display: grid; grid-template-columns: 38% 1fr 22%; gap: 6px; align-items: center; font-size: 8.8pt; margin: 2px 0; }
.barras .t { background: #eceff3; height: 9px; border-radius: 3px; overflow: hidden; } .barras .t span { display: block; height: 100%; background: #0f3d6e; } .barras .n { text-align: right; }
ul.pontos li { margin: 3px 0; } .fonte { font-size: 7.5pt; color: #666; margin-top: 12px; }
@media print { .barra { display: none; } .pagina { padding: 0; } tr, .kpi, .pizza-bloco { page-break-inside: avoid; } h2 { page-break-after: avoid; } }
</style></head><body>
<div class="barra"><button id="btn-imprimir">🖨 Imprimir / salvar em PDF</button><span>${lead ? 'Versão para captação: sem nomes de concorrentes.' : 'Versão para uso interno.'}</span></div>
<div class="pagina">
<div class="topo"><div class="sobre">${lead ? 'Oportunidade no mercado público' : 'Análise de mercado · uso interno'}</div><h1>${esc(nome)}</h1>
<div class="meta">${r.termo ? `Pesquisa: "${esc(r.termo)}" · ` : ''}Unidade: ${esc(r.unidade || 'não informada')} · ${esc(onde)} · gerado em ${dataBr(r.gerado_em.slice(0, 10))}</div>
${para ? `<div><b>Preparado para:</b> ${esc(para)}</div>` : ''}${lead && assinatura ? `<div><b>Preparado por:</b> ${esc(assinatura)}</div>` : ''}</div>
${resumoLead}
${lead && t.variacao_pct != null ? `<p><b>Tendência:</b> ${t.ultimos6} compra(s) nos últimos 6 meses contra ${t.anteriores6} nos 6 anteriores (${t.variacao_pct >= 0 ? '+' : ''}${t.variacao_pct}%).</p>` : ''}
<h2>Quanto foi comprado: ${r.estado ? `${esc(onde)} e Brasil` : 'Brasil'}</h2>
<table><thead><tr><th>Onde</th><th>Período</th><th>Compras</th><th>Quantidade</th><th>Valor</th><th>Preço mediano</th><th>Órgãos</th></tr></thead><tbody>${volume}</tbody></table>
${!lead && t.variacao_pct != null ? `<p><b>Tendência:</b> ${t.ultimos6} compra(s) nos últimos 6 meses contra ${t.anteriores6} nos 6 anteriores (${t.variacao_pct >= 0 ? '+' : ''}${t.variacao_pct}%).</p>` : ''}
<div class="duas"><div><h2>Quem compra (esfera)</h2>${pizza(r.esferas.map((e) => ({ rotulo: `${e.nome} (${numero(e.compras)})`, n: e.compras })))}</div>
<div><h2>Marcas mais vendidas</h2>${marcas.length ? pizza(marcas) : '<p>Sem marcas identificadas.</p>'}</div></div>
<h2>Ranking das marcas (quantidade)</h2>${barras(r.marcas_top.map((m) => ({ rotulo: m.nome, n: m.quantidade || m.compras, texto: `${numero(m.quantidade)} un.` })))}
<h2>Órgãos que mais compram${r.estado ? ` no ${esc(onde)}` : ''}</h2>
<table><thead><tr><th>Órgão</th><th>Esfera</th><th>Local</th><th>Compras</th><th>Valor</th><th>Última</th></tr></thead><tbody>${r.orgaos_top.map((o) => `<tr><td>${esc(o.nome)}</td><td>${esc(o.esfera)}</td><td>${esc(o.local)}</td><td class="n">${numero(o.compras)}</td><td class="n">${curto(o.valor)}</td><td>${dataBr(o.ultima)}</td></tr>`).join('')}</tbody></table>
<h2>Últimas compras</h2>
<table><thead><tr><th>Data</th><th>Órgão</th><th>Esfera</th><th>Qtd.</th><th>Preço unit.</th><th>Marca${lead ? '' : ' / fornecedor'}</th></tr></thead><tbody>${r.ultimas_compras.map((u) => `<tr><td>${dataBr(u.data)}</td><td>${esc(u.orgao || '—')}${u.local ? ` <small>(${esc(u.local)})</small>` : ''}</td><td>${esc(u.esfera)}</td><td class="n">${numero(u.quantidade)}</td><td class="n">${brl(u.preco)}${u.fora_da_curva ? ' <small>(fora da curva)</small>' : ''}</td><td>${esc(u.marca || '—')}${lead ? '' : ` / ${esc(u.fornecedor || '—')}`}</td></tr>`).join('')}</tbody></table>
<h2>Preço praticado</h2>
${r.precos.n ? `<p>Faixa usual (metade central das compras): <b>${brl(r.precos.q1)} a ${brl(r.precos.q3)}</b> · mediana <b>${brl(r.precos.mediana)}</b> · menor ${brl(r.precos.menor)}${r.precos.fora_da_curva ? ` · ${r.precos.fora_da_curva} preço(s) fora da curva desconsiderados nos valores` : ''}.</p>` : '<p>Sem preços no período.</p>'}
<p>${numero(r.marcas_total)} marca(s) e ${numero(r.fornecedores_total)} fornecedor(es) vencedor(es) no período.</p>
${!lead && r.fornecedores.length ? `<h2>Melhores preços por fornecedor (concorrência)</h2><table><thead><tr><th>#</th><th>Fornecedor</th><th>Vendas</th><th>Menor</th><th>Mediana</th><th>Último</th><th>Marcas</th></tr></thead><tbody>${r.fornecedores.map((f, k) => `<tr><td>${k + 1}º</td><td>${esc(f.nome)}</td><td class="n">${numero(f.compras)}</td><td class="n">${brl(f.menor)}</td><td class="n"><b>${brl(f.mediana)}</b></td><td class="n">${brl(f.ultimo_preco)}</td><td>${esc(f.marcas.join(', '))}</td></tr>`).join('')}</tbody></table>` : ''}
${r.abertas.total ? `<h2>Licitações abertas agora (${numero(r.abertas.total)})</h2><table><thead><tr><th>Objeto</th><th>Órgão</th><th>Propostas até</th><th>Estimado</th></tr></thead><tbody>${r.abertas.dados.map((l) => `<tr><td>${esc((l.objeto || '').slice(0, 160))}</td><td>${esc(l.orgao || '—')}${l.local ? ` <small>(${esc(l.local)})</small>` : ''}</td><td>${l.encerramento ? dataBr(l.encerramento.slice(0, 10)) : '—'}</td><td class="n">${l.valor ? brl(l.valor) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
${lead ? `<h2>Como a assessoria ajuda sua empresa a vender para o governo</h2><ul class="pontos">
<li>Encontrar as licitações certas para o seu produto, todos os dias, no Brasil todo ou na sua região.</li>
<li>Cadastro e documentação (SICAF, certidões e habilitação) em dia, com alertas de vencimento.</li>
<li>Cotação com fornecedores e cálculo de custo, impostos e margem antes de entrar na disputa.</li>
<li>Proposta de preços e acompanhamento da disputa até o contrato e o pagamento.</li></ul>` : ''}
<div class="fonte">Fonte: Compras.gov.br, Dados Abertos (Pesquisa de Preços): compras de órgãos federais e de estados e municípios que usam o Compras.gov.br; compras feitas em outros sistemas não aparecem. Valores sem os preços fora da curva (critério estatístico).${PERIODOS.some((m) => r.brasil.periodos[m].parcial || r.estado?.periodos[m].parcial) ? ' * Amostra parcial: quantidade e valor somam só as compras baixadas; o total oficial aparece entre parênteses.' : ''}</div>
</div></body></html>`;
  janela.document.open(); janela.document.write(html); janela.document.close();
  // A política de segurança do site bloqueia script dentro da página impressa: o botão é ligado daqui
  janela.document.getElementById('btn-imprimir').addEventListener('click', () => { janela.focus(); janela.print(); });
}
