// Dashboard > Empresas: para cada empresa assessorada, do edital ao dinheiro na conta.
// Os números vêm do Kanban (etapa de cada oportunidade) e dos valores informados no card;
// valor não informado é mostrado como pendência, nunca como zero.
import { api, qs, clienteSelecionado, selecionarCliente } from './api.js';
import { h, moeda, moedaCurta, numero, data, toast, carregando, erroBox, render } from './ui.js';

export const abasDashboard = (ativa) => h('div', { class: 'abas', role: 'tablist' },
  [['oportunidades', 'Oportunidades', '#/dashboard'], ['empresas', 'Empresas', '#/dashboard/empresas']].map(([k, rot, href]) =>
    h('button', { class: ativa === k ? 'ativo' : '', role: 'tab', 'aria-selected': String(ativa === k), onclick: () => { location.hash = href; } }, rot)));

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const curto = (v) => (v ? moedaCurta(v) : 'R$ 0');
const fmtCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

// Abre o Kanban já filtrado na empresa (mesmo efeito do seletor do topo)
function abrirKanbanDe(id) {
  selecionarCliente(id);
  const sel = document.getElementById('seletor-empresa'); if (sel) sel.value = String(id);
  document.body.classList.toggle('com-empresa', !!id);
  location.hash = '#/kanban';
}

const kpi = (rot, valor, apoio, { dica = '', classe = '', href } = {}) => {
  const corpo = [h('div', { class: 'rotulo' }, rot), h('div', { class: 'valor' }, valor), apoio ? h('div', { class: 'apoio' }, apoio) : null];
  return h('div', { class: `cartao kpi ${classe}`, title: dica }, href ? h('a', { href }, corpo) : corpo);
};

// Faixa do caminho: prospecção → disputa → vitória → empenho → entrega → nota → recebido
const PASSOS = [
  ['prospeccao', 'Prospecção', (r) => r.prospeccao], ['disputa', 'Em disputa', (r) => r.disputa],
  ['ganha', 'Vencidas', (r) => r.execucao.vencida], ['empenho', 'Aguardando empenho', (r) => r.execucao.aguardando_empenho],
  ['a_entregar', 'Empenhado, a entregar', (r) => r.execucao.a_entregar], ['entregue', 'Entregue, sem nota', (r) => r.execucao.entregue],
  ['faturada', 'Nota emitida, a receber', (r) => r.execucao.a_receber], ['recebida', 'Recebido', (r) => r.execucao.recebido_total],
];
function caminho(r, compacto = false) {
  return h('div', { class: `caminho${compacto ? ' compacto' : ''}` }, PASSOS.map(([k, rot, f]) => {
    const x = f(r) || { n: 0, valor: 0, sem_valor: 0 };
    return h('div', { class: `passo passo-${k}${x.n ? '' : ' zerado'}`, title: x.sem_valor ? `${x.sem_valor} sem valor informado: complete no card do Kanban` : '' },
      h('div', { class: 'passo-rotulo' }, rot),
      h('div', { class: 'passo-n' }, numero(x.n)),
      h('div', { class: 'passo-valor' }, x.n ? curto(x.valor) : '—', x.sem_valor ? h('span', { class: 'sem-valor' }, ` +${x.sem_valor} s/ valor`) : null));
  }));
}

function projecao(r) {
  const p = r.projecao; const t = r.taxa_vitoria;
  return h('div', { class: 'projecao' },
    h('div', {}, h('span', { class: 'suave' }, 'Garantido (vencidas ainda não recebidas): '), h('strong', {}, moeda(p.garantido))),
    h('div', {}, h('span', { class: 'suave' }, 'Provável das disputas: '),
      p.potencial != null ? [h('strong', {}, moeda(p.potencial)), h('span', { class: 'suave pequeno' }, ` (${moeda(p.em_disputa)} em disputa × ${pct(t.pct)} de vitórias)`)]
        : h('span', { class: 'suave' }, `${moeda(p.em_disputa)} em disputa · a taxa de vitória só entra com 5 resultados registrados (hoje: ${t.ganhas + t.perdidas})`)),
    h('div', { class: 'projecao-total' }, 'Projeção de faturamento: ', h('strong', {}, moeda(p.garantido + (p.potencial || 0)))));
}

const ICONE = { sessao: '⏰', entrega: '🚚', recebimento: '💸', certidao: '📄' };
function proximos(lista) {
  if (!lista.length) return h('div', { class: 'suave pequeno' }, 'Nada urgente: sem propostas fechando em 7 dias, entregas próximas, notas atrasadas ou certidões vencendo.');
  return h('ul', { class: 'proximos' }, lista.map((x) => h('li', { class: x.urgente ? 'urgente' : '' },
    h('span', { class: 'quando' }, ICONE[x.tipo] || '•', ' ', data(x.data, false), x.hora ? ` ${x.hora}` : ''),
    h('a', { href: x.link }, x.texto), x.orgao ? h('span', { class: 'suave' }, ` · ${x.orgao}`) : null)));
}

