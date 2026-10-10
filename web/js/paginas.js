import { api, qs } from './api.js';
import {
  h, moeda, numero, data, dataOuNao, dataUtc, prazoRestante, etiquetaStatus, toast, carregando, erroBox, vazio,
  confirmar, modal, barras, rosca, moedaCurta, naoInformado, render,
} from './ui.js';

const ehAdmin = (e) => ['admin', 'superadmin'].includes(e.usuario.papel);
const podeEditar = (e) => e.usuario.papel !== 'leitor';
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
  for (const f of d.conectores_com_falha) {
    avisos.push(h('div', { class: 'aviso vermelho' }, `Conector com falha: ${f.nome} (${f.situacao_conexao === 'bloqueada_rede' ? 'acesso de rede bloqueado' : 'erro'}). `,
      h('span', { class: 'pequeno' }, f.ultimo_erro || '')));
  }
  const maxEv = Math.max(1, ...d.evolucao.map((e) => e.n));
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
      kpi('Alertas não lidos', numero(d.alertas_pendentes), '#/notificacoes')),
    h('div', { class: 'grade duas', style: { marginTop: '14px' } },
      h('div', { class: 'cartao' }, h('h2', {}, 'Por situação'),
        rosca([['abertas', 'Abertas'], ['em_disputa', 'Em disputa / aguardando'], ['encerradas', 'Encerradas'], ['desertas_fracassadas', 'Desertas ou fracassadas'], ['outras', 'Suspensas, revogadas e outras']]
          .map(([v, rotulo]) => ({ v, rotulo, n: d.por_visao[v] || 0 })), { aoClicar: (f) => ir({ visao: f.v }) })),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por modalidade'),
        rosca(d.por_modalidade, { aoClicar: (f) => (f.id ? ir({ visao: '', modalidade: f.id }) : null) })),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por plataforma de origem'), h('p', { class: 'suave pequeno' }, 'Sistema que publicou no PNCP (campo usuarioNome).'),
        rosca(d.por_plataforma, { aoClicar: (f) => ir({ visao: '', plataforma: f.rotulo }) })),
      h('div', { class: 'cartao' }, h('h2', {}, 'Publicações nos últimos 30 dias'),
        d.evolucao.length ? h('div', {},
          h('div', { class: 'colunas-grafico' }, d.evolucao.map((e) => h('div', { style: { height: `${(e.n / maxEv) * 100}%` }, title: `${data(e.dia, false)}: ${e.n}` }))),
          h('div', { class: 'linha suave pequeno', style: { justifyContent: 'space-between' } }, h('span', {}, data(d.evolucao[0].dia, false)), h('span', {}, data(d.evolucao.at(-1).dia, false))))
          : vazio('Sem publicações no período.')),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por estado'), barras(d.por_uf, { max: 27 })),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por município (top 10)'), barras(d.por_municipio)),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por órgão (top 10)'), barras(d.por_orgao)),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por segmento'), h('p', { class: 'suave pequeno' }, 'Classificação automática por palavras-chave do objeto (estimativa).'), barras(d.por_segmento, { max: 15 })),
    ));
}

// ============================ BUSCA ============================
const FILTROS_PADRAO = { visao: 'abertas', ordenar: 'encerramento_asc' };

