// Minha Empresa e Captação: cadastro de quem presta o serviço, captação de empresas assessoradas em 5 passos
// (empresa, Minha Empresa, documentos, dados, pré-visualização), histórico e ações de cada documento
// (PDF, impressão, e-mail, assinatura gov.br assistida e anexo do assinado).
import { api, qs } from './api.js';
import { h, toast, carregando, vazio, confirmar, modal, render, dataUtc } from './ui.js';
import { editorSocios } from './socios.js';

const papel = (e) => e.usuario.papel;
const podeEditar = (e) => papel(e) !== 'leitor';
const podeGerirMe = (e) => ['gestor', 'admin', 'superadmin'].includes(papel(e));
const dig = (v) => String(v ?? '').replace(/\D/g, '');
export const fmtDoc = (v) => { const d = dig(v); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : String(v ?? ''); };
const fmtTel = (v) => { const d = dig(v).replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : String(v ?? ''); };
const nomeCli = (c) => c?.nome_fantasia || c?.razao_social || '';
const TITULO_TIPO = { proposta: 'Proposta', contrato: 'Contrato', procuracao: 'Procuração — Representação em Licitações e Contratações Públicas' };
const COR_STATUS = { rascunho: '', gerado: 'azul', enviado: 'azul', aguardando_aceite: 'amarela', aguardando_assinatura: 'amarela', assinado: 'verde', cancelado: 'vermelha' };
const COR_GERAL = { em_preparacao: '', cadastro_incompleto: 'vermelha', concluido: 'verde', cancelado: 'vermelha', aguardando_aceite: 'amarela', aguardando_assinatura: 'amarela' };
let META = null;
const meta = async () => (META ||= await api('/captacao/meta'));

function cabecalho(titulo, subtitulo, ...acoes) {
  return h('div', { class: 'cabecalho-pagina' },
    h('div', {}, h('h1', {}, titulo), subtitulo ? h('div', { class: 'suave' }, subtitulo) : null),
    h('div', { class: 'linha' }, ...acoes));
}
const campoTexto = (rot, el, { largo = false, ajuda } = {}) => h('div', { class: largo ? 'largo' : '' }, h('label', {}, rot, el), ajuda ? h('div', { class: 'suave pequeno' }, ajuda) : null);

// =====================================================================================
// Minha Empresa
// =====================================================================================
export async function minhaEmpresa(alvo, rota, est) {
  render(alvo, carregando());
  const { empresas } = await api('/minhas-empresas?todas=1');
  const voltar = rota.query.get('voltar');
  const editar = rota.args[0] === 'nova' ? {} : rota.args[0] ? empresas.find((m) => String(m.id) === rota.args[0]) : null;
  if (editar) return formMinhaEmpresa(alvo, est, editar, voltar);
  render(alvo,
    cabecalho('Minha Empresa', 'Quem presta o serviço: aparece no cabeçalho, nas partes e no rodapé das propostas, contratos e procurações.',
      podeGerirMe(est) ? h('a', { class: 'btn primario', href: `#/minha-empresa/nova${voltar ? `?voltar=${encodeURIComponent(voltar)}` : ''}` }, '+ Cadastrar') : null),
    !podeGerirMe(est) ? h('div', { class: 'aviso azul' }, 'Só gestor ou administrador altera este cadastro. Dados bancários e documentos pessoais ficam ocultos para quem só consulta.') : null,
    empresas.length ? h('div', { class: 'grade-empresas' }, empresas.map((m) => h('div', { class: `cartao empresa ${m.ativo ? '' : 'inativa'}` },
      h('div', { class: 'linha', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', {}, h('strong', {}, m.nome_fantasia || m.nome),
          h('div', { class: 'suave pequeno' }, `${m.tipo_pessoa === 'PF' ? 'Pessoa física · CPF' : 'Pessoa jurídica · CNPJ'} ${fmtDoc(m.documento)}`, m.ativo ? '' : ' · arquivada')),
        m.tem_logo ? h('img', { class: 'logo-mini', src: `/api/minhas-empresas/${m.id}/logo?v=${encodeURIComponent(m.atualizado_em)}`, alt: 'Logo' }) : h('span', { class: 'etiqueta' }, 'Sem logo')),
      h('div', { class: 'pequeno', style: { marginTop: '6px' } }, [m.municipio && `${m.municipio}/${m.uf}`, fmtTel(m.telefone), m.email].filter(Boolean).join(' · ')),
      h('div', { class: 'linha', style: { marginTop: '8px' } },
        m.tem_banco ? h('span', { class: 'etiqueta verde' }, 'Dados bancários cadastrados') : h('span', { class: 'etiqueta' }, 'Sem dados bancários')),
      podeGerirMe(est) ? h('div', { class: 'linha', style: { marginTop: '10px' } }, h('a', { class: 'btn pequeno', href: `#/minha-empresa/${m.id}` }, 'Editar')) : null)))
      : vazio('Nenhuma Minha Empresa cadastrada. Cadastre antes de gerar propostas, contratos e procurações.'));
}

function formMinhaEmpresa(alvo, est, m, voltar) {
  const novo = !m.id;
  const c = {};
  const inp = (k, rot, attrs = {}, op = {}) => { c[k] = h('input', { value: m[k] ?? '', ...attrs }); return campoTexto(rot, c[k], op); };
  c.tipo_pessoa = h('select', { onchange: () => alternar() }, h('option', { value: 'PJ', selected: m.tipo_pessoa !== 'PF' }, 'Pessoa jurídica (CNPJ)'), h('option', { value: 'PF', selected: m.tipo_pessoa === 'PF' }, 'Pessoa física (CPF)'));
  c.tipo_conta = h('select', {}, [['', 'Escolha'], ['corrente', 'Conta corrente'], ['poupanca', 'Poupança'], ['pagamento', 'Conta de pagamento']].map(([v, t]) => h('option', { value: v, selected: (m.tipo_conta || '') === v }, t)));
  const so = (cls, ...n) => h('div', { class: `filtros ${cls}` }, ...n);
  const rotNome = h('span', {}); const rotDoc = h('span', {});
  const blocoPJ = h('div', {});
  const alternar = () => {
    const pf = c.tipo_pessoa.value === 'PF';
    rotNome.textContent = pf ? 'Nome completo *' : 'Razão social *';
    rotDoc.textContent = pf ? 'CPF *' : 'CNPJ *';
    blocoPJ.querySelectorAll('.so-pj').forEach((el) => { el.style.display = pf ? 'none' : ''; });
    tituloRep.textContent = pf ? 'Dados pessoais (aparecem como outorgado na procuração)' : 'Representante legal';
  };
  const tituloRep = h('h3', {});
  c.nome = h('input', { value: m.nome ?? '' }); c.documento = h('input', { value: m.documento ? fmtDoc(m.documento) : '', inputmode: 'numeric' });
  const erro = h('div', { class: 'aviso vermelho', style: { display: 'none' } });
  // Logo: convertida em JPEG no navegador (fundo branco), até 800 x 400 px
  const previaLogo = h('div', { class: 'logo-previa' });
  const mostrarLogo = (url) => render(previaLogo, url ? h('img', { src: url, alt: 'Logo' }) : h('span', { class: 'suave pequeno' }, 'Sem logo'));
  mostrarLogo(m.tem_logo ? `/api/minhas-empresas/${m.id}/logo?v=${Date.now()}` : null);
  const arquivoLogo = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (novo) { toast('Salve o cadastro primeiro; depois envie a logo.', 5000); e.target.value = ''; return; }
    try {
      const blob = await paraJpeg(f);
      const fd = new FormData(); fd.append('arquivo', blob, 'logo.jpg');
      await api(`/minhas-empresas/${m.id}/logo`, { metodo: 'POST', corpo: fd });
      mostrarLogo(`/api/minhas-empresas/${m.id}/logo?v=${Date.now()}`); toast('Logo salva.');
    } catch (er) { toast(er.message, 6000); }
    e.target.value = '';
  } });
  const form = h('form', { class: 'cartao form-captacao', onsubmit: async (e) => {
    e.preventDefault();
    const corpo = Object.fromEntries(Object.entries(c).map(([k, el]) => [k, el.value.trim()]));
    erro.style.display = 'none';
    try {
      const r = novo ? await api('/minhas-empresas', { metodo: 'POST', corpo }) : await api(`/minhas-empresas/${m.id}`, { metodo: 'PATCH', corpo });
      toast('Minha Empresa salva.');
      location.hash = voltar ? `#/${voltar}` : novo ? `#/minha-empresa/${r.id}` : '#/minha-empresa';
    } catch (er) { erro.textContent = er.message; erro.style.display = 'block'; erro.scrollIntoView({ block: 'center' }); }
  } },
  h('h3', {}, 'Identificação'),
  so('', campoTexto('Tipo *', c.tipo_pessoa), h('div', {}, h('label', {}, rotDoc, c.documento)), h('div', { class: 'largo' }, h('label', {}, rotNome, c.nome)),
    inp('nome_fantasia', 'Nome fantasia / como aparece no cabeçalho'), inp('ie', 'Inscrição estadual'), inp('im', 'Inscrição municipal')),
  h('h3', {}, 'Endereço'),
  so('', inp('endereco', 'Endereço (rua, número, complemento) *', {}, { largo: true }), inp('bairro', 'Bairro'), inp('municipio', 'Cidade *', { placeholder: 'Vila Velha' }),
    inp('uf', 'UF *', { maxlength: 2, placeholder: 'ES' }), inp('cep', 'CEP', { inputmode: 'numeric', placeholder: '29100-000' })),
  blocoPJ,
  h('h3', {}, 'Contato e logo'),
  so('', inp('telefone', 'Telefone / WhatsApp *', { type: 'tel' }), inp('email', 'E-mail principal *', { type: 'email' }),
    inp('email_documentos', 'E-mail para documentos', { type: 'email' }, { ajuda: 'Usado para receber de volta os documentos assinados (responder para).' })),
  h('div', { class: 'linha', style: { alignItems: 'center', gap: '12px', margin: '6px 0 14px' } }, previaLogo,
    h('label', { class: 'btn' }, novo ? 'Enviar logo (salve antes)' : 'Enviar / trocar logo', arquivoLogo),
    !novo ? h('button', { type: 'button', class: 'btn', onclick: async () => {
      if (!confirmar('Remover a logo? Os PDFs já gerados não mudam.')) return;
      try { await api(`/minhas-empresas/${m.id}/logo`, { metodo: 'DELETE' }); mostrarLogo(null); toast('Logo removida.'); } catch (er) { toast(er.message); }
    } }, 'Remover logo') : null,
    h('span', { class: 'suave pequeno' }, 'PNG ou JPG. Fundo transparente vira branco no PDF.')),
  h('details', { class: 'bloco-banco', open: !!m.banco },
    h('summary', {}, 'Dados bancários (opcional: só saem no documento quando você marcar "incluir dados bancários")'),
    so('', inp('banco', 'Banco', { placeholder: 'ex.: 001 · Banco do Brasil' }), inp('agencia', 'Agência'), inp('conta', 'Conta'), campoTexto('Tipo de conta', c.tipo_conta),
      inp('titular', 'Titular', {}, { largo: true }), inp('titular_documento', 'CPF/CNPJ do titular', { inputmode: 'numeric' }), inp('pix', 'Chave Pix'))),
  erro,
  h('div', { class: 'linha', style: { justifyContent: 'flex-end', marginTop: '14px' } },
    !novo ? h('button', { type: 'button', class: 'btn', onclick: async () => {
      try { await api(`/minhas-empresas/${m.id}`, { metodo: 'PATCH', corpo: { ativo: !m.ativo } }); toast(m.ativo ? 'Arquivada.' : 'Reativada.'); location.hash = '#/minha-empresa'; } catch (er) { toast(er.message); }
    } }, m.ativo ? 'Arquivar' : 'Reativar') : null,
    h('a', { class: 'btn', href: voltar ? `#/${voltar}` : '#/minha-empresa' }, 'Cancelar'),
    h('button', { class: 'btn primario', type: 'submit' }, 'Salvar')));
  render(blocoPJ, tituloRep,
    so('', inp('representante_nome', 'Nome do representante *', {}, { largo: true }), inp('representante_cpf', 'CPF do representante *', { inputmode: 'numeric', value: m.representante_cpf && m.representante_cpf !== '***' ? fmtDoc(m.representante_cpf) : '' }),
      inp('representante_cargo', 'Cargo', { placeholder: 'Sócio-administrador' })),
    so('', inp('representante_rg', 'RG e órgão'), inp('representante_nacionalidade', 'Nacionalidade'), inp('representante_estado_civil', 'Estado civil'), inp('representante_profissao', 'Profissão')),
    h('div', { class: 'suave pequeno', style: { marginBottom: '10px' } }, 'RG, nacionalidade, estado civil e profissão são opcionais; quando preenchidos, entram na qualificação do outorgado da procuração.'));
  // CPF e nome do representante só são obrigatórios para pessoa jurídica
  blocoPJ.querySelector('.filtros').classList.add('so-pj');
  render(alvo, cabecalho(novo ? 'Cadastrar Minha Empresa' : `Editar ${m.nome_fantasia || m.nome}`, 'Campos com * são obrigatórios.'), form);
  alternar();
}

