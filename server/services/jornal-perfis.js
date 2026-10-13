// Jornais salvos (perfis): estado, cidades, nicho/produtos, itens, modalidade, valor, portais, fase e encerramento.
// Todo dia (a partir das 7h de Brasília) cada jornal ativo ganha uma edição com as licitações NOVAS no sistema
// que batem com o perfil; a primeira edição traz todas as abertas que batem. Aviso no sino e no e-mail de alertas.
import { montarFiltro, expressoesRamo, termos, fts, radical } from './busca.js';
import { SISTEMAS } from './sistemas.js';
import { semAcento } from '../lib/texto.js';
import { MUNICIPIOS_IBGE } from './municipios.js';

const NOMES_OFICIAIS = new Set(Object.values(MUNICIPIOS_IBGE).flat().map((c) => semAcento(c)));

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
    cidades: arr(b.cidades).slice(0, 1000),
    segmentos: arr(b.segmentos),
    produtos: String(b.produtos || '').trim().slice(0, 500),
    itens: String(b.itens || '').trim().slice(0, 500),
    excluir: String(b.excluir || '').trim().slice(0, 500),
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
// ---- Conferência no texto (sem depender do índice de busca) ----
// O índice FTS serve de pré-filtro rápido; quem decide se a licitação entra é a conferência abaixo, feita no
// texto real do objeto e dos itens. Em 13/10/2026 o jornal de alimentos trouxe "blocos estruturais" com o motivo
// "gêneros alimentícios no objeto", que o objeto não tem: o índice apontava para a linha errada.
const semAc = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const palavras = (t) => semAc(t).match(/[\p{L}\p{N}]+/gu) || [];
// Raiz sem gênero: "bovinas" acha "bovino", "suína" acha "suíno", "congelado" acha "congelada"
export const raiz = (w) => { const r = radical(w); return r.length >= 5 ? r.replace(/[ao]$/, '') : r; };
const ftsJ = (w) => `"${raiz(w)}"*`;
const bate = (tok, w) => tok.startsWith(raiz(w));
// Expressão no objeto: uma palavra em qualquer lugar; várias, todas perto umas das outras (como o NEAR(…, 3))
const noTexto = (toks, ws) => {
  if (ws.length === 1) return toks.some((t) => bate(t, ws[0]));
  const janela = ws.length + 3;
  for (let i = 0; i < toks.length; i++) {
    if (!ws.some((w) => bate(toks[i], w))) continue;
    const jan = toks.slice(i, i + janela);
    if (ws.every((w) => jan.some((t) => bate(t, w)))) return true;
  }
  return false;
};
// Expressão no item: a 1ª palavra ABRE a descrição (onde fica o produto) e as outras estão no mesmo item
// Expressão no item: uma palavra só precisa ABRIR a descrição (onde fica o produto: "pintura" não pega "armário com
// pintura epóxi"); várias palavras valem em qualquer lugar do item, perto umas das outras ("frango congelado" acha
// "PEITO DE FRANGO CONGELADO", que começa por "peito")
const noItem = (toks, ws) => (ws.length === 1 ? toks.length > 0 && bate(toks[0], ws[0]) : noTexto(toks, ws));
const exprObjetoJ = (ws) => (ws.length > 1 ? `NEAR(${ws.map(ftsJ).join(' ')}, 3)` : ftsJ(ws[0]));
const exprItemJ = (ws) => (ws.length > 1 ? `NEAR(${ws.map(ftsJ).join(' ')}, 3)` : `^${ftsJ(ws[0])}`);
const temOque = (f) => f.segmentos.length > 0 || !!f.produtos || !!f.itens;
const listaItens = (v) => String(v || '').split(/[;\n]+/).map((x) => termos(x)).filter((x) => x.length).slice(0, 30);

/**
 * Confere no texto real cada licitação: devolve Map id -> motivos (o que puxou ela para o jornal), sem as que
 * caem em "Excluir palavras" e sem as que nada do "o que" (nicho, produtos, itens) explica.
 */
