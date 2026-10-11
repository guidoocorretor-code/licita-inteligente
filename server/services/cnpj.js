// Consulta de CNPJ em bases públicas que republicam os Dados Abertos do CNPJ da Receita Federal
// (https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj).
// O site da Receita (Comprovante de Inscrição) exige CAPTCHA e não é consultado.
// A base pública traz e-mail e telefone DA EMPRESA e o nome/qualificação dos sócios;
// e-mail e telefone pessoais do representante legal não são públicos.
import { getJson, ErroHttp } from '../lib/http.js';
import { validarCnpj } from './clientes.js';

const FONTES = [
  { nome: 'BrasilAPI', url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, normalizar: deBrasilApi },
  { nome: 'CNPJ.ws (pública)', url: (c) => `https://publica.cnpj.ws/cnpj/${c}`, normalizar: deCnpjWs },
];
const CACHE_MS = 24 * 3600 * 1000;
const cache = new Map();

const texto = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

function telefone(ddd, numero) {
  const d = soDigitos(`${ddd ?? ''}${numero ?? ''}`);
  if (d.length < 10) return null;
  const ddd2 = d.slice(0, 2); const n = d.slice(2);
  return `(${ddd2}) ${n.length === 9 ? `${n.slice(0, 5)}-${n.slice(5)}` : `${n.slice(0, 4)}-${n.slice(4)}`}`;
}

export function portePadrao(descricao, mei = false) {
  if (mei) return 'MEI';
  const p = String(descricao || '').toUpperCase();
  if (/MICRO/.test(p) || p === 'ME' || p === '01') return 'ME';
  if (/PEQUENO/.test(p) || p === 'EPP' || p === '03') return 'EPP';
  if (/DEMAIS/.test(p) || p === '05') return 'Demais';
  return null;
}

/** Quem assina pela empresa: sócio com "Administrador"/"Presidente"/"Diretor" na qualificação; senão o primeiro. */
export function responsavelProvavel(socios) {
  if (!socios?.length) return null;
  return socios.find((s) => /administrador|presidente|diretor|titular|empres[áa]rio/i.test(s.qualificacao || '')) || socios[0];
}

/** "4751201" -> "4751-2/01" */
export function fmtCnae(c) {
  const d = soDigitos(c).padStart(7, '0');
  return d.length === 7 && d !== '0000000' ? `${d.slice(0, 4)}-${d[4]}/${d.slice(5)}` : null;
}
const cnae = (codigo, descricao, principal) => { const c = fmtCnae(codigo); return c && texto(descricao) ? { codigo: c, descricao: texto(descricao), principal } : null; };

export function deBrasilApi(d) {
  return {
    cnpj: soDigitos(d.cnpj),
    razao_social: texto(d.razao_social),
    nome_fantasia: texto(d.nome_fantasia),
    porte: portePadrao(d.porte || d.descricao_porte, d.opcao_pelo_mei === true),
    uf: texto(d.uf),
    municipio: texto(d.municipio),
    email: texto(d.email)?.toLowerCase() || null,
    telefone: telefone(null, d.ddd_telefone_1) || telefone(null, d.ddd_telefone_2),
    situacao: texto(d.descricao_situacao_cadastral),
    atividade: texto(d.cnae_fiscal_descricao),
    socios: (d.qsa || []).map((s) => ({ nome: texto(s.nome_socio), qualificacao: texto(s.qualificacao_socio) })).filter((s) => s.nome),
    cnaes: [cnae(d.cnae_fiscal, d.cnae_fiscal_descricao, true), ...(d.cnaes_secundarios || []).map((c) => cnae(c.codigo, c.descricao, false))].filter(Boolean),
  };
}