/** Converte a imagem escolhida em JPEG com fundo branco (o PDF desenha JPEG sem precisar de biblioteca). */
function paraJpeg(arquivo) {
  return new Promise((ok, falha) => {
    if (arquivo.size > 8 * 1024 * 1024) return falha(new Error('Imagem maior que 8 MB.'));
    const img = new Image();
    img.onload = () => {
      const esc = Math.min(1, 800 / img.width, 400 / img.height);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * esc)); cv.height = Math.max(1, Math.round(img.height * esc));
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui ler a imagem.'))), 'image/jpeg', 0.9);
    };
    img.onerror = () => falha(new Error('Arquivo de imagem inválido.'));
    // data: em vez de blob: (a política de segurança da página só aceita imagem da própria origem ou data:)
    const leitor = new FileReader();
    leitor.onload = () => { img.src = leitor.result; };
    leitor.onerror = () => falha(new Error('Não consegui ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

// =====================================================================================
// Captação: histórico, detalhe e passos
// =====================================================================================
export async function captacao(alvo, rota, est) {
  const [a, b, c] = rota.args;
  if (a === 'nova') return passo1(alvo, est, null);
  if (a && b === 'passo') return [passo1, passo2, passo3, passo4, passo5][Number(c) - 1]?.(alvo, est, Number(a), rota) ?? detalhe(alvo, est, Number(a));
  if (a) return detalhe(alvo, est, Number(a));
  return historico(alvo, est, rota);
}

async function historico(alvo, est, rota) {
  render(alvo, carregando());
  const m = await meta();
  const f = { q: rota.query.get('q') || '', de: rota.query.get('de') || '', ate: rota.query.get('ate') || '', status: rota.query.get('status') || '', tipo: rota.query.get('tipo') || '' };
  const { captacoes } = await api(`/captacoes${qs(f)}`);
  const el = {
    q: h('input', { type: 'search', value: f.q, placeholder: 'Razão social, fantasia ou CNPJ/CPF' }),
    de: h('input', { type: 'date', value: f.de }), ate: h('input', { type: 'date', value: f.ate }),
    status: h('select', {}, h('option', { value: '' }, 'Todos'), Object.entries(m.status).map(([k, v]) => h('option', { value: k, selected: f.status === k }, v))),
    tipo: h('select', {}, h('option', { value: '' }, 'Todos'), Object.entries(m.tipos).map(([k, v]) => h('option', { value: k, selected: f.tipo === k }, v))),
  };
  const filtrar = (e) => { e?.preventDefault(); location.hash = `#/captacao${qs(Object.fromEntries(Object.entries(el).map(([k, x]) => [k, x.value.trim()])))}`; };
  const temFiltro = Object.values(f).some(Boolean);
  render(alvo,
    cabecalho('Captação', 'Cadastre a empresa, escolha os documentos e acompanhe envio e assinatura.'),
    h('div', { class: 'cartao destaque-nova' },
      h('div', {}, h('h2', {}, 'Nova captação'), h('div', { class: 'suave' }, 'Empresa → Minha Empresa → documentos → dados → pré-visualização.')),
      podeEditar(est) ? h('a', { class: 'btn primario grande', href: '#/captacao/nova' }, '+ Nova Captação') : null),
    h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('h2', {}, 'Histórico'),
      h('form', { class: 'filtros', onsubmit: filtrar },
        campoTexto('Empresa', el.q, { largo: true }), campoTexto('Criada de', el.de), campoTexto('até', el.ate), campoTexto('Status', el.status), campoTexto('Documento', el.tipo),
        h('div', { class: 'linha', style: { alignItems: 'flex-end' } }, h('button', { class: 'btn primario', type: 'submit' }, 'Filtrar'),
          temFiltro ? h('a', { class: 'btn', href: '#/captacao' }, 'Limpar') : null)),
      captacoes.length ? h('div', { class: 'tabela-wrap', style: { marginTop: '12px' } }, h('table', { class: 'tabela-captacoes' },
        h('thead', {}, h('tr', {}, ['Empresa', 'Minha Empresa', 'Criação', 'Documentos', 'Atualização', 'Status', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, captacoes.map((x) => h('tr', {},
          h('td', {}, h('a', { href: `#/captacao/${x.id}`, class: 'objeto' }, nomeCli(x)), h('div', { class: 'suave pequeno' }, fmtDoc(x.cnpj))),
          h('td', {}, x.minha_empresa || h('span', { class: 'nao-info' }, 'Não escolhida')),
          h('td', {}, dataUtc(x.criado_em)),
          h('td', {}, x.documentos.length ? h('div', { class: 'chips-docs' }, x.documentos.map((d) => h('span', { class: `etiqueta ${COR_STATUS[d.status] || ''}`, title: `${m.tipos[d.tipo]} nº ${d.numero}` }, d.rotulo))) : h('span', { class: 'suave' }, 'Nenhum ainda')),
          h('td', {}, dataUtc(x.atualizado_em)),
          h('td', {}, h('span', { class: `etiqueta ${COR_GERAL[x.status] ?? 'azul'}` }, x.status_rotulo)),
          h('td', {}, h('div', { class: 'linha' },
            h('a', { class: 'btn pequeno', href: `#/captacao/${x.id}` }, 'Abrir'),
            x.status !== 'cancelado' && x.status !== 'concluido' && podeEditar(est) ? h('a', { class: 'btn pequeno primario', href: `#/captacao/${x.id}/passo/${proximoPasso(x)}` }, 'Continuar') : null,
            h('a', { class: 'btn pequeno', href: `#/empresas/${x.cliente_id}` }, 'Ver empresa'))))))))
        : vazio(temFiltro ? 'Nenhuma captação com estes filtros.' : 'Nenhuma captação ainda. Clique em "+ Nova Captação".')));
}
const proximoPasso = (x) => (!x.minha_empresa_id ? 2 : !x.documentos.length ? 3 : x.documentos.some((d) => d.status === 'rascunho') ? 4 : 5);

// ---------- Indicador de passos ----------
const PASSOS = ['Empresa', 'Minha Empresa', 'Documentos', 'Dados', 'Pré-visualização'];
function indicador(atual, id) {
  return h('ol', { class: 'passos', 'aria-label': 'Passos da captação' }, PASSOS.map((p, i) => {
    const n = i + 1;
    const cls = n === atual ? 'atual' : n < atual ? 'feito' : '';
    const conteudo = [h('span', { class: 'num' }, n < atual ? '✓' : String(n)), h('span', { class: 'rot' }, p)];
    return h('li', { class: cls, 'aria-current': n === atual ? 'step' : null }, id && n !== atual ? h('a', { href: `#/captacao/${id}/passo/${n}` }, ...conteudo) : conteudo);
  }));
}
const casca = (titulo, atual, id, ...corpo) => [cabecalho(titulo, id ? null : 'Os dados ficam salvos a cada passo: dá para parar e continuar depois pelo Histórico.',
  id ? h('a', { class: 'btn', href: `#/captacao/${id}` }, 'Ver captação') : h('a', { class: 'btn', href: '#/captacao' }, '← Histórico')), indicador(atual, id), ...corpo];

// ---------- Passo 1: empresa ----------
const CAMPOS_EMP = [
  ['razao_social', 'Razão social / nome completo *', { largo: true }], ['nome_fantasia', 'Nome fantasia'],
  ['endereco', 'Endereço (rua, número, bairro)', { largo: true }], ['cep', 'CEP', { inputmode: 'numeric' }], ['municipio', 'Cidade'], ['uf', 'UF', { maxlength: 2 }],
  ['resp_nome', 'Representante legal', { largo: true, pj: true }], ['resp_cpf', 'CPF do representante', { inputmode: 'numeric', pj: true }], ['resp_cargo', 'Cargo', { pj: true }],
  ['telefone', 'Telefone / WhatsApp', { type: 'tel' }], ['email', 'E-mail', { type: 'email' }], ['email_documentos', 'E-mail para documentos', { type: 'email' }],
];

// Bloco "Sócios" do passo 1 (só pessoa jurídica)
const secaoSocios = (ed) => h('div', { class: 'secao-socios' },
  h('h3', {}, 'Sócios'),
  h('p', { class: 'suave pequeno' }, 'A Receita traz nome e qualificação. CPF e se assina sozinho ou em conjunto estão no contrato social: confira lá.'),
  ed.caixa, ed.botao);
// Copia o sócio escolhido para os campos de representante legal (quem assina os documentos)
function usarComoRepresentante(el, sc) {
  if (el.resp_nome) el.resp_nome.value = sc.nome;
  if (el.resp_cpf && sc.cpf) el.resp_cpf.value = fmtDoc(sc.cpf);
  if (el.resp_cargo && sc.qualificacao) el.resp_cargo.value = sc.qualificacao;
  toast(`${sc.nome} é o representante legal. Salve para gravar.`);
}

async function passo1(alvo, est, id) {
  render(alvo, carregando());
  const det = id ? await api(`/captacoes/${id}`) : null;
  if (det) return passo1Existente(alvo, est, det);
  const { clientes } = await api('/clientes');
  let modo = 'nova';
  const caixa = h('div', {});
  const botoesModo = h('div', { class: 'seg-modo', role: 'tablist' });
  const desenharModo = () => {
    render(botoesModo, [['nova', 'Empresa nova'], ['existente', `Já cadastrada (${clientes.length})`]].map(([v, t]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(modo === v), class: `btn ${modo === v ? 'primario' : ''}`, onclick: () => { modo = v; desenharModo(); } }, t)));
    render(caixa, modo === 'nova' ? formNova() : escolherExistente());
  };
  const criarCaptacao = async (clienteId) => {
    const r = await api('/captacoes', { metodo: 'POST', corpo: { cliente_id: clienteId } });
    window.dispatchEvent(new Event('empresas-alteradas'));
    location.hash = `#/captacao/${r.id}/passo/2`;
  };

  function escolherExistente() {
    const busca = h('input', { type: 'search', placeholder: 'Digite razão social, nome fantasia ou CNPJ/CPF', 'aria-label': 'Buscar empresa', autofocus: true });
    const lista = h('ul', { class: 'lista-escolha' });
    const desenhar = () => {
      const t = busca.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); const d = dig(busca.value);
      const achadas = clientes.filter((c) => !t || `${c.razao_social} ${c.nome_fantasia || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t) || (d.length >= 3 && c.cnpj.includes(d))).slice(0, 30);
      render(lista, achadas.length ? achadas.map((c) => h('li', {}, h('button', { type: 'button', class: 'escolha', onclick: async () => { try { await criarCaptacao(c.id); } catch (e) { toast(e.message, 5000); } } },
        h('strong', {}, nomeCli(c)), h('span', { class: 'suave pequeno' }, ` ${c.razao_social !== nomeCli(c) ? `${c.razao_social} · ` : ''}${fmtDoc(c.cnpj)}${c.ativo ? '' : ' · arquivada'}`))))
        : h('li', { class: 'suave' }, 'Nenhuma empresa encontrada. Use "Empresa nova".'));
    };
    busca.addEventListener('input', desenhar); desenhar();
    return h('div', {}, busca, lista);
  }

  function formNova() {
    const el = {};
    const tipo = h('select', { onchange: () => trocarTipo() }, h('option', { value: 'PJ' }, 'Pessoa jurídica (CNPJ)'), h('option', { value: 'PF' }, 'Pessoa física (CPF)'));
    const doc = h('input', { inputmode: 'numeric', placeholder: '00.000.000/0000-00', required: true });
    const rotDoc = h('span', {}, 'CNPJ *');
    el.obs_comerciais = h('textarea', { rows: 2, placeholder: 'Como chegou, interesse, combinados…' });
    const campos = CAMPOS_EMP.map(([k, rot, o = {}]) => { el[k] = h('input', { type: o.type || 'text', inputmode: o.inputmode, maxlength: o.maxlength }); const w = campoTexto(rot, el[k], { largo: o.largo }); if (o.pj) w.classList.add('so-pj'); return w; });
    const socios = editorSocios([], { aoUsar: (sc) => usarComoRepresentante(el, sc) });
    const blocoSocios = secaoSocios(socios);
    const aviso = h('div', {}); const erro = h('div', { class: 'aviso vermelho', style: { display: 'none' } });
    const trocarTipo = () => { const pf = tipo.value === 'PF'; rotDoc.textContent = pf ? 'CPF *' : 'CNPJ *'; doc.placeholder = pf ? '000.000.000-00' : '00.000.000/0000-00'; campos.forEach((w) => { if (w.classList.contains('so-pj')) w.style.display = pf ? 'none' : ''; }); blocoSocios.style.display = pf ? 'none' : ''; };
    const ler = () => ({ tipo_pessoa: tipo.value, documento: dig(doc.value), ...Object.fromEntries(Object.entries(el).map(([k, x]) => [k, x.value.trim()])), socios: tipo.value === 'PJ' ? socios.ler() : [] });
    // Empresa já cadastrada: mostra quem é e o que está diferente, com a opção de atualizar
    const mostrarExistente = (ex) => {
      if (!ex) return render(aviso);
      const marcas = {};
      render(aviso, h('div', { class: 'aviso amarelo' },
        h('strong', {}, `Esta empresa já está cadastrada: ${ex.nome}${ex.ativo ? '' : ' (arquivada)'}.`), ' Não vamos duplicar o cadastro.',
        ex.diferencas.length ? h('div', {}, h('p', { class: 'pequeno' }, 'O que você digitou é diferente do cadastro. Marque o que deve ser atualizado:'),
          h('table', { class: 'tabela-dif' }, h('thead', {}, h('tr', {}, ['', 'Campo', 'No cadastro', 'Digitado'].map((t) => h('th', {}, t)))),
            h('tbody', {}, ex.diferencas.map((d) => h('tr', {}, h('td', {}, marcas[d.campo] = h('input', { type: 'checkbox', 'aria-label': `Atualizar ${d.rotulo}` })),
              h('td', {}, d.rotulo), h('td', {}, d.atual ?? h('span', { class: 'nao-info' }, 'vazio')), h('td', {}, d.novo)))))) : null,
        h('div', { class: 'linha', style: { marginTop: '8px' } },
          h('button', { type: 'button', class: 'btn primario', onclick: async () => {
            try {
              const sel = Object.entries(marcas).filter(([, cb]) => cb.checked).map(([k]) => k);
              if (sel.length) { await api(`/captacoes/empresa/${ex.id}/atualizar`, { metodo: 'POST', corpo: { dados: ler(), campos: sel } }); toast(`Cadastro atualizado: ${sel.length} campo(s).`); }
              await criarCaptacao(ex.id);
            } catch (e) { toast(e.message, 6000); }
          } }, ex.diferencas.length ? 'Usar esta empresa (e atualizar o que marquei)' : 'Usar esta empresa'))));
    };
    const conferir = async () => {
      const d = dig(doc.value);
      if (!((tipo.value === 'PJ' && d.length === 14) || (tipo.value === 'PF' && d.length === 11))) return;
      try { const r = await api('/captacoes/conferir-empresa', { metodo: 'POST', corpo: ler() }); mostrarExistente(r.existente); }
      catch (e) { render(aviso, h('div', { class: 'aviso vermelho' }, e.message)); }
    };
    // Dados públicos da Receita (base aberta do CNPJ) só preenchem campos vazios
    const receita = async () => {
      const d = dig(doc.value); if (tipo.value !== 'PJ' || d.length !== 14) return toast('Digite um CNPJ com 14 números.');
      try {
        const r = await api(`/cnpj/${d}/consulta`);
        const por = (k, v) => { if (v && el[k] && !el[k].value.trim()) el[k].value = v; };
        por('razao_social', r.razao_social); por('nome_fantasia', r.nome_fantasia); por('endereco', r.endereco); por('cep', r.cep); por('municipio', r.municipio);
        por('uf', r.uf); por('telefone', r.telefone); por('email', r.email);
        if (r.responsavel) { por('resp_nome', r.responsavel.nome); por('resp_cargo', r.responsavel.qualificacao); }
        socios.preencherDaReceita(r.socios || []);
        toast(`Preenchido pela base pública da Receita (${r.fonte}). Confira antes de salvar.`, 6000);
      } catch (e) { toast(e.message, 6000); }
    };
    doc.addEventListener('blur', conferir);
    return h('form', { class: 'form-captacao', onsubmit: async (e) => {
      e.preventDefault(); erro.style.display = 'none';
      if (!socios.valido()) { erro.textContent = 'Preencha o nome do sócio (ou remova a linha).'; erro.style.display = 'block'; return; }
      try {
        const r = await api('/captacoes/empresa', { metodo: 'POST', corpo: ler() });
        await criarCaptacao(r.cliente_id);
      } catch (er) {
        if (er.status === 409 && er.dados?.existente) { mostrarExistente(er.dados.existente); aviso.scrollIntoView({ block: 'center' }); return; }
        erro.textContent = er.message; erro.style.display = 'block';
      }
    } },
    h('div', { class: 'filtros' }, campoTexto('Tipo *', tipo),
      h('div', {}, h('label', {}, rotDoc, h('div', { class: 'linha cnpj-linha' }, doc, h('button', { type: 'button', class: 'btn pequeno', title: 'Preencher com a base pública da Receita Federal', onclick: receita }, '🔎 Receita'))))),
    aviso,
    h('div', { class: 'filtros' }, ...campos),
    blocoSocios,
    campoTexto('Observações comerciais', el.obs_comerciais, { largo: true }),
    h('p', { class: 'suave pequeno' }, 'Obrigatórios agora: tipo, CPF/CNPJ, nome e um contato. Endereço e representante podem ficar para depois, mas sem eles a captação fica como "Cadastro incompleto" e os documentos não são gerados.'),
    erro,
    h('div', { class: 'linha', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primario', type: 'submit' }, 'Salvar e continuar →')));
  }

  render(alvo, ...casca('Nova captação', 1, null, h('div', { class: 'cartao' }, h('h2', {}, 'Empresa'), botoesModo, caixa)));
  desenharModo();
}

// Passo 1 de uma captação já criada: mostra a empresa e permite completar o cadastro
function passo1Existente(alvo, est, det) {
  const c = det.cliente; const id = det.captacao.id;
  const el = {};
  const pf = c.tipo_pessoa === 'PF';
  const campos = CAMPOS_EMP.filter(([, , o = {}]) => !(pf && o.pj)).map(([k, rot, o = {}]) => { el[k] = h('input', { type: o.type || 'text', value: k === 'resp_cpf' && c[k] ? fmtDoc(c[k]) : c[k] ?? '', maxlength: o.maxlength }); return campoTexto(rot, el[k], { largo: o.largo }); });
  el.obs_comerciais = h('textarea', { rows: 2 }, c.obs_comerciais || '');
  let lista = [];
  try { lista = c.socios_json ? JSON.parse(c.socios_json) : []; } catch { lista = []; }
  const socios = editorSocios(lista, { aoUsar: (sc) => usarComoRepresentante(el, sc) });
  const erro = h('div', { class: 'aviso vermelho', style: { display: 'none' } });
  render(alvo, ...casca(`Captação: ${nomeCli(c)}`, 1, id,
    h('form', { class: 'cartao form-captacao', onsubmit: async (e) => {
      e.preventDefault(); erro.style.display = 'none';
      const corpo = Object.fromEntries(Object.entries(el).map(([k, x]) => [k, x.value.trim()]));
      if (corpo.resp_cpf) corpo.resp_cpf = dig(corpo.resp_cpf);
      if (corpo.cep) corpo.cep = dig(corpo.cep);
      if (!pf) {
        if (!socios.valido()) { erro.textContent = 'Preencha o nome do sócio (ou remova a linha).'; erro.style.display = 'block'; return; }
        corpo.socios = socios.ler();
      }
      try { await api(`/clientes/${c.id}`, { metodo: 'PATCH', corpo }); toast('Cadastro da empresa atualizado.'); location.hash = `#/captacao/${id}/passo/2`; }
      catch (er) { erro.textContent = er.message; erro.style.display = 'block'; }
    } },
    h('h2', {}, `${pf ? 'CPF' : 'CNPJ'} ${fmtDoc(c.cnpj)}`),
    det.cliente_pendencias.length ? h('div', { class: 'aviso amarelo' }, h('strong', {}, 'Cadastro incompleto para gerar documentos: '), det.cliente_pendencias.map((p) => p.replace('Empresa assessorada: ', '')).join('; '), '.')
      : h('div', { class: 'aviso verde' }, 'Cadastro completo para gerar os documentos.'),
    h('div', { class: 'filtros' }, ...campos), pf ? null : secaoSocios(socios), campoTexto('Observações comerciais', el.obs_comerciais, { largo: true }),
    h('p', { class: 'suave pequeno' }, 'Alterar aqui muda o cadastro central da empresa. Documentos já gerados não mudam (guardam uma cópia dos dados).'),
    erro,
    h('div', { class: 'linha', style: { justifyContent: 'flex-end' } },
      h('a', { class: 'btn', href: `#/captacao/${id}/passo/2` }, 'Continuar sem alterar →'),
      podeEditar(est) ? h('button', { class: 'btn primario', type: 'submit' }, 'Salvar e continuar →') : null))));
}