export function conferirLicitacoes(db, f, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const produtos = expressoesRamo(f.produtos); const itens = listaItens(f.itens); const excl = expressoesRamo(f.excluir);
  for (let i = 0; i < ids.length; i += 500) {
    const lote = ids.slice(i, i + 500); const marcas = lote.map(() => '?').join(',');
    const lics = db.prepare(`SELECT id, objeto, segmento FROM licitacoes WHERE id IN (${marcas})`).all(...lote);
    const itensPor = new Map();
    if (produtos.length || itens.length) {
      for (const it of db.prepare(`SELECT licitacao_id, descricao FROM licitacao_itens WHERE licitacao_id IN (${marcas}) ORDER BY licitacao_id, numero_item`).all(...lote)) {
        if (!itensPor.has(it.licitacao_id)) itensPor.set(it.licitacao_id, []);
        itensPor.get(it.licitacao_id).push({ descricao: it.descricao, toks: palavras(it.descricao) });
      }
    }
    for (const l of lics) {
      const obj = palavras(l.objeto);
      if (excl.some((ws) => noTexto(obj, ws))) continue;
      const m = [];
      if (f.segmentos.includes(l.segmento)) m.push(`nicho ${l.segmento}`);
      const its = itensPor.get(l.id) || [];
      for (const ws of produtos) {
        if (m.length >= 3) break;
        if (noTexto(obj, ws)) { m.push(`produto "${ws.join(' ')}" no objeto`); continue; }
        const it = its.find((x) => noItem(x.toks, ws));
        if (it) m.push(`produto "${ws.join(' ')}" no item "${String(it.descricao).slice(0, 70)}"`);
      }
      for (const ws of itens) {
        if (m.length >= 3) break;
        const it = its.find((x) => noItem(x.toks, ws));
        if (it) m.push(`item "${ws.join(' ')}": "${String(it.descricao).slice(0, 70)}"`);
      }
      if (temOque(f) && !m.length) continue;
      out.set(l.id, m);
    }
  }
  return out;
}

/**
 * Itens de cada licitação com as palavras do jornal (produtos e itens do perfil), mesma regra da conferência:
 * Map id -> { itens: até 3 { numero_item, descricao }, total }. Sem produto/item no perfil, Map vazio.
 */
export function itensDoPerfil(db, f, ids) {
  const out = new Map();
  const exprs = [...expressoesRamo(f.produtos), ...listaItens(f.itens)];
  if (!ids.length || !exprs.length) return out;
  const marcas = ids.map(() => '?').join(',');
  for (const it of db.prepare(`SELECT licitacao_id, numero_item, descricao FROM licitacao_itens WHERE licitacao_id IN (${marcas}) ORDER BY licitacao_id, numero_item`).all(...ids)) {
    const toks = palavras(it.descricao);
    if (!exprs.some((ws) => noItem(toks, ws))) continue;
    const r = out.get(it.licitacao_id) || { itens: [], total: 0 };
    if (r.itens.length < 3) r.itens.push({ numero_item: it.numero_item, descricao: it.descricao });
    r.total++; out.set(it.licitacao_id, r);
  }
  return out;
}

/** Por que cada licitação está no jornal (lista da tela). Sem motivo = o texto não confirma. */
export function motivosDoPerfil(db, f, ids) {
  const c = conferirLicitacoes(db, f, ids);
  return new Map(ids.map((id) => [id, c.get(id) || []]));
}

/**
 * Quantas abertas do recorte do jornal (estado, cidade, modalidade, valor, fase) ainda não têm os itens baixados
 * do PNCP. Produto citado só no item (ex.: "carne bovina" dentro de "gêneros alimentícios") só aparece depois.
 */