export function deCnpjWs(d) {
  const e = d.estabelecimento || {};
  return {
    cnpj: soDigitos(e.cnpj),
    razao_social: texto(d.razao_social),
    nome_fantasia: texto(e.nome_fantasia),
    porte: portePadrao(d.porte?.descricao, d.simples?.mei === 'Sim'),
    uf: texto(e.estado?.sigla),
    municipio: texto(e.cidade?.nome),
    email: texto(e.email)?.toLowerCase() || null,
    telefone: telefone(e.ddd1, e.telefone1) || telefone(e.ddd2, e.telefone2),
    situacao: texto(e.situacao_cadastral),
    atividade: texto(e.atividade_principal?.descricao),
    socios: (d.socios || []).map((s) => ({ nome: texto(s.nome), qualificacao: texto(s.qualificacao_socio?.descricao) })).filter((s) => s.nome),
    cnaes: [cnae(e.atividade_principal?.id, e.atividade_principal?.descricao, true),
      ...(e.atividades_secundarias || []).map((c) => cnae(c.id, c.descricao, false))].filter(Boolean),
  };
}

/** Consulta o CNPJ nas fontes públicas, na ordem, e devolve os dados normalizados (ou um erro claro). */
export async function consultarCnpj(cnpjBruto, { fetchImpl, agora = Date.now() } = {}) {
  const cnpj = validarCnpj(cnpjBruto);
  if (!cnpj) { const e = new Error('CNPJ inválido. Confira os 14 números.'); e.status = 400; throw e; }
  const guardado = cache.get(cnpj);
  if (guardado && agora - guardado.em < CACHE_MS) return guardado.dados;
  const falhas = [];
  for (const f of FONTES) {
    try {
      const { dados } = await getJson(f.url(cnpj), { tentativas: 2, tentativas429: 1, baseEsperaMs: 500, ...(fetchImpl ? { fetchImpl } : {}) });
      if (!dados) { falhas.push(`${f.nome}: resposta vazia`); continue; }
      const n = f.normalizar(dados);
      if (!n.razao_social) { falhas.push(`${f.nome}: sem razão social`); continue; }
      const resultado = { ...n, cnpj, responsavel: responsavelProvavel(n.socios), palavras_sugeridas: sugerirPalavras(n.cnaes, n.razao_social), palavras_opcionais: sugerirRamo(n.cnaes, n.razao_social).opcionais, fonte: f.nome, consultado_em: new Date(agora).toISOString() };
      cache.set(cnpj, { em: agora, dados: resultado });
      return resultado;
    } catch (e) {
      if (e instanceof ErroHttp && e.status === 404) {
        const err = new Error('CNPJ não encontrado na base pública da Receita.'); err.status = 404; throw err;
      }
      falhas.push(`${f.nome}: ${e.status ? `HTTP ${e.status}` : e.message}`);
    }
  }
  const err = new Error(`Não foi possível consultar o CNPJ agora (${falhas.join('; ')}). Preencha manualmente ou tente de novo em alguns minutos.`);
  err.status = 502; throw err;
}

// Palavras do ramo a partir das descrições dos CNAEs: tira o tipo de atividade ("Comércio varejista de",
// "Fabricação de"...) e fica com o assunto ("informática", "papelaria", "material de escritório").
// É uma sugestão: o usuário revisa, porque são essas palavras que contam as licitações do ramo da empresa.
const PREFIXOS = /^(com[eé]rcio a varejo( de)?|com[eé]rcio (varejista|atacadista)( especializado)?( de| em)?|com[eé]rcio( de)?|fabrica[cç][aã]o( de)?|servi[cç]os?( de)?|atividades?( de)?|aluguel( de)?|loca[cç][aã]o( de)?|manuten[cç][aã]o e repara[cç][aã]o( de)?|repara[cç][aã]o e manuten[cç][aã]o( de)?|manuten[cç][aã]o( de)?|instala[cç][aã]o( de)?|confec[cç][aã]o( de)?|edi[cç][aã]o( de)?|desenvolvimento( de)?|prepara[cç][aã]o( de)?|impress[aã]o( de)?|obras?( de)?|constru[cç][aã]o( de)?|representantes comerciais e agentes do com[eé]rcio( de)?|intermedi[aá]rios do com[eé]rcio( de)?|outras?|outros|produtos?( de)?|artigos?( de)?)\s+/i;
const GENERICAS = new Set(['equipamentos', 'produtos', 'artigos', 'materiais', 'material', 'pecas', 'peças', 'acessorios', 'acessórios', 'maquinas', 'máquinas', 'aparelhos', 'partes', 'bens', 'outros', 'outras', 'geral', 'em geral', 'suprimentos', 'servicos', 'serviços', 'utensilios', 'utensílios', 'mercadorias', 'diversos', 'similares',
  'lojas', 'comunicação', 'vídeo', 'áudio', 'novos', 'usados', 'varejo', 'atacado', 'uso doméstico', 'viagem', 'variedades']);

