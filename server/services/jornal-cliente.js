// Jornal para o cliente (empresário assessorado): licitações escolhidas no Jornal, impressas, em PDF clicável
// ou por e-mail ao representante legal, com um link sem login em que ele marca as que tem interesse.
// Cada envio fica registrado (jornal_envios). O banco guarda só um identificador aleatório; o link leva esse
// identificador assinado com JWT_SECRET (o mesmo esquema do link de cotação).
// Só dados públicos das licitações (PNCP). Nada de cotações, custos ou concorrentes.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { SISTEMAS } from './sistemas.js';
import { criarPdf } from '../lib/pdf-simples.js';
import { enviarEmail } from './email.js';

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const assinar = (nonce) => crypto.createHmac('sha256', config.jwtSecret).update(`jornal-link:${nonce}`).digest('base64url').slice(0, 32);
const tokenDe = (nonce) => `${nonce}.${assinar(nonce)}`;
const DIAS_VALIDADE = 60;
export const MAX_ITENS_ENVIO = 60;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const cnpjFmt = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
/** Data do PNCP (horário de Brasília, sem fuso) em dd/mm/aaaa hh:mm. */
export const dataBr = (iso) => {
  if (!iso) return null;
  const [d, t] = String(iso).replace(' ', 'T').split('T'); const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a}${t && t.slice(0, 5) !== '00:00' ? ` ${t.slice(0, 5)}` : ''}`;
};

export function migrarJornalEnvios(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS jornal_envios (
    id INTEGER PRIMARY KEY,
    nonce TEXT NOT NULL UNIQUE,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id INTEGER,                       -- empresa assessorada (NULL = sem empresa escolhida)
    licitacoes TEXT NOT NULL,                 -- JSON [ids] na ordem escolhida
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    expira_em TEXT NOT NULL,
    email_para TEXT,
    email_status TEXT,                        -- NULL (não enviado por e-mail) | enviado | erro | sem_smtp
    email_em TEXT,
    email_erro TEXT,
    ultimo_acesso TEXT,
    respondido_em TEXT,
    respondente TEXT,
    interesses TEXT,                          -- JSON [ids] marcados pelo cliente
    observacao TEXT,
    revogado INTEGER NOT NULL DEFAULT 0
  )`);
  conn.exec('CREATE INDEX IF NOT EXISTS ix_jornal_envios_emp ON jornal_envios(empresa_id, criado_em)');
}

/** Participação no sistema da disputa: gratuita / paga / não verificada (só marcamos com fonte, ver sistemas.js). */
export function sistemaDaLicitacao(l) {
  const chave = l.sistema_eletronico && SISTEMAS[l.sistema_eletronico] ? l.sistema_eletronico : null;
  const s = chave && chave !== 'outro' ? SISTEMAS[chave] : null;
  const custo = s?.custo || 'nao_verificado';
  return {
    nome: s?.nome || (l.plataforma_origem ? `Confira no edital (publicado por ${l.plataforma_origem})` : 'Confira no edital'),
    custo,
    participacao: custo === 'gratuito' ? 'Gratuita' : custo === 'pago' ? 'Paga (taxa do sistema)' : 'Não verificada: confira no edital',
    resumo: s?.resumo || SISTEMAS.outro.resumo,
    fonte: s?.fonte || null,
  };
}

/** "90012/2026": o PNCP às vezes já manda o ano dentro do número. */
export const numeroCompra = (l) => (!l.numero_compra ? null : /\/\d{4}$/.test(l.numero_compra) || !l.ano ? l.numero_compra : `${l.numero_compra}/${l.ano}`);

const valorTexto = (l) => (l.valor_estimado_situacao === 'sigiloso' ? 'Sigiloso'
  : l.valor_estimado != null && l.valor_estimado_situacao !== 'nao_informado' ? BRL.format(l.valor_estimado) : 'Não informado');