// ---------- Passo 2: Minha Empresa ----------
async function passo2(alvo, est, id) {
  render(alvo, carregando());
  const [det, { empresas }] = await Promise.all([api(`/captacoes/${id}`), api('/minhas-empresas')]);
  const atual = det.captacao.minha_empresa_id;
  // Só uma cadastrada: escolhe sozinho
  if (!atual && empresas.length === 1 && podeEditar(est)) {
    await api(`/captacoes/${id}`, { metodo: 'PATCH', corpo: { minha_empresa_id: empresas[0].id } });
    toast(`Minha Empresa escolhida: ${empresas[0].nome_fantasia || empresas[0].nome} (é a única cadastrada).`, 4500);
    location.hash = `#/captacao/${id}/passo/3`; return;
  }
  const escolher = async (m) => {
    try { await api(`/captacoes/${id}`, { metodo: 'PATCH', corpo: { minha_empresa_id: m.id } }); location.hash = `#/captacao/${id}/passo/3`; } catch (e) { toast(e.message, 5000); }
  };
  render(alvo, ...casca(`Captação: ${nomeCli(det.cliente)}`, 2, id, h('div', { class: 'cartao' },
    h('h2', {}, 'Qual Minha Empresa presta o serviço?'),
    empresas.length ? h('ul', { class: 'lista-escolha' }, empresas.map((m) => h('li', {}, h('button', { type: 'button', class: `escolha ${m.id === atual ? 'marcada' : ''}`, onclick: () => escolher(m) },
      h('strong', {}, m.nome_fantasia || m.nome), h('span', { class: 'suave pequeno' }, ` ${m.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'} ${fmtDoc(m.documento)}${m.tem_logo ? ' · com logo' : ' · sem logo'}`),
      m.id === atual ? h('span', { class: 'etiqueta verde', style: { marginLeft: '8px' } }, 'Escolhida') : null))))
      : h('div', { class: 'aviso amarelo' }, 'Nenhuma Minha Empresa cadastrada. ',
        podeGerirMe(est) ? h('a', { href: `#/minha-empresa/nova?voltar=${encodeURIComponent(`captacao/${id}/passo/2`)}` }, 'Cadastrar agora') : 'Peça a um gestor para cadastrar.'),
    h('div', { class: 'linha', style: { justifyContent: 'space-between', marginTop: '12px' } },
      h('a', { class: 'btn', href: `#/captacao/${id}/passo/1` }, '← Voltar'),
      atual ? h('a', { class: 'btn primario', href: `#/captacao/${id}/passo/3` }, 'Continuar →') : null))));
}

