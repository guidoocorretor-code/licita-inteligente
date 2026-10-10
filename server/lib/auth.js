// Autenticação: senha com bcrypt, sessão em JWT dentro de cookie HttpOnly + SameSite=Strict,
// bloqueio após tentativas, revogação por token_versao, papéis (RBAC) e isolamento por empresa.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

export const PAPEIS = ['superadmin', 'admin', 'gestor', 'analista', 'leitor'];
const NIVEL = { leitor: 1, analista: 2, gestor: 3, admin: 4, superadmin: 5 };
const COOKIE = 'li_sessao';
const HASH_FALSO = bcrypt.hashSync('senha-inexistente-123', 12); // iguala o tempo de resposta

export function validarSenha(s) {
  if (typeof s !== 'string' || s.length < 10) return 'A senha deve ter no mínimo 10 caracteres.';
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return 'A senha deve conter letras e números.';
  return null;
}

export const hashSenha = (s) => bcrypt.hashSync(s, 12);

export function criarUsuario(db, { empresaId, nome, email, senha, papel = 'analista' }) {
  const erro = validarSenha(senha);
  if (erro) throw Object.assign(new Error(erro), { status: 400 });
  if (!PAPEIS.includes(papel)) throw Object.assign(new Error('Papel inválido'), { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) throw Object.assign(new Error('E-mail inválido'), { status: 400 });
  const r = db.prepare('INSERT INTO usuarios (empresa_id, nome, email, senha_hash, papel) VALUES (?,?,?,?,?)')
    .run(empresaId, nome, email.trim().toLowerCase(), hashSenha(senha), papel);
  return Number(r.lastInsertRowid);
}

export function autenticar(db, email, senha) {
  const u = db.prepare('SELECT * FROM usuarios WHERE email=?').get(String(email || '').trim().toLowerCase());
  const falha = { ok: false, mensagem: 'E-mail ou senha inválidos.' };
  if (!u || !u.ativo) { bcrypt.compareSync(String(senha || ''), HASH_FALSO); return falha; }
  if (u.bloqueado_ate && u.bloqueado_ate > new Date().toISOString()) return { ok: false, mensagem: 'Conta temporariamente bloqueada por excesso de tentativas. Tente em 15 minutos.' };
  if (!bcrypt.compareSync(String(senha || ''), u.senha_hash)) {
    const t = u.tentativas_login + 1;
    const bloqueio = t >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
    db.prepare('UPDATE usuarios SET tentativas_login=?, bloqueado_ate=? WHERE id=?').run(bloqueio ? 0 : t, bloqueio, u.id);
    return falha;
  }
  db.prepare("UPDATE usuarios SET tentativas_login=0, bloqueado_ate=NULL, ultimo_login=datetime('now') WHERE id=?").run(u.id);
  const token = jwt.sign({ sub: u.id, emp: u.empresa_id, v: u.token_versao }, config.jwtSecret, { expiresIn: config.jwtExpira });
  return { ok: true, token, usuario: publico(u) };
}

export const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, empresa_id: u.empresa_id });

export function definirCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.producao, maxAge: 12 * 3600 * 1000, path: '/' });
}
export function limparCookie(res) { res.clearCookie(COOKIE, { path: '/' }); }

function lerCookie(req) {
  const c = req.headers.cookie || '';
  const m = c.split(/;\s*/).find((p) => p.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}

export function exigirLogin(req, res, next) {
  const token = lerCookie(req) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });
  try {
    const dados = jwt.verify(token, config.jwtSecret);
    const u = getDb().prepare('SELECT * FROM usuarios WHERE id=?').get(dados.sub);
    if (!u || !u.ativo || u.token_versao !== dados.v || u.empresa_id !== dados.emp) return res.status(401).json({ erro: 'Sessão inválida.' });
    req.usuario = publico(u);
    next();
  } catch { return res.status(401).json({ erro: 'Sessão expirada ou inválida.' }); }
}

export const exigirPapel = (minimo) => (req, res, next) =>
  (NIVEL[req.usuario?.papel] || 0) >= NIVEL[minimo] ? next() : res.status(403).json({ erro: 'Permissão insuficiente.' });

// Proteção CSRF complementar: requisições que alteram estado precisam do cabeçalho X-Requested-With
export function exigirCabecalhoAjax(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'licita') return res.status(403).json({ erro: 'Requisição bloqueada (CSRF).' });
  next();
}

export function auditar(req, acao, entidade, entidadeId, detalhes) {
  getDb().prepare('INSERT INTO auditoria (empresa_id, usuario_id, acao, entidade, entidade_id, detalhes, ip) VALUES (?,?,?,?,?,?,?)')
    .run(req.usuario?.empresa_id ?? null, req.usuario?.id ?? null, acao, entidade ?? null, entidadeId != null ? String(entidadeId) : null,
      detalhes ? JSON.stringify(detalhes).slice(0, 2000) : null, req.ip ?? null);
}
