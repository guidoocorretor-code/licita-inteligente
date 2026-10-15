import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Arquivos de teste vão para uma pasta temporária (STORAGE_DIR precisa existir antes de carregar a configuração)
const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'licita-capt-'));
process.env.STORAGE_DIR = PASTA;
delete process.env.BREVO_API_KEY; delete process.env.SMTP_URL;
const { bancoMemoria } = await import('../helpers.js');
const { criarApp } = await import('../../server/app.js');
const { criarUsuario } = await import('../../server/lib/auth.js');
const { validarCpf, statusGeral, enviarPorEmail } = await import('../../server/services/captacao.js');
const { montarDocumento, parteCliente, parteMinhaEmpresa, dadosIniciais, PODERES } = await import('../../server/services/captacao-modelos.js');
const { lerJpeg } = await import('../../server/lib/pdf-simples.js');
const { _reiniciarEmail } = await import('../../server/services/email.js');

// DADOS DE TESTE: CPFs e CNPJs de exemplo com dígitos válidos (não são pessoas ou empresas reais cadastradas aqui)
const CPF_A = '529.982.247-25'; const CPF_B = '111.444.777-35';
const CNPJ_ME = '11.222.333/0001-81'; const CNPJ_CLI = '11444777000161';
const SENHA = 'SenhaForte123';
const LOGO = fs.readFileSync(new URL('../fixtures/logo-teste.jpg', import.meta.url));
let base; let servidor; let db; let clienteAntigo;

