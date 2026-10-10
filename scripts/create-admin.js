// Uso: npm run create-admin -- "Nome da Empresa" "Seu Nome" email@dominio.com "SenhaForte123"
import { getDb } from '../server/db/index.js';
import { criarUsuario } from '../server/lib/auth.js';
import { garantirEtapas } from '../server/routes/api.js';

const [empresa, nome, email, senha] = process.argv.slice(2);
if (!empresa || !nome || !email || !senha) {
  console.error('Uso: npm run create-admin -- "Empresa" "Nome" email senha'); process.exit(1);
}
const db = getDb();
let emp = db.prepare('SELECT id FROM empresas WHERE nome=?').get(empresa);
if (!emp) emp = { id: Number(db.prepare('INSERT INTO empresas (nome) VALUES (?)').run(empresa).lastInsertRowid) };
garantirEtapas(db, emp.id);
const id = criarUsuario(db, { empresaId: emp.id, nome, email, senha, papel: 'admin' });
console.log(`Administrador criado (id ${id}) na empresa "${empresa}".`);
