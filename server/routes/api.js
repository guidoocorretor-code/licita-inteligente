import { Readable } from 'node:stream';
import { MUNICIPIOS_IBGE } from '../services/municipios.js';
import { urlDoDocumento, buscarArquivo, nomeDoArquivo, paginaFalha } from '../services/documentos-pncp.js';
import express from 'express';
import { recebimento, pdfComprovante, protocolo, enviarComprovante } from '../services/comprovante-cotacao.js';
import { getDb, transacao } from '../db/index.js';
import { autenticar, definirCookie, limparCookie, exigirLogin, exigirPapel, auditar, criarUsuario, validarSenha, hashSenha, PAPEIS } from '../lib/auth.js';
import { buscar, buscarTodos, COLUNAS_LISTA } from '../services/busca.js';
import { indicadores } from '../services/dashboard.js';
import { STATUS, VISOES } from '../services/status.js';
import { ESFERAS, MODALIDADES_PNCP, normalizarPncp, normalizarCompras14133 } from '../services/normalizacao.js';
import { SEGMENTOS } from '../services/segmentos.js';
import { salvarLicitacao } from '../services/repositorio.js';
import { sincronizarFonte, testarFonte, reprocessarFalhas, sincronizarDetalhesDe, sincronizacaoEmAndamento } from '../services/sync.js';
import { paraCsv, paraXlsx } from '../services/exportacao.js';
import { espacoEmDisco, usoDoDisco } from '../lib/disco.js';
import multer from 'multer';
import { TIPOS_DOCUMENTO, PORTES, criarCliente, atualizarCliente, excluirCliente, listarClientes, listarDocumentos,
  adicionarDocumentos, excluirDocumento, caminhoArquivo, validarCnpj } from '../services/clientes.js';
import { agoraBrasilia } from '../services/status.js';
import { CONECTORES } from '../connectors/registro.js';
import { eventosCalendario, gerarIcs, gerarTokenCalendario, revogarTokenCalendario } from '../services/calendario.js';
import { statusEmail, enviarEmailTeste, emailConfigurado } from '../services/email.js';
import { listarNotificacoes } from '../services/alertas.js';
import { consultarCnpj } from '../services/cnpj.js';
import { lerSicafPdf } from '../services/sicaf.js';
import { catalogoSistemas } from '../services/sistemas.js';
import { ETAPAS_PADRAO, FASES, FASES_GANHAS } from '../services/execucao.js';
import { precisaSenhaAdmin, conferirSenhaAdmin, justificativaDescarte } from '../services/kanban-regras.js';
import { painelEmpresas } from '../services/painel-empresas.js';
import { salvarPerfil, excluirPerfil, perfilDaEmpresa, listarPerfis, edicoesDoPerfil, idsDoPerfil, gerarEdicao, idsQueBatem, pendentesDeItens, normalizarFiltros,
  resumoFiltros, funilDoPerfil, motivosDoPerfil, itensDoPerfil, MODALIDADES_JORNAL, FASES_JORNAL } from '../services/jornal-perfis.js';
import { salvarContrato, resumoHonorarios, criarCobrancaAvulsa, atualizarCobranca, cancelarCobranca, desfazerPagamento, excluirCobranca, cobrancaDaEmpresa,
  custosDaOportunidade, lancarCusto, excluirCusto, lucroPorContrato, CATEGORIAS_CUSTO, FORMAS_RECEBIMENTO, TIPOS_COBRANCA } from '../services/financeiro.js';
import { atualizarCapag, pagometroDaLicitacao, FONTES_CAPAG } from '../services/capag.js';
import { buscarContratos, contratosDaLicitacao } from '../services/contratos.js';
import { criarFornecedor, atualizarFornecedor, excluirFornecedor, listarFornecedores, FRETES, FORMAS_PAGAMENTO, PRAZOS_BOLETO, cotacoesDaOportunidade,
  registrarCotacoes, escolherCotacao, excluirCotacao, salvarParametros, registrarPedido, mudarStatusPedido, listarPedidos, painelFornecedores } from '../services/fornecedores.js';
import { linkDoFornecedor, revogarLink } from '../services/cotacao-link.js';
import { propostaDaOportunidade, salvarProposta, mudarStatusProposta, listarPropostas } from '../services/propostas.js';
import { relatorioMercado, paraLead } from '../services/relatorio-mercado.js';
import { pdfRelatorio } from '../services/relatorio-mercado-pdf.js';
import { cartoes, criarEnvio, dadosEnvio, pdfJornal, enviarJornal, listarEnvios, excluirEnvios, sistemaDaLicitacao, MAX_ITENS_ENVIO, dadosAssessoria, salvarDadosAssessoria } from '../services/jornal-cliente.js';
import { buscarCatalogo, statusCatalogo, sincronizarCatalogo, validarConsulta, consultarPrecos, analisarPrecos } from '../services/precos.js';

export { ETAPAS_PADRAO };

export function garantirEtapas(db, empresaId) {
  const n = db.prepare('SELECT COUNT(*) n FROM kanban_etapas WHERE empresa_id=?').get(empresaId).n;
  if (n === 0) {
    const ins = db.prepare('INSERT INTO kanban_etapas (empresa_id, nome, ordem, fase) VALUES (?,?,?,?)');
    ETAPAS_PADRAO.forEach(([nome, fase], i) => ins.run(empresaId, nome, i, fase));
  }
}

const r = express.Router();
const db = () => getDb();
const erro = (res, status, msg) => res.status(status).json({ erro: msg });
const inteiro = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
export const urlBase = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const dataOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Limitador simples para login (por IP)
const tentativasIp = new Map();
function limitarLogin(req, res, next) {
  const k = req.ip; const agora = Date.now();
  const lista = (tentativasIp.get(k) || []).filter((t) => agora - t < 15 * 60000);
  if (lista.length >= 20) return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
  lista.push(agora); tentativasIp.set(k, lista); next();
}

// ---------------- Autenticação ----------------
r.post('/auth/login', limitarLogin, (req, res) => {
  const out = autenticar(db(), req.body?.email, req.body?.senha);
  if (!out.ok) return erro(res, 401, out.mensagem);
  definirCookie(res, out.token);
  req.usuario = out.usuario; auditar(req, 'login');
  res.json({ usuario: out.usuario });
});
r.post('/auth/logout', exigirLogin, (req, res) => { auditar(req, 'logout'); limparCookie(res); res.json({ ok: true }); });
r.post('/auth/sair-de-todos', exigirLogin, (req, res) => {
  db().prepare('UPDATE usuarios SET token_versao = token_versao + 1 WHERE id=?').run(req.usuario.id);
  limparCookie(res); res.json({ ok: true });
});
r.get('/auth/eu', exigirLogin, (req, res) => {
  const emp = db().prepare('SELECT id, nome, cnpj FROM empresas WHERE id=?').get(req.usuario.empresa_id);
  res.json({ usuario: req.usuario, empresa: emp });
});
r.post('/auth/senha', exigirLogin, (req, res) => {
  const { atual, nova } = req.body || {};
  const ok = autenticar(db(), req.usuario.email, atual);
  if (!ok.ok) return erro(res, 400, 'Senha atual incorreta.');
  const e = validarSenha(nova); if (e) return erro(res, 400, e);
  db().prepare('UPDATE usuarios SET senha_hash=?, token_versao=token_versao+1 WHERE id=?').run(hashSenha(nova), req.usuario.id);
  auditar(req, 'troca_senha'); limparCookie(res); res.json({ ok: true, mensagem: 'Senha alterada. Entre novamente.' });
});

r.use(exigirLogin);

// Empresa assessorada selecionada no topo da tela (cabeçalho X-Cliente; ?cliente= em links diretos).
// req.clienteId: número = só dessa empresa; null = "Todas". Novos registros vão para req.clienteId ou 0 (sem empresa).
r.use((req, res, next) => {
  const v = inteiro(req.get('x-cliente') ?? req.query.cliente);
  req.clienteId = null;
  if (v > 0) {
    if (!db().prepare('SELECT 1 FROM clientes WHERE id=? AND empresa_id=?').get(v, req.usuario.empresa_id)) return erro(res, 404, 'Empresa selecionada não encontrada. Escolha outra no topo da tela.');
    req.clienteId = v;
  }
  next();
});
const doCliente = (req, col = 'cliente_id') => (req.clienteId ? { sql: ` AND ${col} = ?`, p: [req.clienteId] } : { sql: '', p: [] });

// ---------------- Metadados ----------------
r.get('/meta', (req, res) => {
  const plataformas = db().prepare('SELECT DISTINCT plataforma_origem p FROM licitacoes WHERE plataforma_origem IS NOT NULL ORDER BY p').all().map((x) => x.p);
  const regimes = db().prepare('SELECT DISTINCT regime_legal p FROM licitacoes WHERE regime_legal IS NOT NULL ORDER BY p').all().map((x) => x.p);
  res.json({ status: STATUS, visoes: VISOES, esferas: ESFERAS, modalidades: MODALIDADES_PNCP, segmentos: SEGMENTOS, plataformas, regimes, sistemas: catalogoSistemas(),
    ufs: ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] });
});

// ---------------- Dashboard ----------------
r.get('/dashboard', (req, res) => res.json({ ...indicadores(db(), { usuarioId: req.usuario.id }), disco: espacoEmDisco() }));

// ---------------- Busca e licitações ----------------
r.get('/licitacoes', (req, res) => {
  try { res.json(buscar(db(), req.query)); } catch (e) { erro(res, 400, `Filtro inválido: ${e.message}`); }
});

