// Ponto de entrada no contêiner: se iniciou como root (necessário para ajustar o volume montado
// pela hospedagem), passa a rodar como o usuário sem privilégios "node" antes de abrir o banco.
if (process.getuid?.() === 0) {
  process.initgroups('node', 'node');
  process.setgid('node');
  process.setuid('node');
}
await import('../server/index.js');