// Termos que os órgãos usam nos editais para cada CNAE (código completo ou classe de 4 dígitos).
// Mais confiável que extrair palavras da descrição, que é técnica e gera termos amplos demais.
const TERMOS_CNAE = {
  4751: ['informática', 'computador', 'notebook', 'impressora', 'toner', 'cartucho', 'suprimentos de informática'],
  9511: ['manutenção de computadores', 'manutenção de impressoras'],
  8599603: ['treinamento em informática'],
  4761: ['papelaria', 'material de expediente', 'papel A4'],
  4789007: ['material de escritório'],
  4742: ['material elétrico'],
  4744: ['material de construção', 'ferragens'],
  4752: ['telefonia', 'aparelho telefônico'],
  4753: ['eletrodomésticos', 'eletroeletrônicos'],
  4754701: ['mobiliário', 'móveis'],
  4754702: ['colchão'],
  4754703: ['iluminação', 'luminária'],
  4755503: ['cama, mesa e banho', 'enxoval'],
  4755502: ['armarinho', 'aviamentos'],
  4763601: ['brinquedos', 'material recreativo'],
  4763: ['material esportivo'],
  4772: ['higiene pessoal'],
  4789005: ['material de limpeza', 'saneantes'],
  4729: ['gêneros alimentícios'],
  4721: ['gêneros alimentícios', 'hortifruti'],
  4711: ['gêneros alimentícios'],
  4712: ['gêneros alimentícios'],
  4732: ['lubrificantes'],
  4731: ['combustível'],
  4541: ['peças para motocicletas'],
  4530: ['peças automotivas', 'autopeças'],
  4520: ['manutenção de veículos'],
  4771: ['medicamentos'],
  4773: ['material médico-hospitalar'],
  4774: ['óculos', 'material óptico'],
  4781: ['uniformes', 'vestuário'],
  4782201: ['calçados'],
  4782202: [],
  4645: ['material médico-hospitalar', 'material odontológico'],
  4644: ['medicamentos'],
  4647: ['papelaria', 'material de escritório'],
  4649: ['material de limpeza', 'eletrodomésticos'],
  4651: ['informática', 'computador'],
  4652: ['componentes eletrônicos', 'telefonia'],
  4661: ['máquinas agrícolas'],
  4663: ['máquinas e equipamentos industriais'],
  4665: ['mobiliário', 'móveis'],
  4672: ['ferragens', 'ferramentas'],
  4673: ['material elétrico'],
  4679: ['material de construção'],
  4684: ['produtos químicos'],
  4685: ['tubos', 'conexões'],
  8121: ['limpeza', 'conservação predial'],
  8111: ['facilities', 'manutenção predial'],
  8011: ['vigilância'],
  4930: ['transporte de cargas'],
  4929: ['transporte de passageiros', 'locação de ônibus'],
  4120: ['obras', 'construção civil'],
  4321: ['instalações elétricas'],
  4322: ['instalações hidráulicas', 'ar-condicionado'],
  3314: ['manutenção de máquinas'],
  3319: ['manutenção de equipamentos'],
  5611: ['alimentação', 'refeições'],
  5620: ['alimentação', 'refeições', 'buffet'],
  6201: ['software', 'sistema'],
  6204: ['tecnologia da informação'],
  6209: ['suporte técnico em informática'],
  6311: ['hospedagem', 'processamento de dados'],
  6190: ['internet', 'link de dados'],
  7319: ['publicidade'],
  7311: ['publicidade'],
  1813: ['gráfica', 'impressos'],
  1821: ['gráfica', 'impressos'],
  8219: ['cópias', 'reprografia'],
  7739: ['locação de máquinas e equipamentos'],
  7711: ['locação de veículos'],
};
// CNAEs "guarda-chuva" que entram no cartão só por precaução e trazem licitações de tudo
const IGNORAR_CNAE = /^(4713-0\/0[1-5]|47\d\d-\d\/99|46\d\d-\d\/99|4762-8\/00|4789-0\/01|4789-0\/09)$/;