// ---------- Passo 3: documentos ----------
async function passo3(alvo, est, id) {
  render(alvo, carregando());
  const det = await api(`/captacoes/${id}`);
  const ativos = det.documentos.filter((d) => d.status !== 'cancelado');
  const marcas = {};
  const opcoes = Object.keys(TITULO_TIPO).map((t) => {
    const ja = ativos.filter((d) => d.tipo === t);
    marcas[t] = h('input', { type: 'checkbox', checked: !!ja.length });
    return h('label', { class: 'opcao-doc' }, marcas[t], h('span', {}, h('strong', {}, TITULO_TIPO[t]),
      ja.length ? h('span', { class: 'suave pequeno' }, ` · já existe: ${ja.map((d) => `nº ${d.numero} (${d.rotulo})`).join(', ')}`) : null));
  });
  const continuar = async () => {
    const novos = Object.entries(marcas).filter(([t, cb]) => cb.checked && !ativos.some((d) => d.tipo === t)).map(([t]) => t);
    const extra = Object.entries(marcas).filter(([t, cb]) => cb.checked && ativos.some((d) => d.tipo === t) && outro[t]?.checked).map(([t]) => t);
    const tipos = [...novos, ...extra];
    if (!tipos.length && !ativos.length) return toast('Escolha ao menos um documento.');
    try {
      if (tipos.length) await api(`/captacoes/${id}/documentos`, { metodo: 'POST', corpo: { tipos } });
      location.hash = `#/captacao/${id}/passo/4`;
    } catch (e) { toast(e.message, 5000); }
  };
  // Gerar outro documento do mesmo tipo (ex.: nova proposta com outro valor)
  const outro = {};
  const extras = Object.keys(TITULO_TIPO).filter((t) => ativos.some((d) => d.tipo === t)).map((t) => {
    outro[t] = h('input', { type: 'checkbox' });
    return h('label', { class: 'pequeno', style: { display: 'block' } }, outro[t], ` Criar mais um(a) ${TITULO_TIPO[t].split(' —')[0].toLowerCase()} (número novo)`);
  });
  render(alvo, ...casca(`Captação: ${nomeCli(det.cliente)}`, 3, id, h('div', { class: 'cartao' },
    h('h2', {}, 'Quais documentos gerar?'),
    h('p', { class: 'suave' }, 'Pode escolher mais de um. A representação perante os órgãos é feita só pela procuração, com os poderes que você marcar.'),
    h('div', { class: 'opcoes-doc' }, opcoes),
    extras.length ? h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'pequeno' }, 'Gerar outro documento de um tipo que já existe'), extras) : null,
    h('div', { class: 'linha', style: { justifyContent: 'space-between', marginTop: '12px' } },
      h('a', { class: 'btn', href: `#/captacao/${id}/passo/2` }, '← Voltar'),
      podeEditar(est) ? h('button', { class: 'btn primario', onclick: continuar }, 'Continuar →') : null))));
}

