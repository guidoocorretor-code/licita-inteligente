// Alíquota sobre a venda pelo regime tributário. Usado no navegador e no servidor (mesma conta nos dois lados).
// É estimativa para formar preço: a alíquota oficial da empresa quem confirma é o contador.

// Simples Nacional (LC 123/2006, Anexos I a III, redação da LC 155/2016, vigentes em 2026):
// [limite da faixa (receita bruta 12 meses), alíquota nominal %, valor a deduzir R$]
export const ANEXOS_SIMPLES = {
  I: { nome: 'Anexo I · Comércio', faixas: [[180000, 4, 0], [360000, 7.3, 5940], [720000, 9.5, 13860], [1800000, 10.7, 22500], [3600000, 14.3, 87300], [4800000, 19, 378000]] },
  II: { nome: 'Anexo II · Indústria', faixas: [[180000, 4.5, 0], [360000, 7.8, 5940], [720000, 10, 13860], [1800000, 11.2, 22500], [3600000, 14.7, 85500], [4800000, 30, 720000]] },
  III: { nome: 'Anexo III · Serviços (instalação, manutenção…)', faixas: [[180000, 6, 0], [360000, 11.2, 9360], [720000, 13.5, 17640], [1800000, 16, 35640], [3600000, 21, 125640], [4800000, 33, 648000]] },
};

// Lucro Presumido: presunção de lucro (Lei 9.249/1995, arts. 15 e 20) × IRPJ 15% e CSLL 9%;
// PIS 0,65% e COFINS 3% cumulativos (Lei 9.718/1998). O adicional de 10% do IRPJ (base acima de R$ 20 mil/mês) não entra.
export const PRESUMIDO = {
  comercio: { nome: 'Comércio / indústria', irpj: 8 * 0.15, csll: 12 * 0.09 },
  servicos: { nome: 'Serviços em geral', irpj: 32 * 0.15, csll: 32 * 0.09 },
};
export const PIS_COFINS_CUMULATIVO = 0.65 + 3;
// Lucro Real: PIS 1,65% + COFINS 7,6% não cumulativos (Leis 10.637/2002 e 10.833/2003), com crédito sobre as compras
export const PIS_COFINS_NAO_CUMULATIVO = 1.65 + 7.6;

export const REGIMES = { simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real', manual: 'Informar a alíquota' };

const r2 = (v) => Math.round(Number(v.toPrecision(12)) * 100) / 100; // 9,935 vira 9,94 (sem erro de ponto flutuante)
const n = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Alíquota efetiva do Simples: (RBT12 × nominal − dedução) ÷ RBT12. Sem RBT12 (empresa nova), usa a 1ª faixa. */
export function aliquotaSimples(anexo, rbt12) {
  const a = ANEXOS_SIMPLES[anexo];
  if (!a) return { erro: 'Escolha o anexo do Simples.' };
  const rb = n(rbt12);
  if (rb != null && rb > 4800000) return { erro: 'Receita acima de R$ 4,8 milhões: a empresa sai do Simples Nacional.' };
  if (!rb) return { aliquota: a.faixas[0][1], faixa: 1, aviso: 'Sem a receita dos últimos 12 meses: usei a 1ª faixa.' };
  const i = a.faixas.findIndex(([lim]) => rb <= lim);
  const [, nominal, deduzir] = a.faixas[i];
  return { aliquota: r2(((rb * nominal) / 100 - deduzir) / rb * 100), faixa: i + 1,
    aviso: rb > 3600000 ? 'Acima de R$ 3,6 milhões (sublimite) o ICMS/ISS sai do DAS e é pago à parte: a conta muda, confirme com o contador.' : null };
}

/**
 * t = { regime, anexo, rbt12, atividade, icms, iss, pis_cofins, ir_csll, aliquota }
 * Devolve { aliquota, partes: [[rótulo, %]], aviso } ou { erro }.
 */
export function calcularTributos(t = {}) {
  const icms = n(t.icms) || 0; const iss = n(t.iss) || 0;
  if (t.regime === 'simples') {
    const s = aliquotaSimples(t.anexo, t.rbt12);
    if (s.erro) return s;
    return { aliquota: s.aliquota, partes: [[`Simples Anexo ${t.anexo} · ${s.faixa}ª faixa (alíquota efetiva)`, s.aliquota]], aviso: s.aviso };
  }
  if (t.regime === 'presumido') {
    const p = PRESUMIDO[t.atividade] || PRESUMIDO.comercio;
    const partes = [['PIS + COFINS (cumulativo)', PIS_COFINS_CUMULATIVO], ['IRPJ presumido', r2(p.irpj)], ['CSLL presumida', r2(p.csll)]];
    if (icms) partes.push(['ICMS', icms]);
    if (iss) partes.push(['ISS', iss]);
    return { aliquota: r2(partes.reduce((s, [, v]) => s + v, 0)), partes,
      aviso: !icms && !iss ? 'Informe o ICMS (venda de mercadoria) ou o ISS (serviço): sem ele a conta fica baixa.' : null };
  }
  if (t.regime === 'real') {
    const pc = n(t.pis_cofins) ?? PIS_COFINS_NAO_CUMULATIVO;
    const ir = n(t.ir_csll) || 0;
    const partes = [['PIS + COFINS (após créditos)', pc]];
    if (icms) partes.push(['ICMS', icms]);
    if (iss) partes.push(['ISS', iss]);
    if (ir) partes.push(['IRPJ + CSLL estimados', ir]);
    return { aliquota: r2(partes.reduce((s, [, v]) => s + v, 0)), partes,
      aviso: 'No Lucro Real o IRPJ/CSLL incidem sobre o lucro, não sobre a venda: o valor é estimativa. Peça ao contador a carga média da empresa.' };
  }
  if (t.regime === 'manual') {
    const a = n(t.aliquota);
    return a == null ? { erro: 'Informe a alíquota.' } : { aliquota: a, partes: [['Informada', a]] };
  }
  return { erro: 'Escolha o regime tributário.' };
}
