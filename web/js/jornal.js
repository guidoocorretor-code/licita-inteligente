// Jornal de licitações: feed do que mudou nas sincronizações + montagem do jornal para o cliente
// (marcar cards, imprimir com o cabeçalho da empresa, PDF clicável e e-mail ao representante legal com o
// link em que ele marca as licitações de interesse; a resposta volta como alerta e favorito).
import { api, qs, clienteSelecionado } from './api.js';
import { h, render, toast, carregando, vazio, dataUtc, modal, paginacao } from './ui.js';
import { linhaLicitacao, enviarAoKanban } from './paginas.js';

const TIPOS_EVENTO = { nova: 'Nova no jornal', aberta: 'Aberta', publicacao: 'Nova publicação', alteracao: 'Alteração/retificação', situacao: 'Mudança de situação', documento: 'Novo documento', resultado: 'Resultado/homologação', item: 'Item' };
// Até 4 casas: o órgão publica valor unitário com 4 casas (ex.: R$ 139,0815) e o lance aceita 0,0001; arredondar a 2 mostra valor errado
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBr = (iso) => { if (!iso) return null; const [d, t] = String(iso).replace(' ', 'T').split('T'); const [a, m, dia] = d.split('-'); return `${dia}/${m}/${a}${t && t.slice(0, 5) !== '00:00' ? ` ${t.slice(0, 5)}` : ''}`; };
const cnpjFmt = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const valorTexto = (l) => (l.valor_estimado_situacao === 'sigiloso' ? 'Sigiloso' : l.valor_estimado != null && l.valor_estimado_situacao !== 'nao_informado' ? BRL.format(l.valor_estimado) : 'Não informado');

// Seleção guardada nesta aba (sobrevive à troca de página do feed)
const CHAVE = 'licita.jornal.selecao';
const lerSelecao = () => { try { return new Set(JSON.parse(sessionStorage.getItem(CHAVE) || '[]')); } catch { return new Set(); } };
const gravarSelecao = (s) => { try { sessionStorage.setItem(CHAVE, JSON.stringify([...s])); } catch { /* ignora */ } };

