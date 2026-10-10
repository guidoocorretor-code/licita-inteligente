import fs from 'node:fs';
import { abrirBanco, setDb } from '../server/db/index.js';

export function bancoMemoria() { const db = abrirBanco(':memory:'); setDb(db); return db; }
export function fixture(nome) {
  const o = JSON.parse(fs.readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), 'utf8'));
  delete o._origem; return o;
}
export const clonar = (o) => JSON.parse(JSON.stringify(o));

/** fetch falso: recebe um mapa (função) url -> {status, body} */
export function fetchFalso(resolver) {
  const chamadas = [];
  const impl = async (url) => {
    chamadas.push(url);
    const r = await resolver(url);
    if (r instanceof Error) throw r;
    const corpo = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => null }, text: async () => corpo };
  };
  impl.chamadas = chamadas;
  return impl;
}
