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
      const resultado = { ...n, cnpj, responsavel: responsavelProvavel(n.socios), palavras_sugeridas: sugerirPalavras(n.cnaes), fonte: f.nome, consultado_em: new Date(agora).toISOString() };
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
const PREFIXOS = /^(com[eé]rcio (varejista|atacadista)( especializado)?( de| em)?|com[eé]rcio( de)?|fabrica[cç][aã]o( de)?|servi[cç]os?( de)?|atividades?( de)?|aluguel( de)?|loca[cç][aã]o( de)?|manuten[cç][aã]o e repara[cç][aã]o( de)?|repara[cç][aã]o e manuten[cç][aã]o( de)?|manuten[cç][aã]o( de)?|instala[cç][aã]o( de)?|confec[cç][aã]o( de)?|edi[cç][aã]o( de)?|desenvolvimento( de)?|prepara[cç][aã]o( de)?|impress[aã]o( de)?|obras?( de)?|constru[cç][aã]o( de)?|representantes comerciais e agentes do com[eé]rcio( de)?|intermedi[aá]rios do com[eé]rcio( de)?|outras?|outros|produtos?( de)?|artigos?( de)?)\s+/i;
const GENERICAS = new Set(['equipamentos', 'produtos', 'artigos', 'materiais', 'material', 'pecas', 'peças', 'acessorios', 'acessórios', 'maquinas', 'máquinas', 'aparelhos', 'partes', 'bens', 'outros', 'outras', 'geral', 'em geral', 'suprimentos', 'servicos', 'serviços', 'utensilios', 'utensílios', 'mercadorias', 'diversos', 'similares']);
export function sugerirPalavras(cnaes = []) {
  const out = [];
  for (const c of cnaes) {
    let t = String(c.descricao || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[;:].*$/, '').replace(/,? ?(exceto|n[aã]o especificad[oa]s? anteriormente|n[aã]o especificad[oa]s?).*$/, '').trim();
    t = t.replace(/\b(em geral|especializad[oa]s? em|com predomin[aâ]ncia d[eoa]s? \S+|com \S+ \S+)\b/g, ' ').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 4 && PREFIXOS.test(t); i++) t = t.replace(PREFIXOS, '').trim();
    for (let parte of t.split(/,| e | ou /)) {
      parte = parte.trim().replace(/^(de|do|da|dos|das|para|em)\s+/, '');
      // "suprimentos de informática" -> "informática"; "material de escritório" fica inteiro (material é genérico)
      const m = parte.match(/^(\S+) (de|para|do|da|dos|das) (.+)$/);
      if (m && !GENERICAS.has(m[1]) && !/^(material|artigos?|produtos?|equipamentos?)$/.test(m[1])) parte = m[1];
      else if (m && GENERICAS.has(m[1]) && m[1] !== 'material') parte = m[3];
      parte = parte.replace(/\s+/g, ' ').trim();
      if (parte.length >= 4 && !GENERICAS.has(parte) && parte.split(' ').length <= 4 && !out.includes(parte)) out.push(parte);
    }
  }
  return out.slice(0, 15);
}

/** Só para testes. */
export function _limparCacheCnpj() { cache.clear(); }
