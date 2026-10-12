// Jornais salvos (perfis): estado, cidades, nicho/produtos, itens, modalidade, valor, portais, fase e encerramento.
// Todo dia (a partir das 7h de Brasília) cada jornal ativo ganha uma edição com as licitações NOVAS no sistema
// que batem com o perfil; a primeira edição traz todas as abertas que batem. Aviso no sino e no e-mail de alertas.
import { montarFiltro, expressoesRamo, termos, fts } from './busca.js';
import { SISTEMAS } from './sistemas.js';
import { semAcento } from '../lib/texto.js';

export const MODALIDADES_JORNAL = {
  dispensa: { nome: 'Dispensa', ids: [8] },
  pregao: { nome: 'Pregão', ids: [6, 7, 18, 19] },
  concorrencia: { nome: 'Concorrência', ids: [4, 5, 16, 17] },
};
export const FASES_JORNAL = { aberta: 'Recebendo propostas', aguardando_propostas: 'Propostas ainda vão abrir' };
export const MAX_EDICAO = 200;
export const HORA_EDICAO = 7; // edição do dia a partir das 7h (Brasília)

const UFS = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']);
const falha = (status, msg) => Object.assign(new Error(msg), { status });
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
const num = (v, nome) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw falha(400, `${nome}: valor inválido.`);
  return n;
};

