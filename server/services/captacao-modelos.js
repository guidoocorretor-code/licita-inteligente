// Modelos da Captação: proposta, contrato e procuração. Cada documento vira uma lista de seções
// ({ id, titulo, paragrafos, lista, editavel }) que a tela mostra na pré-visualização e o PDF desenha igual.
// Base: os modelos do Guido (Proposta Padrão Assessoria rev1, Contrato de Prestação de Serviços e Procuração
// de representação em licitações). Nada é inventado: campo vazio vira pendência (obrigatório) ou some do
// texto (opcional). Os textos NÃO foram revisados por advogado; a tela avisa isso.
import { reaisPorExtenso } from '../../web/js/extenso.js';

export const TIPOS_DOC = { proposta: 'Proposta', contrato: 'Contrato', procuracao: 'Procuração' };
export const TITULO_DOC = {
  proposta: 'Proposta de Serviços de Assessoria em Licitações',
  contrato: 'Contrato de Prestação de Serviços de Assessoria em Licitações',
  procuracao: 'Procuração — Representação em Licitações e Contratações Públicas',
};
// Meta de páginas pedida pelo Guido (o PDF avisa se passar)
export const PAGINAS_META = { proposta: 2, contrato: 3, procuracao: 2 };

export const MODALIDADES = ['Pregão Eletrônico', 'Dispensa Eletrônica', 'Concorrência Eletrônica'];
// Serviços dos modelos de proposta e contrato do Guido
export const SERVICOS = {
  mercado: 'Análise de mercado e apresentação do resultado ao cliente',
  habilitacao: 'Levantamento da documentação de habilitação e cadastro/atualização da empresa no SICAF',
  oportunidades: 'Busca e envio de editais publicados na área de atuação do cliente',
  analise: 'Análise dos editais e aviso ao cliente sobre exigências específicas',
  agenda: 'Agendamento das licitações escolhidas pelo cliente e acompanhamento de esclarecimentos, impugnações, avisos e suspensões até a abertura',
  proposta: 'Cadastro da proposta com base nos preços informados pelo cliente',
  sessao: 'Participação nas sessões públicas e envio de lances dentro do preço mínimo aprovado pelo cliente',
  esclarecimentos: 'Pedidos de esclarecimento e impugnações, quando necessários e autorizados pelo cliente',
  pos: 'Envio de proposta ajustada e documentos de habilitação no prazo do edital e acompanhamento até a homologação',
  relatorio: 'Relatório da participação em cada licitação, quando solicitado',
};
// Poderes da procuração (texto do modelo do Guido). Nenhum vem marcado: cada um precisa ser escolhido.
export const PODERES = {
  sicaf: 'cadastrar, atualizar e manter o registro da OUTORGANTE no SICAF e em cadastros de fornecedores, incluindo documentos de habilitação e declarações',
  esclarecimentos: 'retirar editais e apresentar pedidos de esclarecimento',
  impugnacoes: 'apresentar impugnações, quando autorizado por escrito pela OUTORGANTE',
  propostas: 'cadastrar e enviar propostas de preços e documentos de habilitação em dispensas eletrônicas, pregões, concorrências e demais procedimentos',
  lances: 'participar das sessões públicas e formular lances, sempre respeitando o preço mínimo aprovado por escrito pela OUTORGANTE para cada licitação, inclusive por meio de ferramentas de apoio ao envio de lances que respeitem as regras do sistema e do edital',
  negociar: 'negociar preços com o agente de contratação ou pregoeiro, respeitando o mesmo preço mínimo',
  comunicacao: 'comunicar-se com o agente de contratação ou pregoeiro pelos canais do sistema, enviar documentos complementares e acompanhar a sessão até o resultado',
  recursos: 'manifestar intenção de recorrer e apresentar recursos e contrarrazões, quando autorizado por escrito pela OUTORGANTE',
  notificacoes: 'receber notificações e comunicações dos órgãos referentes às licitações',
  desistir: 'desistir de lances ou de propostas, nos casos admitidos pelo edital',
  assinar: 'assinar contratos, atas de registro de preços e termos aditivos',
};
// Poderes sensíveis: quando não marcados, aparecem expressamente nos limites
const SENSIVEIS = ['desistir', 'assinar'];
export const SUBSTABELECIMENTO = { vedado: 'Não permitido', com_reserva: 'Permitido, com reserva de iguais poderes' };
export const RENOVACAO = { aditivo: 'Prorrogação só por termo aditivo assinado', automatica: 'Renovação automática por igual período, salvo aviso' };

