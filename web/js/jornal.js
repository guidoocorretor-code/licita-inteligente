// Jornal de licitações: feed do que mudou nas sincronizações + montagem do jornal para o cliente
// (marcar cards, imprimir com o cabeçalho da empresa, PDF clicável e e-mail ao representante legal com o
// link em que ele marca as licitações de interesse; a resposta volta como alerta e favorito).
import { api, qs, clienteSelecionado } from './api.js';
import { h, render, toast, carregando, vazio, dataUtc, modal } from './ui.js';

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
  const caixas = [];
  const atualizar = () => {
    contador.textContent = `${sel.size} selecionada(s)`;
    for (const c of caixas) c.checked = sel.has(Number(c.dataset.id));
    gravarSelecao(sel);
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
      h('label', {}, `E-mail do representante legal${d.cliente?.resp_nome ? ` (${d.cliente.resp_nome})` : ''}`), para,
      !d.cliente ? h('p', { class: 'pequeno texto-alerta' }, 'Nenhuma empresa escolhida no topo: o jornal sai sem o cabeçalho da empresa.') : null,
      h('p', { class: 'pequeno suave', style: { wordBreak: 'break-all' } }, 'Link para copiar e mandar por WhatsApp: ', h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.url))),
    [{ texto: 'Enviar', classe: 'primario', acao: async () => {
      try { const r = await api(`/jornal/envios/${d.envio.id}/email`, { metodo: 'POST', corpo: { para: para.value.trim() } }); toast(`O provedor de e-mail aceitou o envio para ${r.para}. Se não chegar em alguns minutos, peça para olhar o spam.`, 8000); carregarEnviados(); return true; }
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
    h('div', { class: 'linha' }, contador,
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
      render(enviados, h('div', { class: 'tabela-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Montado em', 'Empresa', 'Licitações', 'E-mail', 'Abriu o link', 'Resposta'].map((t) => h('th', {}, t)))),
        h('tbody', {}, r.envios.map((e) => h('tr', {},
          h('td', {}, dataUtc(e.criado_em)), h('td', {}, e.cliente || '—'), h('td', { class: 'num' }, e.licitacoes),
          h('td', {}, e.email_status === 'enviado' ? `enviado para ${e.email_para}` : e.email_status === 'erro' ? h('span', { class: 'texto-alerta' }, `não enviado para ${e.email_para}: ${e.email_erro || 'erro desconhecido'}`) : e.email_status === 'sem_smtp' ? 'e-mail não configurado' : '—'),
          h('td', {}, e.ultimo_acesso ? dataUtc(e.ultimo_acesso) : 'ainda não'),
          h('td', {}, e.respondido_em
            ? h('span', { class: e.interesses?.length ? 'texto-sucesso' : '' }, `${e.respondente}: ${e.interesses?.length ? `interesse em ${e.interesses.length}` : 'nenhuma marcada'}${e.observacao ? ` · "${e.observacao}"` : ''}`)
            : 'aguardando')))))),
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
  h('div', { class: 'paginacao' },
    h('button', { class: 'btn', disabled: r.pagina <= 1, onclick: () => ir(r.pagina - 1) }, '← Anterior'),
    h('span', { class: 'suave' }, `Página ${r.pagina} de ${r.paginas}`),
    h('button', { class: 'btn', disabled: r.pagina >= r.paginas, onclick: () => ir(r.pagina + 1) }, 'Próxima →')));
  atualizar();
}

