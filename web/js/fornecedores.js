// Fornecedores (Fase 3) e cotações por item da licitação, com custo, margem e preço mínimo de venda.
// Nada é enviado sozinho: o pedido de cotação é um texto que o usuário copia ou abre no WhatsApp/e-mail.
import { api, qs } from './api.js';
import { REGIMES, ANEXOS_SIMPLES, PRESUMIDO, calcularTributos } from './tributos.js';
import { trechosSensiveis, destacarTrechos, removerTrechos } from './sigilo.js';
import { h, toast, carregando, vazio, confirmar, modal, render, data, dataUtc, naoInformado, moeda } from './ui.js';

const podeEditar = (e) => e.usuario.papel !== 'leitor';
const podeExcluir = (e) => ['gestor', 'admin', 'superadmin'].includes(e.usuario.papel);
const nomeF = (f) => f.nome_fantasia || f.razao_social;
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const fmtCnpj = (d) => (d && d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d || '');
export const zap = (tel, texto) => {
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
function formFornecedor(est, f = {}, meta, aoSalvar) {
  const { fretes } = meta;
  const c = {};
  const inp = (nome, rot, attrs = {}, largo = false) => {
    c[nome] = h('input', { id: `f-${nome}`, value: f[nome] ?? '', ...attrs });
    return h('div', { class: largo ? 'largo' : '' }, h('label', { for: `f-${nome}` }, rot), c[nome]);
  };
  c.cliente_id = h('select', { id: 'f-cliente_id' }, h('option', { value: '0' }, 'Todas as empresas'),
    est.clientes.filter((x) => x.ativo || x.id === f.cliente_id).map((x) => h('option', { value: x.id, selected: x.id === f.cliente_id }, x.nome_fantasia || x.razao_social)));
  c.frete = h('select', { id: 'f-frete' }, h('option', { value: '' }, 'Não informado'), Object.entries(fretes).map(([k, v]) => h('option', { value: k, selected: f.frete === k }, v)));
  // Pagamento: formas aceitas (marcar) e, no boleto, os dias das parcelas
  const formasAtuais = (f.formas_pagamento || '').split(',').filter(Boolean);
  const caixas = Object.entries(meta.formas).map(([k, rot]) => {
    const cb = h('input', { type: 'checkbox', value: k, checked: formasAtuais.includes(k), onchange: () => mostrarBoleto() });
    return { k, cb, el: h('label', { class: 'opcao-check' }, cb, ` ${rot}`) };
  });
  const prazoAtual = f.boleto_prazo || '';
  const personalizado = prazoAtual && !meta.prazos_boleto.includes(prazoAtual);
  const rotPrazo = (p) => (p === '0' ? 'À vista' : `${p} dias`);
  const selPrazo = h('select', { id: 'f-boleto_prazo', onchange: () => mostrarBoleto() }, h('option', { value: '' }, 'Não informado'),
    meta.prazos_boleto.map((p) => h('option', { value: p, selected: p === prazoAtual }, rotPrazo(p))),
    h('option', { value: 'outro', selected: !!personalizado }, 'Personalizar…'));
  const prazoOutro = h('input', { id: 'f-boleto_outro', placeholder: 'ex.: 28/56/84', value: personalizado ? prazoAtual : '', inputmode: 'numeric' });
  const blocoBoleto = h('div', { class: 'bloco-boleto' },
    h('label', { for: 'f-boleto_prazo' }, 'Prazo do boleto'), selPrazo, prazoOutro,
    h('div', { class: 'suave pequeno' }, 'Dias de cada parcela contados da entrega/nota. Ex.: 30/60 = duas parcelas, com 30 e 60 dias.'));
  // Cartão: em até quantas vezes e se tem juros
  const selParcelas = h('select', { id: 'f-cartao_parcelas' }, h('option', { value: '' }, 'Não informado'),
    Array.from({ length: 24 }, (_, i) => i + 1).filter((n) => n <= 12 || n % 6 === 0)
      .map((n) => h('option', { value: n, selected: f.cartao_parcelas === n }, n === 1 ? 'Só à vista' : `Até ${n}x`)));
  const selJuros = h('select', { id: 'f-cartao_juros' }, h('option', { value: '' }, 'Não informado'),
    h('option', { value: '0', selected: f.cartao_juros === 0 }, 'Sem juros'), h('option', { value: '1', selected: f.cartao_juros === 1 }, 'Com juros'));
  const blocoCartao = h('div', { class: 'bloco-boleto' },
    h('div', { class: 'filtros' },
      h('div', {}, h('label', { for: 'f-cartao_parcelas' }, 'Parcelas no cartão'), selParcelas),
      h('div', {}, h('label', { for: 'f-cartao_juros' }, 'Juros no parcelamento'), selJuros)));
  const mostrarBoleto = () => {
    blocoBoleto.style.display = caixas.find((x) => x.k === 'boleto').cb.checked ? '' : 'none';
    prazoOutro.style.display = selPrazo.value === 'outro' ? '' : 'none';
    blocoCartao.style.display = caixas.find((x) => x.k === 'cartao').cb.checked ? '' : 'none';
  };
  mostrarBoleto();
  const vendaOrdem = h('select', { id: 'f-venda_a_ordem' }, h('option', { value: '' }, 'Não informado'),
    h('option', { value: '1', selected: f.venda_a_ordem === 1 }, 'Sim, entrega direto no órgão'), h('option', { value: '0', selected: f.venda_a_ordem === 0 }, 'Não'));
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
      h('div', {}, h('label', { for: 'f-frete' }, 'Frete'), c.frete)),
    h('div', { class: 'campo' }, h('label', {}, 'Formas de pagamento aceitas'), h('div', { class: 'linha opcoes-pagamento' }, caixas.map((x) => x.el)),
      f.condicoes_pagamento ? h('div', { class: 'suave pequeno' }, `Anotado antes: "${f.condicoes_pagamento}". Marque as opções acima.`) : null),
    blocoBoleto, blocoCartao,
    h('div', { class: 'campo' }, h('label', { for: 'f-venda_a_ordem' }, 'Faz triangulação (venda à ordem)?'), vendaOrdem,
      h('div', { class: 'suave pequeno' }, 'O fornecedor fatura para a sua empresa e entrega a mercadoria direto no órgão, com nota de remessa "por conta e ordem". Evita frete e manuseio duplos. Confirme com o contador antes de usar.')),
    h('div', { class: 'campo' }, h('label', { for: 'f-observacoes' }, 'Observações'), c.observacoes));
  modal(f.id ? `Editar ${nomeF(f)}` : 'Novo fornecedor', conteudo, [{ texto: 'Salvar', classe: 'primario', acao: async () => {
    const corpo = Object.fromEntries(Object.entries(c).map(([k, el]) => [k, el.value.trim()]));
    corpo.cnpj = soDigitos(corpo.cnpj); corpo.pedido_minimo = lerNum(corpo.pedido_minimo); corpo.cliente_id = Number(corpo.cliente_id);
    corpo.formas_pagamento = caixas.filter((x) => x.cb.checked).map((x) => x.k);
    corpo.boleto_prazo = selPrazo.value === 'outro' ? prazoOutro.value.trim() : selPrazo.value;
    corpo.cartao_parcelas = selParcelas.value; corpo.cartao_juros = selJuros.value;
    corpo.venda_a_ordem = vendaOrdem.value;
    try {
      const r = f.id ? await api(`/fornecedores/${f.id}`, { metodo: 'PATCH', corpo }) : await api('/fornecedores', { metodo: 'POST', corpo });
      toast('Fornecedor salvo.'); aoSalvar?.(f.id || r.id);
    } catch (e) { toast(e.message, 5000); return false; }
  } }]);
}

