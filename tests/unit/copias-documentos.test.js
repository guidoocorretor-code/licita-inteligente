// Cópia dos arquivos do edital para licitações em "Meus Negócios": baixa, serve sem PNCP e apaga ao descartar/receber.
// DADOS DE TESTE fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bancoMemoria } from '../helpers.js';
import { copiarDocumentosDoKanban, limparCopias, caminhoCopia } from '../../server/services/copias-documentos.js';

test('copia os arquivos do Kanban, não copia de fora dele e apaga ao ir para Descartados/Recebido', async () => {
  const db = bancoMemoria();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copias-'));
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('A')").run().lastInsertRowid);
  const etapa = (nome, fase, ordem) => Number(db.prepare('INSERT INTO kanban_etapas (empresa_id, nome, ordem, fase) VALUES (?,?,?,?)').run(emp, nome, ordem, fase).lastInsertRowid);
  const prosp = etapa('Prospecção', 'prospeccao', 1); const desc = etapa('Descartados', 'descartada', 9); const receb = etapa('Recebido', 'recebida', 8);
  const lic = (k) => Number(db.prepare("INSERT INTO licitacoes (chave_canonica, objeto, orgao_cnpj, ano, sequencial, fonte_principal, detalhes_sincronizados_em) VALUES (?, 'Obra', '00394452000103', 2026, 21859, 'manual', datetime('now'))").run(k).lastInsertRowid);
  const a = lic('a'); const b = lic('b');
  const doc = db.prepare("INSERT INTO licitacao_documentos (licitacao_id, sequencial, titulo, tipo, url) VALUES (?,?,?,?,?)");
  doc.run(a, 1, 'Termo de Referência', 'Edital', 'https://pncp.gov.br/pncp-api/v1/orgaos/00394452000103/compras/2026/21859/arquivos/1');
  doc.run(b, 1, 'Edital', 'Edital', 'https://pncp.gov.br/pncp-api/v1/orgaos/00394452000103/compras/2026/21859/arquivos/1');
  const op = Number(db.prepare('INSERT INTO oportunidades (empresa_id, licitacao_id, etapa_id) VALUES (?,?,?)').run(emp, a, prosp).lastInsertRowid);

  const pdf = Buffer.from('%PDF-1.4 teste');
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/pdf', 'content-length': String(pdf.length) }), arrayBuffer: async () => pdf });
  const r = await copiarDocumentosDoKanban(db, { dir, fetchImpl });
  assert.equal(r.copiados, 1); // só a do Kanban
  const d = db.prepare('SELECT * FROM licitacao_documentos WHERE licitacao_id=?').get(a);
  assert.equal(d.copia_nome, 'Termo de Referencia.pdf');
  assert.deepEqual(fs.readFileSync(caminhoCopia(d.copia_arquivo, dir)), pdf);
  assert.equal(db.prepare('SELECT copia_arquivo FROM licitacao_documentos WHERE licitacao_id=?').get(b).copia_arquivo, null);

  // PNCP fora do ar: registra a falha e não tenta de novo antes de 1 h
  db.prepare('INSERT INTO licitacao_documentos (licitacao_id, sequencial, titulo, url) VALUES (?,2,?,?)').run(a, 'Anexo', 'https://pncp.gov.br/x/2');
  const fora = async () => ({ ok: false, status: 503 });
  assert.equal((await copiarDocumentosDoKanban(db, { dir, fetchImpl: fora })).falhas, 1);
  assert.equal((await copiarDocumentosDoKanban(db, { dir, fetchImpl: fora })).falhas, 0);
  assert.match(db.prepare('SELECT copia_falha FROM licitacao_documentos WHERE sequencial=2').get().copia_falha, /503/);

  // Ainda ativo: limpar não apaga
  assert.equal(limparCopias(db, { dir }), 0);
  for (const destino of [receb, desc]) {
    db.prepare('UPDATE oportunidades SET etapa_id=? WHERE id=?').run(destino, op);
    limparCopias(db, { dir });
    assert.equal(db.prepare('SELECT copia_arquivo FROM licitacao_documentos WHERE licitacao_id=? AND sequencial=1').get(a).copia_arquivo, null);
    assert.equal(fs.existsSync(caminhoCopia(d.copia_arquivo, dir)), false);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
