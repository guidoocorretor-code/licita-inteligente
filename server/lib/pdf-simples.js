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

// Alguns sinais fora do ASCII que aparecem em documentos (nº, 1ª, 30°)
const LATIN = { 'º': 370, 'ª': 370, '°': 400, '\x95': 350 };

function largura(texto, tam, negrito) {
  let w = 0;
  for (const c of texto) {
    const base = c.normalize('NFD')[0];
    const cod = base.charCodeAt(0);
    w += cod >= 32 && cod <= 126 ? LARG[cod - 32] : (LATIN[base] ?? 556);
  }
  return (w * tam * (negrito ? 1.1 : 1)) / 1000;
}

// Helvetica-Bold (AFM padrão) para letras, dígitos e pontuação comum. Usada só no texto com trechos em
// negrito no meio da linha, onde a posição de cada trecho precisa ser exata.
const NEG = { ' ': 278, ',': 278, '.': 278, ':': 333, ';': 333, '-': 333, '(': 333, ')': 333, '/': 278 };
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { NEG[c] = [722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611][i]; });
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { NEG[c] = [556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500][i]; });
'0123456789'.split('').forEach((c) => { NEG[c] = 556; });
function larguraExata(texto, tam, negrito) {
  if (!negrito) return largura(texto, tam, false);
  let w = 0;
  for (const c of texto) { const b = c.normalize('NFD')[0]; w += NEG[b] ?? (largura(b, 1000, false) * 1.1); }
  return (w * tam) / 1000;
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

/**
 * Lê largura, altura e cores de um JPEG (marcador SOF). Devolve null se não for JPEG válido.
 * Só JPEG: o PDF desenha JPEG direto (filtro DCTDecode), sem precisar descompactar a imagem.
 */
export function lerJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const tam = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      const altura = buf.readUInt16BE(i + 5); const largura = buf.readUInt16BE(i + 7); const cores = buf[i + 9];
      return largura && altura && [1, 3, 4].includes(cores) ? { largura, altura, cores } : null;
    }
    i += 2 + tam;
  }
  return null;
}