// ---------- Campos do passo 4 ----------
// tipo: texto | area | numero | moeda | pct | data | sel | multi | bool. copiar=false: dado do cliente (não vem da última captação).
const CAMPOS_COMUNS = [
  { id: 'local', rotulo: 'Local (cidade/UF)', tipo: 'texto', obrig: true },
  { id: 'data', rotulo: 'Data do documento', tipo: 'data', obrig: true, copiar: false },
];
const CAMPOS_SERVICO = [
  { id: 'modalidades', rotulo: 'Modalidades atendidas', tipo: 'multi', opcoes: MODALIDADES.map((m) => [m, m]), obrig: true },
  { id: 'servicos', rotulo: 'Serviços incluídos', tipo: 'multi', opcoes: Object.entries(SERVICOS), obrig: true },
  { id: 'servicos_extra', rotulo: 'Outros serviços (um por linha)', tipo: 'area' },
  { id: 'plataformas', rotulo: 'Portais / plataformas', tipo: 'texto', padrao: 'Compras.gov.br e demais plataformas indicadas nos editais' },
  { id: 'antecedencia_horas', rotulo: 'Antecedência mínima para o cliente pedir participação (horas)', tipo: 'numero', obrig: true,
    ajuda: 'Nos seus modelos: 48 h na proposta e 72 h no contrato. Escolha um valor.' },
  { id: 'precos_minimos_horas', rotulo: 'Prazo para o cliente informar o preço mínimo (horas antes da disputa)', tipo: 'numero', padrao: 12, obrig: true },
  { id: 'horario', rotulo: 'Horário de atendimento', tipo: 'texto', padrao: 'segunda a sexta-feira, das 9h às 18h, ou conforme o horário da sessão' },
  { id: 'valor_mensal', rotulo: 'Valor mensal (R$)', tipo: 'moeda', copiar: false },
  { id: 'dia_vencimento', rotulo: 'Dia de vencimento da mensalidade', tipo: 'numero', copiar: false },
  { id: 'percentual_exito', rotulo: 'Comissão de êxito (%)', tipo: 'pct', copiar: false },
  { id: 'base_exito', rotulo: 'Base da comissão de êxito', tipo: 'texto', padrao: 'valor do contrato, empenho ou ata obtido pelo cliente' },
  { id: 'forma_pagamento_exito', rotulo: 'Como a comissão de êxito é paga', tipo: 'area',
    ajuda: 'Ex. do seu modelo: registro de preços pago à medida que o cliente executa e recebe.' },
  { id: 'incluir_banco', rotulo: 'Incluir os dados bancários da Minha Empresa', tipo: 'bool', padrao: false, copiar: false },
];
// Atraso, suspensão e encerramento: valem para a proposta e para o contrato
const CAMPOS_CONDICOES = [
  { id: 'multa_atraso_pct', rotulo: 'Multa por atraso de pagamento (%)', tipo: 'pct', padrao: 2,
    ajuda: '2% é o usual. Entre empresas a lei não fixa teto, mas o juiz pode reduzir multa excessiva (Código Civil, art. 413).' },
  { id: 'juros_mes_pct', rotulo: 'Juros por atraso (% ao mês)', tipo: 'pct', padrao: 1 },
  { id: 'suspensao_dias', rotulo: 'Suspender os serviços após quantos dias de atraso (opcional)', tipo: 'numero',
    ajuda: 'Se preencher, o documento diz que os serviços podem ser suspensos, com aviso, até o pagamento.' },
  { id: 'aviso_previo_dias', rotulo: 'Aviso prévio para encerrar (dias)', tipo: 'numero', padrao: 30, obrig: true },
  { id: 'revisao_meses', rotulo: 'Revisão com saída sem multa ao fim de (meses)', tipo: 'texto', padrao: '3 e 6',
    ajuda: 'Do seu modelo de proposta: revisão ao fim de 3 e 6 meses, com saída sem multa só nesses momentos. Deixe vazio para não oferecer.' },
  { id: 'multa_rescisoria_pct', rotulo: 'Multa por encerrar antes do prazo mínimo (% das mensalidades que faltam)', tipo: 'pct',
    ajuda: 'Opcional. Ex.: 50% das mensalidades que faltariam até o fim do prazo mínimo. Proporcional é mais difícil de ser reduzida na Justiça.' },
];

export const CAMPOS = {
  proposta: [
    ...CAMPOS_COMUNS, ...CAMPOS_SERVICO,
    { id: 'contratacao_minima_meses', rotulo: 'Contratação mínima (meses)', tipo: 'numero', copiar: false },
    ...CAMPOS_CONDICOES,
    { id: 'validade_dias', rotulo: 'Validade da proposta (dias)', tipo: 'numero', padrao: 15, obrig: true },
    { id: 'observacoes', rotulo: 'Observações', tipo: 'area', copiar: false },
  ],
  contrato: [
    ...CAMPOS_COMUNS, ...CAMPOS_SERVICO,
    { id: 'vigencia_meses', rotulo: 'Vigência (meses)', tipo: 'numero', obrig: true, copiar: false,
      ajuda: 'Seu modelo de contrato fala em 6 meses; a proposta fala em contratação mínima de 12.' },
    { id: 'renovacao', rotulo: 'Renovação', tipo: 'sel', opcoes: Object.entries(RENOVACAO), padrao: 'aditivo', obrig: true },
    ...CAMPOS_CONDICOES,
    { id: 'foro', rotulo: 'Foro (cidade/UF)', tipo: 'texto', obrig: true },
    { id: 'clausulas_adicionais', rotulo: 'Cláusulas adicionais (opcional)', tipo: 'area', copiar: false },
    { id: 'testemunha1_nome', rotulo: 'Testemunha 1: nome', tipo: 'texto', copiar: false },
    { id: 'testemunha1_cpf', rotulo: 'Testemunha 1: CPF', tipo: 'texto', copiar: false },
    { id: 'testemunha2_nome', rotulo: 'Testemunha 2: nome', tipo: 'texto', copiar: false },
    { id: 'testemunha2_cpf', rotulo: 'Testemunha 2: CPF', tipo: 'texto', copiar: false },
  ],
  procuracao: [
    ...CAMPOS_COMUNS,
    { id: 'outorgado_nome', rotulo: 'Outorgado (procurador): nome', tipo: 'texto', obrig: true },
    { id: 'outorgado_cpf', rotulo: 'Outorgado: CPF', tipo: 'texto', obrig: true },
    { id: 'outorgado_rg', rotulo: 'Outorgado: RG e órgão', tipo: 'texto' },
    { id: 'outorgado_nacionalidade', rotulo: 'Outorgado: nacionalidade', tipo: 'texto' },
    { id: 'outorgado_estado_civil', rotulo: 'Outorgado: estado civil', tipo: 'texto' },
    { id: 'outorgado_profissao', rotulo: 'Outorgado: profissão', tipo: 'texto' },
    { id: 'outorgado_endereco', rotulo: 'Outorgado: endereço', tipo: 'texto' },
    { id: 'outorgado_email', rotulo: 'Outorgado: e-mail', tipo: 'texto' },
    { id: 'outorgante_rg', rotulo: 'Representante da outorgante: RG e órgão', tipo: 'texto', copiar: false },
    { id: 'outorgante_nacionalidade', rotulo: 'Representante da outorgante: nacionalidade', tipo: 'texto', copiar: false },
    { id: 'outorgante_estado_civil', rotulo: 'Representante da outorgante: estado civil', tipo: 'texto', copiar: false },
    { id: 'outorgante_ato', rotulo: 'Representação conforme (ex.: contrato social e última alteração)', tipo: 'texto', copiar: false },
    { id: 'poderes', rotulo: 'Poderes concedidos (marque um a um)', tipo: 'multi', opcoes: Object.entries(PODERES), obrig: true, copiar: false },
    { id: 'abrangencia', rotulo: 'Perante quais órgãos', tipo: 'texto',
      padrao: 'órgãos e entidades da Administração Pública direta e indireta da União, dos Estados, do Distrito Federal e dos Municípios' },
    { id: 'plataformas', rotulo: 'Plataformas', tipo: 'texto', padrao: 'Compras.gov.br e demais plataformas indicadas nos editais' },
    { id: 'substabelecimento', rotulo: 'Substabelecimento', tipo: 'sel', opcoes: Object.entries(SUBSTABELECIMENTO), padrao: 'vedado', obrig: true },
    { id: 'prazo_meses', rotulo: 'Validade (meses)', tipo: 'numero', padrao: 12, obrig: true },
  ],
};

