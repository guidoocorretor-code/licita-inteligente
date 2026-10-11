// Fornecedores (Fase 3) e cotações por item da licitação, com custo, margem e preço mínimo de venda.
// Nada é enviado sozinho: o pedido de cotação é um texto que o usuário copia ou abre no WhatsApp/e-mail.
import { api, qs } from './api.js';
import { h, toast, carregando, vazio, confirmar, modal, render, data, dataUtc, naoInformado, moeda } from './ui.js';

const podeEditar = (e) => e.usuario.papel !== 'leitor';
const podeExcluir = (e) => ['gestor', 'admin', 'superadmin'].includes(e.usuario.papel);
const nomeF = (f) => f.nome_fantasia || f.razao_social;
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const fmtCnpj = (d) => (d && d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d || '');
const zap = (tel, texto) => {
  const n = soDigitos(tel).replace(/^55/, '');
  return n.length >= 10 ? `https://wa.me/55${n}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : null;
};
// Preço unitário pode ter centavos de centavo (ex.: R$ 0,0450 por folha)
const brl = (v) => (v == null ? naoInformado() : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v));
const pct = (v) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const num = (v) => (v == null ? '' : String(v).replace('.', ','));
// "1.234,56" -> "1234.56"; "12,5" -> "12.5"; "12.5" fica como está
const lerNum = (v) => {
  const t = String(v ?? '').trim();
  return t === '' ? '' : t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
};

function cabecalho(titulo, subtitulo, ...acoes) {
  return h('div', { class: 'cabecalho-pagina' },
    h('div', {}, h('h1', {}, titulo), subtitulo ? h('div', { class: 'suave' }, subtitulo) : null),
    h('div', { class: 'linha' }, ...acoes));
}

// ---------- Cadastro ----------
function formFornecedor(est, f = {}, fretes, aoSalvar) {
  const c = {};
  const inp = (nome, rot, attrs = {}, largo = false) => {
    c[nome] = h('input', { id: `f-${nome}`, value: f[nome] ?? '', ...attrs });
    return h('div', { class: largo ? 'largo' : '' }, h('label', { for: `f-${nome}` }, rot), c[nome]);
  };
  c.cliente_id = h('select', { id: 'f-cliente_id' }, h('option', { value: '0' }, 'Todas as empresas'),
    est.clientes.filter((x) => x.ativo || x.id === f.cliente_id).map((x) => h('option', { value: x.id, selected: x.id === f.cliente_id }, x.nome_fantasia || x.razao_social)));
  c.frete = h('select', { id: 'f-frete' }, h('option', { value: '' }, 'Não informado'), Object.entries(fretes).map(([k, v]) => h('option', { value: k, selected: f.frete === k }, v)));
  c.produtos = h('textarea', { id: 'f-produtos', rows: 2, placeholder: 'ex.: papel A4; toner; cartucho HP; notebook Dell' }, f.produtos || '');
  c.observacoes = h('textarea', { id: 'f-observacoes', rows: 2 }, f.observacoes || '');
  const status = h('div', {});
  let ultima = '';
  const consultar = async (forcar = false) => {
    const cnpj = soDigitos(c.cnpj.value);
    if (cnpj.length !== 14 || (!forcar && cnpj === ultima)) return;
    ultima = cnpj;
    status.className = 'aviso azul'; render(status, 'Consultando a base pública da Receita Federal...');
    try {
      const d = await api(`/cnpj/${cnpj}/consulta`);
      const por = (k, v) => { if (v && (forcar || !c[k].value.trim())) c[k].value = v; };
      por('razao_social', d.razao_social); por('nome_fantasia', d.nome_fantasia); por('uf', d.uf); por('municipio', d.municipio);
      por('email', d.email); por('telefone', d.telefone);
      const inativa = d.situacao && !/ATIVA/i.test(d.situacao);
      status.className = `aviso ${inativa ? 'vermelho' : 'verde'}`;
      render(status, h('strong', {}, inativa ? `Atenção: situação cadastral ${d.situacao}. ` : `Dados da Receita (situação: ${d.situacao || 'não informada'}). `),
        d.atividade ? `Atividade principal: ${d.atividade}. ` : '', h('span', { class: 'pequeno' }, `Fonte: ${d.fonte}. Confira antes de salvar.`));
    } catch (e) { status.className = 'aviso amarelo'; render(status, e.message); }
  };
  const conteudo = h('form', { class: 'form-empresa', onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'filtros' },
      h('div', { class: 'largo' }, h('label', { for: 'f-cnpj' }, 'CNPJ (opcional)'),
        h('div', { class: 'linha cnpj-linha' },
          c.cnpj = h('input', { id: 'f-cnpj', inputmode: 'numeric', placeholder: '00.000.000/0000-00', value: fmtCnpj(f.cnpj),
            oninput: (ev) => { if (!f.id && soDigitos(ev.target.value).length === 14) consultar(); } }),
          h('button', { type: 'button', class: 'btn pequeno', title: 'Buscar dados públicos da Receita Federal', onclick: () => consultar(true) }, '🔎 Receita'))),
      inp('razao_social', 'Nome / razão social *', { required: true }, true),
      inp('nome_fantasia', 'Nome fantasia'),
      h('div', {}, h('label', { for: 'f-cliente_id' }, 'Fornecedor de'), c.cliente_id),
      inp('uf', 'UF', { maxlength: 2, placeholder: 'ES' }),
      inp('municipio', 'Município')),
    status,
    h('h3', {}, 'Contato'),
    h('div', { class: 'filtros' },
      inp('contato_nome', 'Vendedor / contato'), inp('whatsapp', 'WhatsApp', { type: 'tel', placeholder: '(27) 99999-9999' }),
      inp('telefone', 'Telefone', { type: 'tel' }), inp('email', 'E-mail', { type: 'email' }), inp('site', 'Site', {}, true)),
    h('h3', {}, 'O que vende e condições'),
    h('div', { class: 'campo' }, h('label', { for: 'f-produtos' }, 'Produtos e marcas (separe com ;)'), c.produtos,
      h('div', { class: 'suave pequeno' }, 'Usado para sugerir este fornecedor nos itens das licitações que tiverem estas palavras.')),
    h('div', { class: 'filtros' },
      inp('prazo_entrega_dias', 'Prazo de entrega (dias)', { type: 'number', min: 0, step: 1 }),
      inp('pedido_minimo', 'Pedido mínimo (R$)', { inputmode: 'decimal', value: num(f.pedido_minimo) }),
      inp('condicoes_pagamento', 'Pagamento', { placeholder: 'ex.: 28 dias, boleto' }),
      h('div', {}, h('label', { for: 'f-frete' }, 'Frete'), c.frete)),
    h('div', { class: 'campo' }, h('label', { for: 'f-observacoes' }, 'Observações'), c.observacoes));
  modal(f.id ? `Editar ${nomeF(f)}` : 'Novo fornecedor', conteudo, [{ texto: 'Salvar', classe: 'primario', acao: async () => {
    const corpo = Object.fromEntries(Object.entries(c).map(([k, el]) => [k, el.value.trim()]));
    corpo.cnpj = soDigitos(corpo.cnpj); corpo.pedido_minimo = lerNum(corpo.pedido_minimo); corpo.cliente_id = Number(corpo.cliente_id);
    try {
      const r = f.id ? await api(`/fornecedores/${f.id}`, { metodo: 'PATCH', corpo }) : await api('/fornecedores', { metodo: 'POST', corpo });
      toast('Fornecedor salvo.'); aoSalvar?.(f.id || r.id);
    } catch (e) { toast(e.message, 5000); return false; }
  } }]);
}

// ---------- Página Fornecedores ----------
export async function fornecedores(alvo, rota, est) {
  render(alvo, carregando());
  const q = rota.query.get('q') || '';
  const d = await api(`/fornecedores${qs({ q })}`);
  const recarregar = () => fornecedores(alvo, rota, est);
  const busca = h('input', { type: 'search', value: q, placeholder: 'Nome, CNPJ ou produto (ex.: toner)' });
  const cartao = (f) => h('div', { class: `cartao fornecedor ${f.ativo ? '' : 'inativa'}` },
    h('div', { class: 'linha', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('div', {}, h('strong', { class: 'objeto' }, nomeF(f)),
        h('div', { class: 'suave pequeno' }, f.cnpj ? `CNPJ ${fmtCnpj(f.cnpj)}` : 'CNPJ não informado', [f.municipio, f.uf].filter(Boolean).length ? ` · ${[f.municipio, f.uf].filter(Boolean).join('/')}` : '', f.ativo ? '' : ' · desativado')),
      h('span', { class: 'etiqueta empresa' }, `🏢 ${f.cliente_nome || 'Todas as empresas'}`)),
    f.produtos ? h('div', { class: 'linha etiquetas-lic', style: { marginTop: '8px' } }, f.produtos.split(';').map((p) => h('span', { class: 'etiqueta' }, p.trim()))) : h('div', { class: 'suave pequeno', style: { marginTop: '6px' } }, 'Produtos não informados (preencha para receber sugestões nos itens).'),
    h('div', { class: 'pequeno', style: { marginTop: '8px' } },
      f.contato_nome ? `👤 ${f.contato_nome} ` : '', f.whatsapp || f.telefone ? `📞 ${f.whatsapp || f.telefone} ` : '', f.email ? `✉ ${f.email}` : ''),
    h('div', { class: 'suave pequeno' },
      `Entrega: ${f.prazo_entrega_dias != null ? `${f.prazo_entrega_dias} dia(s)` : 'não informada'} · Frete: ${f.frete || 'não informado'}`,
      f.pedido_minimo != null ? ` · Pedido mínimo: ${moeda(f.pedido_minimo)}` : '', f.condicoes_pagamento ? ` · Pagamento: ${f.condicoes_pagamento}` : ''),
    h('div', { class: 'suave pequeno' }, f.cotacoes ? `${f.cotacoes} cotação(ões) registrada(s) · última em ${dataUtc(f.ultima_cotacao)}` : 'Nenhuma cotação registrada ainda.'),
    h('div', { class: 'linha', style: { marginTop: '10px' } },
      zap(f.whatsapp) ? h('a', { class: 'btn pequeno', href: zap(f.whatsapp), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp ↗') : null,
      f.email ? h('a', { class: 'btn pequeno', href: `mailto:${f.email}` }, 'E-mail ↗') : null,
      f.site ? h('a', { class: 'btn pequeno', href: /^https?:\/\//.test(f.site) ? f.site : `https://${f.site}`, target: '_blank', rel: 'noopener noreferrer' }, 'Site ↗') : null,
      podeEditar(est) ? h('button', { class: 'btn pequeno', onclick: () => formFornecedor(est, f, d.fretes, recarregar) }, 'Editar') : null,
      podeEditar(est) ? h('button', { class: 'btn pequeno', onclick: async () => {
        try { await api(`/fornecedores/${f.id}`, { metodo: 'PATCH', corpo: { ativo: !f.ativo } }); recarregar(); } catch (e) { toast(e.message); }
      } }, f.ativo ? 'Desativar' : 'Reativar') : null,
      podeExcluir(est) && !f.cotacoes ? h('button', { class: 'btn pequeno perigo', onclick: async () => {
        if (!confirmar(`Excluir ${nomeF(f)}?`)) return;
        try { await api(`/fornecedores/${f.id}`, { metodo: 'DELETE' }); recarregar(); } catch (e) { toast(e.message, 5000); }
      } }, 'Excluir') : null));
  render(alvo,
    cabecalho('Fornecedores', 'De quem as empresas compram para revender ao governo. As cotações ficam em cada oportunidade do Kanban (botão 💲 Cotações).',
      podeEditar(est) ? h('button', { class: 'btn primario', onclick: () => formFornecedor(est, {}, d.fretes, recarregar) }, '+ Novo fornecedor') : null),
    h('form', { class: 'linha busca-fornecedores', style: { margin: '0 0 12px' }, onsubmit: (e) => { e.preventDefault(); location.hash = `#/fornecedores${qs({ q: busca.value.trim() })}`; } },
      busca, h('button', { class: 'btn', type: 'submit' }, 'Buscar')),
    d.fornecedores.length ? h('div', { class: 'grade-empresas' }, d.fornecedores.map(cartao))
      : vazio(q ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado. Clique em "+ Novo fornecedor" e informe os produtos que ele vende.'));
}

// ---------- Cotações de uma oportunidade ----------
const SITUACAO = {
  ok: ['Dentro do estimado', 'verde'], acima: ['Acima do estimado', 'vermelha'],
  sem_referencia: ['Sem valor de referência', ''], sem_cotacao: ['Sem cotação', 'amarela'],
};

function textoPedido(d, forn, numeros) {
  const op = d.oportunidade;
  const itens = d.itens.filter((i) => numeros.includes(i.numero_item));
  return [
    `Olá${forn.contato_nome ? `, ${forn.contato_nome}` : ''}! Tudo bem?`,
    `${op.cliente_nome ? `Aqui é da ${op.cliente_nome}. ` : ''}Estamos participando de uma licitação${op.orgao_nome ? ` do(a) ${op.orgao_nome}` : ''}${op.municipio ? ` (${op.municipio}/${op.uf})` : ''} e precisamos de cotação para os itens abaixo:`,
    '',
    ...itens.map((i) => `• Item ${i.numero_item}: ${i.descricao || '(sem descrição)'} — ${i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${i.unidade_medida || 'un.'}` : 'quantidade a confirmar'}`),
    '',
    'Por favor, informe para cada item: preço unitário, marca/modelo, prazo de entrega, validade da cotação e se o frete está incluso.',
    op.data_encerramento_proposta ? `As propostas vão até ${data(op.data_encerramento_proposta)}; se puder responder antes, agradecemos.` : '',
    'Obrigado!',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

function pedirCotacao(d, sugeridos) {
  const fs = d.fornecedores;
  if (!fs.length) return toast('Cadastre um fornecedor primeiro (menu Fornecedores).', 5000);
  const sel = h('select', {}, fs.map((f) => h('option', { value: f.id }, `${nomeF(f)}${f.combina.length ? ` · combina com ${f.combina.length} item(ns)` : ''}`)));
  const marcar = new Map();
  const lista = h('div', { class: 'lista-itens-pedido' });
  const texto = h('textarea', { rows: 12, readonly: true });
  const links = h('div', { class: 'linha' });
  const atualizar = () => {
    const f = fs.find((x) => String(x.id) === sel.value);
    const numeros = [...marcar].filter(([, cb]) => cb.checked).map(([n]) => n);
    texto.value = textoPedido(d, f, numeros);
    const w = zap(f.whatsapp || f.telefone, texto.value);
    render(links,
      h('button', { type: 'button', class: 'btn pequeno', onclick: async () => { try { await navigator.clipboard.writeText(texto.value); toast('Texto copiado.'); } catch { texto.select(); toast('Selecione e copie (Ctrl+C).'); } } }, '📋 Copiar texto'),
      w ? h('a', { class: 'btn pequeno', href: w, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no WhatsApp ↗') : h('span', { class: 'suave pequeno' }, 'Sem WhatsApp cadastrado.'),
      f.email ? h('a', { class: 'btn pequeno', href: `mailto:${f.email}?subject=${encodeURIComponent('Pedido de cotação')}&body=${encodeURIComponent(texto.value)}` }, 'Abrir e-mail ↗') : null);
  };
  const montarLista = () => {
    const f = fs.find((x) => String(x.id) === sel.value);
    marcar.clear();
    render(lista, d.itens.map((i) => {
      const cb = h('input', { type: 'checkbox', checked: sugeridos?.includes(i.numero_item) || (f.combina.length ? f.combina.includes(i.numero_item) : !i.usada_id), onchange: atualizar });
      marcar.set(i.numero_item, cb);
      return h('label', { class: 'item-pedido' }, cb, ` Item ${i.numero_item}: ${(i.descricao || '').slice(0, 90)}`);
    }));
    atualizar();
  };
  sel.addEventListener('change', montarLista);
  modal('Pedir cotação', h('div', {},
    h('div', { class: 'campo' }, h('label', {}, 'Fornecedor'), sel),
    h('div', { class: 'campo' }, h('label', {}, 'Itens'), lista),
    h('div', { class: 'campo' }, h('label', {}, 'Mensagem'), texto),
    links,
    h('p', { class: 'suave pequeno' }, 'O sistema não envia nada sozinho: você revisa e manda pelo seu WhatsApp ou e-mail. Quando o fornecedor responder, use "Registrar resposta".')), []);
  montarLista();
}

function registrarResposta(d, recarregar, fornecedorId) {
  const fs = d.fornecedores;
  if (!fs.length) return toast('Cadastre um fornecedor primeiro (menu Fornecedores).', 5000);
  const sel = h('select', {}, fs.map((f) => h('option', { value: f.id, selected: f.id === fornecedorId }, nomeF(f))));
  const prazo = h('input', { type: 'number', min: 0, step: 1, placeholder: 'dias' });
  const validade = h('input', { type: 'date' });
  const frete = h('select', {}, h('option', { value: '' }, 'Não informado'), h('option', { value: '1' }, 'Sim, incluso'), h('option', { value: '0' }, 'Não incluso'));
  const linhas = new Map();
  const corpoTabela = h('tbody', {});
  const montar = () => {
    const fid = Number(sel.value); const f = fs.find((x) => x.id === fid);
    const ja = d.itens.flatMap((i) => i.cotacoes).filter((c) => c.fornecedor_id === fid);
    const uma = ja[0];
    prazo.value = uma?.prazo_entrega_dias ?? f.prazo_entrega_dias ?? '';
    validade.value = uma?.validade || ''; frete.value = uma?.frete_incluso == null ? (f.frete === 'CIF' ? '1' : f.frete === 'FOB' ? '0' : '') : String(uma.frete_incluso);
    linhas.clear();
    render(corpoTabela, d.itens.map((i) => {
      const c = ja.find((x) => x.numero_item === i.numero_item);
      const preco = h('input', { inputmode: 'decimal', placeholder: '0,00', value: num(c?.preco_unitario), class: 'preco' });
      const marca = h('input', { value: c?.marca_modelo || '', placeholder: 'marca / modelo' });
      linhas.set(i.numero_item, { preco, marca, tinha: !!c });
      return h('tr', { class: f.combina.includes(i.numero_item) ? 'combina' : '' },
        h('td', {}, i.numero_item), h('td', { class: 'desc' }, (i.descricao || '').slice(0, 110)),
        h('td', { class: 'num' }, i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${i.unidade_medida || ''}` : '—'),
        h('td', { class: 'num' }, i.orcamento_sigiloso ? 'Sigiloso' : brl(i.valor_unitario_estimado)),
        h('td', {}, preco), h('td', {}, marca));
    }));
  };
  sel.addEventListener('change', montar);
  montar();
  modal('Registrar resposta do fornecedor', h('div', { class: 'modal-largo' },
    h('div', { class: 'filtros' },
      h('div', { class: 'largo' }, h('label', {}, 'Fornecedor'), sel),
      h('div', {}, h('label', {}, 'Prazo de entrega (dias)'), prazo),
      h('div', {}, h('label', {}, 'Validade da cotação'), validade),
      h('div', {}, h('label', {}, 'Frete incluso?'), frete)),
    h('p', { class: 'suave pequeno' }, 'Preencha o preço unitário só dos itens que o fornecedor cotou. Deixe em branco os que ele não cotou (apagar um preço remove a cotação daquele item).'),
    h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-cotacao' },
      h('thead', {}, h('tr', {}, ['Nº', 'Descrição', 'Qtd.', 'Estimado (unit.)', 'Preço unit. do fornecedor', 'Marca / modelo'].map((t) => h('th', {}, t)))),
      corpoTabela))), [{ texto: 'Salvar cotação', classe: 'primario', acao: async () => {
    const itens = [...linhas].filter(([, l]) => l.preco.value.trim() || l.tinha)
      .map(([n, l]) => ({ numero_item: n, preco_unitario: lerNum(l.preco.value), marca_modelo: l.marca.value.trim() }));
    if (!itens.length) { toast('Informe o preço de pelo menos um item.'); return false; }
    try {
      const r = await api(`/kanban/${d.oportunidade.id}/cotacoes`, { metodo: 'POST', corpo: { fornecedor_id: Number(sel.value), prazo_entrega_dias: prazo.value, validade: validade.value, frete_incluso: frete.value, itens } });
      toast(`${r.gravados} item(ns) cotado(s)${r.removidos ? `, ${r.removidos} removido(s)` : ''}.`); recarregar();
    } catch (e) { toast(e.message, 6000); return false; }
  } }]);
}

