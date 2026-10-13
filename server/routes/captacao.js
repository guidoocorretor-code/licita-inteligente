// Rotas da Captação e da Minha Empresa. Montadas dentro de /api, depois do login (req.usuario já existe).
// Arquivos (logo, PDFs gerados e assinados) só saem por aqui, com a conta conferida e sem cache; nenhum link público.
import express from 'express';
import multer from 'multer';
import { getDb, transacao } from '../db/index.js';
import { exigirPapel, auditar } from '../lib/auth.js';
import { caminhoArquivo } from '../services/clientes.js';
import { enviarEmail, emailConfigurado } from '../services/email.js';
import {
  listarMinhasEmpresas, salvarMinhaEmpresa, minhaEmpresaDaConta, salvarLogo, removerLogo,
  conferirEmpresa, cadastrarClienteDaCaptacao, atualizarClienteComFormulario,
  criarCaptacao, atualizarCaptacao, cancelarCaptacao, reabrirCaptacao, excluirCaptacao, listarCaptacoes, detalheCaptacao,
  criarDocumentos, salvarDados, previaDocumento, pdfPrevia, gerarPdfFinal, arquivoDoDocumento, rascunhoEmail, enviarPorEmail,
  registrarEnvioManual, anexarAssinado, cancelarDocumento, historicoDoCliente, STATUS_CAPTACAO, STATUS_DOC, INSTRUCOES_GOVBR,
} from '../services/captacao.js';
import { TIPOS_DOC, CAMPOS, PAGINAS_META } from '../services/captacao-modelos.js';

const r = express.Router();
const db = () => getDb();
const inteiro = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const falha = (res, e) => {
  if (!e.status) console.error('[captacao]', e.message);
  res.status(e.status || 500).json({ erro: e.status ? e.message : 'Erro interno.', ...(e.existente ? { existente: e.existente } : {}),
    ...(e.pendencias ? { pendencias: e.pendencias } : {}), ...(e.sem_assinatura ? { sem_assinatura: true } : {}) });
};
// Envolve a rota: erro com status vira JSON { erro } (a tela mostra a mensagem)
const rota = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { falha(res, e); } };
// Quem só consulta (leitor) não vê dados bancários nem documentos pessoais da Minha Empresa
const protegido = (req) => req.usuario.papel === 'leitor';
const emp = (req) => req.usuario.empresa_id;

