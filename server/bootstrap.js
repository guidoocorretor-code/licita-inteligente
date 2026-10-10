// Configuração inicial a partir de variáveis de ambiente, para hospedagens sem acesso a terminal (ex.: Railway).
// Só age em banco novo: nunca altera usuários ou fontes que já existem.
import { criarUsuario } from './lib/auth.js';
import { garantirEtapas } from './routes/api.js';

export function configuracaoInicial(db, env = process.env) {
  const msgs = [];
  const temUsuario = db.prepare('SELECT 1 FROM usuarios LIMIT 1').get();
  if (!temUsuario && env.ADMIN_EMAIL && env.ADMIN_SENHA) {
    const empresa = env.EMPRESA_NOME || 'Minha empresa';
    let emp = db.prepare('SELECT id FROM empresas WHERE nome=?').get(empresa);
    if (!emp) emp = { id: Number(db.prepare('INSERT INTO empresas (nome) VALUES (?)').run(empresa).lastInsertRowid) };
    garantirEtapas(db, emp.id);
    criarUsuario(db, { empresaId: emp.id, nome: env.ADMIN_NOME || 'Administrador', email: env.ADMIN_EMAIL, senha: env.ADMIN_SENHA, papel: 'admin' });
    msgs.push(`Administrador inicial criado: ${env.ADMIN_EMAIL}`); // a senha nunca é registrada
  }
  // PNCP_UFS=ES,RJ limita a fonte PNCP às UFs informadas enquanto ela nunca tiver sincronizado.
  if (env.PNCP_UFS) {
    const f = db.prepare("SELECT config_json, ultima_sincronizacao FROM fontes WHERE codigo='pncp'").get();
    if (f && !f.ultima_sincronizacao) {
      const ufs = env.PNCP_UFS.split(',').map((u) => u.trim().toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u));
      const cfg = { ...JSON.parse(f.config_json || '{}'), ufs };
      db.prepare("UPDATE fontes SET config_json=? WHERE codigo='pncp'").run(JSON.stringify(cfg));
      msgs.push(`PNCP limitado às UFs: ${ufs.join(', ')}`);
    }
  }
  return msgs;
}
