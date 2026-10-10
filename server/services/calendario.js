// Calendário de prazos das licitações acompanhadas (favoritos do usuário + Kanban da empresa)
// e exportação no padrão iCalendar (RFC 5545) para Google Agenda, Outlook e celular.
import crypto from 'node:crypto';

/** Licitações que o usuário acompanha: favoritas dele e as do Kanban da empresa. */
export function licitacoesAcompanhadas(db, { empresaId, usuarioId }) {
  return db.prepare(`
    SELECT l.id, l.objeto, l.orgao_nome, l.uf, l.municipio, l.status_calculado, l.numero_controle_pncp,
      l.data_abertura_proposta, l.data_encerramento_proposta,
      o.id oportunidade_id, o.prazo_interno, e.nome etapa_nome,
      MAX(f.id IS NOT NULL) favorita
    FROM licitacoes l
    LEFT JOIN favoritos f ON f.tipo='licitacao' AND f.referencia = CAST(l.id AS TEXT) AND f.usuario_id = ?
    LEFT JOIN oportunidades o ON o.licitacao_id = l.id AND o.empresa_id = ?
    LEFT JOIN kanban_etapas e ON e.id = o.etapa_id
    WHERE f.id IS NOT NULL OR o.id IS NOT NULL
    GROUP BY l.id`).all(usuarioId, empresaId);
}

const TIPOS = {
  abertura: 'Início das propostas',
  encerramento: 'Fim das propostas',
  prazo_interno: 'Prazo interno',
};

/** Eventos do calendário no intervalo [de, ate] (datas AAAA-MM-DD, inclusive). Horários em Brasília. */
export function eventosCalendario(db, { empresaId, usuarioId, de, ate }) {
  const ev = [];
  for (const l of licitacoesAcompanhadas(db, { empresaId, usuarioId })) {
    const base = { licitacao_id: l.id, objeto: l.objeto, orgao_nome: l.orgao_nome, uf: l.uf, municipio: l.municipio,
      status: l.status_calculado, etapa: l.etapa_nome || null, favorita: !!l.favorita };
    if (l.data_abertura_proposta) ev.push({ ...base, tipo: 'abertura', titulo: TIPOS.abertura, quando: l.data_abertura_proposta, dia_inteiro: false });
    if (l.data_encerramento_proposta) ev.push({ ...base, tipo: 'encerramento', titulo: TIPOS.encerramento, quando: l.data_encerramento_proposta, dia_inteiro: false });
    if (l.prazo_interno) ev.push({ ...base, tipo: 'prazo_interno', titulo: TIPOS.prazo_interno, quando: l.prazo_interno.slice(0, 10), dia_inteiro: true });
  }
  return ev
    .filter((e) => (!de || e.quando.slice(0, 10) >= de) && (!ate || e.quando.slice(0, 10) <= ate))
    .sort((a, b) => a.quando.localeCompare(b.quando));
}

// ---------- iCalendar ----------
const escapar = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Linhas de no máximo 75 octetos, continuação começando com espaço (RFC 5545, 3.1)
function dobrar(linha) {
  const bytes = Buffer.from(linha, 'utf8');
  if (bytes.length <= 75) return linha;
  const partes = []; let atual = '';
  for (const ch of linha) {
    if (Buffer.byteLength(atual + ch, 'utf8') > (partes.length ? 74 : 75)) { partes.push(atual); atual = ''; }
    atual += ch;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}
// Horário de Brasília (UTC-3 fixo desde 2019) → UTC no formato iCalendar
const paraUtc = (local) => new Date(Date.parse(`${local.slice(0, 19)}Z`) + 3 * 3600 * 1000).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const soData = (d) => d.slice(0, 10).replace(/-/g, '');
const diaSeguinte = (d) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export function gerarIcs(eventos, { nome = 'Licita Inteligente', urlBase = '', agora = new Date() } = {}) {
  const carimbo = agora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Licita Inteligente//Prazos//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapar(nome)}`, 'X-WR-TIMEZONE:America/Sao_Paulo', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const e of eventos) {
    const local = [e.municipio, e.uf].filter(Boolean).join('/');
    const desc = [e.objeto, e.orgao_nome && `Órgão: ${e.orgao_nome}`, local && `Local: ${local}`, e.etapa && `Etapa no Kanban: ${e.etapa}`,
      urlBase && `Abrir no sistema: ${urlBase}/#/licitacao/${e.licitacao_id}`, 'Confira sempre o edital e o sistema oficial antes de agir.'].filter(Boolean).join('\n');
    linhas.push('BEGIN:VEVENT', `UID:${e.tipo}-${e.licitacao_id}@licita-inteligente`, `DTSTAMP:${carimbo}`);
    if (e.dia_inteiro) linhas.push(`DTSTART;VALUE=DATE:${soData(e.quando)}`, `DTEND;VALUE=DATE:${soData(diaSeguinte(e.quando))}`);
    else {
      linhas.push(`DTSTART:${paraUtc(e.quando)}`, 'DURATION:PT30M');
      if (e.tipo === 'encerramento') linhas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapar(`${e.titulo} em 1 dia`)}`, 'TRIGGER:-P1D', 'END:VALARM');
    }
    linhas.push(`SUMMARY:${escapar(`${e.titulo}: ${(e.objeto || '').slice(0, 80)}`)}`, `DESCRIPTION:${escapar(desc)}`);
    if (local) linhas.push(`LOCATION:${escapar(local)}`);
    if (urlBase) linhas.push(`URL:${urlBase}/#/licitacao/${e.licitacao_id}`);
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}

// ---------- Link de assinatura (somente leitura, revogável) ----------
// Só o hash do token fica no banco; o link completo é mostrado uma vez, ao ser gerado.
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function gerarTokenCalendario(db, usuarioId) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO calendario_tokens (usuario_id, token_hash) VALUES (?, ?)
    ON CONFLICT(usuario_id) DO UPDATE SET token_hash=excluded.token_hash, criado_em=datetime('now')`).run(usuarioId, hashToken(token));
  return token;
}

export function revogarTokenCalendario(db, usuarioId) {
  db.prepare('DELETE FROM calendario_tokens WHERE usuario_id=?').run(usuarioId);
}

export function usuarioDoToken(db, token) {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return db.prepare(`SELECT u.id, u.empresa_id, u.nome FROM calendario_tokens c JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.token_hash = ? AND u.ativo = 1`).get(hashToken(token)) || null;
}