/** Dados de cada licitação para o card do jornal, na ordem dos ids. */
export function cartoes(db, ids) {
  if (!ids.length) return [];
  const linhas = db.prepare(`SELECT id, objeto, orgao_nome, unidade_nome, municipio, uf, modalidade_nome, numero_compra, ano, valor_estimado, valor_estimado_situacao,
      data_abertura_proposta, data_encerramento_proposta, sistema_eletronico, plataforma_origem, link_origem, link_pncp, status_calculado,
      me_epp_exclusivo, srp, criterio_julgamento, modo_disputa_nome, informacao_complementar
    FROM licitacoes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return ids.map((id) => porId.get(id)).filter(Boolean).map((l) => ({
    ...l, numero_texto: numeroCompra(l), valor_texto: valorTexto(l), prazo_texto: dataBr(l.data_encerramento_proposta) || 'Não informado', sistema: sistemaDaLicitacao(l),
  }));
}

const idsValidos = (db, ids) => {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!lista.length) throw erro(400, 'Marque pelo menos uma licitação.');
  if (lista.length > MAX_ITENS_ENVIO) throw erro(400, `Escolha no máximo ${MAX_ITENS_ENVIO} licitações por jornal.`);
  const existe = new Set(db.prepare(`SELECT id FROM licitacoes WHERE id IN (${lista.map(() => '?').join(',')})`).all(...lista).map((r) => r.id));
  return lista.filter((n) => existe.has(n));
};

/** Registra o jornal e devolve o link (token) que o cliente usa para ver os resumos e marcar o interesse. */
export function criarEnvio(db, { empresaId, clienteId = null, usuarioId, ids }) {
  const lista = idsValidos(db, ids);
  if (!lista.length) throw erro(400, 'Licitações não encontradas.');
  if (clienteId && !db.prepare('SELECT 1 FROM clientes WHERE id=? AND empresa_id=?').get(clienteId, empresaId)) throw erro(404, 'Empresa não encontrada.');
  // Mesma seleção, mesma empresa e mesmo usuário nas últimas 24h: reaproveita o jornal (imprimir, PDF e e-mail usam o mesmo link)
  const igual = db.prepare(`SELECT id, nonce, expira_em FROM jornal_envios WHERE empresa_id=? AND cliente_id IS ? AND criado_por IS ? AND licitacoes=? AND revogado=0
    AND criado_em > datetime('now','-1 day') ORDER BY id DESC LIMIT 1`).get(empresaId, clienteId || null, usuarioId ?? null, JSON.stringify(lista));
  if (igual) return { id: igual.id, token: tokenDe(igual.nonce), expira_em: igual.expira_em };
  const nonce = crypto.randomBytes(16).toString('base64url');
  const expira = new Date(Date.now() + DIAS_VALIDADE * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const id = Number(db.prepare('INSERT INTO jornal_envios (nonce, empresa_id, cliente_id, licitacoes, criado_por, expira_em) VALUES (?,?,?,?,?,?)')
    .run(nonce, empresaId, clienteId || null, JSON.stringify(lista), usuarioId, expira).lastInsertRowid);
  return { id, token: tokenDe(nonce), expira_em: expira };
}

/** Tudo o que o jornal impresso / PDF / e-mail mostra. */
export function dadosEnvio(db, envioId) {
  const e = db.prepare('SELECT * FROM jornal_envios WHERE id=?').get(envioId);
  if (!e) return null;
  const emp = db.prepare('SELECT nome, cnpj FROM empresas WHERE id=?').get(e.empresa_id);
  const u = e.criado_por ? db.prepare('SELECT nome, email FROM usuarios WHERE id=?').get(e.criado_por) : null;
  const cli = e.cliente_id ? db.prepare(`SELECT razao_social, nome_fantasia, cnpj, municipio, uf, endereco, cep, email, telefone, resp_nome, resp_cargo, resp_email
    FROM clientes WHERE id=?`).get(e.cliente_id) : null;
  return {
    envio: e, token: tokenDe(e.nonce),
    assessoria: { nome: emp?.nome || null, cnpj: emp?.cnpj || null, responsavel: u?.nome || null, email: u?.email || null },
    cliente: cli, itens: cartoes(db, JSON.parse(e.licitacoes)),
  };
}

// Confere a assinatura em tempo constante e devolve o envio válido
function envioDoToken(db, token) {
  const [nonce, sig] = String(token || '').split('.');
  if (!nonce || !sig || !/^[A-Za-z0-9_-]{16,40}$/.test(nonce) || !/^[A-Za-z0-9_-]{32}$/.test(sig)) throw erro(404, 'Link inválido.');
  const certo = Buffer.from(assinar(nonce)); const veio = Buffer.from(sig);
  if (certo.length !== veio.length || !crypto.timingSafeEqual(certo, veio)) throw erro(404, 'Link inválido.');
  const e = db.prepare('SELECT * FROM jornal_envios WHERE nonce=?').get(nonce);
  if (!e || e.revogado) throw erro(404, 'Este link não está mais ativo. Fale com a sua assessoria.');
  if (e.expira_em < new Date().toISOString().slice(0, 19).replace('T', ' ')) throw erro(410, 'Este jornal expirou. Peça um novo à sua assessoria.');
  return e;
}

/** O que o empresário vê pelo link: resumo de cada licitação, itens e o link do PNCP para baixar o edital. */
export function jornalPublico(db, token) {
  const e = envioDoToken(db, token);
  db.prepare("UPDATE jornal_envios SET ultimo_acesso=datetime('now') WHERE id=?").run(e.id);
  const d = dadosEnvio(db, e.id);
  const itensDe = db.prepare('SELECT numero_item, descricao, quantidade, unidade_medida FROM licitacao_itens WHERE licitacao_id=? ORDER BY numero_item LIMIT 15');
  const totalItens = db.prepare('SELECT COUNT(*) n FROM licitacao_itens WHERE licitacao_id=?');
  return {
    assessoria: { nome: d.assessoria.nome, responsavel: d.assessoria.responsavel, email: d.assessoria.email },
    cliente: d.cliente ? (d.cliente.nome_fantasia || d.cliente.razao_social) : null,
    criado_em: e.criado_em, respondido_em: e.respondido_em, respondente: e.respondente, observacao: e.observacao,
    interesses: e.interesses ? JSON.parse(e.interesses) : [],
    licitacoes: d.itens.map((l) => ({
      id: l.id, objeto: l.objeto, orgao: l.orgao_nome, unidade: l.unidade_nome, local: [l.municipio, l.uf].filter(Boolean).join('/'),
      modalidade: l.modalidade_nome, numero: numeroCompra(l),
      valor: l.valor_texto, abertura: dataBr(l.data_abertura_proposta), prazo: l.prazo_texto, sistema: l.sistema,
      me_epp: l.me_epp_exclusivo == null ? null : !!l.me_epp_exclusivo, srp: l.srp == null ? null : !!l.srp,
      criterio: l.criterio_julgamento, modo: l.modo_disputa_nome, link_pncp: l.link_pncp,
      itens: itensDe.all(l.id), total_itens: totalItens.get(l.id).n,
    })),
  };
}

/** O empresário marca as licitações de interesse; avisamos quem montou o jornal (sino e e-mail de alertas). */
export function responderJornal(db, token, b = {}) {
  const e = envioDoToken(db, token);
  const permitidos = new Set(JSON.parse(e.licitacoes));
  const marcadas = [...new Set((Array.isArray(b.interesses) ? b.interesses : []).map(Number))].filter((n) => permitidos.has(n));
  const respondente = String(b.respondente || '').trim().slice(0, 120);
  if (!respondente) throw erro(400, 'Informe o seu nome.');
  const obs = String(b.observacao || '').trim().slice(0, 2000) || null;
  db.prepare("UPDATE jornal_envios SET respondido_em=datetime('now'), respondente=?, interesses=?, observacao=? WHERE id=?")
    .run(respondente, JSON.stringify(marcadas), obs, e.id);
  const cli = e.cliente_id ? db.prepare('SELECT COALESCE(nome_fantasia, razao_social) n FROM clientes WHERE id=?').get(e.cliente_id)?.n : null;
  const quem = cli ? `${respondente} (${cli})` : respondente;
  const msg = marcadas.length
    ? `${quem} tem interesse em ${marcadas.length} licitação(ões) do jornal.${obs ? ` Obs.: ${obs}` : ''}`
    : `${quem} respondeu o jornal sem marcar licitações.${obs ? ` Obs.: ${obs}` : ''}`;
  if (e.criado_por) {
    const ins = db.prepare("INSERT INTO notificacoes (empresa_id, usuario_id, cliente_id, tipo, titulo, mensagem, licitacao_id) VALUES (?,?,?,'jornal','Interesse do cliente',?,?)");
    if (marcadas.length) for (const id of marcadas) ins.run(e.empresa_id, e.criado_por, e.cliente_id || 0, msg, id);
    else ins.run(e.empresa_id, e.criado_por, e.cliente_id || 0, msg, null);
    // As marcadas entram nos favoritos da empresa, na lista "Interesse do cliente", para virar oportunidade no Kanban
    const fav = db.prepare(`INSERT INTO favoritos (empresa_id, usuario_id, cliente_id, tipo, referencia, lista, nota) VALUES (?,?,?,'licitacao',?,'Interesse do cliente',?)
      ON CONFLICT(usuario_id, cliente_id, tipo, referencia, lista) DO UPDATE SET nota=excluded.nota`);
    for (const id of marcadas) fav.run(e.empresa_id, e.criado_por, e.cliente_id || 0, String(id), `Marcada por ${respondente} no jornal`);
  }
  return { interesses: marcadas.length };
}

/** Envios recentes (para a tela mostrar quem respondeu). */
export function listarEnvios(db, empresaId, clienteId = null) {
  return db.prepare(`SELECT e.id, e.cliente_id, COALESCE(c.nome_fantasia, c.razao_social) cliente, e.criado_em, e.email_para, e.email_status, e.email_erro,
      e.ultimo_acesso, e.respondido_em, e.respondente, e.interesses, e.observacao, e.licitacoes, e.expira_em
    FROM jornal_envios e LEFT JOIN clientes c ON c.id = e.cliente_id
    WHERE e.empresa_id=? ${clienteId ? 'AND e.cliente_id=?' : ''} ORDER BY e.id DESC LIMIT 20`).all(empresaId, ...(clienteId ? [clienteId] : []))
    .map((r) => ({ ...r, licitacoes: JSON.parse(r.licitacoes).length, interesses: r.interesses ? JSON.parse(r.interesses) : null }));
}

// ---------------- PDF ----------------
const AZUL = [0.06, 0.24, 0.43]; const CINZA = [0.38, 0.4, 0.44];

/** PDF do jornal: cabeçalho com os dados da empresa; cada licitação leva link para o resumo e para o PNCP. */
export function pdfJornal(d, { urlBase = '' } = {}) {
  const pdf = criarPdf();
  const pagina = urlBase ? `${urlBase.replace(/\/$/, '')}/j/${d.token}` : null;
  const c = d.cliente;
  pdf.texto('Jornal de licitações', { tam: 18, negrito: true, cor: AZUL, depois: 2 });
  if (c) {
    pdf.texto(`${c.razao_social}${c.nome_fantasia && c.nome_fantasia !== c.razao_social ? ` (${c.nome_fantasia})` : ''}`, { tam: 11.5, negrito: true, depois: 0 })
      .texto([c.cnpj ? `CNPJ ${cnpjFmt(c.cnpj)}` : null, c.endereco, [c.municipio, c.uf].filter(Boolean).join('/') || null, c.cep ? `CEP ${c.cep}` : null].filter(Boolean).join(' · '), { tam: 9, cor: CINZA, depois: 0 })
      .texto([c.resp_nome ? `Representante legal: ${c.resp_nome}${c.resp_cargo ? ` (${c.resp_cargo})` : ''}` : null, c.resp_email || c.email, c.telefone].filter(Boolean).join(' · '), { tam: 9, cor: CINZA, depois: 0 });
  }
  const a = d.assessoria;
  pdf.texto(`Preparado por ${[a.nome, a.responsavel].filter(Boolean).join(' · ')}${a.email ? ` · ${a.email}` : ''} em ${dataBr(d.envio.criado_em.slice(0, 10))}`, { tam: 9, cor: CINZA, depois: 2 });
  pdf.linha();
  if (pagina) {
    pdf.texto(`${d.itens.length} licitação(ões) selecionada(s). Clique no título para ver o resumo e marcar as que têm interesse:`, { tam: 9.5, depois: 0 })
      .texto(pagina, { tam: 9.5, cor: AZUL, url: pagina, depois: 6 });
  }
  d.itens.forEach((l, k) => {
    pdf.secao(`${k + 1}. ${l.modalidade_nome || 'Licitação'}${l.numero_texto ? ` nº ${l.numero_texto}` : ''} · ${[l.municipio, l.uf].filter(Boolean).join('/')}`, { tam: 10, minimo: 120 });
    pdf.texto(l.objeto || '(objeto não informado)', { tam: 10, negrito: true, cor: pagina ? AZUL : [0, 0, 0], url: pagina ? `${pagina}#lic-${l.id}` : null, depois: 3 })
      .campo('Órgão:', l.orgao_nome || 'Não informado')
      .campo('Valor do edital:', l.valor_texto)
      .campo('Propostas até:', l.prazo_texto)
      .campo('Sistema da disputa:', l.sistema.nome)
      .campo('Participação:', l.sistema.participacao);
    if (pagina) pdf.texto('Ver resumo e marcar interesse', { tam: 9, cor: AZUL, url: `${pagina}#lic-${l.id}`, depois: 0 });
    if (l.link_pncp) pdf.texto('Baixar o edital no PNCP', { tam: 9, cor: AZUL, url: l.link_pncp, depois: 4 });
    else pdf.espaco(4);
  });
  pdf.linha().texto('Dados públicos do PNCP. Confira sempre o edital: datas, valores e o sistema da disputa podem mudar por retificação. "Participação" se refere à taxa cobrada do fornecedor pelo sistema eletrônico.', { tam: 8, cor: CINZA });
  const nomeCli = c ? (c.nome_fantasia || c.razao_social) : null;
  return pdf.gerar({ titulo: `Jornal de licitações${nomeCli ? ` - ${nomeCli}` : ''}`, rodape: `Jornal de licitações${nomeCli ? ` · ${nomeCli}` : ''}${a.nome ? ` · ${a.nome}` : ''}` });
}

