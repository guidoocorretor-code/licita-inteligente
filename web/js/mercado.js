// Análise de mercado · relatório do item: Brasil × estado em 6/12/24 meses, quem compra, últimas compras,
// licitações abertas, e o relatório para imprimir ou baixar em PDF em dois modos:
//  - "Para uso interno": tudo, inclusive os fornecedores concorrentes;
//  - "Para captação de lead": tamanho do mercado, tendência e proporções, sem o "ouro" (órgãos, preços, marcas, concorrentes).
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
        flag('lead', 'Para captação de lead', 'Para apresentar a uma empresa: tamanho do mercado, tendência e proporções. Não mostra órgãos, preços, marcas, concorrentes nem quais licitações estão abertas')),
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

const CINZA_PIZZA = '#b8bfc9';
const comprasOf = (p) => (p.parcial && p.total_fonte != null ? p.total_fonte : p.compras);
const pctTxt = (n, t) => `${(t ? (n / t) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Página A4 para imprimir (ou salvar em PDF pelo navegador). Resumo com números e pizzas; o modo lead não
 * mostra o "ouro" (órgãos, preços, marcas, fornecedores e quais licitações estão abertas). */
export function imprimirRelatorio(janela, r, { modo = 'interno', para = '', assinatura = '' } = {}) {
  const lead = modo === 'lead';
  const nome = r.consulta.nome || `Código ${r.consulta.codigo}`;
  const onde = r.estado ? r.estado.uf : 'Brasil';
  const ondeTxt = r.estado ? `no ${r.estado.uf}` : 'no Brasil';
  const foco = (r.estado || r.brasil).periodos;
  const t = r.tendencia;
  const parcial = [r.brasil, r.estado].some((e) => e && PERIODOS.some((m) => e.periodos[m].parcial));
  const pizza = (titulo, itens) => {
    const total = itens.reduce((a, i) => a + i.n, 0) || 1; let acc = 0;
    const fatias = itens.map((i) => { const ini = (acc / total) * 100; acc += i.n; return `${i.cor} ${ini.toFixed(2)}% ${((acc / total) * 100).toFixed(2)}%`; });
    return `<div class="graf"><h3>${esc(titulo)}</h3><div class="pizza-bloco"><div class="pizza" style="background: conic-gradient(${fatias.join(', ')})"></div>
<ul class="legenda">${itens.map((i) => `<li><span class="cor" style="background:${i.cor}"></span>${esc(i.rotulo)} <b>${pctTxt(i.n, total)}</b></li>`).join('')}</ul></div></div>`;
  };
  const pizzas = [pizza(`Quem compra ${ondeTxt} (esfera)`, r.esferas.map((e, k) => ({ rotulo: e.nome, n: e.compras, cor: CORES[k % CORES.length] })))];
  if (r.participacao) pizzas.push(pizza(`Peso do ${r.participacao.uf} nas compras do Brasil`, [{ rotulo: r.participacao.uf, n: r.participacao.estado, cor: CORES[0] }, { rotulo: 'Demais estados', n: r.participacao.brasil - r.participacao.estado, cor: CINZA_PIZZA }]));
  else if (r.regioes?.length) pizzas.push(pizza('Compras por região do Brasil', r.regioes.map((x, k) => ({ rotulo: x.nome, n: x.compras, cor: CORES[k % CORES.length] }))));
  const kpis = [
    [curto(foco[12].valor) + (foco[12].parcial ? '*' : ''), `comprados ${ondeTxt} em 12 meses`],
    [numero(comprasOf(foco[12])), `compras de ${numero(foco[12].orgaos)} órgão(s) em 12 meses`],
    [t.variacao_pct == null ? '—' : `${t.variacao_pct >= 0 ? '+' : ''}${t.variacao_pct}%`, 'compras nos últimos 6 meses x 6 anteriores'],
    [numero(r.abertas.total), `licitação(ões) aberta(s) agora ${ondeTxt}`],
  ].map(([v, l]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  const leitura = (r.leitura || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const escopos = [[r.estado?.uf, r.estado], [null, r.brasil]].filter(([, e]) => e);
  const tamanho = `<table><thead><tr><th>Onde</th><th class="n">Compras em 6 meses</th><th class="n">Em 12 meses</th><th class="n">Em 24 meses</th><th class="n">Valor em 12 meses</th></tr></thead><tbody>${
    escopos.map(([uf, e]) => `<tr><td><b>${esc(uf || 'Brasil')}</b></td>${PERIODOS.map((m) => `<td class="n">${numero(comprasOf(e.periodos[m]))}</td>`).join('')}<td class="n">${curto(e.periodos[12].valor)}${e.periodos[12].parcial ? '*' : ''}</td></tr>`).join('')}</tbody></table>`;
  const volume = escopos.flatMap(([uf, e]) => PERIODOS.map((m, k) => { const p = e.periodos[m]; return `<tr>${k === 0 ? `<td rowspan="3"><b>${esc(uf ? `Estado (${uf})` : 'Brasil')}</b></td>` : ''}<td>${m} meses</td><td class="n">${numero(p.compras)}${p.parcial ? ` <small>(de ${numero(p.total_fonte)})*</small>` : ''}</td><td class="n">${numero(p.quantidade)}</td><td class="n">${curto(p.valor)}</td><td class="n">${brl(p.mediana)}</td><td class="n">${numero(p.orgaos)}</td></tr>`; })).join('');
  const barras = (itens) => { const max = Math.max(1, ...itens.map((i) => i.n)); return `<div class="barras">${itens.map((i) => `<div class="b"><span class="r">${esc(i.rotulo)}</span><span class="t"><span style="width:${((i.n / max) * 100).toFixed(1)}%"></span></span><span class="n">${esc(i.texto)}</span></div>`).join('')}</div>`; };
  const detalhe = lead ? '' : `
