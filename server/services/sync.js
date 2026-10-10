// Orquestração de sincronização: execução por fonte, logs, falhas reprocessáveis,
// cursor incremental e atualização da situação do conector.
import { CONECTORES } from '../connectors/registro.js';
import { salvarLicitacao, salvarItens, salvarDocumentos, recalcularStatusTemporais } from './repositorio.js';
import { agoraBrasilia } from './status.js';
import { avaliarAlertasPesquisas } from './alertas.js';

const emExecucao = new Set();
export const sincronizacaoEmAndamento = (codigo) => emExecucao.has(codigo);

export function carregarFonte(db, codigo) {
  const f = db.prepare('SELECT * FROM fontes WHERE codigo=?').get(codigo);
  if (!f) return null;
  return { ...f, config: JSON.parse(f.config_json || '{}'), cursor: JSON.parse(f.cursor_json || '{}') };
}

function registrarFalha(db, fonteId, execId, idExterno, etapa, erro, payload) {
  db.prepare(`INSERT INTO sync_falhas (fonte_id, execucao_id, id_externo, etapa, erro, payload_json) VALUES (?,?,?,?,?,?)`)
    .run(fonteId, execId, idExterno ?? null, etapa, String(erro?.message || erro).slice(0, 1000), payload ? JSON.stringify(payload) : null);
}

export async function testarFonte(db, codigo, { fetchImpl } = {}) {
  const fonte = carregarFonte(db, codigo);
  if (!fonte) throw new Error('Fonte não encontrada');
  const conector = CONECTORES[codigo];
  if (!conector) {
    return { ok: false, mensagem: 'Esta fonte não possui conector implementado (sem API pública documentada). Veja observações.' };
  }
  try {
    const r = await conector.testar({ fetchImpl });
    db.prepare("UPDATE fontes SET situacao_conexao='ok', ultimo_erro=NULL WHERE id=?").run(fonte.id);
    return { ok: true, mensagem: `Conexão OK. Registros disponíveis na consulta de teste: ${r.totalRegistros}.`, url: r.url };
  } catch (e) {
    const sit = e.tipo === 'bloqueada_rede' ? 'bloqueada_rede' : 'erro';
    db.prepare('UPDATE fontes SET situacao_conexao=?, ultimo_erro=? WHERE id=?').run(sit, e.message, fonte.id);
    return { ok: false, mensagem: e.message, situacao: sit };
  }
}

/**
 * Executa a sincronização de uma fonte.
 * @param {object} opts { modo: 'incremental'|'abertas', fetchImpl, agora, limiteDetalhes }
 */