const upload = (max, campo = 'arquivo') => {
  const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: max, files: 1 } }).single(campo);
  return (req, res, next) => m(req, res, (e) => (e ? res.status(400).json({ erro: e.code === 'LIMIT_FILE_SIZE' ? `Arquivo maior que ${Math.round(max / 1048576)} MB.` : 'Falha no envio do arquivo.' }) : next()));
};
function enviarArquivo(res, abs, nome, { baixar = false, tipo = 'application/pdf', imprimir = false } = {}) {
  // Imprimir: o PDF abre num quadro escondido da própria tela (mesma origem) e o navegador imprime
  if (imprimir) { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'"); }
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `${baixar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(abs, (e) => { if (e && !res.headersSent) res.status(404).json({ erro: 'Arquivo não encontrado.' }); });
}

r.get('/captacao/meta', (req, res) => res.json({ tipos: TIPOS_DOC, campos: CAMPOS, paginas_meta: PAGINAS_META, status: STATUS_CAPTACAO, status_doc: STATUS_DOC,
  email_configurado: emailConfigurado(), instrucoes_govbr: INSTRUCOES_GOVBR }));

// ---------------- Minha Empresa ----------------
r.get('/minhas-empresas', (req, res) => res.json({ empresas: listarMinhasEmpresas(db(), emp(req), { protegido: protegido(req), todas: req.query.todas === '1' }) }));
r.post('/minhas-empresas', exigirPapel('gestor'), rota((req, res) => {
  const id = salvarMinhaEmpresa(db(), emp(req), null, req.body || {});
  auditar(req, 'minha_empresa_criar', 'minha_empresa', id); res.status(201).json({ id });
}));
r.patch('/minhas-empresas/:id', exigirPapel('gestor'), rota((req, res) => {
  salvarMinhaEmpresa(db(), emp(req), inteiro(req.params.id), req.body || {});
  auditar(req, 'minha_empresa_editar', 'minha_empresa', req.params.id); res.json({ ok: true });
}));
r.post('/minhas-empresas/:id/logo', exigirPapel('gestor'), upload(1024 * 1024), rota((req, res) => {
  const info = salvarLogo(db(), emp(req), inteiro(req.params.id), req.file);
  auditar(req, 'minha_empresa_logo', 'minha_empresa', req.params.id); res.json({ ok: true, ...info });
}));
r.delete('/minhas-empresas/:id/logo', exigirPapel('gestor'), rota((req, res) => {
  removerLogo(db(), emp(req), inteiro(req.params.id));
  auditar(req, 'minha_empresa_logo_remover', 'minha_empresa', req.params.id); res.json({ ok: true });
}));
r.get('/minhas-empresas/:id/logo', rota((req, res) => {
  const m = minhaEmpresaDaConta(db(), emp(req), inteiro(req.params.id));
  const abs = m?.logo_caminho && caminhoArquivo(m.logo_caminho);
  if (!abs) return res.status(404).json({ erro: 'Sem logo.' });
  enviarArquivo(res, abs, 'logo.jpg', { tipo: 'image/jpeg' });
}));

// ---------------- Captação: empresa (passo 1) ----------------
// Confere o CPF/CNPJ digitado: se a empresa já existe, devolve quem é e o que está diferente
r.post('/captacoes/conferir-empresa', rota((req, res) => {
  res.json({ existente: conferirEmpresa(db(), emp(req), req.body || {}) });
}));
r.post('/captacoes/empresa', exigirPapel('analista'), rota((req, res) => {
  const id = cadastrarClienteDaCaptacao(db(), emp(req), req.body || {});
  auditar(req, 'cliente_criar', 'cliente', id, { origem: 'captacao' }); res.status(201).json({ cliente_id: id });
}));
r.post('/captacoes/empresa/:id/atualizar', exigirPapel('analista'), rota((req, res) => {
  const campos = atualizarClienteComFormulario(db(), emp(req), inteiro(req.params.id), req.body?.dados || {}, req.body?.campos || []);
  auditar(req, 'cliente_editar', 'cliente', req.params.id, { origem: 'captacao', campos }); res.json({ ok: true, campos });
}));

// ---------------- Captações ----------------
r.get('/captacoes', rota((req, res) => {
  const { q, de, ate, status, tipo } = req.query;
  res.json({ captacoes: listarCaptacoes(db(), emp(req), { q, de, ate, status, tipo }), status: STATUS_CAPTACAO });
}));
r.post('/captacoes', exigirPapel('analista'), rota((req, res) => {
  const id = criarCaptacao(db(), emp(req), req.usuario.id, req.body || {});
  auditar(req, 'captacao_criar', 'captacao', id); res.status(201).json({ id });
}));
r.get('/captacoes/:id', rota((req, res) => res.json(detalheCaptacao(db(), emp(req), inteiro(req.params.id), { protegido: protegido(req) }))));
r.patch('/captacoes/:id', exigirPapel('analista'), rota((req, res) => {
  atualizarCaptacao(db(), emp(req), inteiro(req.params.id), req.usuario.id, req.body || {});
  auditar(req, 'captacao_editar', 'captacao', req.params.id); res.json({ ok: true });
}));
r.post('/captacoes/:id/cancelar', exigirPapel('analista'), rota((req, res) => {
  cancelarCaptacao(db(), emp(req), inteiro(req.params.id), req.usuario.id, req.body?.motivo);
  auditar(req, 'captacao_cancelar', 'captacao', req.params.id); res.json({ ok: true });
}));
r.post('/captacoes/:id/reabrir', exigirPapel('analista'), rota((req, res) => {
  reabrirCaptacao(db(), emp(req), inteiro(req.params.id), req.usuario.id);
  auditar(req, 'captacao_reabrir', 'captacao', req.params.id); res.json({ ok: true });
}));
r.delete('/captacoes/:id', exigirPapel('admin'), rota((req, res) => {
  excluirCaptacao(db(), emp(req), inteiro(req.params.id));
  auditar(req, 'captacao_excluir', 'captacao', req.params.id); res.json({ ok: true });
}));
r.post('/captacoes/:id/documentos', exigirPapel('analista'), rota((req, res) => {
  const ids = transacao(db(), () => criarDocumentos(db(), emp(req), inteiro(req.params.id), req.usuario.id, req.body?.tipos));
  auditar(req, 'captacao_documento_criar', 'captacao', req.params.id, { ids }); res.status(201).json({ ids });
}));
r.get('/clientes/:id/captacoes', rota((req, res) => res.json({ captacoes: historicoDoCliente(db(), emp(req), inteiro(req.params.id)) })));

// ---------------- Documentos ----------------
r.get('/captacao-documentos/:id/previa', rota((req, res) => res.json(previaDocumento(db(), emp(req), inteiro(req.params.id)))));
r.put('/captacao-documentos/:id/dados', exigirPapel('analista'), rota((req, res) => {
  const dados = salvarDados(db(), emp(req), inteiro(req.params.id), req.usuario.id, req.body || {});
  auditar(req, 'captacao_documento_editar', 'captacao_documento', req.params.id); res.json({ ok: true, dados });
}));
r.get('/captacao-documentos/:id/previa.pdf', rota((req, res) => {
  const { pdf } = pdfPrevia(db(), emp(req), inteiro(req.params.id));
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline; filename="previa.pdf"'); res.end(pdf);
}));
r.post('/captacao-documentos/:id/gerar', exigirPapel('analista'), rota((req, res) => {
  const out = gerarPdfFinal(db(), emp(req), inteiro(req.params.id), req.usuario.id);
  auditar(req, 'captacao_documento_gerar', 'captacao_documento', req.params.id); res.json({ ok: true, ...out });
}));
r.get('/captacao-documentos/:id/arquivo', rota((req, res) => {
  const { abs, nome } = arquivoDoDocumento(db(), emp(req), inteiro(req.params.id), inteiro(req.query.arquivo));
  auditar(req, 'captacao_arquivo_baixar', 'captacao_documento', req.params.id);
  enviarArquivo(res, abs, nome, { baixar: req.query.baixar === '1', imprimir: req.query.imprimir === '1' });
}));
r.get('/captacao-documentos/:id/email', rota((req, res) => res.json({ ...rascunhoEmail(db(), emp(req), inteiro(req.params.id)), email_configurado: emailConfigurado() })));
r.post('/captacao-documentos/:id/enviar', exigirPapel('analista'), rota(async (req, res) => {
  const out = await enviarPorEmail(db(), emp(req), inteiro(req.params.id), req.usuario.id, req.body || {}, { enviarEmail });
  auditar(req, 'captacao_documento_enviar', 'captacao_documento', req.params.id); res.json({ ok: true, ...out });
}));
r.post('/captacao-documentos/:id/envio-manual', exigirPapel('analista'), rota((req, res) => {
  const out = registrarEnvioManual(db(), emp(req), inteiro(req.params.id), req.usuario.id, req.body || {});
  auditar(req, 'captacao_documento_envio_manual', 'captacao_documento', req.params.id); res.json({ ok: true, ...out });
}));
r.post('/captacao-documentos/:id/assinado', exigirPapel('analista'), upload(15 * 1024 * 1024), rota((req, res) => {
  const out = anexarAssinado(db(), emp(req), inteiro(req.params.id), req.usuario.id, req.file, { manuscrita: req.body?.manuscrita === '1' });
  auditar(req, 'captacao_documento_assinado', 'captacao_documento', req.params.id); res.json({ ok: true, ...out });
}));
r.post('/captacao-documentos/:id/cancelar', exigirPapel('analista'), rota((req, res) => {
  cancelarDocumento(db(), emp(req), inteiro(req.params.id), req.usuario.id);
  auditar(req, 'captacao_documento_cancelar', 'captacao_documento', req.params.id); res.json({ ok: true });
}));

export default r;