export function pendentesDeItens(db, f, agora) {
  const recorte = { ...f, segmentos: [], produtos: '', itens: '', excluir: '' };
  const { where, params } = filtroDoPerfil(recorte, { agora });
  const r = db.prepare(`SELECT COUNT(*) total, SUM(l.detalhes_sincronizados_em IS NULL) sem_itens FROM licitacoes l ${where}`).get(...params);
  return { abertas: r.total || 0, sem_itens: r.sem_itens || 0 };
}

export const MAX_CANDIDATAS = 5000;
const ORDEM = 'ORDER BY l.data_encerramento_proposta IS NULL, l.data_encerramento_proposta, l.id DESC';
/** Ids que batem com o perfil: pré-filtro no banco + conferência no texto. */
export function idsQueBatem(db, f, { agora, desde = null, limite = MAX_CANDIDATAS } = {}) {
  const { where, params } = filtroDoPerfil(f, { agora, desde });
  const cand = db.prepare(`SELECT l.id FROM licitacoes l ${where} ${ORDEM} LIMIT ?`).all(...params, MAX_CANDIDATAS).map((x) => x.id);
  const ok = temOque(f) || f.excluir ? (() => { const c = conferirLicitacoes(db, f, cand); return cand.filter((id) => c.has(id)); })() : cand;
  return { ids: ok.slice(0, limite), total: ok.length };
}

