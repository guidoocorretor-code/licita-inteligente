import { api, qs, clienteSelecionado } from './api.js';
import {
  h, moeda, numero, data, dataOuNao, dataUtc, prazoRestante, etiquetaStatus, toast, carregando, erroBox, vazio,
  confirmar, modal, barras, rosca, moedaCurta, naoInformado, render, faixaGoverno, paginacao, identificacaoGoverno, destinoDisputa, botaoCopiar } from './ui.js';
import { painelEmpresas, painelFornecedores, abasDashboard } from './painel.js';
import { blocoRelatorio } from './mercado.js';

const ehAdmin = (e) => ['admin', 'superadmin'].includes(e.usuario.papel);
const podeEditar = (e) => e.usuario.papel !== 'leitor';
// Nome da empresa assessorada em foco (null = todas)
const empresaEmFoco = (est) => est?.clientes?.find((c) => String(c.id) === clienteSelecionado()) || null;
const nomeEmpresa = (c) => c.nome_fantasia || c.razao_social;
export const avisoEmpresa = (est, oQue) => {
  const c = empresaEmFoco(est);
  return h('div', { class: 'faixa-empresa' }, c ? ['🏢 ', h('strong', {}, nomeEmpresa(c)), ` · ${oQue} só desta empresa. `, h('a', { href: '#/empresas' }, 'Trocar')]
    : est?.clientes?.length ? ['🏢 Todas as empresas · ', oQue, ' de todas. Escolha uma empresa no topo para separar.'] : null);
};
const ESF = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital', N: 'Não se aplica' };

export function cabecalho(titulo, subtitulo, ...acoes) {
  return h('div', { class: 'cabecalho-pagina' },
    h('div', {}, h('h1', {}, titulo), subtitulo ? h('div', { class: 'suave' }, subtitulo) : null),
    h('div', { class: 'linha' }, ...acoes));
}

