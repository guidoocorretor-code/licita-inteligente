// Fase 5: Financeiro.
// 1) Honorários da assessoria: contrato por empresa (mensalidade e/ou % de êxito sobre o que o órgão pagou),
//    cobranças geradas a partir do contrato e registro do que foi recebido.
// 2) Lucro real por contrato: receita do card (pelo valor mais avançado informado) menos os custos lançados.
// Valor não informado nunca vira zero: contrato sem custo lançado aparece como "custos não informados", sem lucro.
import { valorDe, FASES_GANHAS } from './execucao.js';
import { dataDaFase } from './painel-empresas.js';

const r2 = (v) => Math.round(v * 100) / 100;
const dd = (n) => String(n).padStart(2, '0');
const diasNoMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const somaDias = (iso, d) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
const noPeriodo = (dia, de, ate) => !!dia && (!de || dia >= de) && (!ate || dia <= ate);

export const CATEGORIAS_CUSTO = {
  produto: 'Produto / mercadoria', frete: 'Frete', impostos: 'Impostos', taxas: 'Taxas e tarifas',
  garantia: 'Garantia contratual', pessoal: 'Mão de obra', outros: 'Outros',
};
export const FORMAS_RECEBIMENTO = { pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência', dinheiro: 'Dinheiro', outro: 'Outro' };
export const TIPOS_COBRANCA = { mensalidade: 'Mensalidade', exito: 'Êxito', avulsa: 'Avulsa' };

export function migrarFinanceiro(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS honorarios_contratos (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    mensalidade REAL,                 -- NULL = sem mensalidade
    dia_vencimento INTEGER,           -- dia do mês da mensalidade (1 a 31; mês curto vence no último dia)
    percentual_exito REAL,            -- % sobre o valor recebido do órgão; NULL = sem êxito
    prazo_exito_dias INTEGER NOT NULL DEFAULT 5, -- dias depois do recebimento do órgão para vencer o êxito
    inicio TEXT NOT NULL,             -- aaaa-mm-dd
    fim TEXT,                         -- aaaa-mm-dd; NULL = vigente
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (empresa_id, cliente_id)
  )`);
  conn.exec(`CREATE TABLE IF NOT EXISTS honorarios_cobrancas (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,               -- mensalidade | exito | avulsa
    competencia TEXT,                 -- aaaa-mm (mensalidade)
    oportunidade_id INTEGER REFERENCES oportunidades(id) ON DELETE SET NULL, -- êxito
    descricao TEXT,
    base_valor REAL,                  -- êxito: valor recebido do órgão usado no cálculo
    valor REAL NOT NULL,
    vencimento TEXT NOT NULL,
    pago_em TEXT, valor_pago REAL, forma_pagamento TEXT,
    cancelada_em TEXT, cancelamento_motivo TEXT,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  conn.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cob_mensal ON honorarios_cobrancas(cliente_id, competencia) WHERE tipo = 'mensalidade';
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cob_exito ON honorarios_cobrancas(oportunidade_id) WHERE tipo = 'exito';
    CREATE INDEX IF NOT EXISTS ix_cob_empresa ON honorarios_cobrancas(empresa_id, vencimento)`);
  conn.exec(`CREATE TABLE IF NOT EXISTS oportunidade_custos (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
    categoria TEXT NOT NULL,
    descricao TEXT,
    valor REAL NOT NULL,
    data TEXT,
    origem TEXT NOT NULL DEFAULT 'manual', -- manual | cotacoes (sugestão a partir das cotações, conferida pelo usuário)
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  conn.exec('CREATE INDEX IF NOT EXISTS ix_custos_op ON oportunidade_custos(oportunidade_id)');
}

const falha = (status, msg) => Object.assign(new Error(msg), { status });
const numOuNulo = (v, nome, { min = 0, max = Infinity } = {}) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw falha(400, `${nome}: valor inválido.`);
  return n;
};
const dataOuNulo = (v, nome) => {
  if (v === '' || v == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw falha(400, `${nome}: data inválida.`);
  return v;
};

// ---------------- Contrato de honorários ----------------
export function contratoDoCliente(db, empresaId, clienteId) {
  return db.prepare('SELECT * FROM honorarios_contratos WHERE empresa_id=? AND cliente_id=?').get(empresaId, clienteId) || null;
}

export function salvarContrato(db, empresaId, clienteId, b = {}) {
  const cli = db.prepare('SELECT id FROM clientes WHERE id=? AND empresa_id=?').get(clienteId, empresaId);
  if (!cli) throw falha(404, 'Empresa não encontrada.');
  const mensalidade = numOuNulo(b.mensalidade, 'Mensalidade');
  const pct = numOuNulo(b.percentual_exito, 'Percentual de êxito', { max: 100 });
  const dia = b.dia_vencimento === '' || b.dia_vencimento == null ? null : numOuNulo(b.dia_vencimento, 'Dia de vencimento', { min: 1, max: 31 });
  const prazo = b.prazo_exito_dias === '' || b.prazo_exito_dias == null ? 5 : numOuNulo(b.prazo_exito_dias, 'Prazo do êxito', { max: 120 });
  const inicio = dataOuNulo(b.inicio, 'Início');
  const fim = dataOuNulo(b.fim, 'Fim');
  if (!inicio) throw falha(400, 'Informe a data de início do contrato.');
  if (fim && fim < inicio) throw falha(400, 'O fim do contrato é antes do início.');
  if (!mensalidade && !pct) throw falha(400, 'Informe a mensalidade, o percentual de êxito ou os dois.');
  if (mensalidade && !dia) throw falha(400, 'Informe o dia de vencimento da mensalidade.');
  db.prepare(`INSERT INTO honorarios_contratos (empresa_id, cliente_id, mensalidade, dia_vencimento, percentual_exito, prazo_exito_dias, inicio, fim, observacoes)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (empresa_id, cliente_id) DO UPDATE SET mensalidade=excluded.mensalidade, dia_vencimento=excluded.dia_vencimento,
    percentual_exito=excluded.percentual_exito, prazo_exito_dias=excluded.prazo_exito_dias, inicio=excluded.inicio, fim=excluded.fim,
    observacoes=excluded.observacoes, atualizado_em=datetime('now')`)
    .run(empresaId, clienteId, mensalidade, mensalidade ? Math.round(dia) : null, pct, Math.round(prazo), inicio, fim, (b.observacoes || '').trim().slice(0, 1000) || null);
  return contratoDoCliente(db, empresaId, clienteId);
}

/** Meses aaaa-mm de `de` até `ate` (inclusive). */
export function mesesEntre(de, ate) {
  const out = [];
  let [a, m] = de.slice(0, 7).split('-').map(Number);
  const [af, mf] = ate.slice(0, 7).split('-').map(Number);
  while (a < af || (a === af && m <= mf)) { out.push(`${a}-${dd(m)}`); m++; if (m > 12) { m = 1; a++; } }
  return out;
}
const vencimentoNoMes = (competencia, dia) => {
  const [a, m] = competencia.split('-').map(Number);
  return `${competencia}-${dd(Math.min(dia, diasNoMes(a, m)))}`;
};

/**
 * Gera as cobranças que o contrato pede até hoje: uma mensalidade por mês de vigência e um êxito por card
 * recebido dentro da vigência. Idempotente. Êxito ainda não pago acompanha correções no valor recebido,
 * e é cancelado se o card sair de "Recebido".
 */
export function gerarCobrancas(db, empresaId, hoje) {
  const contratos = db.prepare('SELECT * FROM honorarios_contratos WHERE empresa_id=?').all(empresaId);
  const insMensal = db.prepare(`INSERT OR IGNORE INTO honorarios_cobrancas (empresa_id, cliente_id, tipo, competencia, descricao, valor, vencimento)
    VALUES (?,?,'mensalidade',?,?,?,?)`);
  const exitoDe = db.prepare("SELECT * FROM honorarios_cobrancas WHERE tipo='exito' AND oportunidade_id=?");
  const insExito = db.prepare(`INSERT INTO honorarios_cobrancas (empresa_id, cliente_id, tipo, oportunidade_id, descricao, base_valor, valor, vencimento)
    VALUES (?,?,'exito',?,?,?,?,?)`);
  const attExito = db.prepare('UPDATE honorarios_cobrancas SET base_valor=?, valor=?, vencimento=?, descricao=?, cancelada_em=NULL, cancelamento_motivo=NULL WHERE id=?');
  const recebidos = db.prepare(`SELECT o.id, o.recebido_valor, o.recebido_data, l.objeto FROM oportunidades o JOIN kanban_etapas ke ON ke.id=o.etapa_id
    LEFT JOIN licitacoes l ON l.id=o.licitacao_id WHERE o.empresa_id=? AND o.cliente_id=? AND ke.fase='recebida' AND o.recebido_valor IS NOT NULL AND o.recebido_data IS NOT NULL`);
  let criadas = 0;
  for (const c of contratos) {
    const fimVig = c.fim && c.fim < hoje ? c.fim : hoje;
    if (c.mensalidade && c.dia_vencimento && c.inicio <= fimVig) {
      for (const comp of mesesEntre(c.inicio, fimVig)) {
        const [a, m] = comp.split('-');
        criadas += Number(insMensal.run(empresaId, c.cliente_id, comp, `Mensalidade ${m}/${a}`, c.mensalidade, vencimentoNoMes(comp, c.dia_vencimento)).changes);
      }
    }
    if (c.percentual_exito) {
      for (const o of recebidos.all(empresaId, c.cliente_id)) {
        const dia = o.recebido_data.slice(0, 10);
        if (dia < c.inicio || (c.fim && dia > c.fim)) continue;
        const valor = r2(o.recebido_valor * c.percentual_exito / 100);
        const desc = `Êxito ${String(c.percentual_exito).replace('.', ',')}%: ${(o.objeto || 'licitação').slice(0, 90)}`;
        const venc = somaDias(dia, c.prazo_exito_dias ?? 5);
        const ex = exitoDe.get(o.id);
        if (!ex) { insExito.run(empresaId, c.cliente_id, o.id, desc, o.recebido_valor, valor, venc); criadas++; }
        else if (!ex.pago_em && (ex.valor !== valor || ex.base_valor !== o.recebido_valor || ex.vencimento !== venc || ex.cancelada_em)) attExito.run(o.recebido_valor, valor, venc, desc, ex.id);
      }
    }
  }
  // Card que voltou de "Recebido" (com a senha do administrador): o êxito em aberto deixa de valer
  db.prepare(`UPDATE honorarios_cobrancas SET cancelada_em=datetime('now'), cancelamento_motivo='O card saiu de "Recebido" no Kanban'
    WHERE empresa_id=? AND tipo='exito' AND pago_em IS NULL AND cancelada_em IS NULL AND (oportunidade_id IS NULL OR oportunidade_id NOT IN (
      SELECT o.id FROM oportunidades o JOIN kanban_etapas ke ON ke.id=o.etapa_id WHERE ke.fase='recebida'))`).run(empresaId);
  return criadas;
}

export function situacaoCobranca(c, hoje) {
  if (c.cancelada_em) return 'cancelada';
  if (c.pago_em) return 'paga';
  return c.vencimento < hoje ? 'vencida' : 'a_vencer';
}

/**
 * Honorários no período: lista pelas datas de vencimento; "Recebido" conta pela data do pagamento.
 * Totais em centavos arredondados.
 */
export function resumoHonorarios(db, empresaId, { clienteId = null, de = null, ate = null, hoje }) {
  gerarCobrancas(db, empresaId, hoje);
  const todas = db.prepare(`SELECT c.*, COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome FROM honorarios_cobrancas c
    JOIN clientes cl ON cl.id=c.cliente_id WHERE c.empresa_id=?${clienteId ? ' AND c.cliente_id=?' : ''} ORDER BY c.vencimento DESC, c.id DESC`)
    .all(empresaId, ...(clienteId ? [clienteId] : [])).map((c) => ({ ...c, situacao: situacaoCobranca(c, hoje) }));
  const lista = todas.filter((c) => noPeriodo(c.vencimento, de, ate) || noPeriodo(c.pago_em, de, ate));
  const total = { previsto: 0, recebido: 0, em_aberto: 0, vencido: 0, n_vencidas: 0 };
  const porCliente = new Map();
  for (const c of todas) {
    const linha = porCliente.get(c.cliente_id) || { cliente_id: c.cliente_id, cliente_nome: c.cliente_nome, previsto: 0, recebido: 0, em_aberto: 0, vencido: 0 };
    const add = (k, v) => { total[k] = r2(total[k] + v); linha[k] = r2(linha[k] + v); };
    if (c.situacao !== 'cancelada' && noPeriodo(c.vencimento, de, ate)) {
      add('previsto', c.valor);
      if (c.situacao === 'a_vencer' || c.situacao === 'vencida') add('em_aberto', c.valor);
      if (c.situacao === 'vencida') { add('vencido', c.valor); total.n_vencidas++; }
    }
    if (c.pago_em && noPeriodo(c.pago_em, de, ate)) add('recebido', c.valor_pago ?? c.valor);
    porCliente.set(c.cliente_id, linha);
  }
  const contratos = db.prepare(`SELECT c.id cliente_id, COALESCE(c.nome_fantasia, c.razao_social) cliente_nome, h.mensalidade, h.dia_vencimento, h.percentual_exito,
      h.prazo_exito_dias, h.inicio, h.fim, h.observacoes, h.id contrato_id FROM clientes c LEFT JOIN honorarios_contratos h ON h.cliente_id=c.id AND h.empresa_id=c.empresa_id
    WHERE c.empresa_id=? AND c.ativo=1${clienteId ? ' AND c.id=?' : ''} ORDER BY cliente_nome`).all(empresaId, ...(clienteId ? [clienteId] : []));
  return { cobrancas: lista, total, por_cliente: [...porCliente.values()].filter((l) => l.previsto || l.recebido), contratos };
}

export function criarCobrancaAvulsa(db, empresaId, usuarioId, b = {}) {
  const cli = db.prepare('SELECT id FROM clientes WHERE id=? AND empresa_id=?').get(Number(b.cliente_id), empresaId);
  if (!cli) throw falha(400, 'Escolha a empresa.');
  const valor = numOuNulo(b.valor, 'Valor');
  if (!valor) throw falha(400, 'Informe o valor.');
  const venc = dataOuNulo(b.vencimento, 'Vencimento');
  if (!venc) throw falha(400, 'Informe o vencimento.');
  const desc = (b.descricao || '').trim();
  if (desc.length < 3) throw falha(400, 'Descreva a cobrança.');
  const id = db.prepare(`INSERT INTO honorarios_cobrancas (empresa_id, cliente_id, tipo, descricao, valor, vencimento, criado_por) VALUES (?,?,'avulsa',?,?,?,?)`)
    .run(empresaId, cli.id, desc.slice(0, 200), valor, venc, usuarioId).lastInsertRowid;
  return Number(id);
}

export function cobrancaDaEmpresa(db, empresaId, id) {
  const c = db.prepare('SELECT * FROM honorarios_cobrancas WHERE id=? AND empresa_id=?').get(id, empresaId);
  if (!c) throw falha(404, 'Cobrança não encontrada.');
  return c;
}

/** Registra o recebimento (ou ajusta o valor de uma cobrança em aberto). Desfazer pagamento é feito à parte, com senha. */
export function atualizarCobranca(db, empresaId, id, b = {}) {
  const c = cobrancaDaEmpresa(db, empresaId, id);
  if (c.cancelada_em) throw falha(400, 'Cobrança cancelada.');
  if (b.pago_em !== undefined) {
    if (c.pago_em) throw falha(400, 'Esta cobrança já está paga.');
    const pago = dataOuNulo(b.pago_em, 'Data do pagamento');
    if (!pago) throw falha(400, 'Informe a data do pagamento.');
    const valorPago = numOuNulo(b.valor_pago, 'Valor pago') ?? c.valor;
    const forma = FORMAS_RECEBIMENTO[b.forma_pagamento] ? b.forma_pagamento : null;
    db.prepare('UPDATE honorarios_cobrancas SET pago_em=?, valor_pago=?, forma_pagamento=? WHERE id=?').run(pago, valorPago, forma, id);
  } else if (b.valor !== undefined || b.vencimento !== undefined) {
    if (c.pago_em) throw falha(400, 'Cobrança paga não pode ser alterada.');
    if (c.tipo === 'exito') throw falha(400, 'O êxito é calculado pelo valor recebido no card. Corrija o valor no Kanban.');
    const valor = b.valor !== undefined ? numOuNulo(b.valor, 'Valor') : c.valor;
    if (!valor) throw falha(400, 'Informe o valor.');
    const venc = b.vencimento !== undefined ? dataOuNulo(b.vencimento, 'Vencimento') : c.vencimento;
    if (!venc) throw falha(400, 'Informe o vencimento.');
    db.prepare('UPDATE honorarios_cobrancas SET valor=?, vencimento=? WHERE id=?').run(valor, venc, id);
  }
  return cobrancaDaEmpresa(db, empresaId, id);
}

export function cancelarCobranca(db, empresaId, id, motivo) {
  const c = cobrancaDaEmpresa(db, empresaId, id);
  if (c.pago_em) throw falha(400, 'Desfaça o pagamento antes de cancelar.');
  const m = (motivo || '').trim();
  if (m.length < 5) throw falha(400, 'Explique o motivo do cancelamento.');
  db.prepare("UPDATE honorarios_cobrancas SET cancelada_em=datetime('now'), cancelamento_motivo=? WHERE id=?").run(m.slice(0, 300), id);
}

export function desfazerPagamento(db, empresaId, id) {
  cobrancaDaEmpresa(db, empresaId, id);
  db.prepare('UPDATE honorarios_cobrancas SET pago_em=NULL, valor_pago=NULL, forma_pagamento=NULL WHERE id=?').run(id);
}

// ---------------- Lucro real por contrato ----------------
const FASES_CONTRATO = FASES_GANHAS; // ganha → recebida

export function custosDaOportunidade(db, empresaId, opId) {
  return db.prepare('SELECT * FROM oportunidade_custos WHERE empresa_id=? AND oportunidade_id=? ORDER BY COALESCE(data, criado_em), id').all(empresaId, opId);
}

export function lancarCusto(db, empresaId, usuarioId, opId, b = {}) {
  const op = db.prepare('SELECT id FROM oportunidades WHERE id=? AND empresa_id=?').get(opId, empresaId);
  if (!op) throw falha(404, 'Card não encontrado.');
  if (!CATEGORIAS_CUSTO[b.categoria]) throw falha(400, 'Escolha a categoria do custo.');
  const valor = numOuNulo(b.valor, 'Valor');
  if (valor == null) throw falha(400, 'Informe o valor do custo.');
  const origem = b.origem === 'cotacoes' ? 'cotacoes' : 'manual';
  const id = db.prepare('INSERT INTO oportunidade_custos (empresa_id, oportunidade_id, categoria, descricao, valor, data, origem, criado_por) VALUES (?,?,?,?,?,?,?,?)')
    .run(empresaId, opId, b.categoria, (b.descricao || '').trim().slice(0, 200) || null, valor, dataOuNulo(b.data, 'Data'), origem, usuarioId).lastInsertRowid;
  return Number(id);
}

export function excluirCusto(db, empresaId, opId, custoId) {
  const out = db.prepare('DELETE FROM oportunidade_custos WHERE id=? AND oportunidade_id=? AND empresa_id=?').run(custoId, opId, empresaId);
  if (!out.changes) throw falha(404, 'Custo não encontrado.');
}

/**
 * Um contrato por card ganho (Vencida até Recebido). Receita = valor mais avançado informado no card
 * (recebido > nota > empenho > ganho). Custos = lançados no card + honorário de êxito cobrado da empresa.
 * Sem nenhum custo lançado, o lucro fica em branco: receita não é lucro.
 */
export function lucroPorContrato(db, empresaId, { clienteId = null, de = null, ate = null } = {}) {
  const ops = db.prepare(`SELECT o.*, ke.fase, ke.nome etapa, l.objeto, l.orgao_nome, l.municipio, l.uf, l.data_encerramento_proposta,
      COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome
    FROM oportunidades o JOIN kanban_etapas ke ON ke.id=o.etapa_id LEFT JOIN licitacoes l ON l.id=o.licitacao_id LEFT JOIN clientes cl ON cl.id=o.cliente_id
    WHERE o.empresa_id=?${clienteId ? ' AND o.cliente_id=?' : ''}`).all(empresaId, ...(clienteId ? [clienteId] : []))
    .filter((o) => FASES_CONTRATO.includes(o.fase));
  const custos = db.prepare('SELECT categoria, SUM(valor) v, COUNT(*) n FROM oportunidade_custos WHERE oportunidade_id=? GROUP BY categoria');
  const exito = db.prepare("SELECT COALESCE(valor_pago, valor) v FROM honorarios_cobrancas WHERE tipo='exito' AND oportunidade_id=? AND cancelada_em IS NULL");
  const linhas = [];
  let semData = 0;
  for (const o of ops) {
    const dia = dataDaFase(o);
    if (de || ate) { if (!dia) { semData++; continue; } if (!noPeriodo(dia, de, ate)) continue; }
    const { valor: receita, origem } = valorDe(o, o.fase);
    const porCat = Object.fromEntries(custos.all(o.id).map((c) => [c.categoria, r2(c.v)]));
    // Só o honorário automático não basta: sem custo lançado pelo usuário, o lucro fica em branco
    const temCusto = Object.keys(porCat).length > 0;
    const hon = exito.get(o.id)?.v ?? null;
    if (hon != null) porCat.honorarios = r2(hon);
    const totalCustos = temCusto ? r2(Object.values(porCat).reduce((s, v) => s + v, 0)) : null;
    const lucro = receita != null && temCusto ? r2(receita - totalCustos) : null;
    linhas.push({
      oportunidade_id: o.id, licitacao_id: o.licitacao_id, cliente_id: o.cliente_id, cliente_nome: o.cliente_nome,
      objeto: o.objeto, orgao_nome: o.orgao_nome, local: [o.municipio, o.uf].filter(Boolean).join('/'), fase: o.fase, etapa: o.etapa, data: dia,
      receita, receita_origem: origem, realizado: o.fase === 'recebida', custos: porCat, total_custos: totalCustos, lucro,
      margem_pct: lucro != null && receita ? r2((lucro / receita) * 100) : null,
    });
  }
  const comLucro = linhas.filter((l) => l.lucro != null);
  const soma = (arr, k) => r2(arr.reduce((s, l) => s + (l[k] || 0), 0));
  const realizados = comLucro.filter((l) => l.realizado);
  return {
    contratos: linhas.sort((a, b) => (b.data || '').localeCompare(a.data || '')),
    total: {
      n: linhas.length, sem_custo: linhas.filter((l) => l.total_custos == null).length, sem_receita: linhas.filter((l) => l.receita == null).length,
      receita: soma(comLucro, 'receita'), custos: soma(comLucro, 'total_custos'), lucro: soma(comLucro, 'lucro'),
      lucro_realizado: soma(realizados, 'lucro'), receita_realizada: soma(realizados, 'receita'),
      margem_pct: soma(comLucro, 'receita') ? r2((soma(comLucro, 'lucro') / soma(comLucro, 'receita')) * 100) : null,
    },
    fora_sem_data: semData,
    categorias: { ...CATEGORIAS_CUSTO, honorarios: 'Honorários da assessoria (êxito)' },
  };
}
