// Busca no catálogo da Análise de mercado: material antes dos serviços que só citam as palavras
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { buscarCatalogo } from '../../server/services/precos.js';

function semear(db) {
  const ins = db.prepare('INSERT INTO catalogo_compras (tipo, codigo, nome, classe, grupo) VALUES (?,?,?,?,?)');
  ins.run('servico', 26824, 'OUTSOURCING DE IMPRESSAO - LOCACAO PAGINAS IMPRESSAS A4 MONOCROMATICA COM PAPEL', 'OUTSOURCING', null);
  ins.run('servico', 26859, 'OUTSOURCING DE IMPRESSAO - LOCACAO PAGINAS IMPRESSAS A4 POLICROMATICA SEM PAPEL', 'OUTSOURCING', null);
  ins.run('material', 19746, 'PAPEL PARA IMPRESSÃO FORMATADO', 'PAPEIS E PAPELOES', null);
  ins.run('material', 127, 'PAPEL A4', 'PAPEIS E PAPELOES', null);
}

test('papel a4: materiais primeiro (sugerido no topo), serviços depois', () => {
  const db = bancoMemoria(); semear(db);
  const r = buscarCatalogo(db, 'papel a4');
  assert.equal(r[0].codigo, 19746);
  assert.ok(r[0].sugerido);
  const primeiroServico = r.findIndex((x) => x.tipo === 'servico');
  const ultimoMaterial = r.map((x) => x.tipo).lastIndexOf('material');
  assert.ok(primeiroServico > ultimoMaterial, JSON.stringify(r.map((x) => x.codigo)));
});

test('busca que fala em serviço mantém a relevância', () => {
  const db = bancoMemoria(); semear(db);
  const r = buscarCatalogo(db, 'outsourcing impressao');
  assert.equal(r[0].tipo, 'servico');
});
