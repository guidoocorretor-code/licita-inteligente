// Painel de Empresas: para cada empresa assessorada, o caminho do edital ao dinheiro na conta.
// Tudo vem do banco: Kanban (etapa = fase), valores informados no card, certidões e licitações do ramo.
// Valor não informado nunca vira zero: é contado à parte ("sem valor") para o usuário completar.
import { FASES_GANHAS, valorDe } from './execucao.js';
import { montarFiltro, expressoesRamo } from './busca.js';
import { listarClientes, listarDocumentos } from './clientes.js';
import { sugerirRamo } from './cnpj.js';

const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const somaDias = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
const A_FATURAR = ['ganha', 'empenho', 'a_entregar', 'entregue'];

/** Data em que o card chegou ao ponto que a fase representa (usada no filtro por período). */
export function dataDaFase(o) {
  const d = {
    recebida: o.recebido_data, faturada: o.nf_data, entregue: o.entrega_data, a_entregar: o.empenho_data,
    empenho: o.resultado_em, ganha: o.resultado_em, perdida: o.resultado_em, descartada: o.descartado_em,
    prospeccao: o.data_encerramento_proposta, disputa: o.data_encerramento_proposta,
  }[o.fase];
  return d ? String(d).slice(0, 10) : null;
}
/** Período: { de, ate } em aaaa-mm-dd (inclusive). Sem período, tudo. */
const noPeriodo = (dia, p) => !!dia && (!p.de || dia >= p.de) && (!p.ate || dia <= p.ate);

/** Resumo de um conjunto de oportunidades (de uma empresa, ou de todas). */
export function resumir(ops, hoje) {
  const fase = {};
  const soma = (f, o) => {
    const x = (fase[f] ??= { n: 0, valor: 0, sem_valor: 0, pelo_edital: 0 });
    const { valor, origem } = valorDe(o, f);
    x.n++;
    if (valor == null) x.sem_valor++; else x.valor += valor;
    if (origem === 'edital') x.pelo_edital++;
  };
  for (const o of ops) soma(o.fase, o);
  const de = (f) => fase[f] || { n: 0, valor: 0, sem_valor: 0, pelo_edital: 0 };
  const junta = (fs) => fs.map(de).reduce((a, b) => ({ n: a.n + b.n, valor: a.valor + b.valor, sem_valor: a.sem_valor + b.sem_valor, pelo_edital: a.pelo_edital + b.pelo_edital }),
    { n: 0, valor: 0, sem_valor: 0, pelo_edital: 0 });

  const ganhas = ops.filter((o) => FASES_GANHAS.includes(o.fase));
  const perdidas = ops.filter((o) => o.fase === 'perdida');
  const resolvidas = ganhas.length + perdidas.length;
  const umAno = somaDias(hoje, -365);
  const ganhas12 = ganhas.filter((o) => o.resultado_em && o.resultado_em >= umAno);
  const recebidas = ops.filter((o) => o.fase === 'recebida');
  const recebidas12 = recebidas.filter((o) => o.recebido_data && o.recebido_data >= umAno);
  const atrasadas = ops.filter((o) => o.fase === 'faturada' && o.nf_data && diasEntre(o.nf_data, hoje) > 30);
  const valorGanho = (o) => o.valor_ganho ?? o.valor_proposta;

  const taxa = resolvidas ? ganhas.length / resolvidas : null;
  const aFaturar = junta(A_FATURAR); const aReceber = de('faturada'); const disputa = de('disputa');
  return {
    fases: fase,
    prospeccao: de('prospeccao'),
    disputa,
    ganhas: { n: ganhas.length, n_12m: ganhas12.length, valor_12m: ganhas12.reduce((s, o) => s + (valorGanho(o) ?? 0), 0), sem_valor_12m: ganhas12.filter((o) => valorGanho(o) == null).length },
    perdidas: { n: perdidas.length },
    descartadas: { n: de('descartada').n },
    taxa_vitoria: { ganhas: ganhas.length, perdidas: perdidas.length, pct: taxa, confiavel: resolvidas >= 5 },
    execucao: {
      vencida: de('ganha'), aguardando_empenho: de('empenho'), a_entregar: de('a_entregar'), entregue: de('entregue'),
      a_receber: { ...aReceber, mais_30d: { n: atrasadas.length, valor: atrasadas.reduce((s, o) => s + (valorDe(o, 'faturada').valor ?? 0), 0) } },
      recebido_12m: { n: recebidas12.length, valor: recebidas12.reduce((s, o) => s + (valorDe(o, 'recebida').valor ?? 0), 0) },
      recebido_total: de('recebida'),
      recebido_sem_data: recebidas.filter((o) => !o.recebido_data).length,
    },
    a_faturar: aFaturar,
    projecao: {
      garantido: aFaturar.valor + aReceber.valor,
      // Só projeta com histórico mínimo (5 disputas com resultado); antes disso a taxa engana
      potencial: taxa != null && resolvidas >= 5 ? disputa.valor * taxa : null,
      em_disputa: disputa.valor,
    },
  };
}