// ============================ DASHBOARD ============================
export async function dashboard(alvo, rota, est) {
  if (rota?.args?.[0] === 'empresas') return painelEmpresas(alvo, rota, est, { cabecalho, avisoEmpresa });
  if (rota?.args?.[0] === 'fornecedores') return painelFornecedores(alvo, rota, est, { cabecalho, avisoEmpresa });
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
    abasDashboard('oportunidades'),
    ...avisos,
    h('div', { class: 'grade kpis' },
      kpi('Licitações monitoradas', numero(d.total)),
      kpi('Abertas', numero(d.por_visao.abertas), '#/buscar?visao=abertas'),
      kpi('Encerram em até 7 dias', numero(d.sessoes_proximas), '#/buscar?sessao_dias=7', 'Prazo final de propostas nos próximos 7 dias (o PNCP não informa a data da sessão de disputa separadamente).'),
      kpi('Em disputa hoje', numero(d.por_visao.em_disputa), '#/buscar?visao=em_disputa', 'Prazo de propostas encerrou hoje: no pregão eletrônico a disputa de lances começa logo após.'),
      kpi('Aguardando resultado', numero(d.por_visao.aguardando_resultado), '#/buscar?visao=aguardando_resultado', 'Prazo de propostas já encerrado em outro dia e a fonte ainda não publicou o resultado.'),
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
        rosca([['abertas', 'Abertas'], ['em_disputa', 'Em disputa hoje'], ['aguardando_resultado', 'Aguardando resultado'], ['encerradas', 'Encerradas'], ['desertas_fracassadas', 'Desertas ou fracassadas'], ['outras', 'Suspensas, revogadas e outras']]
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

// Pagômetro: nota CAPAG do Tesouro (A melhor ... D pior). Sem nota = federal, n.d. ou ainda não baixada.
const COR_CAPAG = { A: 'verde', B: 'azul', C: 'amarela', D: 'vermelha' };
function seloCapag(n, { longo = false } = {}) {
  if (!n) return h('span', { class: 'etiqueta', title: 'Sem nota CAPAG (órgão federal, nota não calculada ou dado ainda não baixado)' }, longo ? 'Sem nota' : '—');
  return h('span', { class: `etiqueta ${COR_CAPAG[n[0]] || ''} selo-capag`, title: 'Capacidade de pagamento do ente (CAPAG/Tesouro Nacional)' }, `CAPAG ${n}`);
}
const PALAVRA_CAPAG = { A: 'Boa', B: 'Razoável', C: 'Fraca', D: 'Muito fraca' };
const textoNotaCapag = { A: 'boa capacidade de pagamento', B: 'capacidade de pagamento razoável', C: 'capacidade de pagamento fraca: atenção', D: 'capacidade de pagamento muito fraca: risco alto' };
const INDICADORES_CAPAG = [['ind1', 'nota1', 'Endividamento', 'Dívida em relação à receita. Quanto menor, melhor.'],
  ['ind2', 'nota2', 'Poupança corrente', 'Quanto da receita corrente já vai para despesas correntes. Quanto menor, mais folga.'],
  ['ind3', 'nota3', 'Liquidez', 'Caixa disponível frente às obrigações de curto prazo (contas a pagar). Nota C = obrigações maiores que o caixa.']];

// Um campo da ficha: rótulo pequeno em cima, valor legível embaixo
const campoFicha = (rotulo, valor, extra = {}) => h('div', { class: 'campo-ficha' + (extra.classe ? ' ' + extra.classe : ''), title: extra.title || '' },
  h('span', { class: 'rotulo' }, rotulo), h('span', { class: 'valor' }, valor));

// Credenciamento: preço fixado pelo órgão, sem disputa, e edital aberto por meses (Lei 14.133, art. 79).
// "Prazo longo" quando o recebimento de propostas dura mais de 60 dias.
function seloCredenciamento(l) {
  const dias = l.data_abertura_proposta && l.data_encerramento_proposta
    ? (Date.parse(l.data_encerramento_proposta) - Date.parse(l.data_abertura_proposta)) / 86400000 : null;
  return h('span', { class: 'etiqueta credenc', title: 'Credenciamento (Lei 14.133/2021, art. 79): o órgão fixa o preço, não há disputa de lances e credencia todos que cumprirem o edital. O edital fica aberto para novos interessados, por isso o prazo costuma ser longo. Ser credenciado não garante volume de serviço.' },
    dias != null && dias > 60 ? 'Credenciamento · prazo longo' : 'Credenciamento');
}

// Ícones do cartão (traço branco, no círculo colorido). Texto fixo do próprio código, sem dado externo.
const SVG_LIC = {
  martelo: '<path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  moedas: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  documento: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M8 9h2"/>',
  megafone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  cartao: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>',
  lampada: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  quadro: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/><path d="M15 21V9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  seta: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};
function iconeLic(nome, classe = '') {
  const el = h('span', { class: `ic-lic ${classe}`, 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG_LIC[nome]}</svg>`;
  return el;
}
// Frase curta da modalidade: só afirma o que vale para aquela modalidade (nunca "disputa por lances" numa dispensa sem lances)
function fraseModalidade(nome = '') {
  const n = nome.toLowerCase();
  if (/preg/.test(n) && /eletr/.test(n)) return 'Processo realizado de forma eletrônica, com disputa por lances.';
  if (/preg/.test(n)) return 'Disputa por lances para bens e serviços comuns.';
  if (/dispensa/.test(n)) return 'Contratação direta, sem licitação (Lei 14.133, art. 75).';
  if (/inexig/.test(n)) return 'Contratação direta quando não há competição (Lei 14.133, art. 74).';
  if (/concorr/.test(n)) return 'Para obras, serviços especiais e compras de maior porte.';
  if (/credenc/.test(n)) return 'Preço fixado pelo órgão; credencia todos que cumprirem o edital.';
  if (/leil/.test(n)) return 'Venda de bens do órgão a quem oferecer o maior lance.';
  return 'Modalidade informada pelo órgão no PNCP.';
}

// Descritivo abaixo do objeto, só com texto da fonte (nada gerado): os itens que batem com a busca, senão a
// informação complementar publicada pelo órgão; sem nenhum dos dois, diz que o órgão não publicou.
function descritivoLic(l, itens, rotuloItens = 'Itens com as palavras buscadas') {
  const total = l.itens_encontrados_total || itens.length;
  if (itens.length) {
    return h('div', { class: 'descritivo-lic' },
      h('span', { class: 'rot-desc' }, `🔎 ${rotuloItens} (${total}${l.num_itens ? ` de ${l.num_itens} no edital` : ''})`),
      h('ul', {}, itens.map((i) => h('li', { title: i.descricao || '' }, h('b', {}, `Item ${i.numero_item}: `), i.descricao || '(sem descrição)'))),
      total > itens.length ? h('small', { class: 'suave' }, `e mais ${total - itens.length} item(ns): veja todos no detalhe da licitação.`) : null);
  }
  const comp = (l.informacao_complementar || '').trim();
  if (comp) {
    return h('div', { class: 'descritivo-lic' },
      h('span', { class: 'rot-desc' }, 'Informação complementar do órgão'),
      h('p', { class: 'texto-desc', title: comp }, comp));
  }
  return h('div', { class: 'descritivo-lic sem-desc' }, h('small', { class: 'suave' }, 'O órgão não publicou descrição complementar. Veja os itens e o edital no detalhe da licitação.'));
}

// Cartão da licitação na lista de busca, no padrão do modelo do Guido: faixa (modalidade, nº, UASG/órgão, valor),
// objeto + resumo, cinco blocos coloridos, aviso do sistema e rodapé com etiquetas e botões.
// Só mostra o que a fonte informou: UASG só no Compras.gov.br; sem nota CAPAG fica "Sem nota".
// O Jornal usa o mesmo cartão: rotuloItens troca o título do descritivo e extra entra antes do rodapé ("Entrou por").
export function linhaLicitacao(l, est, { aoKanban, rotuloItens, extra } = {}) {
  const prazo = prazoRestante(l.data_encerramento_proposta);
  const diasRestantes = l.data_encerramento_proposta ? (Date.parse(l.data_encerramento_proposta + '-03:00') - Date.now()) / 86400000 : null;
  const urgente = diasRestantes !== null && diasRestantes > 0 && diasRestantes <= 3;
  const itens = l.itens_encontrados || [];
  const id = identificacaoGoverno(l);
  const dest = destinoDisputa(l);
  const cidade = [l.municipio, l.uf].filter(Boolean).join(' / ');
  const modalidade = l.modalidade_nome || 'Não informada';
  // Nós do DOM não podem aparecer em dois lugares: cada uso cria o seu
  const publicacao = () => dataOuNao(l.data_publicacao, false);
  const propostas = l.data_encerramento_proposta ? data(l.data_encerramento_proposta).replace(' ', ' às ') : naoInformado();
  const sistema = () => nomeSistema(l, est.meta);
  const capag = l.esfera === 'F' ? 'Federal' : l.capag ? `CAPAG ${l.capag}` : 'Sem nota';
  const fraseCapag = l.esfera === 'F' ? 'Órgão federal: a CAPAG não se aplica.' : l.capag ? `Capacidade de pagamento ${PALAVRA_CAPAG[l.capag[0]].toLowerCase()} (Tesouro Nacional).` : 'Ente sem nota CAPAG publicada.';
  const bloco = (icone, cor, rotulo, valor, frase, extra = {}) => h('div', { class: `bloco-lic ${cor}`, title: extra.title || '' },
    iconeLic(icone, cor), h('div', { class: 'bloco-texto' }, h('span', { class: 'rot-lic' }, rotulo), h('b', { class: 'valor-bloco' }, valor), h('small', {}, frase)));
  const s = sistemaInfo(l, est.meta);
  return h('article', { class: 'cartao-lic' },
    h('header', { class: 'topo-lic' },
      h('div', { class: 'id-lic' }, iconeLic('martelo', 'claro grande'),
        h('div', {}, h('span', { class: 'modalidade-lic' }, modalidade),
          h('div', { class: 'numero-lic' }, 'Nº ', id.numero ? botaoCopiar(id.numero, 'Número') : h('span', { class: 'sem' }, 'não informado')))),
      h('div', { class: 'campo-topo' }, h('span', { class: 'rot' }, 'UASG'),
        id.uasg ? h('b', { class: 'valor-topo grande' }, botaoCopiar(id.uasg, 'UASG'))
          : h('b', { class: 'valor-topo sem', title: 'UASG é o código da unidade compradora no Compras.gov.br. Esta licitação não informa UASG (está em outro sistema).' }, 'não tem')),
      h('div', { class: 'campo-topo orgao' }, h('span', { class: 'rot' }, 'Órgão'),
        h('b', { class: 'valor-topo nome-orgao', title: l.orgao_nome || '' }, l.orgao_nome || 'Não informado')),
      h('div', { class: 'campo-topo' }, h('span', { class: 'rot' }, 'Cidade / Estado'),
        h('b', { class: 'valor-topo' }, cidade || 'Não informado')),
      h('div', { class: 'valor-lic', title: l.valor_estimado === 0 ? 'A fonte informou valor estimado zero (comum quando o orçamento é sigiloso).' : '' },
        iconeLic('moedas', 'claro grande'),
        h('div', {}, h('span', { class: 'rot' }, 'Valor estimado do edital'), h('strong', {}, moeda(l.valor_estimado, l.valor_estimado_situacao))))),
    h('div', { class: 'meio-lic' },
      h('div', { class: 'objeto-box' }, iconeLic('documento', 'azul-escuro'),
        h('div', { class: 'objeto-conteudo' },
          h('span', { class: 'rot-lic' }, 'Objeto da contratação'),
          h('a', { class: 'objeto-lic', href: `#/licitacao/${l.id}`, title: l.objeto || '' }, l.objeto || '(objeto não informado)'),
          descritivoLic(l, itens, rotuloItens)))),
    h('div', { class: 'blocos-lic' },
      bloco('martelo', 'azul-escuro', 'Modalidade', modalidade, fraseModalidade(l.modalidade_nome || '')),
      bloco('megafone', 'verde', 'Publicação', publicacao(), 'Edital publicado no PNCP.'),
      bloco('calendario', 'vermelho', 'Propostas até', propostas, prazo ? `Prazo final para envio das propostas · faltam ${prazo}.` : 'Prazo final para envio das propostas.', { title: urgente ? 'Faltam 3 dias ou menos' : '' }),
      bloco('monitor', 'azul', 'Sistema eletrônico', sistema(), 'Plataforma utilizada para a disputa.', { title: `Publicado no PNCP por: ${l.plataforma_origem || 'não informado'}` }),
      bloco('cartao', 'roxo', 'Pagômetro', capag, fraseCapag)),
    s && s.custo === 'pago' ? h('div', { class: 'aviso-lic' }, iconeLic('lampada', 'azul'),
      h('div', {}, h('b', {}, `${s.nome} cobra do fornecedor. `), s.resumo, ' ',
        s.cadastro ? h('a', { href: s.cadastro, target: '_blank', rel: 'noopener noreferrer' }, 'Ver planos e cadastrar ↗') : null,
        s.fonte ? h('span', {}, ' / ', h('a', { href: s.fonte, target: '_blank', rel: 'noopener noreferrer' }, 'fonte')) : null)) : null,
    extra || null,
    h('footer', { class: 'rodape-lic' },
      h('div', { class: 'etiquetas-lic' },
        etiquetaStatus(l.status_calculado, est.meta, l.status_motivo),
        prazo ? h('span', { class: 'etiqueta ' + (urgente ? 'vermelha' : 'amarela') }, `⏱ faltam ${prazo}`) : null,
        l.segmento ? h('span', { class: 'etiqueta' }, l.segmento) : null,
        l.credenciamento === 1 ? seloCredenciamento(l) : null,
        l.me_epp_exclusivo === 1 ? h('span', { class: 'etiqueta verde' }, 'Exclusiva ME/EPP') : null),
      h('div', { class: 'botoes-lic' },
        dest.url ? h('a', { class: 'btn-lic contorno', href: dest.url, target: '_blank', rel: 'noopener noreferrer', title: dest.direto ? 'Abre o processo no sistema de origem' : `Abre a página do ${dest.nome}` },
          iconeLic('seta'), dest.direto ? 'Sistema da disputa' : dest.nome) : null,
        aoKanban ? h('button', { class: 'btn-lic contorno', title: 'Subir para o Kanban (entra na primeira etapa)', onclick: () => aoKanban(l) }, iconeLic('quadro'), 'Kanban') : null,
        l.link_pncp ? h('a', { class: 'btn-lic cheio', href: l.link_pncp, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir no PNCP' }, iconeLic('link'), 'PNCP') : null)));
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
  if (filtros.sessao_proxima === '1') { delete filtros.sessao_proxima; filtros.sessao_dias = '7'; }
  if (rota.query.get('q') || rota.query.get('sessao_proxima') || rota.query.get('sessao_dias')) { if (!rota.query.get('visao')) filtros.visao = ''; }
  const campos = {};
  const inp = (nome, attrs = {}) => (campos[nome] = h('input', { type: 'text', value: filtros[nome] || '', id: `f-${nome}`, ...attrs }));
  const sel = (nome, opcoes, vazioTxt = 'Todos') => (campos[nome] = h('select', { id: `f-${nome}` }, h('option', { value: '' }, vazioTxt),
    opcoes.map(([v, t]) => h('option', { value: v, selected: String(filtros[nome] ?? '') === String(v) }, t))));
  // Várias opções de uma vez: caixa que abre uma lista de caixinhas; o valor vai na URL separado por vírgula
  const multi = (nome, opcoes, vazioTxt) => {
    const marcados = new Set(String(filtros[nome] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    const resumo = h('summary', { id: `f-${nome}` });
    const caixas = opcoes.map(([v, t]) => h('input', { type: 'checkbox', value: String(v), checked: marcados.has(String(v)) }));
    const atualizar = () => {
      const sel = caixas.filter((c) => c.checked);
      resumo.textContent = !sel.length ? vazioTxt : sel.length === 1 ? opcoes.find(([v]) => String(v) === sel[0].value)[1] : `${sel.length} selecionadas`;
    };
    const el = h('details', { class: 'multi-sel' }, resumo,
      h('div', { class: 'multi-lista' }, opcoes.map(([, t], i) => h('label', {}, caixas[i], ' ', t))));
    caixas.forEach((c) => c.addEventListener('change', atualizar));
    // Fecha a lista ao clicar fora dela
    const fechar = (e) => { if (!el.isConnected) document.removeEventListener('click', fechar); else if (!el.contains(e.target)) el.open = false; };
    document.addEventListener('click', fechar);
    Object.defineProperty(el, 'value', { get: () => caixas.filter((c) => c.checked).map((c) => c.value).join(',') });
    atualizar();
    return (campos[nome] = el);
  };
  const campo = (rot, el, largo) => h('div', { class: largo ? 'largo' : '' }, h('label', { for: el.id }, rot), el);
  const listaMunicipios = h('datalist', { id: 'municipios-atalho' }, h('option', { value: 'Grande Vitória' }, 'Vila Velha, Vitória, Serra, Cariacica, Viana e Fundão'));

  const contagens = await api('/dashboard').then((d) => d.por_visao).catch(() => ({}));
  let avancada; let resumoAvancada;
  const form = h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); aplicar({ pagina: 1 }); } },
    h('div', { class: 'filtros' },
      campo('Palavras-chave (objeto e itens)', inp('q', { type: 'search', placeholder: 'ex.: mouse, material hospitalar' }), true),
      campo('Procurar em', sel('nos_itens', [['0', 'Só no objeto']], 'Objeto e itens')),
      campo('Palavras obrigatórias', inp('obrigatorias', { placeholder: 'todas devem aparecer' })),
      campo('Excluir palavras', inp('excluir', { placeholder: 'ex.: locação' })),
      campo('Qualquer destas (separe com ;)', inp('ramo', { placeholder: 'ex.: informática; papelaria' })),
      campo('Estado (UF)', sel('uf', meta.ufs.map((u) => [u, u]))),
      campo('Município', inp('municipio', { placeholder: 'ex.: Vila Velha ou Grande Vitória', list: 'municipios-atalho' })),
      campo('Órgão (nome ou CNPJ)', inp('orgao')),
      campo('Esfera', sel('esfera', Object.entries(ESF))),
      campo('Modalidades', multi('modalidade', Object.entries(meta.modalidades), 'Todas')),
      campo('Tipo de disputa', multi('modo_disputa', [['Aberto', 'Aberto'], ['Aberto-Fechado', 'Aberto e fechado'], ['Fechado-Aberto', 'Fechado e aberto']], 'Todos')),
      campo('Credenciamentos', sel('credenciamento', [['ocultar', 'Esconder'], ['so', 'Só credenciamentos']], 'Mostrar'))),
    // Filtros menos usados ficam na "Busca avançada"; abre sozinha se algum deles estiver em uso, para nada ficar escondido
    avancada = h('details', { class: 'busca-avancada', open: false },
      resumoAvancada = h('summary', {}, 'Busca avançada'),
      h('div', { class: 'filtros' },
      campo('Situação', campos.visao = h('select', { id: 'f-visao' },
        [['todas', 'Todas as situações'], ...Object.entries(meta.visoes)].map(([v, t]) => h('option', { value: v, selected: (filtros.visao || 'todas') === v },
          contagens[v] != null ? `${t} (${numero(contagens[v])})` : t)))),
      campo('Segmento (estimado)', sel('segmento', meta.segmentos.map((s) => [s, s]))),
      campo('Sistema eletrônico', sel('sistema', Object.entries(meta.sistemas || {}).map(([k, x]) => [k, `${x.nome}${x.custo === 'pago' ? ' · pago' : x.custo === 'gratuito' ? ' · gratuito' : ''}`]), 'Todos')),
      campo('Pagômetro (CAPAG)', sel('capag', [['A,B', 'Só A e B (contas saudáveis)'], ['A', 'Só A'], ['B', 'Só B'], ['C', 'Só C'], ['D', 'Só D'], ['sem', 'Sem nota / federal']], 'Todas')),
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
      campo('Abertura da sessão nos próximos', sel('sessao_dias', [['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias']], 'Qualquer data')),
      campo('Publicadas nos últimos', sel('publicadas_dias', [['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias']], 'Qualquer data')),
      campo('Código CATMAT/CATSER', inp('catalogo')),
      campo('Ordenar por', sel('ordenar', [['encerramento_asc', 'Prazo mais próximo'], ['publicacao_desc', 'Mais recentes'], ['valor_desc', 'Maior valor'], ['valor_asc', 'Menor valor'], ['atualizacao_desc', 'Atualização mais recente']], 'Padrão')))),
    h('div', { class: 'linha', style: { marginTop: '10px' } },
      h('button', { class: 'btn primario', type: 'submit' }, 'Buscar'),
      h('button', { class: 'btn', type: 'button', onclick: () => { location.hash = '#/buscar'; } }, 'Limpar'),
      h('button', { class: 'btn', type: 'button', onclick: salvarPesquisa }, '💾 Salvar pesquisa'),
      h('button', { class: 'btn', type: 'button', onclick: () => exportar('csv') }, '⬇ CSV'),
      h('button', { class: 'btn', type: 'button', onclick: () => exportar('xlsx') }, '⬇ Excel')),
    listaMunicipios);

  // Quantos filtros avançados estão em uso (a ordenação padrão não conta)
  const AVANCADOS = ['segmento', 'sistema', 'capag', 'sistema_custo', 'plataforma', 'regime_legal', 'valor_min', 'valor_max', 'publicacao_de', 'publicacao_ate',
    'abertura_de', 'abertura_ate', 'prazo_min_dias', 'tipo_item', 'me_epp', 'srp', 'com_documentos', 'sessao_dias', 'publicadas_dias', 'catalogo', 'ordenar'];
  const emUso = AVANCADOS.filter((k) => filtros[k] != null && filtros[k] !== '' && !(k === 'ordenar' && filtros[k] === FILTROS_PADRAO.ordenar)).length
    + ((filtros.visao || 'todas') !== FILTROS_PADRAO.visao ? 1 : 0);
  if (emUso) { avancada.open = true; resumoAvancada.append(h('span', { class: 'etiqueta azul pequena' }, `${emUso} em uso`)); }

  const lerFiltros = () => {
    const f = {};
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

  const lista = h('div', { class: 'resultado' }, carregando());
  const pesquisas = h('div', { class: 'linha', style: { margin: '10px 0' } });
  render(alvo, cabecalho('Buscar licitações', 'Pesquisa em todas as fontes habilitadas, sem duplicidades.'), form, pesquisas, lista);

  api('/pesquisas').then((ps) => {
    if (!ps.length) return;
    pesquisas.replaceChildren(h('span', { class: 'suave pequeno' }, 'Pesquisas salvas:'),
      ps.map((p) => h('a', { class: 'btn pequeno', href: `#/buscar${qs(JSON.parse(p.filtros_json))}` }, p.alertar ? '🔔 ' : '', p.nome)));
  }).catch(() => {});

  // Página aberta sem pesquisa: só o buscador; a lista aparece depois de clicar em Buscar
  if (!rota.query.toString()) {
    render(lista, h('div', { class: 'cartao' }, vazio('Preencha os campos que quiser e clique em Buscar. Por padrão a busca traz as licitações abertas; para outra situação (em disputa hoje, aguardando resultado, encerradas…), use a Busca avançada.')));
    return;
  }
  const situacao = filtros.visao && filtros.visao !== 'todas' ? meta.visoes[filtros.visao] : 'todas as situações';
  try {
    const res = await api(`/licitacoes${qs({ ...filtros, tamanho: 20 })}`);
    const aviso = avisoCoberturaItens(res.cobertura_itens, filtros);
    if (!res.total) { render(lista, aviso, vazio(`Nenhuma licitação encontrada com esses filtros (situação: ${situacao}).`)); return; }
    render(lista, aviso,
      h('div', { class: 'suave pequeno' }, `${numero(res.total)} licitação(ões) encontrada(s) · situação: ${situacao}`),
      ...res.dados.map((l) => linhaLicitacao(l, est, { aoKanban: podeEditar(est) ? (x) => enviarAoKanban(x, est) : null })),
      paginacao(res.pagina, res.paginas, (pagina) => aplicar({ pagina })));
  } catch (e) { render(lista, erroBox(e)); }
}

// ============================ DETALHE ============================
export async function detalhe(alvo, rota, est) {
  render(alvo, carregando());
  const id = rota.args[0];
  let d = await api(`/licitacoes/${id}`);
  // Itens e documentos ainda não baixados (o servidor baixa aos poucos): busca no PNCP agora, uma vez
  if (!d.licitacao.detalhes_sincronizados_em && d.licitacao.numero_controle_pncp && podeEditar(est) && !rota.buscouDetalhes) {
    render(alvo, carregando('Buscando os itens e os arquivos do edital no PNCP…'));
    try { await api(`/licitacoes/${id}/atualizar`, { metodo: 'POST', corpo: {} }); d = await api(`/licitacoes/${id}`); }
    catch (e) { toast(`PNCP não respondeu agora: ${e.message}`, 6000); }
    rota.buscouDetalhes = true;
  }
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
    ? [h('a', { class: 'btn', href: '#/kanban' }, `Kanban: ${d.oportunidade.etapa_nome}`), h('a', { class: 'btn', href: `#/cotacao/${d.oportunidade.id}` }, '💲 Cotações'),
      d.oportunidade.descarte_motivo ? h('div', { class: 'aviso amarelo pequeno', style: { flexBasis: '100%' } }, h('strong', {}, 'Descartada: '), d.oportunidade.descarte_motivo) : null]
    : podeEditar(est) ? h('button', { class: 'btn primario', onclick: () => enviarAoKanban(l, est, () => detalhe(alvo, rota, est)) }, emFoco ? `+ Kanban de ${nomeEmpresa(emFoco)}` : '+ Acompanhar no Kanban') : null;
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
    faixaGoverno(l),
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
        linha('Pagômetro', blocoPagometro(d.pagometro)),
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
      l.link_pncp ? h('p', { class: 'suave pequeno' }, 'Clique para abrir o arquivo. Se o PNCP estiver fora do ar, use ', h('a', { href: l.link_pncp, target: '_blank', rel: 'noopener noreferrer' }, 'a página oficial do edital no PNCP ↗'), '.') : null,
      d.documentos.length ? h('ul', {}, d.documentos.map((doc) => h('li', {},
        // O servidor baixa do PNCP e entrega; se o PNCP falhar, abre uma página com o motivo e o link oficial
        h('a', { href: `/api/licitacoes/${l.id}/documentos/${doc.sequencial}/arquivo`, target: '_blank', rel: 'noopener' }, `${doc.tipo || 'Documento'} — ${doc.titulo || doc.sequencial}`),
        h('span', { class: 'suave pequeno' }, ` · ${data(doc.data_publicacao) || ''}${doc.ativo === 0 ? ' · inativo' : ''}`))))
        : vazio(l.detalhes_sincronizados_em ? 'Nenhum documento publicado na fonte.' : 'Documentos ainda não sincronizados.')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Histórico de alterações e eventos'),
      d.eventos.length ? d.eventos.map((e) => h('div', { class: 'evento' },
        h('div', { class: 'quando' }, dataUtc(e.detectado_em), e.ocorrido_em ? h('div', {}, `fonte: ${data(e.ocorrido_em)}`) : null),
        h('div', {}, h('span', { class: 'etiqueta' }, e.tipo), ' ', e.descricao,
          e.valor_anterior != null ? h('div', { class: 'suave pequeno' }, `De: ${e.valor_anterior} → Para: ${e.valor_novo}`) : null)))
        : vazio('Sem eventos.')));
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
// "1.234,56", "R$ 1234,5", "1500" -> número; vazio -> null; texto inválido -> NaN
const paraNumero = (t) => {
  let x = String(t ?? '').replace(/[R$\s]/g, '');
  if (!x) return null;
  if (x.includes(',')) x = x.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, '');
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const fmtNum = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const FASES_POS_VITORIA = ['ganha', 'empenho', 'a_entregar', 'entregue', 'faturada', 'recebida'];
// Valor que o card mostra: o mais firme que já existe (recebido > nota > empenho > ganho > proposta)
const valorDoCard = (c) => [[c.recebido_valor, 'recebido'], [c.nf_valor, 'nota'], [c.empenho_valor, 'empenho'], [c.valor_ganho, 'ganho'], [c.valor_proposta, 'proposta']].find(([v]) => v != null);

// Valores e execução da oportunidade: proposta, resultado, empenho, entrega, nota fiscal e recebimento
function camposExecucao(c, fase) {
  const els = {};
  const valor = (k, rot) => { els[k] = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'R$ 0,00', value: fmtNum(c[k]), 'aria-label': rot }); els[k].dataset.tipo = 'valor'; return h('div', {}, h('label', {}, rot), els[k]); };
  const dia = (k, rot) => { els[k] = h('input', { type: 'date', value: c[k] || '', 'aria-label': rot }); return h('div', {}, h('label', {}, rot), els[k]); };
  const txt = (k, rot) => { els[k] = h('input', { type: 'text', maxlength: 60, value: c[k] || '', 'aria-label': rot }); return h('div', {}, h('label', {}, rot), els[k]); };
  const grupo = (titulo, ...campos) => h('fieldset', { class: 'grupo-exec' }, h('legend', {}, titulo), h('div', { class: 'grade-exec' }, campos));
  const el = h('details', { class: 'execucao', open: FASES_POS_VITORIA.includes(fase) || c.valor_proposta != null },
    h('summary', {}, '💰 Valores e execução ', h('span', { class: 'suave pequeno' }, '(alimentam o Dashboard › Empresas)')),
    grupo('Proposta e resultado', valor('valor_proposta', 'Valor da proposta'), valor('valor_ganho', 'Valor ganho')),
    grupo('Empenho', txt('empenho_numero', 'Nº do empenho'), valor('empenho_valor', 'Valor empenhado'), dia('empenho_data', 'Data do empenho')),
    grupo('Entrega', dia('entrega_prazo', 'Prazo de entrega'), dia('entrega_data', 'Entregue em')),
    grupo('Nota fiscal', txt('nf_numero', 'Nº da nota'), valor('nf_valor', 'Valor da nota'), dia('nf_data', 'Emitida em')),
    grupo('Recebimento', valor('recebido_valor', 'Valor recebido'), dia('recebido_data', 'Recebido em')));
  const ler = () => {
    const out = {};
    for (const [k, e] of Object.entries(els)) {
      let v = e.value.trim();
      if (e.dataset.tipo === 'valor') { v = paraNumero(v); if (Number.isNaN(v)) throw new Error(`Valor inválido em "${e.getAttribute('aria-label')}": use, por exemplo, 1.234,56`); }
      else v = v || null;
      if ((v ?? null) !== (c[k] ?? null)) out[k] = v;
    }
    return out;
  };
  return { el, ler };
}

const TIPO_HIST = { criacao: 'Criação', movimento: 'Mudou de etapa', comentario: 'Comentário', atribuicao: 'Responsável', prazo: 'Prazo interno', empresa: 'Empresa vinculada', valores: 'Valores', cotacao: 'Cotação', proposta: 'Proposta', descarte: 'Motivo do descarte', autorizacao: '🔒 Autorização do administrador' };

// "Nota fiscal emitida" e "Recebido" só mudam com a senha de um administrador (o servidor confere; nada fica guardado aqui).
// fn(extra) faz a chamada; se o servidor pedir a senha (423), abre a janela e tenta de novo com ela.
export async function comSenhaAdmin(fn, texto = 'Este card está em "Nota fiscal emitida" ou "Recebido". Para alterar, voltar de etapa ou excluir, um administrador precisa digitar a senha dele.', rodape = 'A autorização fica registrada no histórico do card com o nome do administrador.') {
  try { return await fn({}); } catch (e) { if (e.status !== 423) throw e; }
  return new Promise((resolve, reject) => {
    const campo = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Senha de um administrador' });
    const msg = h('p', { class: 'pequeno texto-alerta' });
    modal('🔒 Senha do administrador', h('div', {},
      h('p', {}, texto),
      campo, msg, h('p', { class: 'pequeno suave' }, rodape)),
    [{ texto: 'Autorizar', classe: 'primario', acao: async () => {
      try { resolve(await fn({ senha_admin: campo.value })); return true; }
      catch (e) { if (e.status === 423 || e.status === 429) { msg.textContent = e.message; campo.select(); return false; } reject(e); return true; }
    } }]);
    setTimeout(() => campo.focus(), 50);
  });
}

// Descartar pede o motivo, para a decisão não cair no esquecimento
function pedirJustificativa(c) {
  return new Promise((resolve) => {
    const campo = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'Ex.: exige atestado de capacidade técnica que a empresa não tem' });
    const msg = h('p', { class: 'pequeno texto-alerta' });
    modal('Por que descartar?', h('div', {},
      h('p', { class: 'suave pequeno' }, c.objeto?.slice(0, 140) || ''), campo, msg,
      h('p', { class: 'pequeno suave' }, 'O motivo aparece no card e avisa quem tentar subir esta licitação de novo.')),
    [{ texto: 'Descartar', classe: 'perigo', acao: () => {
      if (campo.value.trim().length < 10) { msg.textContent = 'Escreva o motivo (pelo menos 10 letras).'; return false; }
      resolve(campo.value.trim()); return true;
    } }]);
    setTimeout(() => campo.focus(), 50);
    // Fechar sem descartar: resolve null (o botão Fechar do modal só remove a janela)
    const obs = new MutationObserver(() => { if (!document.body.contains(campo)) { obs.disconnect(); resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}

/** Sobe a licitação para o Kanban; se ela já estiver na esteira (inclusive descartada), avisa em vez de duplicar. */
export async function enviarAoKanban(l, est, aoMudar) {
  const emFoco = empresaEmFoco(est);
  try {
    const r = await api('/kanban', { metodo: 'POST', corpo: { licitacao_id: l.id } });
    if (!r.existente) { toast(emFoco ? `Enviada ao Kanban de ${nomeEmpresa(emFoco)}.` : 'Enviada ao Kanban.'); aoMudar?.(); return; }
    if (r.fase === 'descartada') {
      modal('Esta licitação já foi descartada', h('div', {},
        h('p', {}, 'Ela já consta na esteira de ', h('strong', {}, 'Descartados'), emFoco ? ` de ${nomeEmpresa(emFoco)}` : '', r.descartado_em ? ` desde ${data(r.descartado_em, false)}` : '', '.'),
        r.motivo ? h('div', { class: 'aviso amarelo' }, h('strong', {}, 'Motivo: '), r.motivo) : null,
        h('p', { class: 'pequeno suave' }, 'Para retomar, abra o Kanban e mova o card de volta para a etapa desejada.')),
      [{ texto: 'Ver no Kanban', classe: 'primario', acao: () => { location.hash = '#/kanban'; } }]);
    } else toast(`Já está no Kanban, na etapa "${r.etapa}".`, 5000);
  } catch (e) { toast(e.message); }
}

// Ao mover o card para uma etapa de execução, pede os dados dessa etapa (só os que ainda estão vazios).
// Valores sugeridos vêm do próprio card (ex.: valor da nota = valor do empenho) e só gravam se o usuário salvar.
const hojeLocal = () => new Date().toLocaleDateString('sv-SE');
const PEDIR_NA_ETAPA = {
  ganha: { titulo: 'Licitação vencida', campos: [['valor_ganho', 'Valor ganho', 'valor', (c) => c.valor_proposta ?? c.valor_estimado]] },
  a_entregar: { titulo: 'Empenho recebido', campos: [['empenho_numero', 'Nº do empenho', 'texto'], ['empenho_valor', 'Valor empenhado', 'valor', (c) => c.valor_ganho ?? c.valor_proposta],
    ['empenho_data', 'Data do empenho', 'data', hojeLocal], ['entrega_prazo', 'Prazo de entrega', 'data']] },
  entregue: { titulo: 'Produto entregue / serviço executado', campos: [['entrega_data', 'Entregue em', 'data', hojeLocal]] },
  faturada: { titulo: 'Nota fiscal emitida', campos: [['nf_numero', 'Nº da nota', 'texto'], ['nf_valor', 'Valor da nota', 'valor', (c) => c.empenho_valor ?? c.valor_ganho], ['nf_data', 'Emitida em', 'data', hojeLocal]] },
  recebida: { titulo: 'Pagamento recebido', campos: [['recebido_valor', 'Valor recebido', 'valor', (c) => c.nf_valor], ['recebido_data', 'Recebido em', 'data', hojeLocal]] },
};
function pedirDadosDaEtapa(c, fase, aoSalvar) {
  const def = PEDIR_NA_ETAPA[fase];
  const faltam = def ? def.campos.filter(([k]) => c[k] == null || c[k] === '') : [];
  if (!faltam.length) return false;
  const els = {};
  const linhas = faltam.map(([k, rot, tipo, sug]) => {
    const v = sug ? sug(c) : null;
    els[k] = h('input', tipo === 'data' ? { type: 'date', value: v || '' }
      : tipo === 'valor' ? { type: 'text', inputmode: 'decimal', placeholder: 'R$ 0,00', value: fmtNum(v) } : { type: 'text', maxlength: 60 });
    els[k].dataset.tipo = tipo;
    return h('div', {}, h('label', {}, rot, v != null && tipo === 'valor' ? h('span', { class: 'suave pequeno' }, ' (sugerido: confira)') : null), els[k]);
  });
  modal(`${def.titulo}: registrar dados`, h('div', {},
    h('p', { class: 'suave pequeno' }, c.objeto?.slice(0, 120) || ''),
    h('div', { class: 'grade-exec' }, linhas),
    h('p', { class: 'suave pequeno' }, 'Esses dados alimentam o Dashboard › Empresas. Pode deixar em branco e completar depois no card.')),
  [{ texto: 'Salvar', classe: 'primario', acao: async () => {
    const corpo = {};
    for (const [k, e] of Object.entries(els)) {
      let v = e.value.trim();
      if (e.dataset.tipo === 'valor') { v = paraNumero(v); if (Number.isNaN(v)) { toast('Valor inválido: use, por exemplo, 1.234,56'); return false; } }
      if (v != null && v !== '') corpo[k] = v;
    }
    if (!Object.keys(corpo).length) return true;
    try { await api(`/kanban/${c.id}`, { metodo: 'PATCH', corpo }); toast('Dados registrados.'); aoSalvar(); }
    catch (e) { toast(e.message, 5000); return false; }
  } }]);
  return true;
}

// Arrastar com o mouse ou com o dedo (segurar ~0,3 s no celular). Enquanto arrasta, o quadro rola sozinho
// perto das bordas e a faixa de etapas no topo também aceita soltar, para não precisar rolar até a coluna.
let ouvintesArrastar = null;
function ativarArrastar(quadro, faixa, aoSoltar) {
  ouvintesArrastar?.abort(); ouvintesArrastar = new AbortController();
  const { signal } = ouvintesArrastar;
  let arr = null; // { card, id, fantasma, dx, dy, alvo, x, y }
  let pendente = null;
  const alvoEm = (x, y) => document.elementFromPoint(x, y)?.closest('[data-etapa]');
  const marcar = (el) => {
    if (arr.alvo === el) return;
    arr.alvo?.classList.remove('sobre'); arr.alvo = el; el?.classList.add('sobre');
  };
  const rolar = () => {
    if (!arr) return;
    const borda = 90; const f = faixa.getBoundingClientRect();
    // Sobre a faixa de etapas (quando ela rola, no celular) rola a faixa; no resto, rola o quadro
    const el = arr.y >= f.top && arr.y <= f.bottom ? faixa : quadro;
    const r = el.getBoundingClientRect();
    if (arr.x < r.left + borda) el.scrollLeft -= Math.ceil((r.left + borda - arr.x) / 6);
    else if (arr.x > r.right - borda) el.scrollLeft += Math.ceil((arr.x - (r.right - borda)) / 6);
    if (arr.y < 70) window.scrollBy(0, -12); else if (arr.y > window.innerHeight - 70) window.scrollBy(0, 12);
    marcar(alvoEm(arr.x, arr.y));
    requestAnimationFrame(rolar);
  };
  const comecar = (card, x, y) => {
    const r = card.getBoundingClientRect();
    const fantasma = card.cloneNode(true);
    fantasma.classList.add('fantasma'); fantasma.style.width = `${r.width}px`;
    document.body.append(fantasma);
    card.classList.add('arrastando'); document.body.classList.add('arrastando-card');
    arr = { card, id: card.dataset.id, origem: card.closest('[data-etapa]').dataset.etapa, fantasma, dx: x - r.left, dy: y - r.top, alvo: null, x, y };
    mover(x, y); requestAnimationFrame(rolar);
  };
  const mover = (x, y) => { arr.x = x; arr.y = y; arr.fantasma.style.transform = `translate(${x - arr.dx}px, ${y - arr.dy}px) rotate(2deg)`; };
  const terminar = (soltar) => {
    if (pendente) { clearTimeout(pendente.timer); pendente = null; }
    if (!arr) return;
    const { card, id, alvo, origem, fantasma } = arr;
    fantasma.remove(); card.classList.remove('arrastando'); document.body.classList.remove('arrastando-card'); alvo?.classList.remove('sobre');
    arr = null;
    card.dataset.arrastou = '1'; setTimeout(() => { delete card.dataset.arrastou; }, 50);
    if (soltar && alvo && alvo.dataset.etapa !== origem) aoSoltar(id, alvo.dataset.etapa);
  };
  quadro.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.cartao-k[data-arrastavel]');
    if (!card || e.button > 0 || e.target.closest('select, button, a, input')) return;
    const toque = e.pointerType !== 'mouse';
    pendente = { card, x: e.clientX, y: e.clientY, toque, pronto: !toque };
    if (toque) pendente.timer = setTimeout(() => { if (pendente) { pendente.pronto = true; navigator.vibrate?.(15); comecar(card, pendente.x, pendente.y); } }, 300);
  });
  window.addEventListener('pointermove', (e) => {
    if (arr) { mover(e.clientX, e.clientY); return; }
    if (!pendente) return;
    const longe = Math.hypot(e.clientX - pendente.x, e.clientY - pendente.y) > 8;
    if (pendente.toque) { if (longe) { clearTimeout(pendente.timer); pendente = null; } return; } // rolou a tela: não é arrasto
    if (longe) { const p = pendente; pendente = null; comecar(p.card, p.x, p.y); mover(e.clientX, e.clientY); }
  }, { signal });
  window.addEventListener('pointerup', () => terminar(true), { signal });
  window.addEventListener('pointercancel', () => terminar(false), { signal });
  // No celular, impede a página de rolar enquanto o card está sendo arrastado
  document.addEventListener('touchmove', (e) => { if (arr) e.preventDefault(); }, { passive: false, signal });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') terminar(false); }, { signal });
  faixa.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-etapa]'); if (!chip) return;
    quadro.querySelector(`.coluna-k[data-etapa="${chip.dataset.etapa}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  });
}
// Clicar numa área vazia do quadro (fora dos cards) e arrastar rola o Kanban para os lados, como "pegar" a tela.
// Só com mouse: no celular o dedo já rola o quadro naturalmente.
let ouvintesQuadro = null;
function ativarArrastarQuadro(quadro) {
  ouvintesQuadro?.abort(); ouvintesQuadro = new AbortController();
  const { signal } = ouvintesQuadro;
  let pan = null;
  quadro.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.cartao-k, select, button, a, input, textarea')) return;
    if (e.clientY > quadro.getBoundingClientRect().top + quadro.clientHeight) return; // barra de rolagem: deixa o navegador cuidar
    pan = { x: e.clientX, y: e.clientY, left: quadro.scrollLeft, top: window.scrollY, moveu: false };
    e.preventDefault();
  }, { signal });
  window.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x; const dy = e.clientY - pan.y;
    if (!pan.moveu && Math.hypot(dx, dy) < 4) return;
    pan.moveu = true; quadro.classList.add('pegando');
    quadro.scrollLeft = pan.left - dx;
    window.scrollTo(window.scrollX, pan.top - dy);
  }, { signal });
  const soltar = () => { if (pan) { pan = null; quadro.classList.remove('pegando'); } };
  window.addEventListener('pointerup', soltar, { signal });
  window.addEventListener('pointercancel', soltar, { signal });
}
let rolagemKanban = 0;

export async function kanban(alvo, _r, est) {
  if (!alvo.querySelector('.kanban')) render(alvo, carregando());
  const k = await api('/kanban');
  const recarregar = () => { rolagemKanban = document.querySelector('.kanban')?.scrollLeft || 0; kanban(alvo, _r, est); };
  const mover = async (cardId, etapaId) => {
    const c = k.cards.find((x) => String(x.id) === String(cardId)); const et = k.etapas.find((e) => String(e.id) === String(etapaId));
    if (!c || !et || c.etapa_id === et.id) return;
    try {
      const corpo = { etapa_id: Number(etapaId) };
      const atual = k.etapas.find((e) => e.id === c.etapa_id);
      if (et.fase === 'descartada' && atual?.fase !== 'descartada') {
        corpo.justificativa = await pedirJustificativa(c);
        if (!corpo.justificativa) { recarregar(); return; } // desistiu: o card volta para onde estava
      }
      await comSenhaAdmin((extra) => api(`/kanban/${cardId}`, { metodo: 'PATCH', corpo: { ...corpo, ...extra } }));
      recarregar();
      pedirDadosDaEtapa(c, et.fase, recarregar);
    } catch (e) { toast(e.message, 5000); recarregar(); }
  };
  // Clique em "🏢 Sem empresa" (ou no nome da empresa) para vincular a oportunidade a uma empresa cadastrada
  const vincularEmpresa = (c) => {
    const ativos = est.clientes.filter((cl) => cl.ativo || cl.id === c.cliente_id);
    const sel = h('select', {}, h('option', { value: '0' }, 'Sem empresa'),
      ativos.map((cl) => h('option', { value: cl.id, selected: cl.id === c.cliente_id }, cl.nome_fantasia || cl.razao_social)));
    modal('Vincular empresa', h('div', {},
      h('p', { class: 'suave' }, c.objeto?.slice(0, 140) || ''),
      h('div', { class: 'campo' }, h('label', {}, 'Empresa que vai disputar esta licitação'), sel),
      h('p', { class: 'pequeno suave' }, 'A oportunidade passa a aparecer no Kanban dessa empresa (seletor no topo). O histórico registra a troca.')),
    [{ texto: 'Vincular', classe: 'primario', acao: async () => {
      try { await api(`/kanban/${c.id}`, { metodo: 'PATCH', corpo: { cliente_id: Number(sel.value) } }); toast('Empresa vinculada.'); recarregar(); }
      catch (e) { toast(e.message); return false; }
    } }]);
  };
  const abrir = async (c) => {
    const hist = await api(`/kanban/${c.id}/historico`);
    const txt = h('textarea', { rows: 3, placeholder: 'Comentário…' });
    const resp = h('select', {}, h('option', { value: '' }, 'Sem responsável'), k.usuarios.map((u) => h('option', { value: u.id, selected: u.id === c.responsavel_id }, u.nome)));
    const prazo = h('input', { type: 'date', value: c.prazo_interno || '' });
    const execucao = camposExecucao(c, k.etapas.find((e) => e.id === c.etapa_id)?.fase);
    modal(c.objeto?.slice(0, 90) || 'Oportunidade', h('div', {},
      h('p', {}, h('a', { href: `#/licitacao/${c.licitacao_id}` }, 'Abrir licitação'), ' · ', h('a', { href: `#/cotacao/${c.id}`, title: 'Cotações dos fornecedores, custo, margem e preço mínimo por item' }, '💲 Cotações'), ' · ', h('a', { href: `#/proposta/${c.id}`, title: 'Proposta de preços montada a partir das cotações' }, '📝 Proposta'),
        ['ganha', 'empenho', 'a_entregar', 'entregue', 'faturada', 'recebida'].includes(k.etapas.find((e) => e.id === c.etapa_id)?.fase)
          ? [' · ', h('a', { href: `#/financeiro/custos/${c.id}`, title: 'Custos do contrato e lucro real' }, '📊 Custos e lucro')] : null,
        ' · Situação oficial: ', etiquetaStatus(c.status_calculado, est.meta)),
      faixaGoverno(c),
      h('div', { class: 'campo' }, h('label', {}, 'Responsável'), resp),
      h('div', { class: 'campo' }, h('label', {}, 'Prazo interno'), prazo),
      execucao.el,
      h('div', { class: 'campo' }, h('label', {}, 'Novo comentário'), txt),
      h('h3', {}, 'Histórico'),
      h('div', { class: 'pequeno' }, hist.map((x) => h('div', { class: 'evento' }, h('div', { class: 'quando' }, dataUtc(x.criado_em)), h('div', {}, h('strong', {}, x.usuario_nome || ''), ` · ${TIPO_HIST[x.tipo] || x.tipo}: ${x.texto || ''}`))))),
    podeEditar(est) ? [
      { texto: 'Salvar', classe: 'primario', acao: async () => {
        try {
          const corpo = { responsavel_id: resp.value ? Number(resp.value) : null, prazo_interno: prazo.value || null, ...execucao.ler() };
          await comSenhaAdmin((extra) => api(`/kanban/${c.id}`, { metodo: 'PATCH', corpo: { ...corpo, ...extra } }));
          if (txt.value.trim()) await api(`/kanban/${c.id}/comentarios`, { metodo: 'POST', corpo: { texto: txt.value.trim() } });
          recarregar();
        } catch (e) { toast(e.message); return false; }
      } },
      ...(est.usuario.papel !== 'analista' ? [{ texto: 'Remover do Kanban', classe: 'perigo', acao: async () => {
        if (!confirmar('Remover esta oportunidade do Kanban?')) return false;
        try { await comSenhaAdmin((extra) => api(`/kanban/${c.id}`, { metodo: 'DELETE', corpo: extra })); recarregar(); }
        catch (e) { toast(e.message, 5000); return false; }
      } }] : []),
    ] : []);
  };

  const colunas = k.etapas.map((et) => {
    const col = h('div', { class: 'coluna-k', 'data-etapa': et.id },
      h('h3', {}, h('span', {}, et.nome), h('span', { class: 'etiqueta' }, k.cards.filter((c) => c.etapa_id === et.id).length)),
      k.cards.filter((c) => c.etapa_id === et.id).map((c) => {
        const card = h('div', { class: 'cartao-k', 'data-id': c.id, 'data-arrastavel': podeEditar(est) ? '1' : null, title: podeEditar(est) ? 'Clique para abrir · segure e arraste para mudar de etapa' : null },
          h('div', { class: 't' }, c.objeto || '—'),
          h('div', { class: 'suave' }, c.orgao_nome || ''),
          h('div', { class: 'linha', style: { marginTop: '6px' } }, etiquetaStatus(c.status_calculado, est.meta),
            c.data_encerramento_proposta ? h('span', { class: 'suave' }, `até ${data(c.data_encerramento_proposta)}`) : null),
          c.responsavel_nome ? h('div', { class: 'suave' }, `👤 ${c.responsavel_nome}`) : null,
          c.descarte_motivo ? h('div', { class: 'motivo-descarte', title: 'Motivo do descarte' }, `✖ ${c.descarte_motivo}`) : null,
          ['faturada', 'recebida'].includes(k.etapas.find((e) => e.id === c.etapa_id)?.fase) ? h('div', { class: 'suave pequeno', title: 'Alterar, voltar de etapa ou excluir pede a senha de um administrador' }, '🔒 protegido') : null,
          valorDoCard(c) ? h('div', { class: 'valor-card', title: `Valor ${valorDoCard(c)[1]} informado no card` }, `💰 ${moeda(valorDoCard(c)[0])}`, h('span', { class: 'suave' }, ` · ${valorDoCard(c)[1]}`)) : null,
          !clienteSelecionado() && est.clientes?.length ? (podeEditar(est)
            ? h('button', { type: 'button', class: 'etiqueta empresa clicavel' + (c.cliente_nome ? '' : ' sem'), style: { marginTop: '6px' }, title: c.cliente_nome ? 'Trocar a empresa vinculada' : 'Clique para vincular uma empresa',
              onclick: (e) => { e.stopPropagation(); vincularEmpresa(c); } }, `🏢 ${c.cliente_nome || 'Sem empresa'}`, c.cliente_nome ? null : h('span', { class: 'acao-vinc' }, '· vincular'))
            : h('div', { class: 'etiqueta empresa', style: { marginTop: '6px' } }, `🏢 ${c.cliente_nome || 'Sem empresa'}`)) : null,
          podeEditar(est) ? h('select', { 'aria-label': 'Mover para', onclick: (e) => e.stopPropagation(), onchange: (e) => mover(c.id, e.target.value) },
            k.etapas.map((e2) => h('option', { value: e2.id, selected: e2.id === c.etapa_id }, `Mover: ${e2.nome}`))) : null);
        card.addEventListener('click', () => { if (!card.dataset.arrastou) abrir(c); });
        return card;
      }));
    return col;
  });
  const qtd = (id) => k.cards.filter((c) => c.etapa_id === id).length;
  const faixa = h('div', { class: 'kanban-etapas', title: 'Clique para ir até a etapa · solte um card aqui para movê-lo' },
    k.etapas.map((et) => h('button', { type: 'button', class: `chip-etapa fase-${et.fase || 'outra'}${qtd(et.id) ? '' : ' vazia'}`, 'data-etapa': et.id }, et.nome, h('b', {}, qtd(et.id)))));
  const quadro = h('div', { class: 'kanban' }, colunas);
  ativarArrastarQuadro(quadro);
  if (podeEditar(est)) ativarArrastar(quadro, faixa, mover);
  else faixa.addEventListener('click', (e) => { const ch = e.target.closest('[data-etapa]'); if (ch) quadro.querySelector(`.coluna-k[data-etapa="${ch.dataset.etapa}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }); });
  render(alvo, cabecalho('Meus Negócios', 'Kanban dos negócios, do edital ao dinheiro na conta. A situação oficial da licitação aparece na etiqueta e é independente da etapa.'),
    avisoEmpresa(est, 'Cards'),
    k.cards.length ? null : h('div', { class: 'aviso azul' }, 'Nenhuma oportunidade ainda. Abra uma licitação e clique em "+ Acompanhar no Kanban".'),
    faixa, quadro);
  quadro.scrollLeft = rolagemKanban; rolagemKanban = 0;
  document.documentElement.style.setProperty('--altura-topo', `${document.querySelector('.topo')?.offsetHeight || 60}px`);
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
  // Clique no dia: abre a lista completa daquele dia (horário, tipo, objeto, órgão, etapa do Kanban)
  const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const abrirDia = (d, evs) => {
    const titulo = `${SEMANA[d.getUTCDay()]}, ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
    const ordenados = [...evs].sort((a, b) => (a.dia_inteiro ? 1 : 0) - (b.dia_inteiro ? 1 : 0) || a.quando.localeCompare(b.quando));
    const fechar = modal(titulo.charAt(0).toUpperCase() + titulo.slice(1), ordenados.length
      ? h('div', { class: 'lista-dia-cal' }, ordenados.map((e) => h('div', { class: `item-dia-cal ${TIPO_CAL[e.tipo][1]}` },
        h('div', { class: 'item-dia-hora' }, e.dia_inteiro ? 'Dia todo' : e.quando.slice(11, 16)),
        h('div', { class: 'item-dia-corpo' },
          h('span', { class: `etiqueta ${TIPO_CAL[e.tipo][1]}` }, TIPO_CAL[e.tipo][0]),
          h('a', { class: 'item-dia-objeto', href: linkCal(e), onclick: () => fechar() }, e.tipo === 'vencimento' ? `${e.titulo} · ${e.objeto}` : e.objeto || '—'),
          h('div', { class: 'suave pequeno' }, [e.orgao_nome, [e.municipio, e.uf].filter(Boolean).join('/'), e.etapa && `Kanban: ${e.etapa}`].filter(Boolean).join(' · '))))))
      : vazio('Nada marcado para este dia.'));
  };
  const celulas = [];
  for (let d = inicioGrade; d <= fimGrade; d = new Date(d.getTime() + 86400000)) {
    const k = iso(d); const evs = porDia[k] || []; const dia = d;
    const abrir = () => abrirDia(dia, evs);
    celulas.push(h('div', { class: `dia-cal clicavel${d.getUTCMonth() !== mes - 1 ? ' fora' : ''}${k === hojeIso ? ' hoje' : ''}`,
      role: 'button', tabindex: '0', title: evs.length ? `Ver os ${evs.length} prazos do dia` : 'Ver o dia',
      'aria-label': `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}: ${evs.length ? `${evs.length} prazo(s)` : 'sem prazos'}`,
      // Clique no prazo continua abrindo a licitação; no resto da célula, abre o dia
      onclick: (e) => { if (!e.target.closest('a')) abrir(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } } },
      h('div', { class: 'num' }, String(d.getUTCDate())),
      evs.slice(0, 3).map(chip),
      evs.length > 3 ? h('div', { class: 'mais-cal' }, `+${evs.length - 3} mais`) : null));
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
        : vazio('Nenhum prazo nos próximos 30 dias. Suba licitações para o Kanban para vê-las aqui.')));
}

