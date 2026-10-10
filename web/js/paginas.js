import { api, qs, clienteSelecionado } from './api.js';
import {
  h, moeda, numero, data, dataOuNao, dataUtc, prazoRestante, etiquetaStatus, toast, carregando, erroBox, vazio,
  confirmar, modal, barras, rosca, moedaCurta, naoInformado, render,
} from './ui.js';

const ehAdmin = (e) => ['admin', 'superadmin'].includes(e.usuario.papel);
const podeEditar = (e) => e.usuario.papel !== 'leitor';
// Nome da empresa assessorada em foco (null = todas)
const empresaEmFoco = (est) => est?.clientes?.find((c) => String(c.id) === clienteSelecionado()) || null;
const nomeEmpresa = (c) => c.nome_fantasia || c.razao_social;
const avisoEmpresa = (est, oQue) => {
  const c = empresaEmFoco(est);
  return h('div', { class: 'faixa-empresa' }, c ? ['🏢 ', h('strong', {}, nomeEmpresa(c)), ` · ${oQue} só desta empresa. `, h('a', { href: '#/empresas' }, 'Trocar')]
    : est?.clientes?.length ? ['🏢 Todas as empresas · ', oQue, ' de todas. Escolha uma empresa no topo para separar.'] : null);
};
const ESF = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital', N: 'Não se aplica' };

function cabecalho(titulo, subtitulo, ...acoes) {
  return h('div', { class: 'cabecalho-pagina' },
    h('div', {}, h('h1', {}, titulo), subtitulo ? h('div', { class: 'suave' }, subtitulo) : null),
    h('div', { class: 'linha' }, ...acoes));
}

// ============================ DASHBOARD ============================
export async function dashboard(alvo, _r, est) {
  render(alvo, carregando());
  const d = await api('/dashboard');
  const kpi = (rot, val, link, dica, apoio) => h('div', { class: 'cartao kpi', title: dica || '' },
    h('a', { href: link || '#/buscar' }, h('div', { class: 'rotulo' }, rot), h('div', { class: 'valor' }, val), apoio ? h('div', { class: 'apoio' }, apoio) : null));
  const moedaKpi = (v) => (v == null ? moeda(v) : moedaCurta(v));
  const ir = (params) => { location.hash = `#/buscar?${new URLSearchParams(params)}`; };
  const va = d.valor_estimado_abertas;
  const avisos = [];
  if (d.total === 0) {
    avisos.push(h('div', { class: 'aviso azul' }, 'O banco ainda não tem licitações. ',
      ehAdmin(est) ? h('a', { href: '#/fontes' }, 'Vá em Fontes de dados para sincronizar ou importar.') : 'Peça ao administrador para sincronizar as fontes.'));
  }
  if (d.disco?.baixo) {
    avisos.push(h('div', { class: 'aviso vermelho' }, h('strong', {}, `Disco quase cheio: ${numero(d.disco.livre_mb)} MB livres de ${numero(d.disco.total_mb)} MB. `),
      'As sincronizações estão pausadas para o banco não travar. Aumente o volume no Railway (clique no volume > Settings) e elas voltam sozinhas.'));
  }
  for (const f of d.conectores_com_falha) {
    avisos.push(h('div', { class: 'aviso vermelho' }, `Conector com falha: ${f.nome} (${f.situacao_conexao === 'bloqueada_rede' ? 'acesso de rede bloqueado' : 'erro'}). `,
      h('span', { class: 'pequeno' }, f.ultimo_erro || '')));
  }
  render(alvo, 
    cabecalho('Dashboard', `Indicadores calculados a partir do banco · atualizado em ${data(d.atualizado_em)} · última sincronização bem-sucedida: ${d.ultima_sincronizacao ? dataUtc(d.ultima_sincronizacao) : 'nenhuma'}`),
    ...avisos,
    h('div', { class: 'grade kpis' },
      kpi('Licitações monitoradas', numero(d.total)),
      kpi('Abertas', numero(d.por_visao.abertas), '#/buscar?visao=abertas'),
      kpi('Encerram em até 7 dias', numero(d.sessoes_proximas), '#/buscar?sessao_proxima=1', 'Prazo final de propostas nos próximos 7 dias (o PNCP não informa a data da sessão de disputa separadamente).'),
      kpi('Em disputa / aguardando resultado', numero(d.por_visao.em_disputa), '#/buscar?visao=em_disputa'),
      kpi('Encerradas', numero(d.por_visao.encerradas), '#/buscar?visao=encerradas'),
      kpi('Desertas ou fracassadas', numero(d.por_visao.desertas_fracassadas), '#/buscar?visao=desertas_fracassadas', 'Somente com situação oficial informada pela fonte nos itens.'),
      kpi('Valor estimado das abertas', moedaKpi(va.v), '#/buscar?visao=abertas', `Soma apenas de valores informados (${va.com_valor} licitações). ${va.sigilosos || 0} com orçamento sigiloso e ${va.sem_valor || 0} sem valor/zero não entram na soma.`,
        va.v ? `${moeda(va.v)} · ${numero(va.com_valor)} com valor` : null),
      kpi('Valor homologado (registrado)', moedaKpi(d.valor_homologado.v), '#/buscar?visao=encerradas', `Valor homologado informado pela fonte em ${d.valor_homologado.n} licitações. Não é somado ao estimado.`,
        d.valor_homologado.v ? moeda(d.valor_homologado.v) : null),
      kpi('Publicadas nas últimas 24h', numero(d.novas_24h), '#/jornal'),
      kpi('Publicadas nos últimos 7 dias', numero(d.novas_7d), '#/jornal'),
      kpi('Publicadas nos últimos 30 dias', numero(d.novas_30d), '#/jornal'),
      kpi('Alertas não lidos', numero(d.alertas_pendentes), '#/notificacoes')),
    h('div', { class: 'grade tres', style: { marginTop: '14px' } },
      h('div', { class: 'cartao' }, h('h2', {}, 'Por situação'),
        rosca([['abertas', 'Abertas'], ['em_disputa', 'Em disputa / aguardando'], ['encerradas', 'Encerradas'], ['desertas_fracassadas', 'Desertas ou fracassadas'], ['outras', 'Suspensas, revogadas e outras']]
          .map(([v, rotulo]) => ({ v, rotulo, n: d.por_visao[v] || 0 })), { aoClicar: (f) => ir({ visao: f.v }) })),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por modalidade'),
        rosca(d.por_modalidade, { aoClicar: (f) => (f.id ? ir({ visao: '', modalidade: f.id }) : null) })),
      h('div', { class: 'cartao', title: 'Sistema que publicou no PNCP (campo usuarioNome).' }, h('h2', {}, 'Por plataforma de origem'),
        rosca(d.por_plataforma, { aoClicar: (f) => ir({ visao: '', plataforma: f.rotulo }) }))),
    h('div', { class: 'grade pares', style: { marginTop: '14px' } },
      h('div', { class: 'cartao' }, h('h2', {}, 'Por estado'), barras(d.por_uf)),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por município'), barras(d.por_municipio)),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por órgão'), barras(d.por_orgao)),
      h('div', { class: 'cartao', title: 'Classificação automática por palavras-chave do objeto (estimativa).' }, h('h2', {}, 'Por segmento'), barras(d.por_segmento)),
    ));
}

// ============================ BUSCA ============================
const FILTROS_PADRAO = { visao: 'abertas', ordenar: 'encerramento_asc' };

// Sistema eletrônico de disputa: nome, custo para o fornecedor e link de cadastro (catálogo em server/services/sistemas.js)
const sistemaInfo = (l, meta) => (l.sistema_eletronico && meta.sistemas ? meta.sistemas[l.sistema_eletronico] : null);
function nomeSistema(l, meta) {
  const s = sistemaInfo(l, meta);
  if (!s) return l.plataforma_origem || naoInformado();
  if (l.sistema_eletronico === 'outro') return l.plataforma_origem || s.nome;
  return h('span', {}, s.nome, ' ', s.custo === 'pago' ? h('span', { class: 'etiqueta vermelha pequena' }, '💲 pago')
    : s.custo === 'gratuito' ? h('span', { class: 'etiqueta verde pequena' }, 'gratuito') : null);
}
const classeSistema = (l, meta) => (sistemaInfo(l, meta)?.custo === 'pago' ? 'pago' : '');
function avisoSistema(l, meta, completo = false) {
  const s = sistemaInfo(l, meta);
  if (!s || (!completo && s.custo !== 'pago')) return null;
  return h('div', { class: `aviso-sistema ${s.custo}` },
    s.custo === 'pago' ? h('strong', {}, `💲 ${s.nome} cobra do fornecedor. `) : h('strong', {}, `${s.nome}: `),
    s.resumo, ' ',
    s.cadastro ? h('a', { href: s.cadastro, target: '_blank', rel: 'noopener noreferrer' }, s.custo === 'pago' ? 'Ver planos e cadastro ↗' : 'Cadastro ↗') : null,
    s.fonte ? h('span', {}, ' · ', h('a', { href: s.fonte, target: '_blank', rel: 'noopener noreferrer', class: 'suave' }, 'fonte')) : null);
}

// Um campo da ficha: rótulo pequeno em cima, valor legível embaixo
const campoFicha = (rotulo, valor, extra = {}) => h('div', { class: 'campo-ficha' + (extra.classe ? ' ' + extra.classe : ''), title: extra.title || '' },
  h('span', { class: 'rotulo' }, rotulo), h('span', { class: 'valor' }, valor));

