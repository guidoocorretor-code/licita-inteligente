// Fase 5: Financeiro (honorários da assessoria e lucro real por contrato) e Relatórios.
// Tudo vem do banco. Valor não informado aparece como "não informado", nunca como zero.
import { api, qs } from './api.js';
import { h, moeda, numero, data, toast, carregando, erroBox, vazio, modal, render, naoInformado } from './ui.js';
import { cabecalho, avisoEmpresa, comSenhaAdmin } from './paginas.js';
import { lerPeriodo, barraPeriodo } from './painel.js';

const podeFinanceiro = (est) => ['superadmin', 'admin', 'gestor'].includes(est.usuario.papel);
const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const hojeIso = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const SITUACAO = { a_vencer: ['A vencer', 'azul'], vencida: ['Vencida', 'vermelha'], paga: ['Recebida', 'verde'], cancelada: ['Cancelada', ''] };
const ORIGEM_RECEITA = { recebido: 'valor recebido', nota: 'valor da nota', empenho: 'valor do empenho', ganho: 'valor ganho', proposta: 'valor da proposta', edital: 'estimado do edital' };
const kpi = (rot, valor, apoio, cls = '') => h('div', { class: `cartao kpi ${cls}` }, h('div', { class: 'suave pequeno' }, rot), h('div', { class: 'valor' }, valor), apoio ? h('div', { class: 'suave pequeno' }, apoio) : null);
const pctBr = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);

const abas = (ativa) => h('div', { class: 'abas', role: 'tablist' },
  [['honorarios', 'Honorários da assessoria'], ['lucro', 'Lucro por contrato']].map(([k, rot]) =>
    h('button', { class: ativa === k ? 'ativo' : '', role: 'tab', 'aria-selected': String(ativa === k), onclick: () => { location.hash = `#/financeiro/${k}`; } }, rot)));