function termosDaDescricao(descricao) {
  const out = [];
  let t = String(descricao || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[;:].*$/, '').replace(/,? ?(exceto|n[aã]o especificad[oa]s? anteriormente|n[aã]o especificad[oa]s?).*$/, '').trim();
  t = t.replace(/\b(em geral|especializad[oa]s? em|com predomin[aâ]ncia d[eoa]s? \S+|com \S+ \S+)\b/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4 && PREFIXOS.test(t); i++) t = t.replace(PREFIXOS, '').trim();
  for (let parte of t.split(/,| e | ou /)) {
    parte = parte.trim().replace(/^(de|do|da|dos|das|para|em)\s+/, '');
    // "suprimentos de informática" -> "informática"; "material de escritório" fica inteiro (material é genérico)
    const m = parte.match(/^(\S+) (de|para|do|da|dos|das) (.+)$/);
    if (m && !GENERICAS.has(m[1]) && !/^(material|artigos?|produtos?|equipamentos?)$/.test(m[1])) parte = m[1];
    else if (m && GENERICAS.has(m[1]) && m[1] !== 'material') parte = m[3];
    parte = parte.replace(/\s+/g, ' ').trim();
    if (parte.length >= 4 && !GENERICAS.has(parte) && parte.split(' ').length <= 3 && !/\b(novos|usados|varejo|atacado)\b/.test(parte)) out.push(parte);
  }
  return out;
}

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function termosDoCnae(c) {
  const cod = String(c.codigo || ''); const d = soDigitos(cod);
  if (IGNORAR_CNAE.test(cod)) return [];
  return TERMOS_CNAE[d] || TERMOS_CNAE[d.slice(0, 4)] || (c.principal || !d ? termosDaDescricao(c.descricao) : []);
}

/**
 * Palavras do ramo a partir dos CNAEs. Conservador de propósito: entram os termos do CNAE principal
 * e dos secundários ligados ao nome da empresa (ex.: "Papéis" → papelaria). Os demais secundários
 * (muitas vezes registrados só por precaução) viram sugestões opcionais, para o usuário escolher.
 * Retorna { palavras, opcionais }.
 */
export function sugerirRamo(cnaes = [], nome = '') {
  const radicais = semAcento(nome).split(/[^a-z]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 4));
  const ligadoAoNome = (c) => radicais.some((r) => semAcento(c.descricao).split(/[^a-z]+/).some((w) => w.startsWith(r)));
  const palavras = []; const opcionais = [];
  const add = (lista, t) => { if (![...palavras, ...opcionais].some((x) => x.toLowerCase() === t.toLowerCase())) lista.push(t); };
  const ordem = [...cnaes].sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0));
  for (const c of ordem) {
    const termos = termosDoCnae(c);
    if (c.principal || ligadoAoNome(c)) termos.forEach((t) => add(palavras, t));
  }
  for (const c of ordem) if (!c.principal && !ligadoAoNome(c)) termosDoCnae(c).forEach((t) => add(opcionais, t));
  return { palavras: palavras.slice(0, 12), opcionais: opcionais.slice(0, 40) };
}
export const sugerirPalavras = (cnaes = [], nome = '') => sugerirRamo(cnaes, nome).palavras;

/** Só para testes. */
export function _limparCacheCnpj() { cache.clear(); }
