// Utilitários de interface. Todo texto vindo das fontes é inserido como texto (nunca como HTML).
export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR');

export const naoInformado = (txt = 'Não informado') => h('span', { class: 'nao-info' }, txt);

export function moeda(v, situacao) {
  if (situacao === 'sigiloso') return h('span', { class: 'etiqueta', title: 'Orçamento sigiloso conforme a fonte' }, 'Sigiloso');
  if (v === null || v === undefined) return naoInformado();
  return BRL.format(v);
}
export const numero = (v) => (v == null ? '—' : NUM.format(v));

// Datas armazenadas no horário local de Brasília (sem fuso)
export function data(iso, comHora = true) {
  if (!iso) return null;
  const [d, t] = String(iso).replace(' ', 'T').split('T');
  const [a, m, dia] = d.split('-');
  if (!a || !m || !dia) return iso;
  return comHora && t && t.slice(0, 5) !== '00:00' ? `${dia}/${m}/${a} ${t.slice(0, 5)}` : `${dia}/${m}/${a}`;
}
export const dataOuNao = (iso, comHora) => data(iso, comHora) || naoInformado();

// Datas geradas pelo servidor (datetime('now')) estão em UTC
export function dataUtc(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function prazoRestante(iso) {
  if (!iso) return null;
  const alvo = Date.parse(iso + '-03:00');
  const diff = alvo - Date.now();
  if (diff <= 0) return null;
  const dias = Math.floor(diff / 86400000);
  const horas = Math.floor((diff % 86400000) / 3600000);
  return dias > 0 ? `${dias}d ${horas}h` : `${horas}h`;
}

const COR_STATUS = {
  aguardando_propostas: 'azul', aberta: 'verde', prazo_encerrado: 'amarela', em_disputa: 'amarela', resultado_parcial: 'amarela',
  encerrada: 'azul', encerrada_sem_itens_validos: '', deserta: 'vermelha', fracassada: 'vermelha', deserta_fracassada: 'vermelha',
  suspensa: 'amarela', revogada: 'vermelha', anulada: 'vermelha', indeterminada: '',
};
export function etiquetaStatus(status, meta, motivo) {
  const rot = meta?.status?.[status]?.rotulo || status;
  return h('span', { class: `etiqueta ${COR_STATUS[status] || ''}`, title: motivo || '' }, rot);
}

export function toast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('visivel');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('visivel'), ms);
}

export function carregando(txt = 'Carregando…') { return h('div', { class: 'vazio' }, txt); }
export function erroBox(e) { return h('div', { class: 'aviso vermelho' }, e?.message || String(e)); }
export function vazio(txt) { return h('div', { class: 'vazio' }, txt); }

export function confirmar(msg) { return window.confirm(msg); }

export function modal(titulo, conteudo, acoes = []) {
  const fundo = h('div', { class: 'modal-fundo', role: 'dialog', 'aria-modal': 'true' });
  const fechar = () => fundo.remove();
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.append(h('div', { class: 'modal' }, h('h2', {}, titulo), conteudo,
    h('div', { class: 'linha', style: { justifyContent: 'flex-end', marginTop: '14px' } },
      ...acoes.map((a) => h('button', { class: `btn ${a.classe || ''}`, onclick: async () => { if ((await a.acao?.()) !== false) fechar(); } }, a.texto)),
      h('button', { class: 'btn', onclick: fechar }, 'Fechar'))));
  document.body.append(fundo);
  return fechar;
}

export function barras(itens, { max = 10, rotulo = (i) => i.rotulo } = {}) {
  const lista = itens.slice(0, max);
  const maior = Math.max(1, ...lista.map((i) => i.n));
  if (!lista.length) return vazio('Sem dados ainda.');
  return h('div', { class: 'barras' }, lista.map((i) => h('div', { class: 'barra' },
    h('span', { class: 'nome', title: rotulo(i) }, rotulo(i)),
    h('span', { class: 'trilho' }, h('span', { class: 'preench', style: { width: `${(i.n / maior) * 100}%`, display: 'block' } })),
    h('span', { class: 'n' }, numero(i.n)))));
}

export const render = (el, ...n) => el.replaceChildren(...n.flat().filter((x) => x != null && x !== false));