/** Planilha CSV (abre no Excel em pt-BR: ";" e BOM). */
export function baixarCsv(nome, blocos) {
  const esc = (v) => { const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = blocos.flatMap(([titulo, cab, rows]) => [titulo ? [titulo] : null, cab, ...rows, []].filter(Boolean)).map((l) => l.map(esc).join(';'));
  const url = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: nome }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const semPermissao = (alvo) => render(alvo, cabecalho('Financeiro'), h('div', { class: 'aviso amarelo' }, 'O Financeiro é restrito a administradores e gestores.'));

export async function financeiro(alvo, rota, est) {
  const aba = rota.args[0] || 'honorarios';
  if (aba === 'custos') return custosDoCard(alvo, rota, est);
  if (!podeFinanceiro(est)) return semPermissao(alvo);
  return aba === 'lucro' ? lucro(alvo, rota, est) : honorarios(alvo, rota, est);
}

// ============================ HONORÁRIOS ============================
function formContrato(c, aoSalvar) {
  const campo = (rot, el, ajuda) => h('div', { class: 'campo' }, h('label', {}, rot), el, ajuda ? h('div', { class: 'suave pequeno' }, ajuda) : null);
  const mens = h('input', { type: 'number', min: 0, step: '0.01', value: c.mensalidade ?? '', placeholder: 'Ex.: 800,00' });
  const dia = h('input', { type: 'number', min: 1, max: 31, value: c.dia_vencimento ?? '', placeholder: 'Ex.: 10' });
  const pct = h('input', { type: 'number', min: 0, max: 100, step: '0.01', value: c.percentual_exito ?? '', placeholder: 'Ex.: 3' });
  const prazo = h('input', { type: 'number', min: 0, max: 120, value: c.prazo_exito_dias ?? 5 });
  const ini = h('input', { type: 'date', value: c.inicio || '' });
  const fim = h('input', { type: 'date', value: c.fim || '' });
  const obs = h('textarea', { rows: 2 }, c.observacoes || '');
  modal(`Honorários · ${c.cliente_nome}`, h('div', {},
    h('p', { class: 'suave pequeno' }, 'Preencha o que foi combinado com a empresa: só mensalidade, só êxito ou os dois. As cobranças são geradas a partir daqui.'),
    h('div', { class: 'grade duas' }, campo('Mensalidade (R$)', mens), campo('Dia do vencimento', dia, 'Em mês mais curto, vence no último dia.')),
    h('div', { class: 'grade duas' }, campo('Êxito (% sobre o valor recebido do órgão)', pct), campo('Êxito vence quantos dias após o órgão pagar', prazo)),
    h('div', { class: 'grade duas' }, campo('Início do contrato', ini), campo('Fim (deixe vazio se vigente)', fim)),
    campo('Observações', obs)),
  [{ texto: 'Salvar', classe: 'primario', acao: async () => {
    try {
      await api(`/financeiro/contratos/${c.cliente_id}`, { metodo: 'PUT', corpo: { mensalidade: mens.value, dia_vencimento: dia.value, percentual_exito: pct.value, prazo_exito_dias: prazo.value, inicio: ini.value, fim: fim.value, observacoes: obs.value } });
      toast('Contrato salvo. Cobranças atualizadas.'); aoSalvar(); return true;
    } catch (e) { toast(e.message, 5000); return false; }
  } }]);
}

function receber(c, formas, aoSalvar) {
  const dt = h('input', { type: 'date', value: hojeIso() });
  const valor = h('input', { type: 'number', min: 0, step: '0.01', value: c.valor });
  const forma = h('select', {}, h('option', { value: '' }, 'Forma (opcional)'), Object.entries(formas).map(([k, v]) => h('option', { value: k }, v)));
  modal('Registrar recebimento', h('div', {},
    h('p', {}, h('strong', {}, c.cliente_nome), ` · ${c.descricao || ''} · vencimento ${dataBr(c.vencimento)}`),
    h('div', { class: 'grade tres' }, h('div', { class: 'campo' }, h('label', {}, 'Data do pagamento'), dt), h('div', { class: 'campo' }, h('label', {}, 'Valor recebido (R$)'), valor), h('div', { class: 'campo' }, h('label', {}, 'Forma'), forma))),
  [{ texto: 'Registrar', classe: 'primario', acao: async () => {
    try { await api(`/financeiro/cobrancas/${c.id}`, { metodo: 'PATCH', corpo: { pago_em: dt.value, valor_pago: valor.value, forma_pagamento: forma.value || null } }); toast('Recebimento registrado.'); aoSalvar(); return true; }
    catch (e) { toast(e.message, 5000); return false; }
  } }]);
}

function novaAvulsa(contratos, aoSalvar) {
  const cli = h('select', {}, h('option', { value: '' }, 'Escolha a empresa'), contratos.map((c) => h('option', { value: c.cliente_id }, c.cliente_nome)));
  const desc = h('input', { placeholder: 'Ex.: Cadastro no SICAF, recurso administrativo' });
  const valor = h('input', { type: 'number', min: 0, step: '0.01' });
  const venc = h('input', { type: 'date', value: hojeIso() });
  modal('Cobrança avulsa', h('div', {},
    h('div', { class: 'campo' }, h('label', {}, 'Empresa'), cli), h('div', { class: 'campo' }, h('label', {}, 'Descrição'), desc),
    h('div', { class: 'grade duas' }, h('div', { class: 'campo' }, h('label', {}, 'Valor (R$)'), valor), h('div', { class: 'campo' }, h('label', {}, 'Vencimento'), venc))),
  [{ texto: 'Criar', classe: 'primario', acao: async () => {
    try { await api('/financeiro/cobrancas', { metodo: 'POST', corpo: { cliente_id: cli.value, descricao: desc.value, valor: valor.value, vencimento: venc.value } }); toast('Cobrança criada.'); aoSalvar(); return true; }
    catch (e) { toast(e.message, 5000); return false; }
  } }]);
}

async function honorarios(alvo, rota, est) {
  render(alvo, carregando());
  const per = lerPeriodo(rota.query);
  const filtro = rota.query.get('sit') || '';
  const barra = barraPeriodo(per, null, { destino: '#/financeiro/honorarios', explica: 'Previsto e em aberto contam pelo vencimento; Recebido conta pela data do pagamento.', tudo: 'Mostrando todas as cobranças.' });
  let r;
  try { r = await api(`/financeiro/honorarios${qs({ de: per.de, ate: per.ate })}`); }
  catch (e) { render(alvo, cabecalho('Financeiro'), abas('honorarios'), barra, erroBox(e)); return; }
  const recarregar = () => honorarios(alvo, rota, est);
  const t = r.total;
  const cobs = r.cobrancas.filter((c) => !filtro || (filtro === 'aberto' ? ['a_vencer', 'vencida'].includes(c.situacao) : c.situacao === filtro));
  const acoes = (c) => {
    if (c.situacao === 'cancelada') return h('span', { class: 'suave pequeno', title: c.cancelamento_motivo || '' }, `Motivo: ${c.cancelamento_motivo || '—'}`);
    if (c.situacao === 'paga') return h('div', { class: 'linha' }, h('span', { class: 'pequeno suave' }, `${dataBr(c.pago_em)}${c.forma_pagamento ? ` · ${r.formas[c.forma_pagamento] || c.forma_pagamento}` : ''}`),
      h('button', { class: 'btn pequeno', onclick: async () => {
        try { await comSenhaAdmin((extra) => api(`/financeiro/cobrancas/${c.id}/desfazer-pagamento`, { metodo: 'POST', corpo: { ...extra } }),
          'Desfazer um recebimento muda o caixa. Um administrador precisa digitar a senha dele.', 'Fica registrado na auditoria com o nome do administrador.'); toast('Recebimento desfeito.'); recarregar(); }
        catch (e) { toast(e.message, 5000); }
      } }, 'Desfazer'));
    return h('div', { class: 'linha' },
      h('button', { class: 'btn pequeno primario', onclick: () => receber(c, r.formas, recarregar) }, 'Receber'),
      h('button', { class: 'btn pequeno', onclick: () => {
        const m = h('input', { placeholder: 'Motivo do cancelamento' });
        modal('Cancelar cobrança', h('div', {}, h('p', {}, `${c.cliente_nome} · ${c.descricao || ''} · ${moeda(c.valor)}`), m),
          [{ texto: 'Cancelar cobrança', classe: 'perigo', acao: async () => { try { await api(`/financeiro/cobrancas/${c.id}/cancelar`, { metodo: 'POST', corpo: { motivo: m.value } }); recarregar(); return true; } catch (e) { toast(e.message, 5000); return false; } } }]);
      } }, 'Cancelar'));
  };
  const semContrato = r.contratos.filter((c) => !c.contrato_id).length;
  render(alvo, avisoEmpresa(est, 'Honorários'),
    cabecalho('Financeiro', 'O que a assessoria tem a receber das empresas e o lucro de cada contrato ganho.',
      h('button', { class: 'btn', onclick: () => novaAvulsa(r.contratos, recarregar) }, '+ Cobrança avulsa'),
      h('button', { class: 'btn', onclick: () => baixarCsv(`honorarios-${per.de || 'tudo'}.csv`, [['Honorários da assessoria', ['Vencimento', 'Empresa', 'Tipo', 'Descrição', 'Valor (R$)', 'Situação', 'Pago em', 'Valor pago (R$)', 'Forma'],
        cobs.map((c) => [dataBr(c.vencimento), c.cliente_nome, r.tipos[c.tipo] || c.tipo, c.descricao, c.valor, SITUACAO[c.situacao][0], dataBr(c.pago_em), c.valor_pago, r.formas[c.forma_pagamento] || ''])]]) }, '⬇ Planilha')),
    abas('honorarios'), barra,
    h('div', { class: 'grade kpis' },
      kpi('Previsto no período', moeda(t.previsto), 'Mensalidades, êxitos e avulsas que vencem no período'),
      kpi('Recebido', moeda(t.recebido), 'Pagamentos registrados no período', 'ok'),
      kpi('Em aberto', moeda(t.em_aberto), 'Ainda não pago'),
      kpi('Vencido', moeda(t.vencido), t.n_vencidas ? `${t.n_vencidas} cobrança(s) atrasada(s): cobre a empresa` : 'Nada atrasado', t.vencido ? 'perigo' : '')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Contrato de cada empresa'),
      semContrato ? h('p', { class: 'suave pequeno' }, `${semContrato} empresa(s) sem contrato de honorários cadastrado: sem contrato, nenhuma cobrança é gerada.`) : null,
      r.contratos.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Empresa', 'Mensalidade', 'Êxito', 'Vigência', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, r.contratos.map((c) => h('tr', {},
          h('td', {}, c.cliente_nome),
          h('td', {}, c.mensalidade ? `${moeda(c.mensalidade)} · dia ${c.dia_vencimento}` : c.contrato_id ? '—' : naoInformado('Sem contrato')),
          h('td', {}, c.percentual_exito ? `${pctBr(c.percentual_exito)} do recebido · vence ${c.prazo_exito_dias} dia(s) depois` : '—'),
          h('td', {}, c.inicio ? `${dataBr(c.inicio)} a ${c.fim ? dataBr(c.fim) : 'hoje'}` : '—'),
          h('td', {}, h('button', { class: 'btn pequeno', onclick: () => formContrato(c, recarregar) }, c.contrato_id ? 'Editar' : 'Cadastrar contrato')))))))
        : vazio('Cadastre as empresas assessoradas primeiro.')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('div', { class: 'linha', style: { justifyContent: 'space-between' } }, h('h2', {}, 'Cobranças'),
        h('select', { 'aria-label': 'Situação', style: { width: 'auto' }, onchange: (e) => { const q = new URLSearchParams(rota.query); if (e.target.value) q.set('sit', e.target.value); else q.delete('sit'); location.hash = `#/financeiro/honorarios?${q}`; } },
          [['', 'Todas'], ['aberto', 'Em aberto'], ['vencida', 'Vencidas'], ['paga', 'Recebidas'], ['cancelada', 'Canceladas']].map(([v, t2]) => h('option', { value: v, selected: v === filtro }, t2)))),
      cobs.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Vencimento', 'Empresa', 'Tipo', 'Descrição', 'Valor', 'Situação', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, cobs.map((c) => h('tr', {},
          h('td', { style: { whiteSpace: 'nowrap' } }, dataBr(c.vencimento)), h('td', {}, c.cliente_nome), h('td', {}, r.tipos[c.tipo] || c.tipo),
          h('td', {}, c.descricao || '', c.tipo === 'exito' && c.base_valor != null ? h('div', { class: 'suave pequeno' }, `sobre ${moeda(c.base_valor)} recebidos do órgão`) : null),
          h('td', { style: { whiteSpace: 'nowrap' } }, moeda(c.valor), c.valor_pago != null && c.valor_pago !== c.valor ? h('div', { class: 'suave pequeno' }, `pago ${moeda(c.valor_pago)}`) : null),
          h('td', {}, h('span', { class: `etiqueta ${SITUACAO[c.situacao][1]}` }, SITUACAO[c.situacao][0])),
          h('td', {}, acoes(c)))))))
        : vazio(r.contratos.some((c) => c.contrato_id) ? 'Nenhuma cobrança com esse filtro.' : 'Cadastre o contrato de honorários de uma empresa para gerar as cobranças.')));
}