function documentos(d, id) {
  if (!d.total) return h('a', { class: 'chip neutro', href: `#/empresas/${id}` }, '📄 Nenhuma certidão cadastrada');
  if (d.vencidos) return h('a', { class: 'chip perigo', href: `#/empresas/${id}` }, `⛔ ${d.vencidos} certidão(ões) vencida(s): não dá para habilitar`);
  if (d.vencendo) return h('a', { class: 'chip alerta', href: `#/empresas/${id}` }, `⚠ ${d.vencendo} certidão(ões) vencendo em até 30 dias`);
  return h('a', { class: 'chip ok', href: `#/empresas/${id}` }, '✅ Certidões em dia', d.proximo ? ` · próxima vence ${data(d.proximo.validade, false)}` : '');
}

function ramo(e, est, recarregar) {
  if (e.ramo) {
    return h('a', { class: 'chip info', href: `#/buscar${qs({ visao: 'abertas', ramo: e.ramo.palavras })}`, title: `Palavras do ramo: ${e.ramo.palavras}` },
      `🎯 ${numero(e.ramo.abertas)} licitações abertas no ramo`, e.ramo.valor_abertas ? ` · ${curto(e.ramo.valor_abertas)} estimados` : '',
      e.ramo.novas_7d ? ` · ${numero(e.ramo.novas_7d)} novas em 7 dias` : '');
  }
  if (est.usuario.papel === 'leitor') return h('span', { class: 'chip neutro' }, '🎯 Ramo não definido');
  return h('button', { class: 'chip neutro', type: 'button', title: 'Busca os CNAEs na base pública da Receita e sugere as palavras do ramo',
    onclick: async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Consultando a Receita…';
      try { const r = await api(`/clientes/${e.id}/cnaes`, { metodo: 'POST' }); toast(r.palavras_chave ? `Ramo: ${r.palavras_chave}. Revise no cadastro.` : 'CNAEs gravados; informe as palavras do ramo no cadastro.', 5000); recarregar(); }
      catch (err) { toast(err.message, 5000); ev.target.disabled = false; ev.target.textContent = '🎯 Definir ramo pelos CNAEs'; }
    } }, '🎯 Definir ramo pelos CNAEs');
}

