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
import { ETAPAS_PADRAO } from './execucao.js';

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const assinar = (nonce) => crypto.createHmac('sha256', config.jwtSecret).update(`jornal-link:${nonce}`).digest('base64url').slice(0, 32);
const tokenDe = (nonce) => `${nonce}.${assinar(nonce)}`;
const DIAS_VALIDADE = 60;
export const MAX_ITENS_ENVIO = 60;

// Até 4 casas: o órgão publica valor unitário com 4 casas (ex.: R$ 139,0815) e o lance aceita 0,0001; arredondar a 2 mostra valor errado
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
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

/** Quanto falta para o fim das propostas (data do PNCP em horário de Brasília). null = data não informada. */
export function faltam(iso, agora = new Date()) {
  if (!iso) return null;
  const s = String(iso).replace(' ', 'T');
  const fim = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.length <= 10 ? `${s}T23:59:59` : s}-03:00`);
  if (Number.isNaN(fim.getTime())) return null;
  const ms = fim - agora;
  if (ms <= 0) return { dias: 0, horas: 0, texto: 'Prazo encerrado', urgencia: 'encerrada' };
  const dias = Math.floor(ms / 86400000); const horas = Math.floor(ms / 3600000);
  const texto = dias >= 2 ? `Faltam ${dias} dias` : dias === 1 ? 'Falta 1 dia' : horas >= 1 ? `Faltam ${horas} h` : 'Encerra em menos de 1 h';
  return { dias, horas, texto, urgencia: dias < 3 ? 'alta' : dias < 7 ? 'media' : 'baixa' };
}

/** Prazo mais curto primeiro; sem data e já encerradas no fim. */
export const ordenarPorPrazo = (itens) => [...itens].sort((a, b) => {
  const peso = (l) => (!l.faltam ? 2 : l.faltam.urgencia === 'encerrada' ? 3 : 1);
  return peso(a) - peso(b) || String(a.data_encerramento_proposta || '').localeCompare(String(b.data_encerramento_proposta || ''));
});

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
    faltam: faltam(l.data_encerramento_proposta),
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
    cliente: cli, itens: ordenarPorPrazo(cartoes(db, JSON.parse(e.licitacoes))),
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
      valor: l.valor_texto, abertura: dataBr(l.data_abertura_proposta), prazo: l.prazo_texto, faltam: l.faltam, sistema: l.sistema,
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
  const lics = resumoLicitacoes(db, marcadas);
  const notificacoes = [];
  if (e.criado_por) {
    // Um alerta por licitação marcada, já dizendo qual é (objeto e local), para não precisar abrir o jornal
    const ins = db.prepare("INSERT INTO notificacoes (empresa_id, usuario_id, cliente_id, tipo, titulo, mensagem, licitacao_id) VALUES (?,?,?,'jornal','Interesse do cliente',?,?)");
    if (marcadas.length) {
      for (const l of lics) {
        const msg = `${quem} tem interesse em: ${(l.objeto || 'licitação sem objeto informado').slice(0, 200)}${l.local ? ` · ${l.local}` : ''}${obs ? ` · Obs.: ${obs}` : ''}`;
        notificacoes.push(Number(ins.run(e.empresa_id, e.criado_por, e.cliente_id || 0, msg, l.id).lastInsertRowid));
      }
    } else notificacoes.push(Number(ins.run(e.empresa_id, e.criado_por, e.cliente_id || 0, `${quem} respondeu o jornal sem marcar licitações.${obs ? ` Obs.: ${obs}` : ''}`, null).lastInsertRowid));
    // As marcadas entram no Kanban da empresa, na primeira etapa (o que já está na esteira, inclusive descartado, não se mexe)
    if (marcadas.length) entrarNoKanban(db, e, marcadas, respondente);
  }
  return { interesses: marcadas.length, envio_id: e.id, notificacoes };
}

function entrarNoKanban(db, e, ids, respondente) {
  if (!db.prepare('SELECT 1 FROM kanban_etapas WHERE empresa_id=?').get(e.empresa_id)) {
    const ins = db.prepare('INSERT INTO kanban_etapas (empresa_id, nome, ordem, fase) VALUES (?,?,?,?)');
    ETAPAS_PADRAO.forEach(([nome, fase], i) => ins.run(e.empresa_id, nome, i, fase));
  }
  const primeira = db.prepare('SELECT id FROM kanban_etapas WHERE empresa_id=? ORDER BY ordem LIMIT 1').get(e.empresa_id);
  const existe = db.prepare('SELECT 1 FROM oportunidades WHERE empresa_id=? AND licitacao_id=? AND cliente_id=?');
  const ins = db.prepare('INSERT INTO oportunidades (empresa_id, cliente_id, licitacao_id, etapa_id, responsavel_id) VALUES (?,?,?,?,?)');
  const hist = db.prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'criacao',?)");
  for (const id of ids) {
    if (existe.get(e.empresa_id, id, e.cliente_id || 0)) continue;
    const op = Number(ins.run(e.empresa_id, e.cliente_id || 0, id, primeira.id, e.criado_por).lastInsertRowid);
    hist.run(op, e.criado_por, `Interesse marcado por ${respondente} no jornal de licitações`);
  }
}

/** Objeto, órgão e local das licitações (na ordem dos ids), para mostrar o que o cliente marcou. */
export function resumoLicitacoes(db, ids) {
  if (!ids?.length) return [];
  const linhas = db.prepare(`SELECT id, objeto, orgao_nome, municipio, uf, data_encerramento_proposta FROM licitacoes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return ids.map((id) => porId.get(id)).filter(Boolean)
    .map((l) => ({ id: l.id, objeto: l.objeto, orgao: l.orgao_nome, local: [l.municipio, l.uf].filter(Boolean).join('/'), prazo: l.data_encerramento_proposta }));
}

