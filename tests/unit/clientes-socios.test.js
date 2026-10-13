// Sócios e responsável financeiro no cadastro da empresa. DADOS DE TESTE fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { criarCliente, atualizarCliente } from '../../server/services/clientes.js';

function cenario() {
  const db = bancoMemoria();
  const emp = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  return { db, emp };
}
const base = { cnpj: '11.222.333/0001-81', razao_social: 'Empresa Teste Ltda' };

test('grava sócios (administrador, assinatura) e responsável financeiro', () => {
  const { db, emp } = cenario();
  const id = criarCliente(db, emp, { ...base, pix: '11.222.333/0001-81', fin_nome: 'Maria Teste', fin_cargo: 'Financeiro', fin_email: 'fin@teste.com', fin_telefone: '27 99999-0000',
    socios: [{ nome: 'João Teste', cpf: '123.456.789-09', qualificacao: 'Sócio-Administrador', administrador: true, assinatura: 'isolada' },
      { nome: 'Ana Teste', administrador: false, assinatura: 'qualquer' }, { nome: '   ' }] });
  const c = db.prepare('SELECT * FROM clientes WHERE id=?').get(id);
  const s = JSON.parse(c.socios_json);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].cpf, s[0].administrador, s[0].assinatura], ['12345678909', true, 'isolada']);
  assert.deepEqual([s[1].cpf, s[1].administrador, s[1].assinatura], [null, false, null]);
  assert.equal(c.fin_nome, 'Maria Teste'); assert.equal(c.fin_email, 'fin@teste.com'); assert.equal(c.pix, '11.222.333/0001-81');
  // Editar sem mandar sócios mantém; lista vazia apaga
  atualizarCliente(db, emp, id, { observacoes: 'x' });
  assert.equal(JSON.parse(db.prepare('SELECT socios_json FROM clientes WHERE id=?').get(id).socios_json).length, 2);
  atualizarCliente(db, emp, id, { socios: [] });
  assert.equal(db.prepare('SELECT socios_json FROM clientes WHERE id=?').get(id).socios_json, null);
});

test('valida CPF do sócio e e-mail do financeiro', () => {
  const { db, emp } = cenario();
  assert.throws(() => criarCliente(db, emp, { ...base, socios: [{ nome: 'João', cpf: '123' }] }), /CPF do sócio João/);
  assert.throws(() => criarCliente(db, emp, { ...base, fin_email: 'errado' }), /E-mail inválido/);
});