export function filtroDoPerfil(f, { agora, desde = null } = {}) {
  const base = {
    uf: f.ufs, status: f.fases,
    modalidade: f.modalidades.flatMap((m) => MODALIDADES_JORNAL[m].ids),
    sistema: f.sistemas, valor_min: f.valor_min ?? undefined, valor_max: f.valor_max ?? undefined,
  };
  const { where, params } = montarFiltro(base, agora);
  const w = []; const p = [...params];
  // Edição do dia: as que entraram no sistema depois da edição anterior OU cujos itens chegaram do PNCP depois
  // dela (os itens são baixados aos poucos; sem isso, "carne bovina" só no item nunca entraria no jornal)
  if (desde) { w.push('(l.criado_em > ? OR l.detalhes_sincronizados_em > ?)'); p.push(desde, desde); }
  // Cidade: sem acento e sem maiúsculas ("vitoria" acha "Vitória")
  // Nome oficial do IBGE: igual (assim "Serra" não pega "Serra do Salitre"); texto antigo digitado à mão: "contém"
  if (f.cidades.length) {
    const exatas = f.cidades.filter((c) => NOMES_OFICIAIS.has(semAcento(c).trim())); const soltas = f.cidades.filter((c) => !exatas.includes(c));
    const partes = [];
    if (exatas.length) { partes.push(`sem_acento(l.municipio) IN (${exatas.map(() => '?').join(',')})`); p.push(...exatas.map((c) => semAcento(c).trim())); }
    for (const c of soltas) { partes.push('sem_acento(l.municipio) LIKE ?'); p.push(`%${semAcento(c).trim()}%`); }
    w.push(`(${partes.join(' OR ')})`);
  }
  // Excluir palavras: aplicado na conferência do texto (conferirLicitacoes), só no objeto.
  const oque = []; const po = [];
  if (f.segmentos.length) { oque.push(`l.segmento IN (${f.segmentos.map(() => '?').join(',')})`); po.push(...f.segmentos); }
  // Produtos: no objeto ou no item (mesma regra da conferência no texto)
  const produtos = expressoesRamo(f.produtos);
  if (produtos.length) {
    oque.push(`(l.id IN (SELECT rowid FROM licitacoes_fts WHERE licitacoes_fts MATCH ?)
      OR l.id IN (SELECT licitacao_id FROM licitacao_itens WHERE id IN (SELECT rowid FROM itens_fts WHERE itens_fts MATCH ?)))`);
    po.push(`objeto : (${produtos.map(exprObjetoJ).join(' OR ')})`, produtos.map((ws) => `(${exprItemJ(ws)})`).join(' OR '));
  }
  // Itens: qualquer uma das expressões (";"), todas as palavras dela no mesmo item, e a 1ª palavra ABRINDO a
  // descrição (onde fica o produto). Sem isso "pintura" trazia "Armário de aço com pintura epóxi".
  const itens = String(f.itens || '').split(/[;\n]+/).map((x) => termos(x)).filter((x) => x.length).slice(0, 30);
  if (itens.length) {
    oque.push('l.id IN (SELECT licitacao_id FROM licitacao_itens WHERE id IN (SELECT rowid FROM itens_fts WHERE itens_fts MATCH ?))');
    po.push(itens.map((ws) => `(${exprItemJ(ws)})`).join(' OR '));
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
  const vazio = { ufs: [], cidades: [], segmentos: [], produtos: '', itens: '', excluir: '', modalidades: [], valor_min: null, valor_max: null, sistemas: [], fases: [], encerramento: { modo: 'qualquer' } };
  const etapas = [
    ['Estado(s)', { ufs: f.ufs }, f.ufs.length],
    ['Cidade(s)', { cidades: f.cidades }, f.cidades.length],
    ['Nicho, produtos ou itens', { segmentos: f.segmentos, produtos: f.produtos, itens: f.itens }, f.segmentos.length || f.produtos || f.itens],
    ['Palavras excluídas', { excluir: f.excluir }, !!f.excluir],
    ['Modalidade', { modalidades: f.modalidades }, f.modalidades.length],
    ['Valor do edital', { valor_min: f.valor_min, valor_max: f.valor_max }, f.valor_min != null || f.valor_max != null],
    ['Portais', { sistemas: f.sistemas }, f.sistemas.length],
    ['Fase', { fases: f.fases }, true],
    ['Encerramento', { encerramento: f.encerramento }, (f.encerramento || {}).modo !== 'qualquer'],
  ];
  const contar = (x) => idsQueBatem(db, x, { agora }).total;
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
    // Salvou: a edição de hoje é refeita (perfil novo ou regra de filtro melhorada desde a geração)
    if (atual) db.prepare('DELETE FROM jornal_edicoes WHERE perfil_id=? AND data=?').run(id, new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10));
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
  const r = idsQueBatem(db, perfil.filtros, { agora, desde: anterior?.gerado_em || null, limite: MAX_CANDIDATAS });
  // Não repete o que já saiu em edição anterior deste jornal
  const jaSaiu = new Set(anterior ? db.prepare(`SELECT DISTINCT j.value id FROM jornal_edicoes e, json_each(e.licitacoes) j
    WHERE e.perfil_id=? AND e.data<?`).all(perfil.id, hoje).map((x) => x.id) : []);
  const novas = r.ids.filter((id) => !jaSaiu.has(id));
  const ids = novas.slice(0, MAX_EDICAO); const total = novas.length;
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
  return idsQueBatem(db, perfil.filtros, { agora, limite: 1000 });
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
    f.excluir ? `Sem: ${f.excluir}` : null,
    f.modalidades.length ? f.modalidades.map((m) => MODALIDADES_JORNAL[m].nome).join(', ') : 'Todas as modalidades',
    f.valor_min != null || f.valor_max != null ? `Valor ${f.valor_min != null ? `de ${brl(f.valor_min)} ` : ''}${f.valor_max != null ? `até ${brl(f.valor_max)}` : ''}`.trim() : null,
    f.sistemas.length ? f.sistemas.map((s) => SISTEMAS[s]?.nome || s).join(', ') : null,
    f.fases.length === Object.keys(FASES_JORNAL).length ? null : f.fases.map((s) => FASES_JORNAL[s]).join(', '),
    e.modo === 'ate' ? `Encerra até ${dataBr(e.data)}${e.hora ? ` às ${e.hora}` : ''}` : e.modo === 'dia' ? `Encerra em ${dataBr(e.data)}${e.hora ? ` até ${e.hora}` : ''}` : null,
  ].filter(Boolean).join(' · ');
}