/** Próximos compromissos de uma empresa: fim de propostas, entregas, notas sem pagamento e certidões. */
function proximos(ops, docs, hoje, agora) {
  const out = [];
  const limiteSessao = new Date(Date.parse(agora + 'Z') + 7 * 86400000).toISOString().slice(0, 19);
  for (const o of ops) {
    const titulo = o.objeto ? o.objeto.slice(0, 90) : 'Licitação';
    const link = `#/licitacao/${o.licitacao_id}`;
    if (['prospeccao', 'disputa'].includes(o.fase) && o.data_encerramento_proposta && o.data_encerramento_proposta >= agora && o.data_encerramento_proposta <= limiteSessao) {
      out.push({ tipo: 'sessao', data: o.data_encerramento_proposta.slice(0, 10), hora: o.data_encerramento_proposta.slice(11, 16), texto: `Fim das propostas: ${titulo}`, orgao: o.orgao_nome, link, urgente: diasEntre(hoje, o.data_encerramento_proposta.slice(0, 10)) <= 2 });
    }
    if (['empenho', 'a_entregar'].includes(o.fase) && o.entrega_prazo && diasEntre(hoje, o.entrega_prazo) <= 15) {
      const d = diasEntre(hoje, o.entrega_prazo);
      out.push({ tipo: 'entrega', data: o.entrega_prazo, texto: `${d < 0 ? 'Entrega ATRASADA' : 'Prazo de entrega'}: ${titulo}`, orgao: o.orgao_nome, link, urgente: d <= 3 });
    }
    if (o.fase === 'faturada' && o.nf_data && diasEntre(o.nf_data, hoje) > 30) {
      out.push({ tipo: 'recebimento', data: o.nf_data, texto: `Nota ${o.nf_numero ? `nº ${o.nf_numero} ` : ''}sem pagamento há ${diasEntre(o.nf_data, hoje)} dias: ${titulo}`, orgao: o.orgao_nome, link, urgente: true });
    }
  }
  for (const d of docs) {
    if (['vencido', 'vence_7', 'vence_15'].includes(d.situacao)) {
      out.push({ tipo: 'certidao', data: d.validade, texto: `${d.tipo_nome}: ${d.situacao === 'vencido' ? 'VENCIDA' : `vence em ${d.dias} dia(s)`}`, link: `#/empresas/${d.cliente_id}`, urgente: d.situacao !== 'vence_15' });
    }
  }
  return out.sort((a, b) => (b.urgente - a.urgente) || String(a.data).localeCompare(String(b.data))).slice(0, 6);
}