export async function jornal(alvo, rota, est) {
  const f = Object.fromEntries(rota.query.entries());
  const q = h('input', { type: 'search', value: f.q || '', placeholder: 'Palavra-chave', id: 'j-q' });
  const tipo = h('select', { id: 'j-tipo' }, h('option', { value: '' }, 'Todos os tipos'), Object.entries(TIPOS_EVENTO).map(([k, v]) => h('option', { value: k, selected: f.tipo === k }, v)));
  const uf = h('select', { id: 'j-uf' }, h('option', { value: '' }, 'Todas as UFs'), est.meta.ufs.map((u) => h('option', { value: u, selected: f.uf === u }, u)));
  const seg = h('select', { id: 'j-seg' }, h('option', { value: '' }, 'Todos os segmentos'), est.meta.segmentos.map((s) => h('option', { value: s, selected: f.segmento === s }, s)));
  const orgao = h('input', { type: 'text', value: f.orgao || '', placeholder: 'Órgão', id: 'j-org' });
  // Município: digita ou escolhe na lista (sugestões da UF escolhida, como estão gravadas no PNCP)
  const listaMun = h('datalist', { id: 'j-mun-lista' });
  const municipio = h('input', { type: 'text', value: f.municipio || '', placeholder: 'Município', id: 'j-mun', list: 'j-mun-lista', autocomplete: 'off' });
  const carregarMunicipios = async () => {
    try { const r = await api(`/jornal/municipios${qs({ uf: uf.value })}`); render(listaMun, ...r.municipios.map((m) => h('option', { value: m }))); } catch { /* sugestões são opcionais */ }
  };
  uf.addEventListener('change', () => { municipio.value = ''; carregarMunicipios(); });
  carregarMunicipios();
  const abertas = h('input', { type: 'checkbox', checked: f.abertas === '1' });
  const filtros = () => (f.perfil ? { perfil: f.perfil, edicao: f.edicao }
    : { q: q.value, tipo: tipo.value, uf: uf.value, segmento: seg.value, orgao: orgao.value, municipio: municipio.value.trim(), abertas: abertas.checked ? '1' : '' });
  const ir = (pagina = 1) => { location.hash = `#/jornal${qs({ ...filtros(), pagina })}`; };
  const sel = lerSelecao();
  const contador = h('strong', {});
  const foraDaPagina = h('button', { class: 'btn pequeno', type: 'button', style: { display: 'none' }, onclick: () => verSelecionadas(), title: 'A seleção continua ao trocar de página ou de filtro' });
  const caixas = [];
  const atualizar = () => {
    contador.textContent = `${sel.size} selecionada(s)`;
    for (const c of caixas) c.checked = sel.has(Number(c.dataset.id));
    const nestaPagina = new Set(caixas.map((c) => Number(c.dataset.id)).filter((id) => sel.has(id))).size; // a mesma licitação pode ter 2 eventos na página
    const fora = sel.size - nestaPagina;
    foraDaPagina.style.display = fora > 0 ? '' : 'none';
    foraDaPagina.textContent = `⚠ ${fora} de outras páginas ou filtros · ver`;
    gravarSelecao(sel);
  };
  // Lista tudo o que vai no jornal, inclusive o que foi marcado em outra página ou outro filtro, com opção de tirar
  const verSelecionadas = async () => {
    if (!sel.size) return toast('Nenhuma licitação marcada.');
    let r;
    try { r = await api(`/jornal/selecao${qs({ ids: [...sel].join(',') })}`); } catch (e) { return toast(e.message, 6000); }
    const porId = new Map(r.dados.map((l) => [l.id, l]));
    const corpo = h('div', { class: 'lista-selecao', style: { maxHeight: '55vh', overflow: 'auto' } });
    const desenhar = () => render(corpo, sel.size ? [...sel].map((id) => {
      const l = porId.get(id);
      return h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--borda)', padding: '6px 0' } },
        h('div', { style: { flex: '1' } }, h('div', {}, l ? (l.objeto || '').slice(0, 140) : `Licitação nº ${id} (não encontrada)`),
          l ? h('div', { class: 'suave pequeno' }, [l.orgao_nome, [l.municipio, l.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')) : null),
        h('button', { class: 'btn pequeno perigo', type: 'button', onclick: () => { sel.delete(id); atualizar(); desenhar(); } }, 'Tirar'));
    }) : vazio('Nenhuma licitação marcada.'));
    desenhar();
    modal('Licitações marcadas para o jornal', h('div', {}, h('p', { class: 'pequeno suave' }, 'É exatamente isto que vai no PDF e no e-mail.'), corpo),
      [{ texto: 'Desmarcar todas', classe: 'perigo', acao: () => { sel.clear(); atualizar(); } }]);
  };
  const lista = h('div', {}, carregando());
  const enviados = h('div', {});
  const empresa = est.clientes.find((c) => String(c.id) === clienteSelecionado()) || null;

  const montar = async () => {
    if (!sel.size) { toast('Marque pelo menos uma licitação.'); return null; }
    return api('/jornal/envios', { metodo: 'POST', corpo: { ids: [...sel], perfil: f.perfil || null } });
  };
  const imprimir = async () => {
    const janela = window.open('', '_blank');
    if (!janela) return toast('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.', 7000);
    try { const d = await montar(); if (!d) return janela.close(); imprimirJornal(janela, d); carregarEnviados(); }
    catch (e) { janela.close(); toast(e.message, 6000); }
  };
  const baixar = async () => {
    try { const d = await montar(); if (!d) return; location.href = `/api/jornal/envios/${d.envio.id}.pdf`; toast('Gerando o PDF…'); carregarEnviados(); }
    catch (e) { toast(e.message, 6000); }
  };
  const enviarEmail = async () => {
    let d;
    try { d = await montar(); if (!d) return; } catch (e) { return toast(e.message, 6000); }
    carregarEnviados();
    const para = h('input', { type: 'email', value: d.cliente?.resp_email || d.cliente?.email || '', placeholder: 'email@empresa.com.br', style: { width: '100%' } });
    modal('Enviar jornal por e-mail', h('div', {},
      h('p', {}, `${d.itens.length} licitação(ões). O e-mail leva o PDF e o link em que o empresário marca as que tem interesse; a resposta chega para você por e-mail e no sino (🔔), e as marcadas entram no Kanban da empresa.`),
      h('ol', { class: 'pequeno', style: { maxHeight: '180px', overflow: 'auto', paddingLeft: '20px' } },
        ...d.itens.map((l) => h('li', {}, `${(l.objeto || '').slice(0, 110)} · ${[l.municipio, l.uf].filter(Boolean).join('/')}`))),
      h('label', {}, `E-mail do representante legal${d.cliente?.resp_nome ? ` (${d.cliente.resp_nome})` : ''}`), para,
      !d.cliente ? h('p', { class: 'pequeno texto-alerta' }, 'Nenhuma empresa escolhida no topo: o jornal sai sem o cabeçalho da empresa.') : null,
      h('p', { class: 'pequeno suave', style: { wordBreak: 'break-all' } }, 'Link para copiar e mandar por WhatsApp: ', h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.url))),
    [{ texto: 'Enviar', classe: 'primario', acao: async () => {
      try { const r = await api(`/jornal/envios/${d.envio.id}/email`, { metodo: 'POST', corpo: { para: para.value.trim() } }); toast(`O provedor de e-mail aceitou o envio para ${r.para}. A seleção foi limpa para o próximo jornal.`, 8000); sel.clear(); atualizar(); carregarEnviados(); return true; }
      catch (e) { toast(e.message, 10000); carregarEnviados(); return false; }
    } }]);
  };
  const marcarPagina = (sim) => { for (const c of caixas) { const id = Number(c.dataset.id); if (sim) sel.add(id); else sel.delete(id); } atualizar(); };
  const marcarTodos = async () => {
    try {
      const r = await api(`/jornal/ids${qs(filtros())}`);
      r.ids.forEach((id) => sel.add(id)); atualizar();
      if (r.cortado) toast(`Marcadas as ${r.limite} mais recentes (limite por jornal).`, 6000);
    } catch (e) { toast(e.message, 6000); }
  };

  const barra = h('div', { class: 'cartao barra-jornal' },
    h('div', { class: 'linha' }, contador, foraDaPagina,
      h('button', { class: 'btn pequeno', type: 'button', onclick: () => marcarPagina(true) }, '☑ Marcar esta página'),
      h('button', { class: 'btn pequeno', type: 'button', onclick: marcarTodos, title: 'Todas as licitações do filtro atual (até 60)' }, '☑ Marcar todos os resultados'),
      h('button', { class: 'btn pequeno', type: 'button', onclick: () => { sel.clear(); atualizar(); } }, 'Limpar')),
    h('div', { class: 'linha' },
      h('span', { class: 'pequeno suave' }, empresa ? `Cabeçalho: ${empresa.nome_fantasia || empresa.razao_social}` : 'Escolha a empresa no topo para sair o cabeçalho com os dados dela'),
      h('button', { class: 'btn', type: 'button', onclick: imprimir }, '🖨 Imprimir'),
      h('button', { class: 'btn', type: 'button', onclick: baixar }, '⬇ Baixar PDF'),
      h('button', { class: 'btn primario', type: 'button', onclick: enviarEmail }, '✉ Enviar por e-mail')));

  const topo = f.perfil ? await cabecalhoPerfil(f, est) : [
    h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, 'Jornal de licitações'),
      h('div', { class: 'suave' }, 'Seus jornais salvos trazem as oportunidades novas todo dia. Abaixo, tudo o que foi publicado ou mudou nas sincronizações.'))),
    await meusJornais(est),
    h('h2', { style: { margin: '18px 0 8px' } }, 'Tudo o que mudou nas sincronizações'),
    h('form', { class: 'cartao filtros', onsubmit: (e) => { e.preventDefault(); ir(); } }, q, tipo, uf, municipio, listaMun, seg, orgao,
      h('label', { class: 'pequeno', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, abertas, 'Só com propostas abertas'),
      h('button', { class: 'btn primario' }, 'Filtrar'))];
  render(alvo, topo,
    barra,
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, lista),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Jornais enviados e respostas'), enviados));
  atualizar();
  carregarEnviados();

  async function carregarEnviados() {
    try {
      const r = await api('/jornal/envios');
      if (!r.envios.length) return render(enviados, vazio('Nenhum jornal montado ainda.'));
      const marcados = new Set();
      const caixasEnv = [];
      const btnExcluir = h('button', { class: 'btn', disabled: true, onclick: excluir }, 'Excluir marcados');
      const atualizarEnv = () => { for (const c of caixasEnv) c.checked = marcados.has(Number(c.dataset.id)); btnExcluir.disabled = !marcados.size; btnExcluir.textContent = marcados.size ? `Excluir marcados (${marcados.size})` : 'Excluir marcados'; };
      const semInteresse = (e) => !e.interesses?.length;
      async function excluir() {
        modal('Excluir envios', h('p', {}, `Excluir ${marcados.size} envio(s)? O link desses jornais para de funcionar para o cliente. Interesses já recebidos continuam no Kanban.`),
          [{ texto: 'Excluir', classe: 'perigo', acao: async () => {
            try { const x = await api('/jornal/envios/excluir', { metodo: 'POST', corpo: { ids: [...marcados] } }); toast(`${x.excluidos} envio(s) excluído(s).`); carregarEnviados(); return true; }
            catch (e) { toast(e.message, 6000); return false; }
          } }]);
      }
      render(enviados,
        h('div', { class: 'linha', style: { marginBottom: '8px' } },
          h('button', { class: 'btn', title: 'Marca os que o cliente não respondeu e os que voltaram sem nenhuma licitação marcada', onclick: () => { r.envios.filter(semInteresse).forEach((e) => marcados.add(e.id)); atualizarEnv(); } }, 'Marcar os sem interesse'),
          h('button', { class: 'btn', onclick: () => { marcados.clear(); atualizarEnv(); } }, 'Limpar marcação'), btnExcluir),
        h('div', { class: 'tabela-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['', 'Montado em', 'Empresa', 'Licitações', 'E-mail', 'Abriu o link', 'Resposta'].map((t) => h('th', {}, t)))),
        h('tbody', {}, r.envios.map((e) => {
          const cx = h('input', { type: 'checkbox', 'aria-label': 'Marcar envio', onchange: () => { if (cx.checked) marcados.add(e.id); else marcados.delete(e.id); atualizarEnv(); } });
          cx.dataset.id = e.id; caixasEnv.push(cx);
          return h('tr', {}, h('td', {}, cx),
          h('td', {}, dataUtc(e.criado_em)), h('td', {}, e.cliente || '—'), h('td', { class: 'num' }, e.licitacoes),
          h('td', {}, e.email_status === 'enviado' ? `enviado para ${e.email_para}` : e.email_status === 'erro' ? h('span', { class: 'texto-alerta' }, `não enviado para ${e.email_para}: ${e.email_erro || 'erro desconhecido'}`) : e.email_status === 'sem_smtp' ? 'e-mail não configurado' : '—'),
          h('td', {}, e.ultimo_acesso ? dataUtc(e.ultimo_acesso) : 'ainda não'),
          h('td', {}, e.respondido_em
            ? h('div', {},
              h('span', { class: e.interesses?.length ? 'texto-sucesso' : '' }, `${e.respondente}: ${e.interesses?.length ? `interesse em ${e.interesses.length}` : 'nenhuma marcada'}`),
              e.interesses?.length ? h('ol', { class: 'pequeno', style: { margin: '4px 0 0', paddingLeft: '18px' } },
                ...e.interesses.map((l) => h('li', {}, h('a', { href: `#/licitacao/${l.id}` }, (l.objeto || 'Licitação').slice(0, 120)), l.local ? h('span', { class: 'suave' }, ` · ${l.local}`) : null))) : null,
              e.observacao ? h('div', { class: 'pequeno' }, `Obs.: "${e.observacao}"`) : null)
            : 'aguardando'));
        })))),
      r.envios.some((e) => e.interesses?.length) ? h('p', { class: 'pequeno suave' }, 'As licitações marcadas pelo cliente entram no ', h('a', { href: '#/kanban' }, 'Kanban'), ' da empresa, na primeira etapa.') : null);
    } catch (e) { render(enviados, vazio(e.message)); }
  }

  const r = await api(`/jornal${qs(f)}`);
  if (!r.total) return render(lista, vazio(f.perfil ? (r.edicao === 'todas' ? 'Nenhuma licitação aberta bate com este jornal agora. Tente ampliar o perfil (mais cidades, outro valor, mais palavras).' : 'Nenhuma oportunidade nova nesta edição.') : 'Nenhum evento registrado com esses filtros.'));
  render(lista, ...r.dados.map((e) => {
    const cx = h('input', { type: 'checkbox', class: 'marca-jornal', 'aria-label': 'Incluir no jornal', onchange: () => { if (cx.checked) sel.add(e.licitacao_id); else sel.delete(e.licitacao_id); atualizar(); } });
    cx.dataset.id = e.licitacao_id; caixas.push(cx);
    // Mesmo cartão de "Buscar licitações", com a marcação para o jornal em cima e, antes do rodapé, o "Entrou por"
    // (jornal salvo) ou o que mudou (jornal geral)
    const extra = f.perfil
      ? h('div', { class: 'motivo-jornal motivo-cartao pequeno' },
        h('b', {}, 'Entrou por: '), e.motivos?.length ? e.motivos.join(' · ') : 'filtros de local, modalidade e valor',
        h('span', { class: 'suave' }, ' · Itens e edital: '),
        e.detalhes_sincronizados_em ? `${e.qtd_itens} item(ns), ${e.qtd_documentos} arquivo(s)` : h('span', { title: 'O sistema baixa do PNCP aos poucos; ao abrir a licitação ele busca na hora' }, 'ainda não baixados do PNCP'))
      : h('div', { class: 'motivo-jornal motivo-cartao pequeno' },
        h('b', {}, `${TIPOS_EVENTO[e.tipo] || e.tipo}: `), e.descricao || 'sem descrição',
        e.valor_anterior != null && !String(e.descricao || '').includes(String(e.valor_novo)) ? h('span', {}, ` · De: ${e.valor_anterior} → Para: ${e.valor_novo}`) : null);
    return h('div', { class: 'jornal-cartao' },
      h('label', { class: 'marca-cartao pequeno' }, cx, ' Incluir no jornal',
        h('span', { class: 'etiqueta azul' }, TIPOS_EVENTO[e.tipo] || e.tipo),
        h('span', { class: 'suave', title: f.perfil ? 'Quando entrou no sistema' : 'Quando o sistema registrou o evento' }, `${f.perfil ? 'Entrou no sistema' : 'Registrado'} em ${dataUtc(e.detectado_em)}`)),
      linhaLicitacao(e, est, { aoKanban: est.usuario.papel !== 'leitor' ? (x) => enviarAoKanban(x, est) : null, rotuloItens: 'Itens com as palavras do jornal', extra }));
  }),
  paginacao(r.pagina, r.paginas, ir));
  atualizar();
}

