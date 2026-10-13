// Catálogo de fontes. "status" reflete a REALIDADE da implementação, não a intenção.
// Fontes sem API pública documentada ficam como "indisponivel" (conector direto),
// mas as contratações delas sob a Lei 14.133/2021 chegam pelo PNCP, que é obrigatório
// (art. 54 e art. 174 da Lei 14.133/2021) e identifica o sistema publicador (campo usuarioNome).
// Todas as modalidades do PNCP (1 a 19), as mais usadas primeiro. Antes só 7 eram baixadas e editais de
// Leilão, Concurso, Chamada pública e outras ficavam fora do sistema, mas apareciam na busca do site do PNCP.
export const MODALIDADES_ANTIGAS = [6, 8, 4, 9, 7, 5, 12];
export const MODALIDADES_TODAS = [6, 8, 4, 9, 7, 5, 12, 15, 3, 2, 10, 11, 14, 1, 13, 16, 17, 18, 19];
export const FONTES_PADRAO = [
  {
    codigo: 'pncp', nome: 'PNCP — Portal Nacional de Contratações Públicas',
    url: 'https://pncp.gov.br/api/consulta/swagger-ui/index.html', tipo: 'api_rest', status: 'funcional',
    habilitada: true, credenciais: false, frequencia: 60,
    observacoes: 'API pública de consultas v1 (sem autenticação). Endpoints: /v1/contratacoes/publicacao, /v1/contratacoes/proposta, /v1/contratacoes/atualizacao; detalhes em /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens e /arquivos. tamanhoPagina máx. 50.',
    config: { ufs: [], modalidades: MODALIDADES_TODAS, diasRetroativos: 3, maxPaginasPorConsulta: 2000, sincronizarDetalhes: true },
  },
  {
    codigo: 'comprasgov_14133', nome: 'Compras.gov.br — Dados Abertos (Contratações Lei 14.133)',
    url: 'https://dadosabertos.compras.gov.br/swagger-ui/index.html', tipo: 'dados_abertos', status: 'funcional',
    habilitada: true, credenciais: false, frequencia: 180,
    observacoes: 'Módulo 07 /modulo-contratacoes/1_consultarContratacoes_PNCP_14133. Traz numeroControlePNCP, usado para deduplicar com o PNCP. Parâmetro codigoModalidade usa códigos próprios do Compras.gov.br (ex.: 6 = Dispensa, verificado em 10/10/2026).',
    config: { modalidades: [5, 6], diasRetroativos: 2, maxPaginas: 20 },
  },
  {
    codigo: 'comprasgov_legado', nome: 'Compras.gov.br — Dados Abertos (Legado Lei 8.666/SIASG)',
    url: 'https://dadosabertos.compras.gov.br/swagger-ui/index.html', tipo: 'dados_abertos', status: 'parcial',
    habilitada: false, credenciais: false, frequencia: 1440,
    observacoes: 'Módulo 06 /modulo-legado/1_consultarLicitacao (dados do SIASG). Útil para histórico. Não possui numeroControlePNCP: deduplicação por UASG+modalidade+número do aviso.',
    config: { diasRetroativos: 2, maxPaginas: 10 },
  },
  {
    codigo: 'pncp_contratos', nome: 'PNCP — Contratos publicados',
    url: 'https://pncp.gov.br/api/consulta/swagger-ui/index.html', tipo: 'api_rest', status: 'funcional',
    habilitada: true, credenciais: false, frequencia: 360,
    observacoes: 'API pública de consultas /v1/contratos, por data de publicação no PNCP (todo o Brasil; o endpoint não filtra por UF). Traz fornecedor contratado, valores e vigência. Liga o contrato à licitação pelo numeroControlePncpCompra. Carga inicial: últimos 30 dias.',
    config: { diasRetroativos: 30, tamanhoPagina: 500, maxPaginasPorDia: 400, ufs: [] },
  },
  {
    codigo: 'comprasgov_precos', nome: 'Compras.gov.br — Pesquisa de Preços',
    url: 'https://dadosabertos.compras.gov.br/swagger-ui/index.html', tipo: 'dados_abertos', status: 'funcional',
    habilitada: false, credenciais: false, frequencia: 0,
    observacoes: 'Consulta sob demanda na tela Preços e contratos (módulo 03: 1_consultarMaterial por PDM/CATMAT e 3_consultarServico por CATSER). O catálogo (PDM de materiais e itens de serviço) é baixado uma vez e atualizado a cada 30 dias. Cobre compras registradas no Compras.gov.br (SIASG), não todas as do país.',
  },
  {
    codigo: 'portal_compras_publicas', nome: 'Portal de Compras Públicas',
    url: 'https://www.portaldecompraspublicas.com.br', tipo: 'via_pncp', status: 'indisponivel',
    habilitada: false, credenciais: true, frequencia: 0,
    observacoes: 'Sem API pública documentada para consulta de terceiros. Processos da Lei 14.133 publicados por esta plataforma chegam via PNCP (plataforma de origem identificada). Integração direta exige contrato/credencial da plataforma.',
  },
  {
    codigo: 'bll', nome: 'BLL Compras', url: 'https://bllcompras.com', tipo: 'via_pncp', status: 'indisponivel',
    habilitada: false, credenciais: true, frequencia: 0,
    observacoes: 'Sem API pública documentada. Cobertura indireta via PNCP. Não é feita raspagem de páginas protegidas.',
  },
  {
    codigo: 'licitanet', nome: 'Licitanet', url: 'https://licitanet.com.br', tipo: 'via_pncp', status: 'indisponivel',
    habilitada: false, credenciais: true, frequencia: 0,
    observacoes: 'Sem API pública documentada. Cobertura indireta via PNCP.',
  },
  {
    codigo: 'licitacoes_e', nome: 'Licitações-e (Banco do Brasil)', url: 'https://www.licitacoes-e.com.br', tipo: 'via_pncp', status: 'indisponivel',
    habilitada: false, credenciais: true, frequencia: 0,
    observacoes: 'Sem API pública documentada; portal com CAPTCHA (não contornado). Cobertura indireta via PNCP.',
  },
  {
    codigo: 'estaduais_municipais', nome: 'Portais estaduais e municipais (diversos)', url: null, tipo: 'via_pncp', status: 'indisponivel',
    habilitada: false, credenciais: false, frequencia: 0,
    observacoes: 'Cada portal exige análise individual (API, dados abertos ou feed). Contratações sob a Lei 14.133 devem constar no PNCP.',
  },
];
