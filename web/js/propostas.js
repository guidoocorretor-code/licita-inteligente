// Fase 4 · Propostas de preços: montadas a partir das cotações, conferidas pela pessoa e impressas/salvas em PDF.
// O sistema não envia nada ao portal do governo: "Enviada no portal" é marcado pela pessoa depois de enviar.
import { api, qs } from './api.js';
import { h, toast, carregando, vazio, confirmar, render, data, dataUtc, naoInformado, faixaGoverno, identificacaoGoverno } from './ui.js';
import { reaisPorExtenso, inteiroPorExtenso } from './extenso.js';

const podeEditar = (e) => e.usuario.papel !== 'leitor';
const BRL = (casas = 2) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: casas });
const brl = (v) => (v == null ? '—' : BRL(v < 1 ? 4 : 2).format(v));
const pct = (v) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const num = (v) => (v == null ? '' : String(v).replace('.', ','));
const lerNum = (v) => { const t = String(v ?? '').trim(); if (!t) return null; const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : NaN; };
const qtdTxt = (i) => (i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${i.unidade_medida || ''}`.trim() : '—');
const fmtCnpj = (d) => String(d || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const numeroLic = (o) => (o.numero_compra ? (String(o.numero_compra).includes('/') ? o.numero_compra : `${o.numero_compra}${o.ano ? `/${o.ano}` : ''}`) : null);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ST_COR = { rascunho: '', pronta: 'amarela', enviada: 'verde', cancelada: 'vermelha' };

function cabecalho(titulo, subtitulo, ...acoes) {
  return h('div', { class: 'cabecalho-pagina' },
    h('div', {}, h('h1', {}, titulo), subtitulo ? h('div', { class: 'suave' }, subtitulo) : null),
    h('div', { class: 'linha' }, ...acoes));
}

// O que falta no cadastro da empresa para a proposta sair completa
function faltasEmpresa(c) {
  if (!c) return ['empresa vinculada ao card'];
  return [[!c.endereco, 'endereço'], [!c.cep, 'CEP'], [!c.telefone && !c.email, 'telefone ou e-mail'], [!c.resp_nome, 'responsável legal'],
    [!c.resp_cpf, 'CPF do responsável'], [!(c.banco && c.agencia && c.conta), 'dados bancários']].filter(([f]) => f).map(([, t]) => t);
}

// ---------- Editor da proposta de uma oportunidade ----------
export async function proposta(alvo, rota, est) {
  render(alvo, carregando());
  const id = rota.args[0];
  let d = await api(`/kanban/${id}/proposta`);
  const editar = podeEditar(est);
  const op = d.oportunidade; const imp = d.impostos_pct;
  const p = d.proposta;
  const linhas = d.itens.map((i) => ({ i,
    incluir: h('input', { type: 'checkbox', checked: i.incluir, disabled: !editar, 'aria-label': `Incluir item ${i.numero_item}` }),
    preco: h('input', { inputmode: 'decimal', value: num(i.preco_unitario), placeholder: i.preco_minimo != null ? num(i.preco_minimo) : '0,00', disabled: !editar, class: 'preco-prop', 'aria-label': `Preço unitário do item ${i.numero_item}` }),
    marca: h('input', { value: i.marca || '', placeholder: 'marca', disabled: !editar, 'aria-label': `Marca do item ${i.numero_item}` }),
    modelo: h('input', { value: i.modelo || '', placeholder: 'modelo / referência', disabled: !editar, 'aria-label': `Modelo do item ${i.numero_item}` }),
    total: h('td', { class: 'num' }), margem: h('td', { class: 'num' }), aviso: h('div', { class: 'pequeno' }) }));
  const f = {
    validade_dias: h('input', { type: 'number', min: 1, max: 365, value: p.validade_dias ?? '', style: { width: '90px' }, disabled: !editar }),
    prazo_entrega: h('input', { value: p.prazo_entrega || '', placeholder: 'ex.: 30 dias corridos após a nota de empenho', disabled: !editar }),
    condicoes_pagamento: h('input', { value: p.condicoes_pagamento || '', placeholder: 'Conforme edital', disabled: !editar }),
    local_entrega: h('input', { value: p.local_entrega || '', placeholder: 'Conforme edital', disabled: !editar }),
    garantia: h('input', { value: p.garantia || '', placeholder: 'ex.: 12 meses do fabricante', disabled: !editar }),
    observacoes: h('textarea', { rows: 2, disabled: !editar }, p.observacoes || ''),
  };
  const decl = Object.entries(d.declaracoes).map(([k, t]) => ({ k, cb: h('input', { type: 'checkbox', checked: p.declaracoes.includes(k), disabled: !editar }), t }));
  const kTotal = h('div', { class: 'valor' }); const kItens = h('div', { class: 'valor' }); const kMargem = h('div', { class: 'valor' }); const kExtenso = h('div', { class: 'apoio' });
  const avisos = h('div');

  // Recalcula total, margem e avisos enquanto a pessoa digita
  const calcular = () => {
    let total = 0; let custo = 0; let semPreco = 0; let semCusto = false; let n = 0; const problemas = [];
    for (const l of linhas) {
      const { i } = l;
      const preco = lerNum(l.preco.value);
      const inc = l.incluir.checked;
      l.preco.closest('tr')?.classList.toggle('fora', !inc);
      const tot = preco && i.quantidade != null ? preco * i.quantidade : null;
      l.total.textContent = tot != null ? brl(tot) : '—';
      const m = preco && i.custo_unitario != null ? ((preco * (1 - (imp || 0) / 100) - i.custo_unitario) / preco) * 100 : null;
      l.margem.textContent = pct(m == null ? null : Math.round(m * 10) / 10);
      l.margem.className = `num ${m != null && m < 0 ? 'texto-perigo' : ''}`;
      const av = [];
      if (Number.isNaN(preco)) av.push(['Preço inválido', 'texto-perigo']);
      else if (preco != null) {
        if (i.estimado_unitario != null && preco > i.estimado_unitario) av.push([`Acima do estimado (${brl(i.estimado_unitario)})`, 'texto-perigo']);
        if (i.custo_unitario != null && preco < i.custo_unitario) av.push(['Abaixo do custo', 'texto-perigo']);
        else if (i.preco_minimo != null && preco < i.preco_minimo) av.push([`Abaixo do preço mínimo (${brl(i.preco_minimo)})`, 'texto-alerta']);
      }
      render(l.aviso, av.map(([t, c]) => h('div', { class: c }, t)));
      if (!inc) continue;
      n++;
      if (preco == null || Number.isNaN(preco)) { semPreco++; continue; }
      if (tot != null) total += tot;
      if (i.custo_unitario != null && i.quantidade != null) custo += i.custo_unitario * i.quantidade; else semCusto = true;
      if (av.some(([, c]) => c === 'texto-perigo')) problemas.push(`Item ${i.numero_item}: ${av.map(([t]) => t).join(', ')}`);
    }
    kItens.textContent = `${n} de ${linhas.length}`;
    kTotal.textContent = total ? brl(total) : '—';
    kExtenso.textContent = total ? `(${reaisPorExtenso(total)})` : '';
    kMargem.textContent = total && !semCusto ? pct(Math.round(((total * (1 - (imp || 0) / 100) - custo) / total) * 1000) / 10) : '—';
    const faltas = faltasEmpresa(d.cliente);
    render(avisos,
      imp == null ? h('div', { class: 'aviso amarelo pequeno' }, 'Impostos não informados na cotação: a margem aparece sem descontar impostos. ', h('a', { href: `#/cotacao/${op.id}` }, 'Informar na cotação')) : null,
      semPreco ? h('div', { class: 'aviso amarelo pequeno' }, `${semPreco} item(ns) incluído(s) sem preço.`) : null,
      problemas.length ? h('div', { class: 'aviso vermelho pequeno' }, h('strong', {}, 'Revise antes de enviar: '), h('ul', {}, problemas.map((t) => h('li', {}, t)))) : null,
      faltas.length ? h('div', { class: 'aviso amarelo pequeno' }, `Para a proposta sair completa, preencha no cadastro da empresa: ${faltas.join(', ')}. `,
        d.cliente ? h('a', { href: '#/empresas' }, 'Abrir cadastro') : h('a', { href: '#/kanban' }, 'Vincular empresa no Kanban')) : null);
  };
  for (const l of linhas) { l.preco.addEventListener('input', calcular); l.incluir.addEventListener('change', calcular); }

  const corpo = () => ({
    ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])),
    declaracoes: decl.filter((x) => x.cb.checked).map((x) => x.k),
    itens: linhas.map((l) => ({ numero_item: l.i.numero_item, incluir: l.incluir.checked, preco_unitario: l.preco.value.trim() === '' ? null : String(lerNum(l.preco.value)), marca: l.marca.value, modelo: l.modelo.value })),
  });
  const salvar = async ({ silencioso = false } = {}) => {
    try { d = await api(`/kanban/${id}/proposta`, { metodo: 'PUT', corpo: corpo() }); if (!silencioso) toast('Proposta salva.'); return true; }
    catch (e) { toast(e.message, 6000); return false; }
  };
  const status = async (s, pergunta) => {
    if (pergunta && !confirmar(pergunta)) return;
    if (!(await salvar({ silencioso: true }))) return;
    try { await api(`/kanban/${id}/proposta/status`, { metodo: 'PATCH', corpo: { status: s } }); toast(`Proposta: ${d.status[s]}.`); proposta(alvo, rota, est); }
    catch (e) { toast(e.message, 6000); }
  };
  const imprimir = async () => {
    if (editar && !(await salvar({ silencioso: true }))) return;
    imprimirProposta(await api(`/kanban/${id}/proposta`));
  };

  const tabela = h('div', { class: 'rolagem-x' }, h('table', { class: 'tabela tabela-proposta' },
    h('thead', {}, h('tr', {}, ['Incluir', 'Item', 'Descrição', 'Qtd.', 'Estimado unit.', 'Custo unit.', 'Preço mínimo', 'Seu preço unit.', 'Total', 'Margem líquida', 'Marca / modelo'].map((t) => h('th', {}, t)))),
    h('tbody', {}, linhas.map((l) => h('tr', {},
      h('td', {}, l.incluir), h('td', {}, l.i.numero_item),
      h('td', { class: 'desc', title: l.i.descricao || '' }, (l.i.descricao || '—').length > 140 ? `${l.i.descricao.slice(0, 140)}…` : l.i.descricao || '—'),
      h('td', { class: 'num' }, qtdTxt(l.i)),
      h('td', { class: 'num' }, l.i.orcamento_sigiloso ? 'Sigiloso' : brl(l.i.estimado_unitario)),
      h('td', { class: 'num' }, l.i.custo_unitario == null ? h('span', { class: 'suave' }, 'sem cotação') : brl(l.i.custo_unitario)),
      h('td', { class: 'num' }, brl(l.i.preco_minimo)),
      h('td', {}, l.preco, l.aviso), l.total, l.margem,
      h('td', { class: 'marca-modelo' }, l.marca, l.modelo))))));

  render(alvo,
    cabecalho('Proposta de preços', op.objeto,
      h('span', { class: `etiqueta ${ST_COR[p.status]}` }, d.status[p.status]),
      h('a', { class: 'btn', href: `#/cotacao/${op.id}` }, '💲 Cotações'),
      h('button', { class: 'btn', onclick: imprimir }, '🖨 Imprimir / PDF')),
    faixaGoverno(op),
    h('div', { class: 'cartao pequeno' },
      h('div', {}, h('strong', {}, op.orgao_nome || 'Órgão não informado'), op.unidade_nome && op.unidade_nome !== op.orgao_nome ? ` · ${op.unidade_nome}` : '', [op.municipio, op.uf].filter(Boolean).length ? ` · ${[op.municipio, op.uf].filter(Boolean).join('/')}` : ''),
      h('div', {}, [op.modalidade_nome, numeroLic(op) ? `nº ${numeroLic(op)}` : null].filter(Boolean).join(' '), op.processo ? ` · Processo ${op.processo}` : '',
        ' · ', op.data_encerramento_proposta ? h('strong', {}, `Propostas até ${data(op.data_encerramento_proposta)}`) : 'Prazo das propostas não informado',
        ' · ', h('a', { href: `#/licitacao/${op.licitacao_id}` }, 'Abrir licitação')),
      h('div', {}, `Empresa: ${d.cliente ? `${d.cliente.razao_social} · CNPJ ${fmtCnpj(d.cliente.cnpj)}` : 'nenhuma vinculada'}`,
        p.enviada_em ? h('span', { class: 'suave' }, ` · enviada no portal em ${dataUtc(p.enviada_em)}`) : '')),
    h('div', { class: 'kpis' },
      h('div', { class: 'cartao kpi' }, h('div', { class: 'rotulo' }, 'Valor total da proposta'), kTotal, kExtenso),
      h('div', { class: 'cartao kpi' }, h('div', { class: 'rotulo' }, 'Itens na proposta'), kItens),
      h('div', { class: 'cartao kpi', title: 'Depois dos impostos informados na cotação e do custo (fornecedor + frete).' }, h('div', { class: 'rotulo' }, 'Margem líquida da proposta'), kMargem)),
    avisos,
    h('div', { class: 'cartao' }, h('h2', {}, 'Itens'),
      h('p', { class: 'suave pequeno' }, 'O preço vem sugerido pelo preço mínimo de venda da cotação (arredondado para cima no centavo). Ajuste à sua estratégia: acima do estimado o órgão costuma desclassificar.'),
      tabela),
    h('div', { class: 'cartao' }, h('h2', {}, 'Condições'),
      h('div', { class: 'filtros' },
        h('div', {}, h('label', {}, 'Validade (dias)'), f.validade_dias),
        h('div', { class: 'largo' }, h('label', {}, 'Prazo de entrega'), f.prazo_entrega),
        h('div', { class: 'largo' }, h('label', {}, 'Condições de pagamento'), f.condicoes_pagamento),
        h('div', { class: 'largo' }, h('label', {}, 'Local de entrega'), f.local_entrega),
        h('div', { class: 'largo' }, h('label', {}, 'Garantia'), f.garantia)),
      h('div', { class: 'campo' }, h('label', {}, 'Observações'), f.observacoes),
      h('h3', {}, 'Declarações (marque as que o edital pede)'),
      h('div', { class: 'declaracoes' }, decl.map((x) => h('label', { class: 'opcao-check' }, x.cb, ' ', x.t)))),
    editar ? h('div', { class: 'linha acoes-proposta' },
      h('button', { class: 'btn primario', onclick: async () => { if (await salvar()) proposta(alvo, rota, est); } }, 'Salvar'),
      p.status !== 'pronta' && p.status !== 'enviada' ? h('button', { class: 'btn', onclick: () => status('pronta') }, '✓ Marcar como pronta') : null,
      p.status !== 'enviada' ? h('button', { class: 'btn', onclick: () => status('enviada', 'Você já enviou esta proposta no portal do governo? O sistema não envia sozinho; isto só registra o envio.') }, '📤 Registrar envio no portal') : null,
      p.status === 'enviada' || p.status === 'cancelada' ? h('button', { class: 'btn', onclick: () => status('rascunho') }, 'Voltar para rascunho') : null,
      p.status !== 'cancelada' ? h('button', { class: 'btn perigo', onclick: () => status('cancelada', 'Cancelar esta proposta?') }, 'Cancelar proposta') : null) : null,
    h('p', { class: 'suave pequeno' }, 'A proposta é um documento para você conferir, assinar e enviar no portal. O sistema não envia propostas nem dá lances sozinho.'));
  calcular();
}

