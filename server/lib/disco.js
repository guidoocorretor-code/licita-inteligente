// Espaço livre no volume onde fica o banco. Com o disco cheio o SQLite para de gravar e o site não inicia
// (10/10/2026: "database or disk is full" no volume de 0,5 GB do plano de teste do Railway).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const LIMITE_PCT = Number(process.env.DISCO_MIN_LIVRE_PCT ?? 10);
export const LIMITE_MB = Number(process.env.DISCO_MIN_LIVRE_MB ?? 100);

export function espacoEmDisco(caminho = path.dirname(config.dbPath), statfs = fs.statfsSync) {
  try {
    const s = statfs(caminho);
    const total = s.blocks * s.bsize; const livre = s.bavail * s.bsize;
    if (!total) return null;
    const livrePct = Math.round((livre / total) * 1000) / 10;
    const baixo = livrePct < LIMITE_PCT || livre < LIMITE_MB * 1024 * 1024;
    return { total_mb: Math.round(total / 1048576), livre_mb: Math.round(livre / 1048576), livre_pct: livrePct, baixo };
  } catch { return null; }
}

/** Tamanho (bytes) de um arquivo ou pasta (soma recursiva); 0 se não existir. */
export function tamanhoDe(alvo) {
  try {
    const st = fs.statSync(alvo);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(alvo).reduce((s, n) => s + tamanhoDe(path.join(alvo, n)), 0);
  } catch { return 0; }
}

/** Uso do volume para a tela de Configurações: total, livre e o que mais ocupa. */
export function usoDoDisco() {
  const d = espacoEmDisco();
  if (!d) return null;
  const mb = (b) => Math.round((b / 1048576) * 10) / 10;
  const banco = ['', '-wal', '-shm'].reduce((s, suf) => s + tamanhoDe(config.dbPath + suf), 0);
  const copias = tamanhoDe(path.join(config.storageDir, 'documentos-edital'));
  return { ...d, usado_mb: d.total_mb - d.livre_mb, limite_pct: LIMITE_PCT, limite_mb: LIMITE_MB,
    partes: [{ nome: 'Banco de dados (licitações, itens, Kanban…)', mb: mb(banco) }, { nome: 'Cópias dos arquivos do edital (Meus Negócios)', mb: mb(copias) }] };
}