// ---------------- E-mail ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function montarEmailJornal(d, { urlBase }) {
  const pagina = `${urlBase.replace(/\/$/, '')}/j/${d.token}`;
  const c = d.cliente; const a = d.assessoria;
  const saud = c?.resp_nome ? `Olá, ${c.resp_nome.split(' ')[0]}!` : 'Olá!';
  const assunto = `Licitações selecionadas para ${c ? (c.nome_fantasia || c.razao_social) : 'você'}: tem interesse em participar?`;
  const texto = [saud, '',
    `Separamos ${d.itens.length} licitação(ões) com o perfil da sua empresa. Tem interesse em participar de alguma dispensa ou pregão?`,
    `Abra o link, marque as que interessam e clique em "Enviar meu interesse": ${pagina}`, '',
    ...d.itens.flatMap((l, k) => [`${k + 1}. ${l.objeto || ''}`, `   ${l.orgao_nome || ''} · ${[l.municipio, l.uf].filter(Boolean).join('/')}`,
      `   Valor do edital: ${l.valor_texto} · Propostas até: ${l.prazo_texto}`, `   Sistema: ${l.sistema.nome} · Participação: ${l.sistema.participacao}`, '']),
    'O jornal em PDF segue em anexo.', '', `${[a.responsavel, a.nome].filter(Boolean).join(' · ')}`].join('\n');
  const html = `<p>${esc(saud)}</p><p>Separamos <strong>${d.itens.length} licitação(ões)</strong> com o perfil da sua empresa. <strong>Tem interesse em participar de alguma dispensa ou pregão?</strong></p>`
    + `<p><a href="${esc(pagina)}" style="display:inline-block;background:#0f3d6e;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Ver o jornal e marcar meu interesse</a></p>`
    + d.itens.map((l, k) => `<div style="border:1px solid #d5dbe1;border-radius:8px;padding:10px 12px;margin:10px 0">`
      + `<div style="font-weight:bold"><a href="${esc(`${pagina}#lic-${l.id}`)}" style="color:#0f3d6e">${k + 1}. ${esc(l.objeto || '')}</a></div>`
      + `<div style="color:#5b6876;font-size:13px">${esc(l.orgao_nome || '')} · ${esc([l.municipio, l.uf].filter(Boolean).join('/'))}</div>`
      + `<div style="font-size:14px;margin-top:4px">Valor do edital: <strong>${esc(l.valor_texto)}</strong> · Propostas até: <strong>${esc(l.prazo_texto)}</strong></div>`
      + `<div style="font-size:14px">Sistema: ${esc(l.sistema.nome)} · Participação: ${esc(l.sistema.participacao)}</div></div>`).join('')
    + `<p>O jornal em PDF segue em anexo.</p><p>${esc([a.responsavel, a.nome].filter(Boolean).join(' · '))}</p>`
    + '<p style="color:#777;font-size:12px">Dados públicos do PNCP. Confira sempre o edital: datas e valores podem mudar por retificação.</p>';
  return { assunto, texto, html };
}

/** Envia o jornal ao representante legal e grava o resultado no envio. */
export async function enviarJornal(db, envioId, { para, urlBase }) {
  const d = dadosEnvio(db, envioId);
  const marcar = (status, erroMsg = null) => db.prepare("UPDATE jornal_envios SET email_para=?, email_status=?, email_erro=?, email_em=CASE WHEN ?='enviado' THEN datetime('now') ELSE email_em END WHERE id=?")
    .run(para, status, erroMsg, status, envioId);
  const m = montarEmailJornal(d, { urlBase });
  try {
    await enviarEmail({ para, assunto: m.assunto, texto: m.texto, html: m.html, responderPara: d.assessoria.email, nomeRemetente: d.assessoria.nome || undefined,
      anexos: [{ filename: 'jornal-de-licitacoes.pdf', content: pdfJornal(d, { urlBase }), contentType: 'application/pdf' }] });
    marcar('enviado'); return 'enviado';
  } catch (e) {
    if (e.semSmtp) { marcar('sem_smtp'); return 'sem_smtp'; }
    marcar('erro', String(e.message).slice(0, 300)); return 'erro';
  }
}
