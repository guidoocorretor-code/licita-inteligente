// Cópia dos arquivos do edital das licitações que estão em "Meus Negócios" (Kanban), para abrir mesmo com o PNCP
// fora do ar. Só as do Kanban (guardar o Brasil inteiro lotaria o disco). Quando o card vai para Descartados ou
// Recebido (e não há outro card ativo da mesma licitação), as cópias são apagadas. Decisão do Guido, 12/10/2026.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { urlDoDocumento, buscarArquivo, nomeDoArquivo } from './documentos-pncp.js';
import { sincronizarDetalhesDe } from './sync.js';

export const FASES_SEM_COPIA = ['descartada', 'recebida'];
const TAMANHO_MAX = 100 * 1024 * 1024; // arquivo acima de 100 MB não é copiado (abre direto do PNCP)
const RETENTAR_MS = 3600_000;          // falhou: tenta de novo depois de 1 h
const ATUALIZAR_LISTA_MS = 24 * 3600_000; // lista de arquivos do Kanban conferida no PNCP 1x por dia

export function migrarCopiasDocumentos(conn) {
  const cols = conn.prepare('PRAGMA table_info(licitacao_documentos)').all().map((c) => c.name);
  const add = (c, t) => { if (!cols.includes(c)) conn.exec(`ALTER TABLE licitacao_documentos ADD COLUMN ${c} ${t}`); };
  add('copia_arquivo', 'TEXT');   // caminho relativo ao STORAGE_DIR
  add('copia_nome', 'TEXT');
  add('copia_tipo', 'TEXT');
  add('copia_tamanho', 'INTEGER');
  add('copia_em', 'TEXT');        // datetime UTC
  add('copia_falha', 'TEXT');
  add('copia_tentativa_em', 'TEXT');
}

/** Licitações com pelo menos um card ativo no Kanban (fora de Descartados e Recebido). */
const SQL_GUARDAR = `SELECT DISTINCT o.licitacao_id FROM oportunidades o JOIN kanban_etapas e ON e.id = o.etapa_id
  WHERE o.licitacao_id IS NOT NULL AND COALESCE(e.fase, '') NOT IN (${FASES_SEM_COPIA.map((f) => `'${f}'`).join(',')})`;

export const caminhoCopia = (rel, dir = config.storageDir) => path.join(dir, rel);

/** Apaga as cópias de licitações que não estão mais ativas no Kanban. Devolve quantos arquivos apagou. */
export function limparCopias(db, { dir = config.storageDir } = {}) {
  const docs = db.prepare(`SELECT id, licitacao_id, copia_arquivo FROM licitacao_documentos
    WHERE copia_arquivo IS NOT NULL AND licitacao_id NOT IN (${SQL_GUARDAR})`).all();
  const zerar = db.prepare('UPDATE licitacao_documentos SET copia_arquivo=NULL, copia_nome=NULL, copia_tipo=NULL, copia_tamanho=NULL, copia_em=NULL WHERE id=?');
  for (const d of docs) {
    try { fs.rmSync(caminhoCopia(d.copia_arquivo, dir), { force: true }); } catch { /* já não existe */ }
    zerar.run(d.id);
    try { fs.rmdirSync(path.dirname(caminhoCopia(d.copia_arquivo, dir))); } catch { /* pasta ainda tem arquivos */ }
  }
  return docs.length;
}

let copiando = false;
/** Baixa as cópias que faltam (poucas por vez). Roda no agendador. */
export async function copiarDocumentosDoKanban(db, { dir = config.storageDir, limite = 10, fetchImpl, agora = Date.now() } = {}) {
  if (copiando) return { pulado: true };
  copiando = true;
  const r = { listas: 0, copiados: 0, falhas: 0 };
  try {
    // 1) Lista de arquivos atualizada (retificação publica arquivo novo)
    const desatualizadas = db.prepare(`SELECT id, detalhes_sincronizados_em s FROM licitacoes WHERE id IN (${SQL_GUARDAR})
      AND fonte_principal='pncp'`).all().filter((l) => !l.s || agora - Date.parse(`${l.s.replace(' ', 'T')}Z`) > ATUALIZAR_LISTA_MS).slice(0, 3);
    for (const l of desatualizadas) {
      try { await sincronizarDetalhesDe(db, l.id, { fetchImpl }); r.listas++; } catch { /* tenta no próximo ciclo */ }
    }
    // 2) Arquivos sem cópia
    const limiteTentativa = new Date(agora - RETENTAR_MS).toISOString().slice(0, 19).replace('T', ' ');
    const pend = db.prepare(`SELECT d.*, l.orgao_cnpj, l.ano lic_ano, l.sequencial lic_seq FROM licitacao_documentos d JOIN licitacoes l ON l.id = d.licitacao_id
      WHERE d.licitacao_id IN (${SQL_GUARDAR}) AND d.copia_arquivo IS NULL AND COALESCE(d.ativo, 1) = 1
        AND (d.copia_tentativa_em IS NULL OR d.copia_tentativa_em < ?) ORDER BY d.licitacao_id, d.sequencial LIMIT ?`).all(limiteTentativa, limite);
    const falhou = db.prepare("UPDATE licitacao_documentos SET copia_falha=?, copia_tentativa_em=datetime('now') WHERE id=?");
    const ok = db.prepare(`UPDATE licitacao_documentos SET copia_arquivo=?, copia_nome=?, copia_tipo=?, copia_tamanho=?, copia_em=datetime('now'),
      copia_falha=NULL, copia_tentativa_em=datetime('now') WHERE id=?`);
    for (const d of pend) {
      const url = urlDoDocumento({ orgao_cnpj: d.orgao_cnpj, ano: d.lic_ano, sequencial: d.lic_seq }, d);
      if (!url) { falhou.run('Endereço do arquivo fora do PNCP.', d.id); r.falhas++; continue; }
      const b = await buscarArquivo(url, { fetchImpl });
      if (!b.ok) { falhou.run(b.motivo, d.id); r.falhas++; continue; }
      try {
        const tam = Number(b.resp.headers.get('content-length'));
        if (tam > TAMANHO_MAX) throw new Error('Arquivo acima de 100 MB: abre direto do PNCP.');
        const buf = Buffer.from(await b.resp.arrayBuffer());
        if (buf.length > TAMANHO_MAX) throw new Error('Arquivo acima de 100 MB: abre direto do PNCP.');
        const tipo = b.resp.headers.get('content-type') || 'application/octet-stream';
        const rel = path.join('documentos-edital', String(d.licitacao_id), String(d.sequencial));
        fs.mkdirSync(path.dirname(caminhoCopia(rel, dir)), { recursive: true });
        fs.writeFileSync(caminhoCopia(rel, dir), buf);
        ok.run(rel, nomeDoArquivo(d, b.resp.headers.get('content-disposition'), tipo), tipo, buf.length, d.id);
        r.copiados++;
      } catch (e) { falhou.run(e.message.slice(0, 200), d.id); r.falhas++; } finally { b.fim(); }
    }
    return r;
  } finally { copiando = false; }
}
