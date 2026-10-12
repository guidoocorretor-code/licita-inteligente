// Dashboard > Empresas: para cada empresa assessorada, do edital ao dinheiro na conta.
// Os números vêm do Kanban (etapa de cada oportunidade) e dos valores informados no card;
// valor não informado é mostrado como pendência, nunca como zero.
import { api, qs, clienteSelecionado, selecionarCliente } from './api.js';
import { h, moeda, moedaCurta, numero, data, dataUtc, toast, carregando, erroBox, render, modal } from './ui.js';
import { zap, mensagemCobranca, numeroLic } from './fornecedores.js';

export const abasDashboard = (ativa) => h('div', { class: 'abas', role: 'tablist' },
  [['oportunidades', 'Oportunidades', '#/dashboard'], ['empresas', 'Empresas', '#/dashboard/empresas'], ['fornecedores', 'Fornecedores', '#/dashboard/fornecedores']].map(([k, rot, href]) =>
    h('button', { class: ativa === k ? 'ativo' : '', role: 'tab', 'aria-selected': String(ativa === k), onclick: () => { location.hash = href; } }, rot)));

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const curto = (v) => (v ? moedaCurta(v) : 'R$ 0');
const fmtCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

// Cores por papel (as mesmas em todos os gráficos): azul = em disputa, verde = ganho, laranja = perdido, âmbar = a receber
const COR = { disputa: '#2a78d6', ganho: '#1baf7a', perdido: '#eb6834', receber: '#eda100', recebido: '#0f7a55', neutro: '#a8acb3' };

// Abre o Kanban já filtrado na empresa (mesmo efeito do seletor do topo)
function abrirKanbanDe(id) {
  selecionarCliente(id);
  const sel = document.getElementById('seletor-empresa'); if (sel) sel.value = String(id);
  document.body.classList.toggle('com-empresa', !!id);
  location.hash = '#/kanban';
}

// ---------- Peças gráficas (SVG e HTML simples, sem biblioteca) ----------
const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...filhos) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); el.append(...filhos); return el; };
const dica = (el, txt) => { const t = s('title'); t.textContent = txt; el.append(t); return el; };

