// Classificação de status da licitação.
// Princípio: só afirmamos "deserta" ou "fracassada" quando a FONTE OFICIAL informa
// essa situação nos itens (PNCP: situacaoCompraItem 4 = Deserto, 5 = Fracassado).
// Encerramento de prazo, ausência de propostas na consulta ou falta de dados NÃO geram esse status.

export const STATUS = {
  aguardando_propostas: { rotulo: 'Aguardando propostas', visao: 'abertas' },
  aberta: { rotulo: 'Aberta (recebendo propostas)', visao: 'abertas' },
  prazo_encerrado: { rotulo: 'Prazo encerrado (aguardando resultado)', visao: 'em_disputa' },
  em_disputa: { rotulo: 'Em disputa/julgamento', visao: 'em_disputa' },
  resultado_parcial: { rotulo: 'Resultado parcial', visao: 'em_disputa' },
  encerrada: { rotulo: 'Encerrada (homologada)', visao: 'encerradas' },
  encerrada_sem_itens_validos: { rotulo: 'Encerrada (itens cancelados)', visao: 'encerradas' },
  deserta: { rotulo: 'Deserta', visao: 'desertas_fracassadas' },
  fracassada: { rotulo: 'Fracassada', visao: 'desertas_fracassadas' },
  deserta_fracassada: { rotulo: 'Deserta/Fracassada (por itens)', visao: 'desertas_fracassadas' },
  suspensa: { rotulo: 'Suspensa', visao: 'outras' },
  revogada: { rotulo: 'Revogada', visao: 'outras' },
  anulada: { rotulo: 'Anulada', visao: 'outras' },
  indeterminada: { rotulo: 'Indeterminada (dados insuficientes)', visao: 'outras' },
};

export const VISOES = {
  abertas: 'Licitações abertas',
  em_disputa: 'Em disputa',
  encerradas: 'Encerradas',
  desertas_fracassadas: 'Desertas ou fracassadas',
  outras: 'Suspensas, revogadas, anuladas e indeterminadas',
};

export function statusDaVisao(visao) {
  return Object.entries(STATUS).filter(([, v]) => v.visao === visao).map(([k]) => k);
}

const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}` : '');

/**
 * @param {object} lic  licitação canônica (situacao_oficial_id, datas)
 * @param {Array|null} itens  itens com situacao_item_id; null = itens não sincronizados
 * @param {string} agoraIso  data/hora atual local (YYYY-MM-DDTHH:mm:ss, horário de Brasília)
 * @returns {{status: string, motivo: string}}
 */
export function classificarStatus(lic, itens, agoraIso) {
  const sit = lic.situacao_oficial_id;
  if (sit === 2) return { status: 'revogada', motivo: 'Situação oficial na fonte: Revogada.' };
  if (sit === 3) return { status: 'anulada', motivo: 'Situação oficial na fonte: Anulada.' };
  if (sit === 4) return { status: 'suspensa', motivo: 'Situação oficial na fonte: Suspensa.' };

  // Situação textual de fontes sem código PNCP (ex.: legado SIASG)
  const nome = (lic.situacao_oficial_nome || '').toLowerCase();
  if (sit == null && nome) {
    if (nome.includes('revog')) return { status: 'revogada', motivo: `Situação na fonte: ${lic.situacao_oficial_nome}.` };
    if (nome.includes('anul')) return { status: 'anulada', motivo: `Situação na fonte: ${lic.situacao_oficial_nome}.` };
    if (nome.includes('suspens')) return { status: 'suspensa', motivo: `Situação na fonte: ${lic.situacao_oficial_nome}.` };
    if (nome.includes('desert')) return { status: 'deserta', motivo: `Situação na fonte: ${lic.situacao_oficial_nome}.` };
    if (nome.includes('fracass')) return { status: 'fracassada', motivo: `Situação na fonte: ${lic.situacao_oficial_nome}.` };
  }

  // Resultado por itens (evidência oficial)
  if (Array.isArray(itens) && itens.length > 0) {
    const cont = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, outro: 0 };
    for (const i of itens) cont[[1, 2, 3, 4, 5].includes(i.situacao_item_id) ? i.situacao_item_id : 'outro']++;
    const total = itens.length;
    const resumo = `Itens na fonte: ${cont[2]} homologado(s), ${cont[1]} em andamento, ${cont[4]} deserto(s), ${cont[5]} fracassado(s), ${cont[3]} cancelado(s) de ${total}.`;
    const finalizados = cont[2] + cont[3] + cont[4] + cont[5];
    if (cont.outro === 0 && finalizados === total) {
      if (cont[2] > 0) return { status: 'encerrada', motivo: resumo };
      if (cont[4] > 0 && cont[5] === 0) return { status: 'deserta', motivo: resumo };
      if (cont[5] > 0 && cont[4] === 0) return { status: 'fracassada', motivo: resumo };
      if (cont[4] > 0 && cont[5] > 0) return { status: 'deserta_fracassada', motivo: resumo };
      return { status: 'encerrada_sem_itens_validos', motivo: resumo };
    }
    if (finalizados > 0) return { status: 'resultado_parcial', motivo: resumo };
    // todos em andamento: cai na regra por datas, com o resumo
    const porData = classificarPorDatas(lic, agoraIso);
    return { status: porData.status === 'prazo_encerrado' ? 'em_disputa' : porData.status, motivo: `${porData.motivo} ${resumo}` };
  }

  return classificarPorDatas(lic, agoraIso);
}

function classificarPorDatas(lic, agora) {
  const ab = lic.data_abertura_proposta;
  const enc = lic.data_encerramento_proposta;
  if (!ab && !enc) return { status: 'indeterminada', motivo: 'Fonte não informou datas de propostas.' };
  if (ab && agora < ab) return { status: 'aguardando_propostas', motivo: `Recebimento de propostas inicia em ${fmt(ab)}.` };
  if (enc && agora < enc) return { status: 'aberta', motivo: `Recebendo propostas até ${fmt(enc)}.` };
  if (enc && agora >= enc) return { status: 'prazo_encerrado', motivo: `Prazo de propostas encerrado em ${fmt(enc)}; resultado ainda não informado pela fonte (ou itens não sincronizados).` };
  return { status: 'indeterminada', motivo: 'Data de encerramento das propostas não informada.' };
}

export function agoraBrasilia(d = new Date()) {
  // Horário de Brasília (UTC-3, sem horário de verão desde 2019)
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 19);
}
