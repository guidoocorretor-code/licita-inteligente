-- Licita Inteligente — esquema relacional (SQLite; compatível em grande parte com PostgreSQL)
-- Convenções: datas em ISO 8601 (texto), valores monetários em REAL (reais),
-- NULL = "não informado pela fonte"; 0 = "zero informado pela fonte".

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  versao INTEGER PRIMARY KEY,
  aplicada_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Multiempresa e usuários ============
CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('superadmin','admin','gestor','analista','leitor')),
  ativo INTEGER NOT NULL DEFAULT 1,
  token_versao INTEGER NOT NULL DEFAULT 0,
  tentativas_login INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TEXT,
  ultimo_login TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_usuarios_empresa ON usuarios(empresa_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER,
  usuario_id INTEGER,
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id TEXT,
  detalhes TEXT,
  ip TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_auditoria_empresa ON auditoria(empresa_id, criado_em);

-- ============ Fontes / conectores ============
CREATE TABLE IF NOT EXISTS fontes (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  url_oficial TEXT,
  tipo_integracao TEXT NOT NULL,             -- api_rest | dados_abertos | via_pncp | manual | indisponivel
  status_implementacao TEXT NOT NULL CHECK (status_implementacao IN ('funcional','parcial','aguardando_credenciais','indisponivel')),
  situacao_conexao TEXT NOT NULL DEFAULT 'nao_testada', -- nao_testada | ok | erro | bloqueada_rede | desabilitada
  habilitada INTEGER NOT NULL DEFAULT 0,
  requer_credenciais INTEGER NOT NULL DEFAULT 0,
  frequencia_minutos INTEGER NOT NULL DEFAULT 60,
  ultima_sincronizacao TEXT,
  ultima_sincronizacao_ok TEXT,
  registros_importados INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  observacoes TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  cursor_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sync_execucoes (
  id INTEGER PRIMARY KEY,
  fonte_id INTEGER NOT NULL REFERENCES fontes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'incremental',  -- incremental | completa | teste | reprocesso
  iniciado_em TEXT NOT NULL DEFAULT (datetime('now')),
  finalizado_em TEXT,
  status TEXT NOT NULL DEFAULT 'executando', -- executando | sucesso | parcial | erro
  registros_lidos INTEGER NOT NULL DEFAULT 0,
  inseridos INTEGER NOT NULL DEFAULT 0,
  atualizados INTEGER NOT NULL DEFAULT 0,
  inalterados INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0,
  mensagem TEXT,
  parametros_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_sync_fonte ON sync_execucoes(fonte_id, iniciado_em);

CREATE TABLE IF NOT EXISTS sync_falhas (
  id INTEGER PRIMARY KEY,
  fonte_id INTEGER NOT NULL REFERENCES fontes(id) ON DELETE CASCADE,
  execucao_id INTEGER REFERENCES sync_execucoes(id) ON DELETE SET NULL,
  id_externo TEXT,
  etapa TEXT,
  erro TEXT,
  payload_json TEXT,
  tentativas INTEGER NOT NULL DEFAULT 1,
  resolvida INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Dados públicos (compartilhados entre empresas) ============
CREATE TABLE IF NOT EXISTS orgaos (
  id INTEGER PRIMARY KEY,
  cnpj TEXT NOT NULL UNIQUE,
  razao_social TEXT,
  esfera TEXT,          -- F | E | M | D | N (código PNCP)
  poder TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS licitacoes (
  id INTEGER PRIMARY KEY,
  sistema_eletronico TEXT,                      -- sistema de disputa identificado (services/sistemas.js)
  chave_canonica TEXT NOT NULL UNIQUE,          -- base da deduplicação
  numero_controle_pncp TEXT UNIQUE,
  numero_compra TEXT,
  ano INTEGER,
  sequencial INTEGER,
  processo TEXT,
  orgao_id INTEGER REFERENCES orgaos(id),
  orgao_cnpj TEXT,
  orgao_nome TEXT,
  unidade_codigo TEXT,
  unidade_nome TEXT,
  esfera TEXT,
  poder TEXT,
  uf TEXT,
  municipio TEXT,
  codigo_ibge TEXT,
  modalidade_id INTEGER,
  modalidade_nome TEXT,
  amparo_legal TEXT,
  regime_legal TEXT,                            -- ex.: Lei 14.133/2021, Lei 13.303/2016, Lei 8.666/1993
  tipo_instrumento TEXT,
  objeto TEXT,
  informacao_complementar TEXT,
  srp INTEGER,
  valor_estimado REAL,
  valor_estimado_situacao TEXT,                 -- informado | sigiloso | nao_informado
  valor_homologado REAL,
  data_publicacao TEXT,
  data_abertura_proposta TEXT,
  data_encerramento_proposta TEXT,
  data_sessao TEXT,
  situacao_oficial_id INTEGER,
  situacao_oficial_nome TEXT,
  status_calculado TEXT NOT NULL DEFAULT 'indeterminada',
  status_motivo TEXT,
  modo_disputa_id INTEGER,
  modo_disputa_nome TEXT,
  criterio_julgamento TEXT,
  num_itens INTEGER,
  segmento TEXT,                                -- classificação automática por palavras-chave do objeto
  me_epp_exclusivo INTEGER,                     -- NULL = não verificado
  tem_documentos INTEGER,                       -- NULL = não verificado
  plataforma_origem TEXT,
  fonte_principal TEXT,
  link_origem TEXT,
  link_pncp TEXT,
  data_atualizacao_fonte TEXT,
  ultima_verificacao TEXT NOT NULL DEFAULT (datetime('now')),
  detalhes_sincronizados_em TEXT,
  hash_conteudo TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_lic_status ON licitacoes(status_calculado);
CREATE INDEX IF NOT EXISTS ix_lic_uf_mun ON licitacoes(uf, municipio);
CREATE INDEX IF NOT EXISTS ix_lic_pub ON licitacoes(data_publicacao);
CREATE INDEX IF NOT EXISTS ix_lic_enc ON licitacoes(data_encerramento_proposta);
CREATE INDEX IF NOT EXISTS ix_lic_modal ON licitacoes(modalidade_id);
CREATE INDEX IF NOT EXISTS ix_lic_orgao ON licitacoes(orgao_cnpj);
CREATE INDEX IF NOT EXISTS ix_lic_valor ON licitacoes(valor_estimado);
CREATE INDEX IF NOT EXISTS ix_lic_plat ON licitacoes(plataforma_origem);
CREATE INDEX IF NOT EXISTS ix_lic_seg ON licitacoes(segmento);
CREATE INDEX IF NOT EXISTS ix_lic_criado ON licitacoes(criado_em);

CREATE VIRTUAL TABLE IF NOT EXISTS licitacoes_fts USING fts5(
  objeto, orgao_nome, municipio, informacao_complementar,
  content='licitacoes', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS trg_lic_ai AFTER INSERT ON licitacoes BEGIN
  INSERT INTO licitacoes_fts(rowid, objeto, orgao_nome, municipio, informacao_complementar)
  VALUES (new.id, new.objeto, new.orgao_nome, new.municipio, new.informacao_complementar);
END;
CREATE TRIGGER IF NOT EXISTS trg_lic_ad AFTER DELETE ON licitacoes BEGIN
  INSERT INTO licitacoes_fts(licitacoes_fts, rowid, objeto, orgao_nome, municipio, informacao_complementar)
  VALUES ('delete', old.id, old.objeto, old.orgao_nome, old.municipio, old.informacao_complementar);
END;
CREATE TRIGGER IF NOT EXISTS trg_lic_au AFTER UPDATE OF objeto, orgao_nome, municipio, informacao_complementar ON licitacoes BEGIN
  INSERT INTO licitacoes_fts(licitacoes_fts, rowid, objeto, orgao_nome, municipio, informacao_complementar)
  VALUES ('delete', old.id, old.objeto, old.orgao_nome, old.municipio, old.informacao_complementar);
  INSERT INTO licitacoes_fts(rowid, objeto, orgao_nome, municipio, informacao_complementar)
  VALUES (new.id, new.objeto, new.orgao_nome, new.municipio, new.informacao_complementar);
END;

-- Vínculos de origem: uma licitação pode vir de várias fontes sem duplicar
CREATE TABLE IF NOT EXISTS licitacao_fontes (
  id INTEGER PRIMARY KEY,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  fonte_codigo TEXT NOT NULL,
  id_externo TEXT NOT NULL,
  url TEXT,
  payload_hash TEXT,
  payload_json TEXT,
  primeira_vez TEXT NOT NULL DEFAULT (datetime('now')),
  ultima_vez TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fonte_codigo, id_externo)
);
CREATE INDEX IF NOT EXISTS ix_licfonte_lic ON licitacao_fontes(licitacao_id);

CREATE TABLE IF NOT EXISTS licitacao_itens (
  id INTEGER PRIMARY KEY,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  numero_item INTEGER NOT NULL,
  descricao TEXT,
  material_servico TEXT,
  quantidade REAL,
  unidade_medida TEXT,
  valor_unitario_estimado REAL,
  valor_total_estimado REAL,
  orcamento_sigiloso INTEGER,
  criterio_julgamento TEXT,
  situacao_item_id INTEGER,
  situacao_item_nome TEXT,
  tipo_beneficio_id INTEGER,
  tipo_beneficio_nome TEXT,
  catalogo_codigo TEXT,
  ncm_nbs TEXT,
  tem_resultado INTEGER,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (licitacao_id, numero_item)
);

-- Busca também na descrição dos itens (como a busca do portal PNCP): "mouse" acha o pregão de "materiais de informática"
CREATE VIRTUAL TABLE IF NOT EXISTS itens_fts USING fts5(
  descricao, content='licitacao_itens', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
-- Itens antigos entram no índice aos poucos, depois que o servidor já está no ar (db/index.js: indexarItensPendentes).
-- Por isso apagar/alterar só mexe no índice quando o item já está nele (apagar o que não está corrompe o FTS5).
DROP TRIGGER IF EXISTS trg_itens_ad;
DROP TRIGGER IF EXISTS trg_itens_au;
CREATE TRIGGER IF NOT EXISTS trg_itens_ai AFTER INSERT ON licitacao_itens BEGIN
  INSERT INTO itens_fts(rowid, descricao) VALUES (new.id, new.descricao);
END;
CREATE TRIGGER IF NOT EXISTS trg_itens_ad2 AFTER DELETE ON licitacao_itens
  WHEN EXISTS (SELECT 1 FROM itens_fts_docsize WHERE id = old.id) BEGIN
  INSERT INTO itens_fts(itens_fts, rowid, descricao) VALUES ('delete', old.id, old.descricao);
END;
CREATE TRIGGER IF NOT EXISTS trg_itens_au2 AFTER UPDATE OF descricao ON licitacao_itens BEGIN
  INSERT INTO itens_fts(itens_fts, rowid, descricao) SELECT 'delete', old.id, old.descricao
    WHERE EXISTS (SELECT 1 FROM itens_fts_docsize WHERE id = old.id);
  INSERT INTO itens_fts(rowid, descricao) VALUES (new.id, new.descricao);
END;

CREATE TABLE IF NOT EXISTS licitacao_documentos (
  id INTEGER PRIMARY KEY,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  sequencial INTEGER NOT NULL,
  titulo TEXT,
  tipo TEXT,
  url TEXT NOT NULL,
  data_publicacao TEXT,
  ativo INTEGER,
  UNIQUE (licitacao_id, sequencial)
);

-- Histórico de alterações e eventos (alimenta o Jornal de Licitações)
CREATE TABLE IF NOT EXISTS licitacao_eventos (
  id INTEGER PRIMARY KEY,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,          -- publicacao | alteracao | situacao | documento | resultado | item
  campo TEXT,
  valor_anterior TEXT,
  valor_novo TEXT,
  descricao TEXT NOT NULL,
  fonte_codigo TEXT,
  ocorrido_em TEXT,            -- data informada pela fonte (quando houver)
  detectado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_eventos_det ON licitacao_eventos(detectado_em);
CREATE INDEX IF NOT EXISTS ix_eventos_lic ON licitacao_eventos(licitacao_id);

-- ============ Dados por empresa (isolados por empresa_id) ============
CREATE TABLE IF NOT EXISTS favoritos (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('licitacao','orgao','fornecedor','pesquisa')),
  referencia TEXT NOT NULL,
  lista TEXT NOT NULL DEFAULT 'Geral',
  nota TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  cliente_id INTEGER NOT NULL DEFAULT 0,       -- empresa assessorada (0 = sem empresa)
  UNIQUE (usuario_id, cliente_id, tipo, referencia, lista)
);
CREATE INDEX IF NOT EXISTS ix_fav_emp ON favoritos(empresa_id, usuario_id);

CREATE TABLE IF NOT EXISTS pesquisas_salvas (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  filtros_json TEXT NOT NULL,
  alertar INTEGER NOT NULL DEFAULT 0,
  ultimo_alerta_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensagem TEXT,
  licitacao_id INTEGER REFERENCES licitacoes(id) ON DELETE SET NULL,
  lida INTEGER NOT NULL DEFAULT 0,
  enviada_email INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notificacoes(usuario_id, lida);

-- Kanban: etapa interna da empresa, separada da situação oficial
CREATE TABLE IF NOT EXISTS kanban_etapas (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  UNIQUE (empresa_id, nome)
);

CREATE TABLE IF NOT EXISTS oportunidades (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  etapa_id INTEGER NOT NULL REFERENCES kanban_etapas(id),
  responsavel_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  prazo_interno TEXT,
  posicao INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  cliente_id INTEGER NOT NULL DEFAULT 0,       -- empresa assessorada (0 = sem empresa)
  UNIQUE (empresa_id, cliente_id, licitacao_id)
);

CREATE TABLE IF NOT EXISTS oportunidade_historico (
  id INTEGER PRIMARY KEY,
  oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,          -- criacao | movimento | comentario | atribuicao
  texto TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fase 3: link de assinatura do calendário (só o hash do token é guardado)
CREATE TABLE IF NOT EXISTS calendario_tokens (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fase 3: controle de alertas já gerados (evita repetir o mesmo aviso)
CREATE TABLE IF NOT EXISTS alertas_gerados (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuario_id, chave)
);

-- Fase 3: preferências de alerta por usuário
CREATE TABLE IF NOT EXISTS usuario_preferencias (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  alertas_email INTEGER NOT NULL DEFAULT 1,
  email_alertas TEXT            -- destino dos alertas; vazio = e-mail de login
);

-- ============ Fase 4: preços e contratos (dados públicos) ============
-- Contratos publicados no PNCP (/v1/contratos). Valores como informados pela fonte; NULL = não informado.
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY,
  numero_controle_pncp TEXT NOT NULL UNIQUE,
  numero_controle_compra TEXT,                  -- liga o contrato à contratação (licitação) de origem
  licitacao_id INTEGER REFERENCES licitacoes(id) ON DELETE SET NULL,
  ano INTEGER,
  sequencial INTEGER,
  numero_contrato TEXT,
  processo TEXT,
  tipo_contrato TEXT,
  categoria TEXT,
  orgao_cnpj TEXT,
  orgao_nome TEXT,
  unidade_nome TEXT,
  esfera TEXT,
  uf TEXT,
  municipio TEXT,
  codigo_ibge TEXT,
  fornecedor_ni TEXT,
  fornecedor_nome TEXT,
  tipo_pessoa TEXT,
  objeto TEXT,
  valor_inicial REAL,
  valor_global REAL,
  valor_acumulado REAL,
  numero_parcelas INTEGER,
  data_assinatura TEXT,
  vigencia_inicio TEXT,
  vigencia_fim TEXT,
  data_publicacao TEXT,
  data_atualizacao TEXT,
  plataforma_origem TEXT,
  link_pncp TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ctr_compra ON contratos(numero_controle_compra);
CREATE INDEX IF NOT EXISTS ix_ctr_lic ON contratos(licitacao_id);
CREATE INDEX IF NOT EXISTS ix_ctr_uf ON contratos(uf, municipio);
CREATE INDEX IF NOT EXISTS ix_ctr_forn ON contratos(fornecedor_ni);
CREATE INDEX IF NOT EXISTS ix_ctr_assin ON contratos(data_assinatura);
CREATE INDEX IF NOT EXISTS ix_ctr_valor ON contratos(valor_global);

CREATE VIRTUAL TABLE IF NOT EXISTS contratos_fts USING fts5(
  objeto, fornecedor_nome, orgao_nome, municipio,
  content='contratos', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS trg_ctr_ai AFTER INSERT ON contratos BEGIN
  INSERT INTO contratos_fts(rowid, objeto, fornecedor_nome, orgao_nome, municipio) VALUES (new.id, new.objeto, new.fornecedor_nome, new.orgao_nome, new.municipio);
END;
CREATE TRIGGER IF NOT EXISTS trg_ctr_ad AFTER DELETE ON contratos BEGIN
  INSERT INTO contratos_fts(contratos_fts, rowid, objeto, fornecedor_nome, orgao_nome, municipio) VALUES ('delete', old.id, old.objeto, old.fornecedor_nome, old.orgao_nome, old.municipio);
END;
CREATE TRIGGER IF NOT EXISTS trg_ctr_au AFTER UPDATE OF objeto, fornecedor_nome, orgao_nome, municipio ON contratos BEGIN
  INSERT INTO contratos_fts(contratos_fts, rowid, objeto, fornecedor_nome, orgao_nome, municipio) VALUES ('delete', old.id, old.objeto, old.fornecedor_nome, old.orgao_nome, old.municipio);
  INSERT INTO contratos_fts(rowid, objeto, fornecedor_nome, orgao_nome, municipio) VALUES (new.id, new.objeto, new.fornecedor_nome, new.orgao_nome, new.municipio);
END;

-- Catálogo oficial do Compras.gov.br (PDM de materiais e itens de serviço), para achar o código pela descrição
CREATE TABLE IF NOT EXISTS catalogo_compras (
  tipo TEXT NOT NULL CHECK (tipo IN ('material','servico')),
  codigo INTEGER NOT NULL,
  nome TEXT NOT NULL,
  classe TEXT,
  grupo TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tipo, codigo)
);
CREATE VIRTUAL TABLE IF NOT EXISTS catalogo_fts USING fts5(
  nome, classe, content='catalogo_compras', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS trg_cat_ai AFTER INSERT ON catalogo_compras BEGIN
  INSERT INTO catalogo_fts(rowid, nome, classe) VALUES (new.rowid, new.nome, new.classe);
END;
CREATE TRIGGER IF NOT EXISTS trg_cat_ad AFTER DELETE ON catalogo_compras BEGIN
  INSERT INTO catalogo_fts(catalogo_fts, rowid, nome, classe) VALUES ('delete', old.rowid, old.nome, old.classe);
END;
CREATE TRIGGER IF NOT EXISTS trg_cat_au AFTER UPDATE OF nome, classe ON catalogo_compras BEGIN
  INSERT INTO catalogo_fts(catalogo_fts, rowid, nome, classe) VALUES ('delete', old.rowid, old.nome, old.classe);
  INSERT INTO catalogo_fts(rowid, nome, classe) VALUES (new.rowid, new.nome, new.classe);
END;

-- Cache das consultas de preço ao Compras.gov.br (evita repetir a mesma consulta no mesmo dia)
CREATE TABLE IF NOT EXISTS precos_consultas (
  chave TEXT PRIMARY KEY,
  registros_json TEXT NOT NULL,
  total_fonte INTEGER,
  truncado INTEGER NOT NULL DEFAULT 0,
  consultado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Empresas assessoradas (clientes da assessoria) e suas certidões ============
-- "empresas" (acima) é a conta que usa o sistema; "clientes" são as empresas que ela assessora.
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cnpj TEXT NOT NULL,                 -- só dígitos
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT,
  porte TEXT,                         -- MEI | ME | EPP | Demais (informado pelo usuário)
  uf TEXT,
  municipio TEXT,
  email TEXT,
  telefone TEXT,
  resp_nome TEXT,                     -- responsável legal
  resp_cargo TEXT,
  resp_email TEXT,
  resp_telefone TEXT,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empresa_id, cnpj)
);

CREATE TABLE IF NOT EXISTS cliente_documentos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                 -- ver TIPOS_DOCUMENTO em services/clientes.js
  descricao TEXT,
  numero TEXT,
  emissao TEXT,                       -- AAAA-MM-DD
  validade TEXT,                      -- AAAA-MM-DD; NULL = sem validade informada
  arquivo_caminho TEXT,               -- relativo a STORAGE_DIR; o mesmo PDF (ex.: SICAF) pode servir a vários
  arquivo_nome TEXT,
  arquivo_tamanho INTEGER,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_clidoc_cli ON cliente_documentos(cliente_id);
CREATE INDEX IF NOT EXISTS ix_clidoc_val ON cliente_documentos(validade);

-- Pagômetro: CAPAG (capacidade de pagamento) do Tesouro Nacional por estado (esfera E, chave = UF) e município (M, chave = IBGE)
CREATE TABLE IF NOT EXISTS capag (
  esfera TEXT NOT NULL,
  chave TEXT NOT NULL,
  nome TEXT,
  uf TEXT,
  capag TEXT,            -- A, B, C, D (com "+" quando houver); NULL = n.d.
  capag_texto TEXT,      -- valor original da planilha
  ind1 REAL, nota1 TEXT, -- endividamento
  ind2 REAL, nota2 TEXT, -- poupança corrente
  ind3 REAL, nota3 TEXT, -- liquidez
  icf TEXT,
  observacao TEXT,
  referencia TEXT,       -- nome do arquivo/posição publicada pelo Tesouro
  fonte_url TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (esfera, chave)
);
CREATE INDEX IF NOT EXISTS ix_capag_nome ON capag(esfera, uf, nome COLLATE NOCASE);
