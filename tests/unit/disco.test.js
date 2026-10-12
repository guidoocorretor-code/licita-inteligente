// Tamanho do que ocupa o disco (card "Disco do servidor" em Configurações).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tamanhoDe } from '../../server/lib/disco.js';

test('tamanho de arquivo, pasta (soma recursiva) e de algo que não existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-'));
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'x'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'a', 'b', 'y'), Buffer.alloc(50));
  assert.equal(tamanhoDe(path.join(dir, 'a', 'x')), 100);
  assert.equal(tamanhoDe(dir), 150);
  assert.equal(tamanhoDe(path.join(dir, 'nada')), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