function linhaLicitacao(l, est, { aoFavoritar } = {}) {
  const prazo = prazoRestante(l.data_encerramento_proposta);
  const diasRestantes = l.data_encerramento_proposta ? (Date.parse(l.data_encerramento_proposta + '-03:00') - Date.now()) / 86400000 : null;
  const urgente = diasRestantes !== null && diasRestantes > 0 && diasRestantes <= 3;
  const itens = l.itens_encontrados || [];
  const resumoItem = (i) => h('li', {}, h('b', {}, `Item ${i.numero_item}: `), i.descricao || '(sem descrição)');
  return h('div', { class: 'cartao item-lic' },
    h('div', {},
      h('a', { class: 'objeto', href: `#/licitacao/${l.id}`, title: l.objeto || '' }, l.objeto || '(objeto não informado)'),
      h('div', { class: 'orgao-local' },
        h('span', { class: 'orgao' }, '🏛 ', l.orgao_nome || naoInformado()),
        h('span', { class: 'local' }, '📍 ', [l.municipio, l.uf].filter(Boolean).join(' / ') || naoInformado())),
      h('div', { class: 'ficha' },
        campoFicha('Modalidade', l.modalidade_nome || naoInformado()),
        campoFicha('Número', l.numero_compra ? `${l.numero_compra}/${l.ano ?? ''}` : naoInformado()),
        campoFicha('Publicação', dataOuNao(l.data_publicacao, false)),
        campoFicha('Propostas até', dataOuNao(l.data_encerramento_proposta), { classe: urgente ? 'urgente' : 'destaque' }),
        campoFicha('Sistema eletrônico', nomeSistema(l, est.meta), { classe: classeSistema(l, est.meta), title: `Publicado no PNCP por: ${l.plataforma_origem || 'não informado'}` })),
      avisoSistema(l, est.meta),
      (l.segmento || l.me_epp_exclusivo === 1) ? h('div', { class: 'linha etiquetas-lic' },
        l.segmento ? h('span', { class: 'etiqueta' }, l.segmento) : null,
        l.me_epp_exclusivo === 1 ? h('span', { class: 'etiqueta verde' }, 'Exclusiva ME/EPP') : null) : null,
      itens.length ? h('details', { class: 'itens-achados' },
        h('summary', {}, h('strong', {}, `🔎 Encontrado em ${l.itens_encontrados_total || itens.length} item(ns)`),
          h('span', { class: 'previa' }, ` · Item ${itens[0].numero_item}: ${itens[0].descricao || '(sem descrição)'}`)),
        h('ul', {}, itens.map(resumoItem)),
        l.itens_encontrados_total > itens.length ? h('div', { class: 'suave pequeno' }, `e mais ${l.itens_encontrados_total - itens.length} item(ns): veja todos no detalhe da licitação.`) : null) : null),
    h('div', { class: 'lado' },
      etiquetaStatus(l.status_calculado, est.meta, l.status_motivo),
      h('span', { class: 'valor-grande', title: l.valor_estimado === 0 ? 'A fonte informou valor estimado zero (comum quando o orçamento é sigiloso).' : '' }, moeda(l.valor_estimado, l.valor_estimado_situacao), l.valor_estimado === 0 ? h('span', { class: 'suave pequeno' }, ' (zero na fonte)') : null),
      prazo ? h('span', { class: 'etiqueta ' + (urgente ? 'vermelha' : 'amarela'), title: 'Tempo restante para envio de propostas' }, `⏱ faltam ${prazo}`) : null,
      h('div', { class: 'linha' },
        aoFavoritar ? h('button', { class: 'btn pequeno', title: 'Favoritar', onclick: () => aoFavoritar(l) }, '☆') : null,
        l.link_pncp ? h('a', { class: 'btn pequeno', href: l.link_pncp, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir no PNCP' }, 'PNCP ↗') : null,
        l.link_origem ? h('a', { class: 'btn pequeno', href: l.link_origem, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir no sistema de origem' }, 'Edital ↗') : null)));
}

// A busca nos itens só alcança licitações cujos itens já foram baixados do PNCP: dizer isso, sem esconder
function avisoCoberturaItens(c, filtros) {
  if (!c || filtros.nos_itens === '0') return null;
  const pncp = h('a', { href: `https://pncp.gov.br/app/editais?q=${encodeURIComponent(filtros.q || filtros.obrigatorias || '')}`, target: '_blank', rel: 'noopener noreferrer' }, 'Procurar também direto no PNCP ↗');
  if (!c.total || c.com_itens >= c.total) {
    return h('div', { class: 'suave pequeno', style: { margin: '6px 0' } }, 'A busca olha o objeto e a descrição de cada item. ', pncp);
  }
  const pct = Math.floor((c.com_itens / c.total) * 100);
  return h('div', { class: 'aviso azul', style: { margin: '6px 0' } },
    h('strong', {}, `Itens baixados para ${numero(c.com_itens)} de ${numero(c.total)} licitações deste filtro (${pct}%). `),
    'A busca olha o objeto de todas e a descrição dos itens só dessas. O sistema baixa o restante sozinho, prazo mais próximo primeiro. ', pncp);
}

export async function buscar(alvo, rota, est) {
  const meta = est.meta;
  const filtros = { ...FILTROS_PADRAO, ...Object.fromEntries(rota.query.entries()) };
  if (rota.query.get('q') || rota.query.get('sessao_proxima')) { if (!rota.query.get('visao')) filtros.visao = ''; }
  const campos = {};
  const inp = (nome, attrs = {}) => (campos[nome] = h('input', { type: 'text', value: filtros[nome] || '', id: `f-${nome}`, ...attrs }));
  const sel = (nome, opcoes, vazioTxt = 'Todos') => (campos[nome] = h('select', { id: `f-${nome}` }, h('option', { value: '' }, vazioTxt),
    opcoes.map(([v, t]) => h('option', { value: v, selected: String(filtros[nome] ?? '') === String(v) }, t))));
  const campo = (rot, el, largo) => h('div', { class: largo ? 'largo' : '' }, h('label', { for: el.id }, rot), el);

  const form = h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); aplicar({ pagina: 1 }); } },
    h('div', { class: 'filtros' },
      campo('Palavras-chave (objeto e itens)', inp('q', { type: 'search', placeholder: 'ex.: mouse, material hospitalar' }), true),
      campo('Procurar em', sel('nos_itens', [['0', 'Só no objeto']], 'Objeto e itens')),
      campo('Palavras obrigatórias', inp('obrigatorias', { placeholder: 'todas devem aparecer' })),
      campo('Excluir palavras', inp('excluir', { placeholder: 'ex.: locação' })),
      campo('Estado (UF)', sel('uf', meta.ufs.map((u) => [u, u]))),
      campo('Município', inp('municipio', { placeholder: 'ex.: Vila Velha' })),
      campo('Órgão (nome ou CNPJ)', inp('orgao')),
      campo('Esfera', sel('esfera', Object.entries(ESF))),
      campo('Modalidade', sel('modalidade', Object.entries(meta.modalidades), 'Todas')),
      campo('Segmento (estimado)', sel('segmento', meta.segmentos.map((s) => [s, s]))),
      campo('Sistema eletrônico', sel('sistema', Object.entries(meta.sistemas || {}).map(([k, x]) => [k, `${x.nome}${x.custo === 'pago' ? ' · pago' : x.custo === 'gratuito' ? ' · gratuito' : ''}`]), 'Todos')),
      campo('Custo do sistema', sel('sistema_custo', [['gratuito', 'Só gratuitos'], ['pago', 'Só pagos'], ['nao_verificado', 'Não verificados']], 'Indiferente')),
      campo('Plataforma de origem (PNCP)', sel('plataforma', meta.plataformas.map((p) => [p, p]), 'Todas')),
      campo('Regime legal', sel('regime_legal', meta.regimes.map((p) => [p, p]))),
      campo('Valor mínimo (R$)', inp('valor_min', { type: 'number', min: 0, step: '0.01' })),
      campo('Valor máximo (R$)', inp('valor_max', { type: 'number', min: 0, step: '0.01' })),
      campo('Publicação de', inp('publicacao_de', { type: 'date' })),
      campo('Publicação até', inp('publicacao_ate', { type: 'date' })),
      campo('Abertura de', inp('abertura_de', { type: 'date' })),
      campo('Abertura até', inp('abertura_ate', { type: 'date' })),
      campo('Prazo restante mínimo (dias)', inp('prazo_min_dias', { type: 'number', min: 0 })),
      campo('Tipo de item', sel('tipo_item', [['Material', 'Material'], ['Serviço', 'Serviço']])),
      campo('Exclusiva ME/EPP', sel('me_epp', [['1', 'Sim'], ['0', 'Não']], 'Indiferente')),
      campo('Registro de preços (SRP)', sel('srp', [['1', 'Sim']], 'Indiferente')),
      campo('Com documentos', sel('com_documentos', [['1', 'Sim']], 'Indiferente')),
      campo('Encerra em até 7 dias', sel('sessao_proxima', [['1', 'Sim']], 'Indiferente')),
      campo('Código CATMAT/CATSER', inp('catalogo')),
      campo('Ordenar por', sel('ordenar', [['encerramento_asc', 'Prazo mais próximo'], ['publicacao_desc', 'Mais recentes'], ['valor_desc', 'Maior valor'], ['valor_asc', 'Menor valor'], ['atualizacao_desc', 'Atualização mais recente']], 'Padrão'))),
    h('div', { class: 'linha', style: { marginTop: '10px' } },
      h('button', { class: 'btn primario', type: 'submit' }, 'Buscar'),
      h('button', { class: 'btn', type: 'button', onclick: () => { location.hash = '#/buscar'; } }, 'Limpar'),
      h('button', { class: 'btn', type: 'button', onclick: salvarPesquisa }, '💾 Salvar pesquisa'),
      h('button', { class: 'btn', type: 'button', onclick: () => exportar('csv') }, '⬇ CSV'),
      h('button', { class: 'btn', type: 'button', onclick: () => exportar('xlsx') }, '⬇ Excel')));

  const lerFiltros = () => {
    const f = { visao: filtros.visao };
    for (const [k, el] of Object.entries(campos)) if (el.value !== '') f[k] = el.value.trim();
    return f;
  };
  const aplicar = (extra = {}) => {
    const f = { ...lerFiltros(), ...extra };
    location.hash = `#/buscar${qs(f)}`;
  };
  async function salvarPesquisa() {
    const nome = window.prompt('Nome da pesquisa:');
    if (!nome) return;
    const alertar = confirmar('Deseja receber alerta quando surgirem novas licitações compatíveis?');
    try { await api('/pesquisas', { metodo: 'POST', corpo: { nome, filtros: lerFiltros(), alertar } }); toast('Pesquisa salva.'); }
    catch (e) { toast(e.message); }
  }
  function exportar(formato) {
    window.location.href = `/api/licitacoes/exportar${qs({ ...lerFiltros(), formato })}`;
  }

  const contagens = await api('/dashboard').then((d) => d.por_visao).catch(() => ({}));
  const abas = h('div', { class: 'abas', role: 'tablist' },
    [['', 'Todas'], ...Object.entries(meta.visoes)].map(([v, rot]) => h('button', {
      class: (filtros.visao || '') === v ? 'ativo' : '', role: 'tab',
      onclick: () => { filtros.visao = v; aplicar({ pagina: 1, visao: v }); },
    }, rot, v && contagens[v] != null ? h('span', { class: 'contagem' }, numero(contagens[v])) : null)));

  const lista = h('div', { class: 'resultado' }, carregando());
  const pesquisas = h('div', { class: 'linha', style: { margin: '10px 0' } });
  render(alvo, cabecalho('Buscar licitações', 'Pesquisa em todas as fontes habilitadas, sem duplicidades.'), abas, form, pesquisas, lista);

  api('/pesquisas').then((ps) => {
    if (!ps.length) return;
    pesquisas.replaceChildren(h('span', { class: 'suave pequeno' }, 'Pesquisas salvas:'),
      ps.map((p) => h('a', { class: 'btn pequeno', href: `#/buscar${qs(JSON.parse(p.filtros_json))}` }, p.alertar ? '🔔 ' : '', p.nome)));
  }).catch(() => {});

  const favoritar = async (l) => {
    try { await api('/favoritos', { metodo: 'POST', corpo: { tipo: 'licitacao', referencia: String(l.id) } }); toast('Adicionado aos favoritos.'); }
    catch (e) { toast(e.message); }
  };
  try {
    const res = await api(`/licitacoes${qs({ ...filtros, tamanho: 20 })}`);
    const aviso = avisoCoberturaItens(res.cobertura_itens, filtros);
    if (!res.total) { render(lista, aviso, vazio('Nenhuma licitação encontrada com esses filtros.')); return; }
    render(lista, aviso,
      h('div', { class: 'suave pequeno' }, `${numero(res.total)} licitação(ões) encontrada(s).`),
      ...res.dados.map((l) => linhaLicitacao(l, est, { aoFavoritar: favoritar })),
      h('div', { class: 'paginacao' },
        h('button', { class: 'btn', disabled: res.pagina <= 1, onclick: () => aplicar({ pagina: res.pagina - 1 }) }, '← Anterior'),
        h('span', { class: 'suave' }, `Página ${res.pagina} de ${res.paginas}`),
        h('button', { class: 'btn', disabled: res.pagina >= res.paginas, onclick: () => aplicar({ pagina: res.pagina + 1 }) }, 'Próxima →')));
  } catch (e) { render(lista, erroBox(e)); }
}

// ============================ DETALHE ============================
export async function detalhe(alvo, rota, est) {
  render(alvo, carregando());
  const id = rota.args[0];
  const d = await api(`/licitacoes/${id}`);
  const l = d.licitacao;
  const ni = (v) => (v === null || v === undefined || v === '' ? naoInformado() : v);
  const linha = (rot, val) => [h('dt', {}, rot), h('dd', {}, val)];

  const btnFav = h('button', { class: 'btn', onclick: async () => {
    try {
      if (d.favorito) await api(`/favoritos${qs({ tipo: 'licitacao', referencia: l.id })}`, { metodo: 'DELETE' });
      else await api('/favoritos', { metodo: 'POST', corpo: { tipo: 'licitacao', referencia: String(l.id) } });
      d.favorito = !d.favorito; btnFav.textContent = d.favorito ? '★ Favorita' : '☆ Favoritar';
    } catch (e) { toast(e.message); }
  } }, d.favorito ? '★ Favorita' : '☆ Favoritar');
  const emFoco = empresaEmFoco(est);
  const btnKanban = d.oportunidade
    ? h('a', { class: 'btn', href: '#/kanban' }, `Kanban: ${d.oportunidade.etapa_nome}`)
    : podeEditar(est) ? h('button', { class: 'btn primario', onclick: async () => {
      try { await api('/kanban', { metodo: 'POST', corpo: { licitacao_id: l.id } }); toast(emFoco ? `Enviada ao Kanban de ${nomeEmpresa(emFoco)}.` : 'Enviada ao Kanban.'); detalhe(alvo, rota, est); } catch (e) { toast(e.message); }
    } }, emFoco ? `+ Kanban de ${nomeEmpresa(emFoco)}` : '+ Acompanhar no Kanban') : null;
  const empresasDaLic = d.empresas?.length ? h('div', { class: 'suave pequeno', style: { marginTop: '6px' } }, '🏢 Acompanhada por: ',
    d.empresas.map((e, i) => [i ? ', ' : '', h('a', { href: `#/empresas/${e.id}` }, e.nome)])) : null;
  const btnAtualizar = podeEditar(est) && l.numero_controle_pncp ? h('button', { class: 'btn', onclick: async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/licitacoes/${l.id}/atualizar`, { metodo: 'POST', corpo: {} }); toast(r.ok ? `Atualizado: ${r.itens} itens, ${r.documentos} documentos.` : r.mensagem); detalhe(alvo, rota, est); }
    catch (er) { toast(er.message, 6000); e.target.disabled = false; }
  } }, '↻ Atualizar itens e documentos') : null;

  const valorEst = l.valor_estimado_situacao === 'sigiloso' ? h('span', { class: 'etiqueta' }, 'Sigiloso')
    : l.valor_estimado === null ? naoInformado() : l.valor_estimado === 0 ? h('span', {}, moeda(0), h('span', { class: 'suave pequeno' }, ' (zero informado pela fonte)')) : moeda(l.valor_estimado);

  render(alvo, 
    h('button', { class: 'btn pequeno', onclick: () => history.back() }, '← Voltar'),
    cabecalho(l.objeto ? (l.objeto.length > 140 ? l.objeto.slice(0, 140) + '…' : l.objeto) : 'Licitação', null, btnFav, btnKanban, btnAtualizar,
      l.link_pncp ? h('a', { class: 'btn', href: l.link_pncp, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no PNCP ↗') : null,
      l.link_origem ? h('a', { class: 'btn', href: l.link_origem, target: '_blank', rel: 'noopener noreferrer' }, 'Sistema de origem ↗') : null),
    h('div', { class: 'aviso azul' }, h('strong', {}, 'Status: '), etiquetaStatus(l.status_calculado, est.meta), ' ', l.status_motivo || '',
      h('div', { class: 'pequeno', style: { marginTop: '4px' } }, `Situação oficial na fonte: ${l.situacao_oficial_nome || 'não informada'}. `,
        d.oportunidade ? `Etapa interna${emFoco ? ` (${nomeEmpresa(emFoco)})` : ''}: ${d.oportunidade.etapa_nome}.` : `Ainda não acompanhada no Kanban${emFoco ? ` de ${nomeEmpresa(emFoco)}` : ''}.`), empresasDaLic),
    h('div', { class: 'grade duas' },
      h('div', { class: 'cartao' }, h('h2', {}, 'Dados da contratação'), h('dl', { class: 'detalhes' },
        linha('Objeto', ni(l.objeto)),
        linha('Número', l.numero_compra ? `${l.numero_compra}/${l.ano ?? ''}` : naoInformado()),
        linha('Processo administrativo', ni(l.processo)),
        linha('Identificador PNCP', ni(l.numero_controle_pncp)),
        linha('Modalidade', ni(l.modalidade_nome)),
        linha('Instrumento', ni(l.tipo_instrumento)),
        linha('Amparo legal', ni(l.amparo_legal)),
        linha('Regime jurídico', l.regime_legal || naoInformado('Não identificado')),
        linha('Modo de disputa', ni(l.modo_disputa_nome)),
        linha('Critério de julgamento', l.criterio_julgamento || naoInformado(l.detalhes_sincronizados_em ? 'Não informado' : 'Itens ainda não sincronizados')),
        linha('Registro de preços', l.srp === 1 ? 'Sim' : l.srp === 0 ? 'Não' : naoInformado()),
        linha('Exclusiva ME/EPP', l.me_epp_exclusivo === 1 ? 'Sim (todos os itens)' : l.me_epp_exclusivo === 0 ? 'Não' : naoInformado('Não verificado')),
        linha('Segmento (estimado)', ni(l.segmento)),
        linha('Informação complementar', ni(l.informacao_complementar)))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Órgão, prazos e valores'), h('dl', { class: 'detalhes' },
        linha('Órgão', ni(l.orgao_nome)),
        linha('CNPJ', ni(l.orgao_cnpj)),
        linha('Unidade', l.unidade_nome ? `${l.unidade_nome}${l.unidade_codigo ? ` (${l.unidade_codigo})` : ''}` : naoInformado()),
        linha('Esfera', l.esfera ? ESF[l.esfera] || l.esfera : naoInformado()),
        linha('Local', [l.municipio, l.uf].filter(Boolean).join(' / ') || naoInformado()),
        linha('Publicação', dataOuNao(l.data_publicacao)),
        linha('Início das propostas', dataOuNao(l.data_abertura_proposta)),
        linha('Fim das propostas', dataOuNao(l.data_encerramento_proposta)),
        linha('Sessão de disputa', l.data_sessao ? data(l.data_sessao) : naoInformado('Não informada pela fonte')),
        linha('Valor estimado', valorEst),
        linha('Valor homologado', l.valor_homologado == null ? naoInformado() : moeda(l.valor_homologado)),
        linha('Sistema eletrônico', h('div', {}, nomeSistema(l, est.meta), avisoSistema(l, est.meta, true))),
        linha('Publicado no PNCP por', ni(l.plataforma_origem)),
        linha('Fontes', d.fontes.map((f) => `${f.fonte_codigo} (desde ${dataUtc(f.primeira_vez)})`).join('; ')),
        linha('Última verificação', dataUtc(l.ultima_verificacao)),
        linha('Itens/documentos sincronizados', l.detalhes_sincronizados_em ? dataUtc(l.detalhes_sincronizados_em) : naoInformado('Ainda não'))))),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, `Itens (${d.itens.length})`),
      d.itens.length ? h('div', { class: 'tabela-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Nº', 'Descrição', 'Tipo', 'Qtd.', 'Unid.', 'Valor unit. estimado', 'Valor total', 'Benefício', 'Situação'].map((t) => h('th', {}, t)))),
        h('tbody', {}, d.itens.map((i) => h('tr', {},
          h('td', {}, i.numero_item), h('td', {}, i.descricao || '—'), h('td', {}, i.material_servico || '—'),
          h('td', {}, numero(i.quantidade)), h('td', {}, i.unidade_medida || '—'),
          h('td', {}, i.orcamento_sigiloso ? 'Sigiloso' : moeda(i.valor_unitario_estimado)),
          h('td', {}, i.orcamento_sigiloso ? 'Sigiloso' : moeda(i.valor_total_estimado)),
          h('td', {}, i.tipo_beneficio_nome || '—'), h('td', {}, i.situacao_item_nome || '—'))))))
        : vazio(l.detalhes_sincronizados_em ? 'A fonte não retornou itens.' : 'Itens ainda não sincronizados.')),
    d.contratos?.length ? h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, `Contratos assinados (${d.contratos.length})`),
      h('div', { class: 'tabela-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Fornecedor', 'Valor global', 'Assinatura', 'Vigência', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, d.contratos.map((c) => h('tr', {},
          h('td', {}, c.fornecedor_nome || naoInformado(), c.fornecedor_ni ? h('div', { class: 'suave pequeno' }, fmtDoc(c.fornecedor_ni)) : null),
          h('td', {}, c.valor_global == null ? naoInformado() : moeda(c.valor_global)),
          h('td', {}, dataOuNao(c.data_assinatura, false)),
          h('td', {}, `${data(c.vigencia_inicio, false) || '?'} a ${data(c.vigencia_fim, false) || '?'}`),
          h('td', {}, c.link_pncp ? h('a', { href: c.link_pncp, target: '_blank', rel: 'noopener noreferrer' }, 'PNCP ↗') : null))))))) : null,
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, `Documentos e anexos (${d.documentos.length})`),
      d.documentos.length ? h('ul', {}, d.documentos.map((doc) => h('li', {},
        h('a', { href: doc.url, target: '_blank', rel: 'noopener noreferrer' }, `${doc.tipo || 'Documento'} — ${doc.titulo || doc.sequencial}`),
        h('span', { class: 'suave pequeno' }, ` · ${data(doc.data_publicacao) || ''}${doc.ativo === 0 ? ' · inativo' : ''}`))))
        : vazio(l.detalhes_sincronizados_em ? 'Nenhum documento publicado na fonte.' : 'Documentos ainda não sincronizados.')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Histórico de alterações e eventos'),
      d.eventos.length ? d.eventos.map((e) => h('div', { class: 'evento' },
        h('div', { class: 'quando' }, dataUtc(e.detectado_em), e.ocorrido_em ? h('div', {}, `fonte: ${data(e.ocorrido_em)}`) : null),
        h('div', {}, h('span', { class: 'etiqueta' }, e.tipo), ' ', e.descricao,
          e.valor_anterior != null ? h('div', { class: 'suave pequeno' }, `De: ${e.valor_anterior} → Para: ${e.valor_novo}`) : null)))
        : vazio('Sem eventos.')));
}

// ============================ JORNAL ============================
const TIPOS_EVENTO = { publicacao: 'Nova publicação', alteracao: 'Alteração/retificação', situacao: 'Mudança de situação', documento: 'Novo documento', resultado: 'Resultado/homologação', item: 'Item' };
export async function jornal(alvo, rota, est) {
  const f = Object.fromEntries(rota.query.entries());
  const q = h('input', { type: 'search', value: f.q || '', placeholder: 'Palavra-chave', id: 'j-q' });
  const tipo = h('select', { id: 'j-tipo' }, h('option', { value: '' }, 'Todos os tipos'), Object.entries(TIPOS_EVENTO).map(([k, v]) => h('option', { value: k, selected: f.tipo === k }, v)));
  const uf = h('select', { id: 'j-uf' }, h('option', { value: '' }, 'Todas as UFs'), est.meta.ufs.map((u) => h('option', { value: u, selected: f.uf === u }, u)));
  const seg = h('select', { id: 'j-seg' }, h('option', { value: '' }, 'Todos os segmentos'), est.meta.segmentos.map((s) => h('option', { value: s, selected: f.segmento === s }, s)));
  const orgao = h('input', { type: 'text', value: f.orgao || '', placeholder: 'Órgão', id: 'j-org' });
  const ir = (pagina = 1) => { location.hash = `#/jornal${qs({ q: q.value, tipo: tipo.value, uf: uf.value, segmento: seg.value, orgao: orgao.value, pagina })}`; };
  const lista = h('div', {}, carregando());
  render(alvo, cabecalho('Jornal de licitações', 'Feed cronológico de publicações, alterações, documentos, mudanças de situação e resultados detectados nas sincronizações.'),
    h('form', { class: 'cartao filtros', onsubmit: (e) => { e.preventDefault(); ir(); } }, q, tipo, uf, seg, orgao, h('button', { class: 'btn primario' }, 'Filtrar')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, lista));
  const r = await api(`/jornal${qs(f)}`);
  if (!r.total) return render(lista, vazio('Nenhum evento registrado ainda.'));
  render(lista, ...r.dados.map((e) => h('div', { class: 'evento' },
    h('div', { class: 'quando' }, dataUtc(e.detectado_em)),
    h('div', {}, h('span', { class: 'etiqueta azul' }, TIPOS_EVENTO[e.tipo] || e.tipo), ' ',
      h('a', { href: `#/licitacao/${e.licitacao_id}` }, (e.objeto || '').slice(0, 180)),
      h('div', { class: 'suave pequeno' }, `${e.descricao} · ${e.orgao_nome || ''} · ${[e.municipio, e.uf].filter(Boolean).join('/')}`),
      e.valor_anterior != null ? h('div', { class: 'suave pequeno' }, `De: ${e.valor_anterior} → Para: ${e.valor_novo}`) : null))),
  h('div', { class: 'paginacao' },
    h('button', { class: 'btn', disabled: r.pagina <= 1, onclick: () => ir(r.pagina - 1) }, '← Anterior'),
    h('span', { class: 'suave' }, `Página ${r.pagina} de ${r.paginas}`),
    h('button', { class: 'btn', disabled: r.pagina >= r.paginas, onclick: () => ir(r.pagina + 1) }, 'Próxima →')));
}

// ============================ FAVORITOS ============================
export async function favoritos(alvo, _r, est) {
  render(alvo, carregando());
  const { favoritos: favs, licitacoes: lics } = await api('/favoritos');
  const outros = favs.filter((f) => f.tipo !== 'licitacao');
  const porId = new Map(lics.map((l) => [String(l.id), l]));
  const licitacoes = favs.filter((f) => f.tipo === 'licitacao' && porId.has(f.referencia)).map((f) => ({ ...porId.get(f.referencia), fav: f }));
  const remover = async (fav) => { await api(`/favoritos${qs({ id: fav.id })}`, { metodo: 'DELETE' }); favoritos(alvo, _r, est); };
  render(alvo, cabecalho('Favoritos', 'Licitações, órgãos e pesquisas que você acompanha.'),
    avisoEmpresa(est, 'Favoritos'),
    h('h2', {}, `Licitações (${licitacoes.length})`),
    licitacoes.length ? h('div', { class: 'resultado' }, licitacoes.map((l) => h('div', { class: 'cartao item-lic' },
      h('div', {}, h('a', { class: 'objeto', href: `#/licitacao/${l.id}` }, l.objeto || '—'),
        h('div', { class: 'meta' }, h('span', {}, l.orgao_nome || ''), h('span', {}, [l.municipio, l.uf].filter(Boolean).join('/')), h('span', {}, 'Propostas até: ', dataOuNao(l.data_encerramento_proposta)),
          !clienteSelecionado() ? h('span', { class: 'etiqueta empresa' }, `🏢 ${l.fav.cliente_nome || 'Sem empresa'}`) : null)),
      h('div', { class: 'lado' }, etiquetaStatus(l.status_calculado, est.meta), moeda(l.valor_estimado, l.valor_estimado_situacao),
        h('button', { class: 'btn pequeno perigo', onclick: () => remover(l.fav) }, 'Remover')))))
      : vazio('Nenhuma licitação favorita. Use ☆ na busca.'),
    outros.length ? h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Outros favoritos'),
      h('ul', {}, outros.map((f) => h('li', {}, `${f.tipo}: ${f.referencia} `, h('button', { class: 'btn pequeno', onclick: () => remover(f) }, 'Remover'))))) : null);
}

// ============================ KANBAN ============================
const TIPO_HIST = { criacao: 'Criação', movimento: 'Mudou de etapa', comentario: 'Comentário', atribuicao: 'Responsável', prazo: 'Prazo interno' };
export async function kanban(alvo, _r, est) {
  render(alvo, carregando());
  const k = await api('/kanban');
  const mover = async (cardId, etapaId) => {
    try { await api(`/kanban/${cardId}`, { metodo: 'PATCH', corpo: { etapa_id: Number(etapaId) } }); kanban(alvo, _r, est); }
    catch (e) { toast(e.message); }
  };
  const abrir = async (c) => {
    const hist = await api(`/kanban/${c.id}/historico`);
    const txt = h('textarea', { rows: 3, placeholder: 'Comentário…' });
    const resp = h('select', {}, h('option', { value: '' }, 'Sem responsável'), k.usuarios.map((u) => h('option', { value: u.id, selected: u.id === c.responsavel_id }, u.nome)));
    const prazo = h('input', { type: 'date', value: c.prazo_interno || '' });
    modal(c.objeto?.slice(0, 90) || 'Oportunidade', h('div', {},
      h('p', {}, h('a', { href: `#/licitacao/${c.licitacao_id}` }, 'Abrir licitação'), ' · Situação oficial: ', etiquetaStatus(c.status_calculado, est.meta)),
      h('div', { class: 'campo' }, h('label', {}, 'Responsável'), resp),
      h('div', { class: 'campo' }, h('label', {}, 'Prazo interno'), prazo),
      h('div', { class: 'campo' }, h('label', {}, 'Novo comentário'), txt),
      h('h3', {}, 'Histórico'),
      h('div', { class: 'pequeno' }, hist.map((x) => h('div', { class: 'evento' }, h('div', { class: 'quando' }, dataUtc(x.criado_em)), h('div', {}, h('strong', {}, x.usuario_nome || ''), ` · ${TIPO_HIST[x.tipo] || x.tipo}: ${x.texto || ''}`))))),
    podeEditar(est) ? [
      { texto: 'Salvar', classe: 'primario', acao: async () => {
        try {
          await api(`/kanban/${c.id}`, { metodo: 'PATCH', corpo: { responsavel_id: resp.value ? Number(resp.value) : null, prazo_interno: prazo.value || null } });
          if (txt.value.trim()) await api(`/kanban/${c.id}/comentarios`, { metodo: 'POST', corpo: { texto: txt.value.trim() } });
          kanban(alvo, _r, est);
        } catch (e) { toast(e.message); return false; }
      } },
      ...(est.usuario.papel !== 'analista' ? [{ texto: 'Remover do Kanban', classe: 'perigo', acao: async () => {
        if (!confirmar('Remover esta oportunidade do Kanban?')) return false;
        await api(`/kanban/${c.id}`, { metodo: 'DELETE' }); kanban(alvo, _r, est);
      } }] : []),
    ] : []);
  };

  const colunas = k.etapas.map((et) => {
    const col = h('div', { class: 'coluna-k', 'data-etapa': et.id },
      h('h3', {}, h('span', {}, et.nome), h('span', { class: 'etiqueta' }, k.cards.filter((c) => c.etapa_id === et.id).length)),
      k.cards.filter((c) => c.etapa_id === et.id).map((c) => {
        const card = h('div', { class: 'cartao-k', draggable: podeEditar(est) ? 'true' : 'false', 'data-id': c.id },
          h('div', { class: 't' }, c.objeto || '—'),
          h('div', { class: 'suave' }, c.orgao_nome || ''),
          h('div', { class: 'linha', style: { marginTop: '6px' } }, etiquetaStatus(c.status_calculado, est.meta),
            c.data_encerramento_proposta ? h('span', { class: 'suave' }, `até ${data(c.data_encerramento_proposta)}`) : null),
          c.responsavel_nome ? h('div', { class: 'suave' }, `👤 ${c.responsavel_nome}`) : null,
          !clienteSelecionado() && est.clientes?.length ? h('div', { class: 'etiqueta empresa', style: { marginTop: '6px' } }, `🏢 ${c.cliente_nome || 'Sem empresa'}`) : null,
          podeEditar(est) ? h('select', { 'aria-label': 'Mover para', onclick: (e) => e.stopPropagation(), onchange: (e) => mover(c.id, e.target.value) },
            k.etapas.map((e2) => h('option', { value: e2.id, selected: e2.id === c.etapa_id }, `Mover: ${e2.nome}`))) : null);
        card.addEventListener('click', () => abrir(c));
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(c.id)); card.classList.add('arrastando'); });
        card.addEventListener('dragend', () => card.classList.remove('arrastando'));
        return card;
      }));
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('sobre'); });
    col.addEventListener('dragleave', () => col.classList.remove('sobre'));
    col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('sobre'); const id = e.dataTransfer.getData('text/plain'); if (id) mover(id, et.id); });
    return col;
  });
  render(alvo, cabecalho('Kanban de oportunidades', 'Etapas internas da sua empresa. A situação oficial da licitação aparece na etiqueta e é independente da etapa.'),
    avisoEmpresa(est, 'Cards'),
    k.cards.length ? null : h('div', { class: 'aviso azul' }, 'Nenhuma oportunidade ainda. Abra uma licitação e clique em "+ Acompanhar no Kanban".'),
    h('div', { class: 'kanban' }, colunas));
}

