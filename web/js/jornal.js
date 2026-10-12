// Jornal de licitações: feed do que mudou nas sincronizações + montagem do jornal para o cliente
// (marcar cards, imprimir com o cabeçalho da empresa, PDF clicável e e-mail ao representante legal com o
// link em que ele marca as licitações de interesse; a resposta volta como alerta e favorito).
import { api, qs, clienteSelecionado } from './api.js';
import { h, render, toast, carregando, vazio, dataUtc, modal, paginacao } from './ui.js';

const TIPOS_EVENTO = { publicacao: 'Nova publicação', alteracao: 'Alteração/retificação', situacao: 'Mudança de situação', documento: 'Novo documento', resultado: 'Resultado/homologação', item: 'Item' };
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
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
  const abertas = h('input', { type: 'checkbox', checked: f.abertas === '1' });
  const filtros = () => ({ q: q.value, tipo: tipo.value, uf: uf.value, segmento: seg.value, orgao: orgao.value, abertas: abertas.checked ? '1' : '' });
  const ir = (pagina = 1) => { location.hash = `#/jornal${qs({ ...filtros(), pagina })}`; };
  const sel = lerSelecao();
  const contador = h('strong', {});
  const foraDaPagina = h('button', { class: 'btn pequeno', type: 'button', hidden: true, onclick: () => verSelecionadas(), title: 'A seleção continua ao trocar de página ou de filtro' });
  const caixas = [];
  const atualizar = () => {
    contador.textContent = `${sel.size} selecionada(s)`;
    for (const c of caixas) c.checked = sel.has(Number(c.dataset.id));
    const nestaPagina = new Set(caixas.map((c) => Number(c.dataset.id)).filter((id) => sel.has(id))).size; // a mesma licitação pode ter 2 eventos na página
    const fora = sel.size - nestaPagina;
    foraDaPagina.hidden = fora <= 0;
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
    return api('/jornal/envios', { metodo: 'POST', corpo: { ids: [...sel] } });
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
      h('p', {}, `${d.itens.length} licitação(ões). O e-mail leva o PDF e o link em que o empresário marca as que tem interesse; a resposta chega para você no sino (🔔) e nos Favoritos, lista "Interesse do cliente".`),
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

  render(alvo, h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, 'Jornal de licitações'),
      h('div', { class: 'suave' }, 'O que foi publicado ou mudou nas sincronizações. Marque os cards para imprimir, baixar em PDF ou enviar ao cliente.'))),
    h('form', { class: 'cartao filtros', onsubmit: (e) => { e.preventDefault(); ir(); } }, q, tipo, uf, seg, orgao,
      h('label', { class: 'pequeno', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, abertas, 'Só com propostas abertas'),
      h('button', { class: 'btn primario' }, 'Filtrar')),
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
        modal('Excluir envios', h('p', {}, `Excluir ${marcados.size} envio(s)? O link desses jornais para de funcionar para o cliente. Interesses já recebidos continuam em Favoritos.`),
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
            ? h('span', { class: e.interesses?.length ? 'texto-sucesso' : '' }, `${e.respondente}: ${e.interesses?.length ? `interesse em ${e.interesses.length}` : 'nenhuma marcada'}${e.observacao ? ` · "${e.observacao}"` : ''}`)
            : 'aguardando'));
        })))),
      r.envios.some((e) => e.interesses?.length) ? h('p', { class: 'pequeno suave' }, 'As licitações marcadas pelo cliente estão em ', h('a', { href: '#/favoritos' }, 'Favoritos'), ', lista "Interesse do cliente".') : null);
    } catch (e) { render(enviados, vazio(e.message)); }
  }

  const r = await api(`/jornal${qs(f)}`);
  if (!r.total) return render(lista, vazio('Nenhum evento registrado com esses filtros.'));
  render(lista, ...r.dados.map((e) => {
    const cx = h('input', { type: 'checkbox', class: 'marca-jornal', 'aria-label': 'Incluir no jornal', onchange: () => { if (cx.checked) sel.add(e.licitacao_id); else sel.delete(e.licitacao_id); atualizar(); } });
    cx.dataset.id = e.licitacao_id; caixas.push(cx);
    const s = e.sistema;
    return h('div', { class: 'evento evento-jornal' },
      h('div', { class: 'quando' }, cx, h('div', {}, dataUtc(e.detectado_em))),
      h('div', {}, h('span', { class: 'etiqueta azul' }, TIPOS_EVENTO[e.tipo] || e.tipo), ' ',
        h('a', { href: `#/licitacao/${e.licitacao_id}` }, (e.objeto || '').slice(0, 180)),
        h('div', { class: 'suave pequeno' }, `${e.descricao} · ${e.orgao_nome || ''} · ${[e.municipio, e.uf].filter(Boolean).join('/')}`),
        h('div', { class: 'dados-jornal' },
          h('span', {}, h('span', { class: 'rot' }, 'Valor do edital '), h('strong', {}, valorTexto(e))),
          h('span', {}, h('span', { class: 'rot' }, 'Propostas até '), h('strong', {}, dataBr(e.data_encerramento_proposta) || 'Não informado')),
          h('span', {}, h('span', { class: 'rot' }, 'Sistema '), h('strong', {}, s.nome)),
          h('span', { class: `etiqueta participacao-${s.custo}`, title: s.resumo }, `Participação: ${s.participacao}`)),
        e.valor_anterior != null ? h('div', { class: 'suave pequeno' }, `De: ${e.valor_anterior} → Para: ${e.valor_novo}`) : null));
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
    proxima: abertas.find((l) => l.faltam) || null, // itens já vêm do prazo mais curto para o mais longo
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
<div class="aviso">Dados públicos do PNCP, organizados do prazo mais curto para o mais longo. Confira sempre o edital: datas, valores e o sistema da disputa podem mudar por retificação. "Participação gratuita" quer dizer que o sistema eletrônico não cobra taxa do fornecedor.</div></footer>
</div></body></html>`;
  janela.document.open(); janela.document.write(html); janela.document.close();
  // A política de segurança do site bloqueia script dentro da página impressa: o botão é ligado daqui
  janela.document.getElementById('btn-imprimir').addEventListener('click', () => { janela.focus(); janela.print(); });
}