// ---------- Passo 4: dados complementares ----------
async function passo4(alvo, est, id, rota) {
  render(alvo, carregando());
  const det = await api(`/captacoes/${id}`);
  const docs = det.documentos.filter((d) => !['cancelado', 'assinado'].includes(d.status));
  if (!docs.length) { location.hash = `#/captacao/${id}/passo/3`; return; }
  const previas = await Promise.all(docs.map((d) => api(`/captacao-documentos/${d.id}/previa`)));
  const foco = Number(rota?.query.get('doc')) || docs[0].id;
  const formularios = docs.map((d, i) => formDados(d, previas[i]));
  let aba = Math.max(0, docs.findIndex((d) => d.id === foco));
  const abas = h('div', { class: 'abas-doc', role: 'tablist' });
  const corpo = h('div', {});
  const desenharAbas = () => {
    render(abas, docs.map((d, i) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === aba), class: `btn ${i === aba ? 'primario' : ''}`, onclick: () => { aba = i; desenharAbas(); } },
      `${d.tipo_nome} nº ${d.numero}`, formularios[i].sujo() ? ' •' : '')));
    render(corpo, formularios[aba].el);
  };
  const salvarTudo = async () => {
    for (const [i, f] of formularios.entries()) {
      if (!f.sujo()) continue;
      if (docs[i].status !== 'rascunho' && !confirmar(`${docs[i].tipo_nome} nº ${docs[i].numero} já foi gerado. Salvar a alteração cria a versão ${docs[i].versao + 1}; o PDF anterior fica no histórico. Continuar?`)) return false;
      await api(`/captacao-documentos/${docs[i].id}/dados`, { metodo: 'PUT', corpo: f.ler() });
      f.limpo();
    }
    return true;
  };
  const acao = (destino) => async () => {
    try { if (await salvarTudo()) { if (destino) location.hash = destino; else { toast('Rascunho salvo.'); desenharAbas(); } } } catch (e) { toast(e.message, 6000); }
  };
  render(alvo, ...casca(`Captação: ${nomeCli(det.cliente)}`, 4, id, h('div', { class: 'cartao' },
    h('h2', {}, 'Dados dos documentos'),
    h('div', { class: 'aviso azul' }, 'Os textos seguem os seus modelos e não foram revisados por advogado. Revise antes de enviar ao cliente. Valores em branco não entram no documento; campos com * são obrigatórios para gerar o PDF.'),
    abas, corpo,
    h('div', { class: 'linha', style: { justifyContent: 'space-between', marginTop: '14px' } },
      h('button', { class: 'btn', onclick: acao(`#/captacao/${id}/passo/3`) }, '← Voltar'),
      h('div', { class: 'linha' },
        podeEditar(est) ? h('button', { class: 'btn', onclick: acao(null) }, 'Salvar rascunho') : null,
        h('button', { class: 'btn primario', onclick: podeEditar(est) ? acao(`#/captacao/${id}/passo/5`) : () => { location.hash = `#/captacao/${id}/passo/5`; } }, 'Pré-visualizar →'))))));
  desenharAbas();
}

/** Formulário do passo 4 de um documento: campos do modelo + textos editáveis das seções. */
function formDados(doc, pv) {
  const el = {}; let sujo = false;
  const marcarSujo = () => { sujo = true; };
  const dados = pv.dados || {};
  const campo = (c) => {
    const v = dados[c.id];
    const rot = `${c.rotulo}${c.obrig ? ' *' : ''}`;
    if (c.tipo === 'multi') {
      const marcadas = new Set(Array.isArray(v) ? v : []);
      el[c.id] = c.opcoes.map(([k, t]) => ({ k, cb: h('input', { type: 'checkbox', checked: marcadas.has(k), onchange: marcarSujo }), t }));
      return h('fieldset', { class: 'largo multi-campo' }, h('legend', {}, rot), el[c.id].map((o) => h('label', { class: 'opcao' }, o.cb, ` ${o.t}`)),
        c.id === 'poderes' ? h('div', { class: 'suave pequeno' }, 'Nenhum poder vem marcado. Lances, negociação, desistência e assinatura de contratos só valem se marcados aqui.') : null);
    }
    if (c.tipo === 'bool') { el[c.id] = h('input', { type: 'checkbox', checked: !!v, onchange: marcarSujo }); return h('label', { class: 'largo opcao' }, el[c.id], ` ${c.rotulo}`); }
    if (c.tipo === 'sel') { el[c.id] = h('select', { onchange: marcarSujo }, c.opcoes.map(([k, t]) => h('option', { value: k, selected: v === k }, t))); return campoTexto(rot, el[c.id], { ajuda: c.ajuda }); }
    if (c.tipo === 'area') { el[c.id] = h('textarea', { rows: 3, oninput: marcarSujo }, v ?? ''); return campoTexto(rot, el[c.id], { largo: true, ajuda: c.ajuda }); }
    const tipo = c.tipo === 'data' ? 'date' : ['numero', 'pct'].includes(c.tipo) ? 'number' : 'text';
    const valor = c.tipo === 'moeda' && v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : v ?? '';
    el[c.id] = h('input', { type: tipo, value: valor, step: c.tipo === 'pct' ? '0.01' : c.tipo === 'numero' ? '1' : null, min: tipo === 'number' ? '0' : null,
      inputmode: c.tipo === 'moeda' ? 'decimal' : null, placeholder: c.tipo === 'moeda' ? '0,00' : null, oninput: marcarSujo });
    return campoTexto(rot, el[c.id], { largo: c.tipo === 'texto' && /abrang|plataforma|base|endere/.test(c.id), ajuda: c.ajuda });
  };
  // Textos das seções (cláusulas): em branco = texto padrão do modelo
  const textos = {};
  const editaveis = Object.entries(pv.textos_padrao || {});
  const blocoTextos = h('details', { class: 'textos-doc' }, h('summary', {}, `Editar textos das cláusulas (${editaveis.length})`),
    h('p', { class: 'suave pequeno' }, 'Parágrafos separados por linha em branco; linhas começando com "- " viram itens de lista. "Restaurar padrão" volta ao texto do modelo, que acompanha os campos acima.'),
    editaveis.map(([sid, s]) => {
      const editado = typeof dados.textos?.[sid] === 'string';
      textos[sid] = h('textarea', { rows: 4, oninput: marcarSujo }, editado ? dados.textos[sid] : s.texto);
      textos[sid].dataset.padrao = s.texto; textos[sid].dataset.editado = editado ? '1' : '';
      return h('div', { class: 'campo-texto-doc' },
        h('div', { class: 'linha', style: { justifyContent: 'space-between' } }, h('strong', { class: 'pequeno' }, s.titulo || 'Texto', editado ? h('span', { class: 'etiqueta amarela pequena', style: { marginLeft: '6px' } }, 'editado') : null),
          h('button', { type: 'button', class: 'btn pequeno', onclick: () => { textos[sid].value = s.texto; textos[sid].dataset.editado = ''; textos[sid].dataset.restaurado = '1'; marcarSujo(); } }, 'Restaurar padrão')),
        textos[sid]);
    }));
  const campos = (pv.campos || []).map(campo);
  const el2 = h('div', { class: 'form-dados' },
    doc.status !== 'rascunho' ? h('div', { class: 'aviso amarelo' }, `Este documento está como "${doc.rotulo}". Alterar e salvar cria a versão ${doc.versao + 1} (a versão ${doc.versao} fica no histórico).`) : null,
    h('div', { class: 'filtros' }, ...campos), blocoTextos);
  return {
    el: el2, sujo: () => sujo, limpo: () => { sujo = false; },
    ler: () => {
      const out = {};
      for (const c of pv.campos) {
        const x = el[c.id];
        if (c.tipo === 'multi') out[c.id] = x.filter((o) => o.cb.checked).map((o) => o.k);
        else if (c.tipo === 'bool') out[c.id] = x.checked;
        else out[c.id] = x.value.trim();
      }
      // Só guarda o texto que o usuário mudou; o resto continua acompanhando o padrão do modelo
      out.textos = Object.fromEntries(Object.entries(textos).filter(([, t]) => !t.dataset.restaurado && (t.dataset.editado || t.value.trim() !== t.dataset.padrao.trim())).map(([k, t]) => [k, t.value]));
      return out;
    },
  };
}