// ---------- Formatação brasileira ----------
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
export function fmtDoc(v) {
  const d = soDigitos(v);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(v ?? '');
}
export const fmtCep = (v) => { const d = soDigitos(v); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(v ?? ''); };
export function fmtTelefone(v) {
  const d = soDigitos(v).replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? '');
}
export const fmtMoeda = (v) => BRL.format(Number(v));
export const fmtPct = (v) => `${String(Number(v)).replace('.', ',')}%`;
export function dataExtenso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : '';
}
const vazio = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);
const t = (v) => (vazio(v) ? '' : String(v).trim());
const num = (v) => (vazio(v) || !Number.isFinite(Number(v)) ? null : Number(v));
const extensoMoeda = (v) => { try { return reaisPorExtenso(v); } catch { return ''; } };
const valorComExtenso = (v) => `${fmtMoeda(v)}${extensoMoeda(v) ? ` (${extensoMoeda(v)})` : ''}`;

/** Endereço numa linha: "Rua X, 10, Bairro, Vila Velha/ES, CEP 29100-000" (só as partes informadas). */
export function enderecoLinha(p) {
  const cidade = [t(p.municipio), t(p.uf)].filter(Boolean).join('/');
  return [t(p.endereco), t(p.bairro), cidade, t(p.cep) ? `CEP ${fmtCep(p.cep)}` : ''].filter(Boolean).join(', ');
}

// ---------- Partes ----------
// "me" = Minha Empresa (quem presta o serviço); "cli" = empresa assessorada (cadastro central).
// Os dois chegam já normalizados: { tipo_pessoa, nome, documento, endereco..., rep_nome, rep_cpf, rep_cargo, email, telefone }
export function parteMinhaEmpresa(m) {
  if (!m) return null;
  return { tipo_pessoa: m.tipo_pessoa, nome: m.nome, nome_fantasia: m.nome_fantasia, documento: m.documento, ie: m.ie, im: m.im,
    endereco: m.endereco, bairro: m.bairro, municipio: m.municipio, uf: m.uf, cep: m.cep,
    rep_nome: m.representante_nome, rep_cpf: m.representante_cpf, rep_cargo: m.representante_cargo,
    rep_rg: m.representante_rg, rep_nacionalidade: m.representante_nacionalidade, rep_estado_civil: m.representante_estado_civil, rep_profissao: m.representante_profissao,
    email: m.email, email_documentos: m.email_documentos, telefone: m.telefone,
    banco: m.banco ? { banco: m.banco, agencia: m.agencia, conta: m.conta, tipo_conta: m.tipo_conta, titular: m.titular, titular_documento: m.titular_documento, pix: m.pix } : null,
    logo: m.logo_caminho || null };
}
export function parteCliente(c) {
  if (!c) return null;
  return { tipo_pessoa: c.tipo_pessoa || 'PJ', nome: c.razao_social, nome_fantasia: c.nome_fantasia, documento: c.cnpj,
    endereco: c.endereco, municipio: c.municipio, uf: c.uf, cep: c.cep,
    rep_nome: c.resp_nome, rep_cpf: c.resp_cpf, rep_cargo: c.resp_cargo,
    email: c.email, email_documentos: c.email_documentos, telefone: c.telefone || c.resp_telefone };
}

/** O que falta no cadastro de uma parte para ela aparecer qualificada no documento. */
export function faltasParte(p, quem) {
  if (!p) return [`${quem}: não selecionada`];
  const f = [];
  const pj = p.tipo_pessoa !== 'PF';
  if (!t(p.nome)) f.push(`${quem}: ${pj ? 'razão social' : 'nome'}`);
  if (![11, 14].includes(soDigitos(p.documento).length)) f.push(`${quem}: ${pj ? 'CNPJ' : 'CPF'}`);
  if (!t(p.endereco) || !t(p.municipio) || !t(p.uf)) f.push(`${quem}: endereço completo (rua, cidade e UF)`);
  if (pj && !t(p.rep_nome)) f.push(`${quem}: nome do representante legal`);
  if (pj && soDigitos(p.rep_cpf).length !== 11) f.push(`${quem}: CPF do representante legal`);
  return f;
}