/** E-mail imediato para quem montou o jornal, dizendo quais licitações o cliente marcou (respeita "Receber alertas por e-mail"). */
export function montarEmailInteresse(d, { urlBase = '' } = {}) {
  const base = urlBase.replace(/\/$/, '');
  const quem = d.cliente ? `${d.respondente} (${d.cliente})` : d.respondente;
  const assunto = d.lics.length ? `Interesse do cliente: ${quem} marcou ${d.lics.length} licitação(ões)` : `${quem} respondeu o jornal sem marcar licitações`;
  const linha = (l) => `${(l.objeto || '').slice(0, 220)}${l.local ? ` · ${l.local}` : ''}${l.prazo ? ` · propostas até ${dataBr(l.prazo)}` : ''}`;
  const texto = [`${quem} respondeu o jornal de licitações.`, '',
    ...(d.lics.length ? d.lics.map((l, i) => `${i + 1}. ${linha(l)}${base ? `\n   ${base}/#/licitacao/${l.id}` : ''}`) : ['Nenhuma licitação marcada.']),
    d.observacao ? `\nObservação: ${d.observacao}` : '', '', 'As marcadas já estão no Kanban da empresa, na primeira etapa.'].join('\n');
  const html = `<p><strong>${esc(quem)}</strong> respondeu o jornal de licitações.</p>`
    + (d.lics.length ? `<ol>${d.lics.map((l) => `<li style="margin-bottom:10px">${esc(linha(l))}${base ? `<br><a href="${esc(`${base}/#/licitacao/${l.id}`)}">Abrir no sistema</a>` : ''}</li>`).join('')}</ol>` : '<p>Nenhuma licitação marcada.</p>')
    + (d.observacao ? `<p><strong>Observação:</strong> ${esc(d.observacao)}</p>` : '')
    + '<p style="color:#666;font-size:12px">As marcadas já estão no Kanban da empresa, na primeira etapa.</p>';
  return { assunto, texto, html };
}

export async function avisarInteresse(db, envioId, notificacoes = [], { urlBase = process.env.APP_URL || '' } = {}) {
  const e = db.prepare('SELECT * FROM jornal_envios WHERE id=?').get(envioId);
  if (!e?.criado_por) return { enviado: false };
  const u = db.prepare(`SELECT u.nome, COALESCE(NULLIF(p.email_alertas, ''), u.email) email, COALESCE(p.alertas_email, 1) quer FROM usuarios u
    LEFT JOIN usuario_preferencias p ON p.usuario_id = u.id WHERE u.id=? AND u.ativo=1`).get(e.criado_por);
  if (!u || !u.quer) return { enviado: false };
  const cliente = e.cliente_id ? db.prepare('SELECT COALESCE(nome_fantasia, razao_social) n FROM clientes WHERE id=?').get(e.cliente_id)?.n : null;
  const m = montarEmailInteresse({ respondente: e.respondente, cliente, observacao: e.observacao, lics: resumoLicitacoes(db, JSON.parse(e.interesses || '[]')) }, { urlBase });
  await enviarEmail({ para: u.email, assunto: m.assunto, texto: m.texto, html: m.html });
  // Já avisado agora: não repete no resumo de alertas
  const marcar = db.prepare('UPDATE notificacoes SET enviada_email = 1 WHERE id = ?');
  for (const id of notificacoes) marcar.run(id);
  return { enviado: true, para: u.email };
}

/** Envios recentes (para a tela mostrar quem respondeu). */
export function listarEnvios(db, empresaId, clienteId = null) {
  return db.prepare(`SELECT e.id, e.cliente_id, COALESCE(c.nome_fantasia, c.razao_social) cliente, e.criado_em, e.email_para, e.email_status, e.email_erro,
      e.ultimo_acesso, e.respondido_em, e.respondente, e.interesses, e.observacao, e.licitacoes, e.expira_em
    FROM jornal_envios e LEFT JOIN clientes c ON c.id = e.cliente_id
    WHERE e.empresa_id=? ${clienteId ? 'AND e.cliente_id=?' : ''} ORDER BY e.id DESC LIMIT 20`).all(empresaId, ...(clienteId ? [clienteId] : []))
    .map((r) => ({ ...r, licitacoes: JSON.parse(r.licitacoes).length, interesses: r.interesses ? resumoLicitacoes(db, JSON.parse(r.interesses)) : null }));
}

/** Apaga envios da empresa (o link do cliente deixa de funcionar). Interesses já recebidos continuam no Kanban. */
export function excluirEnvios(db, empresaId, ids) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  if (!lista.length) throw erro(400, 'Marque pelo menos um envio.');
  return Number(db.prepare(`DELETE FROM jornal_envios WHERE empresa_id=? AND id IN (${lista.map(() => '?').join(',')})`).run(empresaId, ...lista).changes);
}

// ---------------- PDF ----------------
const AZUL = [0.06, 0.24, 0.43]; const CINZA = [0.38, 0.4, 0.44];

/** PDF do jornal: cabeçalho com os dados da empresa; cada licitação leva link para o resumo e para o PNCP. */
export function pdfJornal(d, { urlBase = '' } = {}) {
  const pdf = criarPdf();
  const pagina = urlBase ? `${urlBase.replace(/\/$/, '')}/j/${d.token}` : null;
  const c = d.cliente; const a = d.assessoria;
  const nomeCli = c ? (c.nome_fantasia || c.razao_social) : null;
  const BRANCO = [1, 1, 1]; const AZUL2 = [0.12, 0.37, 0.64]; const CLARO = [0.93, 0.96, 0.98]; const LINHA = [0.84, 0.88, 0.92];
  const COR_URG = { alta: [0.71, 0.14, 0.09], media: [0.6, 0.36, 0], baixa: [0.07, 0.47, 0.36], encerrada: [0.6, 0.64, 0.7], sem: [0.6, 0.64, 0.7] };
  const ROT_URG = { alta: 'Urgente', media: 'Esta semana', baixa: 'No prazo', encerrada: 'Encerrada' };
  const abertas = d.itens.filter((l) => !l.faltam || l.faltam.urgencia !== 'encerrada');
  const comValor = abertas.filter((l) => l.valor_estimado != null && !['sigiloso', 'nao_informado'].includes(l.valor_estimado_situacao));
  const soma = comValor.reduce((s, l) => s + Number(l.valor_estimado), 0);
  const proxima = d.itens.find((l) => l.faltam && l.faltam.urgencia !== 'encerrada');
  const gratuitas = d.itens.filter((l) => l.sistema?.custo === 'gratuito').length;

  // Capa
  pdf.bloco(78, (t) => {
    t.ret(0 + t.x, 0, t.largura, 78, { cor: AZUL, raio: 8 });
    t.txt('JORNAL DE LICITAÇÕES', t.x + 16, 12, { tam: 8, negrito: true, cor: [0.75, 0.84, 0.95] });
    t.txt('Oportunidades para vender ao governo', t.x + 16, 25, { tam: 17, negrito: true, cor: BRANCO, maxW: t.largura - 150 });
    if (nomeCli) t.txt(`Selecionadas para ${nomeCli}`, t.x + 16, 52, { tam: 10.5, cor: BRANCO, maxW: t.largura - 150, max: 1 });
    t.txt(`Edição de ${dataBr(d.envio.criado_em.slice(0, 10))}`, t.x + t.largura - 146, 52, { tam: 8.5, cor: [0.85, 0.9, 0.97], maxW: 130, alinhar: 'r' });
    if (a.nome) t.txt(a.nome, t.x + t.largura - 146, 63, { tam: 8.5, cor: [0.85, 0.9, 0.97], maxW: 130, alinhar: 'r', max: 1 });
  }, { depois: 4 });
  if (c) {
    pdf.texto([c.razao_social, c.cnpj ? `CNPJ ${cnpjFmt(c.cnpj)}` : null, [c.municipio, c.uf].filter(Boolean).join('/') || null,
      c.resp_nome ? `A/C ${c.resp_nome}${c.resp_cargo ? ` (${c.resp_cargo})` : ''}` : null].filter(Boolean).join(' · '), { tam: 8.5, cor: CINZA, depois: 6 });
  }
  // Números do jornal
  const kpis = [
    [String(d.itens.length), d.itens.length === 1 ? 'oportunidade selecionada' : 'oportunidades selecionadas'],
    [comValor.length ? BRL.format(soma) : '-', `em valor estimado${abertas.length < d.itens.length ? ' das abertas' : ''}${comValor.length < abertas.length ? ` (${comValor.length} de ${abertas.length} informam)` : ''}`],
    [proxima ? proxima.faltam.texto.replace(/^Faltam? /, '') : '-', proxima ? `para a próxima encerrar (${proxima.prazo_texto})` : 'nenhuma com prazo em aberto'],
    [String(gratuitas), 'com participação gratuita'],
  ];
  pdf.bloco(46, (t) => {
    const g = 6; const w = (t.largura - 3 * g) / 4;
    kpis.forEach(([n, r], i) => {
      const x = t.x + i * (w + g);
      t.ret(x, 0, w, 46, { cor: CLARO, borda: LINHA, raio: 6 });
      t.txt(n, x + 8, 7, { tam: 13, negrito: true, cor: AZUL, maxW: w - 14, max: 1 });
      t.txt(r, x + 8, 25, { tam: 7.2, cor: CINZA, maxW: w - 14, max: 2, espaco: 1.2 });
    });
  }, { depois: 8 });
  // Como responder
  if (pagina) {
    pdf.bloco(40, (t) => {
      t.ret(t.x, 0, t.largura, 40, { borda: AZUL2, raio: 6, espessura: 0.8 });
      t.txt('1. Leia os cards: valor, prazo e se a participação é gratuita.', t.x + 10, 6, { tam: 8.5, maxW: t.largura - 140 });
      t.txt('2. Clique em "Tenho interesse" nas que combinam com a sua empresa.', t.x + 10, 17, { tam: 8.5, maxW: t.largura - 140 });
      t.txt('3. A assessoria cuida do resto: documentos, proposta e disputa.', t.x + 10, 28, { tam: 8.5, maxW: t.largura - 140 });
      const bw = 112; const bx = t.x + t.largura - bw - 10;
      t.ret(bx, 9, bw, 22, { cor: AZUL, raio: 5 });
      t.txt('Responder agora >', bx, 15, { tam: 9.5, negrito: true, cor: BRANCO, maxW: bw, alinhar: 'c' });
      t.link(bx, 9, bw, 22, pagina);
    }, { depois: 10 });
  }
  // Cards (do prazo mais curto para o mais longo)
  for (const l of d.itens) {
    const f = l.faltam; const urg = f?.urgencia || 'sem'; const cor = COR_URG[urg];
    const link = pagina ? `${pagina}#lic-${l.id}` : null;
    const wDir = 140; const wEsq = 495 - wDir - 30;
    const tags = [l.sistema.custo === 'gratuito' ? ['Participação gratuita', [0.07, 0.47, 0.36], [0.93, 0.97, 0.95]]
      : l.sistema.custo === 'pago' ? ['Sistema cobra taxa', [0.6, 0.36, 0], [0.99, 0.96, 0.92]] : ['Taxa do sistema: verificar', CINZA, [0.96, 0.97, 0.98]],
    l.me_epp_exclusivo ? ['Exclusiva ME/EPP', [0.36, 0.24, 0.66], [0.96, 0.94, 0.99]] : null, [l.sistema.nome, CINZA, BRANCO]].filter(Boolean);
    const altObj = pdf.linhasDe(l.objeto || '(objeto não informado)', 10, true, wEsq, 3) * 13;
    const alt = Math.max(18 + 7 + altObj + 13 + 17 + 26, 18 + 70 + 26);
    pdf.bloco(alt, (t) => {
      const x = t.x;
      t.ret(x, 0, t.largura, alt, { cor: BRANCO, borda: LINHA, raio: 6 });
      t.ret(x, 0, t.largura, 18, { cor: [0.965, 0.973, 0.984], raio: 0 });
      t.ret(x, 0, 4, alt, { cor });
      t.txt(`${l.modalidade_nome || 'Licitação'}${l.numero_texto ? ` nº ${l.numero_texto}` : ''}   ${[l.municipio, l.uf].filter(Boolean).join('/')}`, x + 12, 4.5, { tam: 8, negrito: true, cor: AZUL, maxW: 300, max: 1 });
      t.txt(!f ? 'Prazo não informado' : urg === 'encerrada' ? 'Prazo encerrado' : `${f.texto} · ${ROT_URG[urg]}`, x + 300, 4.5, { tam: 8, negrito: true, cor, maxW: t.largura - 312, alinhar: 'r', max: 1 });
      let dy = 25;
      t.txt(l.objeto || '(objeto não informado)', x + 12, dy, { tam: 10, negrito: true, maxW: wEsq, max: 3, url: link }); dy += altObj;
      t.txt(l.orgao_nome || 'Órgão não informado', x + 12, dy + 1, { tam: 8.5, cor: CINZA, maxW: wEsq, max: 1 }); dy += 14;
      let tx = x + 12;
      for (const [rot, ct, fundo] of tags) {
        const w = t.larguraDe(rot, 7.5, true) + 12;
        if (tx + w > x + 12 + wEsq) break;
        t.ret(tx, dy, w, 13, { cor: fundo, borda: ct, raio: 6.5, espessura: 0.5 });
        t.txt(rot, tx, dy + 3, { tam: 7.5, negrito: true, cor: ct, maxW: w, alinhar: 'c', max: 1 });
        tx += w + 5;
      }
      const xd = x + t.largura - wDir - 10;
      t.txt('VALOR ESTIMADO', xd, 26, { tam: 7, cor: CINZA, maxW: wDir, alinhar: 'r' });
      t.txt(l.valor_texto, xd, 36, { tam: 13, negrito: true, cor: AZUL, maxW: wDir, alinhar: 'r', max: 1 });
      t.txt('PROPOSTAS ATÉ', xd, 58, { tam: 7, cor: CINZA, maxW: wDir, alinhar: 'r' });
      t.txt(l.prazo_texto, xd, 68, { tam: 9.5, negrito: true, maxW: wDir, alinhar: 'r', max: 1 });
      const ya = alt - 24;
      if (link) {
        t.ret(x + 12, ya, 104, 17, { cor: AZUL, raio: 8.5 });
        t.txt('Tenho interesse', x + 12, ya + 4.2, { tam: 8.5, negrito: true, cor: BRANCO, maxW: 104, alinhar: 'c' });
        t.link(x + 12, ya, 104, 17, link);
        t.txt('Ver resumo do edital', x + 128, ya + 4.2, { tam: 8.5, cor: AZUL2, url: link, maxW: 120 });
      }
      if (l.link_pncp) t.txt('Edital completo no PNCP', x + (link ? 238 : 12), ya + 4.2, { tam: 8.5, cor: AZUL2, url: l.link_pncp, maxW: 150 });
    }, { depois: 8 });
  }
  pdf.linha({ cor: AZUL, antes: 2, depois: 6 });
  pdf.texto([a.responsavel, a.nome].filter(Boolean).join(' · ') + (a.email ? ` · ${a.email}` : ''), { tam: 9, negrito: true, depois: 2 });
  pdf.texto('Dados públicos do PNCP, organizados do prazo mais curto para o mais longo. Confira sempre o edital: datas, valores e o sistema da disputa podem mudar por retificação. "Participação gratuita" quer dizer que o sistema eletrônico não cobra taxa do fornecedor.', { tam: 7.5, cor: CINZA });
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
    + d.itens.map((l) => {
      const f = l.faltam; const corPrazo = !f ? '#5b6876' : { alta: '#b42318', media: '#9a5b00', baixa: '#13795b' }[f.urgencia] || '#5b6876';
      const prazo = !f ? 'Prazo não informado' : f.urgencia === 'encerrada' ? 'Prazo encerrado' : f.texto;
      const part = l.sistema.custo === 'gratuito' ? '<span style="color:#13795b;font-weight:bold">✓ Participação gratuita</span>' : l.sistema.custo === 'pago' ? 'Sistema cobra taxa' : 'Taxa do sistema: verificar';
      return `<div style="border:1px solid #d7e0ea;border-left:5px solid ${corPrazo};border-radius:8px;padding:10px 12px;margin:10px 0">`
        + `<div style="font-size:12px;color:#5b6876">${esc(l.modalidade_nome || 'Licitação')} · ${esc([l.municipio, l.uf].filter(Boolean).join('/'))} · <strong style="color:${corPrazo}">${esc(prazo)}</strong></div>`
        + `<div style="font-weight:bold;margin:4px 0"><a href="${esc(`${pagina}#lic-${l.id}`)}" style="color:#14212e;text-decoration:none">${esc(l.objeto || '')}</a></div>`
        + `<div style="color:#5b6876;font-size:13px">${esc(l.orgao_nome || '')}</div>`
        + `<div style="font-size:14px;margin-top:6px">Valor do edital: <strong style="color:#0f3d6e">${esc(l.valor_texto)}</strong> · Propostas até: <strong>${esc(l.prazo_texto)}</strong></div>`
        + `<div style="font-size:13px;margin-top:2px">${part} · ${esc(l.sistema.nome)}${l.me_epp_exclusivo ? ' · <strong style="color:#5b3ea8">Exclusiva ME/EPP</strong>' : ''}</div>`
        + `<div style="margin-top:8px"><a href="${esc(`${pagina}#lic-${l.id}`)}" style="display:inline-block;background:#0f3d6e;color:#fff;padding:6px 14px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:13px">Tenho interesse</a></div></div>`;
    }).join('')
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
