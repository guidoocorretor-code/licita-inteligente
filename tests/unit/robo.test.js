import test from 'node:test';
import assert from 'node:assert/strict';
import { decidir, proximoValor } from '../../web/js/robo-estrategia.js';

const base = { agora: 1000, piso: 850, meuLance: 950, meuLanceEm: 900, melhor: 940, melhorEhMeu: false, melhorEm: 990 };

test('robô: só dá lance nos últimos 40 s', () => {
  assert.equal(decidir({ ...base, restante: 41 }).acao, 'aguardar');
  const d = decidir({ ...base, restante: 40 }, { decremento: 1 });
  assert.deepEqual([d.acao, d.valor], ['lance', 939]);
});

test('robô: respeita 20 s entre os próprios lances e 3 s depois do melhor lance', () => {
  assert.equal(decidir({ ...base, restante: 30, meuLanceEm: 985 }).acao, 'aguardar');   // 15 s desde o meu
  assert.equal(decidir({ ...base, restante: 30, melhorEm: 998 }).acao, 'aguardar');     // 2 s desde o melhor
  assert.equal(decidir({ ...base, restante: 30, meuLanceEm: 980, melhorEm: 997 }).acao, 'lance');
});

test('robô: nunca passa do piso e para quando o concorrente está abaixo dele', () => {
  const d = decidir({ ...base, restante: 30, melhor: 850.5 }, { decremento: 5 });
  assert.deepEqual([d.acao, d.valor], ['lance', 850]);                                     // vai até o piso, não abaixo
  assert.equal(decidir({ ...base, restante: 30, melhor: 849 }).acao, 'parar');
  assert.equal(decidir({ ...base, restante: 30, melhorEhMeu: true }).acao, 'aguardar');   // já está em 1º
  assert.equal(decidir({ ...base, restante: 30, piso: 0 }).acao, 'parar');
});

test('robô: decremento em R$ ou % arredondado para baixo no centavo', () => {
  assert.equal(proximoValor(100, { decremento: 0.5 }), 99.5);
  assert.equal(proximoValor(99.99, { decrementoPct: 1 }), 98.99);
  assert.equal(proximoValor(10, { decremento: 0 }), 9.99);                                 // mínimo de 1 centavo
});