r.get('/licitacoes/exportar', async (req, res) => {
  const linhas = buscarTodos(db(), req.query, 10000);
  auditar(req, 'exportar', 'licitacoes', null, { formato: req.query.formato, total: linhas.length });
  const nome = `licitacoes-${new Date().toISOString().slice(0, 10)}`;
  if (req.query.formato === 'xlsx') {
    const buf = await paraXlsx(linhas);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
  res.send(paraCsv(linhas));
});

// Arquivo do edital: o servidor baixa do PNCP e entrega (ou explica por que não deu, com o link oficial)
r.get('/licitacoes/:id/documentos/:seq/arquivo', async (req, res) => {
  const lic = db().prepare('SELECT id, orgao_cnpj, ano, sequencial, link_pncp FROM licitacoes WHERE id=?').get(inteiro(req.params.id));
  const doc = lic && db().prepare('SELECT * FROM licitacao_documentos WHERE licitacao_id=? AND sequencial=?').get(lic.id, inteiro(req.params.seq));
  if (!doc) return erro(res, 404, 'Documento não encontrado.');
  const url = urlDoDocumento(lic, doc);
  const falhar = (motivo) => res.status(502).type('html').send(paginaFalha({ motivo, doc, linkPncp: lic.link_pncp, urlArquivo: url }));
  if (!url) return falhar('O endereço deste arquivo não veio do PNCP.');
  const r0 = await buscarArquivo(url);
  if (!r0.ok) { console.warn(`[documentos] licitação ${lic.id} doc ${doc.sequencial}: ${r0.motivo} (${url})`); return falhar(r0.motivo); }
  const tipo = r0.resp.headers.get('content-type') || 'application/octet-stream';
  const nome = nomeDoArquivo(doc, r0.resp.headers.get('content-disposition'), tipo);
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `${/pdf/i.test(tipo) ? 'inline' : 'attachment'}; filename="${nome.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  const tam = r0.resp.headers.get('content-length'); if (tam) res.setHeader('Content-Length', tam);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  try {
    Readable.fromWeb(r0.resp.body).on('error', () => res.destroy()).on('end', r0.fim).pipe(res);
  } catch (e) { r0.fim(); falhar('Falha ao receber o arquivo do PNCP.'); }
});

r.get('/licitacoes/:id', (req, res) => {
  const id = inteiro(req.params.id);
  const lic = db().prepare('SELECT * FROM licitacoes WHERE id=?').get(id);
  if (!lic) return erro(res, 404, 'Licitação não encontrada.');
  const u = req.usuario;
  res.json({
    licitacao: lic,
    pagometro: pagometroDaLicitacao(db(), lic),
    status_rotulo: STATUS[lic.status_calculado]?.rotulo,
    itens: db().prepare('SELECT * FROM licitacao_itens WHERE licitacao_id=? ORDER BY numero_item').all(id),
    documentos: db().prepare('SELECT * FROM licitacao_documentos WHERE licitacao_id=? ORDER BY sequencial').all(id),
    eventos: db().prepare('SELECT * FROM licitacao_eventos WHERE licitacao_id=? ORDER BY detectado_em DESC, id DESC LIMIT 200').all(id),
    fontes: db().prepare('SELECT fonte_codigo, id_externo, url, primeira_vez, ultima_vez FROM licitacao_fontes WHERE licitacao_id=?').all(id),
    favorito: !!db().prepare("SELECT 1 FROM favoritos WHERE usuario_id=? AND tipo='licitacao' AND referencia=? AND cliente_id=?").get(u.id, String(id), req.clienteId || 0),
    oportunidade: db().prepare(`SELECT o.*, e.nome etapa_nome FROM oportunidades o JOIN kanban_etapas e ON e.id=o.etapa_id
      WHERE o.empresa_id=? AND o.licitacao_id=? AND o.cliente_id=?`).get(u.empresa_id, id, req.clienteId || 0) || null,
    // Em quais empresas assessoradas esta licitação já está (favorito ou Kanban)
    empresas: db().prepare(`SELECT DISTINCT cl.id, COALESCE(cl.nome_fantasia, cl.razao_social) nome FROM clientes cl
      WHERE cl.empresa_id=? AND (cl.id IN (SELECT cliente_id FROM oportunidades WHERE empresa_id=? AND licitacao_id=?)
        OR cl.id IN (SELECT cliente_id FROM favoritos WHERE usuario_id=? AND tipo='licitacao' AND referencia=?))`)
      .all(u.empresa_id, u.empresa_id, id, u.id, String(id)),
    contratos: contratosDaLicitacao(db(), id),
  });
});

r.post('/licitacoes/:id/atualizar', exigirPapel('analista'), async (req, res) => {
  try { res.json(await sincronizarDetalhesDe(db(), inteiro(req.params.id))); }
  catch (e) { erro(res, 502, `Não foi possível consultar a fonte agora: ${e.message}`); }
});

// ---------------- Jornal ----------------
function filtroJornal(req) {
  const w = []; const p = [];
  if (req.query.tipo) { w.push('e.tipo = ?'); p.push(req.query.tipo); }
  if (req.query.uf) { w.push('l.uf = ?'); p.push(String(req.query.uf).toUpperCase()); }
  if (req.query.segmento) { w.push('l.segmento = ?'); p.push(req.query.segmento); }
  if (req.query.orgao) { w.push('l.orgao_nome LIKE ?'); p.push(`%${req.query.orgao}%`); }
  if (req.query.municipio) { w.push('l.municipio LIKE ?'); p.push(`%${String(req.query.municipio).trim()}%`); }
  if (req.query.q) { w.push('(l.objeto LIKE ? OR e.descricao LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  // Só com propostas ainda abertas (prazo futuro ou não informado)
  if (req.query.abertas === '1') { w.push("(l.data_encerramento_proposta IS NULL OR l.data_encerramento_proposta >= ?)"); p.push(agoraBrasilia()); }
  return { sql: `FROM licitacao_eventos e JOIN licitacoes l ON l.id = e.licitacao_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`, p };
}
// Jornal salvo (perfil): as licitações da edição do dia (ou todas as abertas que batem), no formato do feed
const COLS_LIC_JORNAL = `l.id licitacao_id, l.criado_em detectado_em, l.objeto, l.orgao_nome, l.uf, l.municipio, l.modalidade_nome, l.segmento, l.status_calculado,
  l.valor_estimado, l.valor_estimado_situacao, l.data_encerramento_proposta, l.sistema_eletronico, l.plataforma_origem, l.link_origem, l.link_pncp, l.numero_compra, l.ano,
  l.detalhes_sincronizados_em, (SELECT COUNT(*) FROM licitacao_itens i WHERE i.licitacao_id=l.id) qtd_itens,
  (SELECT COUNT(*) FROM licitacao_documentos d WHERE d.licitacao_id=l.id) qtd_documentos`;
function licitacoesDoPerfil(req) {
  const perfil = perfilDaEmpresa(db(), req.usuario.empresa_id, inteiro(req.query.perfil));
  const edicao = req.query.edicao === 'todas' ? 'todas' : dataOk(req.query.edicao) || edicoesDoPerfil(db(), perfil.id)[0]?.data || 'todas';
  return { perfil, edicao, ...idsDoPerfil(db(), perfil, { edicao, agora: agoraBrasilia() }) };
}
r.get('/jornal', (req, res) => {
  if (req.query.perfil) {
    try {
      const { perfil, edicao, ids, total } = licitacoesDoPerfil(req);
      const pagina = Math.max(1, inteiro(req.query.pagina) || 1);
      const fatia = ids.slice((pagina - 1) * 30, pagina * 30);
      // Mesmas colunas do cartão de "Buscar licitações" (o jornal usa o mesmo cartão), mais as do jornal
      const porId = new Map(fatia.length ? db().prepare(`SELECT ${COLUNAS_LISTA}, ${COLS_LIC_JORNAL} FROM licitacoes l WHERE l.id IN (${fatia.map(() => '?').join(',')})`).all(...fatia).map((x) => [x.licitacao_id, x]) : []);
      const motivos = motivosDoPerfil(db(), perfil.filtros, fatia);
      const itensBatem = itensDoPerfil(db(), perfil.filtros, fatia);
      const dados = fatia.map((id) => porId.get(id)).filter(Boolean)
        .map((x) => {
          const it = itensBatem.get(x.licitacao_id);
          return { ...x, motivos: motivos.get(x.licitacao_id) || [], tipo: edicao === 'todas' ? 'aberta' : 'nova', descricao: x.modalidade_nome || 'Modalidade não informada', sistema: sistemaDaLicitacao(x),
            ...(it ? { itens_encontrados: it.itens, itens_encontrados_total: it.total } : {}) };
        });
      return res.json({ total: ids.length, total_bateram: total, pagina, paginas: Math.ceil(ids.length / 30), dados, edicao });
    } catch (e) { return erro(res, e.status || 500, e.status ? e.message : 'Erro ao abrir o jornal.'); }
  }
  const { sql, p } = filtroJornal(req);
  const pagina = Math.max(1, inteiro(req.query.pagina) || 1);
  const total = db().prepare(`SELECT COUNT(*) n ${sql}`).get(...p).n;
  // Mesmas colunas do cartão de "Buscar licitações" (id = da licitação; o do evento vai em evento_id)
  const dados = db().prepare(`SELECT ${COLUNAS_LISTA}, e.id evento_id, e.licitacao_id, e.tipo, e.campo, e.valor_anterior, e.valor_novo, e.descricao, e.ocorrido_em, e.detectado_em ${sql}
    ORDER BY e.detectado_em DESC, e.id DESC LIMIT 30 OFFSET ?`).all(...p, (pagina - 1) * 30)
    .map((x) => ({ ...x, sistema: sistemaDaLicitacao(x) }));
  res.json({ total, pagina, paginas: Math.ceil(total / 30), dados });
});
// Municípios com licitação no banco (sugestões do filtro do Jornal), da UF escolhida
// Lista OFICIAL do IBGE (todos os municípios, mesmo os que ainda não publicaram licitação). uf=ES ou uf=ES,MG
r.get('/jornal/municipios', (req, res) => {
  const ufs = String(req.query.uf || '').toUpperCase().split(',').map((u) => u.trim()).filter((u) => MUNICIPIOS_IBGE[u]);
  res.json({ municipios: ufs.flatMap((u) => MUNICIPIOS_IBGE[u]), por_uf: Object.fromEntries(ufs.map((u) => [u, MUNICIPIOS_IBGE[u]])) });
});
// Licitações (sem repetir) de todos os resultados do filtro, para "marcar todos"
r.get('/jornal/ids', (req, res) => {
  if (req.query.perfil) {
    try { const { ids } = licitacoesDoPerfil(req); return res.json({ ids: ids.slice(0, MAX_ITENS_ENVIO), limite: MAX_ITENS_ENVIO, cortado: ids.length > MAX_ITENS_ENVIO }); }
    catch (e) { return erro(res, e.status || 500, e.status ? e.message : 'Erro.'); }
  }
  const { sql, p } = filtroJornal(req);
  const ids = db().prepare(`SELECT l.id, MAX(e.detectado_em) d ${sql} GROUP BY l.id ORDER BY d DESC LIMIT ?`).all(...p, MAX_ITENS_ENVIO + 1).map((x) => x.id);
  res.json({ ids: ids.slice(0, MAX_ITENS_ENVIO), limite: MAX_ITENS_ENVIO, cortado: ids.length > MAX_ITENS_ENVIO });
});
// Resumo das licitações marcadas (para conferir a seleção que está fora da página atual)
r.get('/jornal/selecao', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(inteiro).filter((n) => n > 0).slice(0, 200);
  if (!ids.length) return res.json({ dados: [] });
  const dados = db().prepare(`SELECT id, objeto, orgao_nome, municipio, uf, data_encerramento_proposta FROM licitacoes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  res.json({ dados });
});
// Jornal para o cliente: cria o registro (link de interesse) e serve impressão, PDF e e-mail
const urlBaseDe = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const envioDaEmpresa = (req, res) => {
  const e = db().prepare('SELECT id FROM jornal_envios WHERE id=? AND empresa_id=?').get(inteiro(req.params.id), req.usuario.empresa_id);
  if (!e) { erro(res, 404, 'Jornal não encontrado.'); return null; }
  return dadosEnvio(db(), e.id);
};
// ---- Jornais salvos (perfis com edição diária) ----
r.get('/jornal/perfis', (req, res) => res.json({
  perfis: listarPerfis(db(), req.usuario.empresa_id, req.clienteId).map((p) => ({ ...p, resumo: resumoFiltros(p.filtros) })),
  modalidades: Object.fromEntries(Object.entries(MODALIDADES_JORNAL).map(([k, v]) => [k, v.nome])), fases: FASES_JORNAL,
}));
r.get('/jornal/perfis/:id', (req, res) => {
  try { const p = perfilDaEmpresa(db(), req.usuario.empresa_id, inteiro(req.params.id)); res.json({ ...p, resumo: resumoFiltros(p.filtros), edicoes: edicoesDoPerfil(db(), p.id), itens: pendentesDeItens(db(), p.filtros, agoraBrasilia()) }); }
  catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro.'); }
});
// Quantas abertas batem agora com o filtro do formulário (antes de salvar)
r.post('/jornal/perfis/previa', exigirPapel('analista'), (req, res) => {
  try {
    const f = normalizarFiltros(req.body?.filtros || {}); const agora = agoraBrasilia();
    res.json({ total: idsQueBatem(db(), f, { agora }).total, funil: funilDoPerfil(db(), f, agora), itens: pendentesDeItens(db(), f, agora) });
  } catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro.'); }
});
const salvarEGerar = (req, id) => {
  const pid = salvarPerfil(db(), req.usuario.empresa_id, req.usuario.id, req.body || {}, id);
  const p = perfilDaEmpresa(db(), req.usuario.empresa_id, pid);
  const ed = p.ativo ? gerarEdicao(db(), p, agoraBrasilia()) : null; // a primeira edição sai na hora
  return { id: pid, edicao: ed ? { data: ed.data, total: ed.total } : null };
};
r.post('/jornal/perfis', exigirPapel('analista'), (req, res) => {
  try { const out = salvarEGerar(req, null); auditar(req, 'jornal_perfil_criar', 'jornal_perfil', out.id); res.status(201).json(out); }
  catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro ao salvar o jornal.'); }
});
r.put('/jornal/perfis/:id', exigirPapel('analista'), (req, res) => {
  try { const out = salvarEGerar(req, inteiro(req.params.id)); auditar(req, 'jornal_perfil_editar', 'jornal_perfil', out.id); res.json(out); }
  catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro ao salvar o jornal.'); }
});
r.delete('/jornal/perfis/:id', exigirPapel('analista'), (req, res) => {
  try { excluirPerfil(db(), req.usuario.empresa_id, inteiro(req.params.id)); auditar(req, 'jornal_perfil_excluir', 'jornal_perfil', inteiro(req.params.id)); res.json({ ok: true }); }
  catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro.'); }
});
r.get('/jornal/envios', (req, res) => res.json({ envios: listarEnvios(db(), req.usuario.empresa_id, req.clienteId), email_configurado: emailConfigurado() }));
r.post('/jornal/envios/excluir', exigirPapel('analista'), (req, res) => {
  try { res.json({ excluidos: excluirEnvios(db(), req.usuario.empresa_id, req.body?.ids) }); }
  catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro ao excluir.'); }
});
r.post('/jornal/envios', exigirPapel('analista'), (req, res) => {
  try {
    const x = criarEnvio(db(), { empresaId: req.usuario.empresa_id, clienteId: req.clienteId, usuarioId: req.usuario.id, ids: req.body?.ids, perfilId: req.body?.perfil });
    const d = dadosEnvio(db(), x.id);
    res.status(201).json({ ...d, url: `${urlBaseDe(req)}/j/${x.token}` });
  } catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro ao montar o jornal.'); }
});
r.get('/jornal/envios/:id.pdf', (req, res) => {
  const d = envioDaEmpresa(req, res); if (!d) return;
  const nome = (d.cliente ? (d.cliente.nome_fantasia || d.cliente.razao_social) : 'licitacoes').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="jornal-${nome}-${d.envio.criado_em.slice(0, 10)}.pdf"`);
  res.send(pdfJornal(d, { urlBase: urlBaseDe(req) }));
});
r.post('/jornal/envios/:id/email', exigirPapel('analista'), async (req, res) => {
  const d = envioDaEmpresa(req, res); if (!d) return;
  const para = String(req.body?.para || d.cliente?.resp_email || d.cliente?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) return erro(res, 400, 'Informe o e-mail do representante legal (Cadastro > Empresa ou no campo).');
  if (!emailConfigurado()) return erro(res, 503, 'O e-mail do sistema ainda não foi configurado (BREVO_API_KEY). Use "Baixar PDF" e envie pelo seu e-mail ou WhatsApp.');
  const st = await enviarJornal(db(), d.envio.id, { para, urlBase: urlBaseDe(req) });
  if (st !== 'enviado') return erro(res, 502, `Não foi possível enviar: ${db().prepare('SELECT email_erro FROM jornal_envios WHERE id=?').get(d.envio.id)?.email_erro || st}`);
  res.json({ ok: true, para });
});

// ---------------- Favoritos ----------------
r.get('/favoritos', (req, res) => {
  const c = doCliente(req, 'f.cliente_id');
  const favs = db().prepare(`SELECT f.*, COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome FROM favoritos f LEFT JOIN clientes cl ON cl.id = f.cliente_id
    WHERE f.usuario_id=? AND f.empresa_id=?${c.sql} ORDER BY f.criado_em DESC`).all(req.usuario.id, req.usuario.empresa_id, ...c.p);
  const lic = favs.filter((f) => f.tipo === 'licitacao').map((f) => Number(f.referencia));
  const licitacoes = lic.length ? db().prepare(`SELECT id, objeto, orgao_nome, uf, municipio, status_calculado, data_encerramento_proposta, valor_estimado, valor_estimado_situacao
    FROM licitacoes WHERE id IN (${lic.map(() => '?').join(',')})`).all(...lic) : [];
  res.json({ favoritos: favs, licitacoes });
});
r.post('/favoritos', (req, res) => {
  const { tipo, referencia, lista = 'Geral', nota = null } = req.body || {};
  if (!['licitacao', 'orgao', 'fornecedor', 'pesquisa'].includes(tipo) || !referencia) return erro(res, 400, 'Tipo ou referência inválidos.');
  if (tipo === 'licitacao' && !db().prepare('SELECT 1 FROM licitacoes WHERE id=?').get(inteiro(referencia))) return erro(res, 404, 'Licitação não encontrada.');
  db().prepare(`INSERT INTO favoritos (empresa_id, usuario_id, cliente_id, tipo, referencia, lista, nota) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(usuario_id, cliente_id, tipo, referencia, lista) DO UPDATE SET nota=excluded.nota`)
    .run(req.usuario.empresa_id, req.usuario.id, req.clienteId || 0, tipo, String(referencia).slice(0, 200), String(lista).slice(0, 60), nota ? String(nota).slice(0, 1000) : null);
  res.status(201).json({ ok: true });
});
r.delete('/favoritos', (req, res) => {
  const { tipo, referencia, id } = req.query;
  // Com "Todas" selecionado, remove pelo id (um favorito de uma empresa); com uma empresa, só os dela
  const out = id
    ? db().prepare('DELETE FROM favoritos WHERE usuario_id=? AND empresa_id=? AND id=?').run(req.usuario.id, req.usuario.empresa_id, inteiro(id))
    : db().prepare('DELETE FROM favoritos WHERE usuario_id=? AND empresa_id=? AND tipo=? AND referencia=? AND cliente_id=?')
      .run(req.usuario.id, req.usuario.empresa_id, tipo, String(referencia), req.clienteId || 0);
  res.json({ removidos: Number(out.changes) });
});

// ---------------- Pesquisas salvas ----------------
r.get('/pesquisas', (req, res) => {
  const c = doCliente(req);
  res.json(db().prepare(`SELECT * FROM pesquisas_salvas WHERE usuario_id=? AND empresa_id=?${c.sql} ORDER BY nome`).all(req.usuario.id, req.usuario.empresa_id, ...c.p));
});
r.post('/pesquisas', (req, res) => {
  const { nome, filtros, alertar } = req.body || {};
  if (!nome || typeof filtros !== 'object') return erro(res, 400, 'Informe nome e filtros.');
  const limpos = Object.fromEntries(Object.entries(filtros).filter(([k, v]) => v !== '' && v != null && !['pagina', 'tamanho'].includes(k)));
  const out = db().prepare(`INSERT INTO pesquisas_salvas (empresa_id, usuario_id, cliente_id, nome, filtros_json, alertar, ultimo_alerta_em) VALUES (?,?,?,?,?,?,datetime('now'))`)
    .run(req.usuario.empresa_id, req.usuario.id, req.clienteId || 0, String(nome).slice(0, 120), JSON.stringify(limpos), alertar ? 1 : 0);
  res.status(201).json({ id: Number(out.lastInsertRowid) });
});
r.patch('/pesquisas/:id', (req, res) => {
  const out = db().prepare('UPDATE pesquisas_salvas SET alertar=? WHERE id=? AND usuario_id=?').run(req.body?.alertar ? 1 : 0, inteiro(req.params.id), req.usuario.id);
  if (!out.changes) return erro(res, 404, 'Pesquisa não encontrada.');
  res.json({ ok: true });
});
r.delete('/pesquisas/:id', (req, res) => {
  const out = db().prepare('DELETE FROM pesquisas_salvas WHERE id=? AND usuario_id=?').run(inteiro(req.params.id), req.usuario.id);
  if (!out.changes) return erro(res, 404, 'Pesquisa não encontrada.');
  res.json({ ok: true });
});

// ---------------- Notificações ----------------
r.get('/notificacoes', (req, res) => {
  res.json(listarNotificacoes(db(), req.usuario.id, req.clienteId));
});
r.post('/notificacoes/:id/lida', (req, res) => {
  const out = db().prepare('UPDATE notificacoes SET lida=1 WHERE id=? AND usuario_id=?').run(inteiro(req.params.id), req.usuario.id);
  if (!out.changes) return erro(res, 404, 'Alerta não encontrado.');
  res.json({ ok: true });
});
r.post('/notificacoes/lidas', (req, res) => {
  const c = doCliente(req);
  // ids: só estes (ex.: "marcar este tipo como lido"); sem ids: todos
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(inteiro).filter(Boolean).slice(0, 1000) : null;
  if (ids && !ids.length) return res.json({ ok: true });
  db().prepare(`UPDATE notificacoes SET lida=1 WHERE usuario_id=?${c.sql}${ids ? ` AND id IN (${ids.map(() => '?').join(',')})` : ''}`)
    .run(req.usuario.id, ...c.p, ...(ids || [])); res.json({ ok: true });
});

// ---------------- Kanban (etapa interna separada da situação oficial) ----------------
r.get('/kanban', (req, res) => {
  const emp = req.usuario.empresa_id; garantirEtapas(db(), emp);
  const etapas = db().prepare('SELECT * FROM kanban_etapas WHERE empresa_id=? ORDER BY ordem').all(emp);
  const c = doCliente(req, 'o.cliente_id');
  const cards = db().prepare(`SELECT o.*, l.objeto, l.orgao_nome, l.uf, l.status_calculado, l.data_encerramento_proposta, l.valor_estimado, l.valor_estimado_situacao,
      l.numero_compra, l.ano, l.modalidade_nome, l.link_origem, l.unidade_codigo, l.sistema_eletronico, l.plataforma_origem,
      u.nome responsavel_nome, COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome
      FROM oportunidades o JOIN licitacoes l ON l.id=o.licitacao_id LEFT JOIN usuarios u ON u.id=o.responsavel_id LEFT JOIN clientes cl ON cl.id=o.cliente_id
      WHERE o.empresa_id=?${c.sql} ORDER BY o.posicao, o.id`).all(emp, ...c.p);
  const usuarios = db().prepare('SELECT id, nome FROM usuarios WHERE empresa_id=? AND ativo=1 ORDER BY nome').all(emp);
  res.json({ etapas, cards, usuarios });
});
r.post('/kanban', exigirPapel('analista'), (req, res) => {
  const emp = req.usuario.empresa_id; garantirEtapas(db(), emp);
  const licId = inteiro(req.body?.licitacao_id);
  if (!db().prepare('SELECT 1 FROM licitacoes WHERE id=?').get(licId)) return erro(res, 404, 'Licitação não encontrada.');
  const primeira = db().prepare('SELECT id FROM kanban_etapas WHERE empresa_id=? ORDER BY ordem LIMIT 1').get(emp);
  const cli = req.clienteId || 0;
  // Já na esteira (inclusive descartada): não duplica; avisa a etapa e, se descartada, o motivo
  const existe = db().prepare(`SELECT o.id, o.descarte_motivo, o.descartado_em, e.nome etapa, e.fase FROM oportunidades o JOIN kanban_etapas e ON e.id = o.etapa_id
    WHERE o.empresa_id=? AND o.licitacao_id=? AND o.cliente_id=?`).get(emp, licId, cli);
  if (existe) return res.json({ id: existe.id, existente: true, etapa: existe.etapa, fase: existe.fase, motivo: existe.descarte_motivo, descartado_em: existe.descartado_em });
  const out = db().prepare('INSERT INTO oportunidades (empresa_id, cliente_id, licitacao_id, etapa_id, responsavel_id) VALUES (?,?,?,?,?)').run(emp, cli, licId, primeira.id, req.usuario.id);
  const id = Number(out.lastInsertRowid);
  db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'criacao','Oportunidade criada')").run(id, req.usuario.id);
  auditar(req, 'kanban_criar', 'oportunidade', id);
  res.status(201).json({ id });
});
r.patch('/kanban/:id', exigirPapel('analista'), (req, res) => {
  const emp = req.usuario.empresa_id; const id = inteiro(req.params.id);
  const op = db().prepare('SELECT o.*, e.fase FROM oportunidades o JOIN kanban_etapas e ON e.id = o.etapa_id WHERE o.id=? AND o.empresa_id=?').get(id, emp);
  if (!op) return erro(res, 404, 'Oportunidade não encontrada.');
  const { etapa_id, responsavel_id, prazo_interno, posicao, cliente_id } = req.body || {};
  const destino = etapa_id != null ? db().prepare('SELECT * FROM kanban_etapas WHERE id=? AND empresa_id=?').get(inteiro(etapa_id), emp) : null;
  if (etapa_id != null && !destino) return erro(res, 400, 'Etapa inválida.');
  const camposExec = valoresExecucao(req.body || {});
  const outros = (cliente_id !== undefined && (cliente_id ? inteiro(cliente_id) : 0) !== op.cliente_id)
    || (responsavel_id !== undefined && (responsavel_id === null ? null : inteiro(responsavel_id)) !== op.responsavel_id)
    || (prazo_interno !== undefined && (prazo_interno || null) !== op.prazo_interno);
  // A receber / Recebido: só com a senha de um administrador (o passo nota → recebido e completar campo vazio estão liberados)
  let autorizou = null;
  if (precisaSenhaAdmin(op, { destino, campos: camposExec, outros })) autorizou = conferirSenhaAdmin(db(), emp, req.usuario.id, req.body?.senha_admin);
  const descartando = destino && destino.fase === 'descartada' && op.fase !== 'descartada';
  const motivo = descartando ? justificativaDescarte(req.body?.justificativa) : null;
  transacao(db(), () => {
    if (autorizou) {
      db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'autorizacao',?)").run(id, req.usuario.id, `Alteração autorizada com a senha de ${autorizou.nome}`);
      auditar(req, 'kanban_autorizacao_admin', 'oportunidade', id, { admin_id: autorizou.id });
    }
    if (cliente_id !== undefined) {
      // vincular (ou trocar/desvincular) a empresa assessorada da oportunidade
      const cid = cliente_id ? inteiro(cliente_id) : 0;
      const cli = cid ? db().prepare('SELECT id, COALESCE(nome_fantasia, razao_social) nome FROM clientes WHERE id=? AND empresa_id=?').get(cid, emp) : null;
      if (cid && !cli) throw Object.assign(new Error('Empresa inválida.'), { status: 400 });
      if (cid !== op.cliente_id) {
        if (db().prepare('SELECT 1 FROM oportunidades WHERE empresa_id=? AND licitacao_id=? AND cliente_id=? AND id<>?').get(emp, op.licitacao_id, cid, id)) {
          throw Object.assign(new Error(`Esta licitação já está no Kanban ${cli ? `da empresa ${cli.nome}` : 'sem empresa'}.`), { status: 409 });
        }
        db().prepare("UPDATE oportunidades SET cliente_id=?, atualizado_em=datetime('now') WHERE id=?").run(cid, id);
        db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'empresa',?)").run(id, req.usuario.id, cli ? cli.nome : 'Sem empresa');
      }
    }
    if (etapa_id != null) {
      const et = db().prepare('SELECT * FROM kanban_etapas WHERE id=? AND empresa_id=?').get(inteiro(etapa_id), emp);
      if (!et) throw Object.assign(new Error('Etapa inválida.'), { status: 400 });
      if (et.id !== op.etapa_id) {
        const de = db().prepare('SELECT nome FROM kanban_etapas WHERE id=?').get(op.etapa_id).nome;
        db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'movimento',?)").run(id, req.usuario.id, `${de} → ${et.nome}`);
      }
      db().prepare("UPDATE oportunidades SET etapa_id=?, atualizado_em=datetime('now') WHERE id=?").run(et.id, id);
      // Data do resultado: fixada ao entrar em vitória/perda pela primeira vez; some se voltar para antes do resultado
      const fechada = [...FASES_GANHAS, 'perdida'].includes(et.fase);
      if (fechada && !op.resultado_em) db().prepare("UPDATE oportunidades SET resultado_em=date('now','-3 hours') WHERE id=?").run(id);
      if (!fechada && et.fase !== 'descartada') db().prepare('UPDATE oportunidades SET resultado_em=NULL WHERE id=?').run(id);
      if (descartando) {
        db().prepare("UPDATE oportunidades SET descarte_motivo=?, descartado_em=date('now','-3 hours'), descartado_por=? WHERE id=?").run(motivo, req.usuario.id, id);
        db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'descarte',?)").run(id, req.usuario.id, motivo);
      } else if (et.fase !== 'descartada' && op.descarte_motivo) {
        db().prepare('UPDATE oportunidades SET descarte_motivo=NULL, descartado_em=NULL, descartado_por=NULL WHERE id=?').run(id); // o motivo antigo fica no histórico
      }
    }
    const mudou = Object.entries(camposExec).filter(([k, v]) => v !== op[k]);
    if (mudou.length) {
      db().prepare(`UPDATE oportunidades SET ${mudou.map(([k]) => `${k}=?`).join(', ')}, atualizado_em=datetime('now') WHERE id=?`).run(...mudou.map(([, v]) => v), id);
      db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'valores',?)")
        .run(id, req.usuario.id, mudou.map(([k, v]) => `${ROTULO_EXECUCAO[k]}: ${v == null ? 'removido' : CAMPOS_EXECUCAO[k] === 'valor' ? fmtReal(v) : CAMPOS_EXECUCAO[k] === 'data' ? v.split('-').reverse().join('/') : v}`).join(' · '));
    }
    if (responsavel_id !== undefined) {
      const rid = responsavel_id === null ? null : inteiro(responsavel_id);
      const resp = rid ? db().prepare('SELECT nome FROM usuarios WHERE id=? AND empresa_id=?').get(rid, emp) : null;
      if (rid && !resp) throw Object.assign(new Error('Responsável inválido.'), { status: 400 });
      if (rid !== op.responsavel_id) {
        db().prepare('UPDATE oportunidades SET responsavel_id=? WHERE id=?').run(rid, id);
        db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'atribuicao',?)").run(id, req.usuario.id, `Responsável: ${resp?.nome ?? 'nenhum'}`);
      }
    }
    if (prazo_interno !== undefined && (prazo_interno || null) !== op.prazo_interno) {
      if (prazo_interno && !dataOk(prazo_interno)) throw Object.assign(new Error('Prazo interno inválido.'), { status: 400 });
      db().prepare('UPDATE oportunidades SET prazo_interno=? WHERE id=?').run(prazo_interno || null, id);
      const txt = prazo_interno ? prazo_interno.split('-').reverse().join('/') : 'removido';
      db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'prazo',?)").run(id, req.usuario.id, txt);
    }
    if (posicao != null) db().prepare('UPDATE oportunidades SET posicao=? WHERE id=?').run(inteiro(posicao), id);
  });
  res.json({ ok: true });
});
// Valores e execução da oportunidade (proposta, resultado, empenho, entrega, nota fiscal, recebimento).
// Só os campos enviados mudam; vazio = remover (não informado), diferente de zero.
const CAMPOS_EXECUCAO = { valor_proposta: 'valor', valor_ganho: 'valor', empenho_numero: 'texto', empenho_valor: 'valor', empenho_data: 'data',
  entrega_prazo: 'data', entrega_data: 'data', nf_numero: 'texto', nf_valor: 'valor', nf_data: 'data', recebido_valor: 'valor', recebido_data: 'data' };
const ROTULO_EXECUCAO = { valor_proposta: 'Valor da proposta', valor_ganho: 'Valor ganho', empenho_numero: 'Nº do empenho', empenho_valor: 'Valor empenhado',
  empenho_data: 'Data do empenho', entrega_prazo: 'Prazo de entrega', entrega_data: 'Entregue em', nf_numero: 'Nº da nota fiscal', nf_valor: 'Valor da nota',
  nf_data: 'Nota emitida em', recebido_valor: 'Valor recebido', recebido_data: 'Recebido em' };
const fmtReal = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function valoresExecucao(b) {
  const out = {};
  for (const [k, tipo] of Object.entries(CAMPOS_EXECUCAO)) {
    if (b[k] === undefined) continue;
    const v = b[k] === '' || b[k] === null ? null : b[k];
    if (v === null) { out[k] = null; continue; }
    if (tipo === 'valor') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) throw Object.assign(new Error(`${ROTULO_EXECUCAO[k]} inválido.`), { status: 400 });
      out[k] = Math.round(n * 10000) / 10000; // até 4 casas, como o valor do lance
    } else if (tipo === 'data') {
      if (!dataOk(v)) throw Object.assign(new Error(`${ROTULO_EXECUCAO[k]}: data inválida.`), { status: 400 });
      out[k] = String(v).slice(0, 10);
    } else out[k] = String(v).trim().slice(0, 60) || null;
  }
  return out;
}
r.post('/kanban/:id/comentarios', exigirPapel('analista'), (req, res) => {
  const op = db().prepare('SELECT id FROM oportunidades WHERE id=? AND empresa_id=?').get(inteiro(req.params.id), req.usuario.empresa_id);
  if (!op || !req.body?.texto) return erro(res, 400, 'Oportunidade ou texto inválido.');
  db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'comentario',?)").run(op.id, req.usuario.id, String(req.body.texto).slice(0, 4000));
  res.status(201).json({ ok: true });
});
r.get('/kanban/:id/historico', (req, res) => {
  const op = db().prepare('SELECT id FROM oportunidades WHERE id=? AND empresa_id=?').get(inteiro(req.params.id), req.usuario.empresa_id);
  if (!op) return erro(res, 404, 'Oportunidade não encontrada.');
  res.json(db().prepare(`SELECT h.*, u.nome usuario_nome FROM oportunidade_historico h LEFT JOIN usuarios u ON u.id=h.usuario_id WHERE oportunidade_id=? ORDER BY h.id DESC`).all(op.id));
});
r.delete('/kanban/:id', exigirPapel('gestor'), (req, res) => {
  const op = db().prepare('SELECT o.*, e.fase FROM oportunidades o JOIN kanban_etapas e ON e.id = o.etapa_id WHERE o.id=? AND o.empresa_id=?').get(inteiro(req.params.id), req.usuario.empresa_id);
  if (!op) return erro(res, 404, 'Oportunidade não encontrada.');
  const autorizou = precisaSenhaAdmin(op, { excluir: true }) ? conferirSenhaAdmin(db(), req.usuario.empresa_id, req.usuario.id, req.body?.senha_admin) : null;
  db().prepare('DELETE FROM oportunidades WHERE id=?').run(op.id);
  auditar(req, 'kanban_excluir', 'oportunidade', req.params.id, autorizou ? { admin_id: autorizou.id } : undefined); res.json({ ok: true });
});

// ---------------- Calendário de prazos (Fase 3) ----------------
r.get('/calendario', (req, res) => {
  res.json(eventosCalendario(db(), { empresaId: req.usuario.empresa_id, usuarioId: req.usuario.id, clienteId: req.clienteId, de: dataOk(req.query.de), ate: dataOk(req.query.ate) }));
});
r.get('/calendario.ics', (req, res) => {
  const ev = eventosCalendario(db(), { empresaId: req.usuario.empresa_id, usuarioId: req.usuario.id, clienteId: req.clienteId });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="prazos-licitacoes.ics"');
  res.send(gerarIcs(ev, { urlBase: urlBase(req) }));
});
r.get('/calendario/link', (req, res) => {
  const t = db().prepare('SELECT criado_em FROM calendario_tokens WHERE usuario_id=?').get(req.usuario.id);
  res.json({ ativo: !!t, criado_em: t?.criado_em || null });
});
r.post('/calendario/link', (req, res) => {
  const token = gerarTokenCalendario(db(), req.usuario.id);
  auditar(req, 'calendario_link_gerar', 'usuario', req.usuario.id);
  res.status(201).json({ url: `${urlBase(req)}/calendario/${token}.ics` });
});
r.delete('/calendario/link', (req, res) => {
  revogarTokenCalendario(db(), req.usuario.id);
  auditar(req, 'calendario_link_revogar', 'usuario', req.usuario.id);
  res.json({ ok: true });
});

// ---------------- Empresas assessoradas e certidões ----------------
const hojeBr = () => agoraBrasilia().slice(0, 10);
const uploadPdf = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }).single('arquivo');
const receberPdf = (req, res, next) => uploadPdf(req, res, (e) => (e ? erro(res, 400, e.code === 'LIMIT_FILE_SIZE' ? 'O PDF pode ter no máximo 10 MB.' : 'Falha no envio do arquivo.') : next()));
const clienteDaConta = (req) => db().prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=?').get(inteiro(req.params.id), req.usuario.empresa_id);

r.get('/clientes', (req, res) => res.json({ clientes: listarClientes(db(), req.usuario.empresa_id, hojeBr()), tipos: TIPOS_DOCUMENTO, portes: PORTES }));
r.post('/clientes', exigirPapel('analista'), (req, res) => {
  const id = criarCliente(db(), req.usuario.empresa_id, req.body || {});
  auditar(req, 'cliente_criar', 'cliente', id); res.status(201).json({ id });
});
r.get('/clientes/:id', (req, res) => {
  const c = clienteDaConta(req);
  if (!c) return erro(res, 404, 'Empresa não encontrada.');
  res.json({ cliente: c, documentos: listarDocumentos(db(), req.usuario.empresa_id, { clienteId: c.id, hoje: hojeBr() }), tipos: TIPOS_DOCUMENTO, portes: PORTES });
});
r.patch('/clientes/:id', exigirPapel('analista'), (req, res) => {
  if (!atualizarCliente(db(), req.usuario.empresa_id, inteiro(req.params.id), req.body || {})) return erro(res, 404, 'Empresa não encontrada.');
  auditar(req, 'cliente_editar', 'cliente', req.params.id); res.json({ ok: true });
});
r.delete('/clientes/:id', exigirPapel('gestor'), (req, res) => {
  if (!excluirCliente(db(), req.usuario.empresa_id, inteiro(req.params.id))) return erro(res, 404, 'Empresa não encontrada.');
  auditar(req, 'cliente_excluir', 'cliente', req.params.id); res.json({ ok: true });
});
r.get('/cnpj/validar', (req, res) => res.json({ valido: !!validarCnpj(req.query.cnpj) }));
// Dados públicos do CNPJ (base aberta da Receita, via BrasilAPI / CNPJ.ws) para preencher o cadastro
r.get('/cnpj/:cnpj/consulta', async (req, res) => {
  try { res.json(await consultarCnpj(req.params.cnpj)); }
  catch (e) { erro(res, e.status || 502, e.message); }
});
// Busca os CNAEs da empresa na base pública da Receita e grava; se o ramo estiver vazio, usa a sugestão
r.post('/clientes/:id/cnaes', exigirPapel('analista'), async (req, res) => {
  const id = inteiro(req.params.id);
  const c = db().prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=?').get(id, req.usuario.empresa_id);
  if (!c) return erro(res, 404, 'Empresa não encontrada.');
  try {
    const d = await consultarCnpj(c.cnpj);
    const palavras = c.palavras_chave || d.palavras_sugeridas.join('; ');
    atualizarCliente(db(), req.usuario.empresa_id, id, { cnaes: d.cnaes, palavras_chave: palavras });
    auditar(req, 'cliente_cnaes', 'cliente', id);
    res.json({ cnaes: d.cnaes, palavras_chave: palavras, sugeridas: d.palavras_sugeridas, fonte: d.fonte });
  } catch (e) { erro(res, e.status || 502, e.message); }
});
// Painel de Empresas: do edital ao dinheiro na conta, por empresa assessorada
r.get('/painel/fornecedores', (req, res) => {
  try { res.json(painelFornecedores(db(), req.usuario.empresa_id, { clienteId: req.clienteId || null })); } catch (e) { falha(res, e); }
});
r.get('/painel/empresas', (req, res) => {
  const de = dataOk(req.query.de) ? req.query.de : null; const ate = dataOk(req.query.ate) ? req.query.ate : null;
  if (de && ate && de > ate) return erro(res, 400, 'Período inválido: a data inicial é depois da final.');
  res.json({ ...painelEmpresas(db(), req.usuario.empresa_id, { clienteId: req.clienteId || null, hoje: hojeBr(), agora: agoraBrasilia(), de, ate }), fases: FASES });
});
// Lê as validades do PDF do SICAF para pré-preencher o formulário (não grava nada; o usuário confere e salva)
r.post('/clientes/:id/sicaf/ler', exigirPapel('analista'), receberPdf, async (req, res) => {
  const c = clienteDaConta(req);
  if (!c) return erro(res, 404, 'Empresa não encontrada.');
  if (!req.file?.buffer?.subarray(0, 5).equals(Buffer.from('%PDF-'))) return erro(res, 400, 'Envie o arquivo PDF do SICAF.');
  try {
    const r = await lerSicafPdf(req.file.buffer);
    res.json({ ...r, cnpj_confere: r.cnpj ? r.cnpj === c.cnpj : null });
  } catch (e) { erro(res, e.status || 400, e.message); }
});
// Documentos: multipart com "arquivo" (PDF opcional) e "dados" (JSON: { itens: [...], substitui: [ids] })
r.post('/clientes/:id/documentos', exigirPapel('analista'), receberPdf, (req, res) => {
  const c = clienteDaConta(req);
  if (!c) return erro(res, 404, 'Empresa não encontrada.');
  let dados;
  try { dados = JSON.parse(req.body?.dados || '{}'); } catch { return erro(res, 400, 'Dados inválidos.'); }
  const ids = transacao(db(), () => adicionarDocumentos(db(), c.id, req.usuario.id, dados.itens, req.file, (dados.substitui || []).map(Number)));
  auditar(req, 'cliente_documento_criar', 'cliente', c.id, { ids }); res.status(201).json({ ids });
});
r.delete('/clientes/:id/documentos/:doc', exigirPapel('analista'), (req, res) => {
  const c = clienteDaConta(req);
  if (!c || !excluirDocumento(db(), c.id, inteiro(req.params.doc))) return erro(res, 404, 'Documento não encontrado.');
  auditar(req, 'cliente_documento_excluir', 'cliente', c.id, { doc: req.params.doc }); res.json({ ok: true });
});
r.get('/clientes/:id/documentos/:doc/arquivo', (req, res) => {
  const c = clienteDaConta(req);
  const d = c && db().prepare('SELECT arquivo_caminho, arquivo_nome FROM cliente_documentos WHERE id=? AND cliente_id=?').get(inteiro(req.params.doc), c.id);
  const abs = d?.arquivo_caminho && caminhoArquivo(d.arquivo_caminho);
  if (!abs) return erro(res, 404, 'Arquivo não encontrado.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.arquivo_nome || 'documento.pdf')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(abs, (e) => { if (e && !res.headersSent) erro(res, 404, 'Arquivo não encontrado.'); });
});
r.get('/vencimentos', (req, res) => res.json({ documentos: listarDocumentos(db(), req.usuario.empresa_id, { clienteId: req.clienteId, hoje: hojeBr() }), tipos: TIPOS_DOCUMENTO }));

// ---------------- Fornecedores e cotações (Fase 3) ----------------
const falha = (res, e) => erro(res, e.status || 500, e.status ? e.message : 'Erro interno.');
r.get('/fornecedores', (req, res) => res.json({
  fornecedores: listarFornecedores(db(), req.usuario.empresa_id, { clienteId: req.clienteId, q: req.query.q, ativos: req.query.ativos === '1' }), fretes: FRETES, formas: FORMAS_PAGAMENTO, prazos_boleto: PRAZOS_BOLETO }));
r.post('/fornecedores', exigirPapel('analista'), (req, res) => {
  try { const id = criarFornecedor(db(), req.usuario.empresa_id, req.body || {}); auditar(req, 'fornecedor_criar', 'fornecedor', id); res.status(201).json({ id }); }
  catch (e) { falha(res, e); }
});
r.patch('/fornecedores/:id', exigirPapel('analista'), (req, res) => {
  try {
    if (!atualizarFornecedor(db(), req.usuario.empresa_id, inteiro(req.params.id), req.body || {})) return erro(res, 404, 'Fornecedor não encontrado.');
    auditar(req, 'fornecedor_editar', 'fornecedor', req.params.id); res.json({ ok: true });
  } catch (e) { falha(res, e); }
});
r.delete('/fornecedores/:id', exigirPapel('gestor'), (req, res) => {
  try {
    if (!excluirFornecedor(db(), req.usuario.empresa_id, inteiro(req.params.id))) return erro(res, 404, 'Fornecedor não encontrado.');
    auditar(req, 'fornecedor_excluir', 'fornecedor', req.params.id); res.json({ ok: true });
  } catch (e) { falha(res, e); }
});
r.get('/kanban/:id/cotacoes', (req, res) => {
  try { res.json(cotacoesDaOportunidade(db(), req.usuario.empresa_id, inteiro(req.params.id))); } catch (e) { falha(res, e); }
});
r.post('/kanban/:id/cotacoes', exigirPapel('analista'), (req, res) => {
  try {
    const id = inteiro(req.params.id);
    const out = registrarCotacoes(db(), req.usuario.empresa_id, id, req.usuario.id, req.body || {});
    const f = db().prepare('SELECT COALESCE(nome_fantasia, razao_social) n FROM fornecedores WHERE id=?').get(Number(req.body.fornecedor_id));
    db().prepare("INSERT INTO oportunidade_historico (oportunidade_id, usuario_id, tipo, texto) VALUES (?,?,'cotacao',?)")
      .run(id, req.usuario.id, `${f.n}: ${out.gravados} item(ns) cotado(s)${out.removidos ? `, ${out.removidos} removido(s)` : ''}`);
    res.json(out);
  } catch (e) { falha(res, e); }
});
r.post('/kanban/:id/cotacoes/:cid/escolher', exigirPapel('analista'), (req, res) => {
  try { escolherCotacao(db(), req.usuario.empresa_id, inteiro(req.params.id), inteiro(req.params.cid)); res.json({ ok: true }); } catch (e) { falha(res, e); }
});
r.delete('/kanban/:id/cotacoes/:cid', exigirPapel('analista'), (req, res) => {
  try { if (!excluirCotacao(db(), req.usuario.empresa_id, inteiro(req.params.id), inteiro(req.params.cid))) return erro(res, 404, 'Cotação não encontrada.'); res.json({ ok: true }); }
  catch (e) { falha(res, e); }
});
// ---------------- Fase 4: propostas de preços ----------------
r.get('/propostas', (req, res) => {
  try { res.json(listarPropostas(db(), req.usuario.empresa_id, { clienteId: req.clienteId || null, status: String(req.query.status || 'todas') })); } catch (e) { falha(res, e); }
});
r.get('/kanban/:id/proposta', (req, res) => {
  try { res.json(propostaDaOportunidade(db(), req.usuario.empresa_id, inteiro(req.params.id))); } catch (e) { falha(res, e); }
});
r.put('/kanban/:id/proposta', exigirPapel('analista'), (req, res) => {
  try { salvarProposta(db(), req.usuario.empresa_id, inteiro(req.params.id), req.usuario.id, req.body || {}); res.json(propostaDaOportunidade(db(), req.usuario.empresa_id, inteiro(req.params.id))); }
  catch (e) { falha(res, e); }
});
r.patch('/kanban/:id/proposta/status', exigirPapel('analista'), (req, res) => {
  try { mudarStatusProposta(db(), req.usuario.empresa_id, inteiro(req.params.id), req.usuario.id, req.body?.status); res.json({ ok: true }); } catch (e) { falha(res, e); }
});
r.get('/cotacoes/pedidos', (req, res) => {
  try { res.json(listarPedidos(db(), req.usuario.empresa_id, { clienteId: req.clienteId || null, status: String(req.query.status || 'aguardando') })); } catch (e) { falha(res, e); }
});
r.post('/kanban/:id/pedidos', exigirPapel('analista'), (req, res) => {
  try { res.status(201).json({ id: registrarPedido(db(), req.usuario.empresa_id, inteiro(req.params.id), req.usuario.id, req.body || {}) }); } catch (e) { falha(res, e); }
});
r.post('/kanban/:id/links', exigirPapel('analista'), (req, res) => {
  try { const x = linkDoFornecedor(db(), req.usuario.empresa_id, inteiro(req.params.id), req.usuario.id, req.body || {}); res.json({ url: `${urlBase(req)}/cotar/${x.token}`, expira_em: x.expira_em }); }
  catch (e) { falha(res, e); }
});
r.delete('/kanban/:id/links/:fid', exigirPapel('analista'), (req, res) => {
  try { res.json({ ok: revogarLink(db(), req.usuario.empresa_id, inteiro(req.params.id), inteiro(req.params.fid)) }); } catch (e) { falha(res, e); }
});
// Comprovante de uma resposta recebida pelo link: baixar o PDF ou reenviar o e-mail ao fornecedor
const recebimentoDaConta = (req) => db().prepare(`SELECT r.id FROM cotacao_recebimentos r JOIN oportunidades o ON o.id = r.oportunidade_id
  WHERE r.id=? AND r.oportunidade_id=? AND o.empresa_id=?`).get(inteiro(req.params.rid), inteiro(req.params.id), req.usuario.empresa_id);
r.get('/kanban/:id/recebimentos/:rid/pdf', (req, res) => {
  const x = recebimentoDaConta(req);
  if (!x) return erro(res, 404, 'Recebimento não encontrado.');
  const rec = recebimento(db(), x.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="comprovante-cotacao-${protocolo(rec)}.pdf"`);
  res.send(pdfComprovante(rec));
});
r.post('/kanban/:id/recebimentos/:rid/reenviar', exigirPapel('analista'), async (req, res) => {
  const x = recebimentoDaConta(req);
  if (!x) return erro(res, 404, 'Recebimento não encontrado.');
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().slice(0, 160) : null;
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro(res, 400, 'E-mail inválido.');
    db().prepare('UPDATE cotacao_recebimentos SET email=? WHERE id=?').run(email, x.id);
  }
  const status = await enviarComprovante(db(), x.id, { responderPara: req.usuario.email });
  res.json({ status, erro: status === 'erro' ? db().prepare('SELECT comprovante_erro FROM cotacao_recebimentos WHERE id=?').get(x.id).comprovante_erro : null });
});
r.patch('/kanban/:id/pedidos/:pid', exigirPapel('analista'), (req, res) => {
  try { mudarStatusPedido(db(), req.usuario.empresa_id, inteiro(req.params.id), inteiro(req.params.pid), req.body?.status); res.json({ ok: true }); } catch (e) { falha(res, e); }
});
r.patch('/kanban/:id/cotacoes/parametros', exigirPapel('analista'), (req, res) => {
  try { res.json({ ok: true, ...salvarParametros(db(), req.usuario.empresa_id, inteiro(req.params.id), req.body || {}) }); } catch (e) { falha(res, e); }
});

