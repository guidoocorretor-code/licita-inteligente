// Etapas do Kanban agrupadas em fases, do interesse até o dinheiro na conta.
// Os nomes das etapas são fixos (não há tela para editá-los); a fase diz o que cada etapa significa
// para o painel de Empresas (disputas, vitórias, empenho, entrega, nota fiscal e recebimento).

export const FASES = {
  prospeccao: 'Prospecção', disputa: 'Em disputa', ganha: 'Vencida', empenho: 'Aguardando empenho',
  a_entregar: 'Empenhado, a entregar', entregue: 'Entregue, aguardando nota', faturada: 'Nota emitida, a receber',
  recebida: 'Recebido', perdida: 'Perdida', descartada: 'Descartada',
};
/** Fases depois da vitória, na ordem. */
export const FASES_GANHAS = ['ganha', 'empenho', 'a_entregar', 'entregue', 'faturada', 'recebida'];

export const ETAPAS_PADRAO = [
  ['Nova oportunidade', 'prospeccao'], ['Em análise', 'prospeccao'], ['Aguardando decisão', 'prospeccao'],
  ['Documentação em preparação', 'prospeccao'], ['Proposta em elaboração', 'prospeccao'], ['Pronta para envio', 'prospeccao'],
  ['Participação confirmada', 'disputa'], ['Em disputa', 'disputa'], ['Aguardando resultado', 'disputa'],
  ['Vencida', 'ganha'], ['Aguardando empenho', 'empenho'], ['Empenhado (a entregar)', 'a_entregar'],
  ['Produto enviado / serviço executado', 'entregue'], ['Nota fiscal emitida', 'faturada'], ['Recebido', 'recebida'],
  ['Perdida', 'perdida'], ['Descartada', 'descartada'],
];
const FASE_POR_NOME = Object.fromEntries(ETAPAS_PADRAO);
export const faseDaEtapa = (nome) => FASE_POR_NOME[nome] || 'prospeccao';
/** Etapas de execução incluídas depois de "Vencida" em contas antigas. */
const NOVAS_EXECUCAO = ETAPAS_PADRAO.slice(10, 15);

/**
 * Valor de referência da oportunidade conforme a fase, do dado mais firme para o mais fraco.
 * Devolve { valor, origem } — origem 'edital' = valor estimado da licitação inteira (pode incluir lotes que a empresa não disputa).
 */
export function valorDe(o, fase) {
  const pri = (...pares) => { for (const [v, origem] of pares) if (v != null) return { valor: v, origem }; return { valor: null, origem: null }; };
  switch (fase) {
    case 'prospeccao': case 'disputa': return pri([o.valor_proposta, 'proposta'], [o.valor_estimado, 'edital']);
    case 'ganha': case 'empenho': return pri([o.valor_ganho, 'ganho'], [o.valor_proposta, 'proposta']);
    case 'a_entregar': case 'entregue': return pri([o.empenho_valor, 'empenho'], [o.valor_ganho, 'ganho'], [o.valor_proposta, 'proposta']);
    case 'faturada': return pri([o.nf_valor, 'nota'], [o.empenho_valor, 'empenho'], [o.valor_ganho, 'ganho']);
    case 'recebida': return pri([o.recebido_valor, 'recebido'], [o.nf_valor, 'nota'], [o.empenho_valor, 'empenho'], [o.valor_ganho, 'ganho']);
    default: return { valor: null, origem: null };
  }
}

const colunas = (conn, t) => conn.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

/** Bancos antigos: fase nas etapas, colunas de valores/execução e as 5 etapas novas depois de "Vencida". */
export function migrarExecucao(conn) {
  if (!colunas(conn, 'kanban_etapas').includes('fase')) conn.exec('ALTER TABLE kanban_etapas ADD COLUMN fase TEXT');
  const novas = { valor_proposta: 'REAL', valor_ganho: 'REAL', resultado_em: 'TEXT', empenho_numero: 'TEXT', empenho_valor: 'REAL', empenho_data: 'TEXT',
    entrega_prazo: 'TEXT', entrega_data: 'TEXT', nf_numero: 'TEXT', nf_valor: 'REAL', nf_data: 'TEXT', recebido_valor: 'REAL', recebido_data: 'TEXT' };
  const temOp = colunas(conn, 'oportunidades');
  for (const [c, tipo] of Object.entries(novas)) if (!temOp.includes(c)) conn.exec(`ALTER TABLE oportunidades ADD COLUMN ${c} ${tipo}`);
  const temCli = colunas(conn, 'clientes');
  for (const c of ['cnaes_json', 'palavras_chave']) if (!temCli.includes(c)) conn.exec(`ALTER TABLE clientes ADD COLUMN ${c} TEXT`);

  const contas = conn.prepare('SELECT DISTINCT empresa_id FROM kanban_etapas').all().map((r) => r.empresa_id);
  conn.exec('BEGIN');
  try {
    for (const emp of contas) {
      const nomes = new Set(conn.prepare('SELECT nome FROM kanban_etapas WHERE empresa_id=?').all(emp).map((r) => r.nome));
      const faltam = NOVAS_EXECUCAO.filter(([n]) => !nomes.has(n));
      if (faltam.length) {
        const ref = conn.prepare("SELECT ordem FROM kanban_etapas WHERE empresa_id=? AND nome='Vencida'").get(emp)
          ?? conn.prepare('SELECT MAX(ordem) ordem FROM kanban_etapas WHERE empresa_id=?').get(emp);
        conn.prepare('UPDATE kanban_etapas SET ordem = ordem + ? WHERE empresa_id=? AND ordem > ?').run(faltam.length, emp, ref.ordem);
        const ins = conn.prepare('INSERT INTO kanban_etapas (empresa_id, nome, ordem, fase) VALUES (?,?,?,?)');
        faltam.forEach(([n, f], i) => ins.run(emp, n, ref.ordem + 1 + i, f));
      }
    }
    const up = conn.prepare('UPDATE kanban_etapas SET fase=? WHERE id=?');
    for (const e of conn.prepare('SELECT id, nome FROM kanban_etapas WHERE fase IS NULL').all()) up.run(faseDaEtapa(e.nome), e.id);
    conn.exec('COMMIT');
  } catch (e) { conn.exec('ROLLBACK'); throw e; }
}
