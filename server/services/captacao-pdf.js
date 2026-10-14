// PDF A4 da proposta, do contrato e da procuração: logo e dados da Minha Empresa no topo, título, seções,
// local e data, espaços de assinatura, rodapé com contato e "Página X de Y" em todas as páginas.
import fs from 'node:fs';
import { criarPdf } from '../lib/pdf-simples.js';
import { fmtDoc, fmtTelefone, enderecoLinha, PAPEIS } from './captacao-modelos.js';
import { caminhoArquivo } from './clientes.js';

// Uma expressão com todos os destaques, os mais longos primeiro, sem pegar pedaço de palavra
export function regexDestaque(lista = []) {
  const itens = [...new Set(lista.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!itens.length) return null;
  const esc = itens.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
}

const AZUL = [0.06, 0.24, 0.43];
const CINZA = [0.35, 0.37, 0.4];

function lerLogo(me) {
  if (!me?.logo) return null;
  const abs = caminhoArquivo(me.logo);
  try { return abs ? fs.readFileSync(abs) : null; } catch { return null; }
}

/**
 * @param doc resultado de montarDocumento
 * @param me  parte "Minha Empresa" (com logo)
 * @param opts.previa  marca d'água de pré-visualização (não é o documento para assinar)
 * @returns {{ pdf: Buffer, paginas: number }}
 */
export function pdfDocumento(doc, me, { previa = false } = {}) {
  const pdf = criarPdf({ margem: 46 });
  const L = pdf.largura;
  const logo = lerLogo(me);
  const contato = [me?.telefone ? fmtTelefone(me.telefone) : '', me?.email || ''].filter(Boolean).join(' · ');

  // Cabeçalho: logo à esquerda (até 130 x 52) e a identificação à direita
  const linhasCab = [
    me?.documento ? `${me.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'} ${fmtDoc(me.documento)}` : '',
    enderecoLinha(me || {}), contato].filter(Boolean);
  pdf.bloco(58, (b) => {
    let xTexto = b.x;
    if (logo) {
      const ok = b.imagem(logo, b.x, 0, 130, 52) && true;
      if (ok) xTexto = b.x + 145;
    }
    const w = b.largura - (xTexto - b.x);
    const al = logo ? 'r' : '';
    let dy = 2;
    dy += b.txt(me?.nome_fantasia || me?.nome || '', xTexto, dy, { tam: 11.5, negrito: true, cor: AZUL, maxW: w, max: 1, alinhar: al });
    if (me?.nome_fantasia && me?.nome && me.nome_fantasia !== me.nome) dy += b.txt(me.nome, xTexto, dy, { tam: 8, cor: CINZA, maxW: w, max: 1, alinhar: al });
    for (const l of linhasCab) dy += b.txt(l, xTexto, dy, { tam: 8, cor: CINZA, maxW: w, max: 1, alinhar: al });
  }, { depois: 2 });
  pdf.linha({ cor: AZUL, antes: 2, depois: 10 });
  if (previa) pdf.texto('PRÉ-VISUALIZAÇÃO — gere o PDF final para enviar ou assinar', { tam: 8.5, negrito: true, cor: [0.75, 0.1, 0.1], depois: 4 });

  // Título
  const linhasTitulo = pdf.linhasDe(doc.titulo.toUpperCase(), 12, true, L, 2);
  pdf.bloco(linhasTitulo * 15.6 + (doc.numero ? 16 : 2), (b) => {
    const alt = b.txt(doc.titulo.toUpperCase(), b.x, 0, { tam: 12, negrito: true, maxW: b.largura, alinhar: 'c', max: 2 });
    if (doc.numero) b.txt(`Nº ${doc.numero}`, b.x, alt + 2, { tam: 10, negrito: true, cor: AZUL, maxW: b.largura, alinhar: 'c' });
  }, { depois: 8 });
  if (doc.tipo === 'proposta' && doc.local_data) pdf.texto(doc.local_data, { tam: 9.5, depois: 6 });

  // Papéis das partes (CONTRATANTE, OUTORGANTE...) e nomes na qualificação saem em negrito
  const destaque = regexDestaque(doc.destaques ?? PAPEIS[doc.tipo]);
  for (const s of doc.secoes) {
    if (s.titulo) { pdf.espaco(3); pdf.texto(s.titulo.toUpperCase(), { tam: 9.5, negrito: true, cor: AZUL, depois: 2 }); }
    for (const p of s.paragrafos) {
      if (destaque) pdf.textoDestacado(p, destaque, { tam: 9.3, espaco: 1.3, depois: 3 });
      else pdf.texto(p, { tam: 9.3, espaco: 1.3, depois: 3 });
    }
    for (const item of s.lista) {
      if (destaque) pdf.textoDestacado(item, destaque, { tam: 9.3, x: 62, espaco: 1.3, depois: 1.5, marcador: '\x95' });
      else pdf.texto(item, { tam: 9.3, x: 62, espaco: 1.3, depois: 1.5, marcador: '\x95' });
    }
    if (s.lista.length) pdf.espaco(2);
  }

  // Assinaturas: duas por linha, com traço e identificação. Local, data e todas as assinaturas ficam juntos
  // na mesma página (nunca uma página só com as testemunhas).
  const ass = doc.assinaturas || [];
  const altPar = (par) => 30 + 10.5 * Math.max(...par.map((a) => a.linhas.length + 1)) + 4;
  const pares = [];
  for (let i = 0; i < ass.length; i += 2) pares.push(ass.slice(i, i + 2));
  const precisa = pares.reduce((t, p) => t + altPar(p), 0) + (doc.tipo !== 'proposta' && doc.local_data ? 24 : 0);
  if (pdf.restante() < precisa) pdf.novaPagina();
  if (doc.tipo !== 'proposta' && doc.local_data) { pdf.espaco(6); pdf.texto(doc.local_data, { tam: 9.5, depois: 4 }); }
  for (const par of pares) {
    const alt = altPar(par) - 4;
    pdf.bloco(alt, (b) => {
      const w = (b.largura - 30) / 2;
      par.forEach((a, k) => {
        const x = b.x + k * (w + 30);
        b.ret(x, 26, w, 0.01, { borda: [0, 0, 0], espessura: 0.7 });
        let dy = 30;
        dy += b.txt(a.titulo, x, dy, { tam: 8.5, negrito: true, maxW: w, max: 2 });
        for (const l of a.linhas) dy += b.txt(l, x, dy, { tam: 8, cor: CINZA, maxW: w, max: 1 });
      });
    }, { depois: 4 });
  }

  const rodape = [me?.nome_fantasia || me?.nome, contato].filter(Boolean).join(' · ');
  const buf = pdf.gerar({ titulo: `${doc.titulo}${doc.numero ? ` nº ${doc.numero}` : ''}`, rodape });
  const paginas = (buf.toString('latin1').match(/\/Type \/Page /g) || []).length;
  return { pdf: buf, paginas };
}
