import ExcelJS from 'exceljs';
import { STATUS } from './status.js';
import { ESFERAS } from './normalizacao.js';

const COLS = [
  ['Nº controle PNCP', 'numero_controle_pncp', 28], ['Número', (r) => (r.numero_compra ? `${r.numero_compra}/${r.ano ?? ''}` : ''), 14],
  ['Processo', 'processo', 22], ['Órgão', 'orgao_nome', 40], ['CNPJ do órgão', 'orgao_cnpj', 18],
  ['Esfera', (r) => ESFERAS[r.esfera] || r.esfera || '', 12], ['UF', 'uf', 5], ['Município', 'municipio', 20],
  ['Modalidade', 'modalidade_nome', 22], ['Objeto', 'objeto', 70], ['Segmento (estimado)', 'segmento', 22],
  ['Valor estimado (R$)', (r) => (r.valor_estimado_situacao === 'sigiloso' ? 'Sigiloso' : r.valor_estimado ?? 'Não informado'), 18],
  ['Valor homologado (R$)', (r) => r.valor_homologado ?? '', 18],
  ['Publicação', 'data_publicacao', 18], ['Abertura propostas', 'data_abertura_proposta', 18],
  ['Encerramento propostas', 'data_encerramento_proposta', 18],
  ['Status', (r) => STATUS[r.status_calculado]?.rotulo || r.status_calculado, 26], ['Situação oficial', 'situacao_oficial_nome', 18],
  ['Plataforma de origem', 'plataforma_origem', 20], ['Fontes', 'fontes', 20], ['Link PNCP', 'link_pncp', 40],
  ['Link sistema de origem', 'link_origem', 40], ['Última verificação', 'ultima_verificacao', 18],
];
const val = (r, c) => (typeof c === 'function' ? c(r) : r[c] ?? '');

export function paraCsv(linhas) {
  const esc = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cab = COLS.map(([t]) => esc(t)).join(';');
  const corpo = linhas.map((r) => COLS.map(([, c]) => esc(val(r, c))).join(';'));
  return '﻿' + [cab, ...corpo].join('\r\n'); // BOM + ";" para abrir corretamente no Excel em pt-BR
}

export async function paraXlsx(linhas) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Licita Inteligente';
  const ws = wb.addWorksheet('Licitações');
  ws.columns = COLS.map(([header, , width]) => ({ header, width }));
  for (const r of linhas) ws.addRow(COLS.map(([, c]) => val(r, c)));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLS.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  [12, 13].forEach((i) => { ws.getColumn(i).numFmt = '"R$" #,##0.00'; });
  return wb.xlsx.writeBuffer();
}
