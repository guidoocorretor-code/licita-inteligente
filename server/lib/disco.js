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