/** Rosca com o número principal no centro e legenda ao lado. fatias: [{nome, n, cor}] */
function rosca(fatias, { centro, sub, vazio = 'Sem dados ainda.' }) {
  const total = fatias.reduce((t, f) => t + f.n, 0);
  const R = 58; const r = 40; const C = 64;
  const svg = s('svg', { viewBox: '0 0 128 128', class: 'pe-rosca-svg', role: 'img', 'aria-label': fatias.map((f) => `${f.nome}: ${f.n}`).join('; ') });
  if (!total) svg.append(s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', stroke: 'var(--borda)', 'stroke-width': R - r }));
  let ang = -Math.PI / 2;
  const p = (raio, a) => `${C + raio * Math.cos(a)} ${C + raio * Math.sin(a)}`;
  for (const f of fatias.filter((x) => x.n > 0)) {
    const frac = f.n / total; const txt = `${f.nome}: ${numero(f.n)} (${Math.round(frac * 100)}%)`;
    if (frac >= 0.9999) { svg.append(dica(s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', stroke: f.cor, 'stroke-width': R - r }), txt)); continue; }
    const a2 = ang + frac * 2 * Math.PI; const g = frac > 0.5 ? 1 : 0;
    svg.append(dica(s('path', { d: `M ${p(R, ang)} A ${R} ${R} 0 ${g} 1 ${p(R, a2)} L ${p(r, a2)} A ${r} ${r} 0 ${g} 0 ${p(r, ang)} Z`, fill: f.cor, stroke: 'var(--superficie)', 'stroke-width': 2 }), txt));
    ang = a2;
  }
  const t1 = s('text', { x: C, y: C + 2, 'text-anchor': 'middle', class: 'pe-rosca-centro' }); t1.textContent = centro;
  const t2 = s('text', { x: C, y: C + 17, 'text-anchor': 'middle', class: 'pe-rosca-sub' }); t2.textContent = sub;
  svg.append(t1, t2);
  return h('div', { class: 'pe-rosca' }, svg,
    h('ul', { class: 'pe-legenda' }, fatias.map((f) => h('li', {},
      h('span', { class: 'amostra', style: { background: f.cor } }), h('span', { class: 'nome' }, f.nome), h('strong', {}, numero(f.n))))),
    total ? null : h('div', { class: 'suave pequeno pe-rosca-vazio' }, vazio));
}

// Etapas do caminho, na ordem em que o dinheiro anda
const ETAPAS = [
  ['disputa', 'Em disputa', (r) => r.disputa, COR.disputa],
  ['ganha', 'Vencidas', (r) => r.execucao.vencida, COR.ganho],
  ['empenho', 'Aguardando empenho', (r) => r.execucao.aguardando_empenho, COR.ganho],
  ['a_entregar', 'A entregar', (r) => r.execucao.a_entregar, COR.ganho],
  ['entregue', 'Entregue, sem nota', (r) => r.execucao.entregue, COR.ganho],
  ['faturada', 'Nota emitida', (r) => r.execucao.a_receber, COR.receber],
  ['recebida', 'Recebido', (r) => r.execucao.recebido_total, COR.recebido],
];
/** Barras horizontais: valor (R$) em cada etapa, com a quantidade ao lado. */
function barrasEtapas(r) {
  const linhas = ETAPAS.map(([k, rot, f, cor]) => ({ k, rot, cor, ...(f(r) || { n: 0, valor: 0, sem_valor: 0 }) }));
  const maior = Math.max(1, ...linhas.map((l) => l.valor));
  return h('div', { class: 'pe-barras' }, linhas.map((l) => h('div', {
    class: `pe-barra${l.n ? '' : ' zerada'}`,
    title: `${l.rot}: ${numero(l.n)} oportunidade(s) · ${moeda(l.valor)}${l.pelo_edital ? ` · ${l.pelo_edital} pelo valor estimado do edital (informe o valor ganho no card)` : ''}${l.sem_valor ? ` · ${l.sem_valor} sem valor informado` : ''}` },
  h('span', { class: 'rot' }, l.rot),
  h('span', { class: 'trilho' }, l.valor ? h('span', { class: 'preench', style: { width: `${Math.max(2, (l.valor / maior) * 100)}%`, background: l.cor } })
    : l.n ? h('span', { class: 'preench sem-valor', style: { width: '8%', background: l.cor } }) : null),
  h('span', { class: `val${l.n && !l.valor ? ' falta' : ''}` }, l.n ? (l.valor ? curto(l.valor) : 's/ valor') : '—'),
  h('span', { class: 'qtd' }, l.n ? `${numero(l.n)}${(l.sem_valor && l.valor) || l.pelo_edital ? '*' : ''}` : ''))));
}

/** Barra empilhada da projeção: a faturar + a receber (garantido) + provável das disputas. */
function barraProjecao(r) {
  const p = r.projecao; const t = r.taxa_vitoria;
  const partes = [
    { nome: 'A faturar', v: r.a_faturar.valor, cor: COR.ganho, dica: 'Vencidas que ainda não viraram nota fiscal' },
    { nome: 'A receber', v: r.execucao.a_receber.valor, cor: COR.receber, dica: 'Notas emitidas ainda não pagas' },
    { nome: 'Provável das disputas', v: p.potencial || 0, cor: COR.disputa, provavel: true, dica: `Em disputa × ${pct(t.pct)} de vitórias` },
  ];
  const total = partes.reduce((a, x) => a + x.v, 0);
  return h('div', { class: 'pe-projecao' },
    h('div', { class: 'pe-projecao-total' }, h('strong', {}, moeda(total)), h('span', { class: 'suave' }, 'garantido + provável das disputas')),
    h('div', { class: 'pe-empilhada', role: 'img', 'aria-label': partes.map((x) => `${x.nome}: ${moeda(x.v)}`).join('; ') },
      total ? partes.filter((x) => x.v > 0).map((x) => h('span', { class: x.provavel ? 'provavel' : '', title: `${x.nome}: ${moeda(x.v)} (${x.dica})`,
        style: { width: `${(x.v / total) * 100}%`, background: x.cor } })) : h('span', { class: 'vazia' })),
    h('ul', { class: 'pe-legenda linha' }, partes.map((x) => h('li', { title: x.dica },
      h('span', { class: `amostra${x.provavel ? ' provavel' : ''}`, style: { background: x.cor } }), h('span', { class: 'nome' }, x.nome), h('strong', {}, curto(x.v))))),
    p.potencial == null ? h('div', { class: 'suave pequeno' }, `O provável das disputas entra quando houver 5 resultados registrados (hoje: ${t.ganhas + t.perdidas}). Em disputa agora: ${curto(p.em_disputa)}.`) : null);
}

const resultado = (r) => {
  const t = r.taxa_vitoria;
  return rosca([
    { nome: 'Vencidas', n: t.ganhas, cor: COR.ganho },
    { nome: 'Perdidas', n: t.perdidas, cor: COR.perdido },
    { nome: 'Em disputa', n: r.disputa.n, cor: COR.disputa },
  ], { centro: pct(t.pct), sub: 'de vitórias', vazio: 'Nenhuma disputa registrada no Kanban.' });
};

// ---------- Indicadores ----------
const semV = (x) => (x?.sem_valor ? ` · ${x.sem_valor} sem valor` : '');
const kpi = (rot, valor, apoio, { dica: d = '', classe = '', cor } = {}) => h('div', { class: `cartao pe-kpi ${classe}`, title: d, style: cor ? { borderTopColor: cor } : null },
  h('div', { class: 'rotulo' }, rot), h('div', { class: 'valor' }, valor), apoio ? h('div', { class: 'apoio' }, apoio) : null);

function kpis(r) {
  const x = r.execucao; const p = r.projecao;
  return h('div', { class: 'pe-kpis' },
    kpi('Projeção de faturamento', curto(p.garantido + (p.potencial || 0)), p.potencial != null ? `${curto(p.garantido)} garantido + ${curto(p.potencial)} provável` : `${curto(p.garantido)} garantido`,
      { classe: 'destaque', dica: 'Garantido = vencidas ainda não recebidas. Provável = valor em disputa × taxa de vitória (só com 5 resultados registrados).' }),
    kpi('Em disputa', curto(r.disputa.valor), `${numero(r.disputa.n)} disputa(s)${r.disputa.pelo_edital ? ` · ${r.disputa.pelo_edital} pelo valor do edital` : ''}${semV(r.disputa)}`,
      { cor: COR.disputa, dica: 'Valor da proposta informado no card; sem ele, o valor estimado do edital inteiro (pode incluir lotes que a empresa não disputa).' }),
    kpi('A faturar', curto(r.a_faturar.valor), `${numero(r.a_faturar.n)} vencida(s) sem nota${r.a_faturar.pelo_edital ? ` · ${r.a_faturar.pelo_edital} pelo valor do edital` : ''}${semV(r.a_faturar)}`, { cor: COR.ganho, dica: 'Vencidas, aguardando empenho, empenhadas e entregues: dinheiro ganho que ainda não virou nota fiscal.' }),
    kpi('A receber', curto(x.a_receber.valor), x.a_receber.mais_30d.n ? `⚠ ${curto(x.a_receber.mais_30d.valor)} há mais de 30 dias` : `${numero(x.a_receber.n)} nota(s) emitida(s)${semV(x.a_receber)}`,
      { cor: COR.receber, classe: x.a_receber.mais_30d.n ? 'alerta' : '', dica: 'Notas fiscais emitidas ainda não pagas pelo órgão.' }),
    kpi('Recebido em 12 meses', curto(x.recebido_12m.valor), `${numero(x.recebido_12m.n)} pagamento(s)${x.recebido_sem_data ? ` · ${x.recebido_sem_data} sem data` : ''}${semV(x.recebido_total)}`,
      { cor: COR.recebido, dica: 'Pagamentos com data de recebimento nos últimos 12 meses. Recebido sem data informada não entra.' }));
}

// Quatro blocos em grade 2×2: onde está o dinheiro, resultado das disputas, faturamento previsto e um bloco extra
const graficos = (r, extra) => h('div', { class: 'pe-graficos' },
  h('section', { class: 'pe-bloco' }, h('h3', {}, 'Onde está o dinheiro'), barrasEtapas(r),
    PASSOS_SEM_VALOR(r) ? h('div', { class: 'suave pequeno pe-nota' }, '* inclui oportunidade sem valor informado (não entra na soma)') : null,
    PASSOS_PELO_EDITAL(r) ? h('div', { class: 'suave pequeno pe-nota' }, '* vencida sem valor ganho: soma o valor estimado do edital. Abra o card no Kanban e informe o valor ganho para o número ficar exato.') : null),
  h('section', { class: 'pe-bloco' }, h('h3', {}, 'Resultado das disputas'), resultado(r)),
  h('section', { class: 'pe-bloco' }, h('h3', {}, 'Faturamento previsto'), barraProjecao(r)),
  extra);
const PASSOS_PELO_EDITAL = (r) => ['ganha', 'empenho'].reduce((t, k) => t + (ETAPAS.find(([e]) => e === k)[2](r)?.pelo_edital || 0), 0);
const PASSOS_SEM_VALOR = (r) => ETAPAS.reduce((t, [, , f]) => t + (f(r)?.sem_valor || 0), 0);

// ---------- Blocos da empresa ----------
const ICONE = { sessao: '⏰', entrega: '🚚', recebimento: '💸', certidao: '📄' };
function proximos(lista) {
  if (!lista.length) return h('div', { class: 'pe-nada' }, '✅ Nada urgente: sem propostas fechando em 7 dias, entregas próximas, notas atrasadas ou certidões vencendo.');
  return h('ul', { class: 'pe-proximos' }, lista.slice(0, 5).map((x) => h('li', { class: x.urgente ? 'urgente' : '' },
    h('div', { class: 'quando' }, h('span', { class: 'ico' }, ICONE[x.tipo] || '•'), h('span', {}, data(x.data, false)?.slice(0, 5) || ''), x.hora ? h('small', {}, x.hora) : null),
    h('div', { class: 'oque' }, h('a', { href: x.link, title: x.texto }, x.texto), x.orgao ? h('div', { class: 'orgao', title: x.orgao }, x.orgao) : null))));
}

function documentos(d, id) {
  if (!d.total) return h('a', { class: 'chip neutro', href: `#/empresas/${id}` }, '📄 Nenhuma certidão cadastrada');
  if (d.vencidos) return h('a', { class: 'chip perigo', href: `#/empresas/${id}` }, `⛔ ${d.vencidos} certidão(ões) vencida(s)`);
  if (d.vencendo) return h('a', { class: 'chip alerta', href: `#/empresas/${id}` }, `⚠ ${d.vencendo} certidão(ões) vencendo em 30 dias`);
  return h('a', { class: 'chip ok', href: `#/empresas/${id}` }, '✅ Certidões em dia');
}

// Editar as palavras do ramo sem sair do painel; a sugestão dos CNAEs aparece para clicar
function editarRamo(e, recarregar) {
  const campo = h('textarea', { rows: 3, placeholder: 'ex.: informática; toner; papel A4' }, e.palavras_chave || '');
  const atuais = () => campo.value.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  const alternar = (t, btn) => {
    const l = atuais(); const i = l.findIndex((x) => x.toLowerCase() === t.toLowerCase());
    if (i >= 0) l.splice(i, 1); else l.push(t);
    campo.value = l.join('; '); btn.classList.toggle('marcado', i < 0);
  };
  const botoes = (lista) => h('div', { class: 'pe-sugestoes' }, lista.map((t) => {
    const b = h('button', { type: 'button', class: `chip neutro${atuais().some((x) => x.toLowerCase() === t.toLowerCase()) ? ' marcado' : ''}` }, t);
    b.onclick = () => alternar(t, b); return b;
  }));
  const sug = e.ramo_sugerido;
  modal(`Palavras do ramo: ${e.nome}`, h('div', {},
    h('p', { class: 'suave pequeno' }, 'O painel conta as licitações abertas cujo objeto ou itens têm alguma destas palavras. Use os termos que aparecem nos editais do que a empresa realmente vende. Palavras genéricas (ex.: "comunicação", "vídeo") trazem milhares de licitações que não interessam.'),
    h('label', { class: 'pequeno' }, 'Palavras (separe com ;)'), campo,
    sug ? [
      h('h4', {}, 'Do CNAE principal e do nome da empresa'),
      h('div', { class: 'linha' }, botoes(sug.palavras), h('button', { type: 'button', class: 'btn pequeno', onclick: () => { campo.value = sug.palavras.join('; '); } }, 'Usar só estas')),
      sug.opcionais.length ? [h('h4', {}, 'Dos CNAEs secundários (clique para incluir)'), botoes(sug.opcionais)] : null,
    ] : h('p', { class: 'suave pequeno' }, 'CNAEs ainda não buscados. Use "Definir ramo pelos CNAEs" no painel para receber sugestões.')),
  [{ texto: 'Salvar', classe: 'primario', acao: async () => {
    try { await api(`/clientes/${e.id}`, { metodo: 'PATCH', corpo: { palavras_chave: campo.value } }); toast('Palavras do ramo salvas.'); recarregar(); }
    catch (err) { toast(err.message, 5000); return false; }
  } }]);
}

function ramo(e, est, recarregar) {
  const podeEditar = est.usuario.papel !== 'leitor';
  if (e.ramo) {
    const x = e.ramo;
    return h('div', { class: 'pe-ramo' },
      h('div', { class: 'pe-ramo-numeros' },
        x.uf ? h('a', { href: `#/buscar${qs({ visao: 'abertas', ramo: x.palavras, uf: x.uf })}`, title: `Abertas no ${x.uf} com as palavras do ramo` },
          h('strong', {}, numero(x.abertas_uf)), ` abertas no ${x.uf}`, x.valor_abertas_uf ? h('span', { class: 'suave' }, ` · ${curto(x.valor_abertas_uf)}`) : null) : null,
        h('a', { href: `#/buscar${qs({ visao: 'abertas', ramo: x.palavras })}`, title: 'Abertas no Brasil com as palavras do ramo' },
          h('strong', {}, numero(x.abertas)), ' no Brasil', x.valor_abertas ? h('span', { class: 'suave' }, ` · ${curto(x.valor_abertas)}`) : null),
        h('span', {}, h('strong', {}, numero(x.novas_7d)), ' publicadas em 7 dias')),
      h('div', { class: 'pe-ramo-palavras' }, h('span', { class: 'suave' }, '🎯 Ramo: '), h('span', { title: x.palavras }, x.palavras),
        podeEditar ? h('button', { type: 'button', class: 'btn pequeno', onclick: () => editarRamo(e, recarregar) }, '✏️ Editar palavras') : null));
  }
  if (!podeEditar) return h('div', { class: 'pe-ramo suave' }, '🎯 Ramo não definido');
  return h('div', { class: 'pe-ramo' }, h('div', { class: 'linha' },
    h('span', { class: 'suave' }, '🎯 Ramo não definido: o painel ainda não sabe quais licitações interessam a esta empresa.'),
    h('button', { class: 'btn pequeno primario', type: 'button', title: 'Busca os CNAEs na base pública da Receita e sugere as palavras do ramo',
      onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'Consultando a Receita…';
        try { const r = await api(`/clientes/${e.id}/cnaes`, { metodo: 'POST' }); toast(r.palavras_chave ? 'CNAEs gravados. Revise as palavras do ramo.' : 'CNAEs gravados; informe as palavras do ramo.', 5000); recarregar(); }
        catch (err) { toast(err.message, 5000); b.disabled = false; b.textContent = 'Definir ramo pelos CNAEs'; }
      } }, 'Definir ramo pelos CNAEs'),
    e.cnaes.length ? h('button', { type: 'button', class: 'btn pequeno', onclick: () => editarRamo(e, recarregar) }, '✏️ Escrever palavras') : null));
}

function cartaoEmpresa(e, est, recarregar) {
  const semValor = PASSOS_SEM_VALOR(e);
  return h('div', { class: 'cartao painel-empresa', id: `pe-${e.id}` },
    h('div', { class: 'pe-topo' },
      h('div', { class: 'pe-nome' }, h('h2', {}, e.nome),
        h('div', { class: 'suave pequeno' }, [fmtCnpj(e.cnpj), e.porte, [e.municipio, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · '))),
      h('div', { class: 'linha' }, documentos(e.documentos, e.id),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => abrirKanbanDe(e.id) }, 'Kanban da empresa'),
        h('a', { class: 'btn pequeno', href: `#/empresas/${e.id}` }, 'Cadastro'))),
    ramo(e, est, recarregar),
    kpis(e),
    semValor ? h('div', { class: 'aviso amarelo pequeno' }, `${semValor} oportunidade(s) sem valor informado não entram nas somas. `,
      h('a', { href: '#/kanban', onclick: (ev) => { ev.preventDefault(); abrirKanbanDe(e.id); } }, 'Completar no Kanban')) : null,
    graficos(e, h('section', { class: 'pe-bloco pe-agenda' }, h('h3', {}, 'Próximos compromissos'), proximos(e.proximos))),
    h('details', { class: 'pe-cnaes' },
      h('summary', {}, `CNAEs da Receita (${e.cnaes.length})`),
      e.cnaes.length ? h('ul', {}, e.cnaes.map((c) => h('li', {}, h('code', {}, c.codigo), ` ${c.descricao}`, c.principal ? h('strong', {}, ' (principal)') : null)))
        : h('div', { class: 'suave pequeno' }, 'CNAEs ainda não buscados na Receita.')));
}

/** Comparativo entre empresas: garantido + em disputa, empilhados. */
function porEmpresa(empresas) {
  const maior = Math.max(1, ...empresas.map((e) => e.projecao.garantido + e.projecao.em_disputa));
  return h('section', { class: 'pe-bloco' }, h('h3', {}, 'Dinheiro em jogo por empresa'),
    h('div', { class: 'pe-barras pe-comparativo' }, empresas.map((e) => {
      const g = e.projecao.garantido; const d = e.projecao.em_disputa;
      return h('a', { class: 'pe-barra', href: `#pe-${e.id}`, onclick: (ev) => { ev.preventDefault(); document.getElementById(`pe-${e.id}`)?.scrollIntoView({ behavior: 'smooth' }); },
        title: `${e.nome}: ${moeda(g)} garantido + ${moeda(d)} em disputa` },
      h('span', { class: 'rot' }, e.nome),
      h('span', { class: 'trilho' },
        h('span', { class: 'preench', style: { width: `${(g / maior) * 100}%`, background: COR.ganho } }),
        h('span', { class: 'preench', style: { width: `${(d / maior) * 100}%`, background: COR.disputa } })),
      h('span', { class: 'val' }, curto(g + d)), h('span', { class: 'qtd' }, numero(e.oportunidades)));
    })),
    h('ul', { class: 'pe-legenda linha' },
      h('li', {}, h('span', { class: 'amostra', style: { background: COR.ganho } }), h('span', { class: 'nome' }, 'Garantido (vencido, ainda não recebido)')),
      h('li', {}, h('span', { class: 'amostra', style: { background: COR.disputa } }), h('span', { class: 'nome' }, 'Em disputa'))));
}

export async function painelEmpresas(alvo, rota, est, { cabecalho, avisoEmpresa }) {
  render(alvo, cabecalho('Dashboard', 'Empresas assessoradas: do edital ao dinheiro na conta'), abasDashboard('empresas'), carregando());
  let p;
  try { p = await api('/painel/empresas'); } catch (e) { render(alvo, cabecalho('Dashboard'), abasDashboard('empresas'), erroBox(e)); return; }
  const recarregar = () => painelEmpresas(alvo, rota, est, { cabecalho, avisoEmpresa });
  const t = p.total;
  const avisos = [];
  if (!p.empresas.length) {
    avisos.push(h('div', { class: 'aviso azul' }, 'Nenhuma empresa cadastrada. ', h('a', { href: '#/empresas' }, 'Cadastre a primeira empresa'), ' e acompanhe as licitações dela no Kanban.'));
  }
  if (p.sem_empresa) {
    avisos.push(h('div', { class: 'aviso amarelo' }, `${p.sem_empresa} oportunidade(s) do Kanban sem empresa vinculada não entram nestas contas. `,
      h('a', { href: '#/kanban', onclick: () => { selecionarCliente(''); const s2 = document.getElementById('seletor-empresa'); if (s2) s2.value = ''; } }, 'Vincular no Kanban')));
  }
  const varias = p.empresas.length > 1 && !clienteSelecionado();
  render(alvo,
    cabecalho('Dashboard', `Empresas assessoradas: do edital ao dinheiro na conta · ${data(p.hoje, false)}`),
    abasDashboard('empresas'),
    avisoEmpresa(est, 'Números'),
    ...avisos,
    p.empresas.length ? [
      varias ? h('div', { class: 'cartao painel-empresa pe-consolidado' },
        h('div', { class: 'pe-topo' }, h('div', { class: 'pe-nome' }, h('h2', {}, `Todas as empresas (${t.empresas})`),
          h('div', { class: 'suave pequeno' }, `${numero(t.oportunidades)} oportunidade(s) no Kanban`))),
        kpis(t), graficos(t, porEmpresa(p.empresas))) : null,
      h('div', { class: 'painel-empresas' }, p.empresas.map((e) => cartaoEmpresa(e, est, recarregar))),
      h('details', { class: 'cartao como-ler pequeno' },
        h('summary', {}, 'Como os números são calculados'),
        h('ul', {},
          h('li', {}, 'A fase vem da etapa do card no Kanban. Mova o card conforme o processo anda: Vencida → Aguardando empenho → Empenhado (a entregar) → Produto enviado → Nota fiscal emitida → Recebido.'),
          h('li', {}, 'Valores: abra o card no Kanban e preencha proposta, valor ganho, empenho, nota fiscal e recebimento. Sem valor informado, o card não entra na soma (não vira zero).'),
          h('li', {}, 'Em disputa sem valor da proposta usa o valor estimado do edital inteiro, que pode incluir lotes que a empresa não disputa.'),
          h('li', {}, 'Taxa de vitória = vencidas ÷ (vencidas + perdidas). Só entra na projeção com 5 resultados registrados.'),
          h('li', {}, '"A receber há mais de 30 dias" conta a partir da data da nota fiscal; o prazo de pagamento de cada contrato pode ser diferente.'),
          h('li', {}, 'Licitações do ramo: abertas cujo objeto tem alguma das palavras do ramo, ou que têm um item cuja descrição começa por uma delas (ex.: "NOTEBOOK i5" conta; "DJ com equipamentos próprios (notebook)" não conta).'))),
    ] : null);
}

// ---------- Dashboard > Fornecedores ----------
// Cores por situação do pedido: verde = respondido, âmbar = aguardando, cinza = sem retorno
const COR_PED = { respondido: COR.ganho, aguardando: COR.receber, sem_retorno: COR.neutro };
const ROT_PED = { respondido: 'Respondidos', aguardando: 'Aguardando', sem_retorno: 'Sem retorno' };
const horas = (h2) => (h2 == null ? '—' : h2 < 1 ? 'menos de 1 h' : h2 < 24 ? `${String(h2).replace('.', ',')} h` : `${String(Math.round((h2 / 24) * 10) / 10).replace('.', ',')} dia(s)`);

// Prazo das propostas em texto, com urgência (vermelho até 3 dias, âmbar até 7)
function prazoProposta(dias, iso) {
  if (dias == null) return h('span', { class: 'suave' }, 'prazo da proposta não informado');
  const cls = dias < 0 ? 'texto-perigo' : dias <= 3 ? 'texto-perigo' : dias <= 7 ? 'texto-alerta' : 'suave';
  const quando = dias < 0 ? 'propostas encerradas' : dias < 1 ? 'propostas encerram HOJE' : `propostas encerram em ${Math.ceil(dias)} dia(s)`;
  return h('span', { class: cls }, `${dias >= 0 && dias <= 3 ? '⚠ ' : ''}${quando} (${data(iso)})`);
}

/** Barras empilhadas por fornecedor: respondidos, aguardando e sem retorno. */
function barrasFornecedores(lista) {
  if (!lista.length) return h('p', { class: 'suave pequeno' }, 'Nenhum pedido de cotação enviado ainda.');
  const maior = Math.max(1, ...lista.map((f) => f.pedidos));
  return h('div', {},
    h('ul', { class: 'pe-legenda linha', style: { marginBottom: '10px' } }, Object.keys(COR_PED).map((k) => h('li', {}, h('span', { class: 'amostra', style: { background: COR_PED[k] } }), h('span', { class: 'nome' }, ROT_PED[k])))),
    h('div', { class: 'pe-barras pf-barras' }, lista.map((f) => h('div', { class: 'pe-barra',
      title: `${f.nome}: ${f.pedidos} pedido(s) · ${f.respondido} respondido(s) · ${f.aguardando} aguardando · ${f.sem_retorno} sem retorno · tempo médio de resposta ${horas(f.horas_resposta)} · ${f.itens_cotados} item(ns) cotado(s)` },
    h('span', { class: 'rot' }, f.nome),
    h('span', { class: 'trilho', style: { width: `${Math.max(6, (f.pedidos / maior) * 100)}%` } },
      ['respondido', 'aguardando', 'sem_retorno'].filter((k) => f[k] > 0).map((k) => h('span', { class: 'preench', style: { width: `${(f[k] / f.pedidos) * 100}%`, background: COR_PED[k] } }))),
    h('span', { class: 'val' }, `${f.pedidos} pedido(s)`),
    h('span', { class: 'qtd', title: 'Tempo médio de resposta' }, horas(f.horas_resposta))))));
}

export async function painelFornecedores(alvo, rota, est, { cabecalho, avisoEmpresa }) {
  render(alvo, cabecalho('Dashboard', 'Fornecedores: cotações pedidas, quem responde e o que está atrasado'), abasDashboard('fornecedores'), carregando());
  let d;
  try { d = await api('/painel/fornecedores'); } catch (e) { render(alvo, cabecalho('Dashboard'), abasDashboard('fornecedores'), erroBox(e)); return; }
  const r = d.resumo;
  const fornAguardando = new Set(d.aguardando.map((x) => x.fornecedor_id)).size;
  const total = r.aguardando + r.respondido + r.sem_retorno;
  const pedidoAguardando = (p) => {
    const diasEspera = Math.max(0, Math.floor((Date.now() - new Date(`${String(p.enviado_em).replace(' ', 'T')}Z`)) / 86400000));
    const w = zap(p.whatsapp || p.telefone, mensagemCobranca(p));
    return h('li', { class: `pf-alerta${p.dias_proposta != null && p.dias_proposta <= 3 ? ' urgente' : ''}` },
      h('div', {}, h('strong', {}, p.fornecedor_nome), h('span', { class: 'suave' }, ` · ${p.cliente_nome || 'sem empresa'}`)),
      h('div', { class: 'pequeno' }, h('a', { href: `#/licitacao/${p.licitacao_id}` }, [numeroLic(p), p.orgao_nome].filter(Boolean).join(' · ') || 'Licitação')),
      h('div', { class: 'pequeno' }, prazoProposta(p.dias_proposta, p.data_encerramento_proposta),
        h('span', { class: diasEspera >= 3 ? 'texto-perigo' : 'suave' }, ` · itens ${p.itens.join(', ')} · ${diasEspera ? `há ${diasEspera} dia(s) sem resposta` : 'pedido hoje'}`),
        p.link_revogado === 0 ? h('span', { class: 'suave' }, p.link_acesso ? ' · 🔗 abriu o link' : ' · 🔗 não abriu o link') : ''),
      h('div', { class: 'linha', style: { marginTop: '6px' } },
        w ? h('a', { class: 'btn pequeno', href: w, target: '_blank', rel: 'noopener noreferrer', title: 'Lembrete sem dados da licitação' }, '🟢 Cobrar no WhatsApp ↗')
          : h('span', { class: 'suave pequeno' }, 'Sem WhatsApp cadastrado'),
        h('a', { class: 'btn pequeno', href: `#/cotacao/${p.oportunidade_id}` }, '💲 Abrir cotação')));
  };
  render(alvo,
    cabecalho('Dashboard', 'Fornecedores: cotações pedidas, quem responde e o que está atrasado'),
    abasDashboard('fornecedores'),
    avisoEmpresa(est, 'Números'),
    h('div', { class: 'pf-painel' },
    h('div', { class: 'pe-kpis' },
      kpi('Aguardando retorno', numero(r.aguardando), `${fornAguardando} fornecedor(es)`, { classe: 'destaque', dica: 'Pedidos de cotação enviados e ainda sem resposta.' }),
      kpi('Prazo apertado', numero(r.urgentes), 'aguardando com propostas em até 3 dias', { cor: COR.perdido, dica: 'Pedidos aguardando cujo prazo de envio da proposta no portal termina em até 3 dias (ou já terminou).' }),
      kpi('Taxa de resposta', r.taxa_resposta == null ? '—' : pct(r.taxa_resposta), `${r.respondido} respondido(s) · ${r.sem_retorno} sem retorno`, { cor: COR.ganho, dica: 'Respondidos ÷ (respondidos + sem retorno). Pedidos ainda aguardando não entram.' }),
      kpi('Tempo médio de resposta', horas(r.horas_resposta), 'do pedido até a resposta', { cor: COR.disputa, dica: 'Do envio do pedido até a resposta ser registrada (pela equipe ou pelo link).' }),
      kpi('Fornecedores ativos', numero(r.fornecedores_ativos), h('a', { href: '#/fornecedores' }, 'ver cadastro'), { cor: COR.neutro })),
    h('div', { class: 'pe-graficos' },
      h('section', { class: 'pe-bloco' }, h('h3', {}, 'Situação dos pedidos'),
        rosca(['respondido', 'aguardando', 'sem_retorno'].map((k) => ({ nome: ROT_PED[k], n: r[k], cor: COR_PED[k] })),
          { centro: numero(total), sub: 'pedido(s)', vazio: 'Nenhum pedido de cotação enviado ainda.' })),
      h('section', { class: 'pe-bloco' }, h('h3', {}, 'Pedidos por fornecedor'), h('div', { class: 'suave pequeno', style: { marginBottom: '6px' } }, 'À direita, o tempo médio de resposta.'), barrasFornecedores(d.por_fornecedor))),
    h('section', { class: 'pe-bloco', style: { marginTop: '14px' } },
      h('h3', {}, `Aguardando cotação (${d.aguardando.length})`, h('a', { class: 'pequeno', href: '#/cotacoes', style: { marginLeft: '10px', fontWeight: 400 } }, 'ver todas')),
      h('div', { class: 'suave pequeno' }, 'Pelo prazo para enviar a proposta no portal: o mais apertado primeiro.'),
      d.aguardando.length ? h('ul', { class: 'pf-alertas' }, d.aguardando.slice(0, 20).map(pedidoAguardando)) : h('p', { class: 'suave pequeno' }, 'Nenhum pedido aguardando retorno.')),
    h('section', { class: 'pe-bloco', style: { marginTop: '14px' } },
      h('h3', {}, `Prazo perto e itens sem cotação (${d.prazo_sem_cotacao.length})`),
      h('div', { class: 'suave pequeno' }, 'Oportunidades com propostas encerrando nos próximos 7 dias que ainda têm itens sem nenhuma cotação.'),
      d.prazo_sem_cotacao.length ? h('ul', { class: 'pf-alertas' }, d.prazo_sem_cotacao.map((o) => h('li', { class: `pf-alerta${o.dias_proposta <= 3 ? ' urgente' : ''}` },
        h('div', {}, h('strong', {}, `${o.sem_cotacao} de ${o.itens} item(ns) sem cotação`), h('span', { class: 'suave' }, ` · ${o.cliente_nome || 'sem empresa'}`)),
        h('div', { class: 'pequeno' }, h('a', { href: `#/licitacao/${o.licitacao_id}` }, [numeroLic(o), o.orgao_nome].filter(Boolean).join(' · ') || 'Licitação')),
        h('div', { class: 'pequeno' }, prazoProposta(o.dias_proposta, o.data_encerramento_proposta)),
        h('div', { class: 'linha', style: { marginTop: '6px' } }, h('a', { class: 'btn pequeno primario', href: `#/cotacao/${o.oportunidade_id}` }, '✉ Pedir cotação')))))
        : h('p', { class: 'suave pequeno' }, 'Nenhuma oportunidade com prazo nos próximos 7 dias e item sem cotação.'))));
}
