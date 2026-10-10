// Sistemas eletrônicos de disputa (onde o fornecedor envia proposta e dá lances), identificados pelo
// "usuarioNome" que o PNCP informa (sistema que publicou) e pelo link de origem.
// ATENÇÃO: o PNCP informa quem PUBLICOU. Quando é o sistema de gestão do órgão (ex.: E&L, Betha, AZ),
// a disputa pode ocorrer em outra plataforma: nesses casos o sistema fica "outro" e a tela pede para conferir o edital.
//
// Custo para o fornecedor: só marcamos "pago"/"gratuito" com fonte; sem fonte, fica "nao_verificado".
// Consultas feitas em 10/10/2026.

export const SISTEMAS = {
  comprasgov: {
    nome: 'Compras.gov.br (Comprasnet)', custo: 'gratuito',
    resumo: 'Gratuito para o fornecedor. Cadastro pelo SICAF, com conta gov.br.',
    cadastro: 'https://www.gov.br/compras/pt-br', fonte: 'https://conlicitacao.com.br/portais-de-compras-publicas/',
    nomes: /compras\.gov|comprasnet|siasg/i, hosts: /compras\.gov\.br|comprasnet\.gov\.br|cnetmobile/i,
  },
  licitacoes_e: {
    nome: 'Licitações-e (Banco do Brasil)', custo: 'pago',
    resumo: 'Cobra taxa de uso do fornecedor (plano mensal ou anual pago ao Banco do Brasil). Credenciamento em agência do BB.',
    cadastro: 'https://www.licitacoes-e.com.br/aop/documentos/CartilhaFornecedor.pdf', fonte: 'https://conlicitacao.com.br/licitacoes-e-o-site-de-licitacoes-do-banco-do-brasil/',
    nomes: /licita[cç][oõ]es[\s-]?e\b/i, hosts: /licitacoes-e\.com\.br/i,
  },
  bll: {
    nome: 'BLL Compras', custo: 'pago',
    resumo: 'Plano por período de R$ 630 (90 dias) ou taxa de 1,5% só se vencer (máx. R$ 600 por lote), conforme o Regulamento BLL 2026.',
    cadastro: 'https://bll.org.br/', fonte: 'https://bll.org.br/wp-content/uploads/2026/07/Regulamento-BLL-2026.pdf',
    nomes: /\bbll\b/i, hosts: /bll\.org\.br|bllcompras/i,
  },
  bnc: {
    nome: 'BNC (Bolsa Nacional de Compras)', custo: 'pago',
    resumo: 'Cadastro gratuito, mas para disputar é preciso contratar um plano.',
    cadastro: 'https://bnc.org.br/cadastro/', fonte: 'https://effecti.com.br/bnc-compras/',
    nomes: /\bbnc\b|bolsa nacional de compras/i, hosts: /bnc\.org\.br|bnccompras/i,
  },
  bbmnet: {
    nome: 'BBMNET', custo: 'pago',
    resumo: 'Planos de R$ 196 (1 mês) a R$ 742 (12 meses), ou R$ 155 por edital de pregão/concorrência.',
    cadastro: 'https://sistema.bbmnet.com.br/', fonte: 'https://bbmnet.com.br/custos/',
    nomes: /bbmnet|\bbbm\b/i, hosts: /bbmnet/i,
  },
  pcp: {
    nome: 'Portal de Compras Públicas', custo: 'pago',
    resumo: 'Acesso pago para o fornecedor (valores pela central: 3003-5455).',
    cadastro: 'https://www.portaldecompraspublicas.com.br/cadastre-se', fonte: 'https://conlicitacao.com.br/portais-de-compras-publicas/',
    nomes: /^portal de compras p[uú]blicas$/i, hosts: /portaldecompraspublicas\.com\.br/i,
  },
  licitanet: {
    nome: 'Licitanet', custo: 'nao_verificado', resumo: 'Custo para o fornecedor não verificado: confira no site antes de participar.',
    cadastro: 'https://licitanet.com.br/', fonte: null, nomes: /licitanet/i, hosts: /licitanet\.com\.br/i,
  },
  licitar_digital: {
    nome: 'Licitar Digital', custo: 'nao_verificado', resumo: 'Custo para o fornecedor não verificado: confira no site antes de participar.',
    cadastro: 'https://licitar.digital/', fonte: null, nomes: /licitar digital/i, hosts: /licitar\.digital|licitardigital/i,
  },
  compras_rj: {
    nome: 'Compras RJ (SIGA, Estado do RJ)', custo: 'nao_verificado', resumo: 'Portal do Governo do Estado do RJ. Custo não verificado.',
    cadastro: 'https://www.compras.rj.gov.br/', fonte: null, nomes: /estado do rio de janeiro/i, hosts: /compras\.rj\.gov\.br/i,
  },
  outro: {
    nome: 'Outro / sistema do órgão', custo: 'nao_verificado',
    resumo: 'O PNCP informa só quem publicou (muitas vezes o sistema de gestão da prefeitura). Confira no edital em qual plataforma será a disputa.',
    cadastro: null, fonte: null, nomes: null, hosts: null,
  },
};

const ORDEM = Object.keys(SISTEMAS).filter((k) => k !== 'outro');

function host(link) {
  try { return new URL(link).host; } catch { return ''; }
}

/** Chave do sistema eletrônico a partir do nome publicado no PNCP e do link de origem. */
export function sistemaDe(plataforma, link) {
  const h = host(link);
  for (const k of ORDEM) if (h && SISTEMAS[k].hosts.test(h)) return k;
  for (const k of ORDEM) if (plataforma && SISTEMAS[k].nomes.test(plataforma)) return k;
  return plataforma || link ? 'outro' : null;
}

/** Catálogo para a tela (sem as expressões regulares). */
export function catalogoSistemas() {
  return Object.fromEntries(Object.entries(SISTEMAS).map(([k, s]) => [k, { nome: s.nome, custo: s.custo, resumo: s.resumo, cadastro: s.cadastro, fonte: s.fonte }]));
}

/** Preenche sistema_eletronico das licitações antigas, em lotes (chamar até devolver 0). */
export function classificarSistemasPendentes(conn, lote = 5000) {
  const linhas = conn.prepare(`SELECT id, plataforma_origem p, link_origem l FROM licitacoes
    WHERE sistema_eletronico IS NULL AND (plataforma_origem IS NOT NULL OR link_origem IS NOT NULL) LIMIT ?`).all(lote);
  if (!linhas.length) return 0;
  const up = conn.prepare('UPDATE licitacoes SET sistema_eletronico=? WHERE id=?');
  conn.exec('BEGIN');
  try { for (const r of linhas) up.run(sistemaDe(r.p, r.l) || 'outro', r.id); conn.exec('COMMIT'); }
  catch (e) { conn.exec('ROLLBACK'); throw e; }
  return linhas.length;
}

/** Roda a classificação em segundo plano, um lote por vez, sem travar o servidor. */
export function classificarSistemasEmSegundoPlano(conn, { lote = 5000, log = console.log } = {}) {
  let total = 0;
  const passo = () => {
    try {
      const n = classificarSistemasPendentes(conn, lote);
      total += n;
      if (n) setTimeout(passo, 50); else if (total) log(`Sistemas eletrônicos classificados: ${total} licitações.`);
    } catch (e) { log(`Falha ao classificar sistemas eletrônicos: ${e.message}`); }
  };
  setTimeout(passo, 1000);
}