// ============================ ALERTAS E PESQUISAS ============================
// Cada tipo de alerta tem cor, ícone e o que fazer. A ordem é a de prioridade (urgente primeiro).
export const CATEGORIAS_ALERTA = {
  prazo_24h: { nome: 'Encerra em menos de 24h', icone: '⏰', cor: 'urgente', dica: 'Última chance: confira proposta e documentos no sistema da disputa.' },
  certidao_vencida: { nome: 'Certidão vencida ou vence hoje', icone: '⛔', cor: 'urgente', dica: 'Renove já: com certidão vencida a empresa pode ser inabilitada.' },
  prazo_3d: { nome: 'Encerra em até 3 dias', icone: '⏳', cor: 'atencao', dica: 'Revise proposta, habilitação e dúvidas ao pregoeiro enquanto há tempo.' },
  prazo_interno: { nome: 'Prazo interno', icone: '📌', cor: 'atencao', dica: 'Prazo que a equipe marcou no card do Kanban.' },
  interesse: { nome: 'Interesse do cliente', icone: '🙋', cor: 'cliente', dica: 'O cliente marcou no jornal. A licitação já entrou no Kanban, na primeira etapa.' },
  situacao: { nome: 'Mudança de situação', icone: '🔄', cor: 'situacao', dica: 'A situação oficial mudou (suspensa, adiada, revogada…). Confira no portal.' },
  edital: { nome: 'Edital alterado ou novo documento', icone: '📝', cor: 'edital', dica: 'Errata, esclarecimento ou anexo novo. Releia antes de enviar a proposta.' },
  resultado: { nome: 'Resultado publicado', icone: '🏁', cor: 'resultado', dica: 'Saiu o resultado: atualize o card no Kanban (Vencida ou Perdida).' },
  nota_emitir: { nome: 'Emitir nota fiscal', icone: '🧾', cor: 'nota', dica: 'Produto enviado ou serviço executado: emita a nota e mova o card para "Nota fiscal emitida".' },
  nota_cobrar: { nome: 'Cobrar pagamento', icone: '💰', cor: 'cobrar', dica: 'Nota emitida e pagamento não registrado. Cobre o órgão; ao receber, mova o card para "Recebido".' },
  certidao: { nome: 'Certidão vencendo', icone: '📄', cor: 'certidao', dica: 'Renove antes do vencimento para não perder licitações.' },
  jornal: { nome: 'Jornal do dia', icone: '📰', cor: 'jornal', dica: 'Oportunidades novas dos seus jornais salvos. Abra para marcar e enviar ao cliente.' },
  oportunidade: { nome: 'Nova oportunidade', icone: '🔎', cor: 'neutro', dica: 'Licitação nova que bate com uma pesquisa salva.' },
  outro: { nome: 'Outros avisos', icone: '🔔', cor: 'neutro', dica: '' },
};