// ============================ CALENDÁRIO (Fase 3) ============================
const TIPO_CAL = { abertura: ['Início das propostas', 'verde'], encerramento: ['Fim das propostas', 'vermelha'], prazo_interno: ['Prazo interno', 'azul'], vencimento: ['Vencimento de certidão', 'amarela'] };
const linkCal = (e) => (e.licitacao_id ? `#/licitacao/${e.licitacao_id}` : `#/empresas/${e.cliente_id}`);
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const iso = (d) => d.toISOString().slice(0, 10);

export async function calendario(alvo, rota, est) {
  render(alvo, carregando());
  const hojeIso = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const mesParam = /^\d{4}-\d{2}$/.test(rota.query.get('mes') || '') ? rota.query.get('mes') : hojeIso.slice(0, 7);
  const [ano, mes] = mesParam.split('-').map(Number);
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
  const ultimo = new Date(Date.UTC(ano, mes, 0));
  const inicioGrade = new Date(primeiro.getTime() - primeiro.getUTCDay() * 86400000);
  const fimGrade = new Date(ultimo.getTime() + (6 - ultimo.getUTCDay()) * 86400000);
  const [eventos, proximos, link] = await Promise.all([
    api(`/calendario${qs({ de: iso(inicioGrade), ate: iso(fimGrade) })}`),
    api(`/calendario${qs({ de: hojeIso, ate: iso(new Date(Date.parse(hojeIso) + 30 * 86400000)) })}`),
    api('/calendario/link'),
  ]);
  const irMes = (delta) => { const d = new Date(Date.UTC(ano, mes - 1 + delta, 1)); location.hash = `#/calendario?mes=${iso(d).slice(0, 7)}`; };
  const porDia = {};
  for (const e of eventos) (porDia[e.quando.slice(0, 10)] ||= []).push(e);
  const chip = (e) => h('a', { class: `chip-cal ${TIPO_CAL[e.tipo][1]}`, href: linkCal(e), title: `${e.tipo === 'vencimento' ? e.titulo : TIPO_CAL[e.tipo][0]}${e.dia_inteiro ? '' : ' às ' + e.quando.slice(11, 16)} · ${e.objeto || ''} · ${e.orgao_nome || ''}` },
    e.dia_inteiro ? '' : h('b', {}, e.quando.slice(11, 16) + ' '), (e.objeto || '—').slice(0, 40));
  const celulas = [];
  for (let d = inicioGrade; d <= fimGrade; d = new Date(d.getTime() + 86400000)) {
    const k = iso(d); const evs = porDia[k] || [];
    celulas.push(h('div', { class: `dia-cal${d.getUTCMonth() !== mes - 1 ? ' fora' : ''}${k === hojeIso ? ' hoje' : ''}` },
      h('div', { class: 'num' }, String(d.getUTCDate())),
      evs.slice(0, 3).map(chip),
      evs.length > 3 ? h('div', { class: 'suave pequeno' }, `+${evs.length - 3}`) : null));
  }
  const assinar = async () => {
    if (link.ativo && !confirmar('Gerar um novo link desativa o link anterior. Continuar?')) return;
    try {
      const r = await api('/calendario/link', { metodo: 'POST', corpo: {} });
      const campo = h('input', { type: 'text', value: r.url, readonly: true, onclick: (e) => e.target.select() });
      modal('Assinar o calendário', h('div', {},
        h('p', {}, 'Copie o link abaixo. Ele aparece só agora; se perder, gere outro.'), campo,
        h('ol', { class: 'pequeno' },
          h('li', {}, 'Google Agenda (no computador): "Outras agendas" → "+" → "Do URL" → cole o link → "Adicionar agenda".'),
          h('li', {}, 'iPhone: Ajustes → Calendário → Contas → Adicionar conta → Outra → Adicionar calendário assinado.'),
          h('li', {}, 'O Google atualiza agendas assinadas por conta própria, normalmente em algumas horas.')),
        h('p', { class: 'suave pequeno' }, 'Quem tiver o link vê os seus prazos. Não compartilhe; se vazar, gere um novo.')),
      [{ texto: 'Copiar link', classe: 'primario', acao: async () => { try { await navigator.clipboard.writeText(r.url); toast('Link copiado.'); } catch { campo.select(); return false; } } }, { texto: 'Fechar' }]);
      link.ativo = true;
    } catch (e) { toast(e.message); }
  };
  const revogar = async () => {
    if (!confirmar('Desativar o link? Agendas que assinam este calendário param de atualizar.')) return;
    await api('/calendario/link', { metodo: 'DELETE' }); toast('Link desativado.'); calendario(alvo, rota, est);
  };
  render(alvo,
    avisoEmpresa(est, 'Prazos e vencimentos'),
    cabecalho('Calendário de prazos', 'Licitações favoritas e do Kanban e vencimento das certidões. Horários de Brasília, conforme a fonte oficial.',
      h('a', { class: 'btn', href: '/api/calendario.ics' }, '⬇ Baixar .ics'),
      h('button', { class: 'btn primario', onclick: assinar }, link.ativo ? 'Gerar novo link de assinatura' : 'Assinar no Google Agenda / celular'),
      link.ativo ? h('button', { class: 'btn', onclick: revogar }, 'Desativar link') : null),
    h('div', { class: 'cartao' },
      h('div', { class: 'linha', style: { justifyContent: 'space-between', marginBottom: '10px' } },
        h('div', { class: 'linha' }, h('button', { class: 'btn', 'aria-label': 'Mês anterior', onclick: () => irMes(-1) }, '←'),
          h('h2', { style: { margin: 0, minWidth: '170px', textAlign: 'center' } }, `${MESES[mes - 1]} de ${ano}`),
          h('button', { class: 'btn', 'aria-label': 'Próximo mês', onclick: () => irMes(1) }, '→'),
          h('button', { class: 'btn', onclick: () => { location.hash = '#/calendario'; } }, 'Hoje')),
        h('div', { class: 'linha pequeno' }, Object.values(TIPO_CAL).map(([t, c]) => h('span', { class: `etiqueta ${c}` }, t)))),
      h('div', { class: 'grade-cal' }, ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => h('div', { class: 'cab-cal' }, d)), celulas)),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Próximos 30 dias'),
      proximos.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('tbody', {}, proximos.map((e) => h('tr', {},
        h('td', { style: { whiteSpace: 'nowrap' } }, e.dia_inteiro ? data(e.quando, false) : data(e.quando)),
        h('td', {}, h('span', { class: `etiqueta ${TIPO_CAL[e.tipo][1]}` }, TIPO_CAL[e.tipo][0])),
        h('td', {}, h('a', { href: linkCal(e) }, e.tipo === 'vencimento' ? `${e.titulo} · ${e.objeto}` : e.objeto || '—'), h('div', { class: 'suave pequeno' }, [e.orgao_nome, [e.municipio, e.uf].filter(Boolean).join('/'), e.etapa && `Kanban: ${e.etapa}`].filter(Boolean).join(' · '))))))))
        : vazio('Nenhum prazo nos próximos 30 dias. Favorite licitações (☆) ou coloque-as no Kanban para vê-las aqui.')));
}

