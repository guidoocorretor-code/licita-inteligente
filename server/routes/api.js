import express from 'express';
import { getDb, transacao } from '../db/index.js';
import { autenticar, definirCookie, limparCookie, exigirLogin, exigirPapel, auditar, criarUsuario, validarSenha, hashSenha, PAPEIS } from '../lib/auth.js';
import { buscar, buscarTodos } from '../services/busca.js';
import { indicadores } from '../services/dashboard.js';
import { STATUS, VISOES } from '../services/status.js';
import { ESFERAS, MODALIDADES_PNCP, normalizarPncp, normalizarCompras14133 } from '../services/normalizacao.js';
import { SEGMENTOS } from '../services/segmentos.js';
import { salvarLicitacao } from '../services/repositorio.js';
import { sincronizarFonte, testarFonte, reprocessarFalhas, sincronizarDetalhesDe, sincronizacaoEmAndamento } from '../services/sync.js';
import { paraCsv, paraXlsx } from '../services/exportacao.js';
import { CONECTORES } from '../connectors/registro.js';
import { eventosCalendario, gerarIcs, gerarTokenCalendario, revogarTokenCalendario } from '../services/calendario.js';
import { statusEmail, enviarEmailTeste } from '../services/email.js';
import { buscarContratos, contratosDaLicitacao } from '../services/contratos.js';
import { buscarCatalogo, statusCatalogo, sincronizarCatalogo, validarConsulta, consultarPrecos, analisarPrecos } from '../services/precos.js';

export const ETAPAS_PADRAO = ['Nova oportunidade', 'Em análise', 'Aguardando decisão', 'Documentação em preparação',
  'Proposta em elaboração', 'Pronta para envio', 'Participação confirmada', 'Em disputa', 'Aguardando resultado',
  'Vencida', 'Perdida', 'Descartada'];

export function garantirEtapas(db, empresaId) {
  const n = db.prepare('SELECT COUNT(*) n FROM kanban_etapas WHERE empresa_id=?').get(empresaId).n;
  if (n === 0) {
    const ins = db.prepare('INSERT INTO kanban_etapas (empresa_id, nome, ordem) VALUES (?,?,?)');
    ETAPAS_PADRAO.forEach((e, i) => ins.run(empresaId, e, i));
  }
}

const r = express.Router();
const db = () => getDb();
const erro = (res, status, msg) => res.status(status).json({ erro: msg });
const inteiro = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
export const urlBase = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const dataOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Limitador simples para login (por IP)
const tentativasIp = new Map();
function limitarLogin(req, res, next) {
  const k = req.ip; const agora = Date.now();
  const lista = (tentativasIp.get(k) || []).filter((t) => agora - t < 15 * 60000);
  if (lista.length >= 20) return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
  lista.push(agora); tentativasIp.set(k, lista); next();
}

// ---------------- Autenticação ----------------
r.post('/auth/login', limitarLogin, (req, res) => {
  const out = autenticar(db(), req.body?.email, req.body?.senha);
  if (!out.ok) return erro(res, 401, out.mensagem);
  definirCookie(res, out.token);
  req.usuario = out.usuario; auditar(req, 'login');
  res.json({ usuario: out.usuario });
});
r.post('/auth/logout', exigirLogin, (req, res) => { auditar(req, 'logout'); limparCookie(res); res.json({ ok: true }); });
r.post('/auth/sair-de-todos', exigirLogin, (req, res) => {
  db().prepare('UPDATE usuarios SET token_versao = token_versao + 1 WHERE id=?').run(req.usuario.id);
  limparCookie(res); res.json({ ok: true });
});
r.get('/auth/eu', exigirLogin, (req, res) => {
  const emp = db().prepare('SELECT id, nome, cnpj FROM empresas WHERE id=?').get(req.usuario.empresa_id);
  res.json({ usuario: req.usuario, empresa: emp });
});
r.post('/auth/senha', exigirLogin, (req, res) => {
  const { atual, nova } = req.body || {};
  const ok = autenticar(db(), req.usuario.email, atual);
  if (!ok.ok) return erro(res, 400, 'Senha atual incorreta.');
  const e = validarSenha(nova); if (e) return erro(res, 400, e);
  db().prepare('UPDATE usuarios SET senha_hash=?, token_versao=token_versao+1 WHERE id=?').run(hashSenha(nova), req.usuario.id);
  auditar(req, 'troca_senha'); limparCookie(res); res.json({ ok: true, mensagem: 'Senha alterada. Entre novamente.' });
});

r.use(exigirLogin);