// ============================ LUCRO POR CONTRATO ============================
const somaCustos = (cat, custos) => Object.entries(custos).map(([k, v]) => `${cat[k] || k}: ${moeda(v)}`).join(' · ');

async function lucro(alvo, rota, est) {
  render(alvo, carregando());
  const per = lerPeriodo(rota.query);
  const barra = barraPeriodo(per, null, { destino: '#/financeiro/lucro', explica: 'Cada contrato conta pela data da etapa em que está (Recebido pela data do pagamento, Nota pela data da nota…).', tudo: 'Mostrando todos os contratos ganhos.' });
  let r;
  try { r = await api(`/financeiro/lucro${qs({ de: per.de, ate: per.ate })}`); }
  catch (e) { render(alvo, cabecalho('Financeiro'), abas('lucro'), barra, erroBox(e)); return; }
  const t = r.total;
  render(alvo, avisoEmpresa(est, 'Contratos'),
    cabecalho('Financeiro', 'Lucro real = o que o órgão paga menos tudo o que a empresa gastou para entregar.',
      h('button', { class: 'btn', onclick: () => baixarCsv(`lucro-contratos-${per.de || 'tudo'}.csv`, [linhasLucroCsv(r)]) }, '⬇ Planilha')),
    abas('lucro'), barra,
    t.sem_custo ? h('div', { class: 'aviso amarelo' }, `${t.sem_custo} contrato(s) sem nenhum custo lançado: o lucro deles fica em branco (receita não é lucro). Abra o contrato e lance os custos.`) : null,
    r.fora_sem_data ? h('div', { class: 'aviso amarelo' }, `${r.fora_sem_data} contrato(s) sem a data da etapa ficaram fora do período: complete no Kanban.`) : null,
    h('div', { class: 'grade kpis' },
      kpi('Receita (contratos com custo)', moeda(t.receita), `${numero(t.n - t.sem_custo)} de ${numero(t.n)} contrato(s)`),
      kpi('Custos', moeda(t.custos), 'Lançados nos cards + honorário de êxito'),
      kpi('Lucro', moeda(t.lucro), t.margem_pct != null ? `Margem ${pctBr(t.margem_pct)}` : null, t.lucro < 0 ? 'perigo' : 'ok'),
      kpi('Lucro já recebido', moeda(t.lucro_realizado), 'Só contratos em "Recebido"')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Contratos ganhos'),
      r.contratos.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Empresa', 'Contrato', 'Etapa', 'Receita', 'Custos', 'Lucro', 'Margem'].map((x) => h('th', {}, x)))),
        h('tbody', {}, r.contratos.map((c) => h('tr', {},
          h('td', {}, c.cliente_nome || naoInformado('Sem empresa')),
          h('td', {}, h('a', { href: `#/financeiro/custos/${c.oportunidade_id}` }, (c.objeto || 'Licitação').slice(0, 110)), h('div', { class: 'suave pequeno' }, [c.orgao_nome, c.local].filter(Boolean).join(' · '))),
          h('td', {}, c.etapa, c.data ? h('div', { class: 'suave pequeno' }, dataBr(c.data)) : null),
          h('td', { style: { whiteSpace: 'nowrap' } }, c.receita != null ? moeda(c.receita) : naoInformado(), c.receita_origem ? h('div', { class: 'suave pequeno' }, ORIGEM_RECEITA[c.receita_origem]) : null),
          h('td', {}, c.total_custos != null ? [moeda(c.total_custos), h('div', { class: 'suave pequeno' }, somaCustos(r.categorias, c.custos))] : h('a', { href: `#/financeiro/custos/${c.oportunidade_id}` }, 'Lançar custos')),
          h('td', { style: { whiteSpace: 'nowrap', fontWeight: 600, color: c.lucro < 0 ? 'var(--perigo)' : null } }, c.lucro != null ? moeda(c.lucro) : '—'),
          h('td', {}, pctBr(c.margem_pct)))))))
        : vazio('Nenhum contrato ganho no período. Contratos são os cards de "Vencida" em diante no Kanban.')));
}