const FORMAS = { boleto: 'Boleto', pix: 'Pix', ted: 'TED', cartao: 'Cartão' };
// "Cartão até 10x sem juros"
function textoCartao(f) {
  if (!f.cartao_parcelas) return f.cartao_juros === 0 ? 'Cartão sem juros' : f.cartao_juros === 1 ? 'Cartão com juros' : 'Cartão';
  if (f.cartao_parcelas === 1) return 'Cartão só à vista';
  return `Cartão até ${f.cartao_parcelas}x${f.cartao_juros === 0 ? ' sem juros' : f.cartao_juros === 1 ? ' com juros' : ''}`;
}
// "Boleto 30/60 dias, Pix" (ou o texto antigo, se as opções ainda não foram marcadas)
function textoPagamento(f, formas = FORMAS) {
  const l = (f.formas_pagamento || '').split(',').filter(Boolean).map((k) =>
    (k === 'boleto' && f.boleto_prazo ? `Boleto ${f.boleto_prazo === '0' ? 'à vista' : `${f.boleto_prazo} dias`}` : k === 'cartao' ? textoCartao(f) : formas[k] || k));
  return l.length ? l.join(', ') : f.condicoes_pagamento || 'não informado';
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
      f.pedido_minimo != null ? ` · Pedido mínimo: ${moeda(f.pedido_minimo)}` : ''),
    h('div', { class: 'suave pequeno' }, `Pagamento: ${textoPagamento(f, d.formas)}`,
      f.venda_a_ordem === 1 ? h('span', { class: 'etiqueta verde pequena', style: { marginLeft: '6px' } }, 'Faz venda à ordem') : f.venda_a_ordem === 0 ? ' · Não faz venda à ordem' : ''),
    h('div', { class: 'suave pequeno' }, f.cotacoes ? `${f.cotacoes} cotação(ões) registrada(s) · última em ${dataUtc(f.ultima_cotacao)}` : 'Nenhuma cotação registrada ainda.'),
    h('div', { class: 'linha', style: { marginTop: '10px' } },
      zap(f.whatsapp) ? h('a', { class: 'btn pequeno', href: zap(f.whatsapp), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp ↗') : null,
      f.email ? h('a', { class: 'btn pequeno', href: `mailto:${f.email}` }, 'E-mail ↗') : null,
      f.site ? h('a', { class: 'btn pequeno', href: /^https?:\/\//.test(f.site) ? f.site : `https://${f.site}`, target: '_blank', rel: 'noopener noreferrer' }, 'Site ↗') : null,
      podeEditar(est) ? h('button', { class: 'btn pequeno', onclick: () => formFornecedor(est, f, d, recarregar) }, 'Editar') : null,
      podeEditar(est) ? h('button', { class: 'btn pequeno', onclick: async () => {
        try { await api(`/fornecedores/${f.id}`, { metodo: 'PATCH', corpo: { ativo: !f.ativo } }); recarregar(); } catch (e) { toast(e.message); }
      } }, f.ativo ? 'Desativar' : 'Reativar') : null,
      podeExcluir(est) && !f.cotacoes ? h('button', { class: 'btn pequeno perigo', onclick: async () => {
        if (!confirmar(`Excluir ${nomeF(f)}?`)) return;
        try { await api(`/fornecedores/${f.id}`, { metodo: 'DELETE' }); recarregar(); } catch (e) { toast(e.message, 5000); }
      } }, 'Excluir') : null));
  render(alvo,
    cabecalho('Fornecedores', 'De quem as empresas compram para revender ao governo. As cotações ficam em cada oportunidade do Kanban (botão 💲 Cotações).',
      podeEditar(est) ? h('button', { class: 'btn primario', onclick: () => formFornecedor(est, {}, d, recarregar) }, '+ Novo fornecedor') : null),
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

const qtdTexto = (i) => (i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${i.unidade_medida || 'un.'}` : 'a confirmar');
export const numeroLic = (op) => [op.modalidade_nome, op.numero_compra ? `nº ${op.numero_compra}${op.ano && !String(op.numero_compra).includes('/') ? `/${op.ano}` : ''}` : ''].filter(Boolean).join(' ');

// Mensagem do pedido. Leva só a descrição dos itens: nada de órgão, número, cidade ou data da licitação,
// para o fornecedor não descobrir a disputa e entrar nela como concorrente.
// formato 'whatsapp' usa *negrito*; 'email' é texto puro com títulos em maiúsculas.
// A descrição vem do edital e às vezes cita órgão/cidade/convênio: no WhatsApp esses trechos vão em negrito
// (para o usuário lembrar de apagar) ou saem da mensagem se tirarLocal estiver marcado.
function textoPedido(d, forn, numeros, formato = 'whatsapp', assinatura = '', link = null, tirarLocal = false) {
  const op = d.oportunidade;
  const itens = d.itens.filter((i) => numeros.includes(i.numero_item));
  const t = (s) => (formato === 'whatsapp' ? `*${s}*` : s);
  const sep = formato === 'email' ? '------------------------------' : null;
  const linhas = [
    `Olá${forn.contato_nome ? `, ${forn.contato_nome}` : ''}! Tudo bem?`,
    '',
    `${op.cliente_razao || op.cliente_nome ? `Somos da ${op.cliente_razao || op.cliente_nome}. ` : ''}Gostaríamos da sua cotação para ${itens.length === 1 ? 'o item abaixo' : `os ${itens.length} itens abaixo`}.`,
    '',
    link ? t('RESPONDA PELO LINK (mais rápido):') : null,
    link || null,
    link ? 'É só preencher preço, marca e prazo de cada item. Se preferir, responda por aqui mesmo.' : null,
    link ? '' : null,
    sep,
    t(`ITENS PARA COTAR (${itens.length})`),
    sep,
  ];
  itens.forEach((i, n) => {
    const desc = (i.descricao || '(sem descrição)').trim();
    const tr = trechosSensiveis(desc, op);
    const texto = tirarLocal ? removerTrechos(desc, tr) : formato === 'whatsapp' ? destacarTrechos(desc, tr, '*') : desc;
    linhas.push('', t(`ITEM ${i.numero_item}`), `Quantidade: ${qtdTexto(i)}`, 'Descrição:', texto);
    if (formato === 'email' && n < itens.length - 1) linhas.push('');
  });
  linhas.push('', sep,
    t('POR FAVOR, INFORME PARA CADA ITEM'), sep,
    '1. Preço unitário',
    '2. Marca e modelo',
    '3. Prazo de entrega (em dias)',
    '4. Validade da cotação',
    '5. Frete: incluso (CIF) ou não (FOB)',
    '6. Condições de pagamento',
    '7. Se pode faturar para nós e entregar direto ao nosso cliente (venda à ordem)',
    '',
    'Quanto antes puder responder, melhor.',
    '',
    'Obrigado!',
    assinatura);
  return linhas.filter((l) => l != null).filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n').trim();
}

// Itens marcados de início: os sugeridos; senão os que combinam com o fornecedor; senão os ainda sem cotação; senão todos.
function itensIniciais(d, f, sugeridos) {
  if (sugeridos?.length) return sugeridos;
  if (f.combina.length) return f.combina;
  const sem = d.itens.filter((i) => !i.usada_id).map((i) => i.numero_item);
  return sem.length ? sem : d.itens.map((i) => i.numero_item);
}

// Pergunta se o pedido saiu de fato; só então registra "aguardando retorno do fornecedor".
function confirmarEnvio(d, f, numeros, canal, aoConfirmar) {
  modal('O pedido foi enviado?', h('p', {}, `Você enviou o pedido de cotação para `, h('strong', {}, nomeF(f)), ` por ${canal === 'email' ? 'e-mail' : 'WhatsApp'} (${numeros.length} item(ns))?`,
    h('br'), h('span', { class: 'suave pequeno' }, 'Ao confirmar, a página de cotações mostra "Aguardando retorno do fornecedor" até você registrar a resposta.')),
  [{ texto: 'Sim, enviei', classe: 'primario', acao: async () => {
    try { await api(`/kanban/${d.oportunidade.id}/pedidos`, { metodo: 'POST', corpo: { fornecedor_id: f.id, canal, itens: numeros } }); toast('Pedido registrado: aguardando retorno do fornecedor.'); aoConfirmar(); }
    catch (e) { toast(e.message, 5000); return false; }
  } }], { fechar: 'Não enviei' });
}

function pedirCotacao(d, sugeridos, recarregar, est) {
  const fs = d.fornecedores;
  if (!fs.length) return toast('Cadastre um fornecedor primeiro (menu Fornecedores).', 5000);
  const assinatura = [est?.usuario?.nome, d.oportunidade.cliente_nome].filter(Boolean).join(' · ');
  const sel = h('select', {}, fs.map((f) => h('option', { value: f.id }, `${nomeF(f)}${f.combina.length ? ` · combina com ${f.combina.length} item(ns)` : ''}`)));
  const marcar = new Map();
  const lista = h('div', { class: 'lista-itens-pedido' });
  const contagem = h('span', { class: 'suave pequeno' });
  const formato = h('select', { onchange: () => atualizar() }, h('option', { value: 'whatsapp' }, 'WhatsApp (com negrito)'), h('option', { value: 'email' }, 'E-mail (texto simples)'));
  const texto = h('textarea', { rows: 14, readonly: true, class: 'texto-pedido' });
  // Link para o fornecedor responder online: um por fornecedor nesta oportunidade (o mesmo link serve para reenvios)
  const comLink = h('input', { type: 'checkbox', checked: true, onchange: () => buscarLink() });
  // Trechos da descrição que citam órgão, cidade, convênio ou processo (o fornecedor não pode saber da licitação)
  const tirarLocal = h('input', { type: 'checkbox', onchange: () => atualizar() });
  const avisoLocal = h('div');
  const urls = new Map(); // fornecedor_id -> url
  const sincronizarLink = async (f) => {
    const x = await api(`/kanban/${d.oportunidade.id}/links`, { metodo: 'POST', corpo: { fornecedor_id: f.id, itens: marcados() } });
    urls.set(f.id, x.url); return x.url;
  };
  let buscando = false;
  const buscarLink = async () => {
    const f = atual();
    if (comLink.checked && !urls.has(f.id) && marcados().length && !buscando) {
      buscando = true;
      try { await sincronizarLink(f); } catch (e) { toast(`Não foi possível gerar o link: ${e.message}`, 6000); comLink.checked = false; }
      buscando = false;
    }
    atualizar();
  };
  const links = h('div', { class: 'linha' });
  const atual = () => fs.find((x) => String(x.id) === sel.value);
  const marcados = () => [...marcar].filter(([, cb]) => cb.checked).map(([n]) => n);
  const copiar = async (msg) => { try { await navigator.clipboard.writeText(msg); return true; } catch { return false; } };
  let fecharPedido = () => {};
  const depoisDeAbrir = (f, numeros, canal) => (comLink.checked ? sincronizarLink(f).catch(() => {}) : null, setTimeout(() => confirmarEnvio(d, f, numeros, canal, () => { fecharPedido(); recarregar?.(); }), 800));
  const atualizar = () => {
    const f = atual(); const numeros = marcados();
    contagem.textContent = `${numeros.length} de ${d.itens.length} marcado(s)`;
    if (!numeros.length) {
      texto.value = ''; render(avisoLocal);
      return render(links, h('div', { class: 'aviso amarelo pequeno' }, 'Marque pelo menos um item para montar a mensagem.'));
    }
    const link = comLink.checked ? urls.get(f.id) || null : null;
    if (comLink.checked && !link && !buscando) setTimeout(buscarLink, 0);
    const achados = d.itens.filter((i) => numeros.includes(i.numero_item))
      .map((i) => [i.numero_item, trechosSensiveis(i.descricao, d.oportunidade).map((x) => x.texto)]).filter(([, l]) => l.length);
    render(avisoLocal, achados.length ? h('div', { class: `aviso ${tirarLocal.checked ? 'verde' : 'amarelo'} pequeno aviso-local` },
      h('strong', {}, tirarLocal.checked ? '✓ Trechos que citam a licitação foram tirados da mensagem.' : '⚠ A descrição cita a licitação. Apague antes de enviar:'),
      h('ul', {}, achados.map(([n, l]) => h('li', {}, `Item ${n}: `, l.map((x, k) => [k ? ' · ' : '', h('mark', {}, x)])))),
      h('label', { class: 'opcao-check' }, tirarLocal, ' Tirar esses trechos da mensagem'),
      tirarLocal.checked ? null : h('div', { class: 'suave' }, 'No WhatsApp eles vão em negrito para você achar fácil. Confira também se sobrou algum nome de cidade ou órgão que o sistema não reconheceu.'))
      : null);
    texto.value = textoPedido(d, f, numeros, formato.value, assinatura, link, tirarLocal.checked);
    const msgZap = textoPedido(d, f, numeros, 'whatsapp', assinatura, link, tirarLocal.checked);
    const msgEmail = textoPedido(d, f, numeros, 'email', assinatura, link, tirarLocal.checked);
    const w = zap(f.whatsapp || f.telefone, msgZap);
    const assunto = ['Pedido de cotação', d.oportunidade.cliente_nome].filter(Boolean).join(' – '); // sem órgão/licitação no assunto
    // Alguns programas de e-mail cortam links mailto longos: acima do limite, o corpo vai pela área de transferência
    let mailto = f.email ? `mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(msgEmail)}` : null;
    const longo = mailto && mailto.length > 1800;
    if (longo) mailto = `mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent('(Cole aqui o texto do pedido: Ctrl+V)\n')}`;
    render(links,
      h('button', { type: 'button', class: 'btn pequeno', onclick: async () => { if (await copiar(texto.value)) toast('Texto copiado.'); else { texto.select(); toast('Selecione e copie (Ctrl+C).'); } } }, '📋 Copiar texto'),
      w ? h('a', { class: 'btn pequeno', href: w, target: '_blank', rel: 'noopener noreferrer', onclick: () => depoisDeAbrir(f, numeros, 'whatsapp') }, '🟢 Abrir no WhatsApp ↗')
        : h('span', { class: 'suave pequeno' }, 'Sem WhatsApp cadastrado.'),
      mailto ? h('a', { class: 'btn pequeno', href: mailto, onclick: () => { copiar(msgEmail).then((ok) => longo && toast(ok ? 'Mensagem longa: o texto foi copiado. No e-mail, cole com Ctrl+V.' : 'Mensagem longa: copie o texto acima e cole no e-mail.', 8000)); depoisDeAbrir(f, numeros, 'email'); } }, `✉ Enviar por e-mail (${f.email}) ↗`)
        : h('span', { class: 'suave pequeno' }, h('a', { href: '#/fornecedores' }, 'Sem e-mail cadastrado'), ' neste fornecedor.'));
  };
  const montarLista = () => {
    const f = atual();
    const iniciais = itensIniciais(d, f, sugeridos);
    const aguardando = new Set(d.pedidos.filter((p) => p.status === 'aguardando' && p.fornecedor_id === f.id).flatMap((p) => p.itens));
    marcar.clear();
    render(lista, d.itens.map((i) => {
      const cb = h('input', { type: 'checkbox', checked: iniciais.includes(i.numero_item), onchange: atualizar });
      marcar.set(i.numero_item, cb);
      return h('label', { class: 'item-pedido' }, cb, ` Item ${i.numero_item}: ${(i.descricao || '').slice(0, 90)}`,
        f.combina.includes(i.numero_item) ? h('span', { class: 'etiqueta verde pequena' }, 'combina') : null,
        i.usada_id ? h('span', { class: 'etiqueta pequena' }, 'já cotado') : null,
        aguardando.has(i.numero_item) ? h('span', { class: 'etiqueta amarela pequena' }, 'já pedido, aguardando') : null);
    }));
    buscarLink();
  };
  const todos = (v) => { marcar.forEach((cb) => { cb.checked = v; }); atualizar(); };
  sel.addEventListener('change', () => { sugeridos = null; montarLista(); });
  fecharPedido = modal('Pedir cotação', h('div', { class: 'modal-largo' },
    h('div', { class: 'filtros' },
      h('div', { class: 'largo' }, h('label', {}, 'Fornecedor'), sel),
      h('div', {}, h('label', {}, 'Ver mensagem como'), formato)),
    h('div', { class: 'campo' }, h('label', {}, 'Itens ', contagem, ' ',
      h('button', { type: 'button', class: 'btn pequeno', onclick: () => todos(true) }, 'Marcar todos'), ' ',
      h('button', { type: 'button', class: 'btn pequeno', onclick: () => todos(false) }, 'Nenhum')), lista),
    h('label', { class: 'opcao-check', style: { marginBottom: '8px' } }, comLink, ' Incluir link para o fornecedor responder online (a resposta entra direto nesta cotação)'),
    avisoLocal,
    h('div', { class: 'campo' }, h('label', {}, 'Mensagem (descrição completa de cada item)'), texto),
    links,
    h('p', { class: 'suave pequeno' }, 'O sistema não envia nada sozinho: o WhatsApp ou o seu programa de e-mail (Outlook, se for o padrão do computador) abre com a mensagem pronta e você revisa e envia. Depois o sistema pergunta se foi enviado.')), []);
  montarLista();
}

function registrarResposta(d, recarregar, fornecedorId) {
  const fs = d.fornecedores;
  if (!fs.length) return toast('Cadastre um fornecedor primeiro (menu Fornecedores).', 5000);
  const sel = h('select', {}, fs.map((f) => h('option', { value: f.id, selected: f.id === fornecedorId }, nomeF(f))));
  const prazo = h('input', { type: 'number', min: 0, step: 1, placeholder: 'dias' });
  const validade = h('input', { type: 'date' });
  const frete = h('select', { onchange: () => mostrarFob() }, h('option', { value: '' }, 'Não informado'), h('option', { value: 'CIF' }, 'CIF · entrega inclusa'), h('option', { value: 'FOB' }, 'FOB · nós pagamos o frete'));
  const transportadora = h('input', { placeholder: 'nome da transportadora' });
  const valorFrete = h('input', { inputmode: 'decimal', placeholder: '0,00' });
  const blocoFob = h('div', { class: 'filtros bloco-boleto' },
    h('div', {}, h('label', {}, 'Transportadora'), transportadora),
    h('div', {}, h('label', {}, 'Valor total do frete (R$)'), valorFrete),
    h('div', { class: 'largo suave pequeno' }, 'O valor entra no custo dos itens deste fornecedor, dividido pelo valor de cada item. Sem o valor, a cotação fica marcada "FOB sem valor de frete".'));
  const mostrarFob = () => { blocoFob.style.display = frete.value === 'FOB' ? '' : 'none'; };
  const linhas = new Map();
  const corpoTabela = h('tbody', {});
  const montar = () => {
    const fid = Number(sel.value); const f = fs.find((x) => x.id === fid);
    const ja = d.itens.flatMap((i) => i.cotacoes).filter((c) => c.fornecedor_id === fid);
    const uma = ja[0];
    prazo.value = uma?.prazo_entrega_dias ?? f.prazo_entrega_dias ?? '';
    validade.value = uma?.validade || '';
    const fr = d.fretes_fornecedor.find((x) => x.fornecedor_id === fid);
    frete.value = fr?.tipo || (uma?.frete_incluso === 1 ? 'CIF' : uma?.frete_incluso === 0 ? 'FOB' : f.frete || '');
    transportadora.value = fr?.transportadora || ''; valorFrete.value = num(fr?.valor);
    mostrarFob();
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
      h('div', {}, h('label', {}, 'Frete'), frete)),
    blocoFob,
    h('p', { class: 'suave pequeno' }, 'Preencha o preço unitário só dos itens que o fornecedor cotou. Deixe em branco os que ele não cotou (apagar um preço remove a cotação daquele item).'),
    h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-cotacao' },
      h('thead', {}, h('tr', {}, ['Nº', 'Descrição', 'Qtd.', 'Estimado (unit.)', 'Preço unit. do fornecedor', 'Marca / modelo'].map((t) => h('th', {}, t)))),
      corpoTabela))), [{ texto: 'Salvar cotação', classe: 'primario', acao: async () => {
    const itens = [...linhas].filter(([, l]) => l.preco.value.trim() || l.tinha)
      .map(([n, l]) => ({ numero_item: n, preco_unitario: lerNum(l.preco.value), marca_modelo: l.marca.value.trim() }));
    if (!itens.length) { toast('Informe o preço de pelo menos um item.'); return false; }
    try {
      const r = await api(`/kanban/${d.oportunidade.id}/cotacoes`, { metodo: 'POST', corpo: { fornecedor_id: Number(sel.value), prazo_entrega_dias: prazo.value, validade: validade.value, frete: frete.value, transportadora: transportadora.value.trim(), valor_frete: lerNum(valorFrete.value), itens } });
      toast(`${r.gravados} item(ns) cotado(s)${r.removidos ? `, ${r.removidos} removido(s)` : ''}.`); recarregar();
    } catch (e) { toast(e.message, 6000); return false; }
  } }]);
}

const CANAIS = { whatsapp: 'WhatsApp', email: 'e-mail', outro: 'outro meio' };

/** Margem geral se vender pelo estimado, já descontados os impostos informados (mesma conta do servidor por item). */
function margemResumo(d) {
  const r = d.resumo;
  if (!r.estimado_cotados || r.custo_cotados_com_ref == null) return null;
  return ((r.estimado_cotados * (1 - (d.parametros.impostos_pct || 0) / 100) - r.custo_cotados_com_ref) / r.estimado_cotados) * 100;
}

// ---------- Impressão / PDF ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NI = '<span class="ni">não informado</span>';
const pBrl = (v) => (v == null ? NI : esc(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v)));
const pPct = (v) => (v == null ? '—' : esc(`${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`));

/** Abre uma página de impressão (o navegador salva em PDF em "Destino: Salvar como PDF"). */
function imprimirCotacoes(d, est) {
  const op = d.oportunidade; const r = d.resumo; const par = d.parametros;
  const janela = window.open('', '_blank');
  if (!janela) return toast('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.', 7000);
  const porId = new Map(d.fornecedores_cotados.map((f) => [f.id, f]));
  const aguardando = d.pedidos.filter((p) => p.status === 'aguardando');
  const usada = (i) => i.cotacoes.find((c) => c.id === i.usada_id);
  const prazo = (c) => (c?.prazo_entrega_dias != null ? `${c.prazo_entrega_dias} dia(s)` : NI);
  const frete = (c) => (c?.frete_incluso === 1 ? 'incluso' : c?.frete_incluso === 0 ? 'não incluso' : NI);
  const situacao = (i) => {
    const [rot, cor] = i.situacao === 'sem_cotacao' && aguardando.some((p) => p.itens.includes(i.numero_item)) ? ['Aguardando fornecedor', 'amarela'] : SITUACAO[i.situacao];
    return `<span class="sit ${cor}">${esc(rot)}</span>`;
  };
  const campo = (rot, v) => (v ? `<div><b>${esc(rot)}</b> ${v}</div>` : '');
  const margem = margemResumo(d);
  const kpi = (rot, v) => `<div class="kpi"><div class="r">${esc(rot)}</div><div class="v">${v}</div></div>`;

  // Uma ficha por item: descrição inteira em largura total e os valores em grade embaixo (não espreme o texto)
  const campoV = (rot, v, cls = '') => `<div class="v ${cls}"><div class="r">${esc(rot)}</div><div>${v}</div></div>`;
  const linhas = d.itens.map((i) => {
    const c = usada(i);
    return `<div class="item-ficha">
      <div class="cab"><b>Item ${esc(i.numero_item)}</b><span>${esc(i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${i.unidade_medida || ''}` : 'quantidade não informada')}</span>${situacao(i)}</div>
      <div class="desc">${esc(i.descricao || '—')}</div>
      <div class="valores">
        ${campoV('Estimado unit.', i.orcamento_sigiloso ? 'Sigiloso' : pBrl(i.valor_unitario_estimado))}
        ${campoV('Fornecedor / marca', c ? `<b>${esc(c.fornecedor_nome)}</b>${c.marca_modelo ? ` · ${esc(c.marca_modelo)}` : ''}` : '<span class="ni">sem cotação</span>', 'largo')}
        ${campoV('Preço do fornecedor', c ? pBrl(c.preco_unitario) : '—')}
        ${campoV('Frete', !c ? '—' : i.frete === 'CIF' ? 'CIF' : i.frete === 'FOB' ? (i.frete_pendente ? 'FOB <span class="ni">sem valor</span>' : `FOB +${pBrl(i.frete_unitario)}/un`) : NI)}
        ${campoV('Custo total (c/ frete)', i.custo_total == null ? '—' : pBrl(i.custo_total))}
        ${campoV('Prazo de entrega', c ? prazo(c) : '—')}
        ${campoV('Margem líquida no estimado', pPct(i.margem_estimado_pct))}
        ${campoV('Preço mín. de venda unit.', i.preco_minimo == null ? '—' : pBrl(i.preco_minimo), 'destaque')}
        ${campoV('Preço mín. de venda total', i.preco_minimo_total == null ? '—' : pBrl(i.preco_minimo_total), 'destaque')}
      </div></div>`;
  }).join('');

  const comparativo = d.itens.filter((i) => i.cotacoes.length).map((i) => `
    <div class="bloco-item"><div class="titulo-item">Item ${esc(i.numero_item)} · ${esc((i.descricao || '').slice(0, 140))}${(i.descricao || '').length > 140 ? '…' : ''}</div>
    <table class="mini"><thead><tr><th>Fornecedor</th><th>Marca / modelo</th><th class="n">Preço unit.</th><th class="n">Prazo de entrega</th><th>Frete</th><th>Validade</th><th></th></tr></thead><tbody>
    ${i.cotacoes.map((c) => `<tr class="${c.id === i.usada_id ? 'usada' : ''}"><td>${esc(c.fornecedor_nome)}</td><td>${c.marca_modelo ? esc(c.marca_modelo) : NI}</td>
      <td class="n">${pBrl(c.preco_unitario)}</td><td class="n">${prazo(c)}</td><td>${frete(c)}</td><td>${c.validade ? esc(data(c.validade, false)) : NI}</td>
      <td>${c.id === i.usada_id ? (c.escolhida ? '✔ escolhida' : '✔ mais barata') : ''}</td></tr>`).join('')}
    </tbody></table></div>`).join('');

  const fornecedores = d.fornecedores_cotados.map((f) => `
    <div class="forn"><div class="nome">${esc(nomeF(f))}</div>
      ${campo('CNPJ', f.cnpj ? esc(fmtCnpj(f.cnpj)) : NI)}
      ${campo('Local', esc([f.municipio, f.uf].filter(Boolean).join('/')) || NI)}
      ${campo('Contato', esc([f.contato_nome, f.whatsapp || f.telefone, f.email].filter(Boolean).join(' · ')) || NI)}
      ${campo('Pagamento', esc(textoPagamento(f)))}
      ${(() => { const fr = d.fretes_fornecedor.find((x) => x.fornecedor_id === f.id); return campo('Frete nesta cotação', fr ? esc(fr.tipo === 'FOB' ? `FOB${fr.transportadora ? ` · ${fr.transportadora}` : ''}` : 'CIF') + (fr.tipo === 'FOB' ? ` · ${fr.valor == null ? NI : pBrl(fr.valor)}` : '') : (f.frete ? `${esc(f.frete)} (cadastro)` : NI)); })()}
      ${campo('Pedido mínimo', f.pedido_minimo != null ? pBrl(f.pedido_minimo) : NI)}
      ${campo('Venda à ordem', f.venda_a_ordem === 1 ? 'faz (entrega direta no órgão)' : f.venda_a_ordem === 0 ? 'não faz' : NI)}
    </div>`).join('');

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cotações · ${esc(op.cliente_nome || '')} · ${esc(op.orgao_nome || '')}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2933; margin: 0; padding: 18px; background: #fff; }
  .barra { display: flex; gap: 10px; align-items: center; background: #eef4fb; border: 1px solid #c9dcf0; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; }
  .barra button { font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 6px; border: 0; background: #1d4ed8; color: #fff; cursor: pointer; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 14px; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1d4ed8; color: #1d4ed8; text-transform: uppercase; letter-spacing: .03em; }
  .topo { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; border-bottom: 1px solid #d5dbe1; padding-bottom: 10px; }
  .empresa { text-align: right; } .empresa .nome { font-size: 15px; font-weight: 700; }
  .s, .ni { color: #6b7785; font-size: 11px; } .ni { font-style: italic; }
  .licit { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 18px; margin-top: 10px; }
  .licit .objeto { grid-column: 1 / -1; }
  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 12px; }
  .kpi { border: 1px solid #d5dbe1; border-radius: 6px; padding: 6px 8px; } .kpi .r { font-size: 10px; color: #6b7785; text-transform: uppercase; } .kpi .v { font-size: 15px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #e3e7eb; padding: 5px 6px; vertical-align: top; text-align: left; }
  th { background: #f3f5f7; font-size: 10.5px; text-transform: uppercase; color: #4a5562; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  td.n, th.n { text-align: right; white-space: nowrap; } td.c { text-align: center; font-weight: 700; }
  .item-ficha { border: 1px solid #d5dbe1; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; page-break-inside: avoid; }
  .item-ficha .cab { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; } .item-ficha .cab .sit { margin-left: auto; }
  .item-ficha .desc { font-size: 11.5px; margin-bottom: 6px; text-align: justify; }
  .valores { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px 10px; border-top: 1px dashed #d5dbe1; padding-top: 6px; }
  .valores .v .r { font-size: 9.5px; color: #6b7785; text-transform: uppercase; } .valores .v.largo { grid-column: span 2; } .valores .v.destaque div:last-child { font-weight: 700; }
  .sit { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 10.5px; background: #eef0f2; white-space: nowrap; }
  .sit.verde { background: #dcfce7; color: #166534; } .sit.vermelha { background: #fee2e2; color: #991b1b; } .sit.amarela { background: #fef3c7; color: #92400e; }
  .bloco-item { margin-bottom: 10px; page-break-inside: avoid; } .titulo-item { font-weight: 700; margin-bottom: 3px; }
  table.mini td, table.mini th { padding: 3px 6px; } tr.usada td { background: #ecfdf5 !important; font-weight: 600; }
  .fornecedores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .forn { border: 1px solid #d5dbe1; border-radius: 6px; padding: 8px 10px; page-break-inside: avoid; } .forn .nome { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
  .rodape { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d5dbe1; font-size: 10.5px; color: #6b7785; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  @media print { body { padding: 0; } .barra { display: none; } }
  @media (max-width: 700px) { .valores { grid-template-columns: 1fr 1fr; } .licit, .kpis, .fornecedores { grid-template-columns: 1fr 1fr; } .topo { flex-direction: column; } .empresa { text-align: left; } }
</style></head><body>
<div class="barra"><button id="btn-imprimir" type="button">🖨 Imprimir / Salvar em PDF</button><span>Para gerar o PDF, escolha <b>“Salvar como PDF”</b> no destino da impressão.</span></div>
<div class="topo">
  <div><h1>Mapa de cotações</h1><div class="s">Gerado em ${esc(new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}${est?.usuario?.nome ? ` por ${esc(est.usuario.nome)}` : ''}</div></div>
  <div class="empresa"><div class="s">Empresa participante</div><div class="nome">${esc(op.cliente_razao || op.cliente_nome || 'Empresa não vinculada')}</div>${op.cliente_cnpj ? `<div>CNPJ ${esc(fmtCnpj(op.cliente_cnpj))}</div>` : ''}</div>
</div>
<div class="licit">
  ${campo('Órgão:', op.orgao_nome ? esc(op.orgao_nome) : NI)}
  ${campo('Local:', op.municipio ? esc(`${op.municipio}/${op.uf}`) : NI)}
  ${campo('Licitação:', numeroLic(op) ? esc(numeroLic(op)) : NI)}
  ${campo('Unidade:', op.unidade_nome ? esc(op.unidade_nome) : '')}
  ${campo('Processo:', op.processo ? esc(op.processo) : '')}
  ${campo('Propostas até:', op.data_encerramento_proposta ? esc(data(op.data_encerramento_proposta)) : NI)}
  <div class="objeto"><b>Objeto:</b> ${esc(op.objeto || '—')}</div>
</div>
<div class="kpis">
  ${kpi('Itens cotados', esc(`${r.cotados} de ${r.itens}`))}
  ${kpi('Custo de compra', r.custo_total == null ? '—' : pBrl(r.custo_total))}
  ${kpi('Preço mínimo de venda (total)', r.preco_minimo_total == null ? '—' : pBrl(r.preco_minimo_total))}
  ${kpi('Estimado (itens cotados)', r.estimado_cotados == null ? '—' : pBrl(r.estimado_cotados))}
  ${kpi('Margem líquida vendendo pelo estimado', pPct(margem))}
  ${kpi('Itens acima do estimado', esc(String(r.acima)))}
</div>
<div class="s" style="margin-top:6px">Parâmetros: ${par.tributos?.regime ? `${esc(REGIMES[par.tributos.regime] || '')}${par.tributos.regime === 'simples' ? ` (Anexo ${esc(par.tributos.anexo)})` : ''} · ` : ''}${r.frete_total ? `frete FOB ${pBrl(r.frete_total)} incluído no custo · ` : ''}impostos ${par.impostos_pct == null ? 'não informados' : esc(`${String(par.impostos_pct).replace('.', ',')}%`)} · margem desejada ${par.margem_pct == null ? 'não informada' : esc(`${String(par.margem_pct).replace('.', ',')}%`)} · preço mínimo = custo ÷ (1 − impostos − margem).</div>

<h2>Itens e cotação usada</h2>
${linhas}

${comparativo ? `<h2>Comparativo de cotações por item</h2>${comparativo}` : ''}
${fornecedores ? `<h2>Condições dos fornecedores cotados</h2><div class="fornecedores">${fornecedores}</div>` : ''}
${aguardando.length ? `<h2>Aguardando retorno do fornecedor</h2><ul>${aguardando.map((p) => `<li><b>${esc(p.fornecedor_nome)}</b> · itens ${esc(p.itens.join(', '))} · pedido por ${esc(CANAIS[p.canal] || p.canal)} em ${esc(dataUtc(p.enviado_em))}</li>`).join('')}</ul>` : ''}

<div class="rodape">Valores digitados pela equipe a partir das respostas dos fornecedores; confira antes de usar na proposta. "Não informado" = o fornecedor ou o edital não trouxe o dado. Licita Inteligente.</div>
</body></html>`;
  janela.document.open(); janela.document.write(html); janela.document.close();
  // A política de segurança do site bloqueia script dentro da página impressa: o botão e a impressão são ligados daqui
  janela.document.getElementById('btn-imprimir').addEventListener('click', () => { janela.focus(); janela.print(); });
  setTimeout(() => { janela.focus(); janela.print(); }, 500);
}

// "CIF", "FOB + R$ 2,00/un" ou "FOB sem valor"
function textoFreteItem(i) {
  if (!i.usada_id) return '—';
  if (i.frete === 'CIF') return h('span', { class: 'etiqueta verde pequena', title: 'Entrega inclusa no preço do fornecedor' }, 'CIF');
  if (i.frete === 'FOB') return i.frete_pendente ? h('span', { class: 'etiqueta amarela pequena', title: 'Informe o valor do frete na resposta do fornecedor' }, 'FOB sem valor')
    : h('span', {}, h('span', { class: 'etiqueta pequena' }, 'FOB'), h('div', { class: 'suave pequeno' }, `+ ${brl(i.frete_unitario)}/un`));
  return naoInformado();
}

// Seletor de regime tributário: calcula a alíquota sobre a venda (a mesma conta é refeita no servidor)
function blocoTributos(par) {
  const t = par.tributos || (par.impostos_pct != null ? { regime: 'manual', aliquota: par.impostos_pct } : {});
  const opc = (obj, atual, rot = (v) => v) => Object.entries(obj).map(([k, v]) => h('option', { value: k, selected: k === atual }, rot(v)));
  const regime = h('select', { onchange: () => atualizar() }, h('option', { value: '' }, 'Escolha o regime…'), opc(REGIMES, t.regime));
  const anexo = h('select', { onchange: () => atualizar() }, opc(ANEXOS_SIMPLES, t.anexo || 'I', (a) => a.nome));
  const atividade = h('select', { onchange: () => atualizar() }, opc(PRESUMIDO, t.atividade || 'comercio', (a) => a.nome));
  const campoNum = (v, ph) => h('input', { inputmode: 'decimal', value: num(v), placeholder: ph, oninput: () => atualizar(), style: { width: '120px' } });
  const rbt12 = campoNum(t.rbt12, 'ex.: 850000');
  const icms = campoNum(t.icms, 'ex.: 12'); const iss = campoNum(t.iss, 'ex.: 5');
  const pisCofins = campoNum(t.pis_cofins, '9,25'); const irCsll = campoNum(t.ir_csll, 'ex.: 2');
  const aliquota = campoNum(t.aliquota, 'ex.: 8');
  const c = (rot, el, dica) => h('div', { class: 'campo' }, h('label', {}, rot), el, dica ? h('div', { class: 'suave pequeno' }, dica) : null);
  const campos = h('div', { class: 'linha', style: { alignItems: 'flex-start', flexWrap: 'wrap' } });
  const resultado = h('div', { class: 'resultado-tributos' });
  const ler = () => ({ regime: regime.value, anexo: anexo.value, atividade: atividade.value, rbt12: lerNum(rbt12.value), icms: lerNum(icms.value), iss: lerNum(iss.value),
    pis_cofins: lerNum(pisCofins.value), ir_csll: lerNum(irCsll.value), aliquota: lerNum(aliquota.value) });
  const atualizar = () => {
    const r = regime.value;
    render(campos,
      r === 'simples' ? [c('Anexo', anexo), c('Receita bruta dos últimos 12 meses (R$)', rbt12, 'Está no PGDAS-D ou com o contador.')] : null,
      r === 'presumido' ? [c('Atividade', atividade), c('ICMS efetivo (%)', icms, 'Venda de mercadoria. Já descontado o crédito da compra.'), c('ISS (%)', iss, 'Só para serviço.')] : null,
      r === 'real' ? [c('PIS + COFINS após créditos (%)', pisCofins, 'Sem créditos: 9,25%.'), c('ICMS efetivo (%)', icms), c('ISS (%)', iss), c('IRPJ + CSLL sobre a venda (%)', irCsll, 'Estimativa: peça a carga média ao contador.')] : null,
      r === 'manual' ? c('Impostos sobre a venda (%)', aliquota) : null);
    if (!r) return render(resultado, h('div', { class: 'aviso amarelo pequeno' }, 'Escolha o regime da empresa para calcular os impostos.'));
    const x = calcularTributos(ler());
    if (x.erro) return render(resultado, h('div', { class: 'aviso vermelho pequeno' }, x.erro));
    render(resultado, h('div', { class: 'aviso azul pequeno' },
      h('strong', {}, `Impostos sobre a venda: ${pct(x.aliquota)}`), ' = ', x.partes.map(([rot, v]) => `${rot} ${pct(v)}`).join(' + '),
      x.aviso ? h('div', {}, `⚠ ${x.aviso}`) : null));
  };
  atualizar();
  return {
    el: h('div', {}, h('div', { class: 'linha', style: { alignItems: 'flex-start', flexWrap: 'wrap' } }, c('Regime tributário da empresa', regime), campos), resultado,
      h('div', { class: 'suave pequeno' }, 'Fontes: LC 123/2006 (Anexos I a III do Simples); Lei 9.249/1995 (presunção do Lucro Presumido); Leis 9.718/1998, 10.637/2002 e 10.833/2003 (PIS/COFINS).')),
    valor: () => (regime.value ? { tributos: ler() } : {}),
  };
}

export async function cotacao(alvo, rota, est) {
  render(alvo, carregando());
  const id = rota.args[0];
  const d = await api(`/kanban/${id}/cotacoes`);
  const op = d.oportunidade; const r = d.resumo;
  const recarregar = () => cotacao(alvo, rota, est);
  const editar = podeEditar(est);

  const mar = h('input', { inputmode: 'decimal', value: num(d.parametros.margem_pct), placeholder: 'ex.: 15', style: { width: '90px' } });
  const trib = blocoTributos(d.parametros);
  const parametros = h('div', { class: 'cartao' }, h('h2', {}, 'Como calcular o preço mínimo'),
    trib.el,
    h('div', { class: 'linha', style: { alignItems: 'flex-end', marginTop: '10px' } },
      h('div', { class: 'campo' }, h('label', {}, 'Margem desejada (%)'), mar),
      editar ? h('button', { class: 'btn primario', onclick: async () => {
        try {
          const corpo = { margem_pct: lerNum(mar.value), ...trib.valor() };
          const x = await api(`/kanban/${id}/cotacoes/parametros`, { metodo: 'PATCH', corpo });
          toast(`Salvo. Impostos: ${pct(x.impostos_pct)}.${op.cliente_id && corpo.tributos ? ' Regime guardado na empresa para as próximas cotações.' : ''}`, 5000); recarregar();
        } catch (e) { toast(e.message, 5000); }
      } }, 'Salvar e recalcular') : null),
    h('p', { class: 'suave pequeno' }, 'Preço mínimo de venda = custo ÷ (1 − impostos − margem): vendendo por ele, sobra exatamente a margem desejada. A "margem líquida" do quadro acima é o que sobra vendendo pelo valor estimado do órgão (o teto). ',
      'Ex.: custo R$ 80, impostos 8% e margem 15% → 80 ÷ 0,77 = R$ 103,90. ',
      'O custo já inclui o frete FOB informado na resposta do fornecedor. A alíquota é estimativa para formar preço: confirme com o contador.'),
    d.parametros.impostos_pct == null && d.parametros.margem_pct == null ? h('div', { class: 'aviso amarelo pequeno' }, 'Impostos e margem não informados: o "preço mínimo" abaixo é só o custo de compra.') : null);

  const total = (rot, val, dica) => h('div', { class: 'cartao kpi', title: dica || '' }, h('div', { class: 'rotulo' }, rot), h('div', { class: 'valor' }, val));
  const margemGeral = margemResumo(d);
  const semImpostos = d.parametros.impostos_pct == null;
  const resumo = h('div', { class: 'grade kpis' },
    total('Itens cotados', `${r.cotados} de ${r.itens}`),
    total('Custo de compra', r.custo_total == null ? (r.cotados ? 's/ qtd.' : '—') : moeda(r.custo_total), `Soma de preço × quantidade da cotação usada em cada item${r.frete_total ? `, com ${moeda(r.frete_total)} de frete FOB` : ''}`),
    total('Preço mínimo de venda (total)', r.preco_minimo_total == null ? '—' : moeda(r.preco_minimo_total), 'Menor preço para vender ao órgão e ainda ter a margem desejada, já pagando os impostos: custo ÷ (1 − impostos − margem)'),
    total('Estimado dos itens cotados', r.estimado_cotados == null ? '—' : moeda(r.estimado_cotados), `Valor de referência do órgão, só dos ${r.itens_com_ref} item(ns) cotados que têm valor`),
    total(semImpostos ? 'Margem líquida (impostos não informados)' : 'Margem líquida vendendo pelo estimado', margemGeral == null ? '—' : pct(margemGeral),
      'Quanto sobra se vender pelo valor estimado do órgão: (estimado × (1 − impostos) − custo) ÷ estimado. Compare com a margem desejada. Frete não incluso precisa entrar no custo.'),
    total('Itens acima do estimado', String(r.acima), 'O preço mínimo passa do valor unitário estimado: risco de desclassificação ou prejuízo'));

  const aguardando = d.pedidos.filter((p) => p.status === 'aguardando');
  // Valor do item no edital: o total informado pela fonte; se faltar, quantidade × unitário
  const totalEdital = (i) => (i.valor_total_estimado != null ? i.valor_total_estimado
    : i.valor_unitario_estimado != null && i.quantidade != null ? Math.round(i.valor_unitario_estimado * i.quantidade * 100) / 100 : null);
  const linhaItem = (i) => {
    // só os que ainda não cotaram este item
    const esperando = aguardando.filter((p) => p.itens.includes(i.numero_item) && !i.cotacoes.some((c) => c.fornecedor_id === p.fornecedor_id));
    const [rot, cor] = i.situacao === 'sem_cotacao' && esperando.length ? ['Aguardando fornecedor', 'amarela'] : SITUACAO[i.situacao];
    const detalhes = i.cotacoes.length ? h('details', { class: 'cotacoes-item' }, h('summary', {}, `${i.cotacoes.length} cotação(ões)`),
      h('ul', {}, i.cotacoes.map((c) => h('li', {},
        h('strong', {}, c.fornecedor_nome), ` · ${brl(c.preco_unitario)}`, c.marca_modelo ? ` · ${c.marca_modelo}` : '',
        c.prazo_entrega_dias != null ? ` · ${c.prazo_entrega_dias} dia(s)` : '', c.frete_incluso === 0 ? ' · frete não incluso' : c.frete_incluso === 1 ? ' · frete incluso' : '',
        c.validade ? h('span', { class: c.validade < new Date().toLocaleDateString('sv-SE') ? 'texto-perigo' : '' }, ` · válida até ${data(c.validade, false)}`) : '',
        c.condicoes_pagamento ? ` · pagamento: ${c.condicoes_pagamento}` : '',
        c.origem === 'fornecedor' ? h('span', { class: 'etiqueta azul pequena', title: c.respondente ? `Respondida por ${c.respondente}` : '' }, 'pelo link') : null,
        c.id === i.usada_id ? h('span', { class: 'etiqueta verde pequena' }, c.escolhida ? 'escolhida' : 'mais barata') : null,
        editar && c.id !== i.usada_id ? h('button', { class: 'btn pequeno', onclick: async () => { await api(`/kanban/${id}/cotacoes/${c.id}/escolher`, { metodo: 'POST', corpo: {} }); recarregar(); } }, 'Usar esta') : null,
        editar ? h('button', { class: 'btn pequeno', title: 'Excluir cotação', onclick: async () => { if (confirmar('Excluir esta cotação?')) { await api(`/kanban/${id}/cotacoes/${c.id}`, { metodo: 'DELETE' }); recarregar(); } } }, '✕') : null)))) : null;
    return h('tr', {},
      h('td', {}, i.numero_item),
      h('td', { class: 'desc' }, i.descricao || '—', detalhes),
      h('td', { class: 'num' }, i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${i.unidade_medida || ''}` : naoInformado()),
      h('td', { class: 'num' }, i.orcamento_sigiloso ? 'Sigiloso' : brl(i.valor_unitario_estimado)),
      h('td', { class: 'num', title: 'Valor total estimado do item no edital (quantidade × valor unitário)' }, i.orcamento_sigiloso ? 'Sigiloso' : totalEdital(i) == null ? naoInformado() : moeda(totalEdital(i))),
      h('td', { class: 'num' }, i.custo_unitario == null ? '—' : brl(i.custo_unitario), i.usada_id ? h('div', { class: 'suave pequeno' }, i.cotacoes.find((c) => c.id === i.usada_id)?.fornecedor_nome) : null,
        i.frete_unitario ? h('div', { class: 'suave pequeno' }, `${brl(i.preco_fornecedor)} + ${brl(i.frete_unitario)} frete`) : null),
      h('td', {}, textoFreteItem(i)),
      h('td', { class: 'num' }, pct(i.margem_estimado_pct)),
      h('td', { class: 'num' }, i.preco_minimo == null ? '—' : brl(i.preco_minimo)),
      h('td', { class: 'num' }, i.preco_minimo_total == null ? '—' : moeda(i.preco_minimo_total)),
      h('td', {}, h('span', { class: `etiqueta ${cor}` }, rot),
        esperando.length ? h('div', { class: 'suave pequeno' }, `aguardando: ${esperando.map((p) => p.fornecedor_nome).join(', ')}`) : null));
  };

  const diasDesde = (iso) => Math.max(0, Math.floor((Date.now() - new Date(String(iso).replace(' ', 'T') + 'Z')) / 86400000));
  // Respostas recebidas pelo link: data e hora de cada envio e o comprovante mandado ao fornecedor
  const COMPROVANTE = { enviado: ['✓ comprovante enviado', 'verde'], pendente: ['enviando comprovante…', ''], erro: ['falha no envio do comprovante', 'vermelha'],
    sem_email: ['sem e-mail: comprovante não enviado', ''], sem_smtp: ['e-mail do sistema não configurado', 'amarela'] };
  const reenviar = async (r) => {
    const email = prompt('Enviar o comprovante (PDF) para qual e-mail?', r.email || '');
    if (email == null) return;
    try { const x = await api(`/kanban/${id}/recebimentos/${r.id}/reenviar`, { metodo: 'POST', corpo: { email } });
      toast(x.status === 'enviado' ? 'Comprovante enviado.' : x.status === 'sem_smtp' ? 'E-mail do sistema não configurado (BREVO_API_KEY).' : `Não enviado: ${x.erro || x.status}`, 6000); recarregar(); }
    catch (e) { toast(e.message, 5000); }
  };
  const blocoRecebimentos = !d.recebimentos?.length ? null : h('div', { class: 'cartao', style: { marginTop: '14px' } },
    h('h2', {}, `Recebidas pelo link (${d.recebimentos.length})`),
    h('ul', { class: 'lista-pedidos' }, d.recebimentos.map((r) => {
      const [rot, cor] = COMPROVANTE[r.comprovante_status] || [r.comprovante_status, ''];
      return h('li', {},
        h('strong', {}, dataUtc(r.recebido_em)), ' · ', h('strong', {}, r.fornecedor_nome), ` · ${r.itens} item(ns)`,
        r.respondente ? h('span', { class: 'suave' }, ` · por ${r.respondente}`) : '', ' ',
        h('span', { class: `etiqueta ${cor} pequena`, title: r.email ? `Para ${r.email}${r.comprovante_em ? ` em ${dataUtc(r.comprovante_em)}` : ''}` : '' }, rot), ' ',
        h('a', { class: 'btn pequeno', href: `/api/kanban/${id}/recebimentos/${r.id}/pdf`, target: '_blank', rel: 'noopener' }, '📄 Comprovante'),
        editar && r.comprovante_status !== 'enviado' ? [' ', h('button', { class: 'btn pequeno', onclick: () => reenviar(r) }, r.email ? 'Reenviar' : 'Enviar por e-mail')] : null);
    })));
  const blocoPedidos = !d.pedidos.length ? null : h('div', { class: 'cartao', style: { marginTop: '14px' } },
    h('h2', {}, `Aguardando retorno do fornecedor (${aguardando.length})`),
    aguardando.length ? h('ul', { class: 'lista-pedidos' }, aguardando.map((p) => {
      const dias = diasDesde(p.enviado_em);
      return h('li', {},
        h('span', { class: 'etiqueta amarela pequena' }, '⏳ Aguardando retorno do fornecedor'), ' ',
        h('strong', {}, p.fornecedor_nome), ` · itens ${p.itens.join(', ')} · pedido por ${CANAIS[p.canal] || p.canal} em ${dataUtc(p.enviado_em)}`,
        h('span', { class: dias >= 3 ? 'texto-perigo' : 'suave' }, ` · ${dias === 0 ? 'hoje' : `há ${dias} dia(s)`}`),
        p.usuario_nome ? h('span', { class: 'suave' }, ` · ${p.usuario_nome}`) : '',
        (() => { const l = d.links.find((x) => x.fornecedor_id === p.fornecedor_id && !x.revogado); return l ? h('span', { class: 'suave' }, l.ultimo_acesso ? ` · 🔗 abriu o link em ${dataUtc(l.ultimo_acesso)}` : ' · 🔗 link ainda não aberto') : ''; })(),
        editar ? [' ', h('button', { class: 'btn pequeno', onclick: () => registrarResposta(d, recarregar, p.fornecedor_id) }, 'Registrar resposta'),
          ' ', h('button', { class: 'btn pequeno', title: 'O fornecedor não respondeu: tira da lista de espera', onclick: async () => {
            try { await api(`/kanban/${id}/pedidos/${p.id}`, { metodo: 'PATCH', corpo: { status: 'sem_retorno' } }); recarregar(); } catch (e) { toast(e.message); } } }, 'Sem retorno')] : null);
    })) : h('p', { class: 'suave pequeno' }, 'Nenhum pedido aguardando resposta.'),
    d.pedidos.length > aguardando.length ? h('details', { class: 'pequeno' }, h('summary', {}, 'Pedidos anteriores'),
      h('ul', {}, d.pedidos.filter((p) => p.status !== 'aguardando').map((p) => h('li', {},
        `${p.fornecedor_nome} · itens ${p.itens.join(', ')} · ${CANAIS[p.canal] || p.canal} em ${dataUtc(p.enviado_em)} · `,
        p.status === 'respondido' ? `respondido em ${dataUtc(p.respondido_em)}` : 'sem retorno',
        editar && p.status === 'sem_retorno' ? [' ', h('button', { class: 'btn pequeno', onclick: async () => {
          try { await api(`/kanban/${id}/pedidos/${p.id}`, { metodo: 'PATCH', corpo: { status: 'aguardando' } }); recarregar(); } catch (e) { toast(e.message); } } }, 'Voltar a aguardar')] : null)))) : null);

  const semItens = !d.itens.length;
  render(alvo,
    h('button', { class: 'btn pequeno', onclick: () => history.back() }, '← Voltar'),
    cabecalho('Cotações', [op.cliente_nome ? `🏢 ${op.cliente_nome} · ` : '', (op.objeto || '').slice(0, 160)].join(''),
      h('a', { class: 'btn', href: `#/licitacao/${op.licitacao_id}` }, 'Abrir licitação'),
      !semItens ? h('button', { class: 'btn', onclick: () => imprimirCotacoes(d, est) }, '🖨 Imprimir / PDF') : null,
      !semItens ? h('a', { class: 'btn primario', href: `#/proposta/${op.id}`, title: 'Proposta de preços com os preços desta cotação' }, '📝 Montar proposta') : null,
      editar && !semItens ? h('button', { class: 'btn', onclick: () => pedirCotacao(d, null, recarregar, est) }, '✉ Pedir cotação') : null,
      editar && !semItens ? h('button', { class: 'btn primario', onclick: () => registrarResposta(d, recarregar) }, '+ Registrar resposta') : null),
    h('div', { class: 'suave pequeno', style: { marginBottom: '10px' } }, [op.orgao_nome, op.municipio && `${op.municipio}/${op.uf}`, op.data_encerramento_proposta && `propostas até ${data(op.data_encerramento_proposta)}`].filter(Boolean).join(' · ')),
    semItens ? h('div', { class: 'aviso amarelo' }, op.detalhes_sincronizados_em ? 'A fonte não informou itens para esta licitação. Sem itens não há como cotar por item.' : 'Os itens desta licitação ainda não foram baixados do PNCP. ',
      !op.detalhes_sincronizados_em && editar ? h('button', { class: 'btn pequeno', onclick: async (e) => { e.target.disabled = true; try { const x = await api(`/licitacoes/${op.licitacao_id}/atualizar`, { metodo: 'POST', corpo: {} }); toast(x.ok ? `${x.itens} itens baixados.` : x.mensagem, 5000); recarregar(); } catch (er) { toast(er.message, 6000); e.target.disabled = false; } } }, '↻ Baixar itens agora') : null) : null,
    !d.fornecedores.length ? h('div', { class: 'aviso azul' }, 'Nenhum fornecedor ativo cadastrado. ', h('a', { href: '#/fornecedores' }, 'Cadastre em Fornecedores'), ' e informe os produtos que ele vende para ver sugestões aqui.') : null,
    semItens ? null : resumo,
    // Margem desejada não cabe no estimado: diz quanto falta e qual a margem máxima pelo teto
    !semItens && r.cotados === r.itens && r.preco_minimo_total != null && r.estimado_cotados != null && r.itens_com_ref === r.cotados && d.parametros.margem_pct != null && r.preco_minimo_total > r.estimado_cotados
      ? h('div', { class: 'aviso amarelo', style: { marginTop: '10px' } },
        h('strong', {}, `A margem desejada de ${pct(d.parametros.margem_pct)} não cabe no valor estimado. `),
        `Para ter essa margem, o preço mínimo de venda seria ${moeda(r.preco_minimo_total)}, ${moeda(r.preco_minimo_total - r.estimado_cotados)} acima do estimado (${moeda(r.estimado_cotados)}). `,
        `Vendendo pelo estimado, a margem líquida máxima é ${pct(margemGeral)}. Para melhorar: negociar o custo com o fornecedor ou aceitar margem menor.`) : null,
    // Margem desejada cabe: mostra a faixa de preço em que dá para disputar
    !semItens && r.cotados === r.itens && r.preco_minimo_total != null && r.estimado_cotados != null && r.itens_com_ref === r.cotados && d.parametros.margem_pct != null && r.preco_minimo_total <= r.estimado_cotados
      ? h('div', { class: 'aviso azul', style: { marginTop: '10px' } },
        h('strong', {}, `Faixa para disputar: de ${moeda(r.preco_minimo_total)} a ${moeda(r.estimado_cotados)}. `),
        `No preço mínimo de venda sobra a margem desejada (${pct(d.parametros.margem_pct)}); no valor estimado (o teto) sobra ${pct(margemGeral)}. Abaixo de ${moeda(r.preco_minimo_total)} a margem fica menor que a desejada.`) : null,
    !semItens && r.fretes_pendentes ? h('div', { class: 'aviso amarelo', style: { marginTop: '10px' } }, `${r.fretes_pendentes} item(ns) com frete FOB sem valor: o custo e o preço mínimo deles ainda não incluem o frete. Informe o valor em "Registrar resposta" do fornecedor.`) : null,
    semItens ? null : blocoPedidos,
    semItens ? null : blocoRecebimentos,
    semItens ? null : h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, `Itens (${d.itens.length})`),
      h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-cotacao' },
        h('thead', {}, h('tr', {}, ['Nº', 'Descrição', 'Qtd.', 'Valor do edital (unit.)', 'Valor do edital (total do item)', 'Custo (unit.)', 'Frete', 'Margem líquida no estimado', 'Preço mínimo de venda (unit.)', 'Preço mínimo de venda (total)', 'Situação'].map((t) => h('th', {}, t)))),
        h('tbody', {}, d.itens.map(linhaItem))))),
    semItens ? null : h('div', { style: { marginTop: '14px' } }, parametros),
    semItens || !d.fornecedores.some((f) => f.combina.length) ? null : h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Fornecedores que combinam com os itens'),
      h('ul', {}, d.fornecedores.filter((f) => f.combina.length).map((f) => h('li', {}, h('strong', {}, nomeF(f)), ` · itens ${f.combina.join(', ')}`,
        editar ? [' ', h('button', { class: 'btn pequeno', onclick: () => pedirCotacao({ ...d, fornecedores: [f, ...d.fornecedores.filter((x) => x !== f)] }, f.combina, recarregar, est) }, 'Pedir cotação'),
          ' ', h('button', { class: 'btn pequeno', onclick: () => registrarResposta(d, recarregar, f.id) }, 'Registrar resposta')] : null)))),
    semItens || !editar || r.preco_minimo_total == null || r.cotados < r.itens ? null : h('div', { class: 'aviso azul', style: { marginTop: '14px' } },
      `Todos os itens cotados. Preço mínimo de venda total: ${moeda(r.preco_minimo_total)}${op.valor_proposta != null ? ` (valor da proposta no card hoje: ${moeda(op.valor_proposta)})` : ''}. `,
      h('button', { class: 'btn pequeno', onclick: async () => {
        if (!confirmar(`Gravar ${moeda(r.preco_minimo_total)} como "Valor da proposta" no card do Kanban? Você pode mudar depois.`)) return;
        try { await api(`/kanban/${id}`, { metodo: 'PATCH', corpo: { valor_proposta: r.preco_minimo_total } }); toast('Valor da proposta gravado no card.'); recarregar(); } catch (e) { toast(e.message); }
      } }, 'Usar como valor da proposta')));
}

// ---------- Cotações em aberto (todas as oportunidades) ----------
// Lembrete ao fornecedor: também sem nenhum dado da licitação
export const mensagemCobranca = (p) => [`Olá${p.contato_nome ? `, ${p.contato_nome}` : ''}! Tudo bem?`, '',
  `Passando para lembrar do pedido de cotação que enviamos em ${dataUtc(p.enviado_em).slice(0, 10)}${p.cliente_nome ? ` (${p.cliente_nome})` : ''}${p.link_revogado === 0 ? ', com o link para responder' : ''}.`,
  'Consegue nos retornar? Se precisar de alguma informação, é só falar.', '', 'Obrigado!'].join('\n');

const SITUACAO_PEDIDO = {
  aguardando: ['⏳ Aguardando retorno', 'amarela'], sem_retorno: ['Sem retorno', 'vermelha'], respondido: ['✓ Respondido', 'verde'],
};

export async function cotacoes(alvo, rota, est) {
  render(alvo, carregando());
  const status = rota.query.get('status') || 'aguardando';
  const d = await api(`/cotacoes/pedidos${qs({ status })}`);
  const recarregar = () => cotacoes(alvo, rota, est);
  const editar = podeEditar(est);
  const diasDesde = (iso) => Math.max(0, Math.floor((Date.now() - new Date(String(iso).replace(' ', 'T') + 'Z')) / 86400000));
  const total = d.contagem.aguardando + d.contagem.sem_retorno + d.contagem.respondido;
  const aba = (v, rot, n) => h('a', { class: `btn pequeno ${status === v ? 'primario' : ''}`, href: `#/cotacoes${qs({ status: v })}` }, `${rot}${n != null ? ` (${n})` : ''}`);
  // Prazo das propostas: vermelho quando já encerrou ou faltam 2 dias ou menos
  const prazo = (p) => {
    if (!p.data_encerramento_proposta) return h('span', { class: 'suave' }, 'Encerramento das propostas: não informado');
    const falta = (Date.parse(`${String(p.data_encerramento_proposta).replace(' ', 'T').slice(0, 19)}-03:00`) - Date.now()) / 86400000;
    const txt = `Propostas até ${data(p.data_encerramento_proposta)}`;
    return h('span', { class: falta < 0 ? 'texto-perigo' : falta <= 2 ? 'texto-perigo' : 'suave' }, falta < 0 ? `${txt} (encerrado)` : falta <= 2 ? `${txt} (faltam ${Math.max(0, Math.ceil(falta))} dia(s))` : txt);
  };
  const cobranca = mensagemCobranca;
  const mudar = async (p, novo) => {
    try { await api(`/kanban/${p.oportunidade_id}/pedidos/${p.id}`, { metodo: 'PATCH', corpo: { status: novo } }); recarregar(); } catch (e) { toast(e.message, 5000); }
  };
  const cartao = (p) => {
    const [rot, cor] = SITUACAO_PEDIDO[p.status] || [p.status, ''];
    const dias = diasDesde(p.enviado_em);
    const w = p.status === 'aguardando' ? zap(p.whatsapp || p.telefone, cobranca(p)) : null;
    return h('div', { class: 'cartao pedido-cotacao' },
      h('div', { class: 'linha', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', {}, h('span', { class: `etiqueta ${cor} pequena` }, rot), ' ', h('strong', {}, p.fornecedor_nome)),
        h('span', { class: 'etiqueta empresa' }, `🏢 ${p.cliente_nome || 'Sem empresa'}`)),
      h('div', { class: 'pequeno', style: { marginTop: '6px' } },
        h('a', { href: `#/licitacao/${p.licitacao_id}` }, [numeroLic(p), p.orgao_nome].filter(Boolean).join(' · ') || 'Licitação'),
        [p.municipio, p.uf].filter(Boolean).length ? h('span', { class: 'suave' }, ` · ${[p.municipio, p.uf].filter(Boolean).join('/')}`) : ''),
      p.objeto ? h('div', { class: 'suave pequeno objeto-curto' }, p.objeto.length > 160 ? `${p.objeto.slice(0, 160)}…` : p.objeto) : null,
      h('div', { class: 'pequeno', style: { marginTop: '6px' } },
        `Itens ${p.itens.join(', ')}${p.itens_licitacao ? ` de ${p.itens_licitacao}` : ''} · pedido por ${CANAIS[p.canal] || p.canal} em ${dataUtc(p.enviado_em)}`,
        p.status === 'aguardando' ? h('span', { class: dias >= 3 ? 'texto-perigo' : 'suave' }, ` · ${dias === 0 ? 'hoje' : `há ${dias} dia(s) sem resposta`}`) : '',
        p.status === 'respondido' && p.respondido_em ? h('span', { class: 'suave' }, ` · respondeu em ${dataUtc(p.respondido_em)}`) : '',
        p.usuario_nome ? h('span', { class: 'suave' }, ` · ${p.usuario_nome}`) : ''),
      h('div', { class: 'pequeno' }, prazo(p),
        p.link_revogado === 0 ? h('span', { class: 'suave' }, p.link_respondido ? ` · 🔗 respondeu pelo link em ${dataUtc(p.link_respondido)}`
          : p.link_acesso ? ` · 🔗 abriu o link em ${dataUtc(p.link_acesso)}` : ' · 🔗 link ainda não aberto') : ''),
      h('div', { class: 'linha', style: { marginTop: '10px' } },
        h('a', { class: 'btn pequeno primario', href: `#/cotacao/${p.oportunidade_id}` }, '💲 Abrir cotação'),
        w ? h('a', { class: 'btn pequeno', href: w, target: '_blank', rel: 'noopener noreferrer', title: 'Lembrete sem dados da licitação' }, '🟢 Cobrar no WhatsApp ↗') : null,
        p.status === 'aguardando' && p.email ? h('a', { class: 'btn pequeno', href: `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(['Pedido de cotação', p.cliente_nome].filter(Boolean).join(' – '))}&body=${encodeURIComponent(cobranca(p))}` }, '✉ Cobrar por e-mail ↗') : null,
        editar && p.status === 'aguardando' ? h('button', { class: 'btn pequeno', title: 'O fornecedor não respondeu: tira da lista de espera', onclick: () => mudar(p, 'sem_retorno') }, 'Sem retorno') : null,
        editar && p.status === 'sem_retorno' ? h('button', { class: 'btn pequeno', onclick: () => mudar(p, 'aguardando') }, 'Voltar a aguardar') : null));
  };
  const vazioTxt = { aguardando: 'Nenhum pedido aguardando retorno. Os pedidos aparecem aqui quando você usa "Pedir cotação" numa oportunidade e confirma o envio.',
    sem_retorno: 'Nenhum pedido marcado como sem retorno.', respondido: 'Nenhum pedido respondido ainda.', todos: 'Nenhum pedido de cotação enviado ainda.' }[status] || 'Nada aqui.';
  render(alvo,
    cabecalho('Cotações', 'Pedidos de cotação enviados aos fornecedores, de todas as oportunidades. Os que aguardam retorno vêm primeiro, pelo prazo das propostas mais próximo.'),
    h('div', { class: 'linha', style: { margin: '0 0 12px' } },
      aba('aguardando', 'Aguardando retorno', d.contagem.aguardando), aba('sem_retorno', 'Sem retorno', d.contagem.sem_retorno),
      aba('respondido', 'Respondidos', d.contagem.respondido), aba('todos', 'Todos', total)),
    d.pedidos.length ? h('div', { class: 'lista-pedidos-cotacao' }, d.pedidos.map(cartao)) : vazio(vazioTxt));
}
