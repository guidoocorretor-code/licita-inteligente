// Empresas assessoradas (clientes) e o controle de validade das certidões delas.
// Os PDFs ficam no volume (STORAGE_DIR/clientes/<id>/), nunca no banco nem no repositório.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

export const TIPOS_DOCUMENTO = {
  sicaf: 'SICAF (cadastro)',
  federal: 'Receita Federal e Dívida Ativa da União',
  fgts: 'FGTS (CRF)',
  trabalhista: 'Débitos trabalhistas (CNDT)',
  estadual: 'Receita Estadual',
  municipal: 'Receita Municipal',
  falencia: 'Falência e recuperação judicial',
  qualificacao: 'Qualificação econômico-financeira',
  outro: 'Outro documento',
};
export const PORTES = ['MEI', 'ME', 'EPP', 'Demais'];
// Avisos de vencimento: 30, 15 e 7 dias antes, e no dia em que vence
export const MARCOS_AVISO = [30, 15, 7, 0];

const erro400 = (msg) => Object.assign(new Error(msg), { status: 400 });
const texto = (v, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const dataOk = (v) => (v == null || v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);

/** CNPJ: só dígitos e dígitos verificadores válidos (Receita Federal, módulo 11). */
export function validarCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return null;
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = base.split('').reduce((s, n, i) => s + Number(n) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]) ? d : null;
}