/** Licitações abertas (e novas em 7 dias) compatíveis com as palavras do ramo da empresa. */
function ramoDaEmpresa(db, palavras, uf, hoje, agora) {
  if (!expressoesRamo(palavras).length) return null;
  const conta = (f) => {
    const { where, params } = montarFiltro(f, agora);
    return db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(valor_estimado),0) v, COUNT(valor_estimado) com_valor FROM licitacoes l ${where}`).get(...params);
  };
  const abertas = conta({ visao: 'abertas', ramo: palavras });
  const novas = conta({ ramo: palavras, publicacao_de: somaDias(hoje, -7) });
  const naUf = uf ? conta({ visao: 'abertas', ramo: palavras, uf }) : null;
  return { palavras, abertas: abertas.n, valor_abertas: abertas.v, abertas_com_valor: abertas.com_valor, novas_7d: novas.n,
    uf: uf || null, abertas_uf: naUf ? naUf.n : null, valor_abertas_uf: naUf ? naUf.v : null };
}

/** Notas fiscais emitidas no período (faturamento): cards em "Nota fiscal emitida" ou "Recebido" com data da nota. */
function faturamento(ops, periodo) {
  const notas = ops.filter((o) => ['faturada', 'recebida'].includes(o.fase) && noPeriodo(o.nf_data, periodo));
  return { n: notas.length, valor: notas.reduce((t, o) => t + (o.nf_valor ?? 0), 0), sem_valor: notas.filter((o) => o.nf_valor == null).length,
    sem_data: ops.filter((o) => ['faturada', 'recebida'].includes(o.fase) && !o.nf_data).length };
}

/** Quantidade e valor em cada etapa do Kanban, na ordem do quadro (inclui prospecção, perdidas e descartadas). */
function porEtapa(etapas, ops) {
  return etapas.map((et) => {
    const meus = ops.filter((o) => o.etapa_id === et.id);
    const vals = meus.map((o) => valorDe(o, et.fase || 'prospeccao').valor);
    return { id: et.id, nome: et.nome, fase: et.fase, n: meus.length, valor: vals.reduce((t, v) => t + (v ?? 0), 0), sem_valor: vals.filter((v) => v == null).length };
  });
}

export function painelEmpresas(db, empresaId, { clienteId = null, hoje, agora, de = null, ate = null }) {
  const todas = db.prepare(`SELECT o.*, e.fase, e.nome etapa_nome, l.objeto, l.orgao_nome, l.uf, l.municipio, l.valor_estimado,
      l.data_encerramento_proposta, l.status_calculado
    FROM oportunidades o JOIN kanban_etapas e ON e.id = o.etapa_id JOIN licitacoes l ON l.id = o.licitacao_id
    WHERE o.empresa_id = ? AND (? IS NULL OR o.cliente_id = ?)`).all(empresaId, clienteId, clienteId);
  const periodo = { de, ate };
  const comPeriodo = !!(de || ate);
  // Com período, cada card conta pela data da fase em que está (ex.: Recebido pela data do pagamento); sem data, fica de fora e é contado à parte
  const ops = comPeriodo ? todas.filter((o) => noPeriodo(dataDaFase(o), periodo)) : todas;
  const etapas = db.prepare('SELECT id, nome, fase FROM kanban_etapas WHERE empresa_id=? ORDER BY ordem').all(empresaId);
  const clientes = listarClientes(db, empresaId, hoje).filter((c) => (clienteId ? c.id === clienteId : c.ativo));
  const docs = listarDocumentos(db, empresaId, { clienteId, hoje });

  const empresas = clientes.map((c) => {
    const meus = ops.filter((o) => o.cliente_id === c.id);
    let cnaes = [];
    try { cnaes = c.cnaes_json ? JSON.parse(c.cnaes_json) : []; } catch { cnaes = []; }
    return {
      id: c.id, nome: c.nome_fantasia || c.razao_social, razao_social: c.razao_social, cnpj: c.cnpj, porte: c.porte, uf: c.uf, municipio: c.municipio,
      cnaes, palavras_chave: c.palavras_chave,
      documentos: { total: c.documentos, vencidos: c.vencidos, vencendo: c.vencendo, proximo: c.proximo_vencimento ? { tipo: c.proximo_vencimento.tipo_nome, validade: c.proximo_vencimento.validade, dias: c.proximo_vencimento.dias } : null },
      ramo: ramoDaEmpresa(db, c.palavras_chave, c.uf, hoje, agora),
      ramo_sugerido: cnaes.length ? sugerirRamo(cnaes, c.razao_social) : null,
      oportunidades: meus.length,
      ...resumir(meus, hoje),
      por_etapa: porEtapa(etapas, meus),
      faturamento: faturamento(todas.filter((o) => o.cliente_id === c.id), periodo),
      proximos: proximos(todas.filter((o) => o.cliente_id === c.id), docs.filter((d) => d.cliente_id === c.id), hoje, agora), // compromissos: sempre os próximos, sem período
    };
  });
  // Ordem: quem tem mais dinheiro em jogo (garantido + em disputa) primeiro
  empresas.sort((a, b) => (b.projecao.garantido + b.projecao.em_disputa) - (a.projecao.garantido + a.projecao.em_disputa) || a.nome.localeCompare(b.nome));
  const doConjunto = clienteId ? ops : ops.filter((o) => clientes.some((c) => c.id === o.cliente_id));
  const doConjuntoTodas = clienteId ? todas : todas.filter((o) => clientes.some((c) => c.id === o.cliente_id));
  return {
    hoje,
    periodo: comPeriodo ? { de, ate, fora_sem_data: doConjuntoTodas.filter((o) => !dataDaFase(o)).length } : null,
    total: { empresas: empresas.length, oportunidades: doConjunto.length, ...resumir(doConjunto, hoje), por_etapa: porEtapa(etapas, doConjunto), faturamento: faturamento(doConjuntoTodas, periodo) },
    sem_empresa: clienteId ? 0 : todas.filter((o) => !o.cliente_id).length,
    empresas,
  };
}
