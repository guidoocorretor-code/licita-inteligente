// Gerador de PDF de texto (A4), sem dependências: Helvetica e Helvetica-Bold com codificação WinAnsi
// (cobre o português). Serve para comprovantes e relatórios simples: texto, tabelas sem mesclagem e barras.

// Larguras da Helvetica (AFM padrão), em milésimos do corpo, para os caracteres 32 a 126
const LARG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584];

// Troca o que a WinAnsi não tem por equivalentes simples
const limpar = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/•/g, '\x95').replace(/[   ]/g, ' ').replace(/[\r\t]/g, ' ');

function largura(texto, tam, negrito) {
  let w = 0;
  for (const c of texto) {
    const base = c.normalize('NFD')[0];
    const cod = base.charCodeAt(0);
    w += cod >= 32 && cod <= 126 ? LARG[cod - 32] : 556;
  }
  return (w * tam * (negrito ? 1.1 : 1)) / 1000;
}

// Bytes WinAnsi (Latin-1 nos acentos do português) com escape de \ ( )
function codificar(texto) {
  let out = '';
  for (const c of texto) {
    const cod = c.charCodeAt(0);
    const ch = cod < 256 ? c : '?';
    out += ch === '\\' || ch === '(' || ch === ')' ? `\\${ch}` : ch;
  }
  return out;
}