// ---------- Passo 5: pré-visualização e ações ----------
async function passo5(alvo, est, id, rota) {
  render(alvo, carregando());
  const det = await api(`/captacoes/${id}`);
  const docs = det.documentos.filter((d) => d.status !== 'cancelado');
  if (!docs.length) { location.hash = `#/captacao/${id}/passo/3`; return; }
  const foco = Number(rota?.query.get('doc')) || docs[0].id;
  let aba = Math.max(0, docs.findIndex((d) => d.id === foco));
  const abas = h('div', { class: 'abas-doc', role: 'tablist' });
  const corpo = h('div', {});
  const desenhar = async () => {
    render(abas, docs.map((d, i) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === aba), class: `btn ${i === aba ? 'primario' : ''}`, onclick: () => { aba = i; desenhar(); } },
      `${d.tipo_nome} nº ${d.numero}`, h('span', { class: `etiqueta pequena ${COR_STATUS[d.status] || ''}`, style: { marginLeft: '6px' } }, d.rotulo))));
    const d = docs[aba];
    render(corpo, carregando());
    const pv = await api(`/captacao-documentos/${d.id}/previa`);
    const recarregar = () => passo5(alvo, est, id, { query: new URLSearchParams(`doc=${d.id}`) });
    render(corpo,
      pv.pendencias.length ? h('div', { class: 'aviso vermelho' }, h('strong', {}, 'Falta para gerar o PDF: '), h('ul', {}, pv.pendencias.map((p) => h('li', {}, p))),
        h('a', { class: 'btn pequeno', href: `#/captacao/${id}/passo/${/Empresa assessorada/.test(pv.pendencias.join()) ? 1 : /Minha Empresa/.test(pv.pendencias.join()) && !det.minha_empresa ? 2 : 4}${/Empresa assessorada|Minha Empresa \(passo/.test(pv.pendencias.join()) ? '' : `?doc=${d.id}`}` }, 'Corrigir')) : null,
      barraAcoes(est, det, d, pv, recarregar),
      folha(pv, det.minha_empresa));
  };
  render(alvo, ...casca(`Captação: ${nomeCli(det.cliente)}`, 5, id, h('div', { class: 'cartao' },
    abas, corpo,
    h('div', { class: 'linha', style: { justifyContent: 'space-between', marginTop: '14px' } },
      h('a', { class: 'btn', href: `#/captacao/${id}/passo/4?doc=${docs[aba]?.id}` }, '← Voltar e editar'),
      h('a', { class: 'btn', href: `#/captacao/${id}` }, 'Ver captação e histórico')))));
  desenhar();
}

