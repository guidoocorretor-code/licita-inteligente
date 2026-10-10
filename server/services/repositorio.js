// Persistência de licitações com deduplicação, histórico de alterações e eventos.
import { transacao } from '../db/index.js';
import { CAMPOS_MONITORADOS, hashConteudo } from './normalizacao.js';
import { classificarStatus, agoraBrasilia } from './status.js';
import crypto from 'node:crypto';
import { classificarSegmento } from './segmentos.js';

// Prioridade de confiança: menor número = fonte mais autoritativa
export const PRIORIDADE_FONTE = { pncp: 1, comprasgov_14133: 2, comprasgov_legado: 3 };
const prio = (f) => PRIORIDADE_FONTE[f] ?? 9;

const COLUNAS = [
  'numero_controle_pncp', 'numero_compra', 'ano', 'sequencial', 'processo', 'orgao_cnpj', 'orgao_nome',
  'unidade_codigo', 'unidade_nome', 'esfera', 'poder', 'uf', 'municipio', 'codigo_ibge', 'modalidade_id',
  'modalidade_nome', 'amparo_legal', 'regime_legal', 'tipo_instrumento', 'objeto', 'informacao_complementar',
  'srp', 'valor_estimado', 'valor_estimado_situacao', 'valor_homologado', 'data_publicacao',
  'data_abertura_proposta', 'data_encerramento_proposta', 'data_sessao', 'situacao_oficial_id',
  'situacao_oficial_nome', 'modo_disputa_id', 'modo_disputa_nome', 'plataforma_origem', 'link_origem',
  'link_pncp', 'data_atualizacao_fonte', 'num_itens',
];

const ROTULOS = {
  objeto: 'Objeto', valor_estimado: 'Valor estimado', valor_homologado: 'Valor homologado',
  data_abertura_proposta: 'Abertura de propostas', data_encerramento_proposta: 'Encerramento de propostas',
  situacao_oficial_nome: 'Situação oficial', modalidade_nome: 'Modalidade', processo: 'Processo',
  informacao_complementar: 'Informação complementar', link_origem: 'Link de origem',
};

function upsertOrgao(db, c) {
  if (!c.orgao_cnpj) return null;
  db.prepare(`INSERT INTO orgaos (cnpj, razao_social, esfera, poder) VALUES (?,?,?,?)
    ON CONFLICT(cnpj) DO UPDATE SET razao_social=COALESCE(excluded.razao_social, razao_social),
      esfera=COALESCE(excluded.esfera, esfera), poder=COALESCE(excluded.poder, poder), atualizado_em=datetime('now')`)
    .run(c.orgao_cnpj ?? null, c.orgao_nome ?? null, c.esfera ?? null, c.poder ?? null);
  return db.prepare('SELECT id FROM orgaos WHERE cnpj=?').get(c.orgao_cnpj).id;
}

function evento(db, licId, tipo, descricao, extra = {}) {
  db.prepare(`INSERT INTO licitacao_eventos (licitacao_id, tipo, campo, valor_anterior, valor_novo, descricao, fonte_codigo, ocorrido_em)
    VALUES (?,?,?,?,?,?,?,?)`).run(licId, tipo, extra.campo ?? null, extra.anterior ?? null, extra.novo ?? null,
    descricao, extra.fonte ?? null, extra.ocorrido ?? null);
}

/**
 * Insere ou atualiza uma licitação canônica.
 * @returns {{acao: 'inserido'|'atualizado'|'inalterado', id: number}}
 */