function cartaoAlerta(n, aoLer) {
  const c = CATEGORIAS_ALERTA[n.categoria] || CATEGORIAS_ALERTA.outro;
  const local = [n.lic_municipio, n.lic_uf].filter(Boolean).join('/');
  const ehLic = !!n.licitacao_id;
  const link = ehLic ? `#/licitacao/${n.licitacao_id}` : n.link || (n.cliente_id ? `#/empresas/${n.cliente_id}` : null);
  // Prazo e lembretes repetem o objeto na mensagem; mudanças e interesse trazem um detalhe próprio
  const detalhe = ['situacao', 'edital', 'resultado', 'interesse', 'outro'].includes(n.categoria) || !ehLic ? n.mensagem
    : ['nota_emitir', 'nota_cobrar'].includes(n.categoria) ? (n.mensagem || '').split('. ')[0] : null;
  return h('article', { class: `alerta a-${c.cor}${n.lida ? '' : ' nao-lida'}` },
    h('div', { class: 'alerta-icone', 'aria-hidden': 'true' }, c.icone),
    h('div', { class: 'alerta-corpo' },
      h('div', { class: 'alerta-topo' },
        h('span', { class: 'alerta-tipo' }, c.nome),
        n.lida ? null : h('span', { class: 'alerta-nova' }, 'nova'),
        h('span', { class: 'alerta-quando' }, dataUtc(n.criado_em))),
      // O selo já diz o tipo; o título só aparece quando acrescenta algo (data do prazo, dias, nome da certidão)
      ['situacao', 'edital', 'resultado', 'interesse'].includes(n.categoria) || n.titulo === c.nome ? null : h('div', { class: 'alerta-titulo' }, n.titulo),
      ehLic ? h('a', { class: 'alerta-objeto', href: link }, n.lic_objeto || n.mensagem || 'Abrir licitação') : null,
      detalhe ? h('div', { class: 'alerta-detalhe' }, detalhe) : null,
      h('div', { class: 'alerta-meta' }, [
        n.cliente_nome ? `🏢 ${n.cliente_nome}` : null,
        n.lic_orgao, local || null,
        n.kanban_etapa ? `Kanban: ${n.kanban_etapa}` : null,
      ].filter(Boolean).join(' · ')),
      h('div', { class: 'alerta-acoes' },
        link ? h('a', { class: 'btn pequeno', href: link }, ehLic ? 'Abrir licitação' : n.link ? 'Abrir jornal' : 'Abrir empresa') : null,
        n.kanban_etapa ? h('a', { class: 'btn pequeno', href: '#/kanban' }, 'Ver no Kanban') : null,
        n.lida ? null : h('button', { class: 'btn pequeno', onclick: () => aoLer(n) }, 'Marcar como lida'))));
}