// ---------------- Preferências de alerta e e-mail (Fase 3) ----------------
r.get('/preferencias', (req, res) => {
  const p = db().prepare('SELECT alertas_email, email_alertas FROM usuario_preferencias WHERE usuario_id=?').get(req.usuario.id);
  res.json({ alertas_email: p ? !!p.alertas_email : true, email_alertas: p?.email_alertas || '', email_login: req.usuario.email, email: statusEmail().configurado,
    envio: (({ provedor, remetente, ultimoEnvio, ultimoErro }) => ({ provedor, remetente, ultimo_envio: ultimoEnvio, ultimo_erro: ultimoErro }))(statusEmail()) });
});
r.patch('/preferencias', (req, res) => {
  const atual = db().prepare('SELECT alertas_email, email_alertas FROM usuario_preferencias WHERE usuario_id=?').get(req.usuario.id) || { alertas_email: 1, email_alertas: null };
  const { alertas_email, email_alertas } = req.body || {};
  let destino = atual.email_alertas;
  if (email_alertas !== undefined) {
    destino = String(email_alertas || '').trim().toLowerCase() || null;
    if (destino && (!EMAIL_RE.test(destino) || destino.length > 200)) return erro(res, 400, 'E-mail para alertas inválido.');
  }
  const ativo = alertas_email === undefined ? atual.alertas_email : (alertas_email ? 1 : 0);
  db().prepare(`INSERT INTO usuario_preferencias (usuario_id, alertas_email, email_alertas) VALUES (?,?,?)
    ON CONFLICT(usuario_id) DO UPDATE SET alertas_email=excluded.alertas_email, email_alertas=excluded.email_alertas`).run(req.usuario.id, ativo, destino);
  auditar(req, 'preferencias_alterar', 'usuario', req.usuario.id, { alertas_email: !!ativo, email_alertas: destino });
  res.json({ ok: true });
});
r.get('/email/status', exigirPapel('admin'), (req, res) => res.json(statusEmail()));
// Nome e e-mail de contato da assessoria (jornal do cliente)
r.get('/empresa/dados', (req, res) => res.json(dadosAssessoria(db(), req.usuario.empresa_id)));
r.patch('/empresa/dados', exigirPapel('admin'), (req, res) => {
  try { const d = salvarDadosAssessoria(db(), req.usuario.empresa_id, req.body || {}); auditar(req, 'empresa_dados', 'empresa', req.usuario.empresa_id, d); res.json(d); }
  catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro ao salvar.'); }
});
// Espaço do volume (Railway) para Configurações
r.get('/sistema/disco', exigirPapel('gestor'), (req, res) => res.json({ disco: usoDoDisco() }));
r.post('/email/teste', async (req, res) => {
  const p = db().prepare('SELECT email_alertas FROM usuario_preferencias WHERE usuario_id=?').get(req.usuario.id);
  const destino = p?.email_alertas || req.usuario.email;
  try { await enviarEmailTeste({ nome: req.usuario.nome, email: destino }); res.json({ ok: true, mensagem: `O provedor de e-mail aceitou o envio para ${destino}.` }); }
  catch (e) { erro(res, 400, e.message); }
});