/** Soma só os valores informados (sigiloso e não informado ficam de fora e são contados à parte). */
export function resumoJornal(itens) {
  const abertas = itens.filter((l) => !l.faltam || l.faltam.urgencia !== 'encerrada');
  const comValor = abertas.filter((l) => l.valor_estimado != null && !['sigiloso', 'nao_informado'].includes(l.valor_estimado_situacao));
  return {
    total: itens.length, abertas: abertas.length, soma: comValor.reduce((s, l) => s + Number(l.valor_estimado), 0), comValor: comValor.length,
    gratuitas: itens.filter((l) => l.sistema?.custo === 'gratuito').length,
    meEpp: itens.filter((l) => l.me_epp_exclusivo).length,
    // Os itens vêm agrupados por cidade: a próxima a encerrar é a de menor prazo entre as abertas
    proxima: abertas.filter((l) => l.faltam).sort((x, y) => String(x.data_encerramento_proposta).localeCompare(String(y.data_encerramento_proposta)))[0] || null,
  };
}

const ROT_URGENCIA = { alta: 'Urgente', media: 'Esta semana', baixa: 'No prazo', encerrada: 'Encerrada' };

/** Página A4 para imprimir ou salvar em PDF pelo navegador: capa com a empresa, resumo e cards com "Tenho interesse". */
export function imprimirJornal(janela, d) {
  const c = d.cliente; const a = d.assessoria; const r = resumoJornal(d.itens);
  const nomeCli = c ? (c.nome_fantasia || c.razao_social) : null;
  const linkLic = (l) => `${d.url}#lic-${l.id}`;
  const cab = c ? `<div class="empresa"><b>${esc(c.razao_social)}</b>${[c.cnpj ? `CNPJ ${cnpjFmt(c.cnpj)}` : null, [c.municipio, c.uf].filter(Boolean).join('/') || null,
    c.resp_nome ? `A/C ${c.resp_nome}${c.resp_cargo ? ` (${c.resp_cargo})` : ''}` : null].filter(Boolean).map((x) => ` · ${esc(x)}`).join('')}</div>` : '';
  const cards = d.itens.map((l) => {
    const f = l.faltam; const urg = f?.urgencia || 'sem';
    const tags = [
      `<span class="tag p-${esc(l.sistema.custo)}">${l.sistema.custo === 'gratuito' ? '✓ Participação gratuita' : l.sistema.custo === 'pago' ? 'Sistema cobra taxa' : 'Taxa do sistema: verificar'}</span>`,
      l.me_epp_exclusivo ? '<span class="tag me">★ Exclusiva ME/EPP</span>' : '',
      `<span class="tag">${esc(l.sistema.nome)}</span>`,
    ].join('');
    return `<article class="card u-${urg}">
<div class="faixa"><span class="mod">${esc(l.modalidade_nome || 'Licitação')}${l.numero_texto ? ` nº ${esc(l.numero_texto)}` : ''}</span><span class="loc">${esc([l.municipio, l.uf].filter(Boolean).join('/'))}</span>
<span class="prazo">${!f ? 'Prazo não informado' : urg === 'encerrada' ? 'Prazo encerrado' : `⏰ ${esc(f.texto)} · ${esc(ROT_URGENCIA[urg])}`}</span></div>
<div class="corpo"><div class="esq"><h3><a href="${esc(linkLic(l))}">${esc(l.objeto || '(objeto não informado)')}</a></h3>
<div class="org">${esc(l.orgao_nome || 'Órgão não informado')}</div><div class="tags">${tags}</div></div>
<div class="dir"><span class="rot">Valor estimado</span><span class="valor">${esc(l.valor_texto)}</span><span class="rot">Propostas até</span><span class="data">${esc(l.prazo_texto)}</span></div></div>
<div class="acoes"><a class="cta" href="${esc(linkLic(l))}">✋ Tenho interesse</a><a href="${esc(linkLic(l))}">Ver resumo do edital</a>${l.link_pncp ? `<a href="${esc(l.link_pncp)}">Edital completo no PNCP</a>` : ''}</div></article>`;
  }).join('');
  const kpis = [
    [String(r.total), r.total === 1 ? 'oportunidade selecionada' : 'oportunidades selecionadas'],
    [r.comValor ? BRL.format(r.soma) : '—', `em valor estimado${r.abertas < r.total ? ' das que seguem abertas' : ''}${r.comValor < r.abertas ? ` (${r.comValor} de ${r.abertas} informam valor)` : ''}`],
    [r.proxima ? r.proxima.faltam.texto.replace(/^Faltam? /, '') : '—', r.proxima ? `para a próxima encerrar (${esc(r.proxima.prazo_texto)})` : 'nenhuma com prazo em aberto'],
    [String(r.gratuitas), r.gratuitas === 1 ? 'com participação gratuita' : 'com participação gratuita'],
  ].map(([n, t]) => `<div class="kpi"><b>${esc(n)}</b><span>${t}</span></div>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Jornal de licitações${nomeCli ? ` · ${esc(nomeCli)}` : ''}</title>
<style>
@page { size: A4 portrait; margin: 12mm 11mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root { --azul: #0f3d6e; --azul2: #1f5fa3; --claro: #eef4fb; --linha: #d7e0ea; --tinta: #14212e; --suave: #5b6876; --verde: #13795b; --ambar: #9a5b00; --vermelho: #b42318; }
body { font: 10pt/1.45 "Segoe UI", Arial, Helvetica, sans-serif; color: var(--tinta); margin: 0; background: #fff; }
a { color: var(--azul2); }
.barra { position: sticky; top: 0; z-index: 2; background: var(--azul); color: #fff; padding: 8px 14px; display: flex; gap: 12px; align-items: center; }
.barra button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; cursor: pointer; }
.pagina { max-width: 188mm; margin: 0 auto; padding: 12px 0; }
.capa { background: linear-gradient(135deg, var(--azul), var(--azul2)); color: #fff; border-radius: 10px; padding: 14px 18px; display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; }
.capa .sobre { font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; opacity: .85; }
.capa h1 { margin: 2px 0 0; font-size: 20pt; line-height: 1.15; } .capa .para { font-size: 11pt; margin-top: 2px; }
.capa .edicao { text-align: right; font-size: 8.5pt; opacity: .9; white-space: nowrap; }
.empresa { font-size: 8.5pt; color: var(--suave); margin: 6px 2px 10px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
.kpi { border: 1px solid var(--linha); border-radius: 8px; padding: 8px 10px; background: var(--claro); }
.kpi b { display: block; font-size: 14pt; color: var(--azul); line-height: 1.2; } .kpi span { font-size: 8pt; color: var(--suave); }
.como { display: flex; gap: 14px; align-items: center; border: 1px dashed var(--azul2); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 9pt; }
.como ol { margin: 0; padding-left: 18px; flex: 1; } .como .btn { background: var(--azul); color: #fff; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-weight: 700; white-space: nowrap; }
.card { border: 1px solid var(--linha); border-left: 5px solid var(--azul2); border-radius: 8px; margin-bottom: 9px; page-break-inside: avoid; overflow: hidden; }
.u-alta { border-left-color: var(--vermelho); } .u-media { border-left-color: var(--ambar); } .u-baixa { border-left-color: var(--verde); } .u-encerrada, .u-sem { border-left-color: #98a2b3; }
.faixa { display: flex; gap: 10px; align-items: center; background: #f6f8fb; padding: 4px 10px; font-size: 8.5pt; color: var(--suave); }
.faixa .mod { font-weight: 700; color: var(--azul); } .faixa .prazo { margin-left: auto; font-weight: 700; }
.u-alta .prazo { color: var(--vermelho); } .u-media .prazo { color: var(--ambar); } .u-baixa .prazo { color: var(--verde); }
.corpo { display: flex; gap: 12px; padding: 7px 10px 4px; }
.esq { flex: 1; min-width: 0; }
h3 { margin: 0; font-size: 10.5pt; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
h3 a { color: var(--tinta); text-decoration: none; }
.org { font-size: 8.5pt; color: var(--suave); margin: 2px 0 5px; }
.tags { display: flex; flex-wrap: wrap; gap: 5px; } .tag { font-size: 7.8pt; border: 1px solid var(--linha); border-radius: 999px; padding: 1px 8px; color: var(--suave); }
.tag.p-gratuito { color: var(--verde); border-color: #a6d9c6; background: #ecf8f3; font-weight: 700; } .tag.p-pago { color: var(--ambar); border-color: #f0cf9c; background: #fdf6ea; }
.tag.me { color: #5b3ea8; border-color: #cbbcf0; background: #f4f0fd; font-weight: 700; }
.dir { width: 44mm; flex: none; text-align: right; display: flex; flex-direction: column; }
.dir .rot { font-size: 7.5pt; color: var(--suave); text-transform: uppercase; letter-spacing: .04em; } .dir .valor { font-size: 13pt; font-weight: 800; color: var(--azul); margin-bottom: 3px; } .dir .data { font-weight: 700; }
.acoes { display: flex; gap: 14px; align-items: center; padding: 4px 10px 8px; font-size: 8.8pt; }
.acoes .cta { background: var(--azul); color: #fff; text-decoration: none; padding: 4px 12px; border-radius: 999px; font-weight: 700; }
.rodape { margin-top: 12px; display: flex; justify-content: space-between; gap: 16px; border-top: 2px solid var(--azul); padding-top: 8px; font-size: 8.5pt; }
.rodape .aviso { color: var(--suave); font-size: 7.5pt; max-width: 60%; }
@media print { .barra { display: none; } .pagina { padding: 0; } }
</style></head><body>
<div class="barra"><button id="btn-imprimir">🖨 Imprimir / salvar em PDF</button><span>Os links continuam clicáveis no PDF salvo pelo navegador.</span></div>
<div class="pagina">
<header class="capa"><div><div class="sobre">Jornal de licitações</div><h1>Oportunidades para vender ao governo</h1>${nomeCli ? `<div class="para">Selecionadas para <b>${esc(nomeCli)}</b></div>` : ''}</div>
<div class="edicao">Edição de ${new Date().toLocaleDateString('pt-BR')}<br>${esc(a.nome || '')}</div></header>
${cab}
<section class="kpis">${kpis}</section>
<section class="como"><ol><li>Leia os cards: valor, prazo e se a participação é gratuita.</li><li>Clique em <b>Tenho interesse</b> nas que combinam com a sua empresa.</li><li>A assessoria cuida do resto: documentos, proposta e disputa.</li></ol>
<a class="btn" href="${esc(d.url)}">Responder agora →</a></section>
${cards}
<footer class="rodape"><div><b>${esc([a.responsavel, a.nome].filter(Boolean).join(' · '))}</b>${a.email ? `<br>${esc(a.email)}` : ''}</div>
<div class="aviso">Dados públicos do PNCP, organizados por cidade e, dentro de cada cidade, do prazo mais curto para o mais longo. Confira sempre o edital: datas, valores e o sistema da disputa podem mudar por retificação. "Participação gratuita" quer dizer que o sistema eletrônico não cobra taxa do fornecedor.</div></footer>
</div></body></html>`;
  janela.document.open(); janela.document.write(html); janela.document.close();
  // A política de segurança do site bloqueia script dentro da página impressa: o botão é ligado daqui
  janela.document.getElementById('btn-imprimir').addEventListener('click', () => { janela.focus(); janela.print(); });
}

// ============================ JORNAIS SALVOS (perfis com edição diária) ============================
const dataCurta = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

async function meusJornais(est) {
  let r;
  try { r = await api('/jornal/perfis'); } catch (e) { return h('div', { class: 'aviso vermelho' }, e.message); }
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  return h('div', { class: 'cartao' },
    h('div', { class: 'linha', style: { justifyContent: 'space-between' } }, h('h2', { style: { margin: 0 } }, '📰 Meus jornais'),
      h('button', { class: 'btn primario', onclick: () => formPerfil(est, r, null) }, '+ Criar jornal')),
    r.perfis.length ? h('div', { class: 'perfis-jornal' }, r.perfis.map((p) => h('div', { class: `perfil-jornal${p.ativo ? '' : ' inativo'}` },
      h('div', { class: 'linha', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', {}, h('strong', {}, p.nome), p.cliente_nome ? h('span', { class: 'etiqueta empresa', style: { marginLeft: '6px' } }, `🏢 ${p.cliente_nome}`) : null,
          p.ativo ? null : h('span', { class: 'etiqueta', style: { marginLeft: '6px' } }, 'pausado')),
        h('span', { class: `etiqueta ${p.hoje_total ? 'verde' : ''}` }, p.ultima_edicao === hoje ? `${p.hoje_total ?? 0} hoje` : p.ultima_edicao ? `última: ${dataCurta(p.ultima_edicao)}` : 'sem edição')),
      h('div', { class: 'suave pequeno', style: { margin: '4px 0 8px' } }, p.resumo),
      h('div', { class: 'linha' },
        h('a', { class: 'btn pequeno primario', href: `#/jornal?perfil=${p.id}` }, 'Abrir'),
        h('button', { class: 'btn pequeno', onclick: () => formPerfil(est, r, p) }, 'Editar'),
        h('button', { class: 'btn pequeno', title: 'Cria outro jornal com os mesmos filtros, para ajustar a outro segmento', onclick: () => formPerfil(est, r, null, p) }, '⧉ Duplicar'),
        h('button', { class: 'btn pequeno perigo', onclick: () => modal('Excluir jornal', h('p', {}, `Excluir o jornal "${p.nome}" e as edições dele? Os jornais já enviados aos clientes continuam valendo.`),
          [{ texto: 'Excluir', classe: 'perigo', acao: async () => { try { await api(`/jornal/perfis/${p.id}`, { metodo: 'DELETE' }); toast('Jornal excluído.'); window.dispatchEvent(new HashChangeEvent('hashchange')); return true; } catch (e) { toast(e.message, 6000); return false; } } }]) }, 'Excluir')))))
      : vazio('Nenhum jornal salvo. Crie um com o perfil do cliente (estado, cidades, nicho, produtos…) e ele traz as oportunidades novas todo dia às 7h.'),
    h('p', { class: 'suave pequeno' }, 'Cada empresa pode ter quantos jornais quiser, um por segmento (ex.: "UNIBOX · alimentos", "UNIBOX · limpeza"). Use ⧉ Duplicar para aproveitar os filtros de um jornal pronto.'),
    h('p', { class: 'suave pequeno', style: { marginBottom: 0 } }, 'Todo dia a partir das 7h cada jornal ganha a edição com as licitações que entraram no sistema e batem com o perfil. O aviso chega no sino (🔔) e no e-mail de alertas.'));
}

// Recorte com licitações ainda sem itens: produto que só aparece no item (carne dentro de "gêneros alimentícios") fica de fora até chegar
const avisoItens = (it) => (it?.sem_itens ? h('div', { class: 'aviso amarelo pequeno', style: { flexBasis: '100%' } },
  `${it.sem_itens} de ${it.abertas} licitação(ões) abertas no estado/cidades deste jornal ainda estão sem os itens baixados do PNCP. `,
  'Produto citado só nos itens aparece quando eles chegarem (o sistema baixa primeiro as dos estados dos jornais, e a edição seguinte inclui as que passarem a bater).') : null);

async function cabecalhoPerfil(f, est) {
  let p; let ops;
  try { [p, ops] = await Promise.all([api(`/jornal/perfis/${f.perfil}`), api('/jornal/perfis')]); }
  catch (e) { return [h('div', { class: 'aviso vermelho' }, e.message), h('a', { href: '#/jornal' }, '← Voltar aos jornais')]; }
  const atual = f.edicao || p.edicoes[0]?.data || 'todas';
  const edicao = h('select', { 'aria-label': 'Edição', style: { width: 'auto' }, onchange: (e) => { location.hash = `#/jornal${qs({ perfil: p.id, edicao: e.target.value })}`; } },
    p.edicoes.map((e) => h('option', { value: e.data, selected: atual === e.data }, `Edição de ${dataCurta(e.data)} · ${e.total} oportunidade(s)`)),
    h('option', { value: 'todas', selected: atual === 'todas' }, 'Todas as abertas agora'));
  return [
    h('div', { class: 'cabecalho-pagina' },
      h('div', {}, h('a', { href: '#/jornal', class: 'pequeno' }, '← Jornal de licitações'), h('h1', {}, `📰 ${p.nome}`), h('div', { class: 'suave' }, p.resumo)),
      h('div', { class: 'linha' },
        ops.perfis.length > 1 ? h('select', { 'aria-label': 'Trocar de jornal', style: { width: 'auto' }, onchange: (e) => { location.hash = `#/jornal${qs({ perfil: e.target.value })}`; } },
          ops.perfis.map((x) => h('option', { value: x.id, selected: x.id === p.id }, `${x.nome}${x.cliente_nome ? ` · ${x.cliente_nome}` : ''}`))) : null,
        h('button', { class: 'btn', onclick: () => formPerfil(est, ops, p) }, 'Editar jornal'),
        h('button', { class: 'btn', title: 'Cria outro jornal com os mesmos filtros, para ajustar a outro segmento', onclick: () => formPerfil(est, ops, null, p) }, '⧉ Duplicar'),
        h('button', { class: 'btn primario', onclick: () => formPerfil(est, ops, null) }, '+ Novo jornal'))),
    h('div', { class: 'cartao linha', style: { flexWrap: 'wrap' } }, h('strong', {}, 'Mostrar:'), edicao,
      avisoItens(p.itens),
      h('span', { class: 'suave pequeno' }, atual === 'todas' ? 'Todas as licitações abertas que batem com o jornal, ordenadas pelo encerramento.' : 'Edição do dia: só as que entraram no sistema desde a edição anterior (a primeira traz todas as abertas).')),
  ];
}

// Atalhos de região (cidades com o nome oficial do IBGE). Grande Vitória como o Guido usa no dia a dia;
// a Região Metropolitana oficial também inclui Viana e Fundão, que ficam a um clique.
const REGIOES = {
  ES: [{ nome: 'Grande Vitória', cidades: ['Vila Velha', 'Vitória', 'Cariacica', 'Serra', 'Guarapari'] }],
};
const semAcentoJ = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Escolha de cidades: lista oficial dos estados marcados, com busca, marcar várias, atalhos de região e "todas".
function seletorCidades(iniciais) {
  const marcadas = new Map(iniciais.map((c) => [semAcentoJ(c), c])); // chave sem acento -> nome exibido
  let porUf = {};
  const busca = h('input', { type: 'search', placeholder: 'Procurar cidade…', style: { maxWidth: '260px' } });
  const contador = h('strong', { class: 'pequeno' });
  const atalhos = h('div', { class: 'linha', style: { flexWrap: 'wrap', gap: '6px' } });
  const lista = h('div', { class: 'lista-cidades' });
  const fora = h('div', { class: 'pequeno suave' });
  const atualizarContador = () => {
    contador.textContent = marcadas.size ? `${marcadas.size} cidade(s) marcada(s)` : 'Nenhuma marcada = todas as cidades dos estados marcados';
    const oficiais = new Set(Object.values(porUf).flat().map(semAcentoJ));
    const extras = [...marcadas.entries()].filter(([k]) => !oficiais.has(k)).map(([, v]) => v);
    fora.textContent = extras.length ? `Também marcadas (fora dos estados acima ou digitadas antes): ${extras.join(', ')}` : '';
  };
  const desenhar = () => {
    const q = semAcentoJ(busca.value);
    const ufs = Object.keys(porUf);
    render(lista, ...(ufs.length ? ufs.map((uf) => {
      const nomes = porUf[uf].filter((c) => !q || semAcentoJ(c).includes(q));
      return h('div', { class: 'grupo-cidades' }, ufs.length > 1 ? h('div', { class: 'pequeno', style: { fontWeight: 600, margin: '4px 0' } }, uf) : null,
        h('div', { class: 'grade-cidades' }, nomes.map((c) => h('label', { class: 'opcao-check' },
          h('input', { type: 'checkbox', checked: marcadas.has(semAcentoJ(c)), onchange: (e) => { if (e.target.checked) marcadas.set(semAcentoJ(c), c); else marcadas.delete(semAcentoJ(c)); atualizarContador(); } }), c))),
        nomes.length ? null : h('div', { class: 'pequeno suave' }, 'Nenhuma cidade com esse nome.'));
    }) : [h('div', { class: 'pequeno suave' }, 'Marque o estado acima para escolher as cidades.')]));
    atualizarContador();
  };
  const marcarVarias = (nomes, sim = true) => { for (const c of nomes) { if (sim) marcadas.set(semAcentoJ(c), c); else marcadas.delete(semAcentoJ(c)); } desenhar(); };
  busca.addEventListener('input', desenhar);
  const carregar = async (ufs) => {
    try { porUf = ufs.length ? (await api(`/jornal/municipios${qs({ uf: ufs.join(',') })}`)).por_uf : {}; } catch { porUf = {}; }
    render(atalhos,
      ...ufs.flatMap((uf) => (REGIOES[uf] || []).map((r) => h('button', { class: 'btn pequeno', type: 'button', title: r.cidades.join(', '), onclick: () => marcarVarias(r.cidades) }, `+ ${r.nome}`))),
      ufs.includes('ES') ? h('button', { class: 'btn pequeno', type: 'button', title: 'Completa a Região Metropolitana oficial', onclick: () => marcarVarias(['Viana', 'Fundão']) }, '+ Viana e Fundão') : null,
      ufs.length ? h('button', { class: 'btn pequeno', type: 'button', onclick: () => { const q = semAcentoJ(busca.value); marcarVarias(Object.values(porUf).flat().filter((c) => !q || semAcentoJ(c).includes(q))); } }, '☑ Marcar todas da lista') : null,
      h('button', { class: 'btn pequeno', type: 'button', onclick: () => { marcadas.clear(); desenhar(); } }, 'Limpar'));
    desenhar();
  };
  const el = h('div', { class: 'seletor-cidades' }, h('div', { class: 'linha', style: { flexWrap: 'wrap', gap: '8px' } }, busca, contador), atalhos, lista, fora);
  return { el, carregar, valores: () => [...marcadas.values()] };
}

const UFS_BR = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

// p = jornal sendo editado; modelo = jornal copiado ao duplicar (cria um novo com os mesmos filtros)
function formPerfil(est, ops, p, modelo = null) {
  const base = p || modelo;
  const fx = base?.filtros || { ufs: [], cidades: [], segmentos: [], produtos: '', itens: '', modalidades: [], sistemas: [], fases: Object.keys(ops.fases), encerramento: { modo: 'qualquer' } };
  const caixa = (nome, valor, rotulo, marcado) => h('label', { class: 'opcao-check' }, h('input', { type: 'checkbox', name: nome, value: valor, checked: !!marcado }), rotulo);
  const marcados = (form, nome) => [...form.querySelectorAll(`input[name="${nome}"]:checked`)].map((x) => x.value);
  const campo = (rot, el, ajuda) => h('div', { class: 'campo' }, h('label', {}, rot), el, ajuda ? h('div', { class: 'suave pequeno' }, ajuda) : null);
  const nome = h('input', { value: p?.nome || (modelo ? `${modelo.nome} (cópia)` : ''), placeholder: 'Ex.: INFOPEL · papelaria e informática ES' });
  const cliente = h('select', {}, h('option', { value: '' }, 'Nenhuma (jornal geral)'), est.clientes.map((c) => h('option', { value: c.id, selected: (base ? base.cliente_id : Number(clienteSelecionado()) || null) === c.id }, c.nome_fantasia || c.razao_social)));
  const cidades = seletorCidades(fx.cidades);
  const produtos = h('textarea', { rows: 2, placeholder: 'Ex.: papel A4; toner; material de escritório' }, fx.produtos || '');
  const itens = h('textarea', { rows: 2, placeholder: 'Ex.: notebook; cartucho hp 664' }, fx.itens || '');
  const excluir = h('input', { value: fx.excluir || '', placeholder: 'Ex.: software; mobiliário; seguro' });
  const vmin = h('input', { type: 'number', min: 0, step: '0.01', value: fx.valor_min ?? '', placeholder: 'Mínimo (R$)' });
  const vmax = h('input', { type: 'number', min: 0, step: '0.01', value: fx.valor_max ?? '', placeholder: 'Máximo (R$)' });
  const enc = fx.encerramento || { modo: 'qualquer' };
  const radio = (v, rot) => h('label', { class: 'opcao-check' }, h('input', { type: 'radio', name: 'enc', value: v, checked: (enc.modo || 'qualquer') === v }), rot);
  const encData = h('input', { type: 'date', value: enc.data || '' });
  const encHora = h('input', { type: 'time', value: enc.hora || '' });
  const previa = h('div', { class: 'aviso azul pequeno' }, 'Clique em "Ver quantas batem" para conferir antes de salvar.');
  // Obra (e serviço especial de engenharia) não pode ir a pregão (Lei 14.133, art. 29, parágrafo único): sai quase toda em concorrência
  const dicaObras = h('div', { class: 'texto-alerta pequeno', hidden: true },
    'Obras saem quase sempre em Concorrência (a Lei 14.133, art. 29, não permite pregão para obras). Marque Concorrência para não perder a maior parte delas.');
  const avisoObras = () => {
    const segs = marcados(form, 'seg'); const mods = marcados(form, 'mod');
    dicaObras.hidden = !(segs.some((x) => /obra|engenharia/i.test(x)) && mods.length && !mods.includes('concorrencia'));
  };
  const form = h('form', { class: 'form-perfil', onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'grade duas' }, campo('Nome do jornal', nome), campo('Para qual empresa', cliente, 'Opcional. Sai com o cabeçalho dela ao enviar.')),
    campo('Estado(s)', h('div', { class: 'grade-ufs', onchange: () => cidades.carregar(marcados(form, 'uf')) }, UFS_BR.map((u) => caixa('uf', u, u, fx.ufs.includes(u))))),
    campo('Cidade(s)', cidades.el, 'Lista oficial do IBGE dos estados marcados. Marque quantas quiser; nenhuma = o estado inteiro.'),
    h('div', { class: 'aviso pequeno' }, h('b', {}, 'O que procurar: '), 'nicho, produtos e itens se somam. Basta a licitação bater com UM deles para entrar no jornal.'),
    campo('Nicho', h('div', { class: 'grade-checks', onchange: () => avisoObras() }, est.meta.segmentos.map((sg) => caixa('seg', sg, sg, fx.segmentos.includes(sg)))), 'Segmento estimado pelo objeto. Marque nenhum para não filtrar.'),
    h('div', { class: 'grade duas' },
      campo('Produto(s) / palavras do objeto', produtos, 'Qualquer um da lista (separe por ;). Busca no objeto e nos itens. Plural e masculino/feminino não importam.'),
      campo('Itens', itens, 'Palavra sozinha precisa abrir a descrição do item; expressão de várias palavras vale em qualquer ponto do item (separe por ;).')),
    campo('Excluir palavras', excluir, 'Licitação com qualquer destas palavras no objeto fica fora do jornal (separe por ;).'),
    campo('Modalidade', h('div', {}, h('div', { class: 'linha', onchange: () => avisoObras() }, Object.entries(ops.modalidades).map(([k, v]) => caixa('mod', k, v, fx.modalidades.includes(k)))), dicaObras), 'Nenhuma marcada = todas.'),
    campo('Valor do edital', h('div', { class: 'linha' }, vmin, vmax), 'Licitação sem valor informado ou sigilosa fica de fora quando há limite de valor.'),
    campo('Portais (sistema da disputa)', h('div', { class: 'grade-checks' }, Object.entries(est.meta.sistemas || {}).map(([k, v]) => caixa('sis', k, v.nome, fx.sistemas.includes(k)))), 'Nenhum marcado = todos.'),
    campo('Fase', h('div', { class: 'linha' }, Object.entries(ops.fases).map(([k, v]) => caixa('fase', k, v, fx.fases.includes(k))))),
    campo('Encerramento das propostas', h('div', {},
      h('div', { class: 'linha' }, radio('qualquer', 'Qualquer data'), radio('ate', 'Até a data'), radio('dia', 'Só no dia')),
      h('div', { class: 'linha' }, encData, h('span', { class: 'suave pequeno' }, 'até às'), encHora)),
    'Ex.: "Só no dia" 20/10 até 10:00 traz as que encerram em 20/10 até as 10h. Hora vazia = o dia inteiro.'),
    previa);
  const corpo = () => ({
    nome: nome.value, cliente_id: cliente.value || null,
    filtros: {
      ufs: marcados(form, 'uf'), cidades: cidades.valores(), segmentos: marcados(form, 'seg'),
      produtos: produtos.value, itens: itens.value, excluir: excluir.value, modalidades: marcados(form, 'mod'), valor_min: vmin.value, valor_max: vmax.value,
      sistemas: marcados(form, 'sis'), fases: marcados(form, 'fase'),
      encerramento: { modo: form.querySelector('input[name="enc"]:checked')?.value || 'qualquer', data: encData.value, hora: encHora.value },
    },
  });
  cidades.carregar(fx.ufs);
  avisoObras();
  modal(p ? `Editar jornal · ${p.nome}` : modelo ? `Duplicar jornal · ${modelo.nome}` : 'Criar jornal', form, [
    { texto: 'Ver quantas batem', acao: async () => {
      try {
        const x = await api('/jornal/perfis/previa', { metodo: 'POST', corpo: corpo() });
        const zerou = (x.funil || []).find((e) => e.total === 0);
        render(previa,
          h('div', {}, h('b', {}, `${x.total} licitação(ões) aberta(s) batem com este perfil agora.`)),
          x.funil?.length ? h('div', { class: 'funil-perfil' }, 'Filtro a filtro: ', x.funil.map((e, i) => h('span', { class: e.total === 0 ? 'texto-alerta' : '' }, `${i ? ' → ' : ''}${e.etapa}: ${e.total}`))) : null,
          zerou ? h('div', { class: 'texto-alerta' }, `O filtro "${zerou.etapa}" zerou o resultado. Revise esse campo.`) : null,
          avisoItens(x.itens));
      }
      catch (e) { render(previa, h('span', { class: 'texto-alerta' }, e.message)); }
      return false;
    } },
    { texto: p ? 'Salvar' : 'Criar jornal', classe: 'primario', acao: async () => {
      try {
        const x = await api(p ? `/jornal/perfis/${p.id}` : '/jornal/perfis', { metodo: p ? 'PUT' : 'POST', corpo: corpo() });
        toast(x.edicao ? `Jornal salvo. Edição de hoje: ${x.edicao.total} oportunidade(s).` : 'Jornal salvo.', 6000);
        const alvoHash = `#/jornal?perfil=${x.id}`;
        if (location.hash === alvoHash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = alvoHash;
        return true;
      } catch (e) { render(previa, h('span', { class: 'texto-alerta' }, e.message)); toast(e.message, 6000); return false; }
    } }]);
}