// Prioridade para o resumo (gráfico): cor fixa por grupo, validada para daltonismo (cor nunca sozinha: legenda com nome e número)
const PRIORIDADES_ALERTA = [
  { chave: 'hoje', nome: 'Agir hoje', cor: '#b42318', cats: ['prazo_24h', 'certidao_vencida'] },
  { chave: 'semana', nome: 'Esta semana', cor: '#eda100', cats: ['prazo_3d', 'prazo_interno'] },
  { chave: 'acompanhar', nome: 'Acompanhar', cor: '#2a78d6', cats: ['interesse', 'situacao', 'edital', 'resultado', 'jornal', 'oportunidade', 'outro'] },
  { chave: 'financeiro', nome: 'Financeiro (nota e cobrança)', cor: '#1baf7a', cats: ['nota_emitir', 'nota_cobrar'] },
  { chave: 'documentos', nome: 'Certidões vencendo', cor: '#8e5ac8', cats: ['certidao'] },
];

export async function notificacoes(alvo, r, est) {
  render(alvo, carregando());
  const [ns, ps] = await Promise.all([api('/notificacoes'), api('/pesquisas')]);
  const cat = r?.query?.get('cat') || '';
  const soNovas = r?.query?.get('novas') === '1';
  const ir = (q) => { location.hash = `#/notificacoes${qs(q)}`; };
  const recarregar = () => { window.dispatchEvent(new Event('atualizar-sino')); notificacoes(alvo, r, est); };
  const aoLer = async (n) => { await api(`/notificacoes/${n.id}/lida`, { metodo: 'POST', corpo: {} }); recarregar(); };
  const contagem = {};
  for (const n of ns) if (!soNovas || !n.lida) contagem[n.categoria] = (contagem[n.categoria] || 0) + 1;
  const visiveis = ns.filter((n) => (!soNovas || !n.lida) && (!cat || n.categoria === cat));
  const naoLidas = ns.filter((n) => !n.lida).length;
  const grupos = Object.keys(CATEGORIAS_ALERTA).map((k) => [k, visiveis.filter((n) => n.categoria === k)]).filter(([, l]) => l.length);
  // Grupo aberto/fechado: lembrado nesta aba do navegador; com ?cat= abre só aquele
  const CHAVE_ABERTOS = 'alertas-abertos';
  let abertos = new Set();
  try { abertos = new Set(JSON.parse(sessionStorage.getItem(CHAVE_ABERTOS) || '[]')); } catch { /* sem armazenamento: tudo fechado */ }
  if (cat) abertos = new Set([cat]);
  const guardar = () => { try { sessionStorage.setItem(CHAVE_ABERTOS, JSON.stringify([...abertos])); } catch { /* opcional */ } };
  const blocos = {};
  const abrir = (cats) => {
    let primeiro = null;
    for (const k of cats) if (blocos[k]) { blocos[k].open = true; primeiro ||= blocos[k]; }
    primeiro?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const contaPrio = PRIORIDADES_ALERTA.map((p) => ({ ...p, n: p.cats.reduce((t, k) => t + (contagem[k] || 0), 0) }));
  const total = Object.values(contagem).reduce((a, b) => a + b, 0);
  const hoje = contaPrio[0].n;
  const resumo = total ? h('div', { class: 'cartao resumo-alertas' },
    h('div', { class: 'resumo-alertas-kpis' },
      h('div', { class: `kpi-alerta${hoje ? ' urgente' : ''}` }, h('strong', {}, String(hoje)), h('span', {}, 'para agir hoje')),
      h('div', { class: 'kpi-alerta' }, h('strong', {}, String(naoLidas)), h('span', {}, 'não lidos')),
      h('div', { class: 'kpi-alerta' }, h('strong', {}, String(total)), h('span', {}, soNovas ? 'na lista (só não lidos)' : 'na lista'))),
    h('div', {}, h('h2', {}, 'Por prioridade'), h('p', { class: 'suave pequeno' }, 'Clique numa fatia ou na legenda para abrir esses alertas.'),
      rosca(contaPrio, { ordemFixa: true, rotulo: (p) => p.nome, rotuloTotal: 'alertas', aoClicar: (f) => abrir(f.cats) }))) : null;
  const marcarLidos = async (lista) => {
    const ids = lista.filter((n) => !n.lida).map((n) => n.id);
    if (!ids.length) return;
    await api('/notificacoes/lidas', { metodo: 'POST', corpo: { ids } }); recarregar();
  };
  render(alvo, avisoEmpresa(est, 'Alertas e pesquisas salvas'),
    cabecalho('Alertas', 'O que pede ação nas licitações do Kanban, nas certidões das empresas e nas notas fiscais. Clique num tipo para abrir.',
      naoLidas ? h('button', { class: 'btn', onclick: async () => { await api('/notificacoes/lidas', { metodo: 'POST', corpo: {} }); recarregar(); } }, `Marcar todos como lidos (${naoLidas})`) : null),
    resumo,
    h('div', { class: 'filtro-alertas' },
      h('label', { class: 'linha pequeno' }, h('input', { type: 'checkbox', checked: soNovas, onchange: (e) => ir({ cat: cat || undefined, novas: e.target.checked ? 1 : undefined }) }), 'Mostrar só os não lidos'),
      grupos.length > 1 ? h('div', { class: 'linha' },
        h('button', { class: 'btn pequeno', onclick: () => { for (const [k] of grupos) { blocos[k].open = true; } } }, 'Abrir todos'),
        h('button', { class: 'btn pequeno', onclick: () => { for (const [k] of grupos) { blocos[k].open = false; } } }, 'Fechar todos')) : null),
    grupos.length ? grupos.map(([k, lista]) => {
      const c = CATEGORIAS_ALERTA[k];
      const novas = lista.filter((n) => !n.lida).length;
      const el = h('details', { class: `grupo-alerta a-${c.cor}`, open: abertos.has(k),
        ontoggle: (e) => { if (e.target.open) abertos.add(k); else abertos.delete(k); guardar(); } },
        h('summary', {},
          h('span', { class: 'grupo-icone', 'aria-hidden': 'true' }, c.icone),
          h('span', { class: 'grupo-titulo' }, h('b', {}, c.nome), c.dica ? h('small', {}, c.dica) : null),
          novas ? h('span', { class: 'grupo-novas' }, `${novas} ${novas === 1 ? 'novo' : 'novos'}`) : null,
          h('span', { class: 'qtd' }, String(lista.length)),
          h('span', { class: 'seta', 'aria-hidden': 'true' })),
        h('div', { class: 'grupo-corpo' },
          novas ? h('div', { class: 'linha', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn pequeno', onclick: () => marcarLidos(lista) }, `Marcar estes como lidos (${novas})`)) : null,
          lista.map((n) => cartaoAlerta(n, aoLer))));
      blocos[k] = el;
      return el;
    }) : h('div', { class: 'cartao' }, vazio(soNovas || cat ? 'Nenhum alerta com esse filtro.' : 'Sem alertas no momento.')),
    h('details', { class: 'cartao como-alertas' }, h('summary', {}, 'Quando cada alerta aparece'),
      h('ul', {},
        h('li', {}, 'Prazos: 3 dias e 24 horas antes do fim das propostas, e o prazo interno do card no dia anterior e no próprio dia.'),
        h('li', {}, 'Mudanças no edital: situação, alteração, documento novo ou resultado, detectados na sincronização com o portal oficial.'),
        h('li', {}, 'Valem só para licitações no Kanban da empresa. Ao descartar, perder ou tirar do Kanban, o alerta some.'),
        h('li', {}, 'Interesse do cliente: quando ele marca licitações no jornal enviado por e-mail.'),
        h('li', {}, 'Certidões: 30, 15 e 7 dias antes do vencimento, no dia e no dia seguinte (cadastro de cada empresa).'),
        h('li', {}, 'Nota fiscal: ao chegar em "Produto enviado / serviço executado" e de novo 5 dias após a entrega; depois de emitida, cobrança com 30 e 60 dias sem recebimento.'),
        h('li', {}, 'E-mail: um resumo a cada 10 minutos, se ativado em ', h('a', { href: '#/configuracoes' }, 'Configurações'), '.'))),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Pesquisas salvas'),
      h('p', { class: 'suave pequeno' }, 'Com "Alertar" ligado, cada licitação nova que bate com a pesquisa aparece aqui como "Nova oportunidade".'),
      ps.length ? h('table', {}, h('tbody', {}, ps.map((p) => h('tr', {},
        h('td', {}, h('a', { href: `#/buscar${qs(JSON.parse(p.filtros_json))}` }, p.nome)),
        h('td', {}, h('label', { class: 'linha' }, h('input', { type: 'checkbox', checked: !!p.alertar, onchange: async (e) => { await api(`/pesquisas/${p.id}`, { metodo: 'PATCH', corpo: { alertar: e.target.checked } }); toast('Alerta atualizado.'); } }), 'Alertar')),
        h('td', {}, h('button', { class: 'btn pequeno perigo', onclick: async () => { if (confirmar('Excluir pesquisa?')) { await api(`/pesquisas/${p.id}`, { metodo: 'DELETE' }); notificacoes(alvo, r, est); } } }, 'Excluir'))))))
        : vazio('Nenhuma pesquisa salva. Salve uma pesquisa na tela de busca.')));
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
// Espaço do disco do servidor (volume do Railway): total, livre, barra e o que mais ocupa
async function cartaoDisco() {
  let d = null;
  try { d = (await api('/sistema/disco')).disco; } catch { /* sem permissão ou servidor sem volume */ }
  const gb = (mb) => `${(mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`;
  const tam = (mb) => (mb >= 1024 ? gb(mb) : `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`);
  if (!d) return h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Disco do servidor'), naoInformado('Não foi possível ler o espaço do disco agora.'));
  const usadoPct = Math.round((d.usado_mb / d.total_mb) * 1000) / 10;
  return h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Disco do servidor (Railway)'),
    h('div', { class: 'disco-numeros' }, h('b', {}, `${gb(d.livre_mb)} livres`), ` de ${gb(d.total_mb)} · ${gb(d.usado_mb)} usados (${usadoPct.toLocaleString('pt-BR')}%)`),
    h('div', { class: 'barra-disco' }, h('div', { class: d.baixo ? 'cheia' : '', style: { width: `${Math.min(100, usadoPct)}%` } })),
    d.baixo ? h('div', { class: 'aviso vermelho pequeno' }, 'Disco quase cheio: o sistema parou de baixar licitações e de copiar arquivos. Aumente o volume no Railway (clique no volume › Settings).') : null,
    h('ul', { class: 'suave pequeno' }, d.partes.map((p) => h('li', {}, `${p.nome}: ${tam(p.mb)}`))),
    h('div', { class: 'suave pequeno' }, `Proteção automática: com menos de ${d.limite_pct}% ou ${d.limite_mb} MB livres, o sistema para de baixar dados novos.`));
}

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
  if (['admin', 'gestor'].includes(est.usuario.papel)) blocos.push(await cartaoDisco());
  const pref = await api('/preferencias');
  const destino = h('input', { type: 'email', value: pref.email_alertas, placeholder: pref.email_login });
  const ativo = h('input', { type: 'checkbox', checked: pref.alertas_email });
  blocos.push(h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Alertas por e-mail'),
    pref.email ? null : h('div', { class: 'aviso amarelo' }, 'O envio de e-mail ainda não está ativado no servidor (variável BREVO_API_KEY ou SMTP_URL). Os alertas continuam aparecendo no sistema.'),
    pref.envio?.provedor === 'brevo' ? h('div', { class: 'suave pequeno' }, `Envio pelo Brevo · remetente: ${pref.envio.remetente || 'não definido (crie EMAIL_REMETENTE)'}`) : null,
    pref.envio?.provedor === 'smtp' ? h('div', { class: 'aviso amarelo' }, 'Envio por SMTP (SMTP_URL). No Railway Hobby o SMTP é bloqueado e o e-mail não sai: crie BREVO_API_KEY e EMAIL_REMETENTE nas variáveis do Railway e faça o Redeploy.') : null,
    pref.envio?.ultimo_erro ? h('div', { class: 'aviso vermelho pequeno' }, `Último erro de envio: ${pref.envio.ultimo_erro}`) : null,
    h('label', { class: 'linha' }, ativo, 'Receber resumo dos alertas por e-mail'),
    h('div', { class: 'campo', style: { marginTop: '10px' } }, h('label', {}, 'Enviar alertas para (vazio = e-mail de login)'), destino),
    h('div', { class: 'linha' },
      h('button', { class: 'btn primario', onclick: async () => {
        try { await api('/preferencias', { metodo: 'PATCH', corpo: { alertas_email: ativo.checked, email_alertas: destino.value } }); toast('Preferências salvas.'); }
        catch (e) { toast(e.message); }
      } }, 'Salvar'),
      h('button', { class: 'btn', disabled: !pref.email, title: pref.email ? '' : 'E-mail do sistema não configurado no servidor', onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'Enviando…';
        try { const r = await api('/email/teste', { metodo: 'POST', corpo: {} }); toast(`${r.mensagem} Se não chegar em alguns minutos, olhe o spam.`, 8000); }
        catch (e) { toast(e.message, 12000); }
        finally { b.disabled = false; b.textContent = 'Enviar e-mail de teste'; }
      } }, 'Enviar e-mail de teste'))));
  if (ehAdmin(est)) {
    // Nome e e-mail que aparecem no jornal do cliente (capa, rodapé e e-mail)
    const da = await api('/empresa/dados');
    const nomeAss = h('input', { type: 'text', value: da.nome, maxlength: 120 });
    const emailAss = h('input', { type: 'email', value: da.email_contato, placeholder: est.usuario.email });
    blocos.push(h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Dados da assessoria no jornal'),
      h('p', { class: 'suave pequeno' }, 'Aparecem na capa e no rodapé do jornal de licitações (PDF, impressão e e-mail) que vai para o empresário.'),
      h('div', { class: 'campo' }, h('label', {}, 'Nome da assessoria'), nomeAss),
      h('div', { class: 'campo' }, h('label', {}, 'E-mail de contato (vazio = e-mail de quem montou o jornal)'), emailAss),
      h('button', { class: 'btn primario', onclick: async () => {
        try { await api('/empresa/dados', { metodo: 'PATCH', corpo: { nome: nomeAss.value, email_contato: emailAss.value } }); toast('Dados da assessoria salvos.'); }
        catch (e) { toast(e.message); }
      } }, 'Salvar')));
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
const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
const moedaUnit = (v) => (v == null ? naoInformado() : brl(v));
const TIPO_CAT = { material_pdm: 'Material (PDM)', material_item: 'Material (código CATMAT)', servico: 'Serviço (código CATSER)' };
const LEI_14133 = 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm';
const IN_65 = 'https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-me-no-65-de-7-de-julho-de-2021';