// ---------------- Fontes de dados (admin) ----------------
// ---------------- Fase 4: preços e contratos ----------------
const csvCampo = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const csv = (cab, linhas) => '\ufeff' + [cab.map(csvCampo).join(';'), ...linhas.map((l) => l.map(csvCampo).join(';'))].join('\r\n');
const decimal = (v) => (v == null ? '' : String(v).replace('.', ','));

r.get('/precos/catalogo', (req, res) => res.json({ status: statusCatalogo(db()), resultados: buscarCatalogo(db(), req.query.q) }));
// ---------------- Pagômetro (CAPAG do Tesouro Nacional) ----------------
r.get('/pagometro', (req, res) => {
  const w = []; const p = [];
  if (req.query.esfera === 'E' || req.query.esfera === 'M') { w.push('esfera=?'); p.push(req.query.esfera); }
  if (req.query.uf) { w.push('uf=?'); p.push(String(req.query.uf).toUpperCase()); }
  if (req.query.q) { w.push('nome LIKE ?'); p.push(`%${String(req.query.q).trim()}%`); }
  if (req.query.nota) {
    const v = String(req.query.nota).toUpperCase();
    if (v === 'SEM') w.push('capag IS NULL'); else if (/^[ABCD]$/.test(v)) { w.push('substr(capag,1,1)=?'); p.push(v); }
  }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const conn = db();
  res.json({
    dados: conn.prepare(`SELECT esfera, chave, nome, uf, capag, capag_texto, ind1, nota1, ind2, nota2, ind3, nota3, icf, observacao FROM capag ${where}
      ORDER BY esfera, uf, nome LIMIT 300`).all(...p),
    total: conn.prepare(`SELECT COUNT(*) n FROM capag ${where}`).get(...p).n,
    resumo: conn.prepare("SELECT esfera, COALESCE(substr(capag,1,1),'n.d.') nota, COUNT(*) n FROM capag GROUP BY 1,2 ORDER BY 1,2").all(),
    referencias: conn.prepare('SELECT esfera, referencia, fonte_url, MAX(atualizado_em) atualizado_em FROM capag GROUP BY esfera').all(),
    fontes: FONTES_CAPAG,
  });
});
r.post('/pagometro/atualizar', exigirPapel('admin'), async (req, res) => {
  const r2 = await atualizarCapag(db());
  auditar(req, 'capag_atualizar', 'capag', null, r2);
  res.json(r2);
});