/** Qualificação da parte no estilo dos modelos ("pessoa jurídica de direito privado, inscrita no CNPJ..."). */
export function qualificacao(p, extra = {}) {
  if (!p) return '';
  const end = enderecoLinha(p);
  if (p.tipo_pessoa === 'PF') {
    const pessoais = [t(extra.nacionalidade), t(extra.estado_civil), t(extra.profissao)].filter(Boolean).join(', ');
    return [`${t(p.nome).toUpperCase()}`, pessoais, t(extra.rg) ? `portador(a) do RG nº ${t(extra.rg)}` : '',
      `inscrito(a) no CPF sob o nº ${fmtDoc(p.documento)}`, end ? `residente e domiciliado(a) em ${end}` : ''].filter(Boolean).join(', ');
  }
  const rep = t(p.rep_nome)
    ? [`neste ato representada por seu(sua) ${t(p.rep_cargo) || 'representante legal'}, ${t(p.rep_nome).toUpperCase()}`,
      [t(extra.nacionalidade), t(extra.estado_civil)].filter(Boolean).join(', '),
      t(extra.rg) ? `portador(a) do RG nº ${t(extra.rg)}` : '',
      soDigitos(p.rep_cpf).length === 11 ? `inscrito(a) no CPF sob o nº ${fmtDoc(p.rep_cpf)}` : '',
      t(extra.ato) ? `conforme ${t(extra.ato)}` : ''].filter(Boolean).join(', ')
    : '';
  return [`${t(p.nome).toUpperCase()}`, 'pessoa jurídica de direito privado', `inscrita no CNPJ sob o nº ${fmtDoc(p.documento)}`,
    end ? `com sede em ${end}` : '', rep].filter(Boolean).join(', ');
}

const linhasLista = (txt) => String(txt || '').split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
// Texto editado pelo usuário: parágrafos separados por linha em branco; linhas com "- " ou "• " viram itens
function deTexto(txt) {
  const paragrafos = []; const lista = [];
  for (const bloco of String(txt).split(/\n\s*\n/)) {
    const ls = bloco.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!ls.length) continue;
    if (ls.every((l) => /^[-•*]\s+/.test(l))) lista.push(...ls.map((l) => l.replace(/^[-•*]\s+/, '')));
    else paragrafos.push(ls.join(' '));
  }
  return { paragrafos, lista };
}
/** Texto de uma seção como o usuário edita (parágrafos + itens com "- "). */
export function secaoComoTexto(s) {
  return [...(s.paragrafos || []), ...(s.lista?.length ? [s.lista.map((i) => `- ${i}`).join('\n')] : [])].join('\n\n');
}