// ---------------- Metadados ----------------
r.get('/meta', (req, res) => {
  const plataformas = db().prepare('SELECT DISTINCT plataforma_origem p FROM licitacoes WHERE plataforma_origem IS NOT NULL ORDER BY p').all().map((x) => x.p);
  const regimes = db().prepare('SELECT DISTINCT regime_legal p FROM licitacoes WHERE regime_legal IS NOT NULL ORDER BY p').all().map((x) => x.p);
  res.json({ status: STATUS, visoes: VISOES, esferas: ESFERAS, modalidades: MODALIDADES_PNCP, segmentos: SEGMENTOS, plataformas, regimes,
    ufs: ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] });
});

// ---------------- Dashboard ----------------
r.get('/dashboard', (req, res) => res.json(indicadores(db(), { usuarioId: req.usuario.id })));

// ---------------- Busca e licitações ----------------
r.get('/licitacoes', (req, res) => {
  try { res.json(buscar(db(), req.query)); } catch (e) { erro(res, 400, `Filtro inválido: ${e.message}`); }
});

r.get('/licitacoes/exportar', async (req, res) => {
  const linhas = buscarTodos(db(), req.query, 10000);
  auditar(req, 'exportar', 'licitacoes', null, { formato: req.query.formato, total: linhas.length });
  const nome = `licitacoes-${new Date().toISOString().slice(0, 10)}`;
  if (req.query.formato === 'xlsx') {
    const buf = await paraXlsx(linhas);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
  res.send(paraCsv(linhas));
});

r.get('/licitacoes/:id', (req, res) => {
  const id = inteiro(req.params.id);
  const lic = db().prepare('SELECT * FROM licitacoes WHERE id=?').get(id);
  if (!lic) return erro(res, 404, 'Licitação não encontrada.');
  const u = req.usuario;
  res.json({
    licitacao: lic,
    status_rotulo: STATUS[lic.status_calculado]?.rotulo,
    itens: db().prepare('SELECT * FROM licitacao_itens WHERE licitacao_id=? ORDER BY numero_item').all(id),
    documentos: db().prepare('SELECT * FROM licitacao_documentos WHERE licitacao_id=? ORDER BY sequencial').all(id),
    eventos: db().prepare('SELECT * FROM licitacao_eventos WHERE licitacao_id=? ORDER BY detectado_em DESC, id DESC LIMIT 200').all(id),
    fontes: db().prepare('SELECT fonte_codigo, id_externo, url, primeira_vez, ultima_vez FROM licitacao_fontes WHERE licitacao_id=?').all(id),
    favorito: !!db().prepare("SELECT 1 FROM favoritos WHERE usuario_id=? AND tipo='licitacao' AND referencia=?").get(u.id, String(id)),
    oportunidade: db().prepare(`SELECT o.*, e.nome etapa_nome FROM oportunidades o JOIN kanban_etapas e ON e.id=o.etapa_id
      WHERE o.empresa_id=? AND o.licitacao_id=?`).get(u.empresa_id, id) || null,
    contratos: contratosDaLicitacao(db(), id),
  });
});

r.post('/licitacoes/:id/atualizar', exigirPapel('analista'), async (req, res) => {
  try { res.json(await sincronizarDetalhesDe(db(), inteiro(req.params.id))); }
  catch (e) { erro(res, 502, `Não foi possível consultar a fonte agora: ${e.message}`); }
});

// ---------------- Jornal ----------------
r.get('/jornal', (req, res) => {
  const w = []; const p = [];
  if (req.query.tipo) { w.push('e.tipo = ?'); p.push(req.query.tipo); }
  if (req.query.uf) { w.push('l.uf = ?'); p.push(String(req.query.uf).toUpperCase()); }
  if (req.query.segmento) { w.push('l.segmento = ?'); p.push(req.query.segmento); }
  if (req.query.orgao) { w.push('l.orgao_nome LIKE ?'); p.push(`%${req.query.orgao}%`); }
  if (req.query.q) { w.push('(l.objeto LIKE ? OR e.descricao LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const pagina = Math.max(1, inteiro(req.query.pagina) || 1);
  const sql = `FROM licitacao_eventos e JOIN licitacoes l ON l.id = e.licitacao_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`;
  const total = db().prepare(`SELECT COUNT(*) n ${sql}`).get(...p).n;
  const dados = db().prepare(`SELECT e.*, l.objeto, l.orgao_nome, l.uf, l.municipio, l.modalidade_nome, l.segmento, l.status_calculado ${sql}
    ORDER BY e.detectado_em DESC, e.id DESC LIMIT 30 OFFSET ?`).all(...p, (pagina - 1) * 30);
  res.json({ total, pagina, paginas: Math.ceil(total / 30), dados });
});

// ---------------- Favoritos ----------------
r.get('/favoritos', (req, res) => {
  const favs = db().prepare('SELECT * FROM favoritos WHERE usuario_id=? AND empresa_id=? ORDER BY criado_em DESC').all(req.usuario.id, req.usuario.empresa_id);
  const lic = favs.filter((f) => f.tipo === 'licitacao').map((f) => Number(f.referencia));
  const licitacoes = lic.length ? db().prepare(`SELECT id, objeto, orgao_nome, uf, municipio, status_calculado, data_encerramento_proposta, valor_estimado, valor_estimado_situacao
    FROM licitacoes WHERE id IN (${lic.map(() => '?').join(',')})`).all(...lic) : [];
  res.json({ favoritos: favs, licitacoes });
});
r.post('/favoritos', (req, res) => {
  const { tipo, referencia, lista = 'Geral', nota = null } = req.body || {};
  if (!['licitacao', 'orgao', 'fornecedor', 'pesquisa'].includes(tipo) || !referencia) return erro(res, 400, 'Tipo ou referência inválidos.');
  if (tipo === 'licitacao' && !db().prepare('SELECT 1 FROM licitacoes WHERE id=?').get(inteiro(referencia))) return erro(res, 404, 'Licitação não encontrada.');
  db().prepare(`INSERT INTO favoritos (empresa_id, usuario_id, tipo, referencia, lista, nota) VALUES (?,?,?,?,?,?)
    ON CONFLICT(usuario_id, tipo, referencia, lista) DO UPDATE SET nota=excluded.nota`)
    .run(req.usuario.empresa_id, req.usuario.id, tipo, String(referencia).slice(0, 200), String(lista).slice(0, 60), nota ? String(nota).slice(0, 1000) : null);
  res.status(201).json({ ok: true });
});
r.delete('/favoritos', (req, res) => {
  const { tipo, referencia } = req.query;
  const out = db().prepare('DELETE FROM favoritos WHERE usuario_id=? AND empresa_id=? AND tipo=? AND referencia=?').run(req.usuario.id, req.usuario.empresa_id, tipo, String(referencia));
  res.json({ removidos: Number(out.changes) });
});

// ---------------- Pesquisas salvas ----------------
r.get('/pesquisas', (req, res) => res.json(db().prepare('SELECT * FROM pesquisas_salvas WHERE usuario_id=? AND empresa_id=? ORDER BY nome').all(req.usuario.id, req.usuario.empresa_id)));
r.post('/pesquisas', (req, res) => {
  const { nome, filtros, alertar } = req.body || {};
  if (!nome || typeof filtros !== 'object') return erro(res, 400, 'Informe nome e filtros.');
  const limpos = Object.fromEntries(Object.entries(filtros).filter(([k, v]) => v !== '' && v != null && !['pagina', 'tamanho'].includes(k)));
  const out = db().prepare(`INSERT INTO pesquisas_salvas (empresa_id, usuario_id, nome, filtros_json, alertar, ultimo_alerta_em) VALUES (?,?,?,?,?,datetime('now'))`)
    .run(req.usuario.empresa_id, req.usuario.id, String(nome).slice(0, 120), JSON.stringify(limpos), alertar ? 1 : 0);
  res.status(201).json({ id: Number(out.lastInsertRowid) });
});
r.patch('/pesquisas/:id', (req, res) => {
  const out = db().prepare('UPDATE pesquisas_salvas SET alertar=? WHERE id=? AND usuario_id=?').run(req.body?.alertar ? 1 : 0, inteiro(req.params.id), req.usuario.id);
  if (!out.changes) return erro(res, 404, 'Pesquisa não encontrada.');
  res.json({ ok: true });
});
r.delete('/pesquisas/:id', (req, res) => {
  const out = db().prepare('DELETE FROM pesquisas_salvas WHERE id=? AND usuario_id=?').run(inteiro(req.params.id), req.usuario.id);
  if (!out.changes) return erro(res, 404, 'Pesquisa não encontrada.');
  res.json({ ok: true });
});

// ---------------- Notificações ----------------
r.get('/notificacoes', (req, res) => res.json(db().prepare('SELECT * FROM notificacoes WHERE usuario_id=? ORDER BY id DESC LIMIT 100').all(req.usuario.id)));
r.post('/notificacoes/lidas', (req, res) => { db().prepare('UPDATE notificacoes SET lida=1 WHERE usuario_id=?').run(req.usuario.id); res.json({ ok: true }); });

// ---------------- Kanban (etapa interna separada da situação oficial) ----------------
r.get('/kanban', (req, res) => {
  const emp = req.usuario.empresa_id; garantirEtapas(db(), emp);
  const etapas = db().prepare('SELECT * FROM kanban_etapas WHERE empresa_id=? ORDER BY ordem').all(emp);
  const cards = db().prepare(`SELECT o.*, l.objeto, l.orgao_nome, l.uf, l.status_calculado, l.data_encerramento_proposta, l.valor_estimado, l.valor_estimado_situacao,
      u.nome responsavel_nome FROM oportunidades o JOIN licitacoes l ON l.id=o.licitacao_id LEFT JOIN usuarios u ON u.id=o.responsavel_id
      WHERE o.empresa_id=? ORDER BY o.posicao, o.id`).all(emp);
  const usuarios = db().prepare('SELECT id, nome FROM usuarios WHERE empresa_id=? AND ativo=1 ORDER BY nome').all(emp);
  res.json({ etapas, cards, usuarios });
});
r.post('/kanban', exigirPapel('analista'), (req, res) => {
  const emp = req.usuario.empresa_id; garantirEtapas(db(), emp);
  const licId = inteiro(req.body?.licitacao_id);
  if (!db().prepare('SELECT 1 FROM licitacoes WHERE id=?').get(licId)) return erro(res, 404, 'Licitação não encontrada.');
  const primeira = db().prepare('SELECT id FROM kanban_etapas WHERE empresa_id=? ORDER BY ordem LIMIT 1').get(emp);
  const existe = db().prepare('SELECT id FROM oportunidades WHERE empresa_id=? AND licitacao_id=?').get(emp, licId);
  if (existe) return res.json({ id: existe.id, existente: true });
  const out = db().prepare('INSERT INTO oportunidades (empresa_id, licitacao_id, etapa_id, responsavel_id) VALUES (?,?,?,?)').run(emp, licId, primeira.id, req.usuario.id);
  const id = Number(out.lastInsertRowid);
  db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'criacao','Oportunidade criada')").run(id, req.usuario.id);
  auditar(req, 'kanban_criar', 'oportunidade', id);
  res.status(201).json({ id });
});
r.patch('/kanban/:id', exigirPapel('analista'), (req, res) => {
  const emp = req.usuario.empresa_id; const id = inteiro(req.params.id);
  const op = db().prepare('SELECT * FROM oportunidades WHERE id=? AND empresa_id=?').get(id, emp);
  if (!op) return erro(res, 404, 'Oportunidade não encontrada.');
  const { etapa_id, responsavel_id, prazo_interno, posicao } = req.body || {};
  transacao(db(), () => {
    if (etapa_id != null) {
      const et = db().prepare('SELECT * FROM kanban_etapas WHERE id=? AND empresa_id=?').get(inteiro(etapa_id), emp);
      if (!et) throw Object.assign(new Error('Etapa inválida.'), { status: 400 });
      if (et.id !== op.etapa_id) {
        const de = db().prepare('SELECT nome FROM kanban_etapas WHERE id=?').get(op.etapa_id).nome;
        db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'movimento',?)").run(id, req.usuario.id, `${de} → ${et.nome}`);
      }
      db().prepare("UPDATE oportunidades SET etapa_id=?, atualizado_em=datetime('now') WHERE id=?").run(et.id, id);
    }
    if (responsavel_id !== undefined) {
      const rid = responsavel_id === null ? null : inteiro(responsavel_id);
      const resp = rid ? db().prepare('SELECT nome FROM usuarios WHERE id=? AND empresa_id=?').get(rid, emp) : null;
      if (rid && !resp) throw Object.assign(new Error('Responsável inválido.'), { status: 400 });
      if (rid !== op.responsavel_id) {
        db().prepare('UPDATE oportunidades SET responsavel_id=? WHERE id=?').run(rid, id);
        db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'atribuicao',?)").run(id, req.usuario.id, `Responsável: ${resp?.nome ?? 'nenhum'}`);
      }
    }
    if (prazo_interno !== undefined && (prazo_interno || null) !== op.prazo_interno) {
      if (prazo_interno && !dataOk(prazo_interno)) throw Object.assign(new Error('Prazo interno inválido.'), { status: 400 });
      db().prepare('UPDATE oportunidades SET prazo_interno=? WHERE id=?').run(prazo_interno || null, id);
      const txt = prazo_interno ? prazo_interno.split('-').reverse().join('/') : 'removido';
      db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'prazo',?)").run(id, req.usuario.id, txt);
    }
    if (posicao != null) db().prepare('UPDATE oportunidades SET posicao=? WHERE id=?').run(inteiro(posicao), id);
  });
  res.json({ ok: true });
});
r.post('/kanban/:id/comentarios', exigirPapel('analista'), (req, res) => {
  const op = db().prepare('SELECT id FROM oportunidades WHERE id=? AND empresa_id=?').get(inteiro(req.params.id), req.usuario.empresa_id);
  if (!op || !req.body?.texto) return erro(res, 400, 'Oportunidade ou texto inválido.');
  db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'comentario',?)").run(op.id, req.usuario.id, String(req.body.texto).slice(0, 4000));
  res.status(201).json({ ok: true });
});
r.get('/kanban/:id/historico', (req, res) => {
  const op = db().prepare('SELECT id FROM oportunidades WHERE id=? AND empresa_id=?').get(inteiro(req.params.id), req.usuario.empresa_id);
  if (!op) return erro(res, 404, 'Oportunidade não encontrada.');
  res.json(db().prepare(`SELECT h.*, u.nome usuario_nome FROM oportunidade_historico h LEFT JOIN usuarios u ON u.id=h.usuario_id WHERE oportunidade_id=? ORDER BY h.id DESC`).all(op.id));
});
r.delete('/kanban/:id', exigirPapel('gestor'), (req, res) => {
  const out = db().prepare('DELETE FROM oportunidades WHERE id=? AND empresa_id=?').run(inteiro(req.params.id), req.usuario.empresa_id);
  if (!out.changes) return erro(res, 404, 'Oportunidade não encontrada.');
  auditar(req, 'kanban_excluir', 'oportunidade', req.params.id); res.json({ ok: true });
});

