// Normalização de registros das fontes para o modelo canônico de licitação.
// Regra: nunca inventar. Campo ausente => null. Zero informado => 0.
import crypto from 'node:crypto';

export const ESFERAS = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital', N: 'Não se aplica' };

export const MODALIDADES_PNCP = {
  1: 'Leilão - Eletrônico', 2: 'Diálogo Competitivo', 3: 'Concurso', 4: 'Concorrência - Eletrônica',
  5: 'Concorrência - Presencial', 6: 'Pregão - Eletrônico', 7: 'Pregão - Presencial', 8: 'Dispensa',
  9: 'Inexigibilidade', 10: 'Manifestação de Interesse', 11: 'Pré-qualificação', 12: 'Credenciamento',
  13: 'Leilão - Presencial', 14: 'Inaplicabilidade da Licitação', 15: 'Chamada pública',
  16: 'Concorrência - Eletrônica Internacional', 17: 'Concorrência - Presencial Internacional',
  18: 'Pregão - Eletrônico Internacional', 19: 'Pregão - Presencial Internacional',
};

const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const txt = (v) => (vazio(v) ? null : String(v).trim());
const num = (v) => {
  if (vazio(v)) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const bool = (v) => (v === true ? 1 : v === false ? 0 : null);
const soDigitos = (v) => (vazio(v) ? null : String(v).replace(/\D/g, '') || null);

// Datas da fonte vêm sem fuso (horário de Brasília). Mantemos o texto local "YYYY-MM-DDTHH:mm:ss".
export function dataIso(v) {
  if (vazio(v)) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(s)) return s.slice(0, 19).padEnd(19, ':00').slice(0, 19);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`;
  return null;
}

export function extrairRegimeLegal(...textos) {
  for (const t of textos) {
    if (!t) continue;
    const m = String(t).match(/Lei\s*(?:n[º°o.]*\s*)?(\d{1,2}\.?\d{3})\s*\/\s*(\d{2,4})/i);
    if (m) {
      const numero = m[1].includes('.') ? m[1] : m[1].replace(/(\d+)(\d{3})$/, '$1.$2');
      const ano = m[2].length === 2 ? `19${m[2]}` : m[2];
      return `Lei ${numero}/${ano}`;
    }
  }
  return null;
}

export function plataformaDe(usuarioNome, link) {
  if (txt(usuarioNome)) return txt(usuarioNome);
  if (txt(link)) { try { return new URL(link).host.replace(/^www\./, ''); } catch { /* ignora */ } }
  return null;
}

export function linkPncp(cnpj, ano, seq) {
  return cnpj && ano && seq ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}` : null;
}

export function chaveCanonica(c) {
  if (c.numero_controle_pncp) return `pncp:${c.numero_controle_pncp}`;
  if (c.chave_alternativa) return c.chave_alternativa;
  const partes = [c.orgao_cnpj || c.unidade_codigo, c.modalidade_id, c.numero_compra, c.ano];
  if (partes.some((p) => vazio(p))) return null;
  return `generica:${partes.join('|')}`;
}

// Campos que, quando mudam, geram evento no histórico/jornal
export const CAMPOS_MONITORADOS = [
  'objeto', 'valor_estimado', 'valor_homologado', 'data_abertura_proposta', 'data_encerramento_proposta',
  'situacao_oficial_nome', 'modalidade_nome', 'processo', 'informacao_complementar', 'link_origem',
];

export function hashConteudo(c) {
  const base = CAMPOS_MONITORADOS.map((k) => `${k}=${c[k] ?? ''}`).join('\n');
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
}

function valorEstimadoSituacao(valor, sigiloso) {
  if (sigiloso === true || sigiloso === 1) return 'sigiloso';
  if (valor === null) return 'nao_informado';
  return 'informado';
}

