import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria } from '../helpers.js';
import { configuracaoInicial } from '../../server/bootstrap.js';

test('configuração inicial cria o admin uma única vez a partir do ambiente', () => {
  const db = bancoMemoria();
  const env = { ADMIN_EMAIL: 'admin@exemplo.com', ADMIN_SENHA: 'SenhaForte2026', ADMIN_NOME: 'Guido', EMPRESA_NOME: 'Torres e Cunha' };
  const msgs = configuracaoInicial(db, env);
  assert.ok(msgs.some((m) => m.includes('admin@exemplo.com')));
  assert.ok(!msgs.join(' ').includes('SenhaForte2026'), 'a senha nunca aparece no log');
  const u = db.prepare('SELECT papel, empresa_id FROM usuarios').all();
  assert.equal(u.length, 1); assert.equal(u[0].papel, 'admin');
  assert.ok(db.prepare('SELECT COUNT(*) n FROM kanban_etapas WHERE empresa_id=?').get(u[0].empresa_id).n >= 12);
  // segunda inicialização (reinício do servidor) não cria nem altera nada
  assert.deepEqual(configuracaoInicial(db, { ...env, ADMIN_SENHA: 'OutraSenha2026' }), []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 1);
});

test('PNCP_UFS limita a fonte só antes da primeira sincronização', () => {
  const db = bancoMemoria();
  configuracaoInicial(db, { PNCP_UFS: 'es, rj, xx1' });
  const cfg = () => JSON.parse(db.prepare("SELECT config_json FROM fontes WHERE codigo='pncp'").get().config_json);
  assert.deepEqual(cfg().ufs, ['ES', 'RJ']);
  db.prepare("UPDATE fontes SET ultima_sincronizacao=datetime('now'), config_json=? WHERE codigo='pncp'").run(JSON.stringify({ ...cfg(), ufs: ['MG'] }));
  configuracaoInicial(db, { PNCP_UFS: 'ES' });
  assert.deepEqual(cfg().ufs, ['MG'], 'não sobrescreve a escolha do administrador');
});

test('sem variáveis de ambiente não cria usuário', () => {
  const db = bancoMemoria();
  assert.deepEqual(configuracaoInicial(db, {}), []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 0);
});