export function linhasLucroCsv(r) {
  return ['Lucro por contrato', ['Empresa', 'Objeto', 'Órgão', 'Etapa', 'Data da etapa', 'Receita (R$)', 'Receita pelo', ...Object.values(r.categorias).map((c) => `${c} (R$)`), 'Total custos (R$)', 'Lucro (R$)', 'Margem (%)'],
    r.contratos.map((c) => [c.cliente_nome, c.objeto, c.orgao_nome, c.etapa, dataBr(c.data), c.receita, ORIGEM_RECEITA[c.receita_origem] || '',
      ...Object.keys(r.categorias).map((k) => c.custos[k] ?? ''), c.total_custos, c.lucro, c.margem_pct])];
}

// ============================ CUSTOS DE UM CONTRATO ============================
async function custosDoCard(alvo, rota, est) {
  const id = Number(rota.args[1]);
  render(alvo, carregando());
  let r;
  try { r = await api(`/kanban/${id}/custos`); } catch (e) { render(alvo, cabecalho('Custos do contrato'), erroBox(e)); return; }
  const recarregar = () => custosDoCard(alvo, rota, est);
  const lancar = async (corpo) => { try { await api(`/kanban/${id}/custos`, { metodo: 'POST', corpo }); toast('Custo lançado.'); recarregar(); } catch (e) { toast(e.message, 5000); } };
  const k = r.contrato;
  const cat = h('select', {}, Object.entries(r.categorias).map(([v, t]) => h('option', { value: v }, t)));
  const desc = h('input', { placeholder: 'Ex.: NF do fornecedor 1234' });
  const valor = h('input', { type: 'number', min: 0, step: '0.01', placeholder: 'R$' });
  const dt = h('input', { type: 'date' });
  const s = r.sugestao;
  const impostoSobreReceita = s?.impostos_pct != null && k?.receita != null ? Math.round(k.receita * s.impostos_pct) / 100 : null;
  const jaTem = (c) => r.custos.some((x) => x.categoria === c);
  render(alvo,
    cabecalho('Custos e lucro do contrato', r.card.objeto?.slice(0, 160) || '', h('a', { class: 'btn', href: '#/kanban' }, 'Voltar ao Kanban'), podeFinanceiro(est) ? h('a', { class: 'btn', href: '#/financeiro/lucro' }, 'Todos os contratos') : null),
    h('p', { class: 'suave' }, [r.card.cliente_nome && `🏢 ${r.card.cliente_nome}`, r.card.orgao_nome, `Kanban: ${r.card.etapa}`].filter(Boolean).join(' · ')),
    k ? h('div', { class: 'grade kpis' },
      kpi('Receita', k.receita != null ? moeda(k.receita) : 'Não informada', k.receita_origem ? `Pelo ${ORIGEM_RECEITA[k.receita_origem]}${k.realizado ? '' : ' (ainda não recebido)'}` : 'Preencha os valores no card do Kanban'),
      kpi('Custos', k.total_custos != null ? moeda(k.total_custos) : 'Nenhum lançado', k.custos.honorarios ? `Inclui ${moeda(k.custos.honorarios)} de honorário de êxito` : null),
      kpi('Lucro', k.lucro != null ? moeda(k.lucro) : '—', k.lucro == null ? 'Lance os custos para calcular' : null, k.lucro < 0 ? 'perigo' : 'ok'),
      kpi('Margem', pctBr(k.margem_pct)))
      : h('div', { class: 'aviso amarelo' }, 'Este card ainda não é um contrato ganho (Vencida em diante). Os custos ficam guardados e entram no lucro quando ele avançar.'),
    s ? h('div', { class: 'aviso azul' }, h('strong', {}, 'Sugestão a partir das cotações. '),
      `Custo dos ${s.itens} item(ns) da proposta: ${moeda(s.produto)} (produto + frete das cotações escolhidas). Confira se a quantidade empenhada é a mesma da proposta antes de lançar. `,
      jaTem('produto') ? h('span', { class: 'suave' }, 'Produto já lançado.') : h('button', { class: 'btn pequeno', onclick: () => lancar({ categoria: 'produto', valor: s.produto, descricao: 'Pelas cotações da proposta', origem: 'cotacoes' }) }, 'Lançar produto'),
      impostoSobreReceita != null ? [' ', jaTem('impostos') ? null : h('button', { class: 'btn pequeno', onclick: () => lancar({ categoria: 'impostos', valor: impostoSobreReceita, descricao: `${pctBr(s.impostos_pct)} sobre a receita (alíquota da cotação)`, origem: 'cotacoes' }) }, `Lançar impostos (${pctBr(s.impostos_pct)} = ${moeda(impostoSobreReceita)})`)] : null)
      : null,
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Custos lançados'),
      r.custos.length || k?.custos?.honorarios ? h('table', {}, h('thead', {}, h('tr', {}, ['Data', 'Categoria', 'Descrição', 'Valor', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, r.custos.map((c) => h('tr', {},
          h('td', {}, c.data ? dataBr(c.data) : '—'), h('td', {}, r.categorias[c.categoria] || c.categoria),
          h('td', {}, c.descricao || '', c.origem === 'cotacoes' ? h('span', { class: 'etiqueta pequena', style: { marginLeft: '6px' } }, 'pelas cotações') : null),
          h('td', {}, moeda(c.valor)),
          h('td', {}, h('button', { class: 'btn pequeno perigo', onclick: async () => { try { await api(`/kanban/${id}/custos/${c.id}`, { metodo: 'DELETE' }); recarregar(); } catch (e) { toast(e.message, 5000); } } }, 'Excluir')))),
        k?.custos?.honorarios ? h('tr', {}, h('td', {}, '—'), h('td', {}, 'Honorários da assessoria (êxito)'), h('td', { class: 'suave' }, 'Automático, pelo contrato de honorários'), h('td', {}, moeda(k.custos.honorarios)), h('td')) : null))
        : vazio('Nenhum custo lançado ainda.'),
      h('form', { class: 'form-custo', onsubmit: (e) => { e.preventDefault(); lancar({ categoria: cat.value, descricao: desc.value, valor: valor.value, data: dt.value || null }); } },
        cat, desc, valor, dt, h('button', { class: 'btn primario', type: 'submit' }, 'Lançar custo'))));
}

// ============================ RELATÓRIOS ============================
export async function relatorios(alvo, rota, est) {
  if (!podeFinanceiro(est)) return render(alvo, cabecalho('Relatórios'), h('div', { class: 'aviso amarelo' }, 'Os relatórios financeiros são restritos a administradores e gestores.'));
  render(alvo, carregando());
  const per = lerPeriodo(rota.query);
  const barra = barraPeriodo(per, null, { destino: '#/relatorios', explica: 'Faturado pela data da nota, recebido pela data do pagamento, honorários pelo vencimento/pagamento.', tudo: 'Mostrando todo o histórico.' });
  let p; let hon; let luc;
  try {
    [p, hon, luc] = await Promise.all([api(`/painel/empresas${qs({ de: per.de, ate: per.ate })}`), api(`/financeiro/honorarios${qs({ de: per.de, ate: per.ate })}`), api(`/financeiro/lucro${qs({ de: per.de, ate: per.ate })}`)]);
  } catch (e) { render(alvo, cabecalho('Relatórios'), barra, erroBox(e)); return; }
  const recebidoOrgao = (e) => e.por_etapa?.filter((x) => x.fase === 'recebida').reduce((s, x) => s + x.valor, 0) ?? 0;
  const lucroDe = (id) => luc.contratos.filter((c) => c.cliente_id === id && c.lucro != null).reduce((s, c) => s + c.lucro, 0);
  const honDe = (id) => hon.por_cliente.find((x) => x.cliente_id === id) || { previsto: 0, recebido: 0, vencido: 0 };
  const empresas = p.empresas.map((e) => ({ nome: e.nome, faturado: e.faturamento?.valor ?? 0, notas: e.faturamento?.n ?? 0, recebido: recebidoOrgao(e), hon: honDe(e.id), lucro: lucroDe(e.id),
    sem_custo: luc.contratos.filter((c) => c.cliente_id === e.id && c.total_custos == null).length }));
  const periodoTxt = per.de || per.ate ? `${dataBr(per.de) || '…'} a ${dataBr(per.ate) || '…'}` : 'Todo o período';
  const csv = () => baixarCsv(`relatorio-${per.de || 'tudo'}.csv`, [
    [`Relatório financeiro · ${periodoTxt}`, ['Empresa', 'Faturado (R$)', 'Notas', 'Recebido do órgão (R$)', 'Honorários previstos (R$)', 'Honorários recebidos (R$)', 'Honorários vencidos (R$)', 'Lucro dos contratos (R$)', 'Contratos sem custo'],
      empresas.map((e) => [e.nome, e.faturado, e.notas, e.recebido, e.hon.previsto, e.hon.recebido, e.hon.vencido, e.lucro, e.sem_custo])],
    linhasLucroCsv(luc),
    ['Honorários', ['Vencimento', 'Empresa', 'Tipo', 'Descrição', 'Valor (R$)', 'Situação', 'Pago em', 'Valor pago (R$)'],
      hon.cobrancas.map((c) => [dataBr(c.vencimento), c.cliente_nome, hon.tipos[c.tipo] || c.tipo, c.descricao, c.valor, SITUACAO[c.situacao][0], dataBr(c.pago_em), c.valor_pago])],
  ]);
  const tf = p.total.faturamento || { valor: 0, n: 0 };
  render(alvo,
    cabecalho('Relatórios', `Faturamento das empresas, honorários e lucro dos contratos · ${periodoTxt}`,
      h('button', { class: 'btn', onclick: csv }, '⬇ Planilha (Excel)'), h('button', { class: 'btn primario', onclick: () => window.print() }, '🖨 Imprimir / PDF')),
    h('div', { class: 'nao-imprimir' }, avisoEmpresa(est, 'Relatório'), barra),
    h('div', { class: 'so-imprimir' }, h('p', {}, `Período: ${periodoTxt} · emitido em ${data(new Date().toISOString())}`)),
    h('div', { class: 'grade kpis' },
      kpi('Faturado pelas empresas', moeda(tf.valor), `${numero(tf.n)} nota(s) fiscal(is)`),
      kpi('Recebido dos órgãos', moeda(empresas.reduce((s, e) => s + e.recebido, 0))),
      kpi('Honorários recebidos', moeda(hon.total.recebido), `Previsto ${moeda(hon.total.previsto)}`, 'ok'),
      kpi('Honorários vencidos', moeda(hon.total.vencido), null, hon.total.vencido ? 'perigo' : ''),
      kpi('Lucro dos contratos', moeda(luc.total.lucro), luc.total.sem_custo ? `${luc.total.sem_custo} contrato(s) sem custo ficaram de fora` : `Margem ${pctBr(luc.total.margem_pct)}`)),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Por empresa'),
      empresas.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Empresa', 'Faturado', 'Recebido do órgão', 'Honorários previstos', 'Honorários recebidos', 'Vencidos', 'Lucro dos contratos'].map((x) => h('th', {}, x)))),
        h('tbody', {}, empresas.map((e) => h('tr', {}, h('td', {}, e.nome), h('td', {}, moeda(e.faturado)), h('td', {}, moeda(e.recebido)), h('td', {}, moeda(e.hon.previsto)), h('td', {}, moeda(e.hon.recebido)),
          h('td', { style: { color: e.hon.vencido ? 'var(--perigo)' : null } }, moeda(e.hon.vencido)), h('td', {}, moeda(e.lucro), e.sem_custo ? h('div', { class: 'suave pequeno' }, `${e.sem_custo} sem custo`) : null)))))) : vazio('Nenhuma empresa cadastrada.')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Contratos ganhos'),
      luc.contratos.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Empresa', 'Contrato', 'Etapa', 'Receita', 'Custos', 'Lucro', 'Margem'].map((x) => h('th', {}, x)))),
        h('tbody', {}, luc.contratos.map((c) => h('tr', {}, h('td', {}, c.cliente_nome || '—'), h('td', {}, (c.objeto || '').slice(0, 90)), h('td', {}, c.etapa),
          h('td', {}, c.receita != null ? moeda(c.receita) : 'Não informada'), h('td', {}, c.total_custos != null ? moeda(c.total_custos) : 'Sem custo'),
          h('td', {}, c.lucro != null ? moeda(c.lucro) : '—'), h('td', {}, pctBr(c.margem_pct))))))) : vazio('Nenhum contrato no período.')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Honorários'),
      hon.cobrancas.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Vencimento', 'Empresa', 'Descrição', 'Valor', 'Situação'].map((x) => h('th', {}, x)))),
        h('tbody', {}, hon.cobrancas.map((c) => h('tr', {}, h('td', {}, dataBr(c.vencimento)), h('td', {}, c.cliente_nome), h('td', {}, c.descricao || ''), h('td', {}, moeda(c.valor)),
          h('td', {}, SITUACAO[c.situacao][0], c.pago_em ? ` em ${dataBr(c.pago_em)}` : '')))))) : vazio('Nenhuma cobrança no período.')),
    h('p', { class: 'suave pequeno' }, 'Valores conforme informados no sistema. Contrato sem custo lançado não entra no lucro. Confira com a contabilidade antes de usar para fins fiscais.'));
}