function servicosEscolhidos(d) {
  const ids = Array.isArray(d.servicos) ? d.servicos : [];
  return [...ids.filter((i) => SERVICOS[i]).map((i) => SERVICOS[i]), ...linhasLista(d.servicos_extra)];
}
const modalidadesTxt = (d) => {
  const l = (Array.isArray(d.modalidades) ? d.modalidades : []).filter((m) => MODALIDADES.includes(m));
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l.at(-1)}` : l[0] || '';
};
function remuneracao(d, { contrato = false } = {}) {
  const l = [];
  const mensal = num(d.valor_mensal); const exito = num(d.percentual_exito); const dia = num(d.dia_vencimento);
  if (mensal != null) l.push(`Valor mensal fixo de ${valorComExtenso(mensal)}${dia ? `, com vencimento todo dia ${dia}` : ''}.`);
  if (exito != null) l.push(`Comissão de êxito de ${fmtPct(exito)} sobre o ${t(d.base_exito) || 'valor obtido pelo cliente'}, devida somente quando o cliente vencer a licitação.`);
  if (t(d.forma_pagamento_exito)) l.push(t(d.forma_pagamento_exito));
  if (contrato && mensal != null) l.push('A mensalidade é paga contra a emissão da nota fiscal, por depósito ou transferência na conta indicada pela CONTRATADA.');
  return l;
}
// Cláusulas de atraso e encerramento (mesmo conteúdo na proposta e no contrato; muda só quem é quem)
function condicoes(d, { cliente, prazoMinimo }) {
  const atraso = [num(d.multa_atraso_pct) != null ? `multa de ${fmtPct(d.multa_atraso_pct)}` : '', num(d.juros_mes_pct) != null ? `juros de ${fmtPct(d.juros_mes_pct)} ao mês` : ''].filter(Boolean);
  const revisao = t(d.revisao_meses);
  const multa = num(d.multa_rescisoria_pct);
  return {
    atraso: [
      atraso.length ? `O atraso no pagamento sujeita ${cliente} a ${atraso.join(' e ')}, além de correção monetária.` : '',
      num(d.suspensao_dias) != null ? `Com mais de ${num(d.suspensao_dias)} dias de atraso, os serviços podem ser suspensos, mediante aviso por escrito, até a regularização, sem prejuízo das mensalidades devidas.` : ''],
    encerramento: [
      num(d.aviso_previo_dias) != null ? `Qualquer das partes pode encerrar a prestação dos serviços mediante aviso por escrito com ${num(d.aviso_previo_dias)} dias de antecedência${multa != null && prazoMinimo ? ', observada a multa abaixo' : ', sem indenização'}.` : '',
      revisao ? `Ao fim de ${revisao} meses, as partes podem revisar as condições e, somente nesses momentos, encerrar sem multa.` : '',
      multa != null && prazoMinimo ? `Fora ${revisao ? 'dessas revisões' : 'das hipóteses de descumprimento'}, a parte que encerrar antes de completar ${prazoMinimo} pagará à outra multa de ${fmtPct(multa)} sobre as mensalidades que faltarem até o fim desse prazo.` : '',
      `Em qualquer encerramento, ${cliente} paga as mensalidades até a data de saída e a comissão de êxito das licitações vencidas durante a vigência, que continua devida depois do encerramento, na forma e nos prazos combinados.`],
  };
}

function bancoLinhas(me) {
  const b = me?.banco;
  if (!b) return [];
  const tipos = { corrente: 'conta corrente', poupanca: 'conta poupança', pagamento: 'conta de pagamento' };
  return [`${/^banco\b/i.test(b.banco) ? '' : 'Banco '}${b.banco}, agência ${b.agencia}, ${tipos[b.tipo_conta] || 'conta'} ${b.conta}`,
    `Titular: ${b.titular}${b.titular_documento ? ` (${fmtDoc(b.titular_documento)})` : ''}`, ...(b.pix ? [`PIX: ${b.pix}`] : [])];
}

/** Pendências de preenchimento do passo 4 (campos obrigatórios e regras de cada documento). */
export function pendenciasCampos(tipo, d = {}, me = null) {
  const p = [];
  for (const c of CAMPOS[tipo] || []) if (c.obrig && vazio(d[c.id])) p.push(c.rotulo);
  if (tipo !== 'procuracao' && num(d.valor_mensal) == null && num(d.percentual_exito) == null) p.push('Remuneração: informe o valor mensal e/ou a comissão de êxito');
  if (tipo === 'procuracao' && !vazio(d.outorgado_cpf) && soDigitos(d.outorgado_cpf).length !== 11) p.push('Outorgado: CPF com 11 números');
  if (d.incluir_banco && !me?.banco) p.push('Dados bancários: cadastre-os na Minha Empresa ou desmarque a opção');
  const dia = num(d.dia_vencimento);
  if (dia != null && (dia < 1 || dia > 31)) p.push('Dia de vencimento entre 1 e 31');
  return p;
}

/** Valores iniciais: padrões dos modelos, a última captação (campos copiáveis) e os dados da Minha Empresa. */
export function dadosIniciais(tipo, { ultimo = null, me = null, hoje }) {
  const d = {};
  for (const c of CAMPOS[tipo] || []) {
    if (ultimo && c.copiar !== false && !vazio(ultimo[c.id])) d[c.id] = ultimo[c.id];
    else if (c.padrao !== undefined) d[c.id] = c.padrao;
  }
  if (ultimo?.textos && typeof ultimo.textos === 'object') d.textos = { ...ultimo.textos };
  if (me) {
    const cidade = [t(me.municipio), t(me.uf)].filter(Boolean).join('/');
    if (vazio(d.local) && cidade) d.local = cidade;
    if (tipo === 'contrato' && vazio(d.foro) && cidade) d.foro = cidade;
    if (tipo === 'procuracao' && vazio(d.outorgado_nome)) {
      const pf = me.tipo_pessoa === 'PF';
      Object.assign(d, {
        outorgado_nome: pf ? me.nome : me.representante_nome || '',
        outorgado_cpf: pf ? fmtDoc(me.documento) : me.representante_cpf ? fmtDoc(me.representante_cpf) : '',
        outorgado_rg: me.representante_rg || '', outorgado_nacionalidade: me.representante_nacionalidade || '',
        outorgado_estado_civil: me.representante_estado_civil || '', outorgado_profissao: me.representante_profissao || '',
        outorgado_endereco: pf ? enderecoLinha(me) : '', outorgado_email: me.email || '',
      });
    }
  }
  d.data = hoje;
  return d;
}

// ---------- Montagem ----------
const sec = (id, titulo, paragrafos = [], lista = [], editavel = true) => ({ id, titulo, paragrafos: paragrafos.filter(Boolean), lista: lista.filter(Boolean), editavel });

function proposta({ me, cli, d }) {
  const nomeMe = t(me?.nome_fantasia) || t(me?.nome);
  const s = [];
  s.push(sec('destinatario', null, [`À ${t(cli?.nome)}`, t(cli?.rep_nome) ? `Aos cuidados de ${t(cli.rep_nome)}${t(cli.rep_cargo) ? ` (${t(cli.rep_cargo)})` : ''}` : ''], [], false));
  s.push(sec('apresentacao', 'Apresentação', [
    `Apresentamos nossa proposta de serviços de assessoria em licitações${modalidadesTxt(d) ? ` nas modalidades ${modalidadesTxt(d)}` : ''}, com atuação ${t(d.plataformas) ? `no(s) portal(is) ${t(d.plataformas)}` : 'nos portais indicados nos editais'}.`,
    `A ${nomeMe} trabalha com planejamento, execução, conferência e melhoria contínua (ciclo PDCA), com foco na qualidade do serviço, na transparência e na satisfação do cliente.`,
    'Os termos desta proposta, depois de aprovados, servirão de base para o contrato a ser firmado entre as partes.']));
  s.push(sec('servicos', 'Serviços incluídos', [], servicosEscolhidos(d)));
  s.push(sec('metodologia', 'Como trabalhamos', [
    t(d.horario) ? `Atendimento: ${t(d.horario)}.` : '',
    'Os editais encontrados são enviados por e-mail ao endereço informado pelo cliente, que também pode indicar licitações que não foram enviadas pela assessoria.',
    num(d.antecedencia_horas) != null ? `O cliente informa por escrito as licitações de que deseja participar com antecedência mínima de ${num(d.antecedencia_horas)} horas.` : '',
    num(d.precos_minimos_horas) != null ? `Os preços mínimos são informados pelo cliente, preferencialmente por e-mail, até ${num(d.precos_minimos_horas)} horas antes da disputa. A participação nos lances termina quando o preço mínimo é atingido; nem toda disputa chega a esse valor.` : '',
    'Alterações nos serviços são combinadas por escrito; se gerarem custo adicional, ele é informado antes.']));
  s.push(sec('responsabilidades', 'Responsabilidades', [
    'Do cliente: indicar um contato que forneça informações, documentos e preços; ler o edital; manter válidos os documentos de habilitação; fazer vistorias, enviar amostras e elaborar planilhas de custos e documentos técnicos exigidos; assinar e entregar o que o órgão pedir; e assumir a execução do contrato quando vencer.',
    `Da ${nomeMe}: analisar o edital e avisar o cliente sobre exigências específicas; separar a documentação padrão; cadastrar a proposta depois da confirmação do cliente; participar da sessão; e, quando o cliente vencer, enviar proposta ajustada e documentos no prazo do edital e acompanhar até a homologação.`]));
  s.push(sec('limites', 'O que não está incluído', [
    'Recursos administrativos e medidas judiciais não estão incluídos nesta proposta; se necessários, são orçados à parte.',
    'A assessoria não garante a vitória em licitações: o resultado depende dos preços, dos documentos do cliente, da concorrência e do julgamento do órgão.']));
  const inv = remuneracao(d);
  if (num(d.contratacao_minima_meses) != null) inv.push(`Contratação mínima: ${num(d.contratacao_minima_meses)} meses.`);
  s.push(sec('investimento', 'Investimento', inv, [], false));
  if (d.incluir_banco) s.push(sec('banco', 'Dados para pagamento', [], bancoLinhas(me), false));
  const cp = condicoes(d, { cliente: 'o cliente', prazoMinimo: num(d.contratacao_minima_meses) != null ? `a contratação mínima de ${num(d.contratacao_minima_meses)} meses` : '' });
  s.push(sec('condicoes', 'Atraso e encerramento', [...cp.atraso, ...cp.encerramento], [], false));
  if (t(d.observacoes)) s.push(sec('observacoes', 'Observações', [t(d.observacoes)], [], false));
  s.push(sec('validade', 'Validade', [num(d.validade_dias) != null ? `Proposta válida por ${num(d.validade_dias)} dias a contar da data acima.` : ''], [], false));
  return s;
}

function contrato({ me, cli, d }) {
  const s = [];
  const n = (i) => `CLÁUSULA ${['', 'PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA', 'NONA', 'DÉCIMA', 'DÉCIMA PRIMEIRA', 'DÉCIMA SEGUNDA', 'DÉCIMA TERCEIRA', 'DÉCIMA QUARTA', 'DÉCIMA QUINTA'][i] || i}`;
  let i = 0;
  s.push(sec('partes', 'Partes', [
    `CONTRATANTE: ${qualificacao(cli)}.`,
    `CONTRATADA: ${qualificacao(me)}.`,
    'As partes acima celebram este contrato de prestação de serviços de assessoria, regido pelas cláusulas a seguir.'], [], false));
  s.push(sec('objeto', `${n(++i)} – DO OBJETO`, [
    `Prestação, pela CONTRATADA à CONTRATANTE, de serviços de assessoria em licitações públicas eletrônicas${modalidadesTxt(d) ? ` (${modalidadesTxt(d)})` : ''}${t(d.plataformas) ? `, nos portais ${t(d.plataformas)}` : ''}, com o objetivo de melhorar o desempenho da CONTRATANTE nos procedimentos de que decidir participar.`]));
  s.push(sec('escopo', `${n(++i)} – DO ESCOPO E DOS LIMITES`, [
    'Estão incluídos os serviços abaixo:'], servicosEscolhidos(d)));
  s.push(sec('escopo_limites', null, [
    'Não estão incluídos: recursos administrativos e medidas judiciais; planilhas de custos, cálculos de BDI e demais documentos técnicos; vistorias, amostras e entregas físicas; e a execução do contrato com o órgão. A representação da CONTRATANTE perante os órgãos e sistemas depende de procuração própria, com os poderes nela listados.']));
  const rem = remuneracao(d, { contrato: true });
  const cc = condicoes(d, { cliente: 'a CONTRATANTE', prazoMinimo: num(d.vigencia_meses) != null ? `a vigência de ${num(d.vigencia_meses)} meses` : '' });
  rem.push(...cc.atraso.filter(Boolean));
  s.push(sec('remuneracao', `${n(++i)} – DA REMUNERAÇÃO`, rem, d.incluir_banco ? bancoLinhas(me) : [], false));
  s.push(sec('obrigacoes_contratada', `${n(++i)} – DAS OBRIGAÇÕES DA CONTRATADA`, [], [
    'Executar os serviços com diligência, nos prazos combinados e conforme as regras de cada edital;',
    'Enviar os editais da área de interesse da CONTRATANTE para que ela decida de quais participar;',
    'Preparar a documentação e cadastrar a proposta com os preços informados pela CONTRATANTE;',
    'Participar das sessões escolhidas pela CONTRATANTE, da abertura até a homologação, e informar o resultado;',
    'Apresentar relatório da participação quando solicitado.']));
  s.push(sec('obrigacoes_contratante', `${n(++i)} – DAS OBRIGAÇÕES DA CONTRATANTE`, [], [
    'Indicar um contato responsável por informações, documentos e preços;',
    num(d.antecedencia_horas) != null ? `Informar por escrito as licitações de que deseja participar com antecedência mínima de ${num(d.antecedencia_horas)} horas;` : '',
    num(d.precos_minimos_horas) != null ? `Informar seus preços mínimos até ${num(d.precos_minimos_horas)} horas antes da disputa, sendo sua a decisão sobre esses valores;` : '',
    'Enviar os documentos solicitados e manter válidos os documentos de habilitação;',
    'Elaborar planilhas de custos, descritivos e demais documentos técnicos exigidos no edital;',
    'Assumir a execução do contrato com o órgão quando vencer e pagar a remuneração na forma deste contrato.']));
  s.push(sec('vigencia', `${n(++i)} – DA VIGÊNCIA E DA RENOVAÇÃO`, [
    num(d.vigencia_meses) != null ? `Este contrato vigora por ${num(d.vigencia_meses)} meses a contar da assinatura.` : '',
    d.renovacao === 'automatica' ? 'Ao final, renova-se automaticamente por igual período, salvo aviso por escrito de qualquer das partes com a antecedência prevista na cláusula de rescisão.'
      : d.renovacao === 'aditivo' ? 'A prorrogação depende de termo aditivo assinado pelas partes.' : ''], [], false));
  s.push(sec('rescisao', `${n(++i)} – DA RESCISÃO`, [
    cc.encerramento[0], cc.encerramento[1], cc.encerramento[2],
    'O contrato pode ser rescindido de imediato, sem aviso prévio, em caso de descumprimento de cláusula não corrigido em 10 dias após notificação, recuperação judicial ou extrajudicial ou falência de qualquer das partes; nesse caso, a parte que deu causa responde pelas perdas e danos.',
    cc.encerramento[3]]));
  s.push(sec('confidencialidade', `${n(++i)} – DA CONFIDENCIALIDADE`, [
    'As partes, seus sócios, empregados e prestadores guardarão sigilo sobre as informações a que tiverem acesso em razão deste contrato, inclusive preços e estratégias, e não as usarão nem divulgarão sem autorização prévia e por escrito.']));
  s.push(sec('lgpd', `${n(++i)} – DA PROTEÇÃO DE DADOS PESSOAIS`, [
    'As partes tratarão os dados pessoais recebidos somente para executar este contrato e cumprir obrigações legais, conforme a Lei nº 13.709/2018 (LGPD), com medidas de segurança adequadas, e os eliminarão ao fim da relação, ressalvada a guarda exigida por lei.']));
  s.push(sec('responsabilidades', `${n(++i)} – DAS RESPONSABILIDADES E DOS LIMITES`, [
    'A CONTRATADA atua como assessoria e não garante a vitória em licitações: o resultado depende dos preços, dos documentos da CONTRATANTE, da concorrência e do julgamento do órgão.',
    'A CONTRATADA não responde por desclassificação ou inabilitação causada por preços, planilhas, descritivos ou documentos fornecidos pela CONTRATANTE.',
    'Não há vínculo empregatício nem subordinação entre as partes, e a CONTRATADA pode atender outros clientes.']));
  s.push(sec('gerais', `${n(++i)} – DAS DISPOSIÇÕES GERAIS`, [
    'A tolerância com o descumprimento de qualquer obrigação não significa renúncia ou novação. Alterações só valem por escrito, em termo aditivo assinado. Este contrato substitui propostas e entendimentos anteriores sobre o mesmo objeto e obriga as partes e seus sucessores.']));
  if (t(d.clausulas_adicionais)) s.push(sec('adicionais', `${n(++i)} – DISPOSIÇÕES ADICIONAIS`, [t(d.clausulas_adicionais)], [], false));
  s.push(sec('foro', `${n(++i)} – DO FORO`, [t(d.foro) ? `Fica eleito o foro da comarca de ${t(d.foro)} para resolver questões deste contrato, com renúncia a qualquer outro.` : '',
    'E, por estarem de acordo, as partes assinam este instrumento eletronicamente ou em duas vias de igual teor, com duas testemunhas.'], [], false));
  return s;
}

function procuracao({ cli, d }) {
  const s = [];
  const outorgado = { tipo_pessoa: 'PF', nome: d.outorgado_nome, documento: d.outorgado_cpf };
  const qOutorgado = [`${t(d.outorgado_nome).toUpperCase()}`,
    [t(d.outorgado_nacionalidade), t(d.outorgado_estado_civil), t(d.outorgado_profissao)].filter(Boolean).join(', '),
    t(d.outorgado_rg) ? `portador(a) do RG nº ${t(d.outorgado_rg)}` : '',
    soDigitos(outorgado.documento).length === 11 ? `inscrito(a) no CPF sob o nº ${fmtDoc(outorgado.documento)}` : '',
    t(d.outorgado_endereco) ? `residente em ${t(d.outorgado_endereco)}` : '', t(d.outorgado_email) ? `e-mail ${t(d.outorgado_email)}` : ''].filter(Boolean).join(', ');
  s.push(sec('partes', null, [
    `OUTORGANTE: ${qualificacao(cli, { nacionalidade: d.outorgante_nacionalidade, estado_civil: d.outorgante_estado_civil, rg: d.outorgante_rg, ato: d.outorgante_ato })}, doravante OUTORGANTE.`,
    `OUTORGADO: ${qOutorgado}, doravante OUTORGADO.`], [], false));
  const marcados = (Array.isArray(d.poderes) ? d.poderes : []).filter((p) => PODERES[p]);
  s.push(sec('poderes', 'PODERES', [
    `A OUTORGANTE nomeia o OUTORGADO seu procurador para representá-la perante ${t(d.abrangencia) || 'os órgãos e entidades da Administração Pública'}${t(d.plataformas) ? ` e perante os sistemas eletrônicos de compras públicas (${t(d.plataformas)})` : ''}, com poderes específicos para:`],
  Object.keys(PODERES).filter((p) => marcados.includes(p)).map((p) => `${PODERES[p]};`), false));
  const negados = SENSIVEIS.filter((p) => !marcados.includes(p)).map((p) => PODERES[p].replace(/,.*$/, ''));
  negados.push('receber valores', 'dar quitação');
  if (d.substabelecimento !== 'com_reserva') negados.push('substabelecer');
  s.push(sec('limites', 'LIMITES', [
    `Este instrumento não confere poderes para ${negados.length > 1 ? `${negados.slice(0, -1).join(', ')} ou ${negados.at(-1)}` : negados[0]}, nem para qualquer ato não listado acima, salvo autorização expressa e por escrito da OUTORGANTE.`,
    d.substabelecimento === 'com_reserva' ? 'Fica permitido o substabelecimento, com reserva de iguais poderes.' : ''], [], false));
  s.push(sec('responsabilidade', 'RESPONSABILIDADE', [
    'A OUTORGANTE declara saber que responde pelas propostas e lances apresentados em seu nome, dentro dos limites deste mandato, e que a decisão sobre o preço mínimo de cada item é exclusivamente sua.']));
  s.push(sec('prazo', 'PRAZO', [num(d.prazo_meses) != null ? `Válida por ${num(d.prazo_meses)} meses a contar da assinatura, podendo ser revogada a qualquer tempo mediante comunicação escrita ao OUTORGADO.` : ''], [], false));
  return s;
}

function assinaturas(tipo, { me, cli, d }) {
  const doc = (p) => (p?.documento ? `${p.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'} ${fmtDoc(p.documento)}` : '');
  const rep = (p) => (p?.tipo_pessoa !== 'PF' && t(p?.rep_nome) ? `${t(p.rep_nome)}${t(p.rep_cargo) ? ` – ${t(p.rep_cargo)}` : ''}` : '');
  if (tipo === 'proposta') {
    return [
      { titulo: t(me?.nome), linhas: [doc(me), rep(me)].filter(Boolean) },
      { titulo: `De acordo: ${t(cli?.nome)}`, linhas: [doc(cli), rep(cli), 'Data: ____/____/______'].filter(Boolean) },
    ];
  }
  if (tipo === 'contrato') {
    const test = (k) => ({ titulo: `Testemunha ${k}`, linhas: [`Nome: ${t(d[`testemunha${k}_nome`]) || ''}`, `CPF: ${t(d[`testemunha${k}_cpf`]) ? fmtDoc(d[`testemunha${k}_cpf`]) : ''}`] });
    return [
      { titulo: `CONTRATANTE: ${t(cli?.nome)}`, linhas: [doc(cli), rep(cli)].filter(Boolean) },
      { titulo: `CONTRATADA: ${t(me?.nome)}`, linhas: [doc(me), rep(me)].filter(Boolean) },
      test(1), test(2),
    ];
  }
  return [{ titulo: t(cli?.nome), linhas: [doc(cli), rep(cli)].filter(Boolean) }];
}

