// Indicadores calculados exclusivamente a partir do banco de dados.
import { statusDaVisao, agoraBrasilia } from './status.js';

const inSt = (visao) => statusDaVisao(visao).map((s) => `'${s}'`).join(',');

export function indicadores(db, { usuarioId, agora = agoraBrasilia() } = {}) {
  const base = Date.parse(agora + 'Z');
  const menos = (h) => new Date(base - h * 3600000).toISOString().slice(0, 19);
  const mais = (d) => new Date(base + d * 86400000).toISOString().slice(0, 19);
  const um = (sql, ...p) => db.prepare(sql).get(...p);
  const todos = (sql, ...p) => db.prepare(sql).all(...p);

  const total = um('SELECT COUNT(*) n FROM licitacoes').n;
  const porVisao = {};
  for (const v of ['abertas', 'em_disputa', 'encerradas', 'desertas_fracassadas', 'outras']) {
    porVisao[v] = um(`SELECT COUNT(*) n FROM licitacoes WHERE status_calculado IN (${inSt(v)})`).n;
  }
  const valorAbertas = um(`SELECT COALESCE(SUM(valor_estimado),0) v, COUNT(valor_estimado) com_valor,
      SUM(CASE WHEN valor_estimado_situacao='sigiloso' THEN 1 ELSE 0 END) sigilosos,
      SUM(CASE WHEN valor_estimado IS NULL OR valor_estimado = 0 THEN 1 ELSE 0 END) sem_valor
    FROM licitacoes WHERE status_calculado IN (${inSt('abertas')})`);
  const valorHomologado = um(`SELECT COALESCE(SUM(valor_homologado),0) v, COUNT(valor_homologado) n FROM licitacoes WHERE valor_homologado IS NOT NULL AND valor_homologado > 0`);

  return {
    atualizado_em: agora,
    ultima_sincronizacao: um("SELECT MAX(ultima_sincronizacao_ok) d FROM fontes").d,
    total,
    por_visao: porVisao,
    sessoes_proximas: um(`SELECT COUNT(*) n FROM licitacoes WHERE data_encerramento_proposta BETWEEN ? AND ?`, agora, mais(7)).n,
    valor_estimado_abertas: valorAbertas,
    valor_homologado: valorHomologado,
    novas_24h: um('SELECT COUNT(*) n FROM licitacoes WHERE data_publicacao >= ?', menos(24)).n,
    novas_7d: um('SELECT COUNT(*) n FROM licitacoes WHERE data_publicacao >= ?', menos(24 * 7)).n,
    novas_30d: um('SELECT COUNT(*) n FROM licitacoes WHERE data_publicacao >= ?', menos(24 * 30)).n,
    importadas_24h: um("SELECT COUNT(*) n FROM licitacoes WHERE criado_em >= datetime('now','-1 day')").n,
    por_uf: todos(`SELECT COALESCE(uf,'(não informado)') rotulo, COUNT(*) n FROM licitacoes GROUP BY uf ORDER BY n DESC`),
    por_municipio: todos(`SELECT municipio || ' / ' || uf rotulo, COUNT(*) n FROM licitacoes WHERE municipio IS NOT NULL GROUP BY municipio, uf ORDER BY n DESC LIMIT 200`),
    por_orgao: todos(`SELECT orgao_nome rotulo, orgao_cnpj cnpj, COUNT(*) n FROM licitacoes WHERE orgao_nome IS NOT NULL GROUP BY orgao_cnpj, orgao_nome ORDER BY n DESC LIMIT 200`),
    por_segmento: todos(`SELECT COALESCE(segmento,'(sem objeto)') rotulo, COUNT(*) n FROM licitacoes GROUP BY segmento ORDER BY n DESC`),
    por_modalidade: todos(`SELECT COALESCE(modalidade_nome,'(não informada)') rotulo, MIN(modalidade_id) id, COUNT(*) n FROM licitacoes GROUP BY modalidade_nome ORDER BY n DESC`),
    por_plataforma: todos(`SELECT COALESCE(plataforma_origem,'(não informada)') rotulo, COUNT(*) n FROM licitacoes GROUP BY plataforma_origem ORDER BY n DESC`),
    alertas_pendentes: usuarioId ? um('SELECT COUNT(*) n FROM notificacoes WHERE usuario_id=? AND lida=0', usuarioId).n : 0,
    conectores_com_falha: todos(`SELECT codigo, nome, situacao_conexao, ultimo_erro, ultima_sincronizacao FROM fontes
      WHERE habilitada=1 AND situacao_conexao IN ('erro','bloqueada_rede')`),
  };
}
