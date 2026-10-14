// Empresas assessoradas: cadastro, responsável legal, certidões em PDF com validade e vencimentos.
import { api, clienteSelecionado, selecionarCliente } from './api.js';
import { h, toast, carregando, vazio, confirmar, modal, render, data, dataUtc } from './ui.js';
import { historicoDaEmpresa } from './captacao.js';
import { editorSocios } from './socios.js';

const podeEditar = (e) => e.usuario.papel !== 'leitor';
const podeExcluir = (e) => ['gestor', 'admin', 'superadmin'].includes(e.usuario.papel);
const SITUACAO = {
  vencido: ['Vencido', 'vermelha'], vence_7: ['Vence em até 7 dias', 'vermelha'], vence_15: ['Vence em até 15 dias', 'amarela'],
  vence_30: ['Vence em até 30 dias', 'amarela'], em_dia: ['Em dia', 'verde'], sem_validade: ['Sem validade informada', ''],
};
// Certidões que o SICAF mostra com validade (o usuário confere no PDF e digita as datas)
const DO_SICAF = ['sicaf', 'federal', 'fgts', 'trabalhista', 'estadual', 'municipal', 'qualificacao'];

const fmtCpf = (c) => String(c || '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const ASSINA = { isolada: 'Assina sozinho', conjunta: 'Assina em conjunto' };
// CNPJ (14) ou CPF (11, empresa assessorada pessoa física)
const fmtCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const rotDoc = (c) => (c.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ');
const nomeCli = (c) => c.nome_fantasia || c.razao_social;
const etiquetaSit = (d) => {
  const [rot, cor] = SITUACAO[d.situacao] || [d.situacao, ''];
  const extra = d.dias == null ? '' : d.dias < 0 ? ` há ${-d.dias} dia(s)` : d.dias === 0 ? ' (hoje)' : d.situacao === 'em_dia' ? '' : ` (${d.dias} dia(s))`;
  return h('span', { class: `etiqueta ${cor}` }, rot + (d.situacao === 'vencido' ? extra : d.situacao.startsWith('vence') ? extra : ''));
};
const avisarAlteracao = () => window.dispatchEvent(new Event('empresas-alteradas'));

function cabecalho(titulo, subtitulo, ...acoes) {
  return h('div', { class: 'cabecalho-pagina' },
    h('div', {}, h('h1', {}, titulo), subtitulo ? h('div', { class: 'suave' }, subtitulo) : null),
    h('div', { class: 'linha' }, ...acoes));
}

// ---------- Formulário de cadastro / edição ----------
function formEmpresa(est, c = {}, aoSalvar) {
  const campos = {};
  const inp = (nome, rot, attrs = {}, largo = false) => {
    campos[nome] = h('input', { id: `e-${nome}`, value: c[nome] ?? '', ...attrs });
    return h('div', { class: largo ? 'largo' : '' }, h('label', { for: `e-${nome}` }, rot), campos[nome]);
  };
  campos.porte = h('select', { id: 'e-porte' }, h('option', { value: '' }, 'Não informado'),
    ['MEI', 'ME', 'EPP', 'Demais'].map((p) => h('option', { value: p, selected: c.porte === p }, p)));
  campos.observacoes = h('textarea', { id: 'e-observacoes', rows: 2 }, c.observacoes || '');
  campos.obs_comerciais = h('textarea', { id: 'e-obs_comerciais', rows: 2 }, c.obs_comerciais || '');
  // Ramo: CNAEs da Receita (só leitura) e palavras que contam as licitações compatíveis no Dashboard › Empresas
  let cnaes = null;
  try { cnaes = c.cnaes_json ? JSON.parse(c.cnaes_json) : null; } catch { cnaes = null; }
  campos.palavras_chave = h('textarea', { id: 'e-palavras_chave', rows: 2, placeholder: 'ex.: informática; papelaria; material de escritório' }, c.palavras_chave || '');
  const listaCnaes = h('div', { class: 'lista-cnaes pequeno' });
  const mostrarCnaes = () => render(listaCnaes, cnaes?.length
    ? h('ul', {}, cnaes.map((x) => h('li', {}, h('code', {}, x.codigo), ` ${x.descricao}`, x.principal ? h('strong', {}, ' (principal)') : null)))
    : h('span', { class: 'suave' }, 'Os CNAEs aparecem aqui ao consultar o CNPJ na Receita (botão 🔎 Receita).'));
  mostrarCnaes();
  // Sócios: lista editável (a Receita traz nome e qualificação; CPF e forma de assinatura vêm do contrato social)
  let socios = [];
  try { socios = c.socios_json ? JSON.parse(c.socios_json) : []; } catch { socios = []; }
  const editor = editorSocios(socios);
  const statusReceita = h('div', { class: 'status-receita' });
  const seletorSocio = h('div', {});
  let ultimaConsulta = '';
  // Preenche a partir da base pública da Receita; num cadastro novo só preenche campos vazios,
  // na edição (botão clicado) atualiza os dados da empresa e mantém o que foi digitado do responsável.
  const consultarReceita = async (forcar = false) => {
    const cnpj = campos.cnpj.value.replace(/\D/g, '');
    if (cnpj.length !== 14 || (!forcar && cnpj === ultimaConsulta)) return;
    ultimaConsulta = cnpj;
    statusReceita.className = 'status-receita aviso azul';
    render(statusReceita, 'Consultando a base pública da Receita Federal...');
    try {
      const d = await api(`/cnpj/${cnpj}/consulta`);
      const por = (k, v, sempre) => { if (v && (sempre || !campos[k].value.trim())) campos[k].value = v; };
      const sempre = forcar && !!c.id;
      por('razao_social', d.razao_social, sempre); por('nome_fantasia', d.nome_fantasia, sempre);
      por('uf', d.uf, sempre); por('municipio', d.municipio, sempre);
      por('email', d.email, sempre); por('telefone', d.telefone, sempre);
      por('endereco', d.endereco, sempre); por('cep', d.cep, sempre);
      if (d.porte && (sempre || !campos.porte.value)) campos.porte.value = d.porte;
      const escolherSocio = (s) => { if (!s) return; if (!campos.resp_nome.value.trim() || forcar) campos.resp_nome.value = s.nome; if (s.qualificacao && (!campos.resp_cargo.value.trim() || forcar)) campos.resp_cargo.value = s.qualificacao; };
      escolherSocio(d.responsavel);
      editor.preencherDaReceita(d.socios || []);
      if (d.cnaes?.length) { cnaes = d.cnaes; mostrarCnaes(); }
      if (d.palavras_sugeridas?.length && !campos.palavras_chave.value.trim()) campos.palavras_chave.value = d.palavras_sugeridas.join('; ');
      render(seletorSocio, d.socios.length > 1 ? h('div', { class: 'campo' }, h('label', { for: 'e-socio' }, `Sócios na Receita (${d.socios.length}): escolha quem é o responsável`),
        h('select', { id: 'e-socio', onchange: (ev) => { forcar = true; escolherSocio(d.socios[ev.target.value]); } },
          d.socios.map((s, i) => h('option', { value: i, selected: s === d.responsavel || (d.responsavel && s.nome === d.responsavel.nome) }, `${s.nome}${s.qualificacao ? ` (${s.qualificacao})` : ''}`)))) : null);
      const inativa = d.situacao && !/ATIVA/i.test(d.situacao);
      statusReceita.className = `status-receita aviso ${inativa ? 'vermelho' : 'verde'}`;
      render(statusReceita,
        h('strong', {}, inativa ? `Atenção: situação cadastral ${d.situacao}. ` : `Dados preenchidos pela Receita (situação: ${d.situacao || 'não informada'}). `),
        d.atividade ? h('span', {}, `Atividade principal: ${d.atividade}. `) : null,
        h('div', { class: 'pequeno', style: { marginTop: '4px' } },
          `Fonte: ${d.fonte}, base aberta do CNPJ da Receita Federal (pode ter algumas semanas de atraso). `,
          'E-mail e telefone pessoais do responsável não são públicos: preencha com os dados que a empresa passar. Confira tudo antes de salvar.'));
    } catch (e) {
      statusReceita.className = 'status-receita aviso amarelo';
      render(statusReceita, e.message);
    }
  };
  const conteudo = h('form', { class: 'form-empresa' },
    h('h3', {}, 'Empresa'),
    h('div', { class: 'filtros' },
      h('div', { class: 'largo' }, h('label', { for: 'e-cnpj' }, `${rotDoc(c)} *`),
        h('div', { class: 'linha cnpj-linha' },
          campos.cnpj = h('input', { id: 'e-cnpj', required: true, inputmode: 'numeric', placeholder: '00.000.000/0000-00', value: c.cnpj ? fmtCnpj(c.cnpj) : '',
            oninput: (ev) => { if (!c.id && ev.target.value.replace(/\D/g, '').length === 14) consultarReceita(); },
            onblur: () => { if (!c.id) consultarReceita(); } }),
          h('button', { type: 'button', class: 'btn pequeno', title: 'Buscar dados públicos da Receita Federal', onclick: () => consultarReceita(true) }, '🔎 Receita'))),
      inp('razao_social', 'Razão social *', { required: true }, true),
      inp('nome_fantasia', 'Nome fantasia'),
      h('div', {}, h('label', { for: 'e-porte' }, 'Porte'), campos.porte),
      inp('uf', 'UF', { maxlength: 2, placeholder: 'ES' }),
      inp('municipio', 'Município', { placeholder: 'Vila Velha' }),
      inp('email', 'E-mail da empresa', { type: 'email' }),
      inp('telefone', 'Telefone da empresa', { type: 'tel' }),
      inp('endereco', 'Endereço (rua, nº, bairro)', {}, true),
      inp('cep', 'CEP', { inputmode: 'numeric', placeholder: '29100-000' }),
      inp('email_documentos', 'E-mail para documentos', { type: 'email' })),
    statusReceita,
    h('h3', {}, 'Sócios'),
    h('p', { class: 'suave pequeno' }, 'A Receita traz nome e qualificação. CPF e se assina sozinho ou em conjunto estão no contrato social: confira lá.'),
    editor.caixa,
    editor.botao,
    h('h3', {}, 'Responsável legal (assina a proposta)'),
    seletorSocio,
    h('div', { class: 'filtros' },
      inp('resp_nome', 'Nome', {}, true), inp('resp_cargo', 'Cargo', { placeholder: 'Sócio-administrador' }),
      inp('resp_email', 'E-mail', { type: 'email' }), inp('resp_telefone', 'Telefone / WhatsApp', { type: 'tel' }),
      inp('resp_cpf', 'CPF (assina a proposta)', { inputmode: 'numeric', placeholder: '000.000.000-00' })),
    h('h3', {}, 'Responsável financeiro'),
    h('div', { class: 'filtros' },
      inp('fin_nome', 'Nome', {}, true), inp('fin_cargo', 'Cargo', { placeholder: 'ex.: Financeiro' }),
      inp('fin_email', 'E-mail', { type: 'email' }), inp('fin_telefone', 'Telefone / WhatsApp', { type: 'tel' })),
    h('h3', {}, 'Dados bancários (saem na proposta de preços)'),
    h('div', { class: 'filtros' },
      inp('banco', 'Banco', { placeholder: 'ex.: 001 · Banco do Brasil' }), inp('agencia', 'Agência'), inp('conta', 'Conta corrente'),
      inp('pix', 'Chave Pix', { placeholder: 'CNPJ, e-mail, telefone ou chave aleatória' }, true)),
    h('h3', {}, 'Ramo de atuação'),
    listaCnaes,
    h('div', { class: 'campo' }, h('label', { for: 'e-palavras_chave' }, 'Palavras do ramo (separe com ;)'), campos.palavras_chave,
      h('div', { class: 'suave pequeno' }, 'Sugeridas a partir dos CNAEs. Revise: o Dashboard › Empresas conta as licitações abertas que têm alguma destas palavras no objeto ou nos itens.')),
    h('div', { class: 'campo' }, h('label', { for: 'e-observacoes' }, 'Observações'), campos.observacoes),
    h('div', { class: 'campo' }, h('label', { for: 'e-obs_comerciais' }, 'Observações comerciais (captação)'), campos.obs_comerciais));
  modal(c.id ? `Editar ${nomeCli(c)}` : 'Nova empresa', conteudo, [{ texto: 'Salvar', classe: 'primario', acao: async () => {
    const corpo = Object.fromEntries(Object.entries(campos).map(([k, el]) => [k, el.value.trim()]));
    corpo.cnpj = corpo.cnpj.replace(/\D/g, '');
    if (cnaes) corpo.cnaes = cnaes;
    corpo.socios = editor.ler();
    if (!editor.valido()) { toast('Preencha o nome do sócio (ou remova a linha).', 5000); return false; }
    try {
      const r = c.id ? await api(`/clientes/${c.id}`, { metodo: 'PATCH', corpo }) : await api('/clientes', { metodo: 'POST', corpo });
      toast('Empresa salva.'); avisarAlteracao(); aoSalvar?.(c.id || r.id);
    } catch (e) { toast(e.message, 5000); return false; }
  } }]);
}

// ---------- Lista de empresas ----------
export async function empresas(alvo, rota, est) {
  if (rota.args[0]) return empresaDetalhe(alvo, rota, est);
  render(alvo, carregando());
  const { clientes } = await api('/clientes');
  const atual = clienteSelecionado();
  const selecionar = (id) => { selecionarCliente(id); avisarAlteracao(); empresas(alvo, rota, est); toast(id ? 'Empresa selecionada: Kanban, favoritos e alertas agora mostram só os dela.' : 'Mostrando todas as empresas.', 4500); };
  // Busca por razão social, nome fantasia ou CNPJ/CPF (filtra os cartões na hora)
  const semAc = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const busca = h('input', { type: 'search', class: 'busca-empresas', placeholder: 'Buscar por razão social, nome fantasia ou CNPJ/CPF', 'aria-label': 'Buscar empresa',
    oninput: () => {
      const t = semAc(busca.value.trim()); const d = busca.value.replace(/\D/g, '');
      alvo.querySelectorAll('.grade-empresas > .cartao').forEach((el) => { el.style.display = !t || semAc(el.dataset.busca).includes(t) || (d.length >= 3 && el.dataset.doc.includes(d)) ? '' : 'none'; });
    } });
  render(alvo,
    cabecalho('Empresas Assessoradas', 'Cadastro central das empresas que vocês assessoram, com certidões, SICAF, captações e documentos.',
      podeEditar(est) ? h('a', { class: 'btn primario', href: '#/captacao/nova', title: 'Empresas novas entram pela Captação, que confere se o CNPJ/CPF já existe' }, '+ Nova captação') : null),
    busca,
    h('div', { class: 'aviso azul' }, h('strong', {}, 'Como funciona a seleção: '),
      'escolha uma empresa no topo da tela (ou em "Selecionar") e o Kanban, os favoritos, os alertas, o calendário e os vencimentos passam a mostrar só os dela. ',
      'Licitações enviadas ao Kanban ou favoritadas ficam na empresa selecionada no momento.'),
    clientes.length ? h('div', { class: 'grade-empresas' }, clientes.map((c) => h('div', { class: `cartao empresa ${String(c.id) === atual ? 'selecionada' : ''} ${c.ativo ? '' : 'inativa'}`, 'data-busca': `${c.razao_social} ${c.nome_fantasia || ''}`, 'data-doc': c.cnpj },
      h('div', { class: 'linha', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', {}, h('a', { class: 'objeto', href: `#/empresas/${c.id}` }, nomeCli(c)),
          h('div', { class: 'suave pequeno' }, `${rotDoc(c)} ${fmtCnpj(c.cnpj)}`, c.porte ? ` · ${c.porte}` : '', c.ativo ? '' : ' · arquivada')),
        String(c.id) === atual ? h('span', { class: 'etiqueta verde' }, 'Selecionada') : null),
      c.resp_nome ? h('div', { class: 'pequeno', style: { marginTop: '6px' } }, `Responsável: ${c.resp_nome}`, c.resp_telefone ? ` · ${c.resp_telefone}` : '') : null,
      h('div', { class: 'linha', style: { marginTop: '8px' } },
        c.vencidos ? h('span', { class: 'etiqueta vermelha' }, `${c.vencidos} vencido(s)`) : null,
        c.vencendo ? h('span', { class: 'etiqueta amarela' }, `${c.vencendo} vencendo em 30 dias`) : null,
        !c.vencidos && !c.vencendo && c.documentos ? h('span', { class: 'etiqueta verde' }, 'Certidões em dia') : null,
        !c.documentos ? h('span', { class: 'etiqueta' }, 'Nenhuma certidão cadastrada') : null),
      c.proximo_vencimento ? h('div', { class: 'suave pequeno', style: { marginTop: '4px' } },
        `Próximo vencimento: ${c.proximo_vencimento.tipo_nome} em ${data(c.proximo_vencimento.validade, false)}`) : null,
      h('div', { class: 'linha', style: { marginTop: '10px' } },
        String(c.id) === atual ? h('button', { class: 'btn pequeno', onclick: () => selecionar('') }, 'Ver todas')
          : c.ativo ? h('button', { class: 'btn pequeno primario', onclick: () => selecionar(String(c.id)) }, 'Selecionar') : null,
        h('a', { class: 'btn pequeno', href: `#/empresas/${c.id}` }, 'Certidões e dados')))))
      : vazio('Nenhuma empresa cadastrada ainda. Clique em "+ Nova captação".'));
}

// ---------- Detalhe: dados, responsável e certidões ----------
async function empresaDetalhe(alvo, rota, est) {
  render(alvo, carregando());
  const id = rota.args[0];
  const { cliente: c, documentos, tipos } = await api(`/clientes/${id}`);
  const recarregar = () => empresaDetalhe(alvo, rota, est);
  const linha = (rot, val) => [h('dt', {}, rot), h('dd', {}, val || h('span', { class: 'nao-info' }, 'Não informado'))];
  const selecionada = clienteSelecionado() === String(c.id);
  let socios = [];
  try { socios = c.socios_json ? JSON.parse(c.socios_json) : []; } catch { socios = []; }

  const excluirDoc = async (d) => {
    if (!confirmar(`Excluir "${d.tipo_nome}"${d.validade ? ` (validade ${data(d.validade, false)})` : ''}?`)) return;
    try { await api(`/clientes/${c.id}/documentos/${d.id}`, { metodo: 'DELETE' }); toast('Documento excluído.'); avisarAlteracao(); recarregar(); } catch (e) { toast(e.message); }
  };

  render(alvo,
    cabecalho(nomeCli(c), `${c.razao_social} · ${rotDoc(c)} ${fmtCnpj(c.cnpj)}`,
      h('a', { class: 'btn', href: '#/empresas' }, '← Empresas Assessoradas'),
      podeEditar(est) && c.ativo ? h('a', { class: 'btn', href: '#/captacao' }, 'Captações') : null,
      selecionada ? h('span', { class: 'etiqueta verde' }, 'Selecionada')
        : c.ativo ? h('button', { class: 'btn', onclick: () => { selecionarCliente(String(c.id)); avisarAlteracao(); recarregar(); toast('Empresa selecionada.'); } }, 'Selecionar esta empresa') : null,
      podeEditar(est) ? h('button', { class: 'btn', onclick: () => formEmpresa(est, c, recarregar) }, 'Editar dados') : null),
    h('div', { class: 'grade duas' },
      h('div', { class: 'cartao' }, h('h2', {}, 'Empresa'), h('dl', { class: 'dados' },
        linha(c.tipo_pessoa === 'PF' ? 'Nome' : 'Razão social', c.razao_social), linha('Nome fantasia', c.nome_fantasia), linha(rotDoc(c), fmtCnpj(c.cnpj)), linha('Porte', c.porte),
        linha('Local', [c.municipio, c.uf].filter(Boolean).join(' / ')), linha('E-mail', c.email), linha('E-mail para documentos', c.email_documentos), linha('Telefone', c.telefone),
        c.observacoes ? linha('Observações', c.observacoes) : null, c.obs_comerciais ? linha('Observações comerciais', c.obs_comerciais) : null),
      h('div', { class: 'linha', style: { marginTop: '8px' } },
        h('a', { class: 'btn pequeno', href: `https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp`, target: '_blank', rel: 'noopener noreferrer', title: 'Cartão CNPJ no site da Receita Federal' }, 'Cartão CNPJ (Receita) ↗'))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Responsável legal'), h('dl', { class: 'dados' },
        linha('Nome', c.resp_nome), linha('Cargo', c.resp_cargo),
        linha('E-mail', c.resp_email ? h('a', { href: `mailto:${c.resp_email}` }, c.resp_email) : null),
        linha('Telefone', c.resp_telefone ? h('a', { href: `tel:${c.resp_telefone.replace(/[^\d+]/g, '')}` }, c.resp_telefone) : null)),
      c.resp_telefone ? h('a', { class: 'btn pequeno', href: `https://wa.me/55${c.resp_telefone.replace(/\D/g, '').replace(/^55/, '')}`, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir WhatsApp ↗') : null)),
    h('div', { class: 'grade duas', style: { marginTop: '14px' } },
      h('div', { class: 'cartao' }, h('h2', {}, `Sócios (${socios.length})`),
        socios.length ? h('ul', { class: 'lista-socios-det' }, socios.map((sc) => h('li', {},
          h('strong', {}, sc.nome), sc.qualificacao ? ` · ${sc.qualificacao}` : '',
          h('div', { class: 'linha', style: { gap: '6px', marginTop: '4px' } },
            sc.administrador ? h('span', { class: 'etiqueta azul pequena' }, 'Sócio administrador') : null,
            h('span', { class: `etiqueta pequena ${sc.assinatura ? 'verde' : ''}` }, ASSINA[sc.assinatura] || 'Assinatura não informada')),
          h('div', { class: 'suave pequeno' }, [sc.cpf ? `CPF ${fmtCpf(sc.cpf)}` : 'CPF não informado', sc.email, sc.telefone].filter(Boolean).join(' · ')))))
          : h('p', { class: 'suave' }, 'Nenhum sócio cadastrado. Use "Editar dados" (ou o botão 🔎 Receita lá dentro).')),
      h('div', { class: 'cartao' }, h('h2', {}, 'Responsável financeiro'), h('dl', { class: 'dados' },
        linha('Nome', c.fin_nome), linha('Cargo', c.fin_cargo),
        linha('E-mail', c.fin_email ? h('a', { href: `mailto:${c.fin_email}` }, c.fin_email) : null),
        linha('Telefone', c.fin_telefone ? h('a', { href: `tel:${c.fin_telefone.replace(/[^\d+]/g, '')}` }, c.fin_telefone) : null)))),
    historicoDaEmpresa(c.id),
    h('div', { class: 'cartao', style: { marginTop: '14px' } },
      h('div', { class: 'linha', style: { justifyContent: 'space-between' } },
        h('h2', {}, `Certidões e validades (${documentos.length})`),
        podeEditar(est) ? h('div', { class: 'linha' },
          h('button', { class: 'btn primario', onclick: () => formDocumentos(c, tipos, { sicaf: true }, recarregar) }, '+ Enviar SICAF (PDF)'),
          h('button', { class: 'btn', onclick: () => formDocumentos(c, tipos, {}, recarregar) }, '+ Outra certidão')) : null),
      h('p', { class: 'suave pequeno' }, 'O sistema avisa (sino e e-mail) 30, 15 e 7 dias antes de cada validade e no dia em que vence. ',
        'Confira as datas no próprio PDF: o sistema não lê o PDF sozinho e não consulta a Receita nem o SICAF.'),
      documentos.length ? h('div', { class: 'tabela-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Documento', 'Validade', 'Situação', 'Emissão', 'Arquivo', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, documentos.map((d) => h('tr', { class: d.situacao === 'vencido' || d.situacao === 'vence_7' ? 'linha-alerta' : '' },
          h('td', {}, h('strong', {}, d.tipo_nome), d.descricao ? h('div', { class: 'suave pequeno' }, d.descricao) : null, d.numero ? h('div', { class: 'suave pequeno' }, `Nº ${d.numero}`) : null),
          h('td', {}, d.validade ? data(d.validade, false) : h('span', { class: 'nao-info' }, 'Não informada')),
          h('td', {}, etiquetaSit(d)),
          h('td', {}, d.emissao ? data(d.emissao, false) : '—'),
          h('td', {}, d.tem_arquivo ? h('a', { href: `/api/clientes/${c.id}/documentos/${d.id}/arquivo`, target: '_blank', rel: 'noopener' }, `📄 ${d.arquivo_nome || 'PDF'}`) : h('span', { class: 'suave' }, 'sem PDF')),
          h('td', {}, podeEditar(est) ? h('div', { class: 'linha' },
            h('button', { class: 'btn pequeno', title: 'Cadastrar a certidão nova; esta sai da lista', onclick: () => formDocumentos(c, tipos, { renovar: d }, recarregar) }, 'Renovar'),
            h('button', { class: 'btn pequeno perigo', onclick: () => excluirDoc(d) }, 'Excluir')) : null)))))) : vazio('Nenhuma certidão cadastrada. Comece pelo PDF do SICAF.')),
    podeExcluir(est) ? h('div', { class: 'linha', style: { marginTop: '18px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: async () => {
        try { await api(`/clientes/${c.id}`, { metodo: 'PATCH', corpo: { ativo: !c.ativo } }); if (c.ativo && selecionada) selecionarCliente(''); avisarAlteracao(); recarregar(); } catch (e) { toast(e.message); }
      } }, c.ativo ? 'Arquivar empresa' : 'Reativar empresa'),
      h('button', { class: 'btn perigo', onclick: async () => {
        if (!confirmar(`Excluir ${nomeCli(c)} e todas as certidões e PDFs dela? Os cards do Kanban e os favoritos dela NÃO são apagados: passam para "sem empresa".`)) return;
        try { await api(`/clientes/${c.id}`, { metodo: 'DELETE' }); if (selecionada) selecionarCliente(''); avisarAlteracao(); location.hash = '#/empresas'; } catch (e) { toast(e.message); }
      } }, 'Excluir empresa')) : null);
}

// ---------- Envio de certidões ----------
// SICAF: um PDF e várias validades (uma por certidão que aparece nele). Renovar: mesma certidão com data nova.
function formDocumentos(c, tipos, { sicaf = false, renovar = null } = {}, aoSalvar) {
  const arquivo = h('input', { type: 'file', accept: 'application/pdf,.pdf', id: 'd-arquivo' });
  const linhas = [];
  const linhaDoc = (tipo, fixo) => {
    const t = fixo ? null : h('select', {}, Object.entries(tipos).map(([k, v]) => h('option', { value: k, selected: k === tipo }, v)));
    const validade = h('input', { type: 'date' }); const emissao = h('input', { type: 'date' });
    const numero = h('input', { placeholder: 'opcional' }); const desc = h('input', { placeholder: 'opcional' });
    linhas.push({ tipo: () => (fixo ? tipo : t.value), validade, emissao, numero, desc });
    return h('tr', {}, h('td', {}, fixo ? h('strong', {}, tipos[tipo]) : t), h('td', {}, validade), h('td', {}, emissao),
      sicaf ? null : h('td', {}, numero), sicaf ? null : h('td', {}, desc));
  };
  const corpoTabela = sicaf ? DO_SICAF.map((t) => linhaDoc(t, true)) : [linhaDoc(renovar?.tipo || 'municipal', !!renovar)];
  const leitura = h('div', { class: 'status-receita' });
  // SICAF: ao escolher o PDF, o sistema lê a declaração e preenche as validades (só campos vazios)
  if (sicaf) arquivo.addEventListener('change', async () => {
    const f = arquivo.files[0];
    if (!f) return;
    leitura.className = 'status-receita aviso azul'; render(leitura, 'Lendo as datas do PDF...');
    const fd = new FormData(); fd.append('arquivo', f);
    try {
      const r = await api(`/clientes/${c.id}/sicaf/ler`, { metodo: 'POST', corpo: fd });
      let n = 0;
      for (const l of linhas) {
        l.validade.classList.remove('lido-pdf');
        const v = r.validades[l.tipo()];
        if (v && !l.validade.value) { l.validade.value = v; l.validade.classList.add('lido-pdf'); n++; }
        if (l.tipo() === 'sicaf' && r.emitido_em && !l.emissao.value) l.emissao.value = r.emitido_em;
      }
      const faltam = DO_SICAF.filter((t) => !r.validades[t]).map((t) => tipos[t]);
      const avisos = [];
      if (!r.eh_sicaf) avisos.push('Este PDF não parece ser a declaração do SICAF. ');
      if (r.cnpj_confere === false) avisos.push(`O CNPJ do PDF (${fmtCnpj(r.cnpj)}) é diferente do CNPJ desta empresa. `);
      if (r.sem_texto) avisos.push('O PDF não tem texto (parece escaneado): digite as datas. ');
      leitura.className = `status-receita aviso ${avisos.length ? 'vermelho' : n ? 'verde' : 'amarelo'}`;
      render(leitura, h('strong', {}, avisos.join('') || (n ? `${n} validade(s) preenchida(s) a partir do PDF. ` : 'Nenhuma validade encontrada no PDF. ')),
        faltam.length && !r.sem_texto ? h('span', {}, `Não constam no PDF: ${faltam.join(', ')}. `) : null,
        h('div', { class: 'pequeno', style: { marginTop: '4px' } }, 'Confira as datas destacadas com o PDF antes de salvar.'));
    } catch (e) { leitura.className = 'status-receita aviso amarelo'; render(leitura, e.message); }
  });
  const conteudo = h('div', {},
    sicaf ? h('p', { class: 'pequeno' }, 'Escolha o PDF da declaração do SICAF ("Situação do Fornecedor"): o sistema lê e preenche as validades. ',
      'Confira e corrija o que for preciso; o que não constar fica em branco. Todas as datas ficam ligadas ao mesmo PDF.') : null,
    renovar ? h('p', { class: 'pequeno' }, `Renovando "${renovar.tipo_nome}" (validade atual ${renovar.validade ? data(renovar.validade, false) : 'não informada'}). A certidão antiga sai da lista.`) : null,
    h('div', { class: 'campo' }, h('label', { for: 'd-arquivo' }, sicaf ? 'PDF do SICAF (até 10 MB)' : 'PDF da certidão (opcional, até 10 MB)'), arquivo),
    sicaf ? leitura : null,
    h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-form' },
      h('thead', {}, h('tr', {}, ['Certidão', 'Validade', 'Emissão', ...(sicaf ? [] : ['Número', 'Descrição'])].map((x) => h('th', {}, x)))),
      h('tbody', {}, corpoTabela))));
  modal(sicaf ? `SICAF de ${nomeCli(c)}` : renovar ? 'Renovar certidão' : 'Nova certidão', conteudo, [{ texto: 'Salvar', classe: 'primario', acao: async () => {
    const itens = linhas.map((l) => ({ tipo: l.tipo(), validade: l.validade.value, emissao: l.emissao.value, numero: l.numero.value, descricao: l.desc.value }))
      .filter((i) => !sicaf || i.validade || i.emissao);
    if (!itens.length) { toast('Informe a validade de pelo menos uma certidão.'); return false; }
    if (sicaf && !arquivo.files[0]) { toast('Escolha o PDF do SICAF.'); return false; }
    const f = arquivo.files[0];
    if (f && f.size > 10 * 1024 * 1024) { toast('O PDF pode ter no máximo 10 MB.'); return false; }
    const fd = new FormData();
    fd.append('dados', JSON.stringify({ itens, substitui: renovar ? [renovar.id] : [] }));
    if (f) fd.append('arquivo', f);
    try { await api(`/clientes/${c.id}/documentos`, { metodo: 'POST', corpo: fd }); toast('Certidões salvas.'); avisarAlteracao(); aoSalvar(); }
    catch (e) { toast(e.message, 5000); return false; }
  } }]);
}

// ---------- Vencimentos (todas as empresas ou só a selecionada) ----------
export async function vencimentos(alvo, rota, est) {
  render(alvo, carregando());
  const { documentos } = await api('/vencimentos');
  const filtro = rota.query.get('situacao') || 'atencao';
  const ATENCAO = ['vencido', 'vence_7', 'vence_15', 'vence_30'];
  const lista = filtro === 'todos' ? documentos : documentos.filter((d) => ATENCAO.includes(d.situacao));
  const conta = (s) => documentos.filter((d) => d.situacao === s).length;
  const sel = est.clientes.find((c) => String(c.id) === clienteSelecionado());
  render(alvo,
    cabecalho('Vencimentos', sel ? `Certidões de ${nomeCli(sel)}` : 'Certidões de todas as empresas assessoradas'),
    h('div', { class: 'grade kpis' },
      [['Vencidas', conta('vencido')], ['Vencem em 7 dias', conta('vence_7')], ['Vencem em 15 dias', conta('vence_15')], ['Vencem em 30 dias', conta('vence_30')], ['Em dia', conta('em_dia')], ['Sem validade', conta('sem_validade')]]
        .map(([r, n]) => h('div', { class: 'cartao kpi' }, h('div', { class: 'rotulo' }, r), h('div', { class: 'valor' }, String(n))))),
    h('div', { class: 'abas' },
      h('a', { href: '#/documentos', class: filtro !== 'todos' ? 'ativo' : '' }, 'Precisam de atenção'),
      h('a', { href: '#/documentos?situacao=todos', class: filtro === 'todos' ? 'ativo' : '' }, 'Todas')),
    lista.length ? h('div', { class: 'tabela-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Empresa', 'Certidão', 'Validade', 'Situação', 'PDF'].map((t) => h('th', {}, t)))),
      h('tbody', {}, lista.map((d) => h('tr', { class: d.situacao === 'vencido' || d.situacao === 'vence_7' ? 'linha-alerta' : '' },
        h('td', {}, h('a', { href: `#/empresas/${d.cliente_id}` }, d.nome_fantasia || d.razao_social)),
        h('td', {}, d.tipo_nome),
        h('td', {}, d.validade ? data(d.validade, false) : '—'),
        h('td', {}, etiquetaSit(d)),
        h('td', {}, d.tem_arquivo ? h('a', { href: `/api/clientes/${d.cliente_id}/documentos/${d.id}/arquivo`, target: '_blank', rel: 'noopener' }, '📄 abrir') : '—'))))))
      : vazio(documentos.length ? 'Nenhuma certidão vencida ou vencendo nos próximos 30 dias. 👍' : 'Nenhuma certidão cadastrada. Vá em Empresas Assessoradas e envie o SICAF.'),
    h('p', { class: 'suave pequeno', style: { marginTop: '10px' } }, `Atualizado em ${dataUtc(new Date().toISOString().slice(0, 19).replace('T', ' '))}.`));
}