// ============================ NOTIFICAÇÕES E PESQUISAS ============================
export async function notificacoes(alvo, _r, est) {
  render(alvo, carregando());
  const [ns, ps] = await Promise.all([api('/notificacoes'), api('/pesquisas')]);
  render(alvo, avisoEmpresa(est, 'Alertas e pesquisas salvas'), cabecalho('Alertas', 'Prazos, vencimento de certidões, mudanças nos editais acompanhados e novas licitações das pesquisas salvas.',
    h('button', { class: 'btn', onclick: async () => { await api('/notificacoes/lidas', { metodo: 'POST', corpo: {} }); window.dispatchEvent(new Event('atualizar-sino')); notificacoes(alvo, _r, est); } }, 'Marcar todas como lidas')),
  h('div', { class: 'aviso azul' }, 'Você recebe alertas automáticos das licitações favoritas e das que estão no Kanban: 3 dias e 1 dia antes do fim das propostas, prazo interno no dia anterior e quando o edital muda (alteração, documento, situação ou resultado). Envio por e-mail em ',
    h('a', { href: '#/configuracoes' }, 'Configurações'), '. WhatsApp: depende de provedor oficial autorizado (pendente).'),
  h('div', { class: 'grade duas' },
    h('div', { class: 'cartao' }, h('h2', {}, 'Notificações'),
      ns.length ? ns.map((n) => h('div', { class: 'evento' }, h('div', { class: 'quando' }, dataUtc(n.criado_em), n.lida ? '' : h('div', { class: 'etiqueta azul' }, 'nova')),
        h('div', {}, h('strong', {}, n.titulo),
          n.cliente_id && !clienteSelecionado() ? h('span', { class: 'etiqueta empresa', style: { marginLeft: '6px' } }, `🏢 ${n.cliente_nome || ''}`) : null,
          h('div', { class: 'pequeno' }, n.licitacao_id ? h('a', { href: `#/licitacao/${n.licitacao_id}` }, n.mensagem)
            : n.tipo === 'vencimento' && n.cliente_id ? h('a', { href: `#/empresas/${n.cliente_id}` }, n.mensagem) : n.mensagem))))
        : vazio('Sem notificações.')),
    h('div', { class: 'cartao' }, h('h2', {}, 'Pesquisas salvas'),
      ps.length ? h('table', {}, h('tbody', {}, ps.map((p) => h('tr', {},
        h('td', {}, h('a', { href: `#/buscar${qs(JSON.parse(p.filtros_json))}` }, p.nome)),
        h('td', {}, h('label', { class: 'linha' }, h('input', { type: 'checkbox', checked: !!p.alertar, onchange: async (e) => { await api(`/pesquisas/${p.id}`, { metodo: 'PATCH', corpo: { alertar: e.target.checked } }); toast('Alerta atualizado.'); } }), 'Alertar')),
        h('td', {}, h('button', { class: 'btn pequeno perigo', onclick: async () => { if (confirmar('Excluir pesquisa?')) { await api(`/pesquisas/${p.id}`, { metodo: 'DELETE' }); notificacoes(alvo, _r, est); } } }, 'Excluir'))))))
        : vazio('Nenhuma pesquisa salva. Salve uma pesquisa na tela de busca.'))));
}

