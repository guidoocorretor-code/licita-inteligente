// Regras de segurança do Kanban:
// - Cards em "Nota fiscal emitida" (a receber) ou "Recebido" só mudam com a senha de um administrador,
//   exceto o passo natural (nota emitida → recebido) e completar dados ainda em branco.
// - Descartar exige justificativa, para o motivo não cair no esquecimento.
import bcrypt from 'bcryptjs';

export const FASES_TRAVADAS = ['faturada', 'recebida'];
export const MIN_JUSTIFICATIVA = 10;

/**
 * Diz se a alteração pedida num card travado precisa da senha do administrador.
 * op: card atual (com .fase); destino: etapa nova (ou null); campos: valores de execução enviados.
 */
export function precisaSenhaAdmin(op, { destino = null, campos = {}, outros = false, excluir = false } = {}) {
  if (!FASES_TRAVADAS.includes(op.fase)) return false;
  if (excluir || outros) return true;
  if (destino && destino.id !== op.etapa_id && !(op.fase === 'faturada' && destino.fase === 'recebida')) return true;
  // Completar campo vazio não é alteração; trocar ou apagar um valor já gravado é
  return Object.entries(campos).some(([k, v]) => op[k] != null && v !== op[k]);
}

// Limite de tentativas de senha por usuário (evita adivinhação)
const tentativas = new Map();
const JANELA = 15 * 60000; const MAX = 5;

/** Confere a senha contra os administradores ativos da conta. Devolve { id, nome } do administrador ou lança erro. */
export function conferirSenhaAdmin(db, empresaId, usuarioId, senha, { aviso = 'Este card está em "Nota fiscal emitida" ou "Recebido": informe a senha do administrador.' } = {}) {
  const agora = Date.now();
  const t = (tentativas.get(usuarioId) || []).filter((x) => agora - x < JANELA);
  if (t.length >= MAX) throw Object.assign(new Error('Muitas tentativas com senha errada. Aguarde 15 minutos.'), { status: 429 });
  if (!senha) throw Object.assign(new Error(aviso), { status: 423, codigo: 'senha_admin' });
  const admins = db.prepare("SELECT id, nome, senha_hash FROM usuarios WHERE empresa_id=? AND papel='admin' AND ativo=1").all(empresaId);
  const ok = admins.find((a) => bcrypt.compareSync(String(senha), a.senha_hash));
  if (!ok) {
    t.push(agora); tentativas.set(usuarioId, t);
    throw Object.assign(new Error('Senha do administrador incorreta.'), { status: 423, codigo: 'senha_admin' });
  }
  tentativas.delete(usuarioId);
  return { id: ok.id, nome: ok.nome };
}

/** Justificativa do descarte: obrigatória, com um mínimo de texto. */
export function justificativaDescarte(texto) {
  const j = String(texto || '').trim().slice(0, 1000);
  if (j.length < MIN_JUSTIFICATIVA) throw Object.assign(new Error(`Para descartar, escreva o motivo (pelo menos ${MIN_JUSTIFICATIVA} letras).`), { status: 400, codigo: 'justificativa' });
  return j;
}
