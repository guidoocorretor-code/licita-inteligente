// Alertas: categoria visual de cada tipo e lembretes de nota fiscal. DADOS DE TESTE fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { categoriaAlerta, avaliarAlertasNotaFiscal, listarNotificacoes } from '../../server/services/alertas.js';
import { garantirEtapas } from '../../server/routes/api.js';
import { criarUsuario } from '../../server/lib/auth.js';

test('cada tipo de alerta cai na sua categoria', () => {
  const c = (tipo, titulo) => categoriaAlerta({ tipo, titulo });
  assert.equal(c('prazo', 'Propostas encerram em menos de 24h (14/10 às 10:00)'), 'prazo_24h');
  assert.equal(c('prazo', 'Propostas encerram em até 3 dias (16/10 às 10:00)'), 'prazo_3d');
  assert.equal(c('prazo_interno', 'Prazo interno vence hoje'), 'prazo_interno');
  assert.equal(c('mudanca', 'Mudança de situação: Aquisição de papel'), 'situacao');
  assert.equal(c('mudanca', 'Resultado publicado: Aquisição de papel'), 'resultado');
  assert.equal(c('mudanca', 'Edital alterado: Aquisição de papel'), 'edital');
  assert.equal(c('mudanca', 'Novo documento: Aquisição de papel'), 'edital');
  assert.equal(c('jornal', 'Interesse do cliente'), 'interesse');
  assert.equal(c('vencimento', 'CND Federal vence em 7 dia(s) (19/10/2026)'), 'certidao');
  assert.equal(c('vencimento', 'CND Federal VENCEU (11/10/2026)'), 'certidao_vencida');
  assert.equal(c('vencimento', 'FGTS vence HOJE'), 'certidao_vencida');
  assert.equal(c('nota_emitir', 'Emitir nota fiscal'), 'nota_emitir');
  assert.equal(c('nota_cobrar', 'Pagamento não recebido'), 'nota_cobrar');
  assert.equal(c('pesquisa_salva', 'Nova oportunidade: papel'), 'oportunidade');
  assert.equal(c('xyz', ''), 'outro');
});

test('nota fiscal: lembra de emitir, cobra com 30 e 60 dias e some quando o card anda', () => {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  const u1 = criarUsuario(db, { empresaId: emp, nome: 'Ana', email: 'ana@a.com', senha: 'SenhaForte123', papel: 'admin' });
  const u2 = criarUsuario(db, { empresaId: emp, nome: 'Bia', email: 'bia@a.com', senha: 'SenhaForte123', papel: 'gestor' });
  garantirEtapas(db, emp);
  const etapa = (fase) => db.prepare('SELECT id FROM kanban_etapas WHERE empresa_id=? AND fase=?').get(emp, fase).id;
  const lic = (k) => Number(db.prepare("INSERT INTO licitacoes (chave_canonica, objeto, orgao_nome, status_calculado) VALUES (?,?,?,'encerrada')").run(k, `Objeto ${k}`, 'Prefeitura de Teste').lastInsertRowid);
  const op = (licId, fase, extra = {}) => {
    const id = Number(db.prepare('INSERT INTO oportunidades (empresa_id, licitacao_id, etapa_id, responsavel_id) VALUES (?,?,?,?)').run(emp, licId, etapa(fase), extra.resp ?? null).lastInsertRowid);
    for (const [k, v] of Object.entries(extra)) if (k !== 'resp') db.prepare(`UPDATE oportunidades SET ${k}=? WHERE id=?`).run(v, id);
    return id;
  };
  const uid = (u) => (typeof u === 'object' ? u.id : u);
  const entregue = op(lic('a'), 'entregue', { entrega_data: '2026-10-05', resp: uid(u1) });
  const semData = op(lic('b'), 'entregue');
  const nota35 = op(lic('c'), 'faturada', { nf_numero: '123', nf_data: '2026-09-07', resp: uid(u1) });
  op(lic('d'), 'faturada', { nf_data: '2026-10-01', resp: uid(u1) }); // só 11 dias: ainda não cobra

  avaliarAlertasNotaFiscal(db, '2026-10-12');
  const de = (u) => db.prepare('SELECT tipo, titulo, mensagem, licitacao_id FROM notificacoes WHERE usuario_id=? ORDER BY id').all(uid(u));
  const ana = de(u1); const bia = de(u2);
  // card com responsável: só ela; sem responsável: toda a equipe
  assert.deepEqual(ana.map((n) => n.tipo), ['nota_emitir', 'nota_emitir', 'nota_emitir', 'nota_cobrar']);
  assert.deepEqual(bia.map((n) => n.tipo), ['nota_emitir']);
  assert.match(ana[1].titulo, /entregue há 7 dias/);
  assert.match(ana[2].mensagem, /Data de entrega não informada/);
  assert.match(ana[3].titulo, /há 35 dias/);
  assert.match(ana[3].mensagem, /Nota nº 123 de 07\/09\/2026/);

  // Rodar de novo não duplica
  avaliarAlertasNotaFiscal(db, '2026-10-12');
  assert.equal(de(u1).length, 4);
  // 06/11: a nota de 07/09 chega a 60 dias e a de 01/10 a 36 dias → mais duas cobranças
  avaliarAlertasNotaFiscal(db, '2026-11-06');
  assert.deepEqual(de(u1).filter((n) => n.tipo === 'nota_cobrar').map((n) => n.titulo),
    ['Pagamento não recebido: nota emitida há 35 dias', 'Pagamento não recebido: nota emitida há 60 dias', 'Pagamento não recebido: nota emitida há 36 dias']);

  // Na tela, cada um ganha a categoria e o objeto da licitação
  const lista = listarNotificacoes(db, uid(u1));
  assert.ok(lista.every((n) => n.categoria === n.tipo));
  assert.ok(lista.some((n) => n.tipo === 'nota_cobrar' && n.lic_objeto === 'Objeto c' && n.lic_orgao === 'Prefeitura de Teste'));

  // Emitiu a nota → "Emitir" some; recebeu → "Cobrar" some
  db.prepare('UPDATE oportunidades SET etapa_id=? WHERE id=?').run(etapa('faturada'), entregue);
  db.prepare('UPDATE oportunidades SET etapa_id=? WHERE id=?').run(etapa('recebida'), nota35);
  const depois = listarNotificacoes(db, uid(u1));
  assert.deepEqual(depois.filter((n) => n.tipo === 'nota_cobrar').map((n) => n.lic_objeto), ['Objeto d']); // a nota de 01/10 segue em aberto
  assert.equal(depois.filter((n) => n.tipo === 'nota_emitir').length, 1); // só o card sem data, ainda em "entregue"
  assert.ok(semData);
});