// ============================ FONTES DE DADOS ============================
const ROT_IMPL = { funcional: ['Funcional', 'verde'], parcial: ['Parcial', 'amarela'], aguardando_credenciais: ['Aguardando credenciais', 'amarela'], indisponivel: ['Indisponível', 'vermelha'] };
const ROT_CON = { ok: ['Conectada', 'verde'], erro: ['Erro', 'vermelha'], bloqueada_rede: ['Rede bloqueada', 'vermelha'], nao_testada: ['Não testada', ''], desabilitada: ['Desabilitada', ''] };
const TIPO_INT = { api_rest: 'API REST oficial', dados_abertos: 'Dados abertos oficiais', via_pncp: 'Indireta via PNCP', manual: 'Manual', indisponivel: 'Indisponível' };

export async function fontes(alvo, _r, est) {
  render(alvo, carregando());
  const fs = await api('/fontes');
  const admin = ehAdmin(est);
  const acao = async (btn, caminho, corpo = {}) => {
    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Executando…';
    try { const r = await api(caminho, { metodo: 'POST', corpo }); toast(r.mensagem || JSON.stringify(r), 7000); }
    catch (e) { toast(e.message, 7000); }
    finally { btn.disabled = false; btn.textContent = t; fontes(alvo, _r, est); }
  };
  const verExecucoes = async (f) => {
    const ex = await api(`/fontes/${f.codigo}/execucoes`);
    modal(`Execuções — ${f.nome}`, ex.length ? h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Início', 'Tipo', 'Status', 'Lidos', 'Novos', 'Atual.', 'Falhas', 'Mensagem'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ex.map((e) => h('tr', {}, h('td', {}, dataUtc(e.iniciado_em)), h('td', {}, e.tipo), h('td', {}, e.status), h('td', {}, e.registros_lidos), h('td', {}, e.inseridos), h('td', {}, e.atualizados), h('td', {}, e.falhas), h('td', { class: 'pequeno' }, e.mensagem || ''))))))
      : vazio('Nenhuma execução.'));
  };
  const configurar = (f) => {
    const ufs = h('input', { type: 'text', value: (f.config.ufs || []).join(','), placeholder: 'vazio = todo o Brasil (ex.: ES,RJ)' });
    const mods = h('input', { type: 'text', value: (f.config.modalidades || []).join(',') });
    const dias = h('input', { type: 'number', min: 1, max: 30, value: f.config.diasRetroativos ?? 3 });
    const freq = h('input', { type: 'number', min: 15, value: f.frequencia_minutos });
    modal(`Configurar ${f.nome}`, h('div', {},
      h('div', { class: 'campo' }, h('label', {}, 'UFs (separadas por vírgula)'), ufs),
      f.codigo === 'pncp_contratos' ? h('div', { class: 'suave pequeno' }, 'Contratos: o PNCP não filtra por UF; as UFs acima só limitam o que é guardado.')
        : h('div', { class: 'campo' }, h('label', {}, 'Códigos de modalidade'), mods,
          h('div', { class: 'suave pequeno' }, f.codigo === 'pncp' ? Object.entries(est.meta.modalidades).map(([k, v]) => `${k}=${v}`).join(' · ') : 'Códigos próprios do Compras.gov.br')),
      h('div', { class: 'campo' }, h('label', {}, 'Dias retroativos na primeira carga'), dias),
      h('div', { class: 'campo' }, h('label', {}, 'Frequência de atualização (minutos)'), freq)),
    [{ texto: 'Salvar', classe: 'primario', acao: async () => {
      try {
        await api(`/fontes/${f.codigo}`, { metodo: 'PATCH', corpo: { frequencia_minutos: Number(freq.value), config: {
          ufs: ufs.value.split(',').map((s) => s.trim()).filter(Boolean), modalidades: mods.value.split(',').map((s) => Number(s.trim())).filter(Boolean), diasRetroativos: Number(dias.value) } } });
        toast('Configuração salva.'); fontes(alvo, _r, est);
      } catch (e) { toast(e.message); return false; }
    } }]);
  };
  const arquivo = h('input', { type: 'file', accept: 'application/json,.json' });
  const importar = h('button', { class: 'btn', onclick: async () => {
    const f = arquivo.files[0]; if (!f) return toast('Escolha um arquivo .json.');
    try {
      const corpo = JSON.parse(await f.text());
      const r = await api('/fontes/importar-json', { metodo: 'POST', corpo });
      toast(`Importação (${r.fonte}): ${r.lidos} lidos, ${r.inseridos} novos, ${r.atualizados} atualizados, ${r.rejeitados} rejeitados.`, 8000);
      fontes(alvo, _r, est);
    } catch (e) { toast(e.message, 7000); }
  } }, 'Importar JSON');

  render(alvo, cabecalho('Fontes de dados', 'Situação real de cada conector. Fontes sem API pública documentada não são simuladas.'),
    h('div', { class: 'aviso azul' }, 'Pela Lei 14.133/2021 (art. 54 e art. 174), as contratações devem ser divulgadas no PNCP. Por isso, processos de plataformas como Portal de Compras Públicas, BLL, Licitanet e Licitações-e aparecem via PNCP, com a plataforma de origem identificada. Conectores diretos dessas plataformas dependem de API ou acordo de acesso.'),
    h('div', { class: 'cartao tabela-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Plataforma e ações', 'Integração', 'Implementação', 'Conexão', 'Última sincronização', 'Registros', 'Frequência', 'Credenciais'].map((t) => h('th', {}, t)))),
      h('tbody', {}, fs.map((f) => {
        const [ri, ci] = ROT_IMPL[f.status_implementacao] || [f.status_implementacao, ''];
        const [rc, cc] = ROT_CON[f.habilitada ? f.situacao_conexao : 'desabilitada'] || [f.situacao_conexao, ''];
        const bTestar = h('button', { class: 'btn pequeno' }, 'Testar');
        const bSync = h('button', { class: 'btn pequeno primario' }, 'Sincronizar');
        const bAbertas = h('button', { class: 'btn pequeno', title: 'Carga das contratações com propostas em aberto (PNCP /proposta)' }, 'Carregar abertas');
        const bRep = h('button', { class: 'btn pequeno' }, `Reprocessar falhas (${f.falhas_pendentes})`);
        bTestar.onclick = () => acao(bTestar, `/fontes/${f.codigo}/testar`);
        bSync.onclick = () => acao(bSync, `/fontes/${f.codigo}/sincronizar`);
        bAbertas.onclick = () => acao(bAbertas, `/fontes/${f.codigo}/sincronizar`, { modo: 'abertas' });
        bRep.onclick = () => acao(bRep, `/fontes/${f.codigo}/reprocessar`);
        return h('tr', {},
          h('td', {}, h('strong', {}, f.nome), f.url_oficial ? h('div', {}, h('a', { href: f.url_oficial, target: '_blank', rel: 'noopener noreferrer', class: 'pequeno' }, 'documentação ↗')) : null,
            h('div', { class: 'suave pequeno', style: { maxWidth: '420px' } }, f.observacoes || ''),
            f.ultimo_erro ? h('div', { class: 'pequeno', style: { color: 'var(--perigo)' } }, `Erro: ${f.ultimo_erro}`) : null,
            h('div', { style: { marginTop: '8px' } }, f.tem_conector && admin ? h('div', { class: 'linha' },
            h('label', { class: 'linha pequeno' }, h('input', { type: 'checkbox', checked: !!f.habilitada, onchange: async (e) => {
              try { await api(`/fontes/${f.codigo}`, { metodo: 'PATCH', corpo: { habilitada: e.target.checked } }); fontes(alvo, _r, est); } catch (er) { toast(er.message); }
            } }), 'Habilitada'),
            bTestar, bSync, f.codigo === 'pncp' ? bAbertas : null, bRep,
            h('button', { class: 'btn pequeno', onclick: () => configurar(f) }, 'Configurar'),
            h('button', { class: 'btn pequeno', onclick: () => verExecucoes(f) }, 'Execuções'))
            : f.tem_conector ? h('button', { class: 'btn pequeno', onclick: () => verExecucoes(f) }, 'Execuções') : h('span', { class: 'suave pequeno' }, 'Sem conector'))),
          h('td', {}, TIPO_INT[f.tipo_integracao] || f.tipo_integracao),
          h('td', {}, h('span', { class: `etiqueta ${ci}` }, ri)),
          h('td', {}, h('span', { class: `etiqueta ${cc}` }, rc)),
          h('td', {}, f.ultima_sincronizacao ? dataUtc(f.ultima_sincronizacao) : '—', f.ultima_sincronizacao_ok ? h('div', { class: 'suave pequeno' }, `ok: ${dataUtc(f.ultima_sincronizacao_ok)}`) : null),
          h('td', {}, numero(f.registros_importados)),
          h('td', {}, f.frequencia_minutos ? `${f.frequencia_minutos} min` : '—'),
          h('td', {}, f.requer_credenciais ? 'Sim' : 'Não'));

      })))),
    admin ? h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Importar arquivo JSON oficial'),
      h('p', { class: 'suave' }, 'Alternativa quando o servidor não alcança a fonte: abra no navegador uma URL da API oficial (ex.: ',
        h('code', {}, 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?dataFinal=20261231&uf=ES&pagina=1&tamanhoPagina=50'),
        '), salve como .json e importe aqui. Os dados passam pela mesma validação e deduplicação.'),
      h('div', { class: 'linha' }, arquivo, importar)) : null);
}