// ---------------- Calendário de prazos (Fase 3) ----------------
r.get('/calendario', (req, res) => {
  res.json(eventosCalendario(db(), { empresaId: req.usuario.empresa_id, usuarioId: req.usuario.id, de: dataOk(req.query.de), ate: dataOk(req.query.ate) }));
});
r.get('/calendario.ics', (req, res) => {
  const ev = eventosCalendario(db(), { empresaId: req.usuario.empresa_id, usuarioId: req.usuario.id });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="prazos-licitacoes.ics"');
  res.send(gerarIcs(ev, { urlBase: urlBase(req) }));
});
r.get('/calendario/link', (req, res) => {
  const t = db().prepare('SELECT criado_em FROM calendario_tokens WHERE usuario_id=?').get(req.usuario.id);
  res.json({ ativo: !!t, criado_em: t?.criado_em || null });
});
r.post('/calendario/link', (req, res) => {
  const token = gerarTokenCalendario(db(), req.usuario.id);
  auditar(req, 'calendario_link_gerar', 'usuario', req.usuario.id);
  res.status(201).json({ url: `${urlBase(req)}/calendario/${token}.ics` });
});
r.delete('/calendario/link', (req, res) => {
  revogarTokenCalendario(db(), req.usuario.id);
  auditar(req, 'calendario_link_revogar', 'usuario', req.usuario.id);
  res.json({ ok: true });
});