/** Folha A4 em HTML com as mesmas seções do PDF. */
function folha(pv, me) {
  return h('article', { class: 'folha-doc', 'aria-label': 'Pré-visualização do documento' },
    h('header', {}, me?.tem_logo ? h('img', { src: `/api/minhas-empresas/${me.id}/logo?v=${encodeURIComponent(me.atualizado_em)}`, alt: 'Logo' }) : null,
      h('div', {}, h('strong', {}, me?.nome_fantasia || me?.nome || 'Minha Empresa não escolhida'),
        me ? h('div', { class: 'pequeno suave' }, [`${me.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'} ${fmtDoc(me.documento)}`, [me.endereco, me.municipio && `${me.municipio}/${me.uf}`].filter(Boolean).join(', '), [fmtTel(me.telefone), me.email].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')) : null)),
    h('h2', {}, pv.titulo.toUpperCase()), pv.numero ? h('div', { class: 'num-doc' }, `Nº ${pv.numero}`) : null,
    pv.tipo === 'proposta' && pv.local_data ? h('p', {}, pv.local_data) : null,
    pv.secoes.map((s) => h('section', {}, s.titulo ? h('h3', {}, s.titulo, s.editada ? h('span', { class: 'etiqueta amarela pequena', style: { marginLeft: '6px' } }, 'texto editado') : null) : null,
      s.paragrafos.map((p) => h('p', {}, p)), s.lista.length ? h('ul', {}, s.lista.map((i) => h('li', {}, i))) : null)),
    pv.tipo !== 'proposta' && pv.local_data ? h('p', { style: { marginTop: '18px' } }, pv.local_data) : null,
    h('div', { class: 'assinaturas' }, pv.assinaturas.map((a) => h('div', { class: 'assinatura' }, h('div', { class: 'traco' }), h('strong', {}, a.titulo), a.linhas.map((l) => h('div', { class: 'pequeno suave' }, l))))));
}

// ---------- Ações de um documento ----------
const urlArquivo = (d, { baixar = false, arquivo } = {}) => `/api/captacao-documentos/${d.id}/arquivo${qs({ baixar: baixar ? '1' : '', arquivo })}`;
const temPdf = (d) => d.status !== 'rascunho' && d.status !== 'cancelado';

/** Imprime o PDF gerado: abre num quadro escondido (mesma origem) e chama a impressão do navegador. */
function imprimir(url) {
  const fr = h('iframe', { src: `${url}${url.includes('?') ? '&' : '?'}imprimir=1`, style: { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0' }, title: 'Impressão' });
  fr.onload = () => {
    setTimeout(() => {
      try { fr.contentWindow.focus(); fr.contentWindow.print(); }
      catch { window.open(url, '_blank', 'noopener'); toast('Abri o PDF em outra aba: use o botão de imprimir do visualizador.', 6000); }
    }, 300);
    setTimeout(() => fr.remove(), 120000);
  };
  document.body.append(fr);
}

function barraAcoes(est, det, d, pv, recarregar) {
  const ed = podeEditar(est) && !det.captacao.cancelada_em;
  const gerar = async () => {
    try {
      const r = await api(`/captacao-documentos/${d.id}/gerar`, { metodo: 'POST' });
      toast(r.acima_da_meta ? `PDF gerado com ${r.paginas} páginas (meta: até ${r.meta}). Considere encurtar os textos.` : `PDF gerado (${r.paginas} página(s)).`, 6000);
      recarregar();
    } catch (e) { toast(e.message, 7000); }
  };
  return h('div', { class: 'barra-acoes' },
    h('a', { class: 'btn', href: `/api/captacao-documentos/${d.id}/previa.pdf`, target: '_blank', rel: 'noopener' }, '👁 Visualizar PDF (prévia)'),
    ed && d.status === 'rascunho' ? h('button', { class: 'btn', onclick: () => toast('Rascunho salvo: os dados ficam guardados a cada passo.') }, 'Salvar rascunho') : null,
    ed && d.status === 'rascunho' ? h('button', { class: 'btn primario', disabled: pv.pendencias.length > 0, title: pv.pendencias.length ? 'Preencha o que falta' : 'Gera o PDF final e congela os dados', onclick: gerar }, 'Gerar PDF') : null,
    temPdf(d) ? h('a', { class: 'btn', href: urlArquivo(d, { baixar: true }) }, '⬇ Baixar PDF') : null,
    temPdf(d) ? h('button', { class: 'btn', onclick: () => imprimir(urlArquivo(d)) }, '🖨 Imprimir') : null,
    ed && temPdf(d) ? h('button', { class: 'btn', onclick: () => modalEmail(d, recarregar) }, '✉ Enviar por e-mail') : null,
    ed && temPdf(d) ? h('button', { class: 'btn primario', onclick: () => modalAssinatura(d, recarregar) }, '✍ Enviar para assinatura') : null,
    ed && temPdf(d) ? h('button', { class: 'btn', onclick: () => modalAnexar(d, recarregar) }, '📎 Anexar assinado') : null,
    d.status === 'rascunho' ? h('span', { class: 'suave pequeno' }, 'Gere o PDF para baixar, imprimir, enviar e assinar.') : null);
}

async function modalEmail(d, aoTerminar, { assinatura = false } = {}) {
  let r;
  try { r = await api(`/captacao-documentos/${d.id}/email`); } catch (e) { return toast(e.message); }
  if (!r.email_configurado) {
    return modal('E-mail não configurado', h('div', {}, h('p', {}, 'O servidor não tem provedor de e-mail configurado (BREVO_API_KEY ou SMTP_URL), então o sistema NÃO consegue enviar.'),
      h('p', {}, 'Baixe o PDF e envie pelo seu e-mail ou WhatsApp; depois use "Já enviei por outro meio" na janela de assinatura para registrar.')));
  }
  const para = h('input', { type: 'text', value: r.para, placeholder: 'email@cliente.com.br' });
  const assunto = h('input', { type: 'text', value: r.assunto });
  const msg = h('textarea', { rows: 12 }, r.mensagem);
  const pedir = h('input', { type: 'checkbox', checked: assinatura || r.pedir_assinatura });
  const conferi = h('input', { type: 'checkbox' });
  modal(`Enviar ${d.tipo_nome.toLowerCase()} nº ${d.numero} por e-mail`, h('div', { class: 'form-captacao' },
    campoTexto('Para (até 3, separados por vírgula) *', para, { largo: true }),
    campoTexto('Assunto *', assunto, { largo: true }),
    campoTexto('Mensagem (revise antes de enviar) *', msg, { largo: true }),
    h('p', { class: 'suave pequeno' }, `Vai com o PDF gerado anexado (versão ${d.versao}). As respostas vão para ${r.responder_para || 'o remetente do sistema'}.`),
    h('label', { class: 'opcao' }, pedir, d.tipo === 'proposta' ? ' Pedir aceite (assinatura) do cliente' : ' Pedir assinatura do cliente'),
    h('label', { class: 'opcao destaque-confirma' }, conferi, ' Conferi o destinatário e a mensagem')), [{
    texto: 'Enviar agora', classe: 'primario', acao: async () => {
      if (!conferi.checked) { toast('Marque "Conferi o destinatário e a mensagem".'); return false; }
      try {
        await api(`/captacao-documentos/${d.id}/enviar`, { metodo: 'POST', corpo: { para: para.value, assunto: assunto.value, mensagem: msg.value, pedir_assinatura: pedir.checked, confirmado: true } });
        toast(`E-mail enviado para ${para.value}.`, 5000); aoTerminar?.();
      } catch (e) { toast(e.message, 8000); return false; }
    } }], { fechar: 'Cancelar' });
}

/** Assinatura gov.br assistida: o sistema não assina nem fala com o gov.br; orienta, envia e recebe o arquivo de volta. */
async function modalAssinatura(d, aoTerminar) {
  const m = await meta();
  const fechar = modal(`Assinatura gov.br: ${d.tipo_nome.toLowerCase()} nº ${d.numero}`, h('div', {},
    h('div', { class: 'aviso azul' }, 'Fluxo assistido: o cliente assina no portal oficial do governo com a conta gov.br dele (nível prata ou ouro). ',
      h('strong', {}, 'O LicitPro não envia o documento direto ao gov.br e nunca pede a senha do cliente.')),
    h('ol', { class: 'passos-assinatura' },
      h('li', {}, 'Envie o PDF ao cliente com as instruções (botão abaixo) ou baixe e mande pelo WhatsApp.'),
      h('li', {}, 'O cliente acessa ', h('a', { href: 'https://assinador.iti.br', target: '_blank', rel: 'noopener noreferrer' }, 'assinador.iti.br ↗'), ', entra com a conta gov.br, envia o PDF e assina.'),
      h('li', {}, 'O cliente baixa o arquivo assinado e devolve por e-mail ou WhatsApp.'),
      h('li', {}, 'Você usa "Anexar assinado". O documento só fica como assinado depois disso.'),
      h('li', {}, 'Para conferir a assinatura: ', h('a', { href: 'https://validar.iti.gov.br', target: '_blank', rel: 'noopener noreferrer' }, 'validar.iti.gov.br ↗'), '.')),
    h('details', {}, h('summary', { class: 'pequeno' }, 'Instruções que vão para o cliente'), h('pre', { class: 'instrucoes' }, m.instrucoes_govbr)),
    h('div', { class: 'linha', style: { marginTop: '10px', flexWrap: 'wrap' } },
      h('a', { class: 'btn', href: urlArquivo(d, { baixar: true }) }, '⬇ Baixar PDF'),
      h('button', { class: 'btn primario', onclick: () => { fechar(); modalEmail(d, aoTerminar, { assinatura: true }); } }, '✉ Enviar por e-mail com as instruções'),
      h('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(`${d.tipo_nome} nº ${d.numero}: vou te mandar o PDF para assinar com a sua conta gov.br em https://assinador.iti.br — depois é só me devolver o arquivo assinado.`)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir WhatsApp (sem anexo) ↗'),
      h('button', { class: 'btn', onclick: () => { fechar(); modalEnvioManual(d, aoTerminar); } }, 'Já enviei por outro meio'))), [], { fechar: 'Fechar' });
}

function modalEnvioManual(d, aoTerminar) {
  const meio = h('select', {}, ['WhatsApp', 'E-mail pessoal', 'Em mãos', 'Outro'].map((x) => h('option', { value: x }, x)));
  const quem = h('input', { type: 'text', placeholder: 'Para quem (opcional)' });
  modal('Registrar envio feito fora do sistema', h('div', { class: 'form-captacao' },
    h('p', { class: 'suave' }, 'Fica no histórico como "informado por você": o sistema não enviou.'),
    campoTexto('Por onde', meio), campoTexto('Destinatário', quem)), [{
    texto: 'Registrar', classe: 'primario', acao: async () => {
      try { await api(`/captacao-documentos/${d.id}/envio-manual`, { metodo: 'POST', corpo: { meio: meio.value, destinatario: quem.value, pedir_assinatura: true } }); toast('Envio registrado. Aguardando o arquivo assinado.'); aoTerminar?.(); }
      catch (e) { toast(e.message, 6000); return false; }
    } }], { fechar: 'Cancelar' });
}

function modalAnexar(d, aoTerminar) {
  const arq = h('input', { type: 'file', accept: 'application/pdf' });
  const manuscrita = h('input', { type: 'checkbox' });
  const caixaManu = h('label', { class: 'opcao', style: { display: 'none' } }, manuscrita, ' É uma cópia assinada à mão e digitalizada (sem assinatura digital)');
  modal(`Anexar ${d.tipo_nome.toLowerCase()} nº ${d.numero} assinado`, h('div', { class: 'form-captacao' },
    h('p', {}, 'Envie o PDF que o cliente devolveu. O arquivo é guardado do jeito que chegou, sem alteração, junto com o PDF gerado.'),
    arq, caixaManu,
    h('p', { class: 'suave pequeno' }, 'O LicitPro confere só se há assinatura digital no arquivo e se ele contém o PDF gerado; a validade jurídica da assinatura se confere em ',
      h('a', { href: 'https://validar.iti.gov.br', target: '_blank', rel: 'noopener noreferrer' }, 'validar.iti.gov.br ↗'), '.')), [{
    texto: 'Anexar', classe: 'primario', acao: async () => {
      const f = arq.files[0]; if (!f) { toast('Escolha o PDF assinado.'); return false; }
      const fd = new FormData(); fd.append('arquivo', f, f.name); if (manuscrita.checked) fd.append('manuscrita', '1');
      try {
        const r = await api(`/captacao-documentos/${d.id}/assinado`, { metodo: 'POST', corpo: fd });
        toast(r.assinatura_detectada ? `Assinado anexado: assinatura digital encontrada${r.contem_original === 1 ? ' e o arquivo contém o PDF gerado' : r.contem_original === 0 ? ', mas não deu para confirmar que é o mesmo PDF gerado: confira o conteúdo' : ''}.` : 'Cópia assinada à mão anexada.', 8000);
        aoTerminar?.();
      } catch (e) {
        if (e.dados?.sem_assinatura) { caixaManu.style.display = 'block'; toast(e.message, 9000); return false; }
        toast(e.message, 7000); return false;
      }
    } }], { fechar: 'Cancelar' });
}

// ---------- Detalhe da captação ----------
async function detalhe(alvo, est, id) {
  render(alvo, carregando());
  const det = await api(`/captacoes/${id}`);
  const c = det.captacao; const cli = det.cliente;
  const recarregar = () => detalhe(alvo, est, id);
  const ed = podeEditar(est) && !c.cancelada_em;
  const cancelar = () => {
    const motivo = h('textarea', { rows: 3, placeholder: 'Ex.: cliente desistiu' });
    modal('Cancelar captação', h('div', { class: 'form-captacao' }, h('p', {}, 'Os documentos e arquivos ficam guardados no histórico. Dá para reabrir depois.'), campoTexto('Motivo *', motivo, { largo: true })), [{
      texto: 'Cancelar captação', classe: 'perigo', acao: async () => {
        try { await api(`/captacoes/${id}/cancelar`, { metodo: 'POST', corpo: { motivo: motivo.value } }); toast('Captação cancelada.'); recarregar(); } catch (e) { toast(e.message, 5000); return false; }
      } }], { fechar: 'Voltar' });
  };
  render(alvo,
    cabecalho(`Captação: ${nomeCli(cli)}`, `${cli.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'} ${fmtDoc(cli.cnpj)} · criada em ${dataUtc(c.criado_em)}`,
      h('a', { class: 'btn', href: '#/captacao' }, '← Histórico'),
      h('a', { class: 'btn', href: `#/empresas/${cli.id}` }, 'Ver empresa'),
      ed ? h('a', { class: 'btn primario', href: `#/captacao/${id}/passo/3` }, '+ Gerar outro documento') : null),
    h('div', { class: 'linha', style: { marginBottom: '12px', gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: `etiqueta ${COR_GERAL[c.status] ?? 'azul'}` }, c.status_rotulo),
      h('span', { class: 'suave' }, `Minha Empresa: ${det.minha_empresa ? det.minha_empresa.nome_fantasia || det.minha_empresa.nome : 'não escolhida'}`),
      c.cancelada_em ? h('span', { class: 'suave' }, `· cancelada: ${c.motivo_cancelamento}`) : null),
    det.cliente_pendencias.length && !c.cancelada_em ? h('div', { class: 'aviso amarelo' }, h('strong', {}, 'Cadastro incompleto: '), det.cliente_pendencias.map((p) => p.replace('Empresa assessorada: ', '')).join('; '), '. ',
      ed ? h('a', { href: `#/captacao/${id}/passo/1` }, 'Completar cadastro') : null) : null,
    h('div', { class: 'cartao' }, h('h2', {}, `Documentos (${det.documentos.length})`),
      det.documentos.length ? det.documentos.map((d) => h('div', { class: 'doc-linha' },
        h('div', { class: 'linha', style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
          h('div', {}, h('strong', {}, `${d.tipo_nome} nº ${d.numero}`), h('span', { class: 'suave pequeno' }, ` · versão ${d.versao}${d.paginas ? ` · ${d.paginas} pág.` : ''}`),
            ' ', h('span', { class: `etiqueta ${COR_STATUS[d.status] || ''}` }, d.rotulo)),
          h('div', { class: 'linha' },
            ed && !['assinado', 'cancelado'].includes(d.status) ? h('a', { class: 'btn pequeno', href: `#/captacao/${id}/passo/4?doc=${d.id}` }, 'Editar') : null,
            d.status !== 'cancelado' ? h('a', { class: 'btn pequeno', href: `#/captacao/${id}/passo/5?doc=${d.id}` }, 'Visualizar') : null,
            temPdf(d) ? h('a', { class: 'btn pequeno', href: urlArquivo(d, { baixar: true }) }, '⬇ PDF') : null,
            temPdf(d) ? h('button', { class: 'btn pequeno', onclick: () => imprimir(urlArquivo(d)) }, '🖨') : null,
            ed && temPdf(d) ? h('button', { class: 'btn pequeno', onclick: () => modalEmail(d, recarregar) }, d.enviado_em ? 'Reenviar' : 'E-mail') : null,
            ed && temPdf(d) && d.status !== 'assinado' ? h('button', { class: 'btn pequeno primario', onclick: () => modalAssinatura(d, recarregar) }, 'Assinatura') : null,
            ed && temPdf(d) ? h('button', { class: 'btn pequeno', onclick: () => modalAnexar(d, recarregar) }, 'Anexar assinado') : null,
            ed && !['assinado', 'cancelado'].includes(d.status) ? h('button', { class: 'btn pequeno perigo', onclick: async () => {
              if (!confirmar(`Cancelar ${d.tipo_nome.toLowerCase()} nº ${d.numero}? O histórico e os PDFs ficam guardados.`)) return;
              try { await api(`/captacao-documentos/${d.id}/cancelar`, { metodo: 'POST' }); recarregar(); } catch (e) { toast(e.message); }
            } }, 'Cancelar') : null)),
        d.arquivos.length ? h('ul', { class: 'arquivos-doc pequeno' }, d.arquivos.map((a) => h('li', {},
          h('a', { href: urlArquivo(d, { baixar: true, arquivo: a.id }) }, a.tipo === 'assinado' ? '✍ Assinado' : `📄 Gerado (versão ${a.versao})`),
          ` · ${dataUtc(a.criado_em)} · ${Math.ceil(a.tamanho / 1024)} KB · SHA-256 ${a.sha256.slice(0, 12)}…`,
          a.tipo === 'assinado' ? h('span', { class: `etiqueta pequena ${a.assinatura_detectada ? 'verde' : 'amarela'}`, style: { marginLeft: '6px' } }, a.assinatura_detectada ? 'assinatura digital no arquivo' : 'assinado à mão (digitalizado)') : null,
          a.tipo === 'assinado' && a.contem_original === 0 ? h('span', { class: 'etiqueta pequena amarela', style: { marginLeft: '6px' }, title: 'O assinador pode ter regravado o arquivo. Confira se o conteúdo é o mesmo.' }, 'não confirmado que é o mesmo PDF') : null))) : null))
        : vazio('Nenhum documento ainda.')),
    h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Histórico'),
      h('ul', { class: 'linha-tempo' }, det.eventos.map((e) => h('li', { class: e.resultado === 'falha' ? 'falha' : '' },
        h('span', { class: 'quando suave pequeno' }, dataUtc(e.criado_em)), ' ',
        e.descricao || e.status_para, e.destinatario ? h('span', { class: 'suave' }, ` → ${e.destinatario}`) : null,
        e.erro ? h('div', { class: 'pequeno', style: { color: 'var(--perigo)' } }, e.erro) : null,
        e.usuario ? h('span', { class: 'suave pequeno' }, ` · ${e.usuario}`) : null)))),
    h('div', { class: 'linha', style: { marginTop: '18px', justifyContent: 'flex-end' } },
      ed ? h('button', { class: 'btn', onclick: cancelar }, 'Cancelar captação') : null,
      c.cancelada_em && podeEditar(est) ? h('button', { class: 'btn', onclick: async () => { try { await api(`/captacoes/${id}/reabrir`, { metodo: 'POST' }); recarregar(); } catch (e) { toast(e.message); } } }, 'Reabrir') : null,
      c.cancelada_em && ['admin', 'superadmin'].includes(papel(est)) ? h('button', { class: 'btn perigo', onclick: async () => {
        if (!confirmar('Excluir DEFINITIVAMENTE esta captação, com os documentos e PDFs (inclusive assinados)? Não dá para desfazer.')) return;
        try { await api(`/captacoes/${id}`, { metodo: 'DELETE' }); toast('Captação excluída.'); location.hash = '#/captacao'; } catch (e) { toast(e.message); }
      } }, 'Excluir definitivamente') : null));
}

/** Cartão "Captações e documentos" na tela da empresa assessorada. */
export function historicoDaEmpresa(clienteId) {
  const caixa = h('div', { class: 'cartao', style: { marginTop: '14px' } }, h('h2', {}, 'Captações e documentos'), carregando());
  api(`/clientes/${clienteId}/captacoes`).then(({ captacoes }) => {
    render(caixa, h('div', { class: 'linha', style: { justifyContent: 'space-between' } }, h('h2', {}, `Captações e documentos (${captacoes.length})`)),
      captacoes.length ? h('ul', { class: 'lista-captacoes' }, captacoes.map((x) => h('li', {},
        h('a', { href: `#/captacao/${x.id}` }, `Captação de ${dataUtc(x.criado_em)}`), ' ', h('span', { class: `etiqueta ${COR_GERAL[x.status] ?? 'azul'}` }, x.status_rotulo),
        x.documentos.length ? h('div', { class: 'chips-docs' }, x.documentos.map((d) => h('span', { class: `etiqueta pequena ${COR_STATUS[d.status] || ''}` }, `${d.tipo === 'procuracao' ? 'Procuração' : d.tipo === 'contrato' ? 'Contrato' : 'Proposta'} ${d.numero}: ${d.rotulo}`))) : null)))
        : h('p', { class: 'suave' }, 'Nenhuma captação para esta empresa.'));
  }).catch((e) => render(caixa, h('div', { class: 'aviso vermelho' }, e.message)));
  return caixa;
}