// ============================ CONFIGURAÇÕES ============================
export async function configuracoes(alvo, _r, est) {
  const atual = h('input', { type: 'password', autocomplete: 'current-password' });
  const nova = h('input', { type: 'password', autocomplete: 'new-password' });
  const blocos = [cabecalho('Configurações', `${est.usuario.nome} · ${est.usuario.email} · papel: ${est.usuario.papel}`),
    h('div', { class: 'grade duas' },
      h('div', { class: 'cartao' }, h('h2', {}, 'Alterar senha'),
        h('div', { class: 'campo' }, h('label', {}, 'Senha atual'), atual),
        h('div', { class: 'campo' }, h('label', {}, 'Nova senha (mín. 10 caracteres, letras e números)'), nova),
        h('div', { class: 'linha' },
          h('button', { class: 'btn primario', onclick: async () => {
            try { const r = await api('/auth/senha', { metodo: 'POST', corpo: { atual: atual.value, nova: nova.value } }); toast(r.mensagem); setTimeout(() => location.reload(), 1200); }
            catch (e) { toast(e.message); }
          } }, 'Alterar senha'),
          h('button', { class: 'btn', onclick: async () => { await api('/auth/sair-de-todos', { metodo: 'POST', corpo: {} }); location.reload(); } }, 'Sair de todos os dispositivos'))))];
  const pref = await api('/preferencias');
  const destino = h('input', { type: 'email', value: pref.email_alertas, placeholder: pref.email_login });
  const ativo = h('input', { type: 'checkbox', checked: pref.alertas_email });
  blocos.push(h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Alertas por e-mail'),
    pref.email ? null : h('div', { class: 'aviso amarelo' }, 'O envio de e-mail ainda não está ativado no servidor (variável SMTP_URL). Os alertas continuam aparecendo no sistema.'),
    h('label', { class: 'linha' }, ativo, 'Receber resumo dos alertas por e-mail'),
    h('div', { class: 'campo', style: { marginTop: '10px' } }, h('label', {}, 'Enviar alertas para (vazio = e-mail de login)'), destino),
    h('div', { class: 'linha' },
      h('button', { class: 'btn primario', onclick: async () => {
        try { await api('/preferencias', { metodo: 'PATCH', corpo: { alertas_email: ativo.checked, email_alertas: destino.value } }); toast('Preferências salvas.'); }
        catch (e) { toast(e.message); }
      } }, 'Salvar'),
      h('button', { class: 'btn', disabled: !pref.email, onclick: async () => {
        try { const r = await api('/email/teste', { metodo: 'POST', corpo: {} }); toast(r.mensagem, 6000); } catch (e) { toast(e.message, 8000); }
      } }, 'Enviar e-mail de teste'))));
  if (ehAdmin(est)) {
    const [us, aud] = await Promise.all([api('/usuarios'), api('/auditoria')]);
    const nome = h('input', { type: 'text' }); const email = h('input', { type: 'email' }); const senha = h('input', { type: 'password', autocomplete: 'new-password' });
    const papel = h('select', {}, ['leitor', 'analista', 'gestor', 'admin'].map((p) => h('option', { value: p }, p)));
    blocos.push(h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Usuários da empresa'),
      h('p', { class: 'suave pequeno' }, 'Papéis: leitor (só consulta) · analista (Kanban, atualizar licitações) · gestor (remove do Kanban) · admin (usuários e fontes).'),
      h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nome', 'E-mail', 'Papel', 'Ativo', 'Último login'].map((t) => h('th', {}, t)))),
        h('tbody', {}, us.map((u) => h('tr', {}, h('td', {}, u.nome), h('td', {}, u.email),
          h('td', {}, h('select', { disabled: u.id === est.usuario.id, onchange: async (e) => { try { await api(`/usuarios/${u.id}`, { metodo: 'PATCH', corpo: { papel: e.target.value } }); toast('Papel alterado.'); } catch (er) { toast(er.message); } } },
            ['leitor', 'analista', 'gestor', 'admin', 'superadmin'].map((p) => h('option', { value: p, selected: p === u.papel }, p)))),
          h('td', {}, h('input', { type: 'checkbox', checked: !!u.ativo, disabled: u.id === est.usuario.id, onchange: async (e) => { try { await api(`/usuarios/${u.id}`, { metodo: 'PATCH', corpo: { ativo: e.target.checked } }); } catch (er) { toast(er.message); } } })),
          h('td', {}, u.ultimo_login ? dataUtc(u.ultimo_login) : '—')))))),
      h('h3', { style: { marginTop: '14px' } }, 'Novo usuário'),
      h('div', { class: 'filtros' }, h('div', {}, h('label', {}, 'Nome'), nome), h('div', {}, h('label', {}, 'E-mail'), email),
        h('div', {}, h('label', {}, 'Senha inicial'), senha), h('div', {}, h('label', {}, 'Papel'), papel)),
      h('button', { class: 'btn primario', style: { marginTop: '10px' }, onclick: async () => {
        try { await api('/usuarios', { metodo: 'POST', corpo: { nome: nome.value, email: email.value, senha: senha.value, papel: papel.value } }); toast('Usuário criado.'); configuracoes(alvo, _r, est); }
        catch (e) { toast(e.message); }
      } }, 'Criar usuário')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Log de auditoria (últimos 200)'),
      h('div', { class: 'tabela-wrap' }, h('table', {}, h('tbody', {}, aud.map((a) => h('tr', {}, h('td', {}, dataUtc(a.criado_em)), h('td', {}, a.usuario_nome || '—'), h('td', {}, a.acao), h('td', { class: 'pequeno suave' }, `${a.entidade || ''} ${a.entidade_id || ''}`))))))));
  }
  render(alvo, ...blocos);
}

// ============================ PREÇOS E CONTRATOS (Fase 4) ============================
const fmtDoc = (d) => {
  const x = String(d || '').replace(/\D/g, '');
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return `***.${x.slice(3, 6)}.${x.slice(6, 9)}-**`; // CPF mascarado (LGPD)
  return x || null;
};
// Preço unitário: centavos de centavo aparecem em itens baratos (ex.: R$ 0,0450 por folha)
const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v);
const moedaUnit = (v) => (v == null ? naoInformado() : brl(v));
const TIPO_CAT = { material_pdm: 'Material (PDM)', material_item: 'Material (código CATMAT)', servico: 'Serviço (código CATSER)' };
const LEI_14133 = 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm';
const IN_65 = 'https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-me-no-65-de-7-de-julho-de-2021';

export async function precos(alvo, rota, est) {
  const aba = (rota.args[0] || '').split('?')[0] === 'contratos' ? 'contratos' : 'precos';
  const abas = h('div', { class: 'abas', role: 'tablist' },
    h('a', { class: aba === 'precos' ? 'ativo' : '', role: 'tab', href: '#/precos' }, 'Pesquisa de preços'),
    h('a', { class: aba === 'contratos' ? 'ativo' : '', role: 'tab', href: '#/precos/contratos' }, 'Contratos assinados'));
  const corpo = h('div', {}, carregando());
  render(alvo, cabecalho('Preços e contratos', aba === 'precos'
    ? 'Quanto o governo já pagou por um item, com dados oficiais do Compras.gov.br.'
    : 'Quem ganhou, por quanto e até quando: contratos publicados no PNCP.'), abas, corpo);
  if (aba === 'contratos') return contratosAba(corpo, rota, est);
  return precosAba(corpo, rota, est);
}

