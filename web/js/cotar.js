// Página pública (sem login) em que o fornecedor responde a cotação pelo link recebido.
// Não mostra o valor estimado do órgão nem nenhum outro dado interno.
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const el = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
};
const conteudo = document.getElementById('conteudo');
const sub = document.getElementById('sub');
const dataBr = (iso, hora = true) => { if (!iso) return ''; const [d, t] = String(iso).replace(' ', 'T').split('T'); const [a, m, dia] = d.split('-'); return `${dia}/${m}/${a}${hora && t && t.slice(0, 5) !== '00:00' ? ` ${t.slice(0, 5)}` : ''}`; };
const num = (v) => (v == null ? '' : String(v).replace('.', ','));
const lerNum = (v) => { const t = String(v ?? '').trim(); return t === '' ? '' : t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t; };
const mostrarErro = (msg) => { sub.textContent = ''; conteudo.replaceChildren(el('div', { class: 'aviso erro' }, msg)); };

async function carregar() {
  let d;
  try {
    const r = await fetch(`/publico/cotacao/${encodeURIComponent(token)}`);
    d = await r.json();
    if (!r.ok) return mostrarErro(d.erro || 'Link inválido.');
  } catch { return mostrarErro('Não foi possível carregar. Verifique a internet e tente de novo.'); }
  const L = d.licitacao;
  sub.textContent = `${d.solicitante} pede cotação a ${d.fornecedor}`;
  const ant = d.resposta_anterior || {};
  const linhas = d.itens.map((i) => {
    const preco = el('input', { inputmode: 'decimal', placeholder: '0,00', value: num(i.resposta?.preco_unitario), 'aria-label': `Preço unitário do item ${i.numero_item}` });
    const marca = el('input', { placeholder: 'marca e modelo', value: i.resposta?.marca_modelo || '', 'aria-label': `Marca e modelo do item ${i.numero_item}` });
    return { i, preco, marca, bloco: el('div', { class: 'item' },
      el('div', { class: 'tit' }, `Item ${i.numero_item} · ${i.quantidade != null ? `${num(i.quantidade)} ${i.unidade_medida || 'un.'}` : 'quantidade a confirmar'}`),
      el('div', { class: 'desc' }, i.descricao || '(sem descrição)'),
      el('div', { class: 'grade' }, el('div', {}, el('label', {}, 'Preço unitário (R$)'), preco), el('div', {}, el('label', {}, 'Marca / modelo'), marca))) };
  });
  const prazo = el('input', { type: 'number', min: 0, step: 1, value: ant.prazo_entrega_dias ?? '', placeholder: 'dias' });
  const validade = el('input', { type: 'date', value: ant.validade || '' });
  const frete = el('select', {}, el('option', { value: '' }, 'Selecione'), el('option', { value: 'CIF', selected: ant.frete === 'CIF' }, 'CIF · entrega inclusa no preço'),
    el('option', { value: 'FOB', selected: ant.frete === 'FOB' }, 'FOB · frete por conta do comprador'));
  const pagamento = el('input', { value: ant.condicoes_pagamento || '', placeholder: 'ex.: boleto 30/60, Pix à vista' });
  const obs = el('textarea', { rows: 3, placeholder: 'Opcional' }, ant.observacoes || '');
  const nome = el('input', { value: ant.respondente || '', placeholder: 'quem está respondendo', autocomplete: 'name' });
  const msg = el('div', {});
  const botao = el('button', { type: 'submit' }, d.respondido_em ? 'Atualizar resposta' : 'Enviar cotação');
  const form = el('form', { onsubmit: async (ev) => {
    ev.preventDefault();
    const itens = linhas.filter((l) => l.preco.value.trim()).map((l) => ({ numero_item: l.i.numero_item, preco_unitario: lerNum(l.preco.value), marca_modelo: l.marca.value.trim() }));
    if (!itens.length) { msg.replaceChildren(el('div', { class: 'aviso erro' }, 'Informe o preço de pelo menos um item.')); return; }
    if (!nome.value.trim()) { msg.replaceChildren(el('div', { class: 'aviso erro' }, 'Informe o seu nome.')); nome.focus(); return; }
    botao.disabled = true; msg.replaceChildren(el('div', { class: 'aviso info' }, 'Enviando…'));
    try {
      const r = await fetch(`/publico/cotacao/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'licita' },
        body: JSON.stringify({ itens, prazo_entrega_dias: prazo.value, validade: validade.value, frete: frete.value, condicoes_pagamento: pagamento.value, observacoes: obs.value, respondente: nome.value }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.erro || 'Não foi possível enviar.');
      conteudo.replaceChildren(el('div', { class: 'aviso ok' }, el('strong', {}, 'Cotação enviada. Obrigado!'), el('br'),
        `${x.gravados} item(ns) recebido(s) por ${d.solicitante}. Para corrigir, abra o mesmo link de novo${L.propostas_ate ? ` até ${dataBr(L.propostas_ate)}` : ''}.`));
      window.scrollTo(0, 0);
    } catch (e) { msg.replaceChildren(el('div', { class: 'aviso erro' }, e.message)); botao.disabled = false; }
  } },
  el('div', { class: 'cartao' }, el('h2', {}, `Itens para cotar (${d.itens.length})`), el('div', { class: 'suave' }, 'Deixe em branco o item que você não fornece.'), ...linhas.map((l) => l.bloco)),
  el('div', { class: 'cartao' }, el('h2', {}, 'Condições'),
    el('div', { class: 'grade' },
      el('div', {}, el('label', {}, 'Prazo de entrega (dias)'), prazo),
      el('div', {}, el('label', {}, 'Validade da cotação'), validade),
      el('div', {}, el('label', {}, 'Frete'), frete),
      el('div', {}, el('label', {}, 'Condições de pagamento'), pagamento)),
    el('div', { style: 'margin-top:10px' }, el('label', {}, 'Observações'), obs),
    el('div', { style: 'margin-top:10px' }, el('label', {}, 'Seu nome *'), nome)),
  msg, botao);
  conteudo.replaceChildren(...[
    d.respondido_em ? el('div', { class: 'aviso info' }, 'Você já respondeu esta cotação. Pode corrigir e enviar de novo.') : null,
    el('div', { class: 'cartao' }, el('h2', {}, 'Licitação'),
      el('dl', {},
        L.orgao ? [el('dt', {}, 'Órgão'), el('dd', {}, L.orgao)] : null,
        L.local ? [el('dt', {}, 'Local de entrega'), el('dd', {}, L.local)] : null,
        L.modalidade || L.numero ? [el('dt', {}, 'Licitação'), el('dd', {}, [L.modalidade, L.numero ? `nº ${L.numero}${L.ano && !String(L.numero).includes('/') ? `/${L.ano}` : ''}` : ''].filter(Boolean).join(' '))] : null,
        L.propostas_ate ? [el('dt', {}, 'Propostas até'), el('dd', {}, dataBr(L.propostas_ate))] : null,
        L.objeto ? [el('dt', {}, 'Objeto'), el('dd', {}, L.objeto)] : null)),
    form,
    el('p', { class: 'suave' }, `Os dados vão direto para ${d.solicitante}${d.solicitante_cnpj ? ` (CNPJ ${d.solicitante_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')})` : ''}. Este link é pessoal: não compartilhe.`)].filter(Boolean));
}
carregar();
