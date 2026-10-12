import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { semAcento } from '../lib/texto.js';
import { migrarCopiasDocumentos } from '../services/copias-documentos.js';
import { FONTES_PADRAO } from '../connectors/catalogo.js';
import { migrarExecucao } from '../services/execucao.js';
import { migrarFornecedores } from '../services/fornecedores.js';
import { migrarPropostas } from '../services/propostas.js';
import { migrarCotacaoLinks } from '../services/cotacao-link.js';
import { migrarJornalEnvios } from '../services/jornal-cliente.js';
import { migrarFinanceiro } from '../services/financeiro.js';
import { migrarJornalPerfis } from '../services/jornal-perfis.js';

let db;

export function abrirBanco(caminho = config.dbPath) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const conn = new DatabaseSync(caminho);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  // "Vitória" = "vitoria": comparação de texto sem acento e sem maiúsculas (LIKE do SQLite só ignora caixa em ASCII)
  conn.function('sem_acento', { deterministic: true }, semAcento);
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  conn.exec(schema);
  migrarClientes(conn);
  migrarSistemas(conn);
  migrarExecucao(conn);
  migrarFornecedores(conn);
  migrarCotacaoLinks(conn);
  migrarPropostas(conn);
  migrarJornalEnvios(conn);
  migrarFinanceiro(conn);
  migrarJornalPerfis(conn);
  migrarCopiasDocumentos(conn);
  semearFontes(conn);
  return conn;
}

export function getDb() {
  if (!db) db = abrirBanco();
  return db;
}

export function setDb(conn) { db = conn; }

// Sistema eletrônico de disputa (Comprasnet, Licitações-e, BLL...): coluna nova em bancos antigos;
// o preenchimento das licitações antigas roda em segundo plano (services/sistemas.js).
function migrarSistemas(conn) {
  if (!colunas(conn, 'licitacoes').includes('sistema_eletronico')) conn.exec('ALTER TABLE licitacoes ADD COLUMN sistema_eletronico TEXT');
  conn.exec('CREATE INDEX IF NOT EXISTS ix_lic_sistema ON licitacoes(sistema_eletronico)');
}

const colunas = (conn, t) => conn.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

// Empresas assessoradas: favoritos, Kanban, pesquisas e alertas passam a ser separados por empresa (cliente_id).
// Bancos antigos: favoritos e oportunidades são recriados porque a regra de "não repetir" passa a
// incluir a empresa (a mesma licitação pode estar no Kanban de duas empresas). Os ids são mantidos.
function migrarClientes(conn) {
  for (const t of ['pesquisas_salvas', 'notificacoes']) {
    if (!colunas(conn, t).includes('cliente_id')) conn.exec(`ALTER TABLE ${t} ADD COLUMN cliente_id INTEGER NOT NULL DEFAULT 0`);
  }
  const recriar = [];
  if (!colunas(conn, 'favoritos').includes('cliente_id')) recriar.push('favoritos');
  if (!colunas(conn, 'oportunidades').includes('cliente_id')) recriar.push('oportunidades');
  if (recriar.length) {
    conn.exec('PRAGMA foreign_keys = OFF');
    try {
      transacao(conn, () => {
        if (recriar.includes('favoritos')) {
          conn.exec(`CREATE TABLE favoritos_novo (
            id INTEGER PRIMARY KEY,
            empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            tipo TEXT NOT NULL CHECK (tipo IN ('licitacao','orgao','fornecedor','pesquisa')),
            referencia TEXT NOT NULL,
            lista TEXT NOT NULL DEFAULT 'Geral',
            nota TEXT,
            criado_em TEXT NOT NULL DEFAULT (datetime('now')),
            cliente_id INTEGER NOT NULL DEFAULT 0,
            UNIQUE (usuario_id, cliente_id, tipo, referencia, lista));
          INSERT INTO favoritos_novo (id, empresa_id, usuario_id, tipo, referencia, lista, nota, criado_em)
            SELECT id, empresa_id, usuario_id, tipo, referencia, lista, nota, criado_em FROM favoritos;
          DROP TABLE favoritos;
          ALTER TABLE favoritos_novo RENAME TO favoritos;`);
        }
        if (recriar.includes('oportunidades')) {
          conn.exec(`CREATE TABLE oportunidades_novo (
            id INTEGER PRIMARY KEY,
            empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
            etapa_id INTEGER NOT NULL REFERENCES kanban_etapas(id),
            responsavel_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
            prazo_interno TEXT,
            posicao INTEGER NOT NULL DEFAULT 0,
            criado_em TEXT NOT NULL DEFAULT (datetime('now')),
            atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
            cliente_id INTEGER NOT NULL DEFAULT 0,
            UNIQUE (empresa_id, cliente_id, licitacao_id));
          INSERT INTO oportunidades_novo (id, empresa_id, licitacao_id, etapa_id, responsavel_id, prazo_interno, posicao, criado_em, atualizado_em)
            SELECT id, empresa_id, licitacao_id, etapa_id, responsavel_id, prazo_interno, posicao, criado_em, atualizado_em FROM oportunidades;
          DROP TABLE oportunidades;
          ALTER TABLE oportunidades_novo RENAME TO oportunidades;`);
        }
        const problemas = conn.prepare('PRAGMA foreign_key_check').all();
        if (problemas.length) throw new Error(`Migração de empresas: ${problemas.length} vínculo(s) inválido(s)`);
      });
    } finally { conn.exec('PRAGMA foreign_keys = ON'); }
  }
  conn.exec(`CREATE INDEX IF NOT EXISTS ix_fav_emp ON favoritos(empresa_id, usuario_id);
    CREATE INDEX IF NOT EXISTS ix_fav_cli ON favoritos(cliente_id);
    CREATE INDEX IF NOT EXISTS ix_op_cli ON oportunidades(empresa_id, cliente_id);`);
}