export function migrarJornalPerfis(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS jornal_perfis (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL, -- empresa assessorada para quem é o jornal (opcional)
    nome TEXT NOT NULL,
    filtros TEXT NOT NULL,            -- JSON (ver normalizarFiltros)
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  conn.exec(`CREATE TABLE IF NOT EXISTS jornal_edicoes (
    id INTEGER PRIMARY KEY,
    perfil_id INTEGER NOT NULL REFERENCES jornal_perfis(id) ON DELETE CASCADE,
    data TEXT NOT NULL,               -- aaaa-mm-dd (Brasília)
    licitacoes TEXT NOT NULL,         -- JSON [ids]
    total INTEGER NOT NULL,           -- quantas bateram (pode passar do limite gravado)
    gerado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (perfil_id, data)
  )`);
  const cols = conn.prepare('PRAGMA table_info(notificacoes)').all().map((c) => c.name);
  if (!cols.includes('link')) conn.exec('ALTER TABLE notificacoes ADD COLUMN link TEXT'); // destino do alerta quando não é uma licitação
}

/** Valida e normaliza o que veio do formulário. */
export function normalizarFiltros(b = {}) {
  const enc = b.encerramento || {};
  const modo = ['qualquer', 'ate', 'dia'].includes(enc.modo) ? enc.modo : 'qualquer';
  const data = /^\d{4}-\d{2}-\d{2}$/.test(enc.data || '') ? enc.data : null;
  const hora = /^\d{2}:\d{2}$/.test(enc.hora || '') ? enc.hora : null;
  if (modo !== 'qualquer' && !data) throw falha(400, 'Encerramento: escolha a data.');
  const f = {
    ufs: arr(b.ufs).map((u) => u.toUpperCase()).filter((u) => UFS.has(u)),
    cidades: arr(b.cidades).slice(0, 50),
    segmentos: arr(b.segmentos),
    produtos: String(b.produtos || '').trim().slice(0, 500),
    itens: String(b.itens || '').trim().slice(0, 500),
    modalidades: arr(b.modalidades).filter((m) => MODALIDADES_JORNAL[m]),
    valor_min: num(b.valor_min, 'Valor mínimo'),
    valor_max: num(b.valor_max, 'Valor máximo'),
    sistemas: arr(b.sistemas).filter((s) => SISTEMAS[s]),
    fases: arr(b.fases).filter((s) => FASES_JORNAL[s]),
    encerramento: { modo, data: modo === 'qualquer' ? null : data, hora: modo === 'qualquer' ? null : hora },
  };
  if (!f.fases.length) f.fases = Object.keys(FASES_JORNAL);
  if (f.valor_min != null && f.valor_max != null && f.valor_min > f.valor_max) throw falha(400, 'O valor mínimo é maior que o máximo.');
  if (!f.ufs.length && !f.cidades.length && !f.segmentos.length && !f.produtos && !f.itens) {
    throw falha(400, 'Escolha pelo menos o estado, a cidade, o nicho, os produtos ou os itens. Sem isso o jornal traria o Brasil inteiro.');
  }
  return f;
}

/**
 * WHERE das licitações que batem com o perfil. `desde` (datetime UTC) = só as que entraram no sistema depois.
 * "Onde/como" (estado, cidade, modalidade, valor, portal, fase, encerramento): todos precisam bater.
 * "O que" (nicho, produtos, itens): basta bater UM deles. Somar campos de "o que" amplia o jornal, não estreita
 * (antes era tudo junto e um jornal de obras com nicho + produtos + itens zerava).
 */
export function filtroDoPerfil(f, { agora, desde = null } = {}) {
  const base = {
    uf: f.ufs, status: f.fases,
    modalidade: f.modalidades.flatMap((m) => MODALIDADES_JORNAL[m].ids),
    sistema: f.sistemas, valor_min: f.valor_min ?? undefined, valor_max: f.valor_max ?? undefined,
    criado_apos: desde || undefined,
  };
  const { where, params } = montarFiltro(base, agora);
  const w = []; const p = [...params];
  // Cidade: sem acento e sem maiúsculas ("vitoria" acha "Vitória")
  if (f.cidades.length) { w.push(`(${f.cidades.map(() => 'sem_acento(l.municipio) LIKE ?').join(' OR ')})`); p.push(...f.cidades.map((c) => `%${semAcento(c)}%`)); }
  const oque = []; const po = [];
  if (f.segmentos.length) { oque.push(`l.segmento IN (${f.segmentos.map(() => '?').join(',')})`); po.push(...f.segmentos); }
  if (f.produtos) {
    const r = montarFiltro({ ramo: f.produtos }, agora);
    if (r.where) { oque.push(r.where.replace(/^WHERE /, '')); po.push(...r.params); }
  }
  // Itens: qualquer uma das expressões (";"), todas as palavras dela na descrição de um mesmo item
  const itens = String(f.itens || '').split(/[;\n]+/).map((x) => termos(x)).filter((x) => x.length).slice(0, 30);
  if (itens.length) {
    oque.push('l.id IN (SELECT licitacao_id FROM licitacao_itens WHERE id IN (SELECT rowid FROM itens_fts WHERE itens_fts MATCH ?))');
    po.push(itens.map((ws) => `(${ws.map(fts).join(' AND ')})`).join(' OR '));
  }
  if (oque.length) { w.push(`(${oque.join(' OR ')})`); p.push(...po); }
  // Propostas ainda não encerradas, e o encerramento escolhido
  w.push('(l.data_encerramento_proposta IS NULL OR l.data_encerramento_proposta >= ?)'); p.push(agora);
  const e = f.encerramento || {};
  if (e.modo !== 'qualquer' && e.data) {
    const limite = `${e.data}T${e.hora || '23:59'}:59`;
    w.push('l.data_encerramento_proposta IS NOT NULL AND l.data_encerramento_proposta <= ?'); p.push(limite);
    if (e.modo === 'dia') { w.push('l.data_encerramento_proposta >= ?'); p.push(`${e.data}T00:00:00`); }
  }
  const extra = w.join(' AND ');
  return { where: where ? `${where} AND ${extra}` : `WHERE ${extra}`, params: p };
}

/**
 * Funil da prévia: quantas abertas sobram a cada filtro aplicado, na ordem do formulário.
 * Mostra qual filtro zerou o jornal (ex.: cidade digitada errado, modalidade que não serve para o nicho).
 */
export function funilDoPerfil(db, f, agora) {
  const vazio = { ufs: [], cidades: [], segmentos: [], produtos: '', itens: '', modalidades: [], valor_min: null, valor_max: null, sistemas: [], fases: [], encerramento: { modo: 'qualquer' } };
  const etapas = [
    ['Estado(s)', { ufs: f.ufs }, f.ufs.length],
    ['Cidade(s)', { cidades: f.cidades }, f.cidades.length],
    ['Nicho, produtos ou itens', { segmentos: f.segmentos, produtos: f.produtos, itens: f.itens }, f.segmentos.length || f.produtos || f.itens],
    ['Modalidade', { modalidades: f.modalidades }, f.modalidades.length],
    ['Valor do edital', { valor_min: f.valor_min, valor_max: f.valor_max }, f.valor_min != null || f.valor_max != null],
    ['Portais', { sistemas: f.sistemas }, f.sistemas.length],
    ['Fase', { fases: f.fases }, true],
    ['Encerramento', { encerramento: f.encerramento }, (f.encerramento || {}).modo !== 'qualquer'],
  ];
  const contar = (x) => { const { where, params } = filtroDoPerfil(x, { agora }); return db.prepare(`SELECT COUNT(*) n FROM licitacoes l ${where}`).get(...params).n; };
  let acc = { ...vazio };
  const out = [];
  for (const [nome, parte, ativo] of etapas) {
    if (!ativo) continue;
    acc = { ...acc, ...parte };
    out.push({ etapa: nome, total: contar(acc) });
  }
  return out;
}

const lerPerfil = (x) => (x ? { ...x, filtros: JSON.parse(x.filtros), ativo: !!x.ativo } : null);

export function perfilDaEmpresa(db, empresaId, id) {
  const x = db.prepare('SELECT * FROM jornal_perfis WHERE id=? AND empresa_id=?').get(id, empresaId);
  if (!x) throw falha(404, 'Jornal não encontrado.');
  return lerPerfil(x);
}

export function salvarPerfil(db, empresaId, usuarioId, b = {}, id = null) {
  const nome = String(b.nome || '').trim().slice(0, 120);
  if (nome.length < 3) throw falha(400, 'Dê um nome ao jornal (ex.: "INFOPEL · papelaria ES").');
  const filtros = normalizarFiltros(b.filtros || {});
  let cli = b.cliente_id ? Number(b.cliente_id) : null;
  if (cli && !db.prepare('SELECT 1 FROM clientes WHERE id=? AND empresa_id=?').get(cli, empresaId)) cli = null;
  const ativo = b.ativo === false ? 0 : 1;
  if (id) {
    const atual = perfilDaEmpresa(db, empresaId, id);
    db.prepare("UPDATE jornal_perfis SET nome=?, cliente_id=?, filtros=?, ativo=?, atualizado_em=datetime('now') WHERE id=?").run(nome, cli, JSON.stringify(filtros), ativo, id);
    // Filtro mudou: a edição de hoje é refeita com o perfil novo
    if (JSON.stringify(atual.filtros) !== JSON.stringify(filtros)) db.prepare('DELETE FROM jornal_edicoes WHERE perfil_id=? AND data=(SELECT MAX(data) FROM jornal_edicoes WHERE perfil_id=?)').run(id, id);
    return id;
  }
  return Number(db.prepare('INSERT INTO jornal_perfis (empresa_id, cliente_id, nome, filtros, ativo, criado_por) VALUES (?,?,?,?,?,?)')
    .run(empresaId, cli, nome, JSON.stringify(filtros), ativo, usuarioId).lastInsertRowid);
}

export function excluirPerfil(db, empresaId, id) {
  perfilDaEmpresa(db, empresaId, id);
  db.prepare('DELETE FROM jornal_perfis WHERE id=?').run(id);
}

/**
 * Gera a edição do dia de um perfil (idempotente por data). Primeira edição: todas as abertas que batem;
 * depois: só as que entraram no sistema desde a edição anterior.
 */
export function gerarEdicao(db, perfil, agora) {
  const hoje = agora.slice(0, 10);
  const existe = db.prepare('SELECT * FROM jornal_edicoes WHERE perfil_id=? AND data=?').get(perfil.id, hoje);
  const unica = existe && !db.prepare('SELECT 1 FROM jornal_edicoes WHERE perfil_id=? AND data<?').get(perfil.id, hoje);
  // Primeira edição que saiu vazia é refeita (ex.: perfil corrigido ou regra de filtro melhorada no mesmo dia)
  if (existe && unica && existe.total === 0) db.prepare('DELETE FROM jornal_edicoes WHERE id=?').run(existe.id);
  else if (existe) return { ...existe, nova: false };
  const anterior = db.prepare('SELECT gerado_em FROM jornal_edicoes WHERE perfil_id=? ORDER BY data DESC LIMIT 1').get(perfil.id);
  const { where, params } = filtroDoPerfil(perfil.filtros, { agora, desde: anterior?.gerado_em || null });
  const total = db.prepare(`SELECT COUNT(*) n FROM licitacoes l ${where}`).get(...params).n;
  const ids = db.prepare(`SELECT l.id FROM licitacoes l ${where} ORDER BY l.data_encerramento_proposta IS NULL, l.data_encerramento_proposta, l.id DESC LIMIT ?`)
    .all(...params, MAX_EDICAO).map((x) => x.id);
  // Momento da edição em UTC (mesmo formato de licitacoes.criado_em), a partir do horário de Brasília recebido
  const geradoEm = new Date(Date.parse(`${agora}Z`) + 3 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const id = db.prepare('INSERT INTO jornal_edicoes (perfil_id, data, licitacoes, total, gerado_em) VALUES (?,?,?,?,?)').run(perfil.id, hoje, JSON.stringify(ids), total, geradoEm).lastInsertRowid;
  return { ...db.prepare('SELECT * FROM jornal_edicoes WHERE id=?').get(id), nova: true, primeira: !anterior };
}

/** Agendador: a partir das 7h, a edição do dia de cada jornal ativo + aviso a quem criou (ou à equipe). */
export function gerarEdicoesDoDia(db, agora) {
  if (Number(agora.slice(11, 13)) < HORA_EDICAO) return 0;
  const perfis = db.prepare('SELECT * FROM jornal_perfis WHERE ativo=1').all().map(lerPerfil);
  const notificar = db.prepare("INSERT INTO notificacoes (empresa_id, usuario_id, cliente_id, tipo, titulo, mensagem, link) VALUES (?,?,?,'jornal_diario',?,?,?)");
  let geradas = 0;
  for (const p of perfis) {
    const ed = gerarEdicao(db, p, agora);
    if (!ed.nova) continue;
    geradas++;
    if (!ed.total) continue; // sem novidade: não incomoda
    const quem = p.criado_por && db.prepare('SELECT 1 FROM usuarios WHERE id=? AND ativo=1').get(p.criado_por)
      ? [p.criado_por] : db.prepare('SELECT id FROM usuarios WHERE empresa_id=? AND ativo=1').all(p.empresa_id).map((u) => u.id);
    const titulo = `Jornal "${p.nome}": ${ed.total} ${ed.primeira ? 'oportunidade(s) aberta(s)' : 'oportunidade(s) nova(s)'}`;
    const objs = db.prepare(`SELECT objeto FROM licitacoes WHERE id IN (${JSON.parse(ed.licitacoes).slice(0, 3).map(() => '?').join(',') || 'NULL'})`).all(...JSON.parse(ed.licitacoes).slice(0, 3));
    const msg = objs.map((o) => `• ${(o.objeto || '').slice(0, 110)}`).join('\n') + (ed.total > 3 ? `\n… e mais ${ed.total - 3}.` : '');
    for (const u of quem) notificar.run(p.empresa_id, u, p.cliente_id || 0, titulo, msg, `#/jornal?perfil=${p.id}&edicao=${ed.data}`);
  }
  return geradas;
}

export function listarPerfis(db, empresaId, clienteId = null) {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  return db.prepare(`SELECT p.*, COALESCE(c.nome_fantasia, c.razao_social) cliente_nome,
      (SELECT total FROM jornal_edicoes e WHERE e.perfil_id=p.id AND e.data=?) hoje_total,
      (SELECT MAX(data) FROM jornal_edicoes e WHERE e.perfil_id=p.id) ultima_edicao
    FROM jornal_perfis p LEFT JOIN clientes c ON c.id=p.cliente_id
    WHERE p.empresa_id=?${clienteId ? ' AND (p.cliente_id=? OR p.cliente_id IS NULL)' : ''} ORDER BY p.nome`)
    .all(hoje, empresaId, ...(clienteId ? [clienteId] : [])).map(lerPerfil);
}

export function edicoesDoPerfil(db, perfilId) {
  return db.prepare('SELECT data, total FROM jornal_edicoes WHERE perfil_id=? ORDER BY data DESC LIMIT 60').all(perfilId);
}

/** Ids para a tela: de uma edição (data) ou "todas" (todas as abertas que batem agora). */
export function idsDoPerfil(db, perfil, { edicao = null, agora }) {
  if (edicao && edicao !== 'todas') {
    const e = db.prepare('SELECT licitacoes, total FROM jornal_edicoes WHERE perfil_id=? AND data=?').get(perfil.id, edicao);
    return e ? { ids: JSON.parse(e.licitacoes), total: e.total } : { ids: [], total: 0 };
  }
  const { where, params } = filtroDoPerfil(perfil.filtros, { agora });
  const total = db.prepare(`SELECT COUNT(*) n FROM licitacoes l ${where}`).get(...params).n;
  const ids = db.prepare(`SELECT l.id FROM licitacoes l ${where} ORDER BY l.data_encerramento_proposta IS NULL, l.data_encerramento_proposta, l.id DESC LIMIT 1000`).all(...params).map((x) => x.id);
  return { ids, total };
}

/** Resumo legível do perfil ("ES · Vila Velha, Serra · Pregão, Dispensa · até R$ 80 mil…"). */
export function resumoFiltros(f) {
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const e = f.encerramento || {};
  const dataBr = (d) => d.split('-').reverse().join('/');
  return [
    f.ufs.length ? f.ufs.join(', ') : null,
    f.cidades.length ? f.cidades.join(', ') : null,
    f.segmentos.length ? f.segmentos.join(', ') : null,
    f.produtos ? `Produtos: ${f.produtos}` : null,
    f.itens ? `Itens: ${f.itens}` : null,
    f.modalidades.length ? f.modalidades.map((m) => MODALIDADES_JORNAL[m].nome).join(', ') : 'Todas as modalidades',
    f.valor_min != null || f.valor_max != null ? `Valor ${f.valor_min != null ? `de ${brl(f.valor_min)} ` : ''}${f.valor_max != null ? `até ${brl(f.valor_max)}` : ''}`.trim() : null,
    f.sistemas.length ? f.sistemas.map((s) => SISTEMAS[s]?.nome || s).join(', ') : null,
    f.fases.length === Object.keys(FASES_JORNAL).length ? null : f.fases.map((s) => FASES_JORNAL[s]).join(', '),
    e.modo === 'ate' ? `Encerra até ${dataBr(e.data)}${e.hora ? ` às ${e.hora}` : ''}` : e.modo === 'dia' ? `Encerra em ${dataBr(e.data)}${e.hora ? ` até ${e.hora}` : ''}` : null,
  ].filter(Boolean).join(' · ');
}