/** Página A4 para imprimir ou salvar em PDF pelo navegador: cabeçalho da empresa e cards com links. */
export function imprimirJornal(janela, d) {
  const c = d.cliente; const a = d.assessoria;
  const cab = c ? `<div class="empresa"><div class="rs">${esc(c.razao_social)}${c.nome_fantasia && c.nome_fantasia !== c.razao_social ? ` <small>(${esc(c.nome_fantasia)})</small>` : ''}</div>
<div>${[c.cnpj ? `CNPJ ${cnpjFmt(c.cnpj)}` : null, c.endereco, [c.municipio, c.uf].filter(Boolean).join('/') || null, c.cep ? `CEP ${c.cep}` : null].filter(Boolean).map(esc).join(' · ')}</div>
<div>${[c.resp_nome ? `Representante legal: ${c.resp_nome}${c.resp_cargo ? ` (${c.resp_cargo})` : ''}` : null, c.resp_email || c.email, c.telefone].filter(Boolean).map(esc).join(' · ')}</div></div>` : '';
  const cards = d.itens.map((l, k) => `<div class="card">
<div class="tit"><a href="${esc(`${d.url}#lic-${l.id}`)}">${k + 1}. ${esc(l.objeto || '(objeto não informado)')}</a></div>
<div class="org">${esc([l.modalidade_nome, l.numero_texto ? `nº ${l.numero_texto}` : null].filter(Boolean).join(' '))} · ${esc(l.orgao_nome || '')} · ${esc([l.municipio, l.uf].filter(Boolean).join('/'))}</div>
<div class="grade"><div><span>Valor do edital</span><b>${esc(l.valor_texto)}</b></div><div><span>Propostas até</span><b>${esc(l.prazo_texto)}</b></div>
<div><span>Sistema</span><b>${esc(l.sistema.nome)}</b></div><div><span>Participação</span><b class="p-${l.sistema.custo}">${esc(l.sistema.participacao)}</b></div></div>
<div class="links"><a href="${esc(`${d.url}#lic-${l.id}`)}">Ver resumo e marcar interesse</a>${l.link_pncp ? ` · <a href="${esc(l.link_pncp)}">Baixar o edital no PNCP</a>` : ''}</div></div>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Jornal de licitações${c ? ` · ${esc(c.nome_fantasia || c.razao_social)}` : ''}</title>
<style>
@page { size: A4 portrait; margin: 14mm 12mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font: 10pt/1.4 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
.barra { position: sticky; top: 0; background: #0f3d6e; color: #fff; padding: 8px 14px; display: flex; gap: 12px; align-items: center; }
.barra button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; cursor: pointer; }
.pagina { max-width: 186mm; margin: 0 auto; padding: 10px 0; }
.topo { border-bottom: 3px solid #0f3d6e; padding-bottom: 8px; margin-bottom: 10px; }
h1 { font-size: 18pt; margin: 0 0 4px; color: #0f3d6e; } .empresa { font-size: 9pt; color: #333; } .empresa .rs { font-size: 12pt; font-weight: 700; color: #111; }
.meta { font-size: 8.5pt; color: #666; margin-top: 4px; }
.chamada { background: #e8f0fb; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; font-size: 9.5pt; }
a { color: #0f3d6e; }
.card { border: 1px solid #c9d3e0; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; page-break-inside: avoid; }
.tit { font-weight: 700; font-size: 10.5pt; } .tit a { text-decoration: none; } .org { color: #555; font-size: 9pt; margin: 2px 0 6px; }
.grade { display: grid; grid-template-columns: 1fr 1fr 1.4fr 1.2fr; gap: 6px; } .grade div { background: #f3f5f8; border-radius: 4px; padding: 4px 6px; }
.grade span { display: block; font-size: 7.5pt; color: #666; text-transform: uppercase; } .grade b { font-size: 9.5pt; }
.p-gratuito { color: #157347; } .p-pago { color: #8a5300; } .p-nao_verificado { color: #555; }
.links { margin-top: 6px; font-size: 9pt; } .fonte { font-size: 7.5pt; color: #666; margin-top: 10px; }
@media print { .barra { display: none; } .pagina { padding: 0; } }
</style></head><body>
<div class="barra"><button id="btn-imprimir">🖨 Imprimir / salvar em PDF</button><span>Os links continuam clicáveis no PDF salvo pelo navegador.</span></div>
<div class="pagina"><div class="topo"><h1>Jornal de licitações</h1>${cab}
<div class="meta">Preparado por ${esc([a.nome, a.responsavel].filter(Boolean).join(' · '))}${a.email ? ` · ${esc(a.email)}` : ''} em ${new Date().toLocaleDateString('pt-BR')}</div></div>
<div class="chamada">${d.itens.length} licitação(ões) selecionada(s). Clique no título para ver o resumo e marcar as que têm interesse: <a href="${esc(d.url)}">${esc(d.url)}</a></div>
${cards}
<div class="fonte">Dados públicos do PNCP. Confira sempre o edital: datas, valores e o sistema da disputa podem mudar por retificação. "Participação" é a taxa cobrada do fornecedor pelo sistema eletrônico.</div>
</div></body></html>`;
  janela.document.open(); janela.document.write(html); janela.document.close();
  // A política de segurança do site bloqueia script dentro da página impressa: o botão é ligado daqui
  janela.document.getElementById('btn-imprimir').addEventListener('click', () => { janela.focus(); janela.print(); });
}