// ---------- PNCP API de consultas (/v1/contratacoes/*) ----------
export function normalizarPncp(r) {
  const org = r.orgaoEntidade || {};
  const un = r.unidadeOrgao || {};
  const cnpj = soDigitos(org.cnpj);
  const valor = num(r.valorTotalEstimado);
  const c = {
    numero_controle_pncp: txt(r.numeroControlePNCP),
    numero_compra: txt(r.numeroCompra),
    ano: num(r.anoCompra),
    sequencial: num(r.sequencialCompra),
    processo: txt(r.processo),
    orgao_cnpj: cnpj,
    orgao_nome: txt(org.razaoSocial),
    esfera: txt(org.esferaId),
    poder: txt(org.poderId),
    unidade_codigo: txt(un.codigoUnidade),
    unidade_nome: txt(un.nomeUnidade),
    uf: txt(un.ufSigla),
    municipio: txt(un.municipioNome),
    codigo_ibge: txt(un.codigoIbge),
    modalidade_id: num(r.modalidadeId),
    modalidade_nome: txt(r.modalidadeNome) || MODALIDADES_PNCP[r.modalidadeId] || null,
    amparo_legal: txt(r.amparoLegal?.nome),
    regime_legal: extrairRegimeLegal(r.amparoLegal?.nome),
    tipo_instrumento: txt(r.tipoInstrumentoConvocatorioNome),
    objeto: txt(r.objetoCompra),
    informacao_complementar: txt(r.informacaoComplementar),
    srp: bool(r.srp),
    valor_estimado: valor,
    valor_estimado_situacao: valorEstimadoSituacao(valor, null),
    valor_homologado: num(r.valorTotalHomologado),
    data_publicacao: dataIso(r.dataPublicacaoPncp),
    data_abertura_proposta: dataIso(r.dataAberturaProposta),
    data_encerramento_proposta: dataIso(r.dataEncerramentoProposta),
    data_sessao: null, // PNCP não informa a data da sessão de disputa separadamente
    situacao_oficial_id: num(r.situacaoCompraId),
    situacao_oficial_nome: txt(r.situacaoCompraNome),
    modo_disputa_id: num(r.modoDisputaId),
    modo_disputa_nome: txt(r.modoDisputaNome),
    plataforma_origem: plataformaDe(r.usuarioNome, r.linkSistemaOrigem),
    link_origem: txt(r.linkSistemaOrigem) || txt(r.linkProcessoEletronico),
    link_pncp: linkPncp(cnpj, r.anoCompra, r.sequencialCompra),
    data_atualizacao_fonte: dataIso(r.dataAtualizacaoGlobal || r.dataAtualizacao),
  };
  c.chave_canonica = chaveCanonica(c);
  c.id_externo = c.numero_controle_pncp;
  return c;
}

// ---------- Compras.gov.br — módulo contratações 14.133 ----------
export function normalizarCompras14133(r) {
  const cnpj = soDigitos(r.orgaoEntidadeCnpj);
  const valor = num(r.valorTotalEstimado);
  const sigiloso = r.orcamentoSigilosoCodigo != null ? Number(r.orcamentoSigilosoCodigo) !== 1 : null;
  const c = {
    numero_controle_pncp: txt(r.numeroControlePNCP),
    numero_compra: txt(r.numeroCompra),
    ano: num(r.anoCompraPncp),
    sequencial: num(r.sequencialCompraPncp),
    processo: txt(r.processo),
    orgao_cnpj: cnpj,
    orgao_nome: txt(r.orgaoEntidadeRazaoSocial),
    esfera: txt(r.orgaoEntidadeEsferaId),
    poder: txt(r.orgaoEntidadePoderId),
    unidade_codigo: txt(r.unidadeOrgaoCodigoUnidade),
    unidade_nome: txt(r.unidadeOrgaoNomeUnidade),
    uf: txt(r.unidadeOrgaoUfSigla),
    municipio: txt(r.unidadeOrgaoMunicipioNome),
    codigo_ibge: txt(r.unidadeOrgaoCodigoIbge),
    modalidade_id: num(r.modalidadeIdPncp),
    modalidade_nome: txt(r.modalidadeNome) || MODALIDADES_PNCP[r.modalidadeIdPncp] || null,
    amparo_legal: txt(r.amparoLegalNome),
    regime_legal: extrairRegimeLegal(r.amparoLegalNome),
    tipo_instrumento: txt(r.tipoInstrumentoConvocatorioNome),
    objeto: txt(r.objetoCompra),
    informacao_complementar: txt(r.informacaoComplementar),
    srp: bool(r.srp),
    valor_estimado: sigiloso ? null : valor,
    valor_estimado_situacao: valorEstimadoSituacao(valor, sigiloso),
    valor_homologado: num(r.valorTotalHomologado),
    data_publicacao: dataIso(r.dataPublicacaoPncp),
    data_abertura_proposta: dataIso(r.dataAberturaPropostaPncp),
    data_encerramento_proposta: dataIso(r.dataEncerramentoPropostaPncp),
    data_sessao: null,
    situacao_oficial_id: num(r.situacaoCompraIdPncp),
    situacao_oficial_nome: txt(r.situacaoCompraNomePncp),
    modo_disputa_id: num(r.modoDisputaIdPncp),
    modo_disputa_nome: txt(r.modoDisputaNomePncp),
    plataforma_origem: 'Compras.gov.br',
    link_origem: null,
    link_pncp: linkPncp(cnpj, r.anoCompraPncp, r.sequencialCompraPncp),
    data_atualizacao_fonte: dataIso(r.dataAtualizacaoPncp),
    excluida: r.contratacaoExcluida === true,
  };
  c.chave_canonica = chaveCanonica(c);
  c.id_externo = txt(r.idCompra) || c.numero_controle_pncp;
  return c;
}