// Insere o catálogo de fontes sem sobrescrever o que o administrador alterou.
function semearFontes(conn) {
  const ins = conn.prepare(`INSERT INTO fontes (codigo, nome, url_oficial, tipo_integracao, status_implementacao,
      habilitada, requer_credenciais, frequencia_minutos, observacoes, config_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(codigo) DO UPDATE SET nome=excluded.nome, url_oficial=excluded.url_oficial,
      tipo_integracao=excluded.tipo_integracao, status_implementacao=excluded.status_implementacao,
      requer_credenciais=excluded.requer_credenciais, observacoes=excluded.observacoes`);
  for (const f of FONTES_PADRAO) {
    ins.run(f.codigo, f.nome, f.url, f.tipo, f.status, f.habilitada ? 1 : 0, f.credenciais ? 1 : 0,
      f.frequencia ?? 60, f.observacoes, JSON.stringify(f.config || {}));
  }
  // O limite antigo de 20 páginas (1.000 registros por modalidade) cortava a carga nacional do PNCP.
  const pncp = conn.prepare("SELECT config_json FROM fontes WHERE codigo='pncp'").get();
  const cfg = pncp ? JSON.parse(pncp.config_json || '{}') : null;
  if (cfg && cfg.maxPaginasPorConsulta === 20) {
    conn.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify({ ...cfg, maxPaginasPorConsulta: 2000 }));
  }
}

// Transação simples para node:sqlite
export function transacao(conn, fn) {
  conn.exec('BEGIN');
  try { const r = fn(); conn.exec('COMMIT'); return r; }
  catch (e) { conn.exec('ROLLBACK'); throw e; }
}

/**
 * Coloca no índice de busca os itens baixados antes da busca nos itens existir, em lotes pequenos.
 * Não roda na abertura do banco: com muitos itens, indexar tudo de uma vez passava dos 60 s
 * de verificação de saúde do Railway e o site não subia. Retorna quantos itens indexou neste lote.
 */
export function indexarItensPendentes(conn, { aposId = 0, lote = 2000 } = {}) {
  const ids = conn.prepare('SELECT id FROM licitacao_itens WHERE id > ? ORDER BY id LIMIT ?').all(aposId, lote);
  if (!ids.length) return { indexados: 0, ultimoId: aposId, fim: true };
  const ultimoId = ids[ids.length - 1].id;
  const out = conn.prepare(`INSERT INTO itens_fts(rowid, descricao) SELECT id, descricao FROM licitacao_itens i
    WHERE id > ? AND id <= ? AND NOT EXISTS (SELECT 1 FROM itens_fts_docsize d WHERE d.id = i.id)`).run(aposId, ultimoId);
  return { indexados: Number(out.changes), ultimoId, fim: ids.length < lote };
}

/** Roda indexarItensPendentes em segundo plano, um lote por vez, sem travar as requisições. */
export function indexarItensEmSegundoPlano(conn, { lote = 2000, log = console.log } = {}) {
  let aposId = 0; let total = 0;
  return new Promise((resolve) => {
    const passo = () => {
      try {
        const r = indexarItensPendentes(conn, { aposId, lote });
        total += r.indexados; aposId = r.ultimoId;
        if (r.fim) { if (total) log(`[itens] índice de busca completo: ${total} itens antigos indexados.`); return resolve(total); }
        setTimeout(passo, 20);
      } catch (e) { log(`[itens] falha ao indexar: ${e.message}`); resolve(total); }
    };
    setTimeout(passo, 0);
  });
}
