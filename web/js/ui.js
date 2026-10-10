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

// Valor monetário curto para blocos de indicador (o valor completo vai no title / linha de apoio)
export function moedaCurta(v) {
  if (v == null) return null;
  const abs = Math.abs(v);
  const f = (n, s) => `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 2 : 1 })} ${s}`;
  if (abs >= 1e9) return f(v / 1e9, 'bi');
  if (abs >= 1e6) return f(v / 1e6, 'mi');
  if (abs >= 1e3) return f(v / 1e3, 'mil');
  return BRL.format(v);
}

// Paleta categórica validada (daltonismo e contraste entre vizinhos); "Outros" sempre em cinza.
const CORES_CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const COR_OUTROS = '#a8acb3';
const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

/**
 * Gráfico de rosca com legenda (nome, quantidade e %). Mostra no máximo `max` fatias;
 * o restante é somado em "Outros". Usado só para partes de um todo com poucas categorias.
 */
export function rosca(itens, { max = 5, rotulo = (i) => i.rotulo, aoClicar } = {}) {
  const validos = itens.filter((i) => i.n > 0);
  if (!validos.length) return vazio('Sem dados ainda.');
  const ordenados = [...validos].sort((a, b) => b.n - a.n);
  const fatias = ordenados.slice(0, max).map((i, k) => ({ ...i, nome: rotulo(i), cor: CORES_CAT[k] }));
  const resto = ordenados.slice(max).reduce((t, i) => t + i.n, 0);
  if (resto) fatias.push({ nome: `Outros (${ordenados.length - max})`, n: resto, cor: COR_OUTROS, outros: true });
  const total = fatias.reduce((t, f) => t + f.n, 0);
  const pct = (n) => `${((n / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

  const R = 60; const r = 38; const C = 70;
  const svg = s('svg', { viewBox: '0 0 140 140', class: 'rosca-svg', role: 'img', 'aria-label': fatias.map((f) => `${f.nome}: ${f.n}`).join('; ') });
  let ang = -Math.PI / 2;
  const ponto = (raio, a) => `${C + raio * Math.cos(a)} ${C + raio * Math.sin(a)}`;
  for (const f of fatias) {
    const frac = f.n / total;
    let el;
    if (frac >= 0.9999) {
      el = s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', stroke: f.cor, 'stroke-width': R - r });
    } else {
      const a2 = ang + frac * 2 * Math.PI; const grande = frac > 0.5 ? 1 : 0;
      el = s('path', { d: `M ${ponto(R, ang)} A ${R} ${R} 0 ${grande} 1 ${ponto(R, a2)} L ${ponto(r, a2)} A ${r} ${r} 0 ${grande} 0 ${ponto(r, ang)} Z`,
        fill: f.cor, stroke: 'var(--superficie)', 'stroke-width': 2 });
      ang = a2;
    }
    const t = s('title'); t.textContent = `${f.nome}: ${NUM.format(f.n)} (${pct(f.n)})`; el.append(t);
    if (aoClicar && !f.outros) { el.style.cursor = 'pointer'; el.addEventListener('click', () => aoClicar(f)); }
    svg.append(el);
  }
  const tTotal = s('text', { x: C, y: C - 2, 'text-anchor': 'middle', class: 'rosca-total' }); tTotal.textContent = NUM.format(total);
  const tRot = s('text', { x: C, y: C + 14, 'text-anchor': 'middle', class: 'rosca-rotulo' }); tRot.textContent = 'total';
  svg.append(tTotal, tRot);

  const legenda = h('ul', { class: 'rosca-legenda' }, fatias.map((f) => h('li', { title: `${f.nome}: ${NUM.format(f.n)} (${pct(f.n)})`,
    class: aoClicar && !f.outros ? 'clicavel' : null, onclick: aoClicar && !f.outros ? () => aoClicar(f) : null },
    h('span', { class: 'amostra', style: { background: f.cor } }),
    h('span', { class: 'nome' }, f.nome),
    h('span', { class: 'n' }, NUM.format(f.n)),
    h('span', { class: 'pct' }, pct(f.n)))));
  return h('div', { class: 'rosca' }, svg, legenda);
}
