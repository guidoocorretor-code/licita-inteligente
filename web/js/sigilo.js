// Trechos da descrição de um item que entregam a licitação ao fornecedor (órgão, cidade, convênio, nº de processo).
// O pedido de cotação não pode revelar a disputa; como a descrição vem do edital, esses trechos são achados aqui
// para a tela destacar (e, se o usuário quiser, tirar) antes do envio. É um filtro de apoio: a revisão é humana.

// Início de nome de órgão/ente; o nome continua enquanto vierem palavras com maiúscula, siglas ou ligações (de, da, -)
const ENTE = /\b(?:Prefeitura|C[âa]mara\s+Municipal|Secretaria|Fundo\s+(?:Municipal|Estadual|Nacional)|Munic[íi]pio|Governo|Estado\s+d[eoa]|Tribunal|Assembleia|Cons[óo]rcio|Funda[çc][ãa]o|Autarquia|Universidade|Instituto\s+Federal|Hospital\s+(?:Municipal|Regional|Estadual)|Distrito\s+Federal|Superintend[êe]ncia|Departamento\s+(?:Municipal|Estadual|Nacional))\b/giu;
const CONTINUA = /^(\s+(?:de|da|do|dos|das|e|-|–|\/|[A-ZÀ-Ý][\p{L}.]*|[A-Z]{2}\b\.?|\d+))/u;
const LIGACAO = /\s+(?:de|da|do|dos|das|e|-|–|\/)$/iu;
// Convênio / repasse: vai até a próxima vírgula, ponto-e-vírgula, quebra de linha ou ponto final de frase
const CONVENIO = /\b(?:Conv[êe]nio|Contrato\s+de\s+Repasse|Termo\s+de\s+(?:Fomento|Colabora[çc][ãa]o)|Emenda\s+Parlamentar|transferegov(?:\.br)?|Plataforma\s+\+Brasil|SICONV)\b[^,;\n]*?(?=[,;\n]|\.\s|\.$|$)/giu;
// Número de processo, edital, pregão…
const PROCESSO = /\b(?:Processo|Edital|Preg[ãa]o|Dispensa|Concorr[êe]ncia|Tomada\s+de\s+Pre[çc]os|Ata\s+de\s+Registro\s+de\s+Pre[çc]os|Inexigibilidade)(?:\s+(?:Administrativo|Eletr[ôo]nico|Presencial|Licitat[óo]rio))?\s*(?:n[º°o.]*\s*)?\d[\d./-]*\d/giu;
const CNPJ = /(?:\bCNPJ(?:\/MF)?\s*(?:n[º°o.]*\s*)?:?\s*)?\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/giu;

// Minúsculas e sem acento, um caractere por caractere (as posições continuam as mesmas do texto original)
const plano = (s) => [...s].map((c) => c.normalize('NFD')[0].toLowerCase()).join('');

function nomes(op = {}) {
  return [op.orgao_nome, op.unidade_nome, op.municipio].map((n) => String(n || '').trim()).filter((n) => n.length >= 4);
}

/** Devolve [{ inicio, fim, texto }] em ordem, sem sobreposição. */
export function trechosSensiveis(texto, op = {}) {
  const t = String(texto || '');
  const faixas = [];
  for (const m of t.matchAll(ENTE)) {
    let fim = m.index + m[0].length;
    for (let r; (r = CONTINUA.exec(t.slice(fim)));) {
      if (r[1].endsWith('.')) { fim += r[1].length - 1; break; } // ponto final encerra o nome
      fim += r[1].length;
    }
    const trecho = t.slice(m.index, fim).replace(LIGACAO, '');
    // "Município" sozinho, sem nome, não identifica nada
    if (/^munic[íi]pio$/iu.test(trecho.trim())) continue;
    faixas.push([m.index, m.index + trecho.length]);
  }
  for (const re of [CONVENIO, PROCESSO, CNPJ]) for (const m of t.matchAll(re)) faixas.push([m.index, m.index + m[0].length]);
  const p = plano(t);
  for (const n of nomes(op)) {
    const alvo = plano(n);
    for (let i = p.indexOf(alvo); i >= 0; i = p.indexOf(alvo, i + alvo.length)) faixas.push([i, i + alvo.length]);
  }
  faixas.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const juntas = [];
  for (const [a, b] of faixas) {
    const ult = juntas[juntas.length - 1];
    if (ult && a <= ult[1]) ult[1] = Math.max(ult[1], b);
    else juntas.push([a, b]);
  }
  return juntas.map(([inicio, fim]) => ({ inicio, fim, texto: t.slice(inicio, fim) }));
}

/** Envolve cada trecho com a marca (ex.: '*' = negrito no WhatsApp). */
export function destacarTrechos(texto, trechos, marca = '*') {
  let out = String(texto || '');
  for (const { inicio, fim } of [...trechos].reverse()) out = `${out.slice(0, inicio)}${marca}${out.slice(inicio, fim)}${marca}${out.slice(fim)}`;
  return out;
}

/** Tira os trechos e arruma o que sobra ("demandas da ." vira "demandas."). */
export function removerTrechos(texto, trechos) {
  let out = String(texto || '');
  for (const { inicio, fim } of [...trechos].reverse()) {
    const antes = out.slice(0, inicio).replace(/\s+(?:no|na|nos|nas|do|da|dos|das|de|em|ao|aos|à|às|a|o|as|os|pelo|pela|para\s+(?:o|a))\s*$/iu, '');
    out = `${antes} ${out.slice(fim)}`;
  }
  out = out.replace(/[ \t]+([,.;:])/g, '$1');
  for (let antes; antes !== out;) { antes = out; out = out.replace(/([,;])\s*([.,;])/g, '$2').replace(/\.\s*\./g, '.'); }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/^[\s,.;]+/, '').trim();
}