// ---------------- Preferências de alerta e e-mail (Fase 3) ----------------
r.get('/preferencias', (req, res) => {
  const p = db().prepare('SELECT alertas_email, email_alertas FROM usuario_preferencias WHERE usuario_id=?').get(req.usuario.id);
  res.json({ alertas_email: p ? !!p.alertas_email : true, email_alertas: p?.email_alertas || '', email_login: req.usuario.email, email: statusEmail().configurado });
});
r.patch('/preferencias', (req, res) => {
  const atual = db().prepare('SELECT alertas_email, email_alertas FROM usuario_preferencias WHERE usuario_id=?').get(req.usuario.id) || { alertas_email: 1, email_alertas: null };
  const { alertas_email, email_alertas } = req.body || {};
  let destino = atual.email_alertas;
  if (email_alertas !== undefined) {
    destino = String(email_alertas || '').trim().toLowerCase() || null;
    if (destino && (!EMAIL_RE.test(destino) || destino.length > 200)) return erro(res, 400, 'E-mail para alertas inválido.');
  }
  const ativo = alertas_email === undefined ? atual.alertas_email : (alertas_email ? 1 : 0);
  db().prepare(`INSERT INTO usuario_preferencias (usuario_id, alertas_email, email_alertas) VALUES (?,?,?)
    ON CONFLICT(usuario_id) DO UPDATE SET alertas_email=excluded.alertas_email, email_alertas=excluded.email_alertas`).run(req.usuario.id, ativo, destino);
  auditar(req, 'preferencias_alterar', 'usuario', req.usuario.id, { alertas_email: !!ativo, email_alertas: destino });
  res.json({ ok: true });
});
r.get('/email/status', exigirPapel('admin'), (req, res) => res.json(statusEmail()));
r.post('/email/teste', async (req, res) => {
  const p = db().prepare('SELECT email_alertas FROM usuario_preferencias WHERE usuario_id=?').get(req.usuario.id);
  const destino = p?.email_alertas || req.usuario.email;
  try { await enviarEmailTeste({ nome: req.usuario.nome, email: destino }); res.json({ ok: true, mensagem: `E-mail de teste enviado para ${destino}.` }); }
  catch (e) { erro(res, 400, e.message); }
});