export function salvarLicitacao(db, c, fonteCodigo, payload, agora = agoraBrasilia()) {
  if (!c.chave_canonica) throw new Error('Registro sem identificador suficiente para deduplicação.');
  return transacao(db, () => {
    const orgaoId = upsertOrgao(db, c);
    const payloadJson = payload ? JSON.stringify(payload) : null;
    const payloadHash = payloadJson ? crypto.createHash('sha256').update(payloadJson).digest('hex').slice(0, 32) : null;

    // Procura existente pela chave canônica ou pelo número de controle PNCP
    let atual = db.prepare('SELECT * FROM licitacoes WHERE chave_canonica = ?').get(c.chave_canonica);
    if (!atual && c.numero_controle_pncp) atual = db.prepare('SELECT * FROM licitacoes WHERE numero_controle_pncp = ?').get(c.numero_controle_pncp);
    if (!atual && c.id_externo) {
      const v = db.prepare('SELECT licitacao_id FROM licitacao_fontes WHERE fonte_codigo=? AND id_externo=?').get(fonteCodigo, String(c.id_externo));
      if (v) atual = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(v.licitacao_id);
    }

    let acao; let id;
    if (!atual) {
      const st = classificarStatus(c, null, agora);
      const cols = [...COLUNAS, 'chave_canonica', 'orgao_id', 'status_calculado', 'status_motivo', 'hash_conteudo', 'fonte_principal', 'segmento'];
      const vals = [...COLUNAS.map((k) => c[k] ?? null), c.chave_canonica, orgaoId, st.status, st.motivo, hashConteudo(c), fonteCodigo, classificarSegmento(c.objeto)];
      const r = db.prepare(`INSERT INTO licitacoes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
      id = Number(r.lastInsertRowid);
      acao = 'inserido';
      evento(db, id, 'publicacao', `Nova publicação: ${(c.objeto || 'objeto não informado').slice(0, 160)}`, { fonte: fonteCodigo, ocorrido: c.data_publicacao });
    } else {
      id = atual.id;
      const autoritativa = prio(fonteCodigo) <= prio(atual.fonte_principal);
      const novos = {};
      for (const k of COLUNAS) {
        const nv = c[k] ?? null;
        if (nv === null) continue; // nunca apaga dado existente com ausência
        // valor sigiloso identificado nos itens não é substituído pelo 0 da listagem
        if ((k === 'valor_estimado' || k === 'valor_estimado_situacao') && atual.valor_estimado_situacao === 'sigiloso') continue;
        if (!autoritativa && atual[k] !== null && atual[k] !== undefined) continue; // fonte secundária só complementa
        if (String(atual[k] ?? '') !== String(nv)) novos[k] = nv;
      }
      if (Object.keys(novos).length) {
        for (const k of Object.keys(novos)) {
          if (!CAMPOS_MONITORADOS.includes(k) || atual[k] === null) continue;
          const tipo = k === 'situacao_oficial_nome' ? 'situacao' : k === 'valor_homologado' ? 'resultado' : 'alteracao';
          evento(db, id, tipo, `${ROTULOS[k] || k} alterado(a)`, { campo: k, anterior: String(atual[k]), novo: String(novos[k]), fonte: fonteCodigo, ocorrido: c.data_atualizacao_fonte });
        }
        if (novos.objeto) novos.segmento = classificarSegmento(novos.objeto);
        const mesclado = { ...atual, ...novos };
        const sets = Object.keys(novos).map((k) => `${k}=?`).join(',');
        db.prepare(`UPDATE licitacoes SET ${sets}, hash_conteudo=?, orgao_id=COALESCE(?, orgao_id), ultima_verificacao=datetime('now'),
            fonte_principal=CASE WHEN ? THEN ? ELSE fonte_principal END WHERE id=?`)
          .run(...Object.values(novos), hashConteudo(mesclado), orgaoId, autoritativa ? 1 : 0, fonteCodigo, id);
        recalcularStatusDe(db, id, agora);
        acao = 'atualizado';
      } else {
        db.prepare("UPDATE licitacoes SET ultima_verificacao=datetime('now') WHERE id=?").run(id);
        acao = 'inalterado';
      }
    }

    db.prepare(`INSERT INTO licitacao_fontes (licitacao_id, fonte_codigo, id_externo, url, payload_hash, payload_json)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(fonte_codigo, id_externo) DO UPDATE SET licitacao_id=excluded.licitacao_id, url=excluded.url,
        payload_hash=excluded.payload_hash, payload_json=excluded.payload_json, ultima_vez=datetime('now')`)
      .run(id, fonteCodigo, String(c.id_externo ?? c.chave_canonica), c.link_origem || c.link_pncp, payloadHash, payloadJson);
    return { acao, id };
  });
}

export function salvarItens(db, licId, itens, fonte = 'pncp', agora = agoraBrasilia()) {
  return transacao(db, () => {
    const anteriores = new Map(db.prepare('SELECT numero_item, situacao_item_id, situacao_item_nome FROM licitacao_itens WHERE licitacao_id=?')
      .all(licId).map((r) => [r.numero_item, r]));
    const up = db.prepare(`INSERT INTO licitacao_itens (licitacao_id, numero_item, descricao, material_servico, quantidade, unidade_medida,
        valor_unitario_estimado, valor_total_estimado, orcamento_sigiloso, criterio_julgamento, situacao_item_id, situacao_item_nome,
        tipo_beneficio_id, tipo_beneficio_nome, catalogo_codigo, ncm_nbs, tem_resultado)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(licitacao_id, numero_item) DO UPDATE SET descricao=excluded.descricao, material_servico=excluded.material_servico,
        quantidade=excluded.quantidade, unidade_medida=excluded.unidade_medida, valor_unitario_estimado=excluded.valor_unitario_estimado,
        valor_total_estimado=excluded.valor_total_estimado, orcamento_sigiloso=excluded.orcamento_sigiloso,
        criterio_julgamento=excluded.criterio_julgamento, situacao_item_id=excluded.situacao_item_id,
        situacao_item_nome=excluded.situacao_item_nome, tipo_beneficio_id=excluded.tipo_beneficio_id,
        tipo_beneficio_nome=excluded.tipo_beneficio_nome, catalogo_codigo=excluded.catalogo_codigo, ncm_nbs=excluded.ncm_nbs,
        tem_resultado=excluded.tem_resultado, atualizado_em=datetime('now')`);
    for (const i of itens) {
      if (i.numero_item == null) continue;
      const v = (k) => i[k] ?? null;
      up.run(licId, i.numero_item, v('descricao'), v('material_servico'), v('quantidade'), v('unidade_medida'), v('valor_unitario_estimado'),
        v('valor_total_estimado'), v('orcamento_sigiloso'), v('criterio_julgamento'), v('situacao_item_id'), v('situacao_item_nome'),
        v('tipo_beneficio_id'), v('tipo_beneficio_nome'), v('catalogo_codigo'), v('ncm_nbs'), v('tem_resultado'));
      const ant = anteriores.get(i.numero_item);
      if (ant && ant.situacao_item_id !== i.situacao_item_id && i.situacao_item_nome) {
        evento(db, licId, [2, 4, 5].includes(i.situacao_item_id) ? 'resultado' : 'item',
          `Item ${i.numero_item}: situação mudou de "${ant.situacao_item_nome ?? '—'}" para "${i.situacao_item_nome}"`,
          { campo: `item_${i.numero_item}`, anterior: ant.situacao_item_nome, novo: i.situacao_item_nome, fonte });
      }
    }
    // Agregados derivados dos itens (somente quando há evidência nos itens)
    const criterios = [...new Set(itens.map((i) => i.criterio_julgamento).filter(Boolean))];
    const beneficios = itens.map((i) => i.tipo_beneficio_id).filter((v) => v != null);
    const meEpp = beneficios.length === 0 ? null : beneficios.every((b) => b === 1) ? 1 : 0;
    const sigiloso = itens.length > 0 && itens.every((i) => i.orcamento_sigiloso === 1);
    db.prepare(`UPDATE licitacoes SET num_itens=?, criterio_julgamento=?, me_epp_exclusivo=?,
        valor_estimado = CASE WHEN ? THEN NULL ELSE valor_estimado END,
        valor_estimado_situacao = CASE WHEN ? THEN 'sigiloso' ELSE valor_estimado_situacao END,
        detalhes_sincronizados_em=datetime('now') WHERE id=?`)
      .run(itens.length, criterios.join('; ') || null, meEpp, sigiloso ? 1 : 0, sigiloso ? 1 : 0, licId);
    recalcularStatusDe(db, licId, agora);
  });
}

export function salvarDocumentos(db, licId, docs, fonte = 'pncp') {
  return transacao(db, () => {
    const existentes = new Set(db.prepare('SELECT sequencial FROM licitacao_documentos WHERE licitacao_id=?').all(licId).map((r) => r.sequencial));
    const primeiraCarga = existentes.size === 0;
    const up = db.prepare(`INSERT INTO licitacao_documentos (licitacao_id, sequencial, titulo, tipo, url, data_publicacao, ativo)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(licitacao_id, sequencial) DO UPDATE SET titulo=excluded.titulo, tipo=excluded.tipo,
      url=excluded.url, data_publicacao=excluded.data_publicacao, ativo=excluded.ativo`);
    for (const d of docs) {
      if (d.sequencial == null || !d.url) continue;
      up.run(licId, d.sequencial, d.titulo ?? null, d.tipo ?? null, d.url, d.data_publicacao ?? null, d.ativo ?? null);
      if (!primeiraCarga && !existentes.has(d.sequencial)) {
        evento(db, licId, 'documento', `Novo documento publicado: ${d.tipo || 'Documento'} — ${d.titulo || ''}`.trim(), { fonte, ocorrido: d.data_publicacao });
      }
    }
    db.prepare('UPDATE licitacoes SET tem_documentos=? WHERE id=?').run(docs.length > 0 ? 1 : 0, licId);
  });
}

export function recalcularStatusDe(db, licId, agora = agoraBrasilia()) {
  const lic = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(licId);
  if (!lic) return;
  const itens = lic.detalhes_sincronizados_em ? db.prepare('SELECT situacao_item_id FROM licitacao_itens WHERE licitacao_id=?').all(licId) : null;
  const st = classificarStatus(lic, itens, agora);
  if (st.status !== lic.status_calculado || st.motivo !== lic.status_motivo) {
    db.prepare('UPDATE licitacoes SET status_calculado=?, status_motivo=? WHERE id=?').run(st.status, st.motivo, licId);
    if (st.status !== lic.status_calculado && lic.status_calculado !== 'indeterminada') {
      evento(db, licId, 'situacao', `Status mudou: ${lic.status_calculado} → ${st.status}`, { campo: 'status_calculado', anterior: lic.status_calculado, novo: st.status });
    }
  }
}

// Status que dependem do relógio precisam ser reavaliados periodicamente
export function recalcularStatusTemporais(db, agora = agoraBrasilia()) {
  const ids = db.prepare(`SELECT id FROM licitacoes WHERE status_calculado IN ('aguardando_propostas','aberta','prazo_encerrado','em_disputa','indeterminada')`).all();
  for (const { id } of ids) recalcularStatusDe(db, id, agora);
  return ids.length;
}