export async function precos(alvo, rota, est) {
  const aba = (rota.args[0] || '').split('?')[0] === 'contratos' ? 'contratos' : 'precos';
  const abas = h('div', { class: 'abas', role: 'tablist' },
    h('a', { class: aba === 'precos' ? 'ativo' : '', role: 'tab', href: '#/precos' }, 'Panorama e preços'),
    h('a', { class: aba === 'contratos' ? 'ativo' : '', role: 'tab', href: '#/precos/contratos' }, 'Contratos assinados'));
  const corpo = h('div', {}, carregando());
  render(alvo, cabecalho('Análise de mercado', aba === 'precos'
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

  if (q.tipo && q.codigo) return mostrarPrecos(resultado, q, ir, est);
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
    const botaoCat = (c) => h('button', { class: 'item-cat', onclick: () => ir({ tipo: c.tipo === 'servico' ? 'servico' : 'material_pdm', codigo: c.codigo, item: '', unidade: '' }) },
      h('span', { class: `etiqueta ${c.tipo === 'servico' ? 'azul' : 'verde'}` }, c.tipo === 'servico' ? 'Serviço' : 'Material'),
      h('strong', {}, c.nome), c.sugerido ? h('span', { class: 'etiqueta azul pequena', title: c.sugerido }, '★ mais usado nas compras') : null,
      h('span', { class: 'suave pequeno' }, `${c.classe || ''} · código ${c.codigo}${c.sugerido ? ` · ${c.sugerido}` : ''}`));
    // Material e serviço separados: serviço que só cita as palavras (ex.: outsourcing de impressão "com papel A4")
    // fica num bloco fechado quando há material, para não esconder o produto procurado
    const materiais = lista.filter((c) => c.tipo !== 'servico');
    const servicos = lista.filter((c) => c.tipo === 'servico');
    const blocoServicos = !servicos.length ? null : materiais.length
      ? h('details', { class: 'servicos-cat' },
        h('summary', {}, `Serviços que citam essas palavras (${servicos.length})`),
        h('p', { class: 'suave pequeno' }, 'Ex.: locação ou outsourcing de impressão citam "papel" e "A4", mas são contratação de serviço, não compra do produto.'),
        h('div', { class: 'lista-cat' }, servicos.map(botaoCat)))
      : h('div', {}, h('h3', {}, `Serviços (${servicos.length})`), h('div', { class: 'lista-cat' }, servicos.map(botaoCat)));
    render(resultado, h('div', { class: 'cartao' },
      h('h2', {}, `Escolha o item do catálogo (${lista.length}${lista.length >= 30 ? '+' : ''})`),
      h('p', { class: 'suave pequeno' }, 'Material aparece pelo PDM (o "tipo" do produto, que reúne as variações). Serviço aparece pelo código CATSER.'),
      materiais.length ? h('div', {}, servicos.length ? h('h3', {}, `Materiais (${materiais.length})`) : null, h('div', { class: 'lista-cat' }, materiais.map(botaoCat))) : null,
      blocoServicos,
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

async function mostrarPrecos(alvo, q, ir, est) {
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
      d.truncado ? h('div', { class: 'aviso amarelo', style: { marginTop: '8px' } }, `A fonte tem ${numero(d.total_fonte)} preços nesse período; trouxemos os ${numero(d.baixados)} mais recentes. Escolha um estado ou um período menor para ver tudo.`) : null,
      h('div', { class: 'filtros', style: { marginTop: '10px' } }, filtroEspec, filtroItem, filtroUnid),
      q.filtro ? h('div', { class: 'suave pequeno', style: { marginTop: '6px' } }, `Mostrando só as compras cuja descrição tem: "${q.filtro}". `,
        h('a', { href: `#/precos${qs({ ...q, filtro: '' })}` }, 'Limpar filtro')) : null),
    e.n ? blocoRelatorio(q, est) : null,
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
    e.n && d.panorama ? blocoPanorama(d.panorama, d.unidade, { uf: d.consulta.uf }) : null,
    e.n ? h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('div', { class: 'cabecalho-pagina', style: { marginBottom: '8px' } }, h('h2', { style: { margin: 0 } }, `Preços (${numero(d.registros.length)})`),
        h('div', { class: 'linha' }, h('label', { for: 'p-ordem', class: 'suave pequeno' }, 'Ordenar'),
          h('select', { id: 'p-ordem', onchange: (ev) => { ordem = ev.target.value; mostrar = 50; desenharTabela(); } },
            h('option', { value: 'data' }, 'Mais recentes'), h('option', { value: 'menor' }, 'Menor preço'), h('option', { value: 'maior' }, 'Maior preço')))),
      tabela) : null);
}

// ---------- Panorama do mercado (Análise de mercado) ----------
function blocoPanorama(p, unidade, { uf } = {}) {
  const un = unidade ? ` (${unidade})` : '';
  const cartao = (titulo, sub, ...corpo) => h('div', { class: 'cartao' }, h('h3', { style: { margin: '0 0 4px' } }, titulo), sub ? h('div', { class: 'suave pequeno', style: { marginBottom: '8px' } }, sub) : null, ...corpo);
  const marcasQtd = p.marcas_top.map((m) => ({ rotulo: m.nome, n: m.quantidade || m.compras }));
  const mesNome = (m) => { const [a, mm] = m.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1]}/${a.slice(2)}`; };

  // Simulador: com o meu menor preço aceitável, em que posição eu ficaria entre os preços já pagos?
  const resultadoSim = h('div', { class: 'pequeno', style: { marginTop: '8px' } });
  const simular = (v) => {
    const x = Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!(x > 0) || !p.precos.length) { render(resultadoSim, h('span', { class: 'suave' }, 'Digite o seu menor preço unitário aceitável (o preço mínimo de venda da cotação).')); return; }
    const abaixo = p.precos.filter((y) => y < x).length;
    const pctAbaixo = Math.round((abaixo / p.precos.length) * 100);
    const concorrentes = p.fornecedores.filter((f) => f.mediana != null && f.mediana < x);
    render(resultadoSim,
      h('div', {}, h('strong', {}, `Posição estimada: ${abaixo + 1}º de ${p.precos.length + 1}`), ` · ${pctAbaixo}% das compras foram fechadas por menos que ${brl(x)}.`),
      h('div', { class: pctAbaixo <= 25 ? 'texto-sucesso' : pctAbaixo <= 60 ? '' : 'texto-perigo', style: { marginTop: '4px' } },
        pctAbaixo <= 25 ? 'Seu preço é competitivo: está entre os mais baixos já pagos.'
          : pctAbaixo <= 60 ? 'Seu preço está na faixa do meio: dá para disputar, mas há concorrentes que costumam vender mais barato.'
            : 'Seu preço está acima da maioria dos preços já pagos: a chance de vencer é baixa.'),
      concorrentes.length ? h('div', { style: { marginTop: '4px' } }, `Fornecedores que costumam vender abaixo disso (mediana): `,
        concorrentes.slice(0, 5).map((f) => `${f.nome} (${brl(f.mediana)})`).join(' · '), concorrentes.length > 5 ? ` e mais ${concorrentes.length - 5}.` : '.') : null,
      h('div', { class: 'suave', style: { marginTop: '4px' } }, 'Estimativa com preços de compras já fechadas (sem os fora da curva). A disputa real depende de quem participar.'));
  };
  const campoSim = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ex.: 23,90', style: { maxWidth: '160px' }, oninput: (ev) => simular(ev.target.value) });
  simular('');

  const tabelaForn = h('div', { class: 'tabela-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['#', 'Fornecedor', 'Vendas', 'Menor preço', 'Mediana', 'Último preço', 'Marcas'].map((t) => h('th', {}, t)))),
    h('tbody', {}, p.fornecedores.map((f, k) => h('tr', {},
      h('td', {}, `${k + 1}º`), h('td', {}, f.nome, f.ni ? h('div', { class: 'suave pequeno' }, f.ni.length === 14 ? f.ni.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : 'CPF') : null),
      h('td', { class: 'num' }, numero(f.compras)), h('td', { class: 'num' }, moedaUnit(f.menor)), h('td', { class: 'num' }, h('strong', {}, moedaUnit(f.mediana))),
      h('td', { class: 'num' }, moedaUnit(f.ultimo_preco), f.ultima_data ? h('div', { class: 'suave pequeno' }, data(f.ultima_data, false)) : null),
      h('td', { class: 'pequeno' }, f.marcas.join(', ') || '—'))))));

  const tabelaUltimas = h('div', { class: 'tabela-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Data', 'Marca', 'Fornecedor', 'Órgão', 'Preço unit.'].map((t) => h('th', {}, t)))),
    h('tbody', {}, p.ultimas_marcas.map((m) => h('tr', {},
      h('td', {}, data(m.data, false) || '—'), h('td', {}, h('strong', {}, m.marca)), h('td', { class: 'pequeno' }, m.fornecedor || '—'),
      h('td', { class: 'pequeno' }, m.orgao || '—', m.local ? h('div', { class: 'suave' }, m.local) : null), h('td', { class: 'num' }, moedaUnit(m.preco), m.fora_da_curva ? h('div', {}, h('span', { class: 'etiqueta vermelha', title: 'Fora da faixa usual: provável erro de lançamento na fonte (ex.: valor total como unitário).' }, 'fora da curva')) : null))))));

  return h('div', { class: 'panorama-mercado', style: { marginTop: '14px' } },
    h('h2', {}, `Panorama do mercado${un}`),
    h('div', { class: 'suave pequeno', style: { marginBottom: '10px' } },
      `${numero(p.compras)} compra(s) · ${numero(p.quantidade)} unidade(s) compradas · ${moeda(p.valor_total)} movimentados · ${numero(p.marcas_total)} marca(s) · ${numero(p.fornecedores_total)} fornecedor(es) vencedor(es)`,
      p.sem_marca ? ` · ${numero(p.sem_marca)} compra(s) sem marca identificável (ex.: "conforme edital")` : ''),
    h('div', { class: 'grade duas' },
      cartao('Marcas mais vendidas (participação)', `Pela quantidade comprada${un}.`, rosca(marcasQtd, { max: 6 })),
      cartao('Ranking das 10 marcas', 'Quantidade comprada por marca.', barras(marcasQtd, { max: 10 }))),
    h('div', { class: 'grade duas', style: { marginTop: '14px' } },
      cartao('Quem compra (esfera)', 'Número de compras por esfera de governo.', rosca(p.por_esfera.map((x) => ({ rotulo: x.nome, n: x.compras })), { max: 4 })),
      uf ? cartao('Volume por mês', 'Número de compras por mês no período.', barras(p.por_mes.map((x) => ({ rotulo: mesNome(x.mes), n: x.compras })), { max: 12 }))
        : cartao('Estados que mais compram', 'Número de compras por estado.', barras(p.por_uf.map((x) => ({ rotulo: x.nome, n: x.compras })), { max: 10 }))),
    h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('h3', { style: { margin: '0 0 4px' } }, 'Com o meu menor preço, em que posição eu ficaria?'),
      h('div', { class: 'linha' }, h('label', { class: 'pequeno' }, 'Meu menor preço aceitável (unit.) R$'), campoSim), resultadoSim),
    h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('h3', { style: { margin: '0 0 4px' } }, 'Melhores preços por fornecedor'),
      h('div', { class: 'suave pequeno', style: { marginBottom: '8px' } }, 'Do mais barato para o mais caro, pela mediana dos preços com que cada fornecedor venceu. Preços fora da curva ficam de fora.'),
      tabelaForn),
    p.ultimas_marcas.length ? h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h3', { style: { margin: '0 0 8px' } }, 'Últimas marcas entregues'), tabelaUltimas) : null);
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
      paginacao(r.pagina, totalPag, (pagina) => ir({ pagina })));
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

function blocoPagometro(pg) {
  if (!pg) return naoInformado();
  if (!pg.aplica) return h('span', { class: 'suave' }, pg.motivo);
  if (!pg.encontrado) return naoInformado(pg.motivo);
  return h('div', { class: 'bloco-pagometro' },
    h('div', {}, seloCapag(pg.capag, { longo: true }), ' ', pg.capag ? h('strong', {}, textoNotaCapag[pg.capag[0]]) : h('span', {}, pg.observacao || 'Nota não calculada pelo Tesouro.')),
    h('div', { class: 'linha pequeno', style: { marginTop: '4px' } }, INDICADORES_CAPAG.map(([i, n, rot, dica]) => h('span', { title: dica },
      `${rot}: `, pg[n] ? h('b', {}, pg[n]) : '—', pg[i] != null ? ` (${pg[i].toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)` : ''))),
    h('div', { class: 'suave pequeno' }, `${pg.esfera === 'M' ? pg.nome + '/' + pg.uf : 'Estado ' + pg.uf} · Tesouro Nacional, ${pg.referencia || 'posição mais recente'} · `,
      h('a', { href: pg.fonte_pagina, target: '_blank', rel: 'noopener noreferrer' }, 'fonte ↗')));
}

// ============================ PAGÔMETRO ============================
export async function pagometro(alvo, rota, est) {
  render(alvo, carregando());
  const q = rota.query;
  const r = await api('/pagometro' + qs({ esfera: q.get('esfera') || '', uf: q.get('uf') || '', q: q.get('q') || '', nota: q.get('nota') || '' }));
  const ir = (mud) => { const n = new URLSearchParams(q); for (const [k, v] of Object.entries(mud)) { if (v) n.set(k, v); else n.delete(k); } location.hash = `#/pagometro?${n}`; };
  const contagem = (esfera, nota) => r.resumo.find((x) => x.esfera === esfera && x.nota === nota)?.n || 0;
  const ref = (e) => r.referencias.find((x) => x.esfera === e);
  const busca = h('input', { type: 'search', placeholder: 'Nome do município', value: q.get('q') || '', id: 'pg-q' });
  const uf = h('select', { id: 'pg-uf', onchange: (e) => ir({ uf: e.target.value }) }, h('option', { value: '' }, 'Todas as UFs'), est.meta.ufs.map((u) => h('option', { value: u, selected: q.get('uf') === u }, u)));
  render(alvo,
    cabecalho('Pagômetro', 'Capacidade de pagamento de estados e municípios (CAPAG do Tesouro Nacional). Prefira disputar onde a nota é A ou B.',
      ehAdmin(est) ? h('button', { class: 'btn', onclick: async (ev) => {
        ev.target.disabled = true; toast('Baixando a CAPAG do Tesouro...', 4000);
        try { const x = await api('/pagometro/atualizar', { metodo: 'POST', corpo: {} }); toast(Object.entries(x).map(([k, v]) => `${k === 'M' ? 'Municípios' : 'Estados'}: ${v.erro || v.linhas + ' registros'}`).join(' · '), 7000); pagometro(alvo, rota, est); }
        catch (e) { toast(e.message, 6000); ev.target.disabled = false; }
      } }, 'Atualizar dados') : null),
    h('div', { class: 'aviso azul' }, h('strong', {}, 'Como ler: '),
      'A = boa capacidade de pagamento · B = razoável · C = fraca · D = muito fraca · "+" = boa qualidade da informação contábil. ',
      'O indicador de ', h('b', {}, 'liquidez'), ' compara o caixa com as contas a pagar de curto prazo: nota C ali indica que o ente deve mais do que tem em caixa. ',
      h('div', { class: 'pequeno', style: { marginTop: '4px' } }, 'A CAPAG mede a saúde fiscal do município ou do estado inteiro, não o histórico de pagamento de um órgão específico. Órgãos federais não têm CAPAG. ',
        'Fontes: ', h('a', { href: r.fontes.M.pagina, target: '_blank', rel: 'noopener noreferrer' }, 'CAPAG municípios ↗'), ' · ', h('a', { href: r.fontes.E.pagina, target: '_blank', rel: 'noopener noreferrer' }, 'CAPAG estados ↗'),
        ref('M') ? ` · Municípios: ${ref('M').referencia || ''}` : ' · Municípios: ainda não baixado', ref('E') ? ` · Estados: ${ref('E').referencia || ''}` : ' · Estados: ainda não baixado')),
    h('div', { class: 'grade kpis' }, ['A', 'B', 'C', 'D', 'n.d.'].map((n) => h('a', { class: 'cartao kpi', href: `#/pagometro?esfera=M&nota=${n === 'n.d.' ? 'sem' : n}${q.get('uf') ? '&uf=' + q.get('uf') : ''}` },
      h('div', { class: 'rotulo' }, n === 'n.d.' ? 'Municípios sem nota' : `Municípios nota ${n}`), h('div', { class: 'valor' }, numero(contagem('M', n)))))),
    h('form', { class: 'cartao linha', style: { marginTop: '14px' }, onsubmit: (e) => { e.preventDefault(); ir({ q: busca.value.trim() }); } },
      h('select', { onchange: (e) => ir({ esfera: e.target.value }) }, [['', 'Estados e municípios'], ['M', 'Só municípios'], ['E', 'Só estados']].map(([v, t]) => h('option', { value: v, selected: (q.get('esfera') || '') === v }, t))),
      uf, busca,
      h('select', { onchange: (e) => ir({ nota: e.target.value }) }, [['', 'Todas as notas'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['sem', 'Sem nota']].map(([v, t]) => h('option', { value: v, selected: (q.get('nota') || '') === v }, t))),
      h('button', { class: 'btn primario' }, 'Filtrar')),
    r.dados.length ? h('div', { class: 'tabela-wrap', style: { marginTop: '14px' } }, h('table', {},
      h('thead', {}, h('tr', {}, ['Ente', 'UF', 'CAPAG', 'Endividamento', 'Poupança corrente', 'Liquidez', 'Licitações'].map((t) => h('th', {}, t)))),
      h('tbody', {}, r.dados.map((c) => h('tr', { class: c.capag && 'CD'.includes(c.capag[0]) ? 'linha-alerta' : '' },
        h('td', {}, c.esfera === 'E' ? `Estado (${c.uf})` : c.nome, c.observacao ? h('div', { class: 'suave pequeno' }, c.observacao) : null),
        h('td', {}, c.uf), h('td', {}, seloCapag(c.capag)),
        ...INDICADORES_CAPAG.map(([i, n]) => h('td', {}, c[n] || '—', c[i] != null ? h('span', { class: 'suave pequeno' }, ` ${c[i].toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`) : null)),
        h('td', {}, h('a', { href: `#/buscar?visao=abertas&uf=${c.uf}${c.esfera === 'M' ? '&municipio=' + encodeURIComponent(c.nome) + '&esfera=M' : '&esfera=E'}` }, 'Ver abertas')))))))
      : vazio(ref('M') || ref('E') ? 'Nenhum ente com esses filtros.' : 'Os dados da CAPAG ainda não foram baixados. Eles são baixados automaticamente; o administrador também pode clicar em "Atualizar dados".'),
    r.total > r.dados.length ? h('p', { class: 'suave pequeno' }, `Mostrando ${r.dados.length} de ${numero(r.total)}. Use os filtros para refinar.`) : null);
}
