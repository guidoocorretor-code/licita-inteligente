// Leitura da "Declaração de Situação do Fornecedor" do SICAF (PDF emitido pelo próprio SICAF).
// Só lê o texto do PDF que o usuário enviou: não consulta o SICAF nem a Receita.
// Layout conferido em declarações públicas reais (ex.: https://esr.rnp.br/wp-content/uploads/2026/06/SICAF.pdf):
//   Situação do Fornecedor: Credenciado Data de Vencimento do Cadastro: 15/09/2026
//   Receita Federal e PGFN 22/08/2026 Automática
//   FGTS 20/06/2026 Automática
//   Trabalhista (http://www.tst.jus.br/certidao) Validade: 26/08/2026 Automática
//   Receita Estadual/Distrital Validade: 15/06/2026
//   Receita Municipal Validade: 11/06/2026
//   VI - Qualificação Econômico-Financeira  /  Validade: 30/06/2026 (às vezes "30/06/2026Validade:", na linha seguinte)
//   Emitido em: 03/06/2026 16:27
// PDF escaneado (imagem) não tem texto: nesse caso nada é preenchido e o usuário digita.

const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const DATA_G = /(\d{2})\/(\d{2})\/(\d{4})/g;

function iso(m) {
  if (!m) return null;
  const [, d, mes, a] = m;
  const n = new Date(`${a}-${mes}-${d}T12:00:00Z`);
  if (Number.isNaN(n.getTime()) || n.getUTCDate() !== Number(d)) return null;
  return `${a}-${mes}-${d}`;
}

/** Texto do PDF em linhas (itens com a mesma altura na página viram uma linha, da esquerda para a direita). */
export async function linhasDoPdf(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const linhas = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
      const { items } = await (await doc.getPage(p)).getTextContent();
      const grupos = [];
      for (const it of items) {
        if (!it.str?.trim()) continue;
        const y = it.transform[5]; const x = it.transform[4];
        let g = grupos.find((gg) => Math.abs(gg.y - y) <= 2.5);
        if (!g) { g = { y, partes: [] }; grupos.push(g); }
        g.partes.push({ x, s: it.str });
      }
      grupos.sort((a, b) => b.y - a.y);
      for (const g of grupos) linhas.push(g.partes.sort((a, b) => a.x - b.x).map((q) => q.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  } finally { await doc.destroy(); }
  return linhas;
}

const REGRAS = [
  ['federal', /receita federal|pgfn/i],
  ['fgts', /\bfgts\b/i],
  ['trabalhista', /trabalhista/i],
  ['estadual', /receita estadual/i],
  ['municipal', /receita municipal/i],
];

/** Extrai as validades das linhas da declaração. Devolve { validades: {tipo: 'AAAA-MM-DD'}, emitido_em, cnpj, eh_sicaf }. */
export function lerDeclaracaoSicaf(linhas) {
  const validades = {};
  const texto = linhas.join('\n');
  const eh_sicaf = /SICAF|Cadastramento Unificado de Fornecedores/i.test(texto);
  const venc = texto.match(/Vencimento do Cadastro:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (venc) validades.sicaf = iso(venc[1].match(DATA));
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    for (const [tipo, re] of REGRAS) {
      if (validades[tipo] || !re.test(l)) continue;
      const d = iso(l.match(DATA)); // a data fica na mesma linha; o cabeçalho "III - ... Trabalhista Federal" não tem data e é ignorado
      if (d) validades[tipo] = d;
    }
    if (!validades.qualificacao && /qualifica[çc][ãa]o econ[ôo]mic/i.test(l)) {
      // a data vem na mesma linha ou logo abaixo, antes da próxima seção ("Declaração", "VII - ...")
      for (let j = i; j < Math.min(linhas.length, i + 4); j++) {
        if (j > i && /^(declara|[IVX]+ ?-)/i.test(linhas[j])) break;
        const d = iso(linhas[j].match(DATA));
        if (d) { validades.qualificacao = d; break; }
      }
    }
  }
  for (const k of Object.keys(validades)) if (!validades[k]) delete validades[k];
  const emit = texto.match(/Emitido em:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const cnpj = texto.match(/CNPJ:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i);
  return { eh_sicaf, validades, emitido_em: emit ? iso(emit[1].match(DATA)) : null, cnpj: cnpj ? cnpj[1].replace(/\D/g, '') : null, total_datas: (texto.match(DATA_G) || []).length };
}

export async function lerSicafPdf(buffer) {
  let linhas;
  try { linhas = await linhasDoPdf(buffer); }
  catch { const e = new Error('Não foi possível ler o PDF (arquivo protegido ou corrompido). Digite as datas manualmente.'); e.status = 400; throw e; }
  const r = lerDeclaracaoSicaf(linhas);
  return { ...r, sem_texto: linhas.length === 0 };
}
