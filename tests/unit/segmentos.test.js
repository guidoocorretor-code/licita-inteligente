// Nicho estimado pelo objeto: casos reais que caíam errado em "Obras e engenharia" (jornal Obras do Guido, 12/10/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classificarSegmento, reclassificarSegmentos } from '../../server/services/segmentos.js';
import { bancoMemoria } from '../helpers.js';

const OBRAS = 'Obras e engenharia';
test('obras: palavra inteira e sem os falsos positivos', () => {
  for (const o of ['Reforma da escola municipal', 'CONSTRUÇÃO DE UNIDADE BÁSICA DE SAÚDE', 'Pavimentação asfáltica da Rua A',
    'Contratação de empresa de engenharia para drenagem', 'Executar os serviços remanescentes necessários à conclusão da UBS',
    'Retirada do forro existente e instalação de novo forro em PVC', 'Manutenção predial preventiva']) assert.equal(classificarSegmento(o), OBRAS, o);
  for (const o of ['Prestação de serviços de portaria, com dedicação exclusiva de mão de obra',
    'Seguro patrimonial para as instalações e edificações', 'Serviços de obras pirotécnicas com fogos de artifício',
    'Licenças dos softwares Autodesk Architecture, Engineering & Construction Collection',
    'Manobra de veículos no pátio', 'Aquisição de cadeiras para a Secretaria Municipal de Obras',
    'Aquisição de servidores para o Data Center do Departamento de Edificações e de Rodovias do ES', 'Aquisição de mobiliário e ar condicionado']) assert.notEqual(classificarSegmento(o), OBRAS, o);
});

test('reclassificação do que já está no banco', () => {
  const db = bancoMemoria();
  const id = Number(db.prepare("INSERT INTO licitacoes (chave_canonica, objeto, segmento) VALUES ('x', 'Serviços de portaria com mão de obra', ?)").run(OBRAS).lastInsertRowid);
  const r = reclassificarSegmentos(db, 0, 100);
  assert.equal(r.mudou, 1); assert.equal(r.fim, true);
  assert.notEqual(db.prepare('SELECT segmento FROM licitacoes WHERE id=?').get(id).segmento, OBRAS);
});