<h2>Volume de compras: ${r.estado ? `${esc(onde)} e Brasil` : 'Brasil'}</h2>
<table><thead><tr><th>Onde</th><th>Período</th><th class="n">Compras</th><th class="n">Quantidade</th><th class="n">Valor</th><th class="n">Preço mediano</th><th class="n">Órgãos</th></tr></thead><tbody>${volume}</tbody></table>
<h2>Preço praticado</h2>${r.precos.n ? `<div class="precos"><div><span>Faixa usual (metade central)</span><b>${brl(r.precos.q1)} a ${brl(r.precos.q3)}</b></div><div><span>Preço mediano</span><b>${brl(r.precos.mediana)}</b></div><div><span>Menor e maior</span><b>${brl(r.precos.menor)} e ${brl(r.precos.maior)}</b>${r.precos.fora_da_curva ? `<small>${r.precos.fora_da_curva} preço(s) fora da curva</small>` : ''}</div></div>` : '<p>Sem preços no período.</p>'}
<h2>Órgãos que mais compram${r.estado ? ` no ${esc(onde)}` : ''}</h2>
<table><thead><tr><th>Órgão</th><th>Esfera</th><th>Local</th><th class="n">Compras</th><th class="n">Valor</th><th>Última</th></tr></thead><tbody>${r.orgaos_top.map((o) => `<tr><td>${esc(o.nome)}</td><td>${esc(o.esfera)}</td><td>${esc(o.local)}</td><td class="n">${numero(o.compras)}</td><td class="n">${curto(o.valor)}</td><td>${dataBr(o.ultima)}</td></tr>`).join('')}</tbody></table>
<h2>Últimas compras</h2>
<table><thead><tr><th>Data</th><th>Órgão</th><th>Esfera</th><th class="n">Qtd.</th><th class="n">Preço unit.</th><th>Marca / fornecedor</th></tr></thead><tbody>${r.ultimas_compras.map((u) => `<tr><td>${dataBr(u.data)}</td><td>${esc(u.orgao || '—')}${u.local ? ` <small>(${esc(u.local)})</small>` : ''}</td><td>${esc(u.esfera)}</td><td class="n">${numero(u.quantidade)}</td><td class="n">${brl(u.preco)}${u.fora_da_curva ? ' <small>(fora da curva)</small>' : ''}</td><td>${esc(u.marca || '—')} / ${esc(u.fornecedor || '—')}</td></tr>`).join('')}</tbody></table>
<h2>Marcas mais vendidas</h2>${barras(r.marcas_top.map((m) => ({ rotulo: m.nome, n: m.quantidade || m.compras, texto: `${numero(m.quantidade)} un.` })))}
<p class="nota">${numero(r.marcas_total)} marca(s) e ${numero(r.fornecedores_total)} fornecedor(es) vencedor(es) no período.</p>
${r.fornecedores.length ? `<h2>Melhores preços por fornecedor (concorrência)</h2><table><thead><tr><th>#</th><th>Fornecedor</th><th class="n">Vendas</th><th class="n">Menor</th><th class="n">Mediana</th><th class="n">Último</th><th>Marcas</th></tr></thead><tbody>${r.fornecedores.map((f, k) => `<tr><td>${k + 1}º</td><td>${esc(f.nome)}</td><td class="n">${numero(f.compras)}</td><td class="n">${brl(f.menor)}</td><td class="n"><b>${brl(f.mediana)}</b></td><td class="n">${brl(f.ultimo_preco)}</td><td>${esc(f.marcas.join(', '))}</td></tr>`).join('')}</tbody></table>` : ''}
${r.abertas.total ? `<h2>Licitações abertas agora (${numero(r.abertas.total)})</h2><table><thead><tr><th>Objeto</th><th>Órgão</th><th>Propostas até</th><th class="n">Estimado</th></tr></thead><tbody>${r.abertas.dados.map((l) => `<tr><td>${esc((l.objeto || '').slice(0, 160))}</td><td>${esc(l.orgao || '—')}${l.local ? ` <small>(${esc(l.local)})</small>` : ''}</td><td>${l.encerramento ? dataBr(l.encerramento.slice(0, 10)) : '—'}</td><td class="n">${l.valor ? brl(l.valor) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}`;
  const oferta = lead ? `
<h2>Tamanho do mercado</h2>${tamanho}
<h2>O que a assessoria entrega para a sua empresa</h2>
<p>Este resumo mostra o tamanho da oportunidade. No estudo completo, a assessoria entrega:</p>
<ul class="pontos"><li>Quais órgãos compram esse produto${r.estado ? ` no ${esc(onde)}` : ''} e com que frequência.</li>
<li>O preço praticado nas compras públicas e a margem possível para a sua empresa.</li>
<li>As marcas que vencem e o que os órgãos costumam exigir no edital.</li>
<li>${r.abertas.total ? `As ${numero(r.abertas.total)} licitação(ões) aberta(s) agora, com prazos e documentos para participar.` : 'As novas licitações desse produto assim que forem publicadas.'}</li>
<li>Cadastro (SICAF), certidões, proposta e acompanhamento da disputa até o contrato.</li></ul>
${assinatura ? `<div class="contato">Fale com ${esc(assinatura)}</div>` : ''}` : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${lead ? 'Oportunidade' : 'Análise de mercado'} · ${esc(nome)}${r.estado ? ` · ${esc(onde)}` : ''}</title>
<style>
@page { size: A4 portrait; margin: 12mm 11mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root { --azul: #0f3d6e; --azul2: #1f5fa3; --claro: #eef4fb; --linha: #d7e0ea; --tinta: #14212e; --suave: #5b6876; }
body { font: 10pt/1.45 "Segoe UI", Arial, Helvetica, sans-serif; color: var(--tinta); margin: 0; background: #fff; }
.barra { position: sticky; top: 0; background: var(--azul); color: #fff; padding: 8px 14px; display: flex; gap: 12px; align-items: center; z-index: 2; }
.barra button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; cursor: pointer; }
.pagina { max-width: 188mm; margin: 0 auto; padding: 12px 0; }
.capa { background: linear-gradient(135deg, var(--azul), var(--azul2)); color: #fff; border-radius: 10px; padding: 14px 18px; }
.capa .sobre { font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; opacity: .85; font-weight: 700; }
.capa h1 { margin: 2px 0 6px; font-size: 18pt; line-height: 1.2; } .capa .meta { font-size: 8.5pt; opacity: .9; }
.prep { font-size: 9pt; color: var(--suave); margin: 6px 2px 4px; }
h2 { font-size: 11pt; background: var(--azul); color: #fff; padding: 4px 10px; margin: 14px 0 8px; border-radius: 4px; }
h3 { font-size: 9.5pt; color: var(--azul); margin: 0 0 6px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.kpi { border: 1px solid var(--linha); border-radius: 8px; padding: 8px 10px; background: var(--claro); }
.kpi .v { font-size: 15pt; font-weight: 800; color: var(--azul); line-height: 1.2; } .kpi .l { font-size: 8pt; color: var(--suave); }
.graficos { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 12px 0 6px; }
.pizza-bloco { display: flex; gap: 14px; align-items: center; } .pizza { width: 112px; height: 112px; border-radius: 50%; flex: none; }
.legenda { list-style: none; padding: 0; margin: 0; font-size: 9pt; } .legenda li { margin: 3px 0; } .cor { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.leitura { background: #f6f8fb; border-left: 4px solid var(--azul2); border-radius: 6px; padding: 8px 12px; margin-top: 8px; }
.leitura b { color: var(--azul); } .leitura ul { margin: 4px 0 0; padding-left: 18px; } .leitura li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; font-size: 8.8pt; } th, td { border-bottom: 1px solid var(--linha); padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: var(--claro); font-weight: 700; } .n { text-align: right; white-space: nowrap; } small { color: var(--suave); }
.precos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; } .precos div { border: 1px solid var(--linha); border-radius: 6px; padding: 6px 10px; }
.precos span { display: block; font-size: 8pt; color: var(--suave); } .precos b { font-size: 11pt; color: var(--azul); } .precos small { display: block; }
.barras .b { display: grid; grid-template-columns: 38% 1fr 22%; gap: 6px; align-items: center; font-size: 8.8pt; margin: 2px 0; }
.barras .t { background: #eceff3; height: 9px; border-radius: 3px; overflow: hidden; } .barras .t span { display: block; height: 100%; background: var(--azul2); } .barras .n { text-align: right; }
.nota { font-size: 8.5pt; color: var(--suave); }
ul.pontos li { margin: 3px 0; } .contato { margin-top: 10px; font-weight: 700; color: var(--azul); font-size: 11pt; }
.fonte { font-size: 7.5pt; color: var(--suave); margin-top: 14px; border-top: 1px solid var(--linha); padding-top: 6px; }
@media print { .barra { display: none; } .pagina { padding: 0; } tr, .kpi, .graf, .leitura { page-break-inside: avoid; } h2 { page-break-after: avoid; } }
</style></head><body>
<div class="barra"><button id="btn-imprimir">🖨 Imprimir / salvar em PDF</button><span>${lead ? 'Versão para a empresa: só o tamanho da oportunidade, sem órgãos, preços, marcas e concorrentes.' : 'Versão para uso interno.'}</span></div>
<div class="pagina">
<header class="capa"><div class="sobre">${lead ? 'Oportunidade no mercado público' : 'Análise de mercado · uso interno'}</div><h1>${esc(nome)}</h1>
<div class="meta">${r.termo ? `Pesquisa: "${esc(r.termo)}" · ` : ''}Unidade: ${esc(r.unidade || 'não informada')} · ${esc(onde)} · ${dataBr(r.gerado_em.slice(0, 10))}</div></header>
${para || assinatura ? `<div class="prep">${[para ? `Preparado para: <b>${esc(para)}</b>` : null, lead && assinatura ? `Preparado por: ${esc(assinatura)}` : null].filter(Boolean).join(' · ')}</div>` : ''}
<h2>Resumo</h2>
<section class="kpis">${kpis}</section>
<section class="graficos">${pizzas.join('')}</section>
${leitura ? `<section class="leitura"><b>Em poucas palavras</b><ul>${leitura}</ul></section>` : ''}
${oferta}${detalhe}
<div class="fonte">Fonte: Compras.gov.br, Dados Abertos (Pesquisa de Preços): compras de órgãos federais e de estados e municípios que usam o Compras.gov.br; compras feitas em outros sistemas não aparecem. Valores sem os preços fora da curva (critério estatístico).${parcial ? ' * Amostra parcial: o valor soma só as compras baixadas; o número de compras é o total oficial.' : ''}</div>
</div></body></html>`;
  janela.document.open(); janela.document.write(html); janela.document.close();
  // A política de segurança do site bloqueia script dentro da página impressa: o botão é ligado daqui
  janela.document.getElementById('btn-imprimir').addEventListener('click', () => { janela.focus(); janela.print(); });
}