export function criarPdf({ margem = 50 } = {}) {
  const W = 595.28; const H = 841.89; const M = margem;
  const paginas = [];
  const imagens = []; // { buf, info } (cada imagem entra uma vez no arquivo, mesmo usada em várias páginas)
  let ops = []; let links = []; let y = H - M;
  const novaPagina = () => { if (ops.length) paginas.push({ conteudo: ops.join('\n'), links }); ops = []; links = []; y = H - M; };
  const registrarImagem = (buf) => {
    let k = imagens.findIndex((im) => im.buf === buf);
    if (k < 0) { const info = lerJpeg(buf); if (!info) return null; imagens.push({ buf, info }); k = imagens.length - 1; }
    return k;
  };
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
    texto(t, { tam = 10, negrito = false, cor = [0, 0, 0], x = M, maxW = W - 2 * M - (x - M), espaco = 1.35, depois = 2, url = null, marcador = null } = {}) {
      quebrar(t, tam, negrito, maxW).forEach((l, i) => {
        garantir(tam * espaco);
        y -= tam * espaco;
        // Marcador de lista (ex.: •) à esquerda da primeira linha; as linhas seguintes ficam alinhadas ao texto
        if (marcador && i === 0) ops.push(`BT /F1 ${tam} Tf ${cor.join(' ')} rg ${(x - largura(marcador, tam, false) - 4).toFixed(2)} ${y.toFixed(2)} Td (${codificar(limpar(marcador))}) Tj ET`);
        ops.push(`BT /${negrito ? 'F2' : 'F1'} ${tam} Tf ${cor.join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${codificar(l)}) Tj ET`);
        if (url) {
          const w = largura(l, tam, negrito);
          ops.push(`${cor.join(' ')} RG 0.5 w ${x.toFixed(2)} ${(y - 1.5).toFixed(2)} m ${(x + w).toFixed(2)} ${(y - 1.5).toFixed(2)} l S`);
          links.push({ r: [x, y - 3, x + w, y + tam], url });
        }
      });
      y -= depois;
      return api;
    },
    /**
     * Parágrafo com algumas palavras em negrito no meio do texto: os trechos que casam com `destaque`
     * (expressão regular com /g) saem em Helvetica-Bold, o resto em Helvetica.
     */
    textoDestacado(t, destaque, { tam = 10, x = M, maxW = W - 2 * M - (x - M), espaco = 1.35, depois = 2, marcador = null } = {}) {
      const esp = largura(' ', tam, false);
      for (const par of limpar(t).split('\n')) {
        // Marca, letra a letra, o que fica em negrito (o destaque pode ter várias palavras, ex.: um nome)
        const neg = new Uint8Array(par.length);
        for (const m of par.matchAll(destaque)) neg.fill(1, m.index, m.index + m[0].length);
        const linhas = []; let atual = []; let wa = 0;
        for (const m of par.matchAll(/\S+/g)) {
          const ps = [];
          for (let k = 0; k < m[0].length; k++) {
            const n = !!neg[m.index + k];
            if (ps.length && ps.at(-1).n === n) ps.at(-1).s += m[0][k]; else ps.push({ s: m[0][k], n });
          }
          ps.forEach((p) => { p.w = larguraExata(p.s, tam, p.n); });
          const wp = ps.reduce((a, p) => a + p.w, 0);
          if (atual.length && wa + esp + wp > maxW) { linhas.push(atual); atual = []; wa = 0; }
          wa += (atual.length ? esp : 0) + wp; atual.push(ps);
        }
        linhas.push(atual);
        linhas.forEach((linha, i) => {
          garantir(tam * espaco); y -= tam * espaco;
          if (marcador && i === 0) ops.push(`BT /F1 ${tam} Tf 0 0 0 rg ${(x - largura(marcador, tam, false) - 4).toFixed(2)} ${y.toFixed(2)} Td (${codificar(limpar(marcador))}) Tj ET`);
          let cx = x;
          linha.forEach((ps, k) => {
            if (k) cx += esp;
            for (const p of ps) { ops.push(`BT /${p.n ? 'F2' : 'F1'} ${tam} Tf 0 0 0 rg ${cx.toFixed(2)} ${y.toFixed(2)} Td (${codificar(p.s)}) Tj ET`); cx += p.w; }
          });
        });
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
    /**
     * Bloco desenhado livremente com altura fixa (não quebra entre páginas). `desenhar` recebe a área
     * { x, topo, largura } e as ferramentas ret, txt, linhasDe e pizza, com coordenadas a partir do topo do bloco.
     */
    bloco(alt, desenhar, { depois = 6 } = {}) {
      garantir(alt);
      const topo = y; const X = M; const L = W - 2 * M;
      const yAbs = (dy) => topo - dy;
      const ferramentas = {
        x: X, largura: L,
        /** Retângulo (dy = distância do topo do bloco até o topo do retângulo). Cantos arredondados com `raio`. */
        ret(x, dy, w, h, { cor = null, borda = null, raio = 0, espessura = 0.8 } = {}) {
          const y0 = yAbs(dy) - h; const r = Math.min(raio, w / 2, h / 2); const k = 0.5523 * r;
          const f = (n) => n.toFixed(2);
          const caminho = r > 0
            ? `${f(x + r)} ${f(y0)} m ${f(x + w - r)} ${f(y0)} l ${f(x + w - r + k)} ${f(y0)} ${f(x + w)} ${f(y0 + r - k)} ${f(x + w)} ${f(y0 + r)} c `
              + `${f(x + w)} ${f(y0 + h - r)} l ${f(x + w)} ${f(y0 + h - r + k)} ${f(x + w - r + k)} ${f(y0 + h)} ${f(x + w - r)} ${f(y0 + h)} c `
              + `${f(x + r)} ${f(y0 + h)} l ${f(x + r - k)} ${f(y0 + h)} ${f(x)} ${f(y0 + h - r + k)} ${f(x)} ${f(y0 + h - r)} c `
              + `${f(x)} ${f(y0 + r)} l ${f(x)} ${f(y0 + r - k)} ${f(x + r - k)} ${f(y0)} ${f(x + r)} ${f(y0)} c h`
            : `${f(x)} ${f(y0)} ${f(w)} ${f(h)} re`;
          const pintar = cor && borda ? 'B' : cor ? 'f' : 'S';
          ops.push(`${cor ? `${cor.join(' ')} rg ` : ''}${borda ? `${borda.join(' ')} RG ${espessura} w ` : ''}${caminho} ${pintar}`);
        },
        /** Texto com quebra em `maxW`; dy = topo da primeira linha. Devolve a altura usada. `alinhar`: 'r' ou 'c'. */
        txt(t, x, dy, { tam = 10, negrito = false, cor = [0, 0, 0], maxW = L, max = 99, espaco = 1.3, url = null, alinhar = '' } = {}) {
          let ls = quebrar(t, tam, negrito, maxW);
          if (ls.length > max) { ls = ls.slice(0, max); let u = ls[max - 1]; while (u && largura(`${u}...`, tam, negrito) > maxW) u = u.slice(0, -1); ls[max - 1] = `${u.trimEnd()}...`; }
          ls.forEach((l, i) => {
            const w = largura(l, tam, negrito);
            const lx = alinhar === 'r' ? x + maxW - w : alinhar === 'c' ? x + (maxW - w) / 2 : x;
            const ly = yAbs(dy) - tam * 0.95 - i * tam * espaco;
            ops.push(`BT /${negrito ? 'F2' : 'F1'} ${tam} Tf ${cor.join(' ')} rg ${lx.toFixed(2)} ${ly.toFixed(2)} Td (${codificar(l)}) Tj ET`);
            if (url) links.push({ r: [lx, ly - 3, lx + w, ly + tam], url });
          });
          return ls.length * tam * espaco;
        },
        /** Quantas linhas o texto ocupa (para calcular a altura do bloco antes de desenhar). */
        linhasDe: (t, tam, negrito, maxW, max = 99) => Math.min(max, quebrar(t, tam, negrito, maxW).length),
        larguraDe: (t, tam, negrito = false) => largura(limpar(t), tam, negrito),
        /** Imagem JPEG (Buffer) no retângulo w x h; dy = topo. JPEG inválido é ignorado (não quebra o documento). */
        imagem(buf, x, dy, w, h) {
          const k = registrarImagem(buf);
          if (k == null) return false;
          ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(yAbs(dy) - h).toFixed(2)} cm /Im${k + 1} Do Q`);
          return true;
        },
        /** Área clicável sem texto (ex.: botão desenhado com ret). */
        link(x, dy, w, h, url) { links.push({ r: [x, yAbs(dy) - h, x + w, yAbs(dy)], url }); },
        /** Gráfico de pizza: fatias [{ valor, cor }], começando às 12h no sentido horário, com 1,5 pt de separação branca. */
        pizza(cx, dyCentro, raio, fatias) {
          const cy = yAbs(dyCentro); const total = fatias.reduce((s, f) => s + Math.max(0, f.valor), 0);
          if (!total) { ops.push(`0.9 0.91 0.93 rg ${cx - raio} ${cy - raio} ${2 * raio} ${2 * raio} re f`); return; }
          let ang = Math.PI / 2; const f = (n) => n.toFixed(2); const pt = (a) => [cx + raio * Math.cos(a), cy + raio * Math.sin(a)];
          const contornos = [];
          for (const fa of fatias) {
            const v = Math.max(0, fa.valor); if (!v) continue;
            const varre = (v / total) * 2 * Math.PI; const fim = ang - varre;
            let cam = `${f(cx)} ${f(cy)} m ${pt(ang).map(f).join(' ')} l `;
            const passos = Math.ceil(varre / (Math.PI / 2)); const d = varre / passos;
            for (let i = 0; i < passos; i++) {
              const a0 = ang - i * d; const a1 = a0 - d; const k = (4 / 3) * Math.tan(d / 4) * raio;
              const [x0, y0] = pt(a0); const [x3, y3] = pt(a1);
              cam += `${f(x0 + k * Math.sin(a0))} ${f(y0 - k * Math.cos(a0))} ${f(x3 - k * Math.sin(a1))} ${f(y3 + k * Math.cos(a1))} ${f(x3)} ${f(y3)} c `;
            }
            ops.push(`${fa.cor.join(' ')} rg ${cam}h f`);
            if (v < total) contornos.push(ang);
            ang = fim;
          }
          for (const a of contornos) ops.push(`1 1 1 RG 1.5 w ${f(cx)} ${f(cy)} m ${pt(a).map(f).join(' ')} l S`);
        },
      };
      desenhar(ferramentas);
      y = topo - alt - depois;
      return api;
    },
    linhasDe: (t, tam, negrito, maxW, max = 99) => Math.min(max, quebrar(t, tam, negrito, maxW).length),
    /** Espaço que ainda cabe na página atual. */
    restante: () => y - (M + 20),
    /** Largura útil da página (entre as margens). */
    largura: W - 2 * M,
    novaPagina() { novaPagina(); return api; },
    /** Monta o arquivo e devolve um Buffer. */
    gerar({ titulo = 'Documento', rodape = '' } = {}) {
      novaPagina();
      const total = paginas.length;
      const objs = [];
      const add = (s) => { objs.push(s); return objs.length; };
      const catalogo = add(null); const arvore = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const espacos = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' };
      const ims = imagens.map(({ buf, info }) => add(`<< /Type /XObject /Subtype /Image /Width ${info.largura} /Height ${info.altura} /ColorSpace ${espacos[info.cores]} /BitsPerComponent 8 /Filter /DCTDecode${info.cores === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${buf.length} >>\nstream\n${buf.toString('latin1')}\nendstream`));
      const xobj = ims.length ? ` /XObject << ${ims.map((n, i) => `/Im${i + 1} ${n} 0 R`).join(' ')} >>` : '';
      const filhos = paginas.map(({ conteudo, links: lks }, i) => {
        const pe = `BT /F1 8 Tf 0.45 0.45 0.45 rg ${M} ${Math.min(28, M - 10)} Td (${codificar(limpar(`${rodape}${rodape ? '   ' : ''}Página ${i + 1} de ${total}`))}) Tj ET`;
        const corpo = Buffer.from(`${conteudo}\n${pe}`, 'latin1');
        const fluxo = add(`<< /Length ${corpo.length} >>\nstream\n${corpo.toString('latin1')}\nendstream`);
        const annots = lks.length ? ` /Annots [${lks.map((k) => `<< /Type /Annot /Subtype /Link /Rect [${k.r.map((n) => n.toFixed(2)).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${codificar(String(k.url).replace(/[^\x21-\x7e]/g, encodeURIComponent))}) >> >>`).join(' ')}]` : '';
        return add(`<< /Type /Page /Parent ${arvore} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobj} >> /Contents ${fluxo} 0 R${annots} >>`);
      });
      objs[catalogo - 1] = `<< /Type /Catalog /Pages ${arvore} 0 R >>`;
      objs[arvore - 1] = `<< /Type /Pages /Kids [${filhos.map((n) => `${n} 0 R`).join(' ')}] /Count ${filhos.length} >>`;
      const info = add(`<< /Title (${codificar(limpar(titulo))}) /Producer (LicitPro) >>`);
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
