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
      const resultado = { ...n, cnpj, responsavel: responsavelProvavel(n.socios), fonte: f.nome, consultado_em: new Date(agora).toISOString() };
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

/** Só para testes. */
export function _limparCacheCnpj() { cache.clear(); }