// ---------------- Fontes de dados (admin) ----------------
// ---------------- Fase 4: preços e contratos ----------------
const csvCampo = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const csv = (cab, linhas) => '\ufeff' + [cab.map(csvCampo).join(';'), ...linhas.map((l) => l.map(csvCampo).join(';'))].join('\r\n');
const decimal = (v) => (v == null ? '' : String(v).replace('.', ','));

r.get('/precos/catalogo', (req, res) => res.json({ status: statusCatalogo(db()), resultados: buscarCatalogo(db(), req.query.q) }));
r.post('/precos/catalogo/atualizar', exigirPapel('admin'), (req, res) => {
  auditar(req, 'catalogo_atualizar');
  sincronizarCatalogo(db()).then((r2) => console.log('[catalogo]', JSON.stringify(r2))).catch((e) => console.error('[catalogo]', e.message));
  res.status(202).json({ iniciado: true, mensagem: 'Download do catálogo do Compras.gov.br iniciado em segundo plano.' });
});
async function pesquisa(req, res) {
  const c = validarConsulta(req.query);
  if (!c) { erro(res, 400, 'Escolha um item do catálogo (tipo e código).'); return null; }
  try {
    const r2 = await consultarPrecos(db(), c, { forcar: req.query.atualizar === '1' });
    const cat = db().prepare('SELECT nome, classe FROM catalogo_compras WHERE tipo=? AND codigo=?')
      .get(c.tipo === 'servico' ? 'servico' : 'material', c.codigo);
    return { consulta: { ...c, nome: cat?.nome || null, classe: cat?.classe || null }, ...r2, baixados: r2.registros.length, ...analisarPrecos(r2.registros, req.query) };
  } catch (e) {
    erro(res, 502, `Não foi possível consultar o Compras.gov.br agora: ${e.message}`); return null;
  }
}
r.get('/precos', async (req, res) => {
  const p = await pesquisa(req, res);
  if (p) res.json({ ...p, registros: p.registros.slice(0, 1000), registros_total: p.registros.length });
});
r.get('/precos/exportar', async (req, res) => {
  const p = await pesquisa(req, res);
  if (!p) return;
  const cab = ['Data da compra', 'Código do item', 'Descrição', 'Descrição detalhada', 'Unidade', 'Quantidade', 'Preço unitário (R$)', 'Fora da curva',
    'Fornecedor', 'CNPJ/CPF fornecedor', 'Marca', 'Órgão', 'UASG', 'UASG nome', 'UF', 'Município', 'ID da compra', 'Item da compra'];
  const linhas = p.registros.map((x) => [x.data_compra, x.codigo_item, x.descricao, x.descricao_detalhada, x.unidade, decimal(x.quantidade),
    decimal(x.preco_unitario), x.fora_da_curva ? 'Sim' : '', x.fornecedor_nome, x.fornecedor_ni, x.marca, x.orgao_nome, x.uasg, x.uasg_nome, x.uf,
    x.municipio, x.id_compra, x.numero_item]);
  const est = p.estatisticas;
  const rodape = [[], [`Fonte: Compras.gov.br — Dados Abertos, módulo Pesquisa de Preços. Período ${p.desde} a ${p.ate}. Consultado em ${p.consultado_em} (UTC).`],
    [`Unidade: ${p.unidade || '—'} · ${est.n || 0} preços · menor ${decimal(est.menor)} · mediana ${decimal(est.mediana)} · média ${decimal(est.media)} · média sem fora da curva ${decimal(est.media_sem_fora_da_curva)} · maior ${decimal(est.maior)}`],
    ['Fora da curva = critério estatístico (Tukey, 1,5 x intervalo interquartil). A análise crítica dos preços é do usuário (IN SEGES/ME 65/2021, art. 6º).']];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="precos-${p.consulta.tipo}-${p.consulta.codigo}.csv"`);
  res.send(csv(cab, [...linhas, ...rodape]));
});

r.get('/contratos', (req, res) => res.json(buscarContratos(db(), req.query)));
r.get('/contratos/exportar', (req, res) => {
  const r2 = buscarContratos(db(), { ...req.query, pagina: 1 }, { limite: 20000 });
  const cab = ['Nº controle PNCP', 'Contratação de origem', 'Número', 'Tipo', 'Categoria', 'Objeto', 'Fornecedor', 'CNPJ/CPF fornecedor', 'Órgão', 'CNPJ órgão',
    'UF', 'Município', 'Valor inicial (R$)', 'Valor global (R$)', 'Assinatura', 'Vigência início', 'Vigência fim', 'Publicação PNCP', 'Link PNCP'];
  const linhas = r2.linhas.map((c) => [c.numero_controle_pncp, c.numero_controle_compra, c.numero_contrato, c.tipo_contrato, c.categoria, c.objeto,
    c.fornecedor_nome, c.fornecedor_ni, c.orgao_nome, c.orgao_cnpj, c.uf, c.municipio, decimal(c.valor_inicial), decimal(c.valor_global),
    c.data_assinatura, c.vigencia_inicio, c.vigencia_fim, c.data_publicacao, c.link_pncp]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contratos.csv"');
  res.send(csv(cab, linhas));
});

r.get('/fontes', (req, res) => {
  const fontes = db().prepare('SELECT id, codigo, nome, url_oficial, tipo_integracao, status_implementacao, situacao_conexao, habilitada, requer_credenciais, frequencia_minutos, ultima_sincronizacao, ultima_sincronizacao_ok, registros_importados, ultimo_erro, observacoes, config_json FROM fontes ORDER BY id').all();
  const falhas = db().prepare('SELECT fonte_id, COUNT(*) n FROM sync_falhas WHERE resolvida=0 GROUP BY fonte_id').all();
  const mapa = Object.fromEntries(falhas.map((f) => [f.fonte_id, f.n]));
  res.json(fontes.map((f) => ({ ...f, config: JSON.parse(f.config_json), falhas_pendentes: mapa[f.id] || 0, tem_conector: !!CONECTORES[f.codigo] })));
});
r.get('/fontes/:codigo/execucoes', (req, res) => {
  res.json(db().prepare(`SELECT e.* FROM sync_execucoes e JOIN fontes f ON f.id=e.fonte_id WHERE f.codigo=? ORDER BY e.id DESC LIMIT 30`).all(req.params.codigo));
});
r.patch('/fontes/:codigo', exigirPapel('admin'), (req, res) => {
  const f = db().prepare('SELECT * FROM fontes WHERE codigo=?').get(req.params.codigo);
  if (!f) return erro(res, 404, 'Fonte não encontrada.');
  const { habilitada, frequencia_minutos, config } = req.body || {};
  if (habilitada === true && !CONECTORES[f.codigo]) return erro(res, 400, 'Esta fonte não tem conector implementado e não pode ser habilitada.');
  if (habilitada !== undefined) db().prepare("UPDATE fontes SET habilitada=?, situacao_conexao=CASE WHEN ? THEN situacao_conexao ELSE 'desabilitada' END WHERE id=?").run(habilitada ? 1 : 0, habilitada ? 1 : 0, f.id);
  if (frequencia_minutos !== undefined) {
    const n = inteiro(frequencia_minutos); if (n == null || n < 15) return erro(res, 400, 'Frequência mínima: 15 minutos.');
    db().prepare('UPDATE fontes SET frequencia_minutos=? WHERE id=?').run(n, f.id);
  }
  if (config && typeof config === 'object') {
    const atual = JSON.parse(f.config_json);
    const novo = { ...atual };
    if (Array.isArray(config.ufs)) novo.ufs = config.ufs.map((u) => String(u).toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u));
    if (Array.isArray(config.modalidades)) novo.modalidades = config.modalidades.map(Number).filter((n) => n >= 1 && n <= 19);
    if (config.diasRetroativos != null) novo.diasRetroativos = Math.min(30, Math.max(1, inteiro(config.diasRetroativos) || 3));
    db().prepare('UPDATE fontes SET config_json=? WHERE id=?').run(JSON.stringify(novo), f.id);
  }
  auditar(req, 'fonte_alterar', 'fonte', f.codigo, req.body);
  res.json({ ok: true });
});
r.post('/fontes/:codigo/testar', exigirPapel('admin'), async (req, res) => {
  try { res.json(await testarFonte(db(), req.params.codigo)); } catch (e) { erro(res, 400, e.message); }
});
r.post('/fontes/:codigo/sincronizar', exigirPapel('admin'), async (req, res) => {
  try {
    auditar(req, 'fonte_sincronizar', 'fonte', req.params.codigo, { modo: req.body?.modo });
    const modo = req.body?.modo === 'abertas' ? 'abertas' : 'incremental';
    if (sincronizacaoEmAndamento(req.params.codigo)) return res.json({ ignorado: true, mensagem: 'Sincronização já em andamento para esta fonte. Acompanhe em "Execuções".' });
    // Carga completa pode levar dezenas de minutos: roda em segundo plano para a página não ficar presa nem cair por tempo.
    if (modo === 'abertas' || CONECTORES[req.params.codigo]?.segundoPlano) {
      sincronizarFonte(db(), req.params.codigo, { modo }).then((r) => console.log(`[sync] ${req.params.codigo} abertas: ${r.mensagem ?? r.status ?? ''}`))
        .catch((e) => console.error(`[sync] ${req.params.codigo}:`, e.message));
      const oque = modo === 'abertas' ? 'Carga das licitações abertas' : 'Sincronização';
      return res.status(202).json({ iniciado: true, mensagem: `${oque} iniciada em segundo plano. Pode fechar a página; acompanhe em "Execuções".` });
    }
    res.json(await sincronizarFonte(db(), req.params.codigo, { modo }));
  } catch (e) { erro(res, 400, e.message); }
});
r.post('/fontes/:codigo/reprocessar', exigirPapel('admin'), async (req, res) => {
  try { res.json(await reprocessarFalhas(db(), req.params.codigo)); } catch (e) { erro(res, 400, e.message); }
});
r.post('/fontes/:codigo/reiniciar-cursor', exigirPapel('admin'), (req, res) => {
  db().prepare("UPDATE fontes SET cursor_json='{}' WHERE codigo=?").run(req.params.codigo);
  auditar(req, 'fonte_reiniciar_cursor', 'fonte', req.params.codigo); res.json({ ok: true });
});

// Importação de arquivo JSON obtido nas APIs oficiais (alternativa quando o servidor não alcança a fonte).
// Aceita a resposta original do PNCP (/v1/contratacoes/*) ou do Compras.gov.br (módulo contratações 14.133).
r.post('/fontes/importar-json', exigirPapel('admin'), express.json({ limit: '25mb' }), (req, res) => {
  const corpo = req.body;
  let registros = null; let fonte = null; let norm = null;
  if (Array.isArray(corpo?.data)) { registros = corpo.data; fonte = 'pncp'; norm = normalizarPncp; }
  else if (Array.isArray(corpo?.resultado)) { registros = corpo.resultado; fonte = 'comprasgov_14133'; norm = normalizarCompras14133; }
  if (!registros) return erro(res, 400, 'Formato não reconhecido. Envie a resposta JSON original da API do PNCP (campo "data") ou do Compras.gov.br (campo "resultado").');
  const cont = { lidos: 0, inseridos: 0, atualizados: 0, inalterados: 0, rejeitados: 0, erros: [] };
  for (const reg of registros.slice(0, 5000)) {
    cont.lidos++;
    try {
      const c = norm(reg);
      if (!c.chave_canonica || !c.objeto) { cont.rejeitados++; continue; }
      const out = salvarLicitacao(db(), c, fonte, reg);
      cont[{ inserido: 'inseridos', atualizado: 'atualizados', inalterado: 'inalterados' }[out.acao]]++;
    } catch (e) { cont.rejeitados++; if (cont.erros.length < 5) cont.erros.push(e.message); }
  }
  auditar(req, 'importar_json', 'fonte', fonte, { lidos: cont.lidos, inseridos: cont.inseridos });
  res.json({ fonte, ...cont });
});

// ---------------- Usuários (admin da empresa) ----------------
r.get('/usuarios', exigirPapel('admin'), (req, res) => {
  res.json(db().prepare('SELECT id, nome, email, papel, ativo, ultimo_login, criado_em FROM usuarios WHERE empresa_id=? ORDER BY nome').all(req.usuario.empresa_id));
});
r.post('/usuarios', exigirPapel('admin'), (req, res) => {
  const { nome, email, senha, papel } = req.body || {};
  if (papel === 'superadmin' && req.usuario.papel !== 'superadmin') return erro(res, 403, 'Somente superadmin cria superadmin.');
  if (!PAPEIS.includes(papel)) return erro(res, 400, 'Papel inválido.');
  try {
    const id = criarUsuario(db(), { empresaId: req.usuario.empresa_id, nome, email, senha, papel });
    auditar(req, 'usuario_criar', 'usuario', id, { email, papel }); res.status(201).json({ id });
  } catch (e) { erro(res, e.status || 400, /UNIQUE/.test(e.message) ? 'E-mail já cadastrado.' : e.message); }
});
r.patch('/usuarios/:id', exigirPapel('admin'), (req, res) => {
  const id = inteiro(req.params.id);
  const u = db().prepare('SELECT * FROM usuarios WHERE id=? AND empresa_id=?').get(id, req.usuario.empresa_id);
  if (!u) return erro(res, 404, 'Usuário não encontrado.');
  if (id === req.usuario.id && req.body?.ativo === false) return erro(res, 400, 'Você não pode desativar a si mesmo.');
  if (req.body?.papel && (!PAPEIS.includes(req.body.papel) || (req.body.papel === 'superadmin' && req.usuario.papel !== 'superadmin'))) return erro(res, 400, 'Papel inválido.');
  if (req.body?.papel) db().prepare('UPDATE usuarios SET papel=?, token_versao=token_versao+1 WHERE id=?').run(req.body.papel, id);
  if (req.body?.ativo !== undefined) db().prepare('UPDATE usuarios SET ativo=?, token_versao=token_versao+1 WHERE id=?').run(req.body.ativo ? 1 : 0, id);
  auditar(req, 'usuario_alterar', 'usuario', id, req.body); res.json({ ok: true });
});
r.get('/auditoria', exigirPapel('admin'), (req, res) => {
  res.json(db().prepare(`SELECT a.*, u.nome usuario_nome FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id WHERE a.empresa_id=? ORDER BY a.id DESC LIMIT 200`).all(req.usuario.empresa_id));
});

// Tratamento de erros sem vazar detalhes internos
r.use((e, req, res, _next) => {
  console.error('[api]', e);
  res.status(e.status || 500).json({ erro: e.status ? e.message : 'Erro interno. Tente novamente.' });
});

export default r;