async function precosAba(alvo, rota, est) {
  const q = Object.fromEntries(rota.query.entries());
  const ir = (extra) => { location.hash = `#/precos${qs({ ...q, ...extra })}`; };
  const busca = h('input', { type: 'search', id: 'p-q', value: q.q || '', placeholder: 'ex.: papel A4, cadeira, limpeza predial, transporte escolar' });
  const uf = h('select', { id: 'p-uf' }, h('option', { value: '' }, 'Brasil inteiro'), est.meta.ufs.map((u) => h('option', { value: u, selected: q.uf === u }, u)));
  const meses = h('select', { id: 'p-meses' }, [[3, '3 meses'], [6, '6 meses'], [12, '12 meses (recomendado)'], [24, '24 meses']]
    .map(([v, t]) => h('option', { value: v, selected: String(q.meses || 12) === String(v) }, t)));
  const form = h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); ir({ q: busca.value.trim(), uf: uf.value, meses: meses.value, tipo: '', codigo: '', item: '', unidade: '' }); } },
    h('div', { class: 'filtros' },
      h('div', { class: 'largo' }, h('label', { for: 'p-q' }, 'O que você quer cotar? (descrição ou código CATMAT/CATSER)'), busca),
      h('div', {}, h('label', { for: 'p-uf' }, 'Estado'), uf),
      h('div', {}, h('label', { for: 'p-meses' }, 'Período'), meses)),
    h('div', { class: 'linha', style: { marginTop: '10px' } }, h('button', { class: 'btn primario', type: 'submit' }, 'Buscar no catálogo')));
  const resultado = h('div', {});
  render(alvo, form, resultado);

  if (q.tipo && q.codigo) return mostrarPrecos(resultado, q, ir);
  if (!q.q) {
    const st = (await api('/precos/catalogo').catch(() => null))?.status;
    render(resultado, avisoCatalogo(st, est), h('div', { class: 'cartao' }, h('h2', {}, 'Como funciona'),
      h('ol', {},
        h('li', {}, 'Digite o que você vende ou quer cotar e escolha o item certo do catálogo oficial do governo.'),
        h('li', {}, 'O sistema busca no Compras.gov.br os preços pagos nas compras do período, com órgão, fornecedor, marca e quantidade.'),
        h('li', {}, 'Você vê menor preço, mediana e média, e os preços muito fora do padrão ficam marcados para sua análise.')),
      h('p', { class: 'suave pequeno' }, 'É o mesmo tipo de pesquisa que o órgão faz para estimar o preço (',
        h('a', { href: LEI_14133, target: '_blank', rel: 'noopener noreferrer' }, 'Lei 14.133, art. 23'), ' e ',
        h('a', { href: IN_65, target: '_blank', rel: 'noopener noreferrer' }, 'IN SEGES/ME 65/2021, arts. 5º e 6º'),
        '). Cobertura: compras registradas no Compras.gov.br (órgãos federais e os estados e municípios que usam o sistema).')));
    return;
  }
  render(resultado, carregando('Procurando no catálogo…'));
  try {
    const r = await api(`/precos/catalogo${qs({ q: q.q })}`);
    const lista = r.resultados;
    const codigoDigitado = /^\d+$/.test(q.q.trim());
    const direto = codigoDigitado ? h('div', { class: 'linha', style: { marginTop: '8px' } },
      h('span', { class: 'suave pequeno' }, `Consultar o código ${q.q.trim()} direto como:`),
      ['material_item', 'servico'].map((t) => h('button', { class: 'btn pequeno', onclick: () => ir({ tipo: t, codigo: q.q.trim() }) }, TIPO_CAT[t]))) : null;
    if (!lista.length) {
      render(resultado, avisoCatalogo(r.status, est), h('div', { class: 'cartao' },
        vazio(r.status.n ? 'Nada encontrado no catálogo com essas palavras. Tente uma palavra mais genérica (ex.: "cadeira" em vez de "cadeira giratória preta").' : 'O catálogo ainda não foi baixado.'), direto));
      return;
    }
    render(resultado, h('div', { class: 'cartao' },
      h('h2', {}, `Escolha o item do catálogo (${lista.length}${lista.length >= 30 ? '+' : ''})`),
      h('p', { class: 'suave pequeno' }, 'Material aparece pelo PDM (o "tipo" do produto, que reúne as variações). Serviço aparece pelo código CATSER.'),
      h('div', { class: 'lista-cat' }, lista.map((c) => h('button', { class: 'item-cat', onclick: () => ir({ tipo: c.tipo === 'servico' ? 'servico' : 'material_pdm', codigo: c.codigo, item: '', unidade: '' }) },
        h('span', { class: `etiqueta ${c.tipo === 'servico' ? 'azul' : 'verde'}` }, c.tipo === 'servico' ? 'Serviço' : 'Material'),
        h('strong', {}, c.nome), h('span', { class: 'suave pequeno' }, `${c.classe || ''} · código ${c.codigo}`)))),
      direto));
  } catch (e) { render(resultado, erroBox(e)); }
}

function avisoCatalogo(st, est) {
  if (!st || st.n > 0) return null;
  return h('div', { class: 'aviso amarelo' }, st.em_andamento ? 'O catálogo oficial está sendo baixado agora. Volte em alguns minutos.'
    : 'O catálogo oficial do Compras.gov.br ainda não foi baixado. O sistema baixa sozinho; ',
  !st.em_andamento && ehAdmin(est) ? h('button', { class: 'btn pequeno', onclick: async (e) => {
    e.target.disabled = true;
    try { toast((await api('/precos/catalogo/atualizar', { metodo: 'POST', corpo: {} })).mensagem); } catch (er) { toast(er.message); e.target.disabled = false; }
  } }, 'Baixar agora') : null);
}

async function mostrarPrecos(alvo, q, ir) {
  render(alvo, carregando('Consultando o Compras.gov.br… (a primeira consulta do dia pode levar alguns segundos)'));
  let d;
  try { d = await api(`/precos${qs({ tipo: q.tipo, codigo: q.codigo, uf: q.uf, meses: q.meses, item: q.item, unidade: q.unidade, filtro: q.filtro, atualizar: q.atualizar })}`); }
  catch (e) { render(alvo, erroBox(e)); return; }
  if (q.atualizar) { delete q.atualizar; history.replaceState(null, '', `#/precos${qs(q)}`); }
  const e = d.estatisticas;
  const titulo = d.consulta.nome || `Código ${d.consulta.codigo}`;
  const filtroItem = d.itens_catalogo.length > 1 ? h('div', {}, h('label', { for: 'p-item' }, 'Item específico'),
    h('select', { id: 'p-item', onchange: (ev) => ir({ item: ev.target.value, unidade: '' }) }, h('option', { value: '' }, `Todos (${d.itens_catalogo.reduce((t, i) => t + i.n, 0)})`),
      d.itens_catalogo.map((i) => h('option', { value: i.codigo ?? '', selected: String(q.item || '') === String(i.codigo) }, `${i.codigo ?? 's/ código'} · ${(i.descricao || '').slice(0, 70)} (${i.n})`)))) : null;
  const filtroUnid = d.unidades.length ? h('div', {}, h('label', { for: 'p-unid' }, 'Unidade de fornecimento'),
    h('select', { id: 'p-unid', onchange: (ev) => ir({ unidade: ev.target.value }) },
      d.unidades.map((u) => h('option', { value: u.unidade, selected: u.unidade === d.unidade }, `${u.unidade} (${u.n})`)))) : null;
  const kpi = (rot, val, dica, apoio) => h('div', { class: 'cartao kpi', title: dica || '' }, h('div', { class: 'rotulo' }, rot), h('div', { class: 'valor' }, val),
    apoio ? h('div', { class: 'apoio' }, apoio) : null);
  // Valores muito grandes (em geral erro de lançamento na fonte) ficam abreviados para caber no bloco
  const preco = (v) => (v != null && v >= 1e6 ? moedaCurta(v) : moedaUnit(v));
  const filtroEspec = h('form', { class: 'largo', onsubmit: (ev) => { ev.preventDefault(); ir({ filtro: ev.target.elements.filtro.value.trim(), item: '', unidade: '' }); } },
    h('label', { for: 'p-filtro' }, 'Filtrar por especificação (todas as palavras)'),
    h('div', { class: 'linha', style: { flexWrap: 'nowrap' } },
      h('input', { id: 'p-filtro', name: 'filtro', type: 'search', value: q.filtro || '', placeholder: 'ex.: i7 16gb ssd, ultra 7, A4 75g', style: { flex: 1, minWidth: 0 } }),
      h('button', { class: 'btn', type: 'submit' }, 'Filtrar')));

  const ordens = { data: (a, b) => String(b.data_compra).localeCompare(String(a.data_compra)), menor: (a, b) => (a.preco_unitario ?? 1e18) - (b.preco_unitario ?? 1e18), maior: (a, b) => (b.preco_unitario ?? -1) - (a.preco_unitario ?? -1) };
  let ordem = 'data'; let mostrar = 50;
  const tabela = h('div', {});
  const desenharTabela = () => {
    const regs = [...d.registros].sort(ordens[ordem]);
    render(tabela, h('div', { class: 'tabela-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Data', 'Item', 'Unid.', 'Qtd.', 'Preço unitário', 'Fornecedor / marca', 'Órgão comprador', 'Local'].map((t) => h('th', {}, t)))),
      h('tbody', {}, regs.slice(0, mostrar).map((r) => h('tr', { class: r.fora_da_curva ? 'linha-alerta' : '' },
        h('td', {}, data(r.data_compra, false) || '—'),
        h('td', { title: r.descricao_detalhada || '' }, r.descricao || '—',
          // a descrição detalhada costuma repetir a curta: só aparece quando acrescenta algo
          r.descricao_detalhada && !r.descricao_detalhada.toLowerCase().startsWith(String(r.descricao || '').toLowerCase().slice(0, 30))
            ? h('div', { class: 'suave pequeno' }, r.descricao_detalhada.slice(0, 160)) : null),
        h('td', {}, r.unidade || '—'), h('td', {}, numero(r.quantidade)),
        h('td', { class: 'num' }, moedaUnit(r.preco_unitario), r.fora_da_curva ? h('div', {}, h('span', { class: 'etiqueta vermelha', title: 'Fora da faixa usual (critério estatístico). Confira se é outro produto, outra unidade ou erro de digitação.' }, 'fora da curva')) : null),
        h('td', {}, r.fornecedor_nome || naoInformado(), r.marca ? h('div', { class: 'suave pequeno' }, `Marca: ${r.marca}`) : null),
        h('td', {}, r.orgao_nome || r.uasg_nome || '—', r.uasg ? h('div', { class: 'suave pequeno' }, `UASG ${r.uasg}`) : null),
        h('td', {}, [r.municipio, r.uf].filter(Boolean).join(' / ') || '—')))))),
    regs.length > mostrar ? h('div', { class: 'paginacao' }, h('button', { class: 'btn', onclick: () => { mostrar += 100; desenharTabela(); } }, `Mostrar mais (${regs.length - mostrar} restantes)`)) : null);
  };
  desenharTabela();

  render(alvo,
    h('div', { class: 'cartao' },
      h('div', { class: 'cabecalho-pagina', style: { marginBottom: '6px' } },
        h('div', {}, h('h2', { style: { margin: 0 } }, titulo),
          h('div', { class: 'suave pequeno' }, `${TIPO_CAT[d.consulta.tipo]} ${d.consulta.codigo}${d.consulta.classe ? ` · ${d.consulta.classe}` : ''} · ${d.consulta.uf || 'Brasil'} · compras de ${data(d.desde, false)} a ${data(d.ate, false)}`)),
        h('div', { class: 'linha' },
          h('a', { class: 'btn', href: `#/precos${qs({ q: q.q, uf: q.uf, meses: q.meses })}` }, '← Outro item'),
          h('button', { class: 'btn', onclick: () => ir({ atualizar: '1' }) }, '↻ Consultar de novo'),
          h('a', { class: 'btn', href: `/api/precos/exportar${qs({ tipo: q.tipo, codigo: q.codigo, uf: q.uf, meses: q.meses, item: q.item, unidade: q.unidade, filtro: q.filtro })}` }, '⬇ CSV'),
          h('a', { class: 'btn', href: `#/precos/contratos${qs({ q: titulo.split(/[,(]/)[0].trim().toLowerCase() })}` }, 'Contratos parecidos'))),
      h('div', { class: 'suave pequeno' }, `Fonte: Compras.gov.br, Dados Abertos (Pesquisa de Preços). Consultado em ${dataUtc(d.consultado_em)}${d.cache ? ' (guardado por 24h)' : ''}.`),
      d.truncado ? h('div', { class: 'aviso amarelo', style: { marginTop: '8px' } }, `A fonte tem ${numero(d.total_fonte)} preços nesse período; trouxemos ${numero(d.baixados)}. Escolha um estado ou um período menor para ver tudo.`) : null,
      h('div', { class: 'filtros', style: { marginTop: '10px' } }, filtroEspec, filtroItem, filtroUnid),
      q.filtro ? h('div', { class: 'suave pequeno', style: { marginTop: '6px' } }, `Mostrando só as compras cuja descrição tem: "${q.filtro}". `,
        h('a', { href: `#/precos${qs({ ...q, filtro: '' })}` }, 'Limpar filtro')) : null),
    e.n ? h('div', { class: 'grade kpis', style: { marginTop: '14px' } },
      kpi('Preços encontrados', numero(e.n), `Na unidade ${d.unidade}. Preços de unidades diferentes não são comparados.`),
      kpi('Menor preço', preco(e.menor)),
      kpi('Mediana', moedaUnit(e.mediana), 'Metade dos preços está abaixo e metade acima. É a referência mais segura quando há valores muito diferentes.',
        h('span', { class: 'etiqueta verde' }, 'referência recomendada')),
      kpi('Média', preco(e.media), e.media_distorcida ? 'A média está bem acima da mediana: alguns preços extremos (às vezes o valor total lançado como unitário) puxam a conta. Use a mediana ou a média sem fora da curva.' : '',
        e.media_distorcida ? h('span', { class: 'etiqueta amarela' }, 'distorcida, não use') : null),
      kpi('Média sem fora da curva', moedaUnit(e.media_sem_fora_da_curva), e.n >= 4 ? `Desconsidera ${e.fora_da_curva} preço(s) fora da faixa de ${brl(e.limite_inferior)} a ${brl(e.limite_superior)}.` : 'Com menos de 4 preços não dá para apontar valores fora da curva.'),
      kpi('Maior preço', preco(e.maior), e.maior >= 1e6 ? `${brl(e.maior)}: provável erro de lançamento na fonte.` : '')) : h('div', { class: 'cartao', style: { marginTop: '14px' } },
      vazio(q.filtro ? `Nenhuma compra com "${q.filtro}" na descrição. Tente menos palavras (ex.: só "i7").` : 'Nenhum preço registrado para este item no período. Tente 24 meses ou o Brasil inteiro.')),
    e.n ? h('div', { class: 'aviso azul', style: { marginTop: '14px' } },
      e.n < 3 ? h('strong', {}, 'Atenção: menos de 3 preços. A IN 65/2021 pede pelo menos 3 para calcular média ou mediana. ') : null,
      e.fora_da_curva ? `${e.fora_da_curva} preço(s) ficaram fora da faixa usual de ${brl(e.limite_inferior)} a ${brl(e.limite_superior)} e estão marcados em vermelho. `
        : 'Nenhum preço muito fora do padrão. ',
      'Antes de usar na sua proposta, confira se a descrição e a unidade batem com o edital. Nada é descartado automaticamente (',
      h('a', { href: IN_65, target: '_blank', rel: 'noopener noreferrer' }, 'IN 65/2021, art. 6º, §§ 3º e 4º'), ').') : null,
    e.n ? h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('div', { class: 'cabecalho-pagina', style: { marginBottom: '8px' } }, h('h2', { style: { margin: 0 } }, `Preços (${numero(d.registros.length)})`),
        h('div', { class: 'linha' }, h('label', { for: 'p-ordem', class: 'suave pequeno' }, 'Ordenar'),
          h('select', { id: 'p-ordem', onchange: (ev) => { ordem = ev.target.value; mostrar = 50; desenharTabela(); } },
            h('option', { value: 'data' }, 'Mais recentes'), h('option', { value: 'menor' }, 'Menor preço'), h('option', { value: 'maior' }, 'Maior preço')))),
      tabela) : null);
}