/**
 * Documento pronto para a tela e para o PDF.
 * @returns {{ titulo, numero, local_data, secoes, assinaturas, pendencias }}
 */
export function montarDocumento(tipo, { me, cli, dados = {}, numero }) {
  if (!TIPOS_DOC[tipo]) throw Object.assign(new Error('Tipo de documento inválido.'), { status: 400 });
  const d = dados || {};
  const base = { proposta, contrato, procuracao }[tipo]({ me, cli, d });
  // Textos editados pelo usuário substituem o texto padrão da seção (só nas seções editáveis)
  const textos = d.textos && typeof d.textos === 'object' ? d.textos : {};
  const secoes = base.map((s) => {
    if (!s.editavel || typeof textos[s.id] !== 'string' || !textos[s.id].trim()) return { ...s, editada: false };
    return { ...s, ...deTexto(textos[s.id]), editada: true };
  }).filter((s) => s.paragrafos.length || s.lista.length || s.titulo === null);
  const pendencias = [
    ...faltasParte(cli, 'Empresa assessorada'),
    ...(tipo === 'procuracao' ? [] : faltasParte(me, 'Minha Empresa')),
    ...pendenciasCampos(tipo, d, me),
  ];
  const localData = [t(d.local), dataExtenso(d.data)].filter(Boolean).join(', ');
  return { tipo, titulo: TITULO_DOC[tipo], numero: numero || null, local_data: localData ? `${localData}.` : '', secoes, assinaturas: assinaturas(tipo, { me, cli, d }), pendencias,
    destaques: destaquesDoc(tipo, { me, cli, d }) };
}

// Palavras e nomes em negrito no corpo do documento (pedido do Guido): os papéis das partes em todo o texto
// e o nome de cada parte na qualificação.
export const PAPEIS = { contrato: ['CONTRATANTE', 'CONTRATADA'], procuracao: ['OUTORGANTE', 'OUTORGADO', 'OUTORGADA'], proposta: [] };
function destaquesDoc(tipo, { me, cli, d }) {
  const nomes = tipo === 'contrato' ? [cli?.nome, me?.nome] : tipo === 'procuracao' ? [cli?.nome, d.outorgado_nome] : [];
  return [...PAPEIS[tipo], ...nomes.map((x) => t(x).toUpperCase()).filter((x) => x.length >= 3)];
}

/** Texto padrão de cada seção editável (para o botão "restaurar padrão" da tela). */
export function textosPadrao(tipo, ctx) {
  const semEdicao = { ...ctx, dados: { ...(ctx.dados || {}), textos: {} } };
  return Object.fromEntries(montarDocumento(tipo, semEdicao).secoes.filter((s) => s.editavel).map((s) => [s.id, { titulo: s.titulo, texto: secaoComoTexto(s) }]));
}