r.post('/precos/catalogo/atualizar', exigirPapel('admin'), (req, res) => {
  auditar(req, 'catalogo_atualizar');
  sincronizarCatalogo(db()).then((r2) => console.log('[catalogo]', JSON.stringify(r2))).catch((e) => console.error('[catalogo]', e.message));
  res.status(202).json({ iniciado: true, mensagem: 'Download do catálogo do Compras.gov.br iniciado em segundo plano.' });
});
async function pesquisa(req, res) {
  const c = validarConsulta(req.query);
  if (!c) { erro(res, 400, 'Escolha um item do catálogo (tipo e código).'); return null; }
  try {
    const r2 = await consultarPrecos(db(), c, { forcar: req.query.atualizar === '1' });
    const cat = db().prepare('SELECT nome, classe FROM catalogo_compras WHERE tipo=? AND codigo=?')
      .get(c.tipo === 'servico' ? 'servico' : 'material', c.codigo);
    const filtro = String(req.query.filtro || '').slice(0, 120);
    return { consulta: { ...c, nome: cat?.nome || null, classe: cat?.classe || null, filtro }, ...r2, baixados: r2.registros.length, ...analisarPrecos(r2.registros, { ...req.query, filtro }) };
  } catch (e) {
    erro(res, 502, `Não foi possível consultar o Compras.gov.br agora: ${e.message}`); return null;
  }
}
r.get('/precos', async (req, res) => {
  const p = await pesquisa(req, res);
  if (p) res.json({ ...p, registros: p.registros.slice(0, 1000), registros_total: p.registros.length });
});
// Relatório de mercado: Brasil × estado em 6/12/24 meses, quem compra, marcas, fornecedores, licitações abertas.
// modo=lead tira os nomes dos fornecedores concorrentes (vai para a empresa prospectada).
async function relatorio(req, res) {
  const c = validarConsulta(req.query);
  if (!c) { erro(res, 400, 'Escolha um item do catálogo (tipo e código).'); return null; }
  try {
    const cat = db().prepare('SELECT nome, classe FROM catalogo_compras WHERE tipo=? AND codigo=?').get(c.tipo === 'servico' ? 'servico' : 'material', c.codigo);
    const r = await relatorioMercado(db(), { ...c, nome: cat?.nome || null, classe: cat?.classe || null }, {
      filtro: String(req.query.filtro || '').slice(0, 120), item: req.query.item, unidade: req.query.unidade, termo: String(req.query.termo || '').slice(0, 80) });
    return req.query.modo === 'lead' ? paraLead(r) : r;
  } catch (e) { erro(res, 502, `Não foi possível consultar o Compras.gov.br agora: ${e.message}`); return null; }
}
r.get('/precos/relatorio', async (req, res) => { const x = await relatorio(req, res); if (x) res.json(x); });
r.get('/precos/relatorio.pdf', async (req, res) => {
  const x = await relatorio(req, res);
  if (!x) return;
  const emp = db().prepare('SELECT nome FROM empresas WHERE id=?').get(req.usuario.empresa_id);
  const preparadoPor = String(req.query.assinatura || '').slice(0, 160) || [req.usuario.nome, emp?.nome, req.usuario.email].filter(Boolean).join(' · ');
  const buf = pdfRelatorio(x, { modo: req.query.modo === 'lead' ? 'lead' : 'interno', para: String(req.query.para || '').slice(0, 120), preparadoPor });
  const base = String(x.consulta.nome || x.consulta.codigo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${req.query.modo === 'lead' ? 'oportunidade' : 'analise-mercado'}-${base}${x.estado ? `-${x.estado.uf.toLowerCase()}` : ''}.pdf"`);
  res.send(buf);
});
r.get('/precos/exportar', async (req, res) => {
  const p = await pesquisa(req, res);
  if (!p) return;
  const cab = ['Data da compra', 'Código do item', 'Descrição', 'Descrição detalhada', 'Unidade', 'Quantidade', 'Preço unitário (R$)', 'Fora da curva',
    'Fornecedor', 'CNPJ/CPF fornecedor', 'Marca', 'Órgão', 'UASG', 'UASG nome', 'UF', 'Município', 'ID da compra', 'Item da compra'];
  const linhas = p.registros.map((x) => [x.data_compra, x.codigo_item, x.descricao, x.descricao_detalhada, x.unidade, decimal(x.quantidade),
    decimal(x.preco_unitario), x.fora_da_curva ? 'Sim' : '', x.fornecedor_nome, x.fornecedor_ni, x.marca, x.orgao_nome, x.uasg, x.uasg_nome, x.uf,
    x.municipio, x.id_compra, x.numero_item]);
  const est = p.estatisticas;
  const rodape = [[], [`Fonte: Compras.gov.br — Dados Abertos, módulo Pesquisa de Preços. Período ${p.desde} a ${p.ate}. Consultado em ${p.consultado_em} (UTC).${p.consulta.filtro ? ` Filtro de especificação: "${p.consulta.filtro}".` : ''}`],
    [`Unidade: ${p.unidade || '—'} · ${est.n || 0} preços · menor ${decimal(est.menor)} · mediana ${decimal(est.mediana)} · média ${decimal(est.media)} · média sem fora da curva ${decimal(est.media_sem_fora_da_curva)} · maior ${decimal(est.maior)}`],
    ['Fora da curva = critério estatístico (Tukey, 1,5 x intervalo interquartil). A análise crítica dos preços é do usuário (IN SEGES/ME 65/2021, art. 6º).']];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="precos-${p.consulta.tipo}-${p.consulta.codigo}.csv"`);
  res.send(csv(cab, [...linhas, ...rodape]));
});

r.get('/contratos', (req, res) => res.json(buscarContratos(db(), req.query)));
r.get('/contratos/exportar', (req, res) => {
  const r2 = buscarContratos(db(), { ...req.query, pagina: 1 }, { limite: 20000 });
  const cab = ['Nº controle PNCP', 'Contratação de origem', 'Número', 'Tipo', 'Categoria', 'Objeto', 'Fornecedor', 'CNPJ/CPF fornecedor', 'Órgão', 'CNPJ órgão',
    'UF', 'Município', 'Valor inicial (R$)', 'Valor global (R$)', 'Assinatura', 'Vigência início', 'Vigência fim', 'Publicação PNCP', 'Link PNCP'];
  const linhas = r2.linhas.map((c) => [c.numero_controle_pncp, c.numero_controle_compra, c.numero_contrato, c.tipo_contrato, c.categoria, c.objeto,
    c.fornecedor_nome, c.fornecedor_ni, c.orgao_nome, c.orgao_cnpj, c.uf, c.municipio, decimal(c.valor_inicial), decimal(c.valor_global),
    c.data_assinatura, c.vigencia_inicio, c.vigencia_fim, c.data_publicacao, c.link_pncp]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contratos.csv"');
  res.send(csv(cab, linhas));
});

r.get('/fontes', (req, res) => {
  const fontes = db().prepare('SELECT id, codigo, nome, url_oficial, tipo_integracao, status_implementacao, situacao_conexao, habilitada, requer_credenciais, frequencia_minutos, ultima_sincronizacao, ultima_sincronizacao_ok, registros_importados, ultimo_erro, observacoes, config_json FROM fontes ORDER BY id').all();
  const falhas = db().prepare('SELECT fonte_id, COUNT(*) n FROM sync_falhas WHERE resolvida=0 GROUP BY fonte_id').all();
  const mapa = Object.fromEntries(falhas.map((f) => [f.fonte_id, f.n]));
  res.json(fontes.map((f) => ({ ...f, config: JSON.parse(f.config_json), falhas_pendentes: mapa[f.id] || 0, tem_conector: !!CONECTORES[f.codigo] })));
});
r.get('/fontes/:codigo/execucoes', (req, res) => {
  res.json(db().prepare(`SELECT e.* FROM sync_execucoes e JOIN fontes f ON f.id=e.fonte_id WHERE f.codigo=? ORDER BY e.id DESC LIMIT 30`).all(req.params.codigo));
});
r.patch('/fontes/:codigo', exigirPapel('admin'), (req, res) => {
  const f = db().prepare('SELECT * FROM fontes WHERE codigo=?').get(req.params.codigo);
  if (!f) return erro(res, 404, 'Fonte não encontrada.');
  const { habilitada, frequencia_minutos, config } = req.body || {};
  if (habilitada === true && !CONECTORES[f.codigo]) return erro(res, 400, 'Esta fonte não tem conector implementado e não pode ser habilitada.');
  if (habilitada !== undefined) db().prepare("UPDATE fontes SET habilitada=?, situacao_conexao=CASE WHEN ? THEN situacao_conexao ELSE 'desabilitada' END WHERE id=?").run(habilitada ? 1 : 0, habilitada ? 1 : 0, f.id);
  if (frequencia_minutos !== undefined) {
    const n = inteiro(frequencia_minutos); if (n == null || n < 15) return erro(res, 400, 'Frequência mínima: 15 minutos.');
    db().prepare('UPDATE fontes SET frequencia_minutos=? WHERE id=?').run(n, f.id);
  }
  if (config && typeof config === 'object') {
    const atual = JSON.parse(f.config_json);
    const novo = { ...atual };
    if (Array.isArray(config.ufs)) novo.ufs = config.ufs.map((u) => String(u).toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u));
    if (Array.isArray(config.modalidades)) novo.modalidades = config.modalidades.map(Number).filter((n) => n >= 1 && n <= 19);
    if (config.diasRetroativos != null) novo.diasRetroativos = Math.min(30, Math.max(1, inteiro(config.diasRetroativos) || 3));
    db().prepare('UPDATE fontes SET config_json=? WHERE id=?').run(JSON.stringify(novo), f.id);
  }
  auditar(req, 'fonte_alterar', 'fonte', f.codigo, req.body);
  res.json({ ok: true });
});
r.post('/fontes/:codigo/testar', exigirPapel('admin'), async (req, res) => {
  try { res.json(await testarFonte(db(), req.params.codigo)); } catch (e) { erro(res, 400, e.message); }
});
r.post('/fontes/:codigo/sincronizar', exigirPapel('admin'), async (req, res) => {
  try {
    auditar(req, 'fonte_sincronizar', 'fonte', req.params.codigo, { modo: req.body?.modo });
    const modo = req.body?.modo === 'abertas' ? 'abertas' : 'incremental';
    if (sincronizacaoEmAndamento(req.params.codigo)) return res.json({ ignorado: true, mensagem: 'Sincronização já em andamento para esta fonte. Acompanhe em "Execuções".' });
    // Carga completa pode levar dezenas de minutos: roda em segundo plano para a página não ficar presa nem cair por tempo.
    if (modo === 'abertas' || CONECTORES[req.params.codigo]?.segundoPlano) {
      sincronizarFonte(db(), req.params.codigo, { modo }).then((r) => console.log(`[sync] ${req.params.codigo} abertas: ${r.mensagem ?? r.status ?? ''}`))
        .catch((e) => console.error(`[sync] ${req.params.codigo}:`, e.message));
      const oque = modo === 'abertas' ? 'Carga das licitações abertas' : 'Sincronização';
      return res.status(202).json({ iniciado: true, mensagem: `${oque} iniciada em segundo plano. Pode fechar a página; acompanhe em "Execuções".` });
    }
    res.json(await sincronizarFonte(db(), req.params.codigo, { modo }));
  } catch (e) { erro(res, 400, e.message); }
});
r.post('/fontes/:codigo/reprocessar', exigirPapel('admin'), async (req, res) => {
  try { res.json(await reprocessarFalhas(db(), req.params.codigo)); } catch (e) { erro(res, 400, e.message); }
});
r.post('/fontes/:codigo/reiniciar-cursor', exigirPapel('admin'), (req, res) => {
  db().prepare("UPDATE fontes SET cursor_json='{}' WHERE codigo=?").run(req.params.codigo);
  auditar(req, 'fonte_reiniciar_cursor', 'fonte', req.params.codigo); res.json({ ok: true });
});

// Importação de arquivo JSON obtido nas APIs oficiais (alternativa quando o servidor não alcança a fonte).
// Aceita a resposta original do PNCP (/v1/contratacoes/*) ou do Compras.gov.br (módulo contratações 14.133).
r.post('/fontes/importar-json', exigirPapel('admin'), express.json({ limit: '25mb' }), (req, res) => {
  const corpo = req.body;
  let registros = null; let fonte = null; let norm = null;
  if (Array.isArray(corpo?.data)) { registros = corpo.data; fonte = 'pncp'; norm = normalizarPncp; }
  else if (Array.isArray(corpo?.resultado)) { registros = corpo.resultado; fonte = 'comprasgov_14133'; norm = normalizarCompras14133; }
  if (!registros) return erro(res, 400, 'Formato não reconhecido. Envie a resposta JSON original da API do PNCP (campo "data") ou do Compras.gov.br (campo "resultado").');
  const cont = { lidos: 0, inseridos: 0, atualizados: 0, inalterados: 0, rejeitados: 0, erros: [] };
  for (const reg of registros.slice(0, 5000)) {
    cont.lidos++;
    try {
      const c = norm(reg);
      if (!c.chave_canonica || !c.objeto) { cont.rejeitados++; continue; }
      const out = salvarLicitacao(db(), c, fonte, reg);
      cont[{ inserido: 'inseridos', atualizado: 'atualizados', inalterado: 'inalterados' }[out.acao]]++;
    } catch (e) { cont.rejeitados++; if (cont.erros.length < 5) cont.erros.push(e.message); }
  }
  auditar(req, 'importar_json', 'fonte', fonte, { lidos: cont.lidos, inseridos: cont.inseridos });
  res.json({ fonte, ...cont });
});

// ---------------- Usuários (admin da empresa) ----------------
r.get('/usuarios', exigirPapel('admin'), (req, res) => {
  res.json(db().prepare('SELECT id, nome, email, papel, ativo, ultimo_login, criado_em FROM usuarios WHERE empresa_id=? ORDER BY nome').all(req.usuario.empresa_id));
});
r.post('/usuarios', exigirPapel('admin'), (req, res) => {
  const { nome, email, senha, papel } = req.body || {};
  if (papel === 'superadmin' && req.usuario.papel !== 'superadmin') return erro(res, 403, 'Somente superadmin cria superadmin.');
  if (!PAPEIS.includes(papel)) return erro(res, 400, 'Papel inválido.');
  try {
    const id = criarUsuario(db(), { empresaId: req.usuario.empresa_id, nome, email, senha, papel });
    auditar(req, 'usuario_criar', 'usuario', id, { email, papel }); res.status(201).json({ id });
  } catch (e) { erro(res, e.status || 400, /UNIQUE/.test(e.message) ? 'E-mail já cadastrado.' : e.message); }
});
r.patch('/usuarios/:id', exigirPapel('admin'), (req, res) => {
  const id = inteiro(req.params.id);
  const u = db().prepare('SELECT * FROM usuarios WHERE id=? AND empresa_id=?').get(id, req.usuario.empresa_id);
  if (!u) return erro(res, 404, 'Usuário não encontrado.');
  if (id === req.usuario.id && req.body?.ativo === false) return erro(res, 400, 'Você não pode desativar a si mesmo.');
  if (req.body?.papel && (!PAPEIS.includes(req.body.papel) || (req.body.papel === 'superadmin' && req.usuario.papel !== 'superadmin'))) return erro(res, 400, 'Papel inválido.');
  if (req.body?.papel) db().prepare('UPDATE usuarios SET papel=?, token_versao=token_versao+1 WHERE id=?').run(req.body.papel, id);
  if (req.body?.ativo !== undefined) db().prepare('UPDATE usuarios SET ativo=?, token_versao=token_versao+1 WHERE id=?').run(req.body.ativo ? 1 : 0, id);
  auditar(req, 'usuario_alterar', 'usuario', id, req.body); res.json({ ok: true });
});
r.get('/auditoria', exigirPapel('admin'), (req, res) => {
  res.json(db().prepare(`SELECT a.*, u.nome usuario_nome FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id WHERE a.empresa_id=? ORDER BY a.id DESC LIMIT 200`).all(req.usuario.empresa_id));
});

// Tratamento de erros sem vazar detalhes internos
r.use((e, req, res, _next) => {
  console.error('[api]', e);
  res.status(e.status || 500).json({ erro: e.status ? e.message : 'Erro interno. Tente novamente.' });
});

// ---------------- Financeiro (Fase 5): honorários da assessoria e lucro por contrato ----------------
const periodoDe = (req) => {
  const de = dataOk(req.query.de) ? req.query.de : null; const ate = dataOk(req.query.ate) ? req.query.ate : null;
  if (de && ate && de > ate) throw Object.assign(new Error('Período inválido: a data inicial é depois da final.'), { status: 400 });
  return { de, ate };
};
r.get('/financeiro/honorarios', exigirPapel('gestor'), (req, res) => {
  try { res.json({ ...resumoHonorarios(db(), req.usuario.empresa_id, { clienteId: req.clienteId || null, ...periodoDe(req), hoje: hojeBr() }), formas: FORMAS_RECEBIMENTO, tipos: TIPOS_COBRANCA }); }
  catch (e) { falha(res, e); }
});
r.put('/financeiro/contratos/:clienteId', exigirPapel('gestor'), (req, res) => {
  try { const c = salvarContrato(db(), req.usuario.empresa_id, inteiro(req.params.clienteId), req.body || {}); auditar(req, 'honorarios_contrato', 'cliente', c.cliente_id); res.json(c); }
  catch (e) { falha(res, e); }
});
r.post('/financeiro/cobrancas', exigirPapel('gestor'), (req, res) => {
  try { const id = criarCobrancaAvulsa(db(), req.usuario.empresa_id, req.usuario.id, req.body || {}); auditar(req, 'honorarios_cobranca_criar', 'cobranca', id); res.status(201).json({ id }); }
  catch (e) { falha(res, e); }
});
r.patch('/financeiro/cobrancas/:id', exigirPapel('gestor'), (req, res) => {
  try { const c = atualizarCobranca(db(), req.usuario.empresa_id, inteiro(req.params.id), req.body || {}); auditar(req, 'honorarios_cobranca_atualizar', 'cobranca', c.id); res.json(c); }
  catch (e) { falha(res, e); }
});
r.post('/financeiro/cobrancas/:id/cancelar', exigirPapel('gestor'), (req, res) => {
  try { cancelarCobranca(db(), req.usuario.empresa_id, inteiro(req.params.id), req.body?.motivo); auditar(req, 'honorarios_cobranca_cancelar', 'cobranca', inteiro(req.params.id)); res.json({ ok: true }); }
  catch (e) { falha(res, e); }
});
// Desfazer um recebimento mexe no caixa: só com a senha de um administrador (fica na auditoria)
r.post('/financeiro/cobrancas/:id/desfazer-pagamento', exigirPapel('gestor'), (req, res) => {
  try {
    const id = inteiro(req.params.id);
    cobrancaDaEmpresa(db(), req.usuario.empresa_id, id);
    const adm = conferirSenhaAdmin(db(), req.usuario.empresa_id, req.usuario.id, req.body?.senha_admin, { aviso: 'Para desfazer um recebimento, um administrador precisa digitar a senha dele.' });
    desfazerPagamento(db(), req.usuario.empresa_id, id);
    auditar(req, 'honorarios_desfazer_pagamento', 'cobranca', id, { autorizado_por: adm.id });
    res.json({ ok: true });
  } catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro interno.'); }
});
// Excluir um lançamento de honorário; se já foi recebido, mexe no caixa: só com a senha de um administrador
r.delete('/financeiro/cobrancas/:id', exigirPapel('gestor'), (req, res) => {
  try {
    const id = inteiro(req.params.id);
    const c = cobrancaDaEmpresa(db(), req.usuario.empresa_id, id);
    const adm = c.pago_em ? conferirSenhaAdmin(db(), req.usuario.empresa_id, req.usuario.id, req.body?.senha_admin, { aviso: 'Este honorário já foi recebido. Para excluir, um administrador precisa digitar a senha dele.' }) : null;
    excluirCobranca(db(), req.usuario.empresa_id, id, req.usuario.id);
    auditar(req, 'honorarios_cobranca_excluir', 'cobranca', id, { descricao: c.descricao, valor: c.valor, vencimento: c.vencimento, pago_em: c.pago_em, autorizado_por: adm?.id ?? null });
    res.json({ ok: true });
  } catch (e) { erro(res, e.status || 500, e.status ? e.message : 'Erro interno.'); }
});
r.get('/financeiro/lucro', exigirPapel('gestor'), (req, res) => {
  try { res.json(lucroPorContrato(db(), req.usuario.empresa_id, { clienteId: req.clienteId || null, ...periodoDe(req) })); }
  catch (e) { falha(res, e); }
});
r.get('/kanban/:id/custos', exigirPapel('analista'), (req, res) => {
  const emp = req.usuario.empresa_id; const id = inteiro(req.params.id);
  const op = db().prepare('SELECT id FROM oportunidades WHERE id=? AND empresa_id=?').get(id, emp);
  if (!op) return erro(res, 404, 'Card não encontrado.');
  // Sugestão a partir das cotações e da proposta (o usuário confere antes de lançar)
  let sugestao = null;
  try {
    const p = propostaDaOportunidade(db(), emp, id);
    const inc = p.itens.filter((i) => i.incluir && i.custo_unitario != null && i.quantidade != null);
    if (inc.length) {
      const produto = Math.round(inc.reduce((s, i) => s + i.custo_unitario * i.quantidade, 0) * 100) / 100;
      const venda = inc.every((i) => i.total != null) ? inc.reduce((s, i) => s + i.total, 0) : null;
      sugestao = { produto, itens: inc.length, impostos_pct: p.impostos_pct ?? null,
        impostos: p.impostos_pct != null && venda != null ? Math.round(venda * p.impostos_pct) / 100 : null, venda: venda != null ? Math.round(venda * 100) / 100 : null };
    }
  } catch { sugestao = null; }
  const card = db().prepare(`SELECT o.id, o.licitacao_id, o.cliente_id, l.objeto, l.orgao_nome, ke.nome etapa, ke.fase, COALESCE(cl.nome_fantasia, cl.razao_social) cliente_nome
    FROM oportunidades o JOIN kanban_etapas ke ON ke.id=o.etapa_id LEFT JOIN licitacoes l ON l.id=o.licitacao_id LEFT JOIN clientes cl ON cl.id=o.cliente_id WHERE o.id=?`).get(id);
  const contrato = lucroPorContrato(db(), emp, { clienteId: card.cliente_id || null }).contratos.find((x) => x.oportunidade_id === id) || null;
  res.json({ card, contrato, custos: custosDaOportunidade(db(), emp, id), categorias: CATEGORIAS_CUSTO, sugestao });
});
r.post('/kanban/:id/custos', exigirPapel('analista'), (req, res) => {
  try { const id = lancarCusto(db(), req.usuario.empresa_id, req.usuario.id, inteiro(req.params.id), req.body || {}); res.status(201).json({ id }); }
  catch (e) { falha(res, e); }
});
r.delete('/kanban/:id/custos/:custo', exigirPapel('analista'), (req, res) => {
  try { excluirCusto(db(), req.usuario.empresa_id, inteiro(req.params.id), inteiro(req.params.custo)); res.json({ ok: true }); }
  catch (e) { falha(res, e); }
});

export default r;