function linhaLicitacao(l, est, { aoFavoritar } = {}) {
  const prazo = prazoRestante(l.data_encerramento_proposta);
  return h('div', { class: 'cartao item-lic' },
    h('div', {},
      h('a', { class: 'objeto', href: `#/licitacao/${l.id}` }, l.objeto || '(objeto não informado)'),
      h('div', { class: 'meta', style: { marginTop: '6px' } },
        h('span', {}, '🏛 ', l.orgao_nome || naoInformado()),
        h('span', {}, '📍 ', [l.municipio, l.uf].filter(Boolean).join(' / ') || naoInformado()),
        h('span', {}, l.modalidade_nome || ''),
        l.numero_compra ? h('span', {}, `Nº ${l.numero_compra}/${l.ano ?? ''}`) : null,
        h('span', {}, 'Publicação: ', dataOuNao(l.data_publicacao, false)),
        h('span', {}, 'Propostas até: ', dataOuNao(l.data_encerramento_proposta)),
        h('span', { title: `Fontes: ${l.fontes || ''}` }, 'Origem: ', l.plataforma_origem || naoInformado()),
        l.segmento ? h('span', { class: 'etiqueta' }, l.segmento) : null,
        l.me_epp_exclusivo === 1 ? h('span', { class: 'etiqueta verde' }, 'Exclusiva ME/EPP') : null)),
    h('div', { class: 'lado' },
      etiquetaStatus(l.status_calculado, est.meta, l.status_motivo),
      h('span', { class: 'valor-grande', title: l.valor_estimado === 0 ? 'A fonte informou valor estimado zero (comum quando o orçamento é sigiloso).' : '' }, moeda(l.valor_estimado, l.valor_estimado_situacao), l.valor_estimado === 0 ? h('span', { class: 'suave pequeno' }, ' (zero na fonte)') : null),
      prazo ? h('span', { class: 'etiqueta amarela', title: 'Tempo restante para envio de propostas' }, `⏱ ${prazo}`) : null,
      h('div', { class: 'linha' },
        aoFavoritar ? h('button', { class: 'btn pequeno', title: 'Favoritar', onclick: () => aoFavoritar(l) }, '☆') : null,
        l.link_pncp ? h('a', { class: 'btn pequeno', href: l.link_pncp, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir no PNCP' }, 'PNCP ↗') : null,
        l.link_origem ? h('a', { class: 'btn pequeno', href: l.link_origem, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir no sistema de origem' }, 'Edital ↗') : null)));
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
      campo('Palavras-chave no objeto', inp('q', { type: 'search', placeholder: 'ex.: material hospitalar' }), true),
      campo('Palavras obrigatórias', inp('obrigatorias', { placeholder: 'todas devem aparecer' })),
      campo('Excluir palavras', inp('excluir', { placeholder: 'ex.: locação' })),
      campo('Estado (UF)', sel('uf', meta.ufs.map((u) => [u, u]))),
      campo('Município', inp('municipio', { placeholder: 'ex.: Vila Velha' })),
      campo('Órgão (nome ou CNPJ)', inp('orgao')),
      campo('Esfera', sel('esfera', Object.entries(ESF))),
      campo('Modalidade', sel('modalidade', Object.entries(meta.modalidades), 'Todas')),
      campo('Segmento (estimado)', sel('segmento', meta.segmentos.map((s) => [s, s]))),
      campo('Plataforma de origem', sel('plataforma', meta.plataformas.map((p) => [p, p]), 'Todas')),
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
    if (!res.total) { render(lista, vazio('Nenhuma licitação encontrada com esses filtros.')); return; }
    render(lista, 
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
  const btnKanban = d.oportunidade
    ? h('a', { class: 'btn', href: '#/kanban' }, `Kanban: ${d.oportunidade.etapa_nome}`)
    : podeEditar(est) ? h('button', { class: 'btn primario', onclick: async () => {
      try { await api('/kanban', { metodo: 'POST', corpo: { licitacao_id: l.id } }); toast('Enviada ao Kanban.'); detalhe(alvo, rota, est); } catch (e) { toast(e.message); }
    } }, '+ Acompanhar no Kanban') : null;
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
        d.oportunidade ? `Etapa interna da empresa: ${d.oportunidade.etapa_nome}.` : 'Ainda não acompanhada no Kanban.')),
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
        linha('Plataforma de origem', ni(l.plataforma_origem)),
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
  const { favoritos: favs, licitacoes } = await api('/favoritos');
  const outros = favs.filter((f) => f.tipo !== 'licitacao');
  const remover = async (tipo, referencia) => { await api(`/favoritos${qs({ tipo, referencia })}`, { metodo: 'DELETE' }); favoritos(alvo, _r, est); };
  render(alvo, cabecalho('Favoritos', 'Licitações, órgãos e pesquisas que você acompanha.'),
    h('h2', {}, `Licitações (${licitacoes.length})`),
    licitacoes.length ? h('div', { class: 'resultado' }, licitacoes.map((l) => h('div', { class: 'cartao item-lic' },
      h('div', {}, h('a', { class: 'objeto', href: `#/licitacao/${l.id}` }, l.objeto || '—'),
        h('div', { class: 'meta' }, h('span', {}, l.orgao_nome || ''), h('span', {}, [l.municipio, l.uf].filter(Boolean).join('/')), h('span', {}, 'Propostas até: ', dataOuNao(l.data_encerramento_proposta)))),
      h('div', { class: 'lado' }, etiquetaStatus(l.status_calculado, est.meta), moeda(l.valor_estimado, l.valor_estimado_situacao),
        h('button', { class: 'btn pequeno perigo', onclick: () => remover('licitacao', l.id) }, 'Remover')))))
      : vazio('Nenhuma licitação favorita. Use ☆ na busca.'),
    outros.length ? h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Outros favoritos'),
      h('ul', {}, outros.map((f) => h('li', {}, `${f.tipo}: ${f.referencia} `, h('button', { class: 'btn pequeno', onclick: () => remover(f.tipo, f.referencia) }, 'Remover'))))) : null);
}

// ============================ KANBAN ============================
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
      h('div', { class: 'pequeno' }, hist.map((x) => h('div', { class: 'evento' }, h('div', { class: 'quando' }, dataUtc(x.criado_em)), h('div', {}, h('strong', {}, x.usuario_nome || ''), ` · ${x.tipo}: ${x.texto || ''}`))))),
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
    k.cards.length ? null : h('div', { class: 'aviso azul' }, 'Nenhuma oportunidade ainda. Abra uma licitação e clique em "+ Acompanhar no Kanban".'),
    h('div', { class: 'kanban' }, colunas));
}

// ============================ NOTIFICAÇÕES E PESQUISAS ============================
export async function notificacoes(alvo, _r, est) {
  render(alvo, carregando());
  const [ns, ps] = await Promise.all([api('/notificacoes'), api('/pesquisas')]);
  render(alvo, cabecalho('Alertas', 'Notificações no sistema geradas pelas pesquisas salvas com alerta ativo.',
    h('button', { class: 'btn', onclick: async () => { await api('/notificacoes/lidas', { metodo: 'POST', corpo: {} }); window.dispatchEvent(new Event('atualizar-sino')); notificacoes(alvo, _r, est); } }, 'Marcar todas como lidas')),
  h('div', { class: 'aviso amarelo' }, 'E-mail: requer servidor SMTP configurado (SMTP_URL) — pendente. WhatsApp: requer provedor oficial autorizado (ex.: WhatsApp Business API) — pendente. Alertas de prazo, sessão e mudança de situação: Fase 3.'),
  h('div', { class: 'grade duas' },
    h('div', { class: 'cartao' }, h('h2', {}, 'Notificações'),
      ns.length ? ns.map((n) => h('div', { class: 'evento' }, h('div', { class: 'quando' }, dataUtc(n.criado_em), n.lida ? '' : h('div', { class: 'etiqueta azul' }, 'nova')),
        h('div', {}, h('strong', {}, n.titulo), h('div', { class: 'pequeno' }, n.licitacao_id ? h('a', { href: `#/licitacao/${n.licitacao_id}` }, n.mensagem) : n.mensagem))))
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
      h('div', { class: 'campo' }, h('label', {}, 'Códigos de modalidade'), mods,
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