// CPF: 11 números e dígitos verificadores (empresa assessorada pessoa física)
function cpfValido(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (n) => { const s = d.slice(0, n).split('').reduce((a, x, i) => a + Number(x) * (n + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}

function dadosCliente(b) {
  // Pessoa física guarda o CPF no mesmo campo do CNPJ (cadastro central único, sem duplicar por documento)
  const pf = b.tipo_pessoa === 'PF';
  const cnpj = pf ? cpfValido(b.cnpj) : validarCnpj(b.cnpj);
  if (!cnpj) throw erro400(pf ? 'CPF inválido. Confira os 11 números.' : 'CNPJ inválido. Confira os 14 números.');
  const razao = texto(b.razao_social, 200);
  if (!razao) throw erro400(pf ? 'Informe o nome completo.' : 'Informe a razão social.');
  if (b.porte && !PORTES.includes(b.porte)) throw erro400('Porte inválido.');
  for (const k of ['email', 'resp_email', 'fin_email', 'email_documentos']) {
    if (b[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b[k])) throw erro400('E-mail inválido.');
  }
  return {
    tipo_pessoa: pf ? 'PF' : 'PJ', email_documentos: texto(b.email_documentos, 150), obs_comerciais: texto(b.obs_comerciais, 2000),
    cnpj, razao_social: razao, nome_fantasia: texto(b.nome_fantasia), porte: b.porte || null,
    uf: texto(b.uf, 2)?.toUpperCase() || null, municipio: texto(b.municipio, 100), email: texto(b.email, 150), telefone: texto(b.telefone, 30),
    resp_nome: texto(b.resp_nome, 150), resp_cargo: texto(b.resp_cargo, 80), resp_email: texto(b.resp_email, 150), resp_telefone: texto(b.resp_telefone, 30),
    observacoes: texto(b.observacoes, 2000),
    // Usados no cabeçalho e no rodapé da proposta de preços
    endereco: texto(b.endereco, 300), cep: texto(b.cep, 10), resp_cpf: texto(b.resp_cpf, 14),
    banco: texto(b.banco, 80), agencia: texto(b.agencia, 20), conta: texto(b.conta, 30), pix: texto(b.pix, 120),
    fin_nome: texto(b.fin_nome, 150), fin_cargo: texto(b.fin_cargo, 80), fin_email: texto(b.fin_email, 150), fin_telefone: texto(b.fin_telefone, 30),
    socios_json: sociosJson(b),
    cnaes_json: cnaesJson(b),
    palavras_chave: palavrasChave(b.palavras_chave),
  };
}

export const ASSINATURAS = { isolada: 'Assina sozinho', conjunta: 'Assina em conjunto' };
// Sócios digitados (lista) ou já gravados (texto JSON). Nome obrigatório; CPF com 11 números quando informado;
// forma de assinatura só "isolada" ou "conjunta" (vem do contrato social; a Receita não informa).
function sociosJson(b) {
  if (!Array.isArray(b.socios)) return b.socios_json ?? null;
  const ok = [];
  for (const x of b.socios.slice(0, 30)) {
    const nome = texto(x?.nome, 150);
    if (!nome) continue;
    const cpf = String(x?.cpf ?? '').replace(/\D/g, '');
    if (cpf && cpf.length !== 11) throw erro400(`CPF do sócio ${nome}: informe os 11 números.`);
    const email = texto(x?.email, 150);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro400(`E-mail do sócio ${nome} inválido.`);
    ok.push({ nome, cpf: cpf || null, qualificacao: texto(x?.qualificacao, 80), email, telefone: texto(x?.telefone, 30),
      administrador: !!x?.administrador, assinatura: ASSINATURAS[x?.assinatura] ? x.assinatura : null });
  }
  return ok.length ? JSON.stringify(ok) : null;
}

// CNAEs vindos da consulta à Receita (lista) ou já gravados (texto JSON)
function cnaesJson(b) {
  const lista = Array.isArray(b.cnaes) ? b.cnaes : null;
  if (!lista) return b.cnaes_json ?? null;
  const ok = lista.slice(0, 100).map((c) => ({ codigo: String(c?.codigo ?? '').slice(0, 12), descricao: String(c?.descricao ?? '').slice(0, 300), principal: !!c?.principal }))
    .filter((c) => /^\d{4}-\d\/\d{2}$/.test(c.codigo) && c.descricao);
  return ok.length ? JSON.stringify(ok) : null;
}
const palavrasChave = (v) => {
  const l = String(v ?? '').split(/[;,\n]+/).map((x) => x.trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean);
  return l.length ? [...new Set(l)].slice(0, 30).join('; ') : null;
};

export function criarCliente(db, empresaId, b) {
  const d = dadosCliente(b);
  if (db.prepare('SELECT 1 FROM clientes WHERE empresa_id=? AND cnpj=?').get(empresaId, d.cnpj)) throw erro400('Esta empresa já está cadastrada.');
  const cols = Object.keys(d);
  const out = db.prepare(`INSERT INTO clientes (empresa_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(empresaId, ...Object.values(d));
  return Number(out.lastInsertRowid);
}

export function atualizarCliente(db, empresaId, id, b) {
  const atual = db.prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=?').get(id, empresaId);
  if (!atual) return false;
  const d = dadosCliente({ ...atual, ...b });
  const outro = db.prepare('SELECT id FROM clientes WHERE empresa_id=? AND cnpj=? AND id<>?').get(empresaId, d.cnpj, id);
  if (outro) throw erro400('Já existe outra empresa com este CNPJ.');
  const ativo = b.ativo === undefined ? atual.ativo : b.ativo ? 1 : 0;
  db.prepare(`UPDATE clientes SET ${Object.keys(d).map((k) => `${k}=?`).join(', ')}, ativo=?, atualizado_em=datetime('now') WHERE id=?`)
    .run(...Object.values(d), ativo, id);
  return true;
}

/** Situação de uma validade em relação a hoje (AAAA-MM-DD). */
export function situacaoValidade(validade, hoje) {
  if (!validade) return { situacao: 'sem_validade', dias: null };
  const dias = Math.round((Date.parse(validade) - Date.parse(hoje)) / 86400000);
  const situacao = dias < 0 ? 'vencido' : dias <= 7 ? 'vence_7' : dias <= 15 ? 'vence_15' : dias <= 30 ? 'vence_30' : 'em_dia';
  return { situacao, dias };
}

const comSituacao = (hoje) => (d) => ({ ...d, tipo_nome: TIPOS_DOCUMENTO[d.tipo] || d.tipo, ...situacaoValidade(d.validade, hoje), arquivo_caminho: undefined, tem_arquivo: !!d.arquivo_caminho });

/** Documentos com a situação calculada. clienteId null = de todas as empresas da conta. */
export function listarDocumentos(db, empresaId, { clienteId = null, hoje }) {
  return db.prepare(`SELECT d.*, c.razao_social, c.nome_fantasia FROM cliente_documentos d JOIN clientes c ON c.id = d.cliente_id
    WHERE c.empresa_id = ? AND (? IS NULL OR c.id = ?) AND c.ativo = 1
    ORDER BY CASE WHEN d.validade IS NULL THEN 1 ELSE 0 END, d.validade, d.id`).all(empresaId, clienteId, clienteId).map(comSituacao(hoje));
}

/** Clientes da conta com o resumo das certidões (vencidas e vencendo em até 30 dias). */
export function listarClientes(db, empresaId, hoje) {
  const docs = listarDocumentos(db, empresaId, { hoje });
  return db.prepare('SELECT * FROM clientes WHERE empresa_id=? ORDER BY ativo DESC, COALESCE(nome_fantasia, razao_social)').all(empresaId).map((c) => {
    const meus = docs.filter((d) => d.cliente_id === c.id);
    return { ...c, documentos: meus.length, vencidos: meus.filter((d) => d.situacao === 'vencido').length,
      vencendo: meus.filter((d) => ['vence_7', 'vence_15', 'vence_30'].includes(d.situacao)).length,
      proximo_vencimento: meus.find((d) => d.dias != null && d.dias >= 0) || null };
  });
}

const dirCliente = (clienteId) => path.join(config.storageDir, 'clientes', String(clienteId));

/** Guarda um PDF enviado. Confere a assinatura do arquivo (%PDF-), não só a extensão. */
export function salvarPdf(clienteId, arquivo) {
  if (!arquivo) return null;
  if (!arquivo.buffer?.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw erro400('O arquivo precisa ser um PDF.');
  const dir = dirCliente(clienteId);
  fs.mkdirSync(dir, { recursive: true });
  const nome = `${crypto.randomBytes(12).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(dir, nome), arquivo.buffer);
  return { arquivo_caminho: path.join('clientes', String(clienteId), nome), arquivo_nome: String(arquivo.originalname || 'documento.pdf').slice(0, 150), arquivo_tamanho: arquivo.size };
}

export const caminhoArquivo = (relativo) => {
  const abs = path.resolve(config.storageDir, relativo);
  return abs.startsWith(path.resolve(config.storageDir) + path.sep) ? abs : null;
};

/**
 * Cadastra um ou mais documentos que compartilham o mesmo PDF (ex.: o SICAF traz as validades
 * da Receita Federal, FGTS, CNDT, Estadual e Municipal). `substitui`: ids que a renovação substitui.
 */
export function adicionarDocumentos(db, clienteId, usuarioId, itens, arquivo, substitui = []) {
  if (!Array.isArray(itens) || !itens.length) throw erro400('Informe ao menos um documento.');
  const limpos = itens.map((i) => {
    if (!TIPOS_DOCUMENTO[i.tipo]) throw erro400('Tipo de documento inválido.');
    const validade = dataOk(i.validade); const emissao = dataOk(i.emissao);
    if (validade === undefined || emissao === undefined) throw erro400('Data inválida.');
    return { tipo: i.tipo, descricao: texto(i.descricao), numero: texto(i.numero, 80), emissao, validade };
  });
  const arq = salvarPdf(clienteId, arquivo) || {};
  const ins = db.prepare(`INSERT INTO cliente_documentos (cliente_id, tipo, descricao, numero, emissao, validade, arquivo_caminho, arquivo_nome, arquivo_tamanho, criado_por)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const ids = limpos.map((d) => Number(ins.run(clienteId, d.tipo, d.descricao, d.numero, d.emissao, d.validade,
    arq.arquivo_caminho ?? null, arq.arquivo_nome ?? null, arq.arquivo_tamanho ?? null, usuarioId).lastInsertRowid));
  for (const id of substitui) excluirDocumento(db, clienteId, Number(id));
  return ids;
}

export function excluirDocumento(db, clienteId, id) {
  const d = db.prepare('SELECT * FROM cliente_documentos WHERE id=? AND cliente_id=?').get(id, clienteId);
  if (!d) return false;
  db.prepare('DELETE FROM cliente_documentos WHERE id=?').run(id);
  // O PDF só é apagado quando nenhum outro documento usa o mesmo arquivo
  if (d.arquivo_caminho && !db.prepare('SELECT 1 FROM cliente_documentos WHERE arquivo_caminho=?').get(d.arquivo_caminho)) {
    const abs = caminhoArquivo(d.arquivo_caminho);
    if (abs) fs.rmSync(abs, { force: true });
  }
  return true;
}

export function excluirCliente(db, empresaId, id) {
  const c = db.prepare('SELECT id FROM clientes WHERE id=? AND empresa_id=?').get(id, empresaId);
  if (!c) return false;
  // Captações guardam propostas, contratos e procurações emitidos: não somem junto com o cadastro
  if (db.prepare('SELECT 1 FROM captacoes WHERE cliente_id=?').get(id)) throw erro400('Esta empresa tem captações (propostas, contratos ou procurações). Arquive a empresa em vez de excluir.');
  // Favoritos, Kanban e pesquisas não são apagados: voltam para "sem empresa"
  for (const t of ['favoritos', 'oportunidades', 'pesquisas_salvas', 'notificacoes']) {
    db.prepare(`UPDATE OR IGNORE ${t} SET cliente_id=0 WHERE cliente_id=? AND empresa_id=?`).run(id, empresaId);
    db.prepare(`DELETE FROM ${t} WHERE cliente_id=? AND empresa_id=?`).run(id, empresaId); // repetidos que já existiam sem empresa
  }
  db.prepare('DELETE FROM clientes WHERE id=?').run(id);
  fs.rmSync(dirCliente(id), { recursive: true, force: true });
  return true;
}

/**
 * Avisos de vencimento para todos os usuários ativos da conta: 30, 15 e 7 dias antes e no vencimento.
 * Cada aviso sai uma vez só (alertas_gerados). `hoje` = AAAA-MM-DD em Brasília.
 */
export function avaliarAlertasVencimentos(db, hoje) {
  const docs = db.prepare(`SELECT d.id, d.tipo, d.validade, c.id cliente_id, c.empresa_id, COALESCE(c.nome_fantasia, c.razao_social) nome
    FROM cliente_documentos d JOIN clientes c ON c.id = d.cliente_id WHERE c.ativo = 1 AND d.validade IS NOT NULL`).all();
  const usuarios = db.prepare('SELECT id FROM usuarios WHERE empresa_id=? AND ativo=1');
  const jaGerado = db.prepare('SELECT 1 FROM alertas_gerados WHERE usuario_id = ? AND chave = ?');
  const marcar = db.prepare('INSERT OR IGNORE INTO alertas_gerados (usuario_id, chave) VALUES (?, ?)');
  const notificar = db.prepare("INSERT INTO notificacoes (empresa_id, usuario_id, tipo, titulo, mensagem, cliente_id) VALUES (?,?,'vencimento',?,?,?)");
  let geradas = 0;
  for (const d of docs) {
    const { dias } = situacaoValidade(d.validade, hoje);
    const marco = MARCOS_AVISO.filter((m) => dias <= m).at(-1);
    if (marco === undefined || dias < -1) continue; // longe de vencer, ou vencido há mais de 1 dia (avisado antes)
    const quando = d.validade.split('-').reverse().join('/');
    const nomeDoc = TIPOS_DOCUMENTO[d.tipo] || d.tipo;
    const titulo = dias < 0 ? `${nomeDoc} VENCEU (${quando})` : dias === 0 ? `${nomeDoc} vence HOJE` : `${nomeDoc} vence em ${dias} dia(s) (${quando})`;
    const chave = `venc:${d.id}:${d.validade}:${dias < 0 ? 'vencido' : marco}`;
    for (const u of usuarios.all(d.empresa_id)) {
      if (jaGerado.get(u.id, chave)) continue;
      marcar.run(u.id, chave);
      notificar.run(d.empresa_id, u.id, titulo, `${d.nome}: renove antes de participar de licitações.`, d.cliente_id);
      geradas++;
    }
  }
  return geradas;
}
