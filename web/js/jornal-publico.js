// Página pública (sem login) do jornal enviado ao empresário: resumo de cada licitação, link do PNCP para
// baixar o edital e a resposta "tenho interesse", que chega automaticamente para a assessoria.
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const el = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
};
const conteudo = document.getElementById('conteudo');
const sub = document.getElementById('sub');
const rodape = document.getElementById('rodape');
const num = (v) => (v == null ? '' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(v));
const dataUtc = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const mostrarErro = (msg) => { sub.textContent = ''; rodape.hidden = true; conteudo.replaceChildren(el('div', { class: 'aviso erro' }, msg)); };
const simNao = (v) => (v == null ? 'não informado' : v ? 'sim' : 'não');

async function carregar() {
  let d;
  try {
    const r = await fetch(`/publico/jornal/${encodeURIComponent(token)}`);
    d = await r.json();
    if (!r.ok) return mostrarErro(d.erro || 'Link inválido.');
  } catch { return mostrarErro('Não foi possível carregar. Verifique a internet e tente de novo.'); }
  sub.textContent = `${d.cliente ? `Para ${d.cliente} · ` : ''}enviado por ${[d.assessoria.responsavel, d.assessoria.nome].filter(Boolean).join(' · ')}`;
  const marcados = new Set(d.interesses);
  const caixas = [];
  const cards = d.licitacoes.map((l) => {
    const cx = el('input', { type: 'checkbox', 'aria-label': `Tenho interesse: ${l.objeto || ''}`, checked: marcados.has(l.id), onchange: atualizar });
    cx.dataset.id = l.id; caixas.push(cx);
    return el('section', { class: 'cartao lic', id: `lic-${l.id}` },
      el('div', { class: 'topo' }, cx,
        el('div', {},
          el('h2', {}, l.objeto || '(objeto não informado)'),
          el('div', { class: 'suave' }, [l.modalidade, l.numero ? `nº ${l.numero}` : null].filter(Boolean).join(' '), ' · ', l.orgao || '', l.local ? ` · ${l.local}` : ''),
          el('div', {}, el('span', { class: `etq ${l.sistema.custo}` }, `Participação: ${l.sistema.participacao}`), el('span', { class: 'etq' }, l.sistema.nome)))),
      el('div', { class: 'valores' },
        el('div', {}, el('span', { class: 'suave' }, 'Valor do edital'), el('strong', {}, l.valor)),
        el('div', {}, el('span', { class: 'suave' }, 'Propostas até'), el('strong', {}, l.prazo)),
        el('div', {}, el('span', { class: 'suave' }, 'Exclusiva ME/EPP'), el('strong', {}, simNao(l.me_epp)))),
      el('details', {}, el('summary', {}, 'Resumo do edital'),
        el('dl', {},
          el('dt', {}, 'Órgão'), el('dd', {}, [l.orgao, l.unidade].filter(Boolean).join(' · ') || 'não informado'),
          el('dt', {}, 'Recebimento de propostas'), el('dd', {}, l.abertura ? `de ${l.abertura} até ${l.prazo}` : `até ${l.prazo}`),
          el('dt', {}, 'Sistema da disputa'), el('dd', {}, l.sistema.nome),
          el('dt', {}, 'Custo para participar'), el('dd', {}, l.sistema.resumo),
          el('dt', {}, 'Modo de disputa'), el('dd', {}, l.modo || 'não informado'),
          el('dt', {}, 'Julgamento'), el('dd', {}, l.criterio || 'não informado'),
          el('dt', {}, 'Registro de preços'), el('dd', {}, simNao(l.srp))),
        l.itens.length ? el('div', {}, el('strong', {}, `Itens (${l.total_itens})`),
          el('ol', { class: 'itens' }, l.itens.map((i) => el('li', {}, `${i.descricao || '(sem descrição)'}${i.quantidade != null ? ` · ${num(i.quantidade)} ${i.unidade_medida || 'un.'}` : ''}`))),
          l.total_itens > l.itens.length ? el('div', { class: 'suave' }, `… e mais ${l.total_itens - l.itens.length} item(ns) no edital.`) : null) : null),
      l.link_pncp ? el('a', { class: 'pncp', href: l.link_pncp, target: '_blank', rel: 'noopener noreferrer' }, 'Baixar o edital no PNCP ↗') : el('div', { class: 'suave' }, 'Link do PNCP não informado.'));
  });
  const nome = el('input', { placeholder: 'Seu nome', value: d.respondente || '', 'aria-label': 'Seu nome' });
  const obs = el('input', { placeholder: 'Observação (opcional)', value: d.observacao || '', 'aria-label': 'Observação' });
  const botao = el('button', { onclick: enviar }, 'Enviar meu interesse');
  const situacao = el('div');
  function atualizar() { botao.textContent = `Enviar meu interesse (${caixas.filter((c) => c.checked).length})`; }
  async function enviar() {
    if (!nome.value.trim()) { nome.focus(); situacao.replaceChildren(el('div', { class: 'aviso erro' }, 'Informe o seu nome.')); return; }
    botao.disabled = true;
    try {
      const r = await fetch(`/publico/jornal/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'licita' },
        body: JSON.stringify({ interesses: caixas.filter((c) => c.checked).map((c) => Number(c.dataset.id)), respondente: nome.value.trim(), observacao: obs.value.trim() }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.erro || 'Não foi possível enviar.');
      situacao.replaceChildren(el('div', { class: 'aviso ok' }, x.interesses
        ? `Recebemos o seu interesse em ${x.interesses} licitação(ões). A assessoria vai entrar em contato. Se mudar de ideia, marque de novo e envie outra vez.`
        : 'Resposta enviada sem licitações marcadas. Se mudar de ideia, marque e envie outra vez.'));
      situacao.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { situacao.replaceChildren(el('div', { class: 'aviso erro' }, e.message)); } finally { botao.disabled = false; }
  }
  conteudo.replaceChildren(...[
    el('div', { class: 'aviso info' }, 'Marque as licitações em que a sua empresa tem interesse em participar e clique em "Enviar meu interesse". Toque em "Resumo do edital" para ver os detalhes.'),
    d.respondido_em ? el('div', { class: 'aviso ok' }, `Resposta anterior recebida em ${dataUtc(d.respondido_em)}. Você pode alterar e enviar de novo.`) : null,
    situacao, ...cards,
    el('p', { class: 'suave' }, 'Dados públicos do PNCP. Confira sempre o edital: datas, valores e o sistema da disputa podem mudar por retificação.')].filter(Boolean));
  rodape.replaceChildren(el('div', { class: 'linha' }, nome, obs, botao));
  rodape.hidden = false;
  atualizar();
  // Veio de um link do PDF/e-mail (#lic-123): abre o resumo e destaca o card
  const alvo = location.hash && document.getElementById(location.hash.slice(1));
  if (alvo) { alvo.classList.add('alvo'); alvo.querySelector('details').open = true; alvo.scrollIntoView({ block: 'start' }); }
}
carregar();