export async function cotacao(alvo, rota, est) {
  render(alvo, carregando());
  const id = rota.args[0];
  const d = await api(`/kanban/${id}/cotacoes`);
  const op = d.oportunidade; const r = d.resumo;
  const recarregar = () => cotacao(alvo, rota, est);
  const editar = podeEditar(est);

  const imp = h('input', { inputmode: 'decimal', value: num(d.parametros.impostos_pct), placeholder: 'ex.: 8', style: { width: '90px' } });
  const mar = h('input', { inputmode: 'decimal', value: num(d.parametros.margem_pct), placeholder: 'ex.: 15', style: { width: '90px' } });
  const parametros = h('div', { class: 'cartao' }, h('h2', {}, 'Como calcular o preço mínimo'),
    h('div', { class: 'linha', style: { alignItems: 'flex-end' } },
      h('div', { class: 'campo' }, h('label', {}, 'Impostos sobre a venda (%)'), imp),
      h('div', { class: 'campo' }, h('label', {}, 'Margem desejada (%)'), mar),
      editar ? h('button', { class: 'btn', onclick: async () => {
        try { await api(`/kanban/${id}/cotacoes/parametros`, { metodo: 'PATCH', corpo: { impostos_pct: lerNum(imp.value), margem_pct: lerNum(mar.value) } }); toast('Parâmetros salvos.'); recarregar(); }
        catch (e) { toast(e.message, 5000); }
      } }, 'Recalcular') : null),
    h('p', { class: 'suave pequeno' }, 'Preço mínimo = custo ÷ (1 − impostos − margem). Ex.: custo R$ 80, impostos 8% e margem 15% → 80 ÷ 0,77 = R$ 103,90. ',
      'Use a alíquota efetiva da empresa (Simples Nacional ou outro regime): confirme com o contador. Frete não incluso na cotação precisa entrar no custo.'),
    d.parametros.impostos_pct == null && d.parametros.margem_pct == null ? h('div', { class: 'aviso amarelo pequeno' }, 'Impostos e margem não informados: o "preço mínimo" abaixo é só o custo de compra.') : null);

  const total = (rot, val, dica) => h('div', { class: 'cartao kpi', title: dica || '' }, h('div', { class: 'rotulo' }, rot), h('div', { class: 'valor' }, val));
  const margemGeral = r.estimado_cotados && r.custo_cotados_com_ref != null ? ((r.estimado_cotados - r.custo_cotados_com_ref) / r.estimado_cotados) * 100 : null;
  const resumo = h('div', { class: 'grade kpis' },
    total('Itens cotados', `${r.cotados} de ${r.itens}`),
    total('Custo de compra', r.custo_total == null ? (r.cotados ? 's/ qtd.' : '—') : moeda(r.custo_total), 'Soma de preço × quantidade da cotação usada em cada item'),
    total('Preço mínimo total', r.preco_minimo_total == null ? '—' : moeda(r.preco_minimo_total), 'Com impostos e margem informados acima'),
    total('Estimado dos itens cotados', r.estimado_cotados == null ? '—' : moeda(r.estimado_cotados), `Valor de referência do órgão, só dos ${r.itens_com_ref} item(ns) cotados que têm valor`),
    total('Margem bruta sobre o estimado', margemGeral == null ? '—' : pct(margemGeral), 'Antes de impostos e frete: (estimado − custo) ÷ estimado'),
    total('Itens acima do estimado', String(r.acima), 'O preço mínimo passa do valor unitário estimado: risco de desclassificação ou prejuízo'));

  const linhaItem = (i) => {
    const [rot, cor] = SITUACAO[i.situacao];
    const detalhes = i.cotacoes.length ? h('details', { class: 'cotacoes-item' }, h('summary', {}, `${i.cotacoes.length} cotação(ões)`),
      h('ul', {}, i.cotacoes.map((c) => h('li', {},
        h('strong', {}, c.fornecedor_nome), ` · ${brl(c.preco_unitario)}`, c.marca_modelo ? ` · ${c.marca_modelo}` : '',
        c.prazo_entrega_dias != null ? ` · ${c.prazo_entrega_dias} dia(s)` : '', c.frete_incluso === 0 ? ' · frete não incluso' : c.frete_incluso === 1 ? ' · frete incluso' : '',
        c.validade ? h('span', { class: c.validade < new Date().toLocaleDateString('sv-SE') ? 'texto-perigo' : '' }, ` · válida até ${data(c.validade, false)}`) : '',
        c.id === i.usada_id ? h('span', { class: 'etiqueta verde pequena' }, c.escolhida ? 'escolhida' : 'mais barata') : null,
        editar && c.id !== i.usada_id ? h('button', { class: 'btn pequeno', onclick: async () => { await api(`/kanban/${id}/cotacoes/${c.id}/escolher`, { metodo: 'POST', corpo: {} }); recarregar(); } }, 'Usar esta') : null,
        editar ? h('button', { class: 'btn pequeno', title: 'Excluir cotação', onclick: async () => { if (confirmar('Excluir esta cotação?')) { await api(`/kanban/${id}/cotacoes/${c.id}`, { metodo: 'DELETE' }); recarregar(); } } }, '✕') : null)))) : null;
    return h('tr', {},
      h('td', {}, i.numero_item),
      h('td', { class: 'desc' }, i.descricao || '—', detalhes),
      h('td', { class: 'num' }, i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${i.unidade_medida || ''}` : naoInformado()),
      h('td', { class: 'num' }, i.orcamento_sigiloso ? 'Sigiloso' : brl(i.valor_unitario_estimado)),
      h('td', { class: 'num' }, i.custo_unitario == null ? '—' : brl(i.custo_unitario), i.usada_id ? h('div', { class: 'suave pequeno' }, i.cotacoes.find((c) => c.id === i.usada_id)?.fornecedor_nome) : null),
      h('td', { class: 'num' }, pct(i.margem_bruta_pct)),
      h('td', { class: 'num' }, i.preco_minimo == null ? '—' : brl(i.preco_minimo)),
      h('td', { class: 'num' }, i.preco_minimo_total == null ? '—' : moeda(i.preco_minimo_total)),
      h('td', {}, h('span', { class: `etiqueta ${cor}` }, rot)));
  };

  const semItens = !d.itens.length;
  render(alvo,
    h('button', { class: 'btn pequeno', onclick: () => history.back() }, '← Voltar'),
    cabecalho('Cotações', [op.cliente_nome ? `🏢 ${op.cliente_nome} · ` : '', (op.objeto || '').slice(0, 160)].join(''),
      h('a', { class: 'btn', href: `#/licitacao/${op.licitacao_id}` }, 'Abrir licitação'),
      editar && !semItens ? h('button', { class: 'btn', onclick: () => pedirCotacao(d) }, '✉ Pedir cotação') : null,
      editar && !semItens ? h('button', { class: 'btn primario', onclick: () => registrarResposta(d, recarregar) }, '+ Registrar resposta') : null),
    h('div', { class: 'suave pequeno', style: { marginBottom: '10px' } }, [op.orgao_nome, op.municipio && `${op.municipio}/${op.uf}`, op.data_encerramento_proposta && `propostas até ${data(op.data_encerramento_proposta)}`].filter(Boolean).join(' · ')),
    semItens ? h('div', { class: 'aviso amarelo' }, op.detalhes_sincronizados_em ? 'A fonte não informou itens para esta licitação. Sem itens não há como cotar por item.' : 'Os itens desta licitação ainda não foram baixados do PNCP. ',
      !op.detalhes_sincronizados_em && editar ? h('button', { class: 'btn pequeno', onclick: async (e) => { e.target.disabled = true; try { const x = await api(`/licitacoes/${op.licitacao_id}/atualizar`, { metodo: 'POST', corpo: {} }); toast(x.ok ? `${x.itens} itens baixados.` : x.mensagem, 5000); recarregar(); } catch (er) { toast(er.message, 6000); e.target.disabled = false; } } }, '↻ Baixar itens agora') : null) : null,
    !d.fornecedores.length ? h('div', { class: 'aviso azul' }, 'Nenhum fornecedor ativo cadastrado. ', h('a', { href: '#/fornecedores' }, 'Cadastre em Fornecedores'), ' e informe os produtos que ele vende para ver sugestões aqui.') : null,
    semItens ? null : resumo,
    semItens ? null : h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, `Itens (${d.itens.length})`),
      h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-cotacao' },
        h('thead', {}, h('tr', {}, ['Nº', 'Descrição', 'Qtd.', 'Estimado (unit.)', 'Custo (unit.)', 'Margem bruta', 'Preço mínimo (unit.)', 'Preço mínimo (total)', 'Situação'].map((t) => h('th', {}, t)))),
        h('tbody', {}, d.itens.map(linhaItem))))),
    semItens ? null : h('div', { style: { marginTop: '14px' } }, parametros),
    semItens || !d.fornecedores.some((f) => f.combina.length) ? null : h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Fornecedores que combinam com os itens'),
      h('ul', {}, d.fornecedores.filter((f) => f.combina.length).map((f) => h('li', {}, h('strong', {}, nomeF(f)), ` · itens ${f.combina.join(', ')}`,
        editar ? [' ', h('button', { class: 'btn pequeno', onclick: () => pedirCotacao({ ...d, fornecedores: [f, ...d.fornecedores.filter((x) => x !== f)] }, f.combina) }, 'Pedir cotação'),
          ' ', h('button', { class: 'btn pequeno', onclick: () => registrarResposta(d, recarregar, f.id) }, 'Registrar resposta')] : null)))),
    semItens || !editar || r.preco_minimo_total == null || r.cotados < r.itens ? null : h('div', { class: 'aviso azul', style: { marginTop: '14px' } },
      `Todos os itens cotados. Preço mínimo total: ${moeda(r.preco_minimo_total)}${op.valor_proposta != null ? ` (valor da proposta no card hoje: ${moeda(op.valor_proposta)})` : ''}. `,
      h('button', { class: 'btn pequeno', onclick: async () => {
        if (!confirmar(`Gravar ${moeda(r.preco_minimo_total)} como "Valor da proposta" no card do Kanban? Você pode mudar depois.`)) return;
        try { await api(`/kanban/${id}`, { metodo: 'PATCH', corpo: { valor_proposta: r.preco_minimo_total } }); toast('Valor da proposta gravado no card.'); recarregar(); } catch (e) { toast(e.message); }
      } }, 'Usar como valor da proposta')));
}