async function contratosAba(alvo, rota, est) {
  const f = Object.fromEntries(rota.query.entries());
  const campos = {};
  const inp = (nome, attrs = {}) => (campos[nome] = h('input', { type: 'text', value: f[nome] || '', id: `c-${nome}`, ...attrs }));
  const sel = (nome, opcoes, vazioTxt = 'Todos') => (campos[nome] = h('select', { id: `c-${nome}` }, h('option', { value: '' }, vazioTxt),
    opcoes.map(([v, t]) => h('option', { value: v, selected: String(f[nome] ?? '') === String(v) }, t))));
  const campo = (rot, el, largo) => h('div', { class: largo ? 'largo' : '' }, h('label', { for: el.id }, rot), el);
  const ler = () => { const o = {}; for (const [k, el] of Object.entries(campos)) if (el.value !== '') o[k] = el.value.trim(); return o; };
  const ir = (extra = {}) => { location.hash = `#/precos/contratos${qs({ ...ler(), ...extra })}`; };
  const form = h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); ir({ pagina: 1 }); } },
    h('div', { class: 'filtros' },
      campo('Objeto, fornecedor ou órgão', inp('q', { type: 'search', placeholder: 'ex.: limpeza, transporte escolar, nome da empresa' }), true),
      campo('Estado (UF)', sel('uf', est.meta.ufs.map((u) => [u, u]))),
      campo('Município', inp('municipio', { placeholder: 'ex.: Vila Velha' })),
      campo('CNPJ do fornecedor', inp('fornecedor', { placeholder: '00.000.000/0000-00' })),
      campo('CNPJ do órgão', inp('orgao')),
      campo('Esfera', sel('esfera', Object.entries(ESF))),
      campo('Assinatura de', inp('assinatura_de', { type: 'date' })),
      campo('Assinatura até', inp('assinatura_ate', { type: 'date' })),
      campo('Valor mínimo (R$)', inp('valor_min', { type: 'number', min: 0, step: '0.01' })),
      campo('Valor máximo (R$)', inp('valor_max', { type: 'number', min: 0, step: '0.01' })),
      campo('Situação', sel('vigentes', [['1', 'Só vigentes']], 'Todos')),
      campo('Ordenar por', sel('ordenar', [['assinatura_desc', 'Assinatura mais recente'], ['valor_desc', 'Maior valor'], ['valor_asc', 'Menor valor'], ['vigencia_asc', 'Vigência terminando antes'], ['publicacao_desc', 'Publicação mais recente']], 'Padrão'))),
    h('div', { class: 'linha', style: { marginTop: '10px' } },
      h('button', { class: 'btn primario', type: 'submit' }, 'Buscar'),
      h('a', { class: 'btn', href: '#/precos/contratos' }, 'Limpar'),
      h('button', { class: 'btn', type: 'button', onclick: () => { window.location.href = `/api/contratos/exportar${qs(ler())}`; } }, '⬇ CSV')));
  const lista = h('div', {}, carregando());
  render(alvo, form, lista);
  try {
    const r = await api(`/contratos${qs(f)}`);
    if (!r.total) {
      const semFiltro = !Object.keys(ler()).length;
      render(lista, semFiltro ? h('div', { class: 'aviso amarelo' }, 'Ainda não há contratos no banco. A primeira carga (últimos 30 dias, todo o Brasil) roda sozinha; acompanhe em ',
        h('a', { href: '#/fontes' }, 'Fontes de dados > PNCP — Contratos publicados'), '.') : vazio('Nenhum contrato encontrado com esses filtros.'));
      return;
    }
    const hoje = new Date().toISOString().slice(0, 10);
    const totalPag = Math.max(1, Math.ceil(r.total / r.por_pagina));
    render(lista,
      h('div', { class: 'grade pares', style: { marginTop: '14px' } },
        h('div', { class: 'cartao' }, h('h2', {}, 'Resumo'),
          h('dl', { class: 'detalhes' },
            h('dt', {}, 'Contratos'), h('dd', {}, numero(r.total)),
            h('dt', {}, 'Soma do valor global'), h('dd', {}, r.soma_valor_global == null ? naoInformado() : moeda(r.soma_valor_global),
              r.com_valor < r.total ? h('div', { class: 'suave pequeno' }, `${numero(r.total - r.com_valor)} sem valor informado não entram na soma.`) : null)),
          h('p', { class: 'suave pequeno' }, 'Fonte: PNCP, contratos publicados (consulta pública). Clique num fornecedor para ver só os contratos dele.')),
        h('div', { class: 'cartao' }, h('h2', {}, 'Maiores fornecedores neste resultado'),
          r.fornecedores.length ? h('div', { class: 'tabela-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Fornecedor', 'Contratos', 'Soma'].map((t) => h('th', {}, t)))),
            h('tbody', {}, r.fornecedores.map((x) => h('tr', {},
              h('td', {}, h('a', { href: `#/precos/contratos${qs({ ...ler(), fornecedor: x.ni, pagina: 1 })}` }, x.nome || fmtDoc(x.ni)), h('div', { class: 'suave pequeno' }, fmtDoc(x.ni))),
              h('td', {}, numero(x.n)), h('td', { class: 'num' }, x.soma == null ? '—' : moedaCurta(x.soma))))))) : vazio('Sem fornecedores identificados.'))),
      h('div', { class: 'suave pequeno', style: { margin: '14px 0 6px' } }, `${numero(r.total)} contrato(s).`),
      r.linhas.map((c) => {
        const vigente = c.vigencia_fim && c.vigencia_fim >= hoje;
        return h('div', { class: 'cartao item-lic' },
          h('div', {},
            h('div', { class: 'objeto' }, c.objeto ? (c.objeto.length > 220 ? `${c.objeto.slice(0, 220)}…` : c.objeto) : '(objeto não informado)'),
            h('div', { class: 'meta', style: { marginTop: '6px' } },
              h('span', {}, '🏢 ', c.fornecedor_nome || naoInformado(), c.fornecedor_ni ? ` (${fmtDoc(c.fornecedor_ni)})` : ''),
              h('span', {}, '🏛 ', c.orgao_nome || naoInformado()),
              h('span', {}, '📍 ', [c.municipio, c.uf].filter(Boolean).join(' / ') || naoInformado()),
              h('span', {}, c.tipo_contrato || ''), c.categoria ? h('span', {}, c.categoria) : null),
            h('div', { class: 'meta', style: { marginTop: '4px' } },
              h('span', {}, `Assinado em ${data(c.data_assinatura, false) || 'data não informada'}`),
              h('span', {}, `Vigência ${data(c.vigencia_inicio, false) || '?'} a ${data(c.vigencia_fim, false) || '?'}`),
              c.vigencia_fim ? h('span', { class: `etiqueta ${vigente ? 'verde' : ''}` }, vigente ? 'Vigente' : 'Vigência encerrada') : null)),
          h('div', { class: 'lado' },
            h('div', { class: 'valor-grande' }, c.valor_global == null ? naoInformado() : moeda(c.valor_global)),
            h('div', { class: 'linha', style: { justifyContent: 'flex-end', marginTop: '6px' } },
              c.licitacao_id ? h('a', { class: 'btn pequeno', href: `#/licitacao/${c.licitacao_id}` }, 'Licitação') : null,
              c.link_pncp ? h('a', { class: 'btn pequeno', href: c.link_pncp, target: '_blank', rel: 'noopener noreferrer' }, 'PNCP ↗') : null)));
      }),
      h('div', { class: 'paginacao' },
        h('button', { class: 'btn', disabled: r.pagina <= 1, onclick: () => ir({ pagina: r.pagina - 1 }) }, '← Anterior'),
        h('span', { class: 'suave' }, `Página ${r.pagina} de ${totalPag}`),
        h('button', { class: 'btn', disabled: r.pagina >= totalPag, onclick: () => ir({ pagina: r.pagina + 1 }) }, 'Próxima →')));
  } catch (e) { render(lista, erroBox(e)); }
}

// ============================ MÓDULOS FUTUROS ============================
const DESCRICAO_FASE = {
  3: 'Gestão operacional: alertas de prazo, calendário, drive de documentos e fornecedores.',
  4: 'Inteligência: histórico de preços, análise de edital por IA, propostas e assistente jurídico.',
  5: 'Operação comercial: financeiro, estratégia de lances (modo assistido), relatórios e notificações.',
};
export function emDesenvolvimento(alvo, titulo, fase) {
  render(alvo, cabecalho(titulo, null),
    h('div', { class: 'cartao' },
      h('h2', {}, `Previsto para a Fase ${fase}`),
      h('p', {}, 'Este módulo ainda não foi implementado. Ele não exibe dados simulados.'),
      h('p', { class: 'suave' }, DESCRICAO_FASE[fase] || '')));
}
