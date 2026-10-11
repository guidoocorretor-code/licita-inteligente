// Valor em reais por extenso (ex.: 1.234,56 → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos").
// Usado na proposta de preços, que costuma exigir o valor global por extenso.
const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const ESCALAS = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões']];

// 0 a 999
function trio(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100); const r = n % 100;
  const partes = [];
  if (c) partes.push(CEM[c]);
  if (r < 20) { if (r) partes.push(UNID[r]); } else { partes.push(DEZ[Math.floor(r / 10)]); if (r % 10) partes.push(UNID[r % 10]); }
  return partes.join(' e ');
}

/** Inteiro por extenso (até trilhões). */
export function inteiroPorExtenso(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zero';
  const grupos = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let t = i === 1 && g === 1 ? '' : trio(g); // "mil", não "um mil"
    if (i > 0) t = `${t}${t ? ' ' : ''}${ESCALAS[i][g === 1 ? 0 : 1]}`;
    partes.push({ t, g, i });
  }
  // Ligação com "e": antes do último grupo quando ele é menor que 100 ou centena redonda (ex.: "mil e quinhentos", "dois mil e vinte")
  return partes.map((p, k) => {
    if (k === 0) return p.t;
    const ultimo = k === partes.length - 1;
    return `${ultimo && (p.g < 100 || p.g % 100 === 0) ? ' e ' : ' '}${p.t}`;
  }).join('');
}

/** Reais e centavos por extenso. */
export function reaisPorExtenso(valor) {
  if (valor == null || !Number.isFinite(Number(valor))) return '';
  const centavosTotal = Math.round(Math.abs(Number(valor)) * 100);
  const reais = Math.floor(centavosTotal / 100); const cent = centavosTotal % 100;
  const partes = [];
  if (reais) {
    // "um milhão de reais", "dois milhões de reais" (só quando termina em milhão/bilhão redondo)
    const de = reais >= 1e6 && reais % 1e6 === 0 ? ' de' : '';
    partes.push(`${inteiroPorExtenso(reais)}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent) partes.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero real';
}