function cartaoEmpresa(e, est, recarregar) {
  const x = e.execucao; const t = e.taxa_vitoria;
  const semValor = PASSOS.reduce((s, [, , f]) => s + (f(e)?.sem_valor || 0), 0);
  return h('div', { class: 'cartao painel-empresa' },
    h('div', { class: 'pe-topo' },
      h('div', {}, h('h2', {}, e.nome), h('div', { class: 'suave pequeno' }, [fmtCnpj(e.cnpj), e.porte, [e.municipio, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · '))),
      h('div', { class: 'linha' },
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => abrirKanbanDe(e.id) }, 'Kanban da empresa'),
        h('a', { class: 'btn pequeno', href: `#/empresas/${e.id}` }, 'Cadastro'))),
    h('div', { class: 'linha chips' }, documentos(e.documentos, e.id), ramo(e, est, recarregar)),
    h('div', { class: 'pe-corpo' }, h('div', { class: 'pe-principal' },
    h('div', { class: 'pe-kpis' },
      kpi('Em disputa', curto(e.disputa.valor), `${numero(e.disputa.n)} disputa(s)${e.disputa.pelo_edital ? ` · ${e.disputa.pelo_edital} pelo valor do edital` : ''}`,
        { dica: 'Valor da proposta informado no card; sem ele, o valor estimado do edital inteiro (pode incluir lotes que a empresa não disputa).' }),
      kpi('Taxa de vitória', pct(t.pct), `${t.ganhas} vencida(s) · ${t.perdidas} perdida(s)`, { dica: 'Vencidas ÷ (vencidas + perdidas). Descartadas não contam.' }),
      kpi('A faturar', curto(e.a_faturar.valor), `${numero(e.a_faturar.n)} vencida(s) sem nota`, { dica: 'Vencidas, aguardando empenho, empenhadas e entregues: dinheiro ganho que ainda não virou nota fiscal.' }),
      kpi('A receber', curto(x.a_receber.valor), x.a_receber.mais_30d.n ? `⚠ ${curto(x.a_receber.mais_30d.valor)} há mais de 30 dias` : `${numero(x.a_receber.n)} nota(s) emitida(s)`,
        { classe: x.a_receber.mais_30d.n ? 'kpi-alerta' : '', dica: 'Notas fiscais emitidas ainda não pagas pelo órgão.' }),
      kpi('Recebido (12 meses)', curto(x.recebido_12m.valor), `${numero(x.recebido_12m.n)} pagamento(s)`)),
    caminho(e, true),
    semValor ? h('div', { class: 'aviso amarelo pequeno' }, `${semValor} oportunidade(s) sem valor informado não entram nas somas. `,
      h('a', { href: '#/kanban', onclick: (ev) => { ev.preventDefault(); abrirKanbanDe(e.id); } }, 'Completar no Kanban')) : null,
    projecao(e)),
    h('div', { class: 'pe-lateral' },
    h('h3', {}, 'Próximos compromissos'),
    proximos(e.proximos),
    h('details', { class: 'cnaes' },
      h('summary', {}, `CNAEs (${e.cnaes.length}) e palavras do ramo`),
      e.cnaes.length ? h('ul', {}, e.cnaes.map((c) => h('li', {}, h('code', {}, c.codigo), ` ${c.descricao}`, c.principal ? h('strong', {}, ' (principal)') : null)))
        : h('div', { class: 'suave pequeno' }, 'CNAEs ainda não buscados na Receita.'),
      h('div', { class: 'pequeno' }, h('strong', {}, 'Palavras do ramo: '), e.palavras_chave || 'não definidas', ' · ', h('a', { href: `#/empresas/${e.id}` }, 'editar no cadastro'))))));
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
      h('a', { href: '#/kanban', onclick: () => { selecionarCliente(''); const s = document.getElementById('seletor-empresa'); if (s) s.value = ''; } }, 'Vincular no Kanban (clique em "Sem empresa · vincular")')));
  }
  const varias = p.empresas.length > 1 && !clienteSelecionado();
  render(alvo,
    cabecalho('Dashboard', `Empresas assessoradas: do edital ao dinheiro na conta · ${data(p.hoje, false)}`),
    abasDashboard('empresas'),
    avisoEmpresa(est, 'Números'),
    ...avisos,
    p.empresas.length ? [
      varias ? h('h2', {}, `Todas as empresas (${t.empresas})`) : null,
      varias ? h('div', { class: 'grade kpis' },
        kpi('Em disputa', curto(t.disputa.valor), `${numero(t.disputa.n)} disputa(s)`),
        kpi('Taxa de vitória', pct(t.taxa_vitoria.pct), `${t.taxa_vitoria.ganhas} vencida(s) · ${t.taxa_vitoria.perdidas} perdida(s)`),
        kpi('A faturar', curto(t.a_faturar.valor), `${numero(t.a_faturar.n)} vencida(s) sem nota`),
        kpi('A receber', curto(t.execucao.a_receber.valor), t.execucao.a_receber.mais_30d.n ? `⚠ ${curto(t.execucao.a_receber.mais_30d.valor)} há mais de 30 dias` : `${numero(t.execucao.a_receber.n)} nota(s)`,
          { classe: t.execucao.a_receber.mais_30d.n ? 'kpi-alerta' : '' }),
        kpi('Recebido (12 meses)', curto(t.execucao.recebido_12m.valor), `${numero(t.execucao.recebido_12m.n)} pagamento(s)`),
        kpi('Projeção de faturamento', curto(t.projecao.garantido + (t.projecao.potencial || 0)),
          t.projecao.potencial != null ? `${curto(t.projecao.garantido)} garantido + ${curto(t.projecao.potencial)} provável` : `${curto(t.projecao.garantido)} garantido`,
          { dica: 'Garantido = vencidas ainda não recebidas. Provável = valor em disputa × taxa de vitória (só com 5 resultados registrados).' })) : null,
      varias ? caminho(t) : null,
      h('div', { class: 'painel-empresas' }, p.empresas.map((e) => cartaoEmpresa(e, est, recarregar))),
      h('details', { class: 'cartao como-ler pequeno' },
        h('summary', {}, 'Como os números são calculados'),
        h('ul', {},
          h('li', {}, 'A fase vem da etapa do card no Kanban. Mova o card conforme o processo anda: Vencida → Aguardando empenho → Empenhado (a entregar) → Produto enviado → Nota fiscal emitida → Recebido.'),
          h('li', {}, 'Valores: abra o card no Kanban e preencha proposta, valor ganho, empenho, nota fiscal e recebimento. Sem valor informado, o card aparece como "s/ valor" e não entra na soma (não vira zero).'),
          h('li', {}, 'Em disputa sem valor da proposta usa o valor estimado do edital inteiro, que pode incluir lotes que a empresa não disputa.'),
          h('li', {}, '"A receber há mais de 30 dias" conta a partir da data da nota fiscal; o prazo de pagamento de cada contrato pode ser diferente.'),
          h('li', {}, 'Licitações do ramo: abertas cujo objeto ou itens têm alguma das palavras do ramo da empresa (sugeridas a partir dos CNAEs da Receita; revise no cadastro).'))),
    ] : null);
}