export async function sincronizarFonte(db, codigo, opts = {}) {
  const fonte = carregarFonte(db, codigo);
  if (!fonte) throw new Error('Fonte não encontrada');
  const conector = CONECTORES[codigo];
  if (!conector) throw new Error('Fonte sem conector implementado.');
  if (emExecucao.has(codigo)) return { ignorado: true, mensagem: 'Sincronização já em andamento para esta fonte.' };
  emExecucao.add(codigo);

  const modo = opts.modo || 'incremental';
  const exec = db.prepare('INSERT INTO sync_execucoes (fonte_id, tipo, parametros_json) VALUES (?,?,?)')
    .run(fonte.id, modo, JSON.stringify({ config: fonte.config, cursor: fonte.cursor }));
  const execId = Number(exec.lastInsertRowid);
  const cont = { lidos: 0, inseridos: 0, atualizados: 0, inalterados: 0, falhas: 0 };
  const paraDetalhar = new Set();
  let novoCursor = { ...fonte.cursor };
  let erroFatal = null;
  const agoraLocal = agoraBrasilia(opts.agora);

  try {
    for await (const lote of conector.coletar(fonte, { modo, fetchImpl: opts.fetchImpl, agora: opts.agora })) {
      if (lote.cursor) { novoCursor = { ...novoCursor, ...lote.cursor }; continue; }
      for (const { bruto, canonico } of lote.itens) {
        cont.lidos++;
        try {
          const r = salvarLicitacao(db, canonico, codigo, bruto, agoraLocal);
          cont[{ inserido: 'inseridos', atualizado: 'atualizados', inalterado: 'inalterados' }[r.acao]]++;
          if (r.acao !== 'inalterado') paraDetalhar.add(r.id);
        } catch (e) {
          cont.falhas++;
          registrarFalha(db, fonte.id, execId, canonico?.id_externo, 'persistencia', e, bruto);
        }
      }
    }
  } catch (e) {
    erroFatal = e;
  }

  // Detalhes (itens e documentos) — PNCP
  if (conector.detalhes && fonte.config.sincronizarDetalhes !== false) {
    const limite = opts.limiteDetalhes ?? 200;
    // inclui licitações já existentes aguardando resultado, para detectar homologação/deserção
    const pendentes = db.prepare(`SELECT id FROM licitacoes WHERE fonte_principal=? AND status_calculado IN ('prazo_encerrado','em_disputa','resultado_parcial')
      AND (detalhes_sincronizados_em IS NULL OR detalhes_sincronizados_em < datetime('now','-1 day')) LIMIT ?`).all(codigo, limite);
    // ...e abertas que ainda não têm itens/documentos (cargas grandes são completadas aos poucos, prazo mais próximo primeiro)
    const semDetalhe = db.prepare(`SELECT id FROM licitacoes WHERE fonte_principal=? AND status_calculado IN ('aguardando_propostas','aberta')
      AND detalhes_sincronizados_em IS NULL ORDER BY data_encerramento_proposta LIMIT ?`).all(codigo, limite);
    for (const p of semDetalhe) paraDetalhar.add(p.id);
    for (const p of pendentes) paraDetalhar.add(p.id);
    let n = 0;
    for (const id of paraDetalhar) {
      if (n++ >= limite || (erroFatal && erroFatal.tipo === 'bloqueada_rede')) break;
      const lic = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(id);
      try {
        const d = await conector.detalhes(lic, { fetchImpl: opts.fetchImpl });
        if (d) { salvarItens(db, id, d.itens, codigo, agoraLocal); salvarDocumentos(db, id, d.documentos, codigo); }
      } catch (e) {
        cont.falhas++;
        registrarFalha(db, fonte.id, execId, lic.numero_controle_pncp, 'detalhes', e, { licitacao_id: id });
      }
    }
  }

  recalcularStatusTemporais(db, agoraLocal);
  const status = erroFatal ? (cont.lidos > 0 ? 'parcial' : 'erro') : cont.falhas > 0 ? 'parcial' : 'sucesso';
  const msg = erroFatal ? erroFatal.message : `Lidos ${cont.lidos}; novos ${cont.inseridos}; atualizados ${cont.atualizados}; falhas ${cont.falhas}.`;
  db.prepare(`UPDATE sync_execucoes SET finalizado_em=datetime('now'), status=?, registros_lidos=?, inseridos=?, atualizados=?, inalterados=?, falhas=?, mensagem=? WHERE id=?`)
    .run(status, cont.lidos, cont.inseridos, cont.atualizados, cont.inalterados, cont.falhas, msg, execId);
  const total = db.prepare('SELECT COUNT(DISTINCT licitacao_id) n FROM licitacao_fontes WHERE fonte_codigo=?').get(codigo).n;
  const situacao = erroFatal ? (erroFatal.tipo === 'bloqueada_rede' ? 'bloqueada_rede' : 'erro') : 'ok';
  db.prepare(`UPDATE fontes SET ultima_sincronizacao=datetime('now'),
      ultima_sincronizacao_ok = CASE WHEN ? THEN datetime('now') ELSE ultima_sincronizacao_ok END,
      situacao_conexao=?, ultimo_erro=?, registros_importados=?, cursor_json=? WHERE id=?`)
    .run(erroFatal ? 0 : 1, situacao, erroFatal ? erroFatal.message : null, total,
      JSON.stringify(erroFatal ? fonte.cursor : novoCursor), fonte.id); // cursor só avança em sucesso
  emExecucao.delete(codigo);

  if (cont.inseridos > 0) {
    try { avaliarAlertasPesquisas(db); } catch (e) { console.error('[alertas]', e.message); }
  }
  return { execucaoId: execId, status, ...cont, mensagem: msg };
}

export async function reprocessarFalhas(db, codigo, opts = {}) {
  const fonte = carregarFonte(db, codigo);
  const conector = CONECTORES[codigo];
  const falhas = db.prepare('SELECT * FROM sync_falhas WHERE fonte_id=? AND resolvida=0 ORDER BY id LIMIT 500').all(fonte.id);
  let ok = 0; let erro = 0;
  const { normalizarPncp, normalizarCompras14133, normalizarComprasLegado } = await import('./normalizacao.js');
  const norm = { pncp: normalizarPncp, comprasgov_14133: normalizarCompras14133, comprasgov_legado: normalizarComprasLegado }[codigo];
  for (const f of falhas) {
    try {
      const payload = f.payload_json ? JSON.parse(f.payload_json) : null;
      if (f.etapa === 'persistencia' && payload && norm) {
        salvarLicitacao(db, norm(payload), codigo, payload);
      } else if (f.etapa === 'detalhes' && payload?.licitacao_id && conector?.detalhes) {
        const lic = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(payload.licitacao_id);
        const d = await conector.detalhes(lic, { fetchImpl: opts.fetchImpl });
        if (d) { salvarItens(db, lic.id, d.itens, codigo); salvarDocumentos(db, lic.id, d.documentos, codigo); }
      } else continue;
      db.prepare('UPDATE sync_falhas SET resolvida=1 WHERE id=?').run(f.id); ok++;
    } catch (e) {
      db.prepare('UPDATE sync_falhas SET tentativas=tentativas+1, erro=? WHERE id=?').run(String(e.message).slice(0, 1000), f.id); erro++;
    }
  }
  return { reprocessadas: ok, comErro: erro };
}

export async function sincronizarDetalhesDe(db, licId, opts = {}) {
  const lic = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(licId);
  if (!lic) throw new Error('Licitação não encontrada');
  const conector = CONECTORES.pncp;
  const d = await conector.detalhes(lic, opts);
  if (!d) return { ok: false, mensagem: 'Licitação sem identificadores PNCP (CNPJ/ano/sequencial).' };
  salvarItens(db, licId, d.itens, 'pncp');
  salvarDocumentos(db, licId, d.documentos, 'pncp');
  return { ok: true, itens: d.itens.length, documentos: d.documentos.length };
}
