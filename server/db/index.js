import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { FONTES_PADRAO } from '../connectors/catalogo.js';

let db;

export function abrirBanco(caminho = config.dbPath) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const conn = new DatabaseSync(caminho);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  conn.exec(schema);
  semearFontes(conn);
  return conn;
}

export function getDb() {
  if (!db) db = abrirBanco();
  return db;
}

export function setDb(conn) { db = conn; }

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