export function criarPdf() {
  const W = 595.28; const H = 841.89; const M = 50;
  const paginas = [];
  let ops = []; let links = []; let y = H - M;
  const novaPagina = () => { if (ops.length) paginas.push({ conteudo: ops.join('\n'), links }); ops = []; links = []; y = H - M; };
  const garantir = (alt) => { if (y - alt < M + 20) novaPagina(); };

  const quebrar = (texto, tam, negrito, maxW) => {
    const linhas = [];
    for (const par of limpar(texto).split('\n')) {
      let atual = '';
      for (const palavra of par.split(/ +/)) {
        const tentativa = atual ? `${atual} ${palavra}` : palavra;
        if (largura(tentativa, tam, negrito) <= maxW || !atual) atual = tentativa;
        else { linhas.push(atual); atual = palavra; }
        // Palavra maior que a linha: corta
        while (largura(atual, tam, negrito) > maxW && atual.length > 1) {
          let n = atual.length - 1;
          while (n > 1 && largura(atual.slice(0, n), tam, negrito) > maxW) n--;
          linhas.push(atual.slice(0, n)); atual = atual.slice(n);
        }
      }
      linhas.push(atual);
    }
    return linhas;
  };

  const api = {
    /** Parágrafo com quebra automática. Com `url`, o texto vira link clicável (sublinhado). */
    texto(t, { tam = 10, negrito = false, cor = [0, 0, 0], x = M, maxW = W - 2 * M - (x - M), espaco = 1.35, depois = 2, url = null } = {}) {
      for (const l of quebrar(t, tam, negrito, maxW)) {
        garantir(tam * espaco);
        y -= tam * espaco;
        ops.push(`BT /${negrito ? 'F2' : 'F1'} ${tam} Tf ${cor.join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${codificar(l)}) Tj ET`);
        if (url) {
          const w = largura(l, tam, negrito);
          ops.push(`${cor.join(' ')} RG 0.5 w ${x.toFixed(2)} ${(y - 1.5).toFixed(2)} m ${(x + w).toFixed(2)} ${(y - 1.5).toFixed(2)} l S`);
          links.push({ r: [x, y - 3, x + w, y + tam], url });
        }
      }
      y -= depois;
      return api;
    },
    /** Rótulo em negrito seguido do valor na mesma linha (o valor quebra se precisar). */
    campo(rotulo, valor, { tam = 10 } = {}) {
      const r = `${limpar(rotulo)} `;
      const wr = largura(r, tam, true) + 3;
      const linhas = quebrar(valor ?? '', tam, false, W - 2 * M - wr);
      linhas.forEach((l, i) => {
        garantir(tam * 1.35); y -= tam * 1.35;
        if (i === 0) ops.push(`BT /F2 ${tam} Tf 0 0 0 rg ${M} ${y.toFixed(2)} Td (${codificar(r)}) Tj ET`);
        ops.push(`BT /F1 ${tam} Tf 0 0 0 rg ${(M + wr).toFixed(2)} ${y.toFixed(2)} Td (${codificar(l)}) Tj ET`);
      });
      y -= 2;
      return api;
    },
    linha({ cor = [0.8, 0.82, 0.86], antes = 6, depois = 8 } = {}) {
      garantir(antes + depois); y -= antes;
      ops.push(`${cor.join(' ')} RG 0.7 w ${M} ${y.toFixed(2)} m ${(W - M).toFixed(2)} ${y.toFixed(2)} l S`);
      y -= depois;
      return api;
    },
    espaco(n = 8) { y -= n; return api; },
    /** Tabela simples: cabeçalho cinza, linhas com quebra de texto; colunas com alinhamento 'r' à direita. */
    tabela(colunas, linhas, { tam = 8.5, larguras, alinhar = [] } = {}) {
      const total = W - 2 * M;
      const ws = larguras ? larguras.map((f) => f * total) : colunas.map(() => total / colunas.length);
      const pad = 3; const lh = tam * 1.3;
      const desenharLinha = (celulas, cab) => {
        const quebradas = celulas.map((c, i) => quebrar(String(c ?? ''), tam, cab, ws[i] - 2 * pad));
        const alt = Math.max(...quebradas.map((q) => q.length)) * lh + 2 * pad;
        if (y - alt < M + 20) { novaPagina(); if (!cab) desenharLinha(colunas, true); }
        if (cab) ops.push(`0.93 0.95 0.97 rg ${M} ${(y - alt).toFixed(2)} ${total.toFixed(2)} ${alt.toFixed(2)} re f`);
        let x = M;
        quebradas.forEach((q, i) => {
          q.forEach((l, k) => {
            const lx = alinhar[i] === 'r' ? x + ws[i] - pad - largura(l, tam, false) : x + pad;
            ops.push(`BT /${cab ? 'F2' : 'F1'} ${tam} Tf 0 0 0 rg ${(alinhar[i] === 'r' && cab ? lx - (largura(l, tam, true) - largura(l, tam, false)) : lx).toFixed(2)} ${(y - pad - (k + 1) * lh + 2).toFixed(2)} Td (${codificar(l)}) Tj ET`);
          });
          x += ws[i];
        });
        y -= alt;
        ops.push(`0.8 0.82 0.86 RG 0.5 w ${M} ${y.toFixed(2)} m ${(W - M).toFixed(2)} ${y.toFixed(2)} l S`);
      };
      desenharLinha(colunas, true);
      linhas.forEach((l) => desenharLinha(l, false));
      y -= 6;
      return api;
    },
    /** Barras horizontais: [{ rotulo, n, texto }], com o maior valor ocupando a trilha toda. */
    barras(itens, { tam = 8.5, cor = [0.06, 0.24, 0.43] } = {}) {
      const maior = Math.max(1, ...itens.map((i) => i.n));
      const wRot = 170; const wNum = 90; const trilho = W - 2 * M - wRot - wNum - 10; const lh = tam * 1.9;
      for (const i of itens) {
        garantir(lh); y -= lh;
        const rot = quebrar(i.rotulo, tam, false, wRot - 4)[0];
        ops.push(`BT /F1 ${tam} Tf 0 0 0 rg ${M} ${(y + 3).toFixed(2)} Td (${codificar(rot)}) Tj ET`);
        ops.push(`0.92 0.93 0.95 rg ${M + wRot} ${(y + 1).toFixed(2)} ${trilho.toFixed(2)} ${(tam * 1.1).toFixed(2)} re f`);
        ops.push(`${cor.join(' ')} rg ${M + wRot} ${(y + 1).toFixed(2)} ${Math.max(1, (i.n / maior) * trilho).toFixed(2)} ${(tam * 1.1).toFixed(2)} re f`);
        const t = limpar(i.texto ?? String(i.n));
        ops.push(`BT /F1 ${tam} Tf 0 0 0 rg ${(W - M - largura(t, tam, false)).toFixed(2)} ${(y + 3).toFixed(2)} Td (${codificar(t)}) Tj ET`);
      }
      y -= 6;
      return api;
    },
    /** Faixa colorida com título (início de seção). */
    secao(t, { cor = [0.06, 0.24, 0.43], tam = 11, minimo = 90 } = {}) {
      garantir(minimo); y -= 8; // título não fica sozinho no fim da página
      ops.push(`${cor.join(' ')} rg ${M} ${(y - tam * 1.6).toFixed(2)} ${(W - 2 * M).toFixed(2)} ${(tam * 1.8).toFixed(2)} re f`);
      ops.push(`BT /F2 ${tam} Tf 1 1 1 rg ${M + 6} ${(y - tam * 1.15).toFixed(2)} Td (${codificar(limpar(t))}) Tj ET`);
      y -= tam * 1.8 + 6;
      return api;
    },
    /** Monta o arquivo e devolve um Buffer. */
    gerar({ titulo = 'Documento', rodape = '' } = {}) {
      novaPagina();
      const total = paginas.length;
      const objs = [];
      const add = (s) => { objs.push(s); return objs.length; };
      const catalogo = add(null); const arvore = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const filhos = paginas.map(({ conteudo, links: lks }, i) => {
        const pe = `BT /F1 8 Tf 0.45 0.45 0.45 rg ${M} 28 Td (${codificar(limpar(`${rodape}${rodape ? '   ' : ''}Página ${i + 1} de ${total}`))}) Tj ET`;
        const corpo = Buffer.from(`${conteudo}\n${pe}`, 'latin1');
        const fluxo = add(`<< /Length ${corpo.length} >>\nstream\n${corpo.toString('latin1')}\nendstream`);
        const annots = lks.length ? ` /Annots [${lks.map((k) => `<< /Type /Annot /Subtype /Link /Rect [${k.r.map((n) => n.toFixed(2)).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${codificar(String(k.url).replace(/[^\x21-\x7e]/g, encodeURIComponent))}) >> >>`).join(' ')}]` : '';
        return add(`<< /Type /Page /Parent ${arvore} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${fluxo} 0 R${annots} >>`);
      });
      objs[catalogo - 1] = `<< /Type /Catalog /Pages ${arvore} 0 R >>`;
      objs[arvore - 1] = `<< /Type /Pages /Kids [${filhos.map((n) => `${n} 0 R`).join(' ')}] /Count ${filhos.length} >>`;
      const info = add(`<< /Title (${codificar(limpar(titulo))}) /Producer (Licita Inteligente) >>`);
      let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
      const pos = [];
      objs.forEach((o, i) => { pos.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = Buffer.byteLength(pdf, 'latin1');
      pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
      pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return Buffer.from(pdf, 'latin1');
    },
  };
  return api;
}