// ---------- Compras.gov.br — módulo legado (SIASG / Lei 8.666) ----------
export function normalizarComprasLegado(r) {
  const valor = num(r.valor_estimado_total);
  const c = {
    numero_controle_pncp: null,
    numero_compra: txt(r.numero_aviso),
    ano: r.data_publicacao ? Number(String(r.data_publicacao).slice(0, 4)) : null,
    sequencial: null,
    processo: txt(r.numero_processo),
    orgao_cnpj: null,
    orgao_nome: null,
    esfera: null,
    poder: null,
    unidade_codigo: txt(r.uasg),
    unidade_nome: null,
    uf: null,
    municipio: null,
    codigo_ibge: null,
    modalidade_id: null, // código próprio do SIASG; não equivale ao código PNCP
    modalidade_nome: txt(r.nome_modalidade),
    amparo_legal: null,
    regime_legal: r.pertence14133 === true ? 'Lei 14.133/2021' : r.pertence14133 === false ? 'Lei 8.666/1993 (ou anterior)' : null,
    tipo_instrumento: null,
    objeto: txt(r.objeto),
    informacao_complementar: txt(r.informacoes_gerais),
    srp: null,
    valor_estimado: valor,
    valor_estimado_situacao: valorEstimadoSituacao(valor, null),
    valor_homologado: num(r.valor_homologado_total),
    data_publicacao: dataIso(r.data_publicacao),
    data_abertura_proposta: dataIso(r.data_abertura_proposta),
    data_encerramento_proposta: null,
    data_sessao: null,
    situacao_oficial_id: null,
    situacao_oficial_nome: txt(r.situacao_aviso),
    modo_disputa_id: null,
    modo_disputa_nome: null,
    plataforma_origem: 'Compras.gov.br (SIASG)',
    link_origem: null,
    link_pncp: null,
    data_atualizacao_fonte: dataIso(r.dt_alteracao),
    num_itens: num(r.numero_itens),
  };
  c.chave_alternativa = r.uasg && r.modalidade && r.numero_aviso ? `siasg:${r.uasg}|${r.modalidade}|${r.numero_aviso}` : null;
  c.chave_canonica = chaveCanonica(c);
  c.id_externo = txt(r.id_compra) || txt(r.identificador);
  return c;
}

export function normalizarItemPncp(i) {
  return {
    numero_item: num(i.numeroItem),
    descricao: txt(i.descricao),
    material_servico: txt(i.materialOuServicoNome) || txt(i.materialOuServico),
    quantidade: num(i.quantidade),
    unidade_medida: txt(i.unidadeMedida),
    valor_unitario_estimado: i.orcamentoSigiloso === true ? null : num(i.valorUnitarioEstimado),
    valor_total_estimado: i.orcamentoSigiloso === true ? null : num(i.valorTotal),
    orcamento_sigiloso: bool(i.orcamentoSigiloso),
    criterio_julgamento: txt(i.criterioJulgamentoNome),
    situacao_item_id: num(i.situacaoCompraItem),
    situacao_item_nome: txt(i.situacaoCompraItemNome),
    tipo_beneficio_id: num(i.tipoBeneficio),
    tipo_beneficio_nome: txt(i.tipoBeneficioNome),
    catalogo_codigo: txt(i.catalogoCodigoItem),
    ncm_nbs: txt(i.ncmNbsCodigo),
    tem_resultado: bool(i.temResultado),
  };
}

export function normalizarDocumentoPncp(d) {
  return {
    sequencial: num(d.sequencialDocumento),
    titulo: txt(d.titulo),
    tipo: txt(d.tipoDocumentoNome) || txt(d.tipoDocumentoDescricao),
    url: txt(d.url) || txt(d.uri),
    data_publicacao: dataIso(d.dataPublicacaoPncp),
    ativo: bool(d.statusAtivo),
  };
}