// ---------- Impressão (A4) ----------
const dataExtenso = (d = new Date()) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

export function imprimirProposta(d) {
  const janela = window.open('', '_blank');
  if (!janela) return toast('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.', 7000);
  const op = d.oportunidade; const c = d.cliente || {}; const p = d.proposta;
  const NI = '<span class="ni">não informado</span>';
  const v = (x) => (x ? esc(x) : NI);
  const gov = identificacaoGoverno(op);
  const itens = d.itens.filter((i) => i.incluir);
  const total = itens.reduce((s, i) => s + (i.preco_unitario != null && i.quantidade != null ? i.preco_unitario * i.quantidade : 0), 0);
  const marca = (i) => [i.marca, i.modelo].filter(Boolean).map(esc).join(' / ') || NI;
  const linhas = itens.map((i) => `<tr>
    <td class="c">${esc(i.numero_item)}</td><td class="desc">${esc(i.descricao || '—')}</td><td>${marca(i)}</td>
    <td class="c">${esc(i.unidade_medida || '—')}</td><td class="n">${esc(i.quantidade != null ? String(i.quantidade).replace('.', ',') : '—')}</td>
    <td class="n">${i.preco_unitario != null ? brl(i.preco_unitario) : NI}</td><td class="n">${i.preco_unitario != null && i.quantidade != null ? brl(i.preco_unitario * i.quantidade) : '—'}</td></tr>`).join('');
  const cond = [
    ['Validade da proposta', p.validade_dias ? `${p.validade_dias} (${inteiroPorExtenso(p.validade_dias)}) dias, a contar da data de sua apresentação` : null],
    ['Prazo de entrega', p.prazo_entrega], ['Local de entrega', p.local_entrega], ['Condições de pagamento', p.condicoes_pagamento],
    ['Garantia', p.garantia], ['Observações', p.observacoes],
  ].filter(([, x]) => x).map(([r, x]) => `<div><b>${esc(r)}:</b> ${esc(x)}</div>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Proposta de preços · ${esc(c.razao_social || '')} · ${esc(numeroLic(op) || '')}</title>
<style>
@page { size: A4 portrait; margin: 16mm 14mm; }
* { box-sizing: border-box; } body { font: 10.5pt/1.4 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
.barra { position: sticky; top: 0; background: #0f3d6e; color: #fff; padding: 8px 14px; display: flex; gap: 12px; align-items: center; }
.barra button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; cursor: pointer; }
.pagina { max-width: 182mm; margin: 0 auto; padding: 10px 0; }
.empresa { border-bottom: 2px solid #0f3d6e; padding-bottom: 6px; margin-bottom: 10px; }
.empresa .nome { font-size: 13pt; font-weight: 700; } .empresa div { font-size: 9.5pt; }
.dest div { margin: 1px 0; } h1 { text-align: center; font-size: 14pt; letter-spacing: .06em; margin: 14px 0 8px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9pt; } th, td { border: 1px solid #999; padding: 4px 5px; vertical-align: top; }
th { background: #eef2f7; text-align: left; } td.n { text-align: right; white-space: nowrap; } td.c { text-align: center; } td.desc { width: 44%; }
tfoot td { font-weight: 700; background: #f6f8fb; }
.global { border: 1px solid #0f3d6e; padding: 6px 8px; margin: 8px 0; } .bloco { margin: 10px 0; } .bloco h2 { font-size: 10.5pt; margin: 0 0 4px; }
.ni { color: #b42318; font-style: italic; } .decl li { margin-bottom: 3px; }
.assin { margin-top: 36px; text-align: center; } .assin .linha { border-top: 1px solid #111; width: 70%; margin: 0 auto 4px; }
@media print { .barra { display: none; } .pagina { padding: 0; } tr { page-break-inside: avoid; } }
</style></head><body>
<div class="barra"><button id="btn-imprimir">🖨 Imprimir / salvar em PDF</button><span>Confira tudo antes de assinar e enviar no portal. Em vermelho: dado não informado.</span></div>
<div class="pagina">
<div class="empresa"><div class="nome">${v(c.razao_social)}</div>
<div>CNPJ ${c.cnpj ? esc(fmtCnpj(c.cnpj)) : NI} · ${v(c.endereco)} · CEP ${v(c.cep)} · ${v([c.municipio, c.uf].filter(Boolean).join('/'))}</div>
<div>Telefone ${v(c.telefone)} · E-mail ${v(c.email)}</div></div>
<div class="dest">
<div>Ao(À) <b>${v(op.orgao_nome)}</b>${op.unidade_nome && op.unidade_nome !== op.orgao_nome ? ` · ${esc(op.unidade_nome)}` : ''}</div>
<div>${esc([op.modalidade_nome, numeroLic(op) ? `nº ${numeroLic(op)}` : null].filter(Boolean).join(' '))}${gov.uasg ? ` · UASG ${esc(gov.uasg)}` : ''}${op.processo ? ` · Processo ${esc(op.processo)}` : ''}</div>
</div>
<h1>PROPOSTA DE PREÇOS</h1>
<div><b>Objeto:</b> ${v(op.objeto)}</div>
<table><thead><tr><th>Item</th><th>Descrição</th><th>Marca / modelo</th><th>Un.</th><th>Qtd.</th><th>Valor unit.</th><th>Valor total</th></tr></thead>
<tbody>${linhas}</tbody><tfoot><tr><td colspan="6">VALOR GLOBAL DA PROPOSTA</td><td class="n">${brl(total)}</td></tr></tfoot></table>
<div class="global"><b>Valor global:</b> ${brl(total)} (${esc(reaisPorExtenso(total))}).</div>
<div class="bloco">${cond}</div>
<div class="bloco"><h2>Dados bancários</h2><div>Banco ${v(c.banco)} · Agência ${v(c.agencia)} · Conta corrente ${v(c.conta)}</div></div>
${p.declaracoes.length ? `<div class="bloco"><h2>Declarações</h2><ul class="decl">${p.declaracoes.map((k) => `<li>${esc(d.declaracoes[k])}</li>`).join('')}</ul></div>` : ''}
<div class="bloco">${esc([c.municipio, c.uf].filter(Boolean).join('/') || '')}${c.municipio ? ', ' : ''}${esc(dataExtenso())}.</div>
<div class="assin"><div class="linha"></div><div><b>${v(c.resp_nome)}</b></div><div>${v(c.resp_cargo)} · CPF ${v(c.resp_cpf)}</div><div>${v(c.razao_social)}</div></div>
</div></body></html>`;
  janela.document.open(); janela.document.write(html); janela.document.close();
  // A política de segurança do site bloqueia script dentro da página impressa: o botão e a impressão são ligados daqui
  janela.document.getElementById('btn-imprimir').addEventListener('click', () => { janela.focus(); janela.print(); });
}

// ---------- Lista (menu Propostas) ----------
export async function propostas(alvo, rota, est) {
  render(alvo, carregando());
  const status = rota.query.get('status') || 'todas';
  const d = await api(`/propostas${qs({ status })}`);
  const total = Object.values(d.contagem).reduce((a, b) => a + b, 0);
  const aba = (v, rot, n) => h('a', { class: `btn pequeno ${status === v ? 'primario' : ''}`, href: `#/propostas${qs({ status: v })}` }, `${rot}${n != null ? ` (${n})` : ''}`);
  const dias = (iso) => (iso ? (Date.parse(`${String(iso).replace(' ', 'T').slice(0, 19)}-03:00`) - Date.now()) / 86400000 : null);
  render(alvo,
    cabecalho('Propostas', 'Propostas de preços montadas a partir das cotações. Para criar, abra a cotação de uma oportunidade e clique em "📝 Montar proposta".'),
    h('div', { class: 'linha', style: { margin: '0 0 12px' } },
      aba('todas', 'Todas', total), aba('rascunho', 'Rascunho', d.contagem.rascunho), aba('pronta', 'Prontas', d.contagem.pronta),
      aba('enviada', 'Enviadas', d.contagem.enviada), aba('cancelada', 'Canceladas', d.contagem.cancelada)),
    d.propostas.length ? h('div', { class: 'lista-pedidos-cotacao' }, d.propostas.map((p) => {
      const dd = dias(p.data_encerramento_proposta);
      return h('div', { class: 'cartao pedido-cotacao' },
        h('div', { class: 'linha', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
          h('div', {}, h('span', { class: `etiqueta ${ST_COR[p.status]} pequena` }, { rascunho: 'Rascunho', pronta: 'Pronta para enviar', enviada: 'Enviada no portal', cancelada: 'Cancelada' }[p.status]), ' ',
            h('strong', {}, p.total != null ? brl(p.total) : 'sem total'), h('span', { class: 'suave' }, ` · ${p.itens} item(ns)${p.sem_preco ? ` · ${p.sem_preco} sem preço` : ''}`)),
          h('span', { class: 'etiqueta empresa' }, `🏢 ${p.cliente_nome || 'Sem empresa'}`)),
        faixaGoverno(p, { compacta: true }),
        h('div', { class: 'pequeno', style: { marginTop: '6px' } }, h('a', { href: `#/licitacao/${p.licitacao_id}` }, [p.modalidade_nome, numeroLic(p) ? `nº ${numeroLic(p)}` : null, p.orgao_nome].filter(Boolean).join(' · '))),
        p.objeto ? h('div', { class: 'suave pequeno' }, p.objeto.length > 160 ? `${p.objeto.slice(0, 160)}…` : p.objeto) : null,
        h('div', { class: 'pequeno' }, dd == null ? h('span', { class: 'suave' }, 'Prazo das propostas não informado')
          : h('span', { class: dd < 0 ? 'suave' : dd <= 3 ? 'texto-perigo' : 'suave' }, `Propostas até ${data(p.data_encerramento_proposta)}${dd < 0 ? ' (encerrado)' : dd <= 3 ? ` (faltam ${Math.max(0, Math.ceil(dd))} dia(s))` : ''}`),
          p.enviada_em ? h('span', { class: 'suave' }, ` · enviada em ${dataUtc(p.enviada_em)}`) : ''),
        h('div', { class: 'linha', style: { marginTop: '10px' } }, h('a', { class: 'btn pequeno primario', href: `#/proposta/${p.oportunidade_id}` }, '📝 Abrir proposta')));
    })) : vazio(status === 'todas' ? 'Nenhuma proposta ainda. Abra a cotação de uma oportunidade e clique em "📝 Montar proposta".' : 'Nenhuma proposta nesta situação.'));
}
