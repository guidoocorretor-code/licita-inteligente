// Captação: Minha Empresa (quem presta o serviço), captações de empresas assessoradas e os documentos
// gerados para elas (proposta, contrato, procuração), com arquivos, envios e histórico de status.
// O cadastro central da empresa assessorada continua sendo a tabela "clientes" (menu Empresas Assessoradas).
// Documento gerado guarda uma cópia congelada dos dados (snapshot): mudar o cadastro depois não altera o que foi emitido.
// Assinatura: fluxo ASSISTIDO pelo gov.br (o cliente assina no assinador.iti.br e devolve o arquivo). O sistema
// não fala com o gov.br e só marca "assinado" quando recebe o arquivo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { validarCnpj, caminhoArquivo, criarCliente, atualizarCliente } from './clientes.js';
import { lerJpeg } from '../lib/pdf-simples.js';
import { CAMPOS, TIPOS_DOC, PAGINAS_META, montarDocumento, dadosIniciais, parteMinhaEmpresa, parteCliente, faltasParte, soDigitos, fmtDoc, textosPadrao } from './captacao-modelos.js';
import { pdfDocumento } from './captacao-pdf.js';
import { agoraBrasilia } from './status.js';

const erro = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const texto = (v, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function migrarCaptacao(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS minhas_empresas (
      id INTEGER PRIMARY KEY,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      tipo_pessoa TEXT NOT NULL CHECK (tipo_pessoa IN ('PF','PJ')),
      nome TEXT NOT NULL,                 -- razão social (PJ) ou nome completo (PF)
      nome_fantasia TEXT,
      documento TEXT NOT NULL,            -- CPF ou CNPJ, só dígitos
      ie TEXT, im TEXT,
      endereco TEXT, bairro TEXT, municipio TEXT, uf TEXT, cep TEXT,
      representante_nome TEXT, representante_cpf TEXT, representante_cargo TEXT,
      representante_rg TEXT, representante_nacionalidade TEXT, representante_estado_civil TEXT, representante_profissao TEXT,
      telefone TEXT, email TEXT, email_documentos TEXT,
      logo_caminho TEXT,                  -- relativo a STORAGE_DIR (JPEG)
      banco TEXT, agencia TEXT, conta TEXT, tipo_conta TEXT, titular TEXT, titular_documento TEXT, pix TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (empresa_id, documento)
    );
    CREATE TABLE IF NOT EXISTS captacoes (
      id INTEGER PRIMARY KEY,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      minha_empresa_id INTEGER REFERENCES minhas_empresas(id),
      status TEXT NOT NULL DEFAULT 'em_preparacao',
      observacoes TEXT,
      cancelada_em TEXT, motivo_cancelamento TEXT,
      criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_capt_emp ON captacoes(empresa_id, atualizado_em);
    CREATE INDEX IF NOT EXISTS ix_capt_cli ON captacoes(cliente_id);
    CREATE TABLE IF NOT EXISTS captacao_documentos (
      id INTEGER PRIMARY KEY,
      captacao_id INTEGER NOT NULL REFERENCES captacoes(id) ON DELETE CASCADE,
      empresa_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('proposta','contrato','procuracao')),
      ano INTEGER NOT NULL, sequencial INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'rascunho',
      versao INTEGER NOT NULL DEFAULT 1,
      dados_json TEXT NOT NULL DEFAULT '{}',   -- campos do passo 4 (editáveis enquanto rascunho)
      snapshot_json TEXT,                       -- partes + dados congelados quando o PDF é gerado
      paginas INTEGER,
      gerado_em TEXT, enviado_em TEXT, assinado_em TEXT, cancelado_em TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (empresa_id, tipo, ano, sequencial)
    );
    CREATE INDEX IF NOT EXISTS ix_captdoc_capt ON captacao_documentos(captacao_id);
    CREATE TABLE IF NOT EXISTS captacao_arquivos (
      id INTEGER PRIMARY KEY,
      documento_id INTEGER NOT NULL REFERENCES captacao_documentos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('gerado','assinado')),
      versao INTEGER NOT NULL,
      caminho TEXT NOT NULL, nome TEXT, tamanho INTEGER, sha256 TEXT NOT NULL,
      assinatura_detectada INTEGER, contem_original INTEGER,   -- só no assinado (verificação simples, não é validação jurídica)
      criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_captarq_doc ON captacao_arquivos(documento_id);
    CREATE TABLE IF NOT EXISTS captacao_eventos (
      id INTEGER PRIMARY KEY,
      captacao_id INTEGER NOT NULL REFERENCES captacoes(id) ON DELETE CASCADE,
      documento_id INTEGER REFERENCES captacao_documentos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,                 -- status | envio | envio_manual | arquivo | edicao | cadastro
      status_de TEXT, status_para TEXT,
      descricao TEXT,
      destinatario TEXT,                  -- só em envios
      resultado TEXT,                     -- ok | falha
      erro TEXT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_captev_capt ON captacao_eventos(captacao_id, id);
  `);
  // Empresa assessorada pessoa física (CPF no campo "cnpj"), e-mail para documentos e observações comerciais
  const cols = conn.prepare('PRAGMA table_info(clientes)').all().map((c) => c.name);
  if (!cols.includes('tipo_pessoa')) conn.exec("ALTER TABLE clientes ADD COLUMN tipo_pessoa TEXT NOT NULL DEFAULT 'PJ'");
  for (const c of ['email_documentos', 'obs_comerciais']) if (!cols.includes(c)) conn.exec(`ALTER TABLE clientes ADD COLUMN ${c} TEXT`);
}

// ---------- CPF / documentos ----------
export function validarCpf(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (n) => { const s = d.slice(0, n).split('').reduce((a, x, i) => a + Number(x) * (n + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}
export const validarDocumento = (tipo, v) => (tipo === 'PF' ? validarCpf(v) : validarCnpj(v));

// ---------- Minha Empresa ----------
const TIPOS_CONTA = ['corrente', 'poupanca', 'pagamento'];
const CAMPOS_BANCO = ['banco', 'agencia', 'conta', 'tipo_conta', 'titular', 'titular_documento', 'pix'];

function dadosMinhaEmpresa(b) {
  const tipo = b.tipo_pessoa === 'PF' ? 'PF' : b.tipo_pessoa === 'PJ' ? 'PJ' : null;
  if (!tipo) throw erro(400, 'Escolha pessoa física ou jurídica.');
  const documento = validarDocumento(tipo, b.documento);
  if (!documento) throw erro(400, tipo === 'PF' ? 'CPF inválido. Confira os 11 números.' : 'CNPJ inválido. Confira os 14 números.');
  const nome = texto(b.nome);
  if (!nome) throw erro(400, tipo === 'PF' ? 'Informe o nome completo.' : 'Informe a razão social.');
  const d = {
    tipo_pessoa: tipo, nome, nome_fantasia: texto(b.nome_fantasia), documento, ie: texto(b.ie, 30), im: texto(b.im, 30),
    endereco: texto(b.endereco, 300), bairro: texto(b.bairro, 100), municipio: texto(b.municipio, 100), uf: texto(b.uf, 2)?.toUpperCase() || null, cep: soDigitos(b.cep) || null,
    representante_nome: texto(b.representante_nome, 150), representante_cpf: soDigitos(b.representante_cpf) || null, representante_cargo: texto(b.representante_cargo, 80),
    representante_rg: texto(b.representante_rg, 40), representante_nacionalidade: texto(b.representante_nacionalidade, 40),
    representante_estado_civil: texto(b.representante_estado_civil, 40), representante_profissao: texto(b.representante_profissao, 80),
    telefone: texto(b.telefone, 30), email: texto(b.email, 150), email_documentos: texto(b.email_documentos, 150),
    banco: texto(b.banco, 80), agencia: texto(b.agencia, 20), conta: texto(b.conta, 30), tipo_conta: texto(b.tipo_conta, 20),
    titular: texto(b.titular, 150), titular_documento: soDigitos(b.titular_documento) || null, pix: texto(b.pix, 120),
  };
  const faltam = [];
  if (!d.endereco) faltam.push('endereço'); if (!d.municipio) faltam.push('cidade'); if (!d.uf) faltam.push('UF');
  if (!d.telefone) faltam.push('telefone/WhatsApp'); if (!d.email) faltam.push('e-mail principal');
  if (tipo === 'PJ' && !d.representante_nome) faltam.push('representante legal');
  if (tipo === 'PJ' && !d.representante_cpf) faltam.push('CPF do representante');
  if (faltam.length) throw erro(400, `Preencha: ${faltam.join(', ')}.`);
  if (d.cep && d.cep.length !== 8) throw erro(400, 'CEP com 8 números.');
  if (d.representante_cpf && !validarCpf(d.representante_cpf)) throw erro(400, 'CPF do representante inválido.');
  for (const k of ['email', 'email_documentos']) if (d[k] && !EMAIL_RE.test(d[k])) throw erro(400, 'E-mail inválido.');
  // Banco: tudo ou nada (o documento só mostra se a pessoa marcar "incluir dados bancários")
  const algum = CAMPOS_BANCO.filter((k) => k !== 'pix').some((k) => d[k]);
  if (algum || d.pix) {
    const faltaBanco = [['banco', 'banco'], ['agencia', 'agência'], ['conta', 'conta'], ['tipo_conta', 'tipo de conta'], ['titular', 'titular'], ['titular_documento', 'CPF/CNPJ do titular']]
      .filter(([k]) => !d[k]).map(([, r]) => r);
    if (faltaBanco.length) throw erro(400, `Dados bancários incompletos: ${faltaBanco.join(', ')}.`);
    if (!TIPOS_CONTA.includes(d.tipo_conta)) throw erro(400, 'Tipo de conta inválido.');
    if (!validarCpf(d.titular_documento) && !validarCnpj(d.titular_documento)) throw erro(400, 'CPF/CNPJ do titular da conta inválido.');
  }
  return d;
}

/** Lista as "Minhas Empresas". Quem só lê (papel leitor) não vê dados bancários nem CPF do representante. */
export function listarMinhasEmpresas(db, empresaId, { protegido = false, todas = false } = {}) {
  return db.prepare(`SELECT * FROM minhas_empresas WHERE empresa_id=? ${todas ? '' : 'AND ativo=1'} ORDER BY nome`).all(empresaId).map((m) => protegerMe(m, protegido));
}
function protegerMe(m, protegido) {
  const r = { ...m, tem_logo: !!m.logo_caminho, logo_caminho: undefined, tem_banco: !!m.banco };
  if (protegido) { for (const k of CAMPOS_BANCO) r[k] = null; r.representante_cpf = m.representante_cpf ? '***' : null; r.representante_rg = null; }
  return r;
}
export const minhaEmpresaDaConta = (db, empresaId, id) => db.prepare('SELECT * FROM minhas_empresas WHERE id=? AND empresa_id=?').get(id, empresaId);

export function salvarMinhaEmpresa(db, empresaId, id, b) {
  const atual = id ? minhaEmpresaDaConta(db, empresaId, id) : null;
  if (id && !atual) throw erro(404, 'Cadastro não encontrado.');
  const d = dadosMinhaEmpresa({ ...(atual || {}), ...b });
  const outro = db.prepare('SELECT id FROM minhas_empresas WHERE empresa_id=? AND documento=? AND id<>?').get(empresaId, d.documento, id || 0);
  if (outro) throw erro(400, 'Já existe uma Minha Empresa com este CPF/CNPJ.');
  const cols = Object.keys(d);
  if (atual) {
    const ativo = b.ativo === undefined ? atual.ativo : b.ativo ? 1 : 0;
    db.prepare(`UPDATE minhas_empresas SET ${cols.map((k) => `${k}=?`).join(', ')}, ativo=?, atualizado_em=datetime('now') WHERE id=?`).run(...Object.values(d), ativo, id);
    return id;
  }
  return Number(db.prepare(`INSERT INTO minhas_empresas (empresa_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(empresaId, ...Object.values(d)).lastInsertRowid);
}

const dirMe = (id) => path.join(config.storageDir, 'minha-empresa', String(id));
/** Logo: só JPEG (a tela converte PNG/WebP em JPEG antes de enviar), até 1 MB e 4000 px. */
export function salvarLogo(db, empresaId, id, arquivo) {
  const m = minhaEmpresaDaConta(db, empresaId, id);
  if (!m) throw erro(404, 'Cadastro não encontrado.');
  const info = lerJpeg(arquivo?.buffer);
  if (!info) throw erro(400, 'Envie a logo em JPG ou PNG.');
  if (info.largura > 4000 || info.altura > 4000) throw erro(400, 'Imagem grande demais (máximo 4000 px).');
  fs.mkdirSync(dirMe(id), { recursive: true });
  const nome = `logo-${crypto.randomBytes(8).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(dirMe(id), nome), arquivo.buffer);
  removerArquivoLogo(m);
  db.prepare("UPDATE minhas_empresas SET logo_caminho=?, atualizado_em=datetime('now') WHERE id=?").run(path.join('minha-empresa', String(id), nome), id);
  return { largura: info.largura, altura: info.altura };
}
function removerArquivoLogo(m) {
  // Logo antiga só sai do disco se nenhum documento gerado a usa no snapshot (o PDF já gerado não depende dela)
  if (!m.logo_caminho) return;
  const abs = caminhoArquivo(m.logo_caminho);
  if (abs) fs.rmSync(abs, { force: true });
}
export function removerLogo(db, empresaId, id) {
  const m = minhaEmpresaDaConta(db, empresaId, id);
  if (!m) throw erro(404, 'Cadastro não encontrado.');
  removerArquivoLogo(m);
  db.prepare("UPDATE minhas_empresas SET logo_caminho=NULL, atualizado_em=datetime('now') WHERE id=?").run(id);
}

// ---------- Empresa assessorada (passo 1) ----------
const CAMPOS_CLIENTE = {
  razao_social: 'Razão social / nome', nome_fantasia: 'Nome fantasia', endereco: 'Endereço', cep: 'CEP', municipio: 'Cidade', uf: 'UF',
  resp_nome: 'Representante legal', resp_cpf: 'CPF do representante', resp_cargo: 'Cargo', telefone: 'Telefone / WhatsApp',
  email: 'E-mail', email_documentos: 'E-mail para documentos', obs_comerciais: 'Observações comerciais',
};
const normalizarComparacao = (k, v) => (['cep', 'resp_cpf', 'telefone'].includes(k) ? soDigitos(v) : String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' '));

/** Lê o formulário do passo 1. Exige só tipo, documento, nome e um contato; o resto, se faltar, deixa a captação "Cadastro incompleto". */
export function lerFormularioCliente(b) {
  const tipo = b.tipo_pessoa === 'PF' ? 'PF' : 'PJ';
  const documento = validarDocumento(tipo, b.documento ?? b.cnpj);
  if (!documento) throw erro(400, tipo === 'PF' ? 'CPF inválido. Confira os 11 números.' : 'CNPJ inválido. Confira os 14 números.');
  const razao = texto(b.razao_social);
  if (!razao) throw erro(400, tipo === 'PF' ? 'Informe o nome completo.' : 'Informe a razão social.');
  const d = { tipo_pessoa: tipo, cnpj: documento, razao_social: razao };
  for (const k of Object.keys(CAMPOS_CLIENTE)) if (!(k in d)) { const v = texto(b[k], k === 'obs_comerciais' ? 2000 : 300); if (v != null) d[k] = v; }
  if (d.uf) d.uf = d.uf.slice(0, 2).toUpperCase();
  if (d.cep) { d.cep = soDigitos(d.cep); if (d.cep.length !== 8) throw erro(400, 'CEP com 8 números.'); }
  if (d.resp_cpf) { if (!validarCpf(d.resp_cpf)) throw erro(400, 'CPF do representante inválido.'); d.resp_cpf = soDigitos(d.resp_cpf); }
  for (const k of ['email', 'email_documentos']) if (d[k] && !EMAIL_RE.test(d[k])) throw erro(400, 'E-mail inválido.');
  if (!d.telefone && !d.email) throw erro(400, 'Informe ao menos um contato: telefone/WhatsApp ou e-mail.');
  return d;
}

/** Procura a empresa pelo CPF/CNPJ na conta e lista o que o formulário traz de diferente do cadastro. */
export function compararCliente(db, empresaId, form) {
  const atual = db.prepare('SELECT * FROM clientes WHERE empresa_id=? AND cnpj=?').get(empresaId, form.cnpj);
  if (!atual) return null;
  const diferencas = Object.entries(CAMPOS_CLIENTE).filter(([k]) => form[k] != null && normalizarComparacao(k, form[k]) !== normalizarComparacao(k, atual[k]))
    .map(([k, rotulo]) => ({ campo: k, rotulo, atual: atual[k] ?? null, novo: form[k] }));
  return { id: atual.id, nome: atual.nome_fantasia || atual.razao_social, razao_social: atual.razao_social, ativo: !!atual.ativo, diferencas };
}

/** Confere o CPF/CNPJ digitado no passo 1 (antes de salvar): devolve a empresa existente e as diferenças, ou null. */
export function conferirEmpresa(db, empresaId, b = {}) {
  const tipo = b.tipo_pessoa === 'PF' ? 'PF' : 'PJ';
  const doc = validarDocumento(tipo, b.documento);
  if (!doc) throw erro(400, tipo === 'PF' ? 'CPF inválido. Confira os 11 números.' : 'CNPJ inválido. Confira os 14 números.');
  let form;
  try { form = lerFormularioCliente(b); } catch { form = { cnpj: doc }; }
  return compararCliente(db, empresaId, form);
}

/**
 * Passo 1, empresa nova: valida, não duplica (mesmo CPF/CNPJ na conta) e cria o cadastro central.
 * Se já existir, devolve erro 409 com a empresa e as diferenças para a tela oferecer "usar" ou "atualizar".
 */
export function cadastrarClienteDaCaptacao(db, empresaId, b) {
  const form = lerFormularioCliente(b);
  const existe = compararCliente(db, empresaId, form);
  if (existe) throw erro(409, `Esta empresa já está cadastrada: ${existe.nome}.`, { existente: existe });
  return criarCliente(db, empresaId, form);
}

/** Aplica no cadastro existente só os campos que o usuário escolheu atualizar. */
export function atualizarClienteComFormulario(db, empresaId, clienteId, b, campos = []) {
  const form = lerFormularioCliente(b);
  const atual = db.prepare('SELECT cnpj FROM clientes WHERE id=? AND empresa_id=?').get(clienteId, empresaId);
  if (!atual) throw erro(404, 'Empresa não encontrada.');
  if (atual.cnpj !== form.cnpj) throw erro(400, 'O CPF/CNPJ do formulário é de outra empresa.');
  const mudar = Object.fromEntries(campos.filter((k) => CAMPOS_CLIENTE[k] && form[k] != null).map((k) => [k, form[k]]));
  if (Object.keys(mudar).length) atualizarCliente(db, empresaId, clienteId, mudar);
  return Object.keys(mudar);
}

// ---------- Status ----------
const FEM = { proposta: true, procuracao: true, contrato: false };
export const STATUS_DOC = {
  rascunho: 'Em preparação', gerado: 'Gerado', enviado: 'Enviado', aguardando_aceite: 'Aguardando aceite',
  aguardando_assinatura: 'Aguardando assinatura', assinado: 'Assinado', cancelado: 'Cancelado',
};
export function rotuloDoc(tipo, status) {
  const a = FEM[tipo] ? 'a' : 'o';
  if (status === 'gerado') return `${TIPOS_DOC[tipo]} gerad${a}`;
  if (status === 'enviado') return `${TIPOS_DOC[tipo]} enviad${a}`;
  if (status === 'assinado') return tipo === 'proposta' ? 'Proposta aceita (assinada)' : `${TIPOS_DOC[tipo]} assinad${a}`;
  if (status === 'cancelado') return `${TIPOS_DOC[tipo]} cancelad${a}`;
  return STATUS_DOC[status] || status;
}
export const STATUS_CAPTACAO = {
  em_preparacao: 'Em preparação', cadastro_incompleto: 'Cadastro incompleto',
  proposta_gerada: 'Proposta gerada', proposta_enviada: 'Proposta enviada', aguardando_aceite: 'Aguardando aceite',
  contrato_gerado: 'Contrato gerado', contrato_enviado: 'Contrato enviado', aguardando_assinatura: 'Aguardando assinatura',
  assinado: 'Assinado', procuracao_gerada: 'Procuração gerada', procuracao_enviada: 'Procuração enviada',
  concluido: 'Concluído', cancelado: 'Cancelado',
};
const ORDEM_DOC = { rascunho: 0, gerado: 1, enviado: 2, aguardando_aceite: 3, aguardando_assinatura: 3, assinado: 4 };
const ORDEM_TIPO = { proposta: 0, contrato: 1, procuracao: 2 };

/** Status geral: o do documento mais atrasado (proposta antes de contrato antes de procuração). */
export function statusGeral(captacao, documentos, cliente) {
  if (captacao.cancelada_em) return 'cancelado';
  const ativos = documentos.filter((d) => d.status !== 'cancelado');
  if (ativos.length && ativos.every((d) => d.status === 'assinado')) return 'concluido';
  if (faltasParte(parteCliente(cliente), 'x').length) return 'cadastro_incompleto';
  if (!ativos.length || ativos.some((d) => d.status === 'rascunho') || !captacao.minha_empresa_id) return 'em_preparacao';
  const pend = ativos.filter((d) => d.status !== 'assinado')
    .sort((a, b) => ORDEM_DOC[a.status] - ORDEM_DOC[b.status] || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo])[0];
  if (pend.status === 'aguardando_aceite') return 'aguardando_aceite';
  if (pend.status === 'aguardando_assinatura') return 'aguardando_assinatura';
  const sufixo = pend.status === 'gerado' ? (FEM[pend.tipo] ? 'gerada' : 'gerado') : (FEM[pend.tipo] ? 'enviada' : 'enviado');
  const st = `${pend.tipo}_${sufixo}`;
  return STATUS_CAPTACAO[st] ? st : 'em_preparacao';
}

function recalcular(db, captacaoId) {
  const c = db.prepare('SELECT * FROM captacoes WHERE id=?').get(captacaoId);
  const docs = db.prepare('SELECT tipo, status FROM captacao_documentos WHERE captacao_id=?').all(captacaoId);
  const cli = db.prepare('SELECT * FROM clientes WHERE id=?').get(c.cliente_id);
  const novo = statusGeral(c, docs, cli);
  if (novo !== c.status) {
    db.prepare("UPDATE captacoes SET status=?, atualizado_em=datetime('now') WHERE id=?").run(novo, captacaoId);
    evento(db, captacaoId, null, { tipo: 'status', status_de: c.status, status_para: novo, descricao: `Situação: ${STATUS_CAPTACAO[novo]}` });
  } else db.prepare("UPDATE captacoes SET atualizado_em=datetime('now') WHERE id=?").run(captacaoId);
  return novo;
}

function evento(db, captacaoId, documentoId, e, usuarioId = null) {
  db.prepare(`INSERT INTO captacao_eventos (captacao_id, documento_id, tipo, status_de, status_para, descricao, destinatario, resultado, erro, usuario_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(captacaoId, documentoId, e.tipo, e.status_de ?? null, e.status_para ?? null, e.descricao ?? null,
    e.destinatario ?? null, e.resultado ?? null, e.erro ?? null, usuarioId ?? e.usuario_id ?? null);
}

function mudarStatusDoc(db, doc, para, usuarioId, descricao, extra = {}) {
  const sets = ['status=?', "atualizado_em=datetime('now')"]; const vals = [para];
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k}=?`); vals.push(v); }
  db.prepare(`UPDATE captacao_documentos SET ${sets.join(', ')} WHERE id=?`).run(...vals, doc.id);
  evento(db, doc.captacao_id, doc.id, { tipo: 'status', status_de: doc.status, status_para: para, descricao: descricao || rotuloDoc(doc.tipo, para) }, usuarioId);
  return recalcular(db, doc.captacao_id);
}

// ---------- Captações ----------
export const captacaoDaConta = (db, empresaId, id) => db.prepare('SELECT * FROM captacoes WHERE id=? AND empresa_id=?').get(id, empresaId);
function exigirCaptacao(db, empresaId, id, { aberta = false } = {}) {
  const c = captacaoDaConta(db, empresaId, id);
  if (!c) throw erro(404, 'Captação não encontrada.');
  if (aberta && c.cancelada_em) throw erro(400, 'Esta captação foi cancelada.');
  return c;
}

export function criarCaptacao(db, empresaId, usuarioId, { cliente_id, minha_empresa_id = null, observacoes = null }) {
  const cli = db.prepare('SELECT id, ativo FROM clientes WHERE id=? AND empresa_id=?').get(Number(cliente_id), empresaId);
  if (!cli) throw erro(404, 'Empresa assessorada não encontrada.');
  if (minha_empresa_id && !minhaEmpresaDaConta(db, empresaId, Number(minha_empresa_id))) throw erro(404, 'Minha Empresa não encontrada.');
  if (!cli.ativo) atualizarCliente(db, empresaId, cli.id, { ativo: true }); // empresa arquivada volta a ficar ativa ao ser captada de novo
  const id = Number(db.prepare('INSERT INTO captacoes (empresa_id, cliente_id, minha_empresa_id, observacoes, criado_por) VALUES (?,?,?,?,?)')
    .run(empresaId, cli.id, minha_empresa_id || null, texto(observacoes, 2000), usuarioId).lastInsertRowid);
  evento(db, id, null, { tipo: 'cadastro', descricao: 'Captação criada' }, usuarioId);
  recalcular(db, id);
  return id;
}

export function atualizarCaptacao(db, empresaId, id, usuarioId, b) {
  const c = exigirCaptacao(db, empresaId, id, { aberta: true });
  if (b.minha_empresa_id !== undefined) {
    const me = b.minha_empresa_id ? minhaEmpresaDaConta(db, empresaId, Number(b.minha_empresa_id)) : null;
    if (b.minha_empresa_id && !me) throw erro(404, 'Minha Empresa não encontrada.');
    db.prepare('UPDATE captacoes SET minha_empresa_id=? WHERE id=?').run(me?.id ?? null, id);
    if (me?.id !== c.minha_empresa_id) evento(db, id, null, { tipo: 'edicao', descricao: `Minha Empresa: ${me ? me.nome_fantasia || me.nome : 'nenhuma'}` }, usuarioId);
  }
  if (b.observacoes !== undefined) db.prepare('UPDATE captacoes SET observacoes=? WHERE id=?').run(texto(b.observacoes, 2000), id);
  recalcular(db, id);
}

export function cancelarCaptacao(db, empresaId, id, usuarioId, motivo) {
  const c = exigirCaptacao(db, empresaId, id, { aberta: true });
  const m = texto(motivo, 500);
  if (!m || m.length < 5) throw erro(400, 'Informe o motivo do cancelamento.');
  db.prepare("UPDATE captacoes SET cancelada_em=datetime('now'), motivo_cancelamento=? WHERE id=?").run(m, c.id);
  evento(db, c.id, null, { tipo: 'status', descricao: `Captação cancelada: ${m}` }, usuarioId);
  recalcular(db, c.id);
}
export function reabrirCaptacao(db, empresaId, id, usuarioId) {
  const c = exigirCaptacao(db, empresaId, id);
  if (!c.cancelada_em) return;
  db.prepare('UPDATE captacoes SET cancelada_em=NULL, motivo_cancelamento=NULL WHERE id=?').run(c.id);
  evento(db, c.id, null, { tipo: 'status', descricao: 'Captação reaberta' }, usuarioId);
  recalcular(db, c.id);
}

/** Exclusão definitiva (LGPD/retensão): só captação cancelada; apaga também os PDFs gerados e assinados. */
export function excluirCaptacao(db, empresaId, id) {
  const c = exigirCaptacao(db, empresaId, id);
  if (!c.cancelada_em) throw erro(400, 'Cancele a captação antes de excluí-la.');
  db.prepare('DELETE FROM captacoes WHERE id=?').run(c.id);
  fs.rmSync(dirCaptacao(c.id), { recursive: true, force: true });
}

const ROTULO_ME = "COALESCE(me.nome_fantasia, me.nome)";
/** Histórico com filtros: q (empresa), de/ate (criação), status, tipo de documento, cliente_id. */
export function listarCaptacoes(db, empresaId, f = {}) {
  const w = ['c.empresa_id = ?']; const p = [empresaId];
  if (f.q) { const q = `%${String(f.q).trim()}%`; const dig = soDigitos(f.q); w.push(`(sem_acento(cl.razao_social) LIKE sem_acento(?) OR sem_acento(COALESCE(cl.nome_fantasia,'')) LIKE sem_acento(?)${dig.length >= 3 ? ' OR cl.cnpj LIKE ?' : ''})`); p.push(q, q, ...(dig.length >= 3 ? [`%${dig}%`] : [])); }
  if (f.de) { w.push('date(c.criado_em) >= ?'); p.push(f.de); }
  if (f.ate) { w.push('date(c.criado_em) <= ?'); p.push(f.ate); }
  if (f.status && STATUS_CAPTACAO[f.status]) { w.push('c.status = ?'); p.push(f.status); }
  if (f.tipo && TIPOS_DOC[f.tipo]) { w.push("EXISTS (SELECT 1 FROM captacao_documentos d WHERE d.captacao_id=c.id AND d.tipo=? AND d.status<>'cancelado')"); p.push(f.tipo); }
  if (f.cliente_id) { w.push('c.cliente_id = ?'); p.push(Number(f.cliente_id)); }
  const linhas = db.prepare(`SELECT c.*, cl.razao_social, cl.nome_fantasia, cl.cnpj, cl.tipo_pessoa, ${ROTULO_ME} minha_empresa
    FROM captacoes c JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN minhas_empresas me ON me.id = c.minha_empresa_id
    WHERE ${w.join(' AND ')} ORDER BY c.atualizado_em DESC, c.id DESC LIMIT 500`).all(...p);
  const docs = db.prepare(`SELECT id, tipo, status, ano, sequencial FROM captacao_documentos WHERE captacao_id=? ORDER BY id`);
  return linhas.map((c) => ({ ...c, status_rotulo: STATUS_CAPTACAO[c.status] || c.status,
    documentos: docs.all(c.id).map((d) => ({ ...d, numero: numeroDoc(d), rotulo: rotuloDoc(d.tipo, d.status) })) }));
}

const numeroDoc = (d) => `${String(d.sequencial).padStart(3, '0')}/${d.ano}`;

export function detalheCaptacao(db, empresaId, id, { protegido = false } = {}) {
  const c = exigirCaptacao(db, empresaId, id);
  const cli = db.prepare('SELECT * FROM clientes WHERE id=?').get(c.cliente_id);
  const me = c.minha_empresa_id ? minhaEmpresaDaConta(db, empresaId, c.minha_empresa_id) : null;
  const arquivos = db.prepare('SELECT id, tipo, versao, nome, tamanho, sha256, assinatura_detectada, contem_original, criado_em FROM captacao_arquivos WHERE documento_id=? ORDER BY id DESC');
  const documentos = db.prepare('SELECT * FROM captacao_documentos WHERE captacao_id=? ORDER BY id').all(c.id).map((d) => ({
    ...d, dados: JSON.parse(d.dados_json || '{}'), dados_json: undefined, snapshot_json: undefined, numero: numeroDoc(d), rotulo: rotuloDoc(d.tipo, d.status),
    tipo_nome: TIPOS_DOC[d.tipo], paginas_meta: PAGINAS_META[d.tipo], arquivos: arquivos.all(d.id) }));
  const eventos = db.prepare(`SELECT e.*, u.nome usuario FROM captacao_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id
    WHERE e.captacao_id=? ORDER BY e.id DESC LIMIT 300`).all(c.id);
  return {
    captacao: { ...c, status_rotulo: STATUS_CAPTACAO[c.status] || c.status },
    cliente: cli, cliente_pendencias: faltasParte(parteCliente(cli), 'Empresa assessorada'),
    minha_empresa: me ? protegerMe(me, protegido) : null,
    documentos, eventos,
  };
}

// ---------- Documentos ----------
function documentoDaConta(db, empresaId, id) {
  const d = db.prepare('SELECT * FROM captacao_documentos WHERE id=? AND empresa_id=?').get(id, empresaId);
  if (!d) throw erro(404, 'Documento não encontrado.');
  return d;
}
const hojeBr = () => agoraBrasilia().slice(0, 10);

export function criarDocumentos(db, empresaId, captacaoId, usuarioId, tipos) {
  const c = exigirCaptacao(db, empresaId, captacaoId, { aberta: true });
  const lista = [...new Set((Array.isArray(tipos) ? tipos : [tipos]).filter((x) => TIPOS_DOC[x]))];
  if (!lista.length) throw erro(400, 'Escolha ao menos um documento.');
  const me = c.minha_empresa_id ? minhaEmpresaDaConta(db, empresaId, c.minha_empresa_id) : null;
  const hoje = hojeBr(); const ano = Number(hoje.slice(0, 4));
  const ids = [];
  for (const tipo of lista) {
    // Valores copiáveis vêm do último documento do mesmo tipo desta Minha Empresa (ou da conta)
    const ult = db.prepare(`SELECT d.dados_json FROM captacao_documentos d JOIN captacoes c ON c.id = d.captacao_id
      WHERE d.empresa_id=? AND d.tipo=? ORDER BY (c.minha_empresa_id IS ?) DESC, d.id DESC LIMIT 1`).get(empresaId, tipo, me?.id ?? null);
    const dados = dadosIniciais(tipo, { ultimo: ult ? JSON.parse(ult.dados_json) : null, me, hoje });
    const seq = db.prepare('SELECT COALESCE(MAX(sequencial),0)+1 n FROM captacao_documentos WHERE empresa_id=? AND tipo=? AND ano=?').get(empresaId, tipo, ano).n;
    const id = Number(db.prepare('INSERT INTO captacao_documentos (captacao_id, empresa_id, tipo, ano, sequencial, dados_json) VALUES (?,?,?,?,?,?)')
      .run(c.id, empresaId, tipo, ano, seq, JSON.stringify(dados)).lastInsertRowid);
    evento(db, c.id, id, { tipo: 'status', status_para: 'rascunho', descricao: `${TIPOS_DOC[tipo]} nº ${numeroDoc({ ano, sequencial: seq })} criad${FEM[tipo] ? 'a' : 'o'}` }, usuarioId);
    ids.push(id);
  }
  recalcular(db, c.id);
  return ids;
}

/** Limpa os dados do passo 4 conforme o tipo de cada campo. */
function limparDados(tipo, b) {
  const out = {};
  for (const c of CAMPOS[tipo]) {
    const v = b[c.id];
    if (v === undefined) continue;
    if (c.tipo === 'multi') out[c.id] = (Array.isArray(v) ? v : []).map(String).filter((x) => c.opcoes.some(([k]) => k === x));
    else if (c.tipo === 'bool') out[c.id] = !!v;
    else if (['numero', 'moeda', 'pct'].includes(c.tipo)) {
      if (v === '' || v == null) { out[c.id] = null; continue; }
      const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) throw erro(400, `${c.rotulo}: número inválido.`);
      if (c.tipo === 'pct' && n > 100) throw erro(400, `${c.rotulo}: até 100%.`);
      out[c.id] = typeof v === 'number' ? v : n;
    } else if (c.tipo === 'data') out[c.id] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    else if (c.tipo === 'sel') out[c.id] = c.opcoes.some(([k]) => k === v) ? v : null;
    else out[c.id] = texto(v, c.tipo === 'area' ? 4000 : 300) ?? '';
  }
  if (b.textos && typeof b.textos === 'object') {
    out.textos = Object.fromEntries(Object.entries(b.textos).filter(([k, v]) => /^[a-z_]{2,40}$/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.slice(0, 6000)]));
  }
  return out;
}

/**
 * Salva o passo 4. Documento já gerado/enviado volta a "Em preparação" numa versão nova (o PDF anterior fica no histórico).
 * Documento assinado não muda: para alterar, gere um documento novo.
 */
export function salvarDados(db, empresaId, docId, usuarioId, b) {
  const d = documentoDaConta(db, empresaId, docId);
  exigirCaptacao(db, empresaId, d.captacao_id, { aberta: true });
  if (d.status === 'assinado') throw erro(400, 'Documento assinado não pode ser alterado. Gere um documento novo.');
  if (d.status === 'cancelado') throw erro(400, 'Documento cancelado.');
  const novos = { ...JSON.parse(d.dados_json || '{}'), ...limparDados(d.tipo, b || {}) };
  if (b?.textos && typeof b.textos === 'object') novos.textos = limparDados(d.tipo, { textos: b.textos }).textos;
  db.prepare("UPDATE captacao_documentos SET dados_json=?, atualizado_em=datetime('now') WHERE id=?").run(JSON.stringify(novos), d.id);
  if (d.status !== 'rascunho') {
    db.prepare('UPDATE captacao_documentos SET versao=versao+1 WHERE id=?').run(d.id);
    mudarStatusDoc(db, d, 'rascunho', usuarioId, `${TIPOS_DOC[d.tipo]} reaberto para edição (versão ${d.versao + 1}); a versão ${d.versao} fica no histórico`);
  } else recalcular(db, d.captacao_id);
  return novos;
}

function contexto(db, empresaId, d) {
  const c = db.prepare('SELECT * FROM captacoes WHERE id=?').get(d.captacao_id);
  const meRow = c.minha_empresa_id ? minhaEmpresaDaConta(db, empresaId, c.minha_empresa_id) : null;
  const cli = db.prepare('SELECT * FROM clientes WHERE id=?').get(c.cliente_id);
  return { c, meRow, me: parteMinhaEmpresa(meRow), cli: parteCliente(cli), dados: JSON.parse(d.dados_json || '{}'), numero: numeroDoc(d) };
}

/** Pré-visualização com os dados atuais do cadastro (o documento gerado usa a cópia congelada). */
export function previaDocumento(db, empresaId, docId) {
  const d = documentoDaConta(db, empresaId, docId);
  const ctx = contexto(db, empresaId, d);
  const doc = montarDocumento(d.tipo, ctx);
  if (!ctx.meRow) doc.pendencias.unshift('Escolha a Minha Empresa (passo 2)');
  return { ...doc, status: d.status, versao: d.versao, textos_padrao: textosPadrao(d.tipo, ctx), campos: CAMPOS[d.tipo], dados: ctx.dados };
}
export function pdfPrevia(db, empresaId, docId) {
  const d = documentoDaConta(db, empresaId, docId);
  const ctx = contexto(db, empresaId, d);
  return pdfDocumento(montarDocumento(d.tipo, ctx), ctx.me, { previa: true });
}

const dirCaptacao = (id) => path.join(config.storageDir, 'captacoes', String(id));
function gravarArquivo(captacaoId, buffer) {
  fs.mkdirSync(dirCaptacao(captacaoId), { recursive: true });
  const nome = `${crypto.randomBytes(12).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(dirCaptacao(captacaoId), nome), buffer);
  return path.join('captacoes', String(captacaoId), nome);
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const nomeArquivo = (d, sufixo = '') => `${TIPOS_DOC[d.tipo]}-${String(d.sequencial).padStart(3, '0')}-${d.ano}${d.versao > 1 ? `-v${d.versao}` : ''}${sufixo}.pdf`
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Gera o PDF final: exige o documento sem pendências, congela os dados (snapshot) e guarda o arquivo com hash. */
export function gerarPdfFinal(db, empresaId, docId, usuarioId) {
  const d = documentoDaConta(db, empresaId, docId);
  exigirCaptacao(db, empresaId, d.captacao_id, { aberta: true });
  if (d.status !== 'rascunho') throw erro(400, 'O PDF desta versão já foi gerado. Para mudar, edite o documento (vira uma versão nova).');
  const ctx = contexto(db, empresaId, d);
  if (!ctx.meRow) throw erro(400, 'Escolha a Minha Empresa antes de gerar.');
  const doc = montarDocumento(d.tipo, ctx);
  if (doc.pendencias.length) throw erro(400, `Falta preencher: ${doc.pendencias.join('; ')}.`, { pendencias: doc.pendencias });
  const { pdf, paginas } = pdfDocumento(doc, ctx.me);
  const caminho = gravarArquivo(d.captacao_id, pdf);
  const snapshot = { minha_empresa: ctx.me, cliente: ctx.cli, dados: ctx.dados, numero: ctx.numero, documento: doc, gerado_em: new Date().toISOString() };
  db.prepare(`INSERT INTO captacao_arquivos (documento_id, tipo, versao, caminho, nome, tamanho, sha256, criado_por) VALUES (?,?,?,?,?,?,?,?)`)
    .run(d.id, 'gerado', d.versao, caminho, nomeArquivo(d), pdf.length, sha256(pdf), usuarioId);
  mudarStatusDoc(db, d, 'gerado', usuarioId, `${TIPOS_DOC[d.tipo]} nº ${ctx.numero} gerad${FEM[d.tipo] ? 'a' : 'o'} (versão ${d.versao}, ${paginas} página(s))`,
    { snapshot_json: JSON.stringify(snapshot), paginas, gerado_em: new Date().toISOString() });
  return { paginas, meta: PAGINAS_META[d.tipo], acima_da_meta: paginas > PAGINAS_META[d.tipo] };
}

/** Arquivo de um documento (gerado ou assinado), conferindo a conta. Sem id: o último gerado da versão atual. */
export function arquivoDoDocumento(db, empresaId, docId, arquivoId = null) {
  const d = documentoDaConta(db, empresaId, docId);
  const a = arquivoId
    ? db.prepare('SELECT * FROM captacao_arquivos WHERE id=? AND documento_id=?').get(arquivoId, d.id)
    : db.prepare("SELECT * FROM captacao_arquivos WHERE documento_id=? AND tipo='gerado' AND versao=? ORDER BY id DESC LIMIT 1").get(d.id, d.versao);
  const abs = a && caminhoArquivo(a.caminho);
  if (!abs || !fs.existsSync(abs)) throw erro(404, 'Arquivo não encontrado. Gere o PDF primeiro.');
  return { abs, nome: a.nome, doc: d, arquivo: a };
}

/** Status depois de um envio: com pedido de assinatura/aceite fica aguardando; sem, só "enviado". */
const statusAposEnvio = (d, pedirAssinatura) => (pedirAssinatura ? (d.tipo === 'proposta' ? 'aguardando_aceite' : 'aguardando_assinatura') : 'enviado');

export const INSTRUCOES_GOVBR = [
  'Como assinar com a sua conta gov.br (gratuito, conta nível prata ou ouro):',
  '1. Salve o PDF anexo no computador ou no celular.',
  '2. Acesse https://assinador.iti.br e entre com a sua conta gov.br.',
  '3. Envie o PDF, posicione a assinatura e confirme com o código recebido no celular.',
  '4. Baixe o arquivo assinado e responda este e-mail com ele anexado.',
  'Para conferir a assinatura depois: https://validar.iti.gov.br',
  'Não pedimos e não guardamos a sua senha do gov.br.',
].join('\n');

/** Texto padrão do e-mail (a tela mostra para revisão antes de enviar). */
export function rascunhoEmail(db, empresaId, docId) {
  const d = documentoDaConta(db, empresaId, docId);
  const ctx = contexto(db, empresaId, d);
  const nomeMe = ctx.me?.nome_fantasia || ctx.me?.nome || '';
  const cliRow = db.prepare('SELECT email, email_documentos, resp_email, resp_nome FROM clientes WHERE id=?').get(ctx.c.cliente_id);
  const para = cliRow.email_documentos || cliRow.resp_email || cliRow.email || '';
  const pedir = d.tipo !== 'proposta';
  const assunto = `${TIPOS_DOC[d.tipo]} nº ${ctx.numero} – ${nomeMe}`;
  const saudacao = cliRow.resp_nome ? `Olá, ${cliRow.resp_nome.split(' ')[0]}.` : 'Olá.';
  const corpo = [saudacao, '',
    d.tipo === 'proposta' ? `Segue em anexo a nossa proposta de serviços nº ${ctx.numero}. Se estiver de acordo, assine e devolva por este e-mail.`
      : d.tipo === 'contrato' ? `Segue em anexo o contrato de prestação de serviços nº ${ctx.numero} para a sua assinatura.`
        : `Segue em anexo a procuração nº ${ctx.numero} para a sua assinatura.`,
    '', INSTRUCOES_GOVBR, '', 'Qualquer dúvida, estamos à disposição.', nomeMe, [ctx.me?.telefone, ctx.me?.email].filter(Boolean).join(' · ')].join('\n');
  return { para, assunto, mensagem: corpo, pedir_assinatura: pedir, responder_para: ctx.me?.email || null, nome_remetente: nomeMe };
}

/**
 * Envia o PDF gerado por e-mail. Só muda o status se o provedor aceitar o envio. Registra data, destinatário e resultado.
 * enviarEmail é injetado (testes).
 */
export async function enviarPorEmail(db, empresaId, docId, usuarioId, b, { enviarEmail }) {
  const d = documentoDaConta(db, empresaId, docId);
  exigirCaptacao(db, empresaId, d.captacao_id, { aberta: true });
  if (!['gerado', 'enviado', 'aguardando_aceite', 'aguardando_assinatura'].includes(d.status)) throw erro(400, 'Gere o PDF antes de enviar.');
  if (b.confirmado !== true) throw erro(400, 'Confirme que conferiu o destinatário e a mensagem.');
  const para = String(b.para || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!para.length || para.length > 3 || !para.every((x) => EMAIL_RE.test(x))) throw erro(400, 'Destinatário inválido (até 3 e-mails, separados por vírgula).');
  const assunto = texto(b.assunto, 200); const mensagem = texto(b.mensagem, 8000);
  if (!assunto || !mensagem) throw erro(400, 'Preencha o assunto e a mensagem.');
  const { abs, nome } = arquivoDoDocumento(db, empresaId, docId);
  const ras = rascunhoEmail(db, empresaId, docId);
  try {
    await enviarEmail({ para: para.join(', '), assunto, texto: mensagem, anexos: [{ filename: nome, content: fs.readFileSync(abs), contentType: 'application/pdf' }],
      responderPara: ras.responder_para, nomeRemetente: ras.nome_remetente });
  } catch (e) {
    evento(db, d.captacao_id, d.id, { tipo: 'envio', destinatario: para.join(', '), resultado: 'falha', erro: String(e.message).slice(0, 300), descricao: `E-mail não enviado: ${assunto}` }, usuarioId);
    throw erro(e.semSmtp ? 503 : 502, `O e-mail NÃO foi enviado: ${e.message}`);
  }
  evento(db, d.captacao_id, d.id, { tipo: 'envio', destinatario: para.join(', '), resultado: 'ok', descricao: `E-mail enviado com o PDF (versão ${d.versao}): ${assunto}` }, usuarioId);
  const para2 = statusAposEnvio(d, !!b.pedir_assinatura);
  if (ORDEM_DOC[para2] >= ORDEM_DOC[d.status] && para2 !== d.status) mudarStatusDoc(db, d, para2, usuarioId, null, { enviado_em: new Date().toISOString() });
  else { db.prepare("UPDATE captacao_documentos SET enviado_em=? WHERE id=?").run(new Date().toISOString(), d.id); recalcular(db, d.captacao_id); }
  return { status: para2 };
}

/** O usuário enviou por outro meio (WhatsApp, em mãos): fica registrado como informado por ele. */
export function registrarEnvioManual(db, empresaId, docId, usuarioId, b) {
  const d = documentoDaConta(db, empresaId, docId);
  exigirCaptacao(db, empresaId, d.captacao_id, { aberta: true });
  if (!['gerado', 'enviado', 'aguardando_aceite', 'aguardando_assinatura'].includes(d.status)) throw erro(400, 'Gere o PDF antes de registrar o envio.');
  const meio = texto(b.meio, 60);
  if (!meio) throw erro(400, 'Informe por onde enviou (ex.: WhatsApp).');
  evento(db, d.captacao_id, d.id, { tipo: 'envio_manual', destinatario: texto(b.destinatario, 150), resultado: 'ok', descricao: `Envio por ${meio} informado pelo usuário (o sistema não enviou)` }, usuarioId);
  const para = statusAposEnvio(d, !!b.pedir_assinatura);
  if (ORDEM_DOC[para] >= ORDEM_DOC[d.status] && para !== d.status) mudarStatusDoc(db, d, para, usuarioId, null, { enviado_em: new Date().toISOString() });
  return { status: para };
}

/**
 * Anexa o PDF assinado devolvido pelo cliente. Guarda o arquivo original sem alterar (com SHA-256).
 * Verificações simples, sem validade jurídica: se há assinatura digital no arquivo (/ByteRange) e se ele contém
 * byte a byte o PDF gerado pelo sistema (o assinador do gov.br acrescenta a assinatura no fim do arquivo).
 * Sem assinatura digital, só aceita com a confirmação de que é uma cópia assinada à mão e digitalizada.
 */
export function anexarAssinado(db, empresaId, docId, usuarioId, arquivo, { manuscrita = false } = {}) {
  const d = documentoDaConta(db, empresaId, docId);
  exigirCaptacao(db, empresaId, d.captacao_id, { aberta: true });
  if (!['gerado', 'enviado', 'aguardando_aceite', 'aguardando_assinatura', 'assinado'].includes(d.status)) throw erro(400, 'Gere e envie o documento antes de anexar o assinado.');
  const buf = arquivo?.buffer;
  if (!buf?.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw erro(400, 'O arquivo assinado precisa ser um PDF.');
  const latin = buf.toString('latin1');
  const assinaturaDetectada = /\/ByteRange\s*\[/.test(latin) && /\/(Sig|DocTimeStamp)\b|adbe\.pkcs7|ETSI\.CAdES/.test(latin);
  if (!assinaturaDetectada && !manuscrita) {
    throw erro(422, 'Não encontramos assinatura digital neste PDF. Se for uma cópia assinada à mão e digitalizada, confirme essa opção; se foi assinado no gov.br, confira se enviou o arquivo baixado DEPOIS de assinar.', { sem_assinatura: true });
  }
  let contemOriginal = null;
  try { const { abs } = arquivoDoDocumento(db, empresaId, docId); const orig = fs.readFileSync(abs); contemOriginal = buf.length >= orig.length && buf.subarray(0, orig.length).equals(orig) ? 1 : 0; } catch { contemOriginal = null; }
  const caminho = gravarArquivo(d.captacao_id, buf);
  db.prepare(`INSERT INTO captacao_arquivos (documento_id, tipo, versao, caminho, nome, tamanho, sha256, assinatura_detectada, contem_original, criado_por)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(d.id, 'assinado', d.versao, caminho, String(arquivo.originalname || nomeArquivo(d, '-assinado')).slice(0, 150), buf.length, sha256(buf),
    assinaturaDetectada ? 1 : 0, contemOriginal, usuarioId);
  const desc = `Arquivo assinado anexado (${assinaturaDetectada ? 'assinatura digital encontrada no arquivo' : 'cópia assinada à mão, digitalizada'}${contemOriginal === 1 ? '; contém o PDF gerado pelo sistema' : contemOriginal === 0 ? '; não foi possível confirmar que é o mesmo PDF gerado' : ''})`;
  evento(db, d.captacao_id, d.id, { tipo: 'arquivo', descricao: desc }, usuarioId);
  if (d.status !== 'assinado') mudarStatusDoc(db, d, 'assinado', usuarioId, null, { assinado_em: new Date().toISOString() });
  return { assinatura_detectada: assinaturaDetectada, contem_original: contemOriginal };
}

export function cancelarDocumento(db, empresaId, docId, usuarioId) {
  const d = documentoDaConta(db, empresaId, docId);
  exigirCaptacao(db, empresaId, d.captacao_id, { aberta: true });
  if (d.status === 'assinado') throw erro(400, 'Documento assinado não pode ser cancelado aqui (o arquivo assinado fica guardado).');
  if (d.status === 'cancelado') return;
  mudarStatusDoc(db, d, 'cancelado', usuarioId, null, { cancelado_em: new Date().toISOString() });
}

/** Captações e documentos de uma empresa assessorada (tela da empresa). */
export function historicoDoCliente(db, empresaId, clienteId) {
  return listarCaptacoes(db, empresaId, { cliente_id: clienteId });
}
export { fmtDoc };
