// Comprovante de recebimento da cotação enviada pelo fornecedor pelo link: PDF + e-mail para ele.
// Leva só o que o fornecedor mandou e quem pediu; nada da licitação (órgão, cidade, número, estimado).
import { criarPdf } from '../lib/pdf-simples.js';
import { enviarEmail } from './email.js';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v) => (v == null ? 'não informado' : BRL.format(v));
const qtd = (v) => (v == null ? null : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(v));
const cnpjFmt = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const dataIso = (d) => (d ? String(d).split('-').reverse().join('/') : null);
/** Data/hora do servidor (UTC, formato SQLite) no horário de Brasília. */
export const horaBrasilia = (utc) => new Date(`${String(utc).replace(' ', 'T')}Z`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const protocolo = (r) => `${String(r.recebido_em).slice(0, 10).replace(/-/g, '')}-${String(r.id).padStart(5, '0')}`;

export function recebimento(db, id) {
  const r = db.prepare('SELECT * FROM cotacao_recebimentos WHERE id=?').get(id);
  return r ? { ...r, dados: JSON.parse(r.dados) } : null;
}

/** PDF do comprovante (Buffer). */
export function pdfComprovante(r) {
  const d = r.dados;
  const total = d.itens.reduce((s, i) => s + (i.preco_unitario != null && i.quantidade != null ? i.preco_unitario * i.quantidade : 0), 0);
  const pdf = criarPdf();
  pdf.texto('Comprovante de recebimento de cotação', { tam: 16, negrito: true, cor: [0.06, 0.24, 0.43], depois: 4 })
    .texto(`Protocolo ${protocolo(r)}`, { tam: 10, cor: [0.4, 0.4, 0.4] })
    .linha()
    .campo('Recebido em:', `${horaBrasilia(r.recebido_em)} (horário de Brasília)`)
    .campo('Para:', `${d.solicitante}${d.solicitante_cnpj ? ` · CNPJ ${cnpjFmt(d.solicitante_cnpj)}` : ''}`)
    .campo('Fornecedor:', d.fornecedor)
    .campo('Respondido por:', r.respondente || 'não informado')
    .linha()
    .texto(`Itens cotados (${d.itens.length})`, { tam: 12, negrito: true, depois: 4 });
  for (const i of d.itens) {
    const q = qtd(i.quantidade);
    pdf.texto(`Item ${i.numero_item}${q ? ` · ${q} ${i.unidade_medida || 'un.'}` : ''}`, { tam: 10.5, negrito: true, depois: 0 })
      .texto(i.descricao || '(sem descrição)', { tam: 9, cor: [0.25, 0.25, 0.25], depois: 1 })
      .texto(`Preço unitário: ${moeda(i.preco_unitario)}${i.preco_unitario != null && i.quantidade != null ? `   ·   Total do item: ${moeda(i.preco_unitario * i.quantidade)}` : ''}${i.marca_modelo ? `   ·   Marca/modelo: ${i.marca_modelo}` : ''}`, { tam: 9.5, depois: 6 });
  }
  pdf.linha()
    .campo('Valor total cotado:', moeda(total))
    .campo('Prazo de entrega:', d.prazo_entrega_dias != null ? `${d.prazo_entrega_dias} dia(s)` : 'não informado')
    .campo('Validade da cotação:', dataIso(d.validade) || 'não informada')
    .campo('Frete:', d.frete === 'CIF' ? 'CIF (entrega inclusa no preço)' : d.frete === 'FOB' ? 'FOB (por conta do comprador)' : 'não informado')
    .campo('Condições de pagamento:', d.condicoes_pagamento || 'não informadas');
  if (d.observacoes) pdf.campo('Observações:', d.observacoes);
  pdf.linha().texto('Este documento confirma apenas que a cotação foi recebida. Não é pedido de compra nem garantia de contratação.', { tam: 8.5, cor: [0.4, 0.4, 0.4] });
  return pdf.gerar({ titulo: `Comprovante de cotação ${protocolo(r)}`, rodape: `Comprovante ${protocolo(r)} · ${d.solicitante}` });
}

/** Envia o comprovante ao fornecedor e grava o resultado. Nunca lança: o resultado fica no registro. */
export async function enviarComprovante(db, id, { responderPara = null } = {}) {
  const r = recebimento(db, id);
  if (!r) return null;
  const marcar = (status, erro = null) => db.prepare("UPDATE cotacao_recebimentos SET comprovante_status=?, comprovante_erro=?, comprovante_em=CASE WHEN ?='enviado' THEN datetime('now') ELSE comprovante_em END WHERE id=?")
    .run(status, erro, status, id);
  if (!r.email) { marcar('sem_email'); return 'sem_email'; }
  const d = r.dados;
  const quando = horaBrasilia(r.recebido_em);
  const texto = [`Olá${r.respondente ? `, ${r.respondente}` : ''}!`, '',
    `Recebemos a sua cotação em ${quando} (horário de Brasília): ${d.itens.length} item(ns).`,
    'O comprovante com o que você enviou está em anexo (PDF).', '',
    'Se precisar corrigir algum valor, abra o mesmo link de novo e envie outra vez.', '', 'Obrigado!', d.solicitante].join('\n');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<p>Olá${r.respondente ? `, ${esc(r.respondente)}` : ''}!</p><p>Recebemos a sua cotação em <strong>${esc(quando)}</strong> (horário de Brasília): ${d.itens.length} item(ns).</p>`
    + '<p>O comprovante com o que você enviou está em anexo (PDF).</p><p>Se precisar corrigir algum valor, abra o mesmo link de novo e envie outra vez.</p>'
    + `<p>Obrigado!<br>${esc(d.solicitante)}</p><p style="color:#777;font-size:12px">Protocolo ${protocolo(r)}. Este e-mail confirma apenas o recebimento; não é pedido de compra.</p>`;
  try {
    await enviarEmail({ para: r.email, assunto: `Recebemos sua cotação - ${d.solicitante}`, texto, html, responderPara, nomeRemetente: d.solicitante,
      anexos: [{ filename: `comprovante-cotacao-${protocolo(r)}.pdf`, content: pdfComprovante(r), contentType: 'application/pdf' }] });
    marcar('enviado'); return 'enviado';
  } catch (e) {
    if (e.semSmtp) { marcar('sem_smtp'); return 'sem_smtp'; }
    console.error('[comprovante] falha ao enviar:', e.message);
    marcar('erro', String(e.message).slice(0, 300)); return 'erro';
  }
}