test.before(async () => {
  db = bancoMemoria();
  const e1 = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Assessoria')").run().lastInsertRowid);
  const e2 = Number(db.prepare("INSERT INTO empresas (nome) VALUES ('Outra conta')").run().lastInsertRowid);
  criarUsuario(db, { empresaId: e1, nome: 'Guido Teste', email: 'g@a.com', senha: SENHA, papel: 'admin' });
  criarUsuario(db, { empresaId: e1, nome: 'Leitor', email: 'l@a.com', senha: SENHA, papel: 'leitor' });
  criarUsuario(db, { empresaId: e2, nome: 'Intruso', email: 'i@b.com', senha: SENHA, papel: 'admin' });
  // Empresa assessorada que já existia antes do módulo (precisa continuar igual)
  clienteAntigo = Number(db.prepare("INSERT INTO clientes (empresa_id, cnpj, razao_social, nome_fantasia, email) VALUES (?, '11222333000181', 'INFOPEL TESTE LTDA', 'INFOPEL', 'x@y.com')").run(e1).lastInsertRowid);
  servidor = criarApp().listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { servidor.close(); fs.rmSync(PASTA, { recursive: true, force: true }); _reiniciarEmail(); });

async function entrar(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'licita' }, body: JSON.stringify({ email, senha: SENHA }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const api = (p, opts = {}) => fetch(`${base}/api${p}`, { ...opts, headers: { cookie, 'x-requested-with': 'licita',
    ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });
  api.json = async (p, opts = {}) => {
    const o = { ...opts }; if (o.corpo) { o.body = JSON.stringify(o.corpo); delete o.corpo; }
    const r = await api(p, o); return { status: r.status, corpo: await r.json() };
  };
  return api;
}
const ME_PJ = { tipo_pessoa: 'PJ', nome: 'ASSESSORIA TESTE LTDA', nome_fantasia: 'Assessoria Teste', documento: CNPJ_ME, endereco: 'Rua A, 10', bairro: 'Centro',
  municipio: 'Vila Velha', uf: 'ES', cep: '29100-000', representante_nome: 'Fulano de Tal', representante_cpf: CPF_A, representante_cargo: 'Sócio',
  telefone: '27999990000', email: 'contato@assessoria.teste' };
const CLI = { tipo_pessoa: 'PJ', documento: CNPJ_CLI, razao_social: 'CLIENTE TESTE LTDA', nome_fantasia: 'Cliente Teste', endereco: 'Av. B, 200', municipio: 'Vitória', uf: 'ES',
  cep: '29000000', resp_nome: 'Beltrana Souza', resp_cpf: CPF_B, resp_cargo: 'Administradora', telefone: '27988887777', email: 'cliente@teste.com', email_documentos: 'docs@teste.com' };

test('CPF: confere os dígitos verificadores', () => {
  assert.equal(validarCpf(CPF_A), '52998224725');
  assert.equal(validarCpf('529.982.247-24'), null);
  assert.equal(validarCpf('111.111.111-11'), null);
});

test('JPEG: lê o tamanho da logo e recusa o que não é JPEG', () => {
  const i = lerJpeg(LOGO);
  assert.deepEqual([i.largura, i.altura, i.cores], [40, 16, 3]);
  assert.equal(lerJpeg(Buffer.from('%PDF-1.4')), null);
});

test('Minha Empresa: PJ e PF com campos obrigatórios, banco tudo-ou-nada, logo e dados protegidos', async () => {
  const api = await entrar('g@a.com');
  let r = await api.json('/minhas-empresas', { method: 'POST', corpo: { ...ME_PJ, representante_cpf: '' } });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /CPF do representante/);
  r = await api.json('/minhas-empresas', { method: 'POST', corpo: { ...ME_PJ, banco: 'Banco X' } });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /bancários incompletos/);
  r = await api.json('/minhas-empresas', { method: 'POST', corpo: { ...ME_PJ, banco: 'Banco X', agencia: '1', conta: '2-3', tipo_conta: 'corrente', titular: 'ASSESSORIA TESTE LTDA', titular_documento: CNPJ_ME } });
  assert.equal(r.status, 201);
  const idPj = r.corpo.id;
  // PF: sem representante; CPF obrigatório e válido
  r = await api.json('/minhas-empresas', { method: 'POST', corpo: { tipo_pessoa: 'PF', nome: 'Guido Exemplo', documento: '123', endereco: 'Rua C', municipio: 'Vila Velha', uf: 'ES', telefone: '27', email: 'g@x.com' } });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /CPF inválido/);
  r = await api.json('/minhas-empresas', { method: 'POST', corpo: { tipo_pessoa: 'PF', nome: 'Guido Exemplo', documento: CPF_A, endereco: 'Rua C', municipio: 'Vila Velha', uf: 'ES', telefone: '27999990000', email: 'g@x.com' } });
  assert.equal(r.status, 201);
  // Logo: aceita JPEG, recusa outro arquivo, troca e remove
  const fd = (buf, nome) => { const f = new FormData(); f.append('arquivo', new Blob([buf]), nome); return f; };
  assert.equal((await api.json(`/minhas-empresas/${idPj}/logo`, { method: 'POST', body: fd(Buffer.from('nao e imagem'), 'x.png') })).status, 400);
  assert.equal((await api.json(`/minhas-empresas/${idPj}/logo`, { method: 'POST', body: fd(LOGO, 'logo.jpg') })).status, 200);
  assert.equal((await api(`/minhas-empresas/${idPj}/logo`)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await api.json(`/minhas-empresas/${idPj}/logo`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/minhas-empresas/${idPj}/logo`)).status, 404);
  assert.equal((await api.json(`/minhas-empresas/${idPj}/logo`, { method: 'POST', body: fd(LOGO, 'logo.jpg') })).status, 200);
  // Leitor não edita nem vê banco
  const leitor = await entrar('l@a.com');
  assert.equal((await leitor.json(`/minhas-empresas/${idPj}`, { method: 'PATCH', corpo: { nome: 'X' } })).status, 403);
  const vis = (await leitor.json('/minhas-empresas')).corpo.empresas.find((m) => m.id === idPj);
  assert.equal(vis.banco, null); assert.equal(vis.conta, null); assert.equal(vis.tem_banco, true);
  // Outra conta não enxerga
  const intruso = await entrar('i@b.com');
  assert.equal((await intruso.json('/minhas-empresas')).corpo.empresas.length, 0);
  assert.equal((await intruso(`/minhas-empresas/${idPj}/logo`)).status, 404);
});

test('Captação completa: empresa nova, sem duplicar, documentos, PDF, e-mail, assinatura e histórico', async () => {
  const api = await entrar('g@a.com');
  const me = (await api.json('/minhas-empresas')).corpo.empresas.find((m) => m.tipo_pessoa === 'PJ');
  // Passo 1: empresa nova
  let r = await api.json('/captacoes/empresa', { method: 'POST', corpo: { ...CLI, documento: '11444777000162' } });
  assert.equal(r.status, 400);
  r = await api.json('/captacoes/empresa', { method: 'POST', corpo: CLI });
  assert.equal(r.status, 201);
  const cli = r.corpo.cliente_id;
  // Mesmo CNPJ de novo: não duplica, mostra a existente e as diferenças
  r = await api.json('/captacoes/empresa', { method: 'POST', corpo: { ...CLI, telefone: '27911112222' } });
  assert.equal(r.status, 409); assert.equal(r.corpo.existente.id, cli);
  assert.deepEqual(r.corpo.existente.diferencas.map((d) => d.campo), ['telefone']);
  r = await api.json('/captacoes/conferir-empresa', { method: 'POST', corpo: { tipo_pessoa: 'PJ', documento: CNPJ_CLI } });
  assert.equal(r.corpo.existente.id, cli);
  r = await api.json(`/captacoes/empresa/${cli}/atualizar`, { method: 'POST', corpo: { dados: { ...CLI, telefone: '27911112222' }, campos: ['telefone'] } });
  assert.deepEqual(r.corpo.campos, ['telefone']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM clientes WHERE cnpj=?').get(CNPJ_CLI).n, 1);
  assert.equal(db.prepare('SELECT telefone FROM clientes WHERE id=?').get(cli).telefone, '27911112222');

  // Passo 2 e 3: captação com Minha Empresa e três documentos
  r = await api.json('/captacoes', { method: 'POST', corpo: { cliente_id: cli, minha_empresa_id: me.id } });
  const cap = r.corpo.id;
  r = await api.json(`/captacoes/${cap}/documentos`, { method: 'POST', corpo: { tipos: ['proposta', 'contrato', 'procuracao'] } });
  assert.equal(r.corpo.ids.length, 3);
  const [prop, cont, proc] = r.corpo.ids;
  let det = (await api.json(`/captacoes/${cap}`)).corpo;
  assert.equal(det.captacao.status, 'em_preparacao');
  assert.deepEqual(det.documentos.map((d) => d.numero), ['001/2026', '001/2026', '001/2026'].map((n) => n.replace('2026', String(det.documentos[0].ano))));

  // Passo 4: pendências bloqueiam a geração; procuração sem nenhum poder marcado
  let pv = (await api.json(`/captacao-documentos/${proc}/previa`)).corpo;
  assert.ok(pv.pendencias.includes('Poderes concedidos (marque um a um)'));
  assert.deepEqual(pv.dados.poderes, undefined);
  assert.equal(pv.dados.outorgado_nome, 'Fulano de Tal'); // representante da Minha Empresa PJ
  r = await api.json(`/captacao-documentos/${proc}/gerar`, { method: 'POST' });
  assert.equal(r.status, 400); assert.ok(r.corpo.pendencias.length);
  await api.json(`/captacao-documentos/${proc}/dados`, { method: 'PUT', corpo: { poderes: ['propostas', 'lances'], prazo_meses: 12 } });
  pv = (await api.json(`/captacao-documentos/${proc}/previa`)).corpo;
  assert.deepEqual(pv.pendencias, []);
  const lim = pv.secoes.find((s) => s.id === 'limites').paragrafos[0];
  assert.match(lim, /desistir de lances/); assert.match(lim, /assinar contratos/); assert.match(lim, /substabelecer/);
  assert.equal(pv.secoes.find((s) => s.id === 'poderes').lista.length, 2);

  // Proposta: sem remuneração não gera; com valores, gera PDF A4 com logo e número
  await api.json(`/captacao-documentos/${prop}/dados`, { method: 'PUT', corpo: { modalidades: ['Pregão Eletrônico'], servicos: ['oportunidades', 'sessao'], antecedencia_horas: 48 } });
  pv = (await api.json(`/captacao-documentos/${prop}/previa`)).corpo;
  assert.ok(pv.pendencias.some((p) => /Remuneração/.test(p)));
  await api.json(`/captacao-documentos/${prop}/dados`, { method: 'PUT', corpo: { valor_mensal: '1.500,00', percentual_exito: 3, incluir_banco: true } });
  // Rascunho preserva o que foi digitado
  pv = (await api.json(`/captacao-documentos/${prop}/previa`)).corpo;
  assert.equal(pv.dados.valor_mensal, 1500); assert.deepEqual(pv.dados.servicos, ['oportunidades', 'sessao']);
  assert.ok(pv.secoes.some((s) => s.id === 'banco'));
  assert.ok(pv.secoes.find((s) => s.id === 'limites').paragrafos.some((p) => /não garante a vitória/.test(p)));
  r = await api.json(`/captacao-documentos/${prop}/gerar`, { method: 'POST' });
  assert.equal(r.status, 200); assert.ok(r.corpo.paginas >= 1 && r.corpo.paginas <= 2, `proposta com ${r.corpo.paginas} páginas`);
  let arq = await api(`/captacao-documentos/${prop}/arquivo`);
  assert.equal(arq.headers.get('content-type'), 'application/pdf');
  assert.match(arq.headers.get('cache-control'), /no-store/);
  const pdf = Buffer.from(await arq.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
  assert.match(pdf.toString('latin1'), /R\$ 1\.500,00/);
  assert.match(pdf.toString('latin1'), /11\.444\.777\/0001-61/);

  // Snapshot: mudar o cadastro depois não altera o documento emitido
  await api.json(`/clientes/${cli}`, { method: 'PATCH', corpo: { razao_social: 'NOME NOVO LTDA' } });
  const snap = JSON.parse(db.prepare('SELECT snapshot_json FROM captacao_documentos WHERE id=?').get(prop).snapshot_json);
  assert.equal(snap.cliente.nome, 'CLIENTE TESTE LTDA');
  const pdf2 = Buffer.from(await (await api(`/captacao-documentos/${prop}/arquivo`)).arrayBuffer());
  assert.ok(pdf.equals(pdf2));

  // Contrato e procuração: gera dentro da meta de páginas
  await api.json(`/captacao-documentos/${cont}/dados`, { method: 'PUT', corpo: { modalidades: ['Pregão Eletrônico', 'Dispensa Eletrônica'], servicos: Object.keys((await import('../../server/services/captacao-modelos.js')).SERVICOS),
    antecedencia_horas: 72, valor_mensal: 1500, percentual_exito: 5, vigencia_meses: 6, multa_atraso_pct: 2 } });
  r = await api.json(`/captacao-documentos/${cont}/gerar`, { method: 'POST' });
  assert.equal(r.status, 200); assert.ok(r.corpo.paginas <= 3, `contrato com ${r.corpo.paginas} páginas`);
  r = await api.json(`/captacao-documentos/${proc}/gerar`, { method: 'POST' });
  assert.equal(r.status, 200); assert.ok(r.corpo.paginas <= 2, `procuração com ${r.corpo.paginas} páginas`);
  det = (await api.json(`/captacoes/${cap}`)).corpo;
  assert.equal(det.captacao.status, 'proposta_gerada');

  // E-mail sem provedor configurado: avisa e NÃO marca como enviado
  const em = (await api.json(`/captacao-documentos/${cont}/email`)).corpo;
  assert.equal(em.para, 'docs@teste.com'); assert.match(em.mensagem, /assinador\.iti\.br/);
  r = await api.json(`/captacao-documentos/${cont}/enviar`, { method: 'POST', corpo: { para: em.para, assunto: em.assunto, mensagem: em.mensagem, confirmado: true, pedir_assinatura: true } });
  assert.equal(r.status, 503); assert.match(r.corpo.erro, /NÃO foi enviado/);
  assert.equal(db.prepare('SELECT status FROM captacao_documentos WHERE id=?').get(cont).status, 'gerado');
  // Sem confirmar o destinatário não envia
  r = await api.json(`/captacao-documentos/${cont}/enviar`, { method: 'POST', corpo: { para: em.para, assunto: 'x', mensagem: 'y' } });
  assert.equal(r.status, 400);
  // Com provedor (falso): envia com o PDF anexo e registra
  const enviados = [];
  await enviarPorEmail(db, 1, cont, 1, { para: em.para, assunto: em.assunto, mensagem: em.mensagem, confirmado: true, pedir_assinatura: true }, { enviarEmail: async (m) => enviados.push(m) });
  assert.equal(enviados[0].anexos[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.equal(enviados[0].responderPara, 'contato@assessoria.teste');
  assert.equal(db.prepare('SELECT status FROM captacao_documentos WHERE id=?').get(cont).status, 'aguardando_assinatura');
  const ev = db.prepare("SELECT destinatario, resultado FROM captacao_eventos WHERE documento_id=? AND tipo='envio' ORDER BY id").all(cont);
  assert.deepEqual(ev.map((e) => e.resultado), ['falha', 'ok']);

  // Assinado: PDF sem assinatura digital é recusado sem confirmação; com assinatura é aceito e o original fica guardado
  const fd = (buf, extra = {}) => { const f = new FormData(); f.append('arquivo', new Blob([buf]), 'assinado.pdf'); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };
  const original = Buffer.from(await (await api(`/captacao-documentos/${cont}/arquivo`)).arrayBuffer());
  r = await api.json(`/captacao-documentos/${cont}/assinado`, { method: 'POST', body: fd(original) });
  assert.equal(r.status, 422); assert.equal(r.corpo.sem_assinatura, true);
  assert.equal(db.prepare('SELECT status FROM captacao_documentos WHERE id=?').get(cont).status, 'aguardando_assinatura');
  r = await api.json(`/captacao-documentos/${cont}/assinado`, { method: 'POST', body: fd(Buffer.from('nao e pdf')) });
  assert.equal(r.status, 400);
  const assinado = Buffer.concat([original, Buffer.from('\n9 0 obj << /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 10 20 30] >> endobj\n%%EOF\n')]);
  r = await api.json(`/captacao-documentos/${cont}/assinado`, { method: 'POST', body: fd(assinado) });
  assert.equal(r.status, 200); assert.equal(r.corpo.assinatura_detectada, true); assert.equal(r.corpo.contem_original, 1);
  det = (await api.json(`/captacoes/${cap}`)).corpo;
  const dc = det.documentos.find((d) => d.id === cont);
  assert.equal(dc.status, 'assinado');
  const arqAss = dc.arquivos.find((a) => a.tipo === 'assinado');
  const baixado = Buffer.from(await (await api(`/captacao-documentos/${cont}/arquivo?arquivo=${arqAss.id}`)).arrayBuffer());
  assert.ok(baixado.equals(assinado), 'o arquivo assinado é guardado sem alteração');
  // Documento assinado não muda
  assert.equal((await api.json(`/captacao-documentos/${cont}/dados`, { method: 'PUT', corpo: { vigencia_meses: 12 } })).status, 400);

  // Editar documento gerado cria versão nova e o PDF anterior fica no histórico
  await api.json(`/captacao-documentos/${prop}/dados`, { method: 'PUT', corpo: { validade_dias: 30 } });
  det = (await api.json(`/captacoes/${cap}`)).corpo;
  const dp = det.documentos.find((d) => d.id === prop);
  assert.equal(dp.status, 'rascunho'); assert.equal(dp.versao, 2); assert.equal(dp.arquivos.length, 1);
  assert.equal(det.captacao.status, 'em_preparacao');

  // Histórico com filtros
  let h = (await api.json('/captacoes?q=nome novo')).corpo.captacoes;
  assert.equal(h.length, 1); // busca pelo nome atual do cadastro
  assert.equal((await api.json('/captacoes?q=inexistente')).corpo.captacoes.length, 0);
  h = (await api.json('/captacoes?q=11444777')).corpo.captacoes;
  assert.equal(h.length, 1); assert.equal(h[0].documentos.length, 3);
  assert.equal((await api.json('/captacoes?tipo=contrato')).corpo.captacoes.length, 1);
  assert.equal((await api.json('/captacoes?status=cancelado')).corpo.captacoes.length, 0);
  assert.equal((await api.json(`/clientes/${cli}/captacoes`)).corpo.captacoes.length, 1);

  // Isolamento: outra conta não vê nem baixa
  const intruso = await entrar('i@b.com');
  assert.equal((await intruso.json(`/captacoes/${cap}`)).status, 404);
  assert.equal((await intruso(`/captacao-documentos/${prop}/arquivo`)).status, 404);
  assert.equal((await intruso.json('/captacoes')).corpo.captacoes.length, 0);
  // Sem login: nada
  assert.equal((await fetch(`${base}/api/captacao-documentos/${prop}/arquivo`)).status, 401);

  // Empresa com captação não é excluída (arquivar em vez de excluir)
  r = await api.json(`/clientes/${cli}`, { method: 'DELETE' });
  assert.equal(r.status, 400);

  // Cancelar exige motivo; excluir só depois de cancelar (apaga os arquivos)
  assert.equal((await api.json(`/captacoes/${cap}/cancelar`, { method: 'POST', corpo: { motivo: '' } })).status, 400);
  assert.equal((await api.json(`/captacoes/${cap}`, { method: 'DELETE' })).status, 400);
  await api.json(`/captacoes/${cap}/cancelar`, { method: 'POST', corpo: { motivo: 'Cliente desistiu' } });
  assert.equal((await api.json(`/captacoes/${cap}`)).corpo.captacao.status, 'cancelado');
  assert.equal((await api.json(`/captacoes/${cap}`, { method: 'DELETE' })).status, 200);
  assert.equal(fs.existsSync(path.join(PASTA, 'captacoes', String(cap))), false);
});

test('Empresas antigas continuam intactas e a captação aceita empresa existente e pessoa física', async () => {
  const api = await entrar('g@a.com');
  const c = db.prepare('SELECT * FROM clientes WHERE id=?').get(clienteAntigo);
  assert.equal(c.razao_social, 'INFOPEL TESTE LTDA'); assert.equal(c.tipo_pessoa, 'PJ');
  const lista = (await api.json('/clientes')).corpo.clientes;
  assert.ok(lista.some((x) => x.id === clienteAntigo));
  let r = await api.json('/captacoes', { method: 'POST', corpo: { cliente_id: clienteAntigo } });
  assert.equal(r.status, 201);
  // Cadastro incompleto (sem endereço/representante) aparece como tal
  await api.json('/captacoes/' + r.corpo.id + '/documentos', { method: 'POST', corpo: { tipos: ['proposta'] } });
  assert.equal((await api.json(`/captacoes/${r.corpo.id}`)).corpo.captacao.status, 'cadastro_incompleto');
  // Pessoa física: CPF validado e guardado no cadastro central
  r = await api.json('/captacoes/empresa', { method: 'POST', corpo: { tipo_pessoa: 'PF', documento: CPF_B, razao_social: 'Maria Exemplo', telefone: '27999998888' } });
  assert.equal(r.status, 201);
  assert.equal(db.prepare('SELECT tipo_pessoa, cnpj FROM clientes WHERE id=?').get(r.corpo.cliente_id).tipo_pessoa, 'PF');
  // Edição comum da empresa PF continua funcionando
  assert.equal((await api.json(`/clientes/${r.corpo.cliente_id}`, { method: 'PATCH', corpo: { email: 'maria@ex.com' } })).status, 200);
});

test('Modelos: status geral, qualificação e nada inventado', () => {
  const me = parteMinhaEmpresa({ tipo_pessoa: 'PF', nome: 'Guido Exemplo', documento: '52998224725', endereco: 'Rua C', municipio: 'Vila Velha', uf: 'ES', email: 'g@x.com', telefone: '27999990000' });
  const cli = parteCliente({ tipo_pessoa: 'PJ', razao_social: 'X LTDA', cnpj: '11444777000161', endereco: 'Av B', municipio: 'Vitória', uf: 'ES', resp_nome: 'Ana', resp_cpf: '11144477735' });
  const dados = dadosIniciais('contrato', { me, hoje: '2026-10-13' });
  assert.equal(dados.foro, 'Vila Velha/ES');
  assert.equal(dados.antecedencia_horas, undefined); // 48 h ou 72 h: os modelos divergem, o usuário escolhe
  const doc = montarDocumento('contrato', { me, cli, dados, numero: '001/2026' });
  const partes = doc.secoes.find((s) => s.id === 'partes').paragrafos.join(' ');
  assert.match(partes, /11\.444\.777\/0001-61/); assert.match(partes, /529\.982\.247-25/);
  assert.doesNotMatch(doc.secoes.flatMap((s) => [...s.paragrafos, ...s.lista]).join(' '), /undefined|null|XXX|\[/);
  assert.ok(doc.pendencias.some((p) => /Antecedência/.test(p)));
  assert.ok(Object.keys(PODERES).includes('lances'));
  assert.equal(statusGeral({ cancelada_em: null, minha_empresa_id: 1 }, [{ tipo: 'proposta', status: 'enviado' }, { tipo: 'contrato', status: 'aguardando_assinatura' }],
    { razao_social: 'X', cnpj: '11444777000161', endereco: 'a', municipio: 'b', uf: 'ES', resp_nome: 'c', resp_cpf: '11144477735' }), 'proposta_enviada');
  assert.equal(statusGeral({ cancelada_em: null, minha_empresa_id: 1 }, [{ tipo: 'contrato', status: 'assinado' }], {}), 'concluido');
});

test('Captação: sócios no passo 1 (gravados, validados, comparados com o cadastro e ignorados em pessoa física)', async () => {
  const g = await entrar('g@a.com');
  const CNPJ_SOC = '45723174000110';
  const corpo = { ...CLI, documento: CNPJ_SOC, razao_social: 'SOCIOS TESTE LTDA',
    socios: [{ nome: 'Ana Sócia', cpf: CPF_A, qualificacao: 'Sócio-Administrador', administrador: true, assinatura: 'isolada' }, { nome: 'Bruno Sócio', qualificacao: 'Sócio' }, { nome: '' }] };
  // CPF de sócio incompleto é recusado
  const ruim = await g.json('/captacoes/empresa', { method: 'POST', corpo: { ...corpo, socios: [{ nome: 'X', cpf: '123' }] } });
  assert.equal(ruim.status, 400); assert.match(ruim.corpo.erro, /CPF do sócio X/);
  const r = await g.json('/captacoes/empresa', { method: 'POST', corpo });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const socios = JSON.parse(db.prepare('SELECT socios_json FROM clientes WHERE id=?').get(r.corpo.cliente_id).socios_json);
  assert.deepEqual(socios.map((s) => s.nome), ['Ana Sócia', 'Bruno Sócio']);
  assert.equal(socios[0].cpf, '52998224725'); assert.equal(socios[0].assinatura, 'isolada'); assert.equal(socios[1].cpf, null);
  // Mesmo CNPJ com outro quadro de sócios: aparece como diferença e só muda se marcado
  const conf = await g.json('/captacoes/conferir-empresa', { method: 'POST', corpo: { ...corpo, socios: [{ nome: 'Carla Nova' }] } });
  const dif = conf.corpo.existente.diferencas.find((d) => d.campo === 'socios');
  assert.equal(dif.atual, 'Ana Sócia; Bruno Sócio'); assert.equal(dif.novo, 'Carla Nova');
  await g.json(`/captacoes/empresa/${r.corpo.cliente_id}/atualizar`, { method: 'POST', corpo: { dados: { ...corpo, socios: [{ nome: 'Carla Nova' }] }, campos: ['socios'] } });
  const depois = db.prepare('SELECT socios_json, resp_nome FROM clientes WHERE id=?').get(r.corpo.cliente_id);
  assert.deepEqual(JSON.parse(depois.socios_json).map((s) => s.nome), ['Carla Nova']);
  assert.equal(depois.resp_nome, 'Beltrana Souza');
  // Pessoa física não grava sócios
  const pf = await g.json('/captacoes/empresa', { method: 'POST', corpo: { tipo_pessoa: 'PF', documento: '935.411.347-80', razao_social: 'PESSOA FISICA TESTE', telefone: '27999998888', socios: [{ nome: 'Não deve gravar' }] } });
  assert.equal(pf.status, 201, JSON.stringify(pf.corpo));
  assert.equal(db.prepare('SELECT socios_json FROM clientes WHERE id=?').get(pf.corpo.cliente_id).socios_json, null);
});

test('Procuração: OUTORGANTE e OUTORGADO saem em negrito no PDF; outros documentos não mudam', async () => {
  const { pdfDocumento } = await import('../../server/services/captacao-pdf.js');
  const me = parteMinhaEmpresa({ ...ME_PJ, nome: ME_PJ.nome, documento: '11222333000181', representante_cpf: '52998224725' });
  const cli = parteCliente({ ...CLI, cnpj: CNPJ_CLI });
  const doc = montarDocumento('procuracao', { me, cli, dados: { ...dadosIniciais('procuracao', { me: ME_PJ, hoje: '2026-10-13' }), poderes: ['sicaf'] }, numero: '001/2026' });
  const txt = Buffer.from(pdfDocumento(doc, me).pdf).toString('latin1');
  assert.match(txt, /\/F2 [\d.]+ Tf 0 0 0 rg [\d.]+ [\d.]+ Td \(OUTORGANTE\) Tj/);
  assert.match(txt, /\/F2 [\d.]+ Tf 0 0 0 rg [\d.]+ [\d.]+ Td \(OUTORGADO\) Tj/);
  assert.doesNotMatch(txt, /\/F2 [\d.]+ Tf 0 0 0 rg [\d.]+ [\d.]+ Td \(nomeia\) Tj/);
  const prop = montarDocumento('proposta', { me, cli, dados: dadosIniciais('proposta', { me: ME_PJ, hoje: '2026-10-13' }), numero: '001/2026' });
  assert.doesNotMatch(Buffer.from(pdfDocumento(prop, me).pdf).toString('latin1'), /Td \(OUTORGANTE\) Tj/);
});

test('Contrato: papéis e nomes das partes em negrito; proposta e contrato com atraso e encerramento', async () => {
  const { pdfDocumento } = await import('../../server/services/captacao-pdf.js');
  const me = parteMinhaEmpresa({ ...ME_PJ, documento: '11222333000181', representante_cpf: '52998224725' });
  const cli = parteCliente({ ...CLI, cnpj: CNPJ_CLI });
  const dc = { ...dadosIniciais('contrato', { me: ME_PJ, hoje: '2026-10-13' }), valor_mensal: 1000, vigencia_meses: 12, multa_rescisoria_pct: 50, antecedencia_horas: 48 };
  const doc = montarDocumento('contrato', { me, cli, dados: dc, numero: '001/2026' });
  const txt = Buffer.from(pdfDocumento(doc, me).pdf).toString('latin1');
  assert.match(txt, /\/F2 [\d.]+ Tf 0 0 0 rg [\d.]+ [\d.]+ Td \(CONTRATANTE\) Tj/);
  assert.match(txt, /\/F2 [\d.]+ Tf 0 0 0 rg [\d.]+ [\d.]+ Td \(CLIENTE\) Tj/); // nome da contratante em negrito
  const corpo = doc.secoes.flatMap((s) => s.paragrafos).join('\n');
  assert.match(corpo, /multa de 2% e juros de 1% ao mês/);
  assert.match(corpo, /antes de completar a vigência de 12 meses pagará à outra multa de 50%/);
  assert.match(corpo, /comissão de êxito das licitações vencidas durante a vigência, que continua devida depois do encerramento/);
  // Sem multa rescisória preenchida: aviso prévio sem indenização e nenhuma frase de multa inventada
  const sem = montarDocumento('proposta', { me, cli, dados: { ...dadosIniciais('proposta', { me: ME_PJ, hoje: '2026-10-13' }), valor_mensal: 1000 }, numero: '001/2026' });
  const cond = sem.secoes.find((s) => s.id === 'condicoes').paragrafos.join('\n');
  assert.match(cond, /30 dias de antecedência, sem indenização/);
  assert.match(cond, /Ao fim de 3 e 6 meses/);
  assert.doesNotMatch(cond, /sobre as mensalidades que faltarem/);
  assert.deepEqual(sem.destaques, []);
});

test('Quem assina: sugestão pelos sócios, escolha no documento e assinatura em conjunto', async () => {
  const { assinantesPadrao, escolherAssinantes } = await import('../../server/services/assinantes.js');
  const base = { tipo_pessoa: 'PJ', razao_social: 'DUAS SÓCIAS LTDA', cnpj: '11444777000161', endereco: 'Av B', municipio: 'Vitória', uf: 'ES' };
  const socios = [
    { nome: 'Daniela Alves', qualificacao: 'Sócio-Administrador', administrador: false },
    { nome: 'Alexandre Vareira', cpf: '52998224725', qualificacao: 'Sócio-Administrador', administrador: true, assinatura: 'isolada' },
  ];
  // Antigo "responsável legal" digitado (Daniela) não vence o sócio marcado como administrador que assina sozinho
  const c = { ...base, socios_json: JSON.stringify(socios), resp_nome: 'Daniela Alves', resp_cpf: '11144477735' };
  assert.deepEqual(assinantesPadrao(c).map((a) => a.nome), ['Alexandre Vareira']);
  // Escolha no documento: os dois, em conjunto; o CPF antigo da Daniela completa o sócio dela
  const dois = escolherAssinantes(c, ['Daniela Alves', 'Alexandre Vareira']);
  assert.deepEqual(dois.map((a) => a.cpf), ['11144477735', '52998224725']);
  // Nome que não é sócio é ignorado (volta para a sugestão)
  assert.deepEqual(escolherAssinantes(c, ['Fulano']).map((a) => a.nome), ['Alexandre Vareira']);
  // Cadastro antigo sem sócios continua usando o responsável legal
  assert.deepEqual(assinantesPadrao({ ...base, resp_nome: 'Ana', resp_cpf: '11144477735' }).map((a) => a.nome), ['Ana']);

  const me = parteMinhaEmpresa({ tipo_pessoa: 'PF', nome: 'Guido Exemplo', documento: '52998224725', endereco: 'Rua C', municipio: 'Vila Velha', uf: 'ES', email: 'g@x.com', telefone: '27999990000' });
  const doc = montarDocumento('contrato', { me, cli: parteCliente(c, ['Daniela Alves', 'Alexandre Vareira']), dados: dadosIniciais('contrato', { me, hoje: '2026-10-13' }), numero: '001/2026' });
  const partes = doc.secoes.find((s) => s.id === 'partes').paragrafos.join(' ');
  assert.match(partes, /representada, em conjunto, por seus sócios DANIELA ALVES, Sócio-Administrador, inscrito\(a\) no CPF sob o nº 111\.444\.777-35; e ALEXANDRE VAREIRA, Sócio-Administrador, inscrito\(a\) no CPF sob o nº 529\.982\.247-25/);
  assert.equal(doc.assinaturas.filter((a) => a.titulo.startsWith('CONTRATANTE')).length, 2);
  // Sócio escolhido sem CPF vira pendência com o nome dele
  const semCpf = { ...base, socios_json: JSON.stringify([{ nome: 'Carla Sem CPF', administrador: true }]) };
  const d2 = montarDocumento('procuracao', { me, cli: parteCliente(semCpf), dados: dadosIniciais('procuracao', { me, hoje: '2026-10-13' }), numero: '001/2026' });
  assert.ok(d2.pendencias.some((p) => /CPF do sócio Carla Sem CPF/.test(p)));
});
