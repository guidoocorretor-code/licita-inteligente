import test from 'node:test';
import assert from 'node:assert/strict';
import { lerSicafPdf, lerDeclaracaoSicaf } from '../../server/services/sicaf.js';

// PDF mínimo com texto (Helvetica/WinAnsi). Cada linha: [x, y, texto]. DADOS DE TESTE no layout da declaração real do SICAF.
function pdfComTexto(linhas) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const conteudo = linhas.map(([x, y, t]) => `BT /F1 9 Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let pdf = '%PDF-1.4\n'; const pos = [];
  objs.forEach((o, i) => { pos.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const DECLARACAO = [
  [40, 800, 'Sistema de Cadastramento Unificado de Fornecedores - SICAF'],
  [40, 780, 'CNPJ: 11.222.333/0001-81'], [200, 780, 'DUNS®: 00*****00'],
  [40, 765, 'Razão Social: EMPRESA DE TESTE LTDA'],
  [40, 750, 'Situação do Fornecedor: Credenciado'], [250, 750, 'Data de Vencimento do Cadastro: 15/09/2027'],
  [40, 700, 'III - Regularidade Fiscal e Trabalhista Federal'],
  [40, 685, 'Receita Federal e PGFN'], [300, 685, '22/08/2026'], [380, 685, 'Automática'],
  [40, 670, 'FGTS'], [300, 670, '20/06/2026'], [380, 670, 'Automática'],
  [40, 655, 'Trabalhista (http://www.tst.jus.br/certidao)'], [250, 655, 'Validade:'], [300, 655, '26/08/2026'],
  [250, 640, 'Validade:'], [250, 625, 'Validade:'],
  [40, 600, 'IV - Regularidade Fiscal Estadual/Distrital e Municipal'],
  [40, 585, 'Receita Estadual/Distrital'], [250, 585, 'Validade:'], [300, 585, '15/06/2027'],
  [40, 570, 'Receita Municipal'], [250, 570, 'Validade:'], [300, 570, '11/06/2026'],
  [40, 540, 'V - Qualificação Técnica'],
  [40, 520, 'VI - Qualificação Econômico-Financeira'],
  [300, 505, '30/06/2027'], [250, 505, 'Validade:'],
  [40, 470, 'Declaração'],
  [40, 440, 'Emitido em: 03/06/2026 16:27'],
];

test('lê as validades de uma declaração SICAF em PDF', async () => {
  const r = await lerSicafPdf(pdfComTexto(DECLARACAO));
  assert.equal(r.eh_sicaf, true);
  assert.equal(r.cnpj, '11222333000181');
  assert.equal(r.emitido_em, '2026-06-03');
  assert.deepEqual(r.validades, { sicaf: '2027-09-15', federal: '2026-08-22', fgts: '2026-06-20', trabalhista: '2026-08-26',
    estadual: '2027-06-15', municipal: '2026-06-11', qualificacao: '2027-06-30' });
});

test('não inventa datas: seção sem data fica de fora e PDF que não é SICAF é sinalizado', () => {
  const r = lerDeclaracaoSicaf(['SICAF', 'Receita Federal e PGFN', 'VI - Qualificação Econômico-Financeira', 'Declaração', 'Emitido em: 01/02/2026']);
  assert.deepEqual(r.validades, {});
  assert.equal(lerDeclaracaoSicaf(['Nota fiscal 10/10/2026']).eh_sicaf, false);
  assert.equal(lerDeclaracaoSicaf(['SICAF', 'FGTS 31/02/2026']).validades.fgts, undefined); // data impossível
});

test('PDF corrompido gera erro claro', async () => {
  await assert.rejects(lerSicafPdf(Buffer.from('%PDF-1.4 lixo')), /Não foi possível ler o PDF/);
});
