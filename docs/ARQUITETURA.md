# Arquitetura técnica — Licita Inteligente v0.2

## Visão geral
```
Navegador (PWA, JS puro)  ──HTTPS/cookie HttpOnly──►  Node.js + Express  ──►  SQLite (WAL, FTS5)
                                                         │
                                                         ├─ Agendador (sincronização por fonte)
                                                         └─ Conectores ──► PNCP / Compras.gov.br (APIs oficiais)
```
Escolhas e motivo:
- **Node 22 + `node:sqlite`**: zero dependências nativas, fácil de rodar e publicar. O esquema é SQL padrão e pode
  migrar para PostgreSQL quando houver várias instâncias (troque `server/db/index.js`; FTS5 → `tsvector`).
- **Frontend sem build** (módulos ES nativos): menos peças para manter; CSP restrita (`script-src 'self'`).
- **Conector por fonte** (`server/connectors/`), com contrato `testar()`, `coletar()` (gerador de lotes) e `detalhes()`.

## Estrutura de pastas
| Caminho | Conteúdo |
|---|---|
| `server/config.js` | Configuração por variáveis de ambiente |
| `server/db/schema.sql` | Esquema completo (tabelas, índices, FTS, gatilhos) |
| `server/connectors/catalogo.js` | Cadastro de fontes com status real |
| `server/connectors/pncp.js` | Conector PNCP (consultas, itens, documentos) |
| `server/connectors/comprasgov.js` | Conectores Compras.gov.br (14.133, legado, preços) |
| `server/lib/http.js` | HTTP com timeout, repetição com espera progressiva, limite por host |
| `server/lib/auth.js` | Senhas bcrypt, JWT em cookie, papéis, CSRF, auditoria |
| `server/services/normalizacao.js` | Fonte → modelo canônico (sem inventar dados) |
| `server/services/status.js` | Regras de classificação de status |
| `server/services/repositorio.js` | Upsert, deduplicação, histórico/eventos |
| `server/services/sync.js` | Execuções, falhas, reprocesso, cursor incremental |
| `server/services/busca.js` | Filtros combináveis e paginação |
| `server/services/dashboard.js` | Indicadores calculados do banco |
| `server/services/alertas.js` | Alertas de pesquisas salvas |
| `server/routes/api.js` | API REST |
| `web/` | Interface PWA |
| `tests/unit`, `tests/integration` | Testes |

## Banco de dados
Tabelas: `empresas`, `usuarios`, `auditoria`, `fontes`, `sync_execucoes`, `sync_falhas`, `orgaos`, `licitacoes`,
`licitacoes_fts` (busca textual sem acento), `licitacao_fontes`, `licitacao_itens`, `licitacao_documentos`,
`licitacao_eventos`, `favoritos`, `pesquisas_salvas`, `notificacoes`, `kanban_etapas`, `oportunidades`,
`oportunidade_historico`. Detalhes e comentários em `server/db/schema.sql`.

Dados públicos (licitações, órgãos, itens) são compartilhados; dados de trabalho (favoritos, pesquisas, notificações,
Kanban) têm `empresa_id`/`usuario_id` e toda consulta filtra por eles.

## Deduplicação
1. `chave_canonica` única: `pncp:<numeroControlePNCP>` quando existe (PNCP e Compras.gov.br 14.133 compartilham esse número);
   `siasg:<uasg>|<modalidade>|<aviso>` para o legado; senão `generica:<cnpj>|<modalidade>|<número>|<ano>`.
2. Cada origem fica em `licitacao_fontes (fonte_codigo, id_externo)` — nada se perde.
3. Prioridade de confiança: PNCP (1) > Compras 14.133 (2) > legado (3). Fonte de menor prioridade **só complementa campos vazios**.
4. Ausência de dado nunca apaga valor existente.

## Classificação de status
Ver `server/services/status.js` (testado em `tests/unit/status.test.js`):
- Situação oficial 2/3/4 → revogada / anulada / suspensa.
- Com itens: deserto (4) e fracassado (5) **somente** pela situação oficial dos itens no PNCP.
- Sem itens: por datas → aguardando propostas, aberta, prazo encerrado (aguardando resultado), indeterminada.
- Status dependentes do relógio são recalculados a cada minuto pelo agendador.

## Sincronização
- **Incremental**: `/v1/contratacoes/atualizacao` desde o cursor (por UF × modalidade). O cursor só avança em sucesso.
- **Abertas**: `/v1/contratacoes/proposta` (carga inicial das oportunidades em aberto).
- **Detalhes**: itens e documentos das novas/alteradas e das que aguardam resultado (a cada 24 h), com limite por execução.
- Repetição com espera progressiva em 429/5xx; bloqueio de rede não é repetido indefinidamente.
- Falhas por registro vão para `sync_falhas` e podem ser reprocessadas pela tela ou API.
- Em produção com várias instâncias, deixe `SCHEDULER=on` em apenas uma, ou use `npm run sync` no cron.

## Segurança
- Senhas bcrypt (custo 12), política mínima, bloqueio de 15 min após 5 erros, limite de tentativas por IP.
- Sessão JWT em cookie `HttpOnly; SameSite=Strict; Secure` (produção); revogação via `token_versao`.
- CSRF: cookie SameSite + cabeçalho obrigatório `X-Requested-With` em métodos de escrita.
- Papéis: leitor < analista < gestor < admin < superadmin. Isolamento por empresa testado.
- Cabeçalhos: CSP restrita, `X-Frame-Options: DENY`, `nosniff`, HSTS em produção.
- Interface insere todo texto externo como texto (sem `innerHTML`) — evita XSS vindo de editais.
- Segredos só em variáveis de ambiente; `.env` no `.gitignore`. Erros internos não são expostos ao usuário.
- Auditoria de login, exportações, sincronizações, alterações de fontes, usuários e Kanban.

## Backup, retenção e LGPD
- Backup: `sqlite3 storage/licita.db ".backup 'backup-AAAAMMDD.db'"` (ou cópia com o app parado), diário, guardando 30 dias
  fora do servidor. Teste a restauração mensalmente.
- Retenção sugerida: dados públicos sem prazo; `auditoria` 5 anos; `sync_execucoes` 180 dias; `notificacoes` 1 ano.
- LGPD: o sistema guarda dados pessoais mínimos de usuários (nome, e-mail). Dados de licitações são públicos
  (Lei 12.527/2011 e Lei 14.133/2021). Defina controlador, encarregado (DPO) e termos de uso antes do uso comercial.

## Limitações conhecidas (v0.2)
- PNCP não informa a data/hora da sessão de disputa separadamente: o campo fica "Não informado" (não é estimado).
- Segmento é estimado por palavras-chave (sinalizado na interface).
- Alertas por e-mail implementados (Fase 3), ativos quando `SMTP_URL` está configurado. WhatsApp não implementado (depende de provedor oficial).
- Módulos das Fases 4 a 6 ainda não construídos aparecem no menu marcados com a fase e não exibem dados simulados.

## Fase 3: fornecedores e cotações
- **Fornecedores** (`server/services/fornecedores.js`, tabela `fornecedores`): cadastro por conta, com `cliente_id` (0 = vale para todas as empresas assessoradas), CNPJ opcional e validado, produtos/marcas separados por ";", prazo, pedido mínimo, frete (CIF/FOB), formas de pagamento aceitas (`formas_pagamento`: boleto, pix, ted, cartao), dias das parcelas do boleto (`boleto_prazo`, ex.: 30/60; 0 = à vista) e se faz venda à ordem/triangulação (`venda_a_ordem`: 1, 0 ou NULL = não informado). Excluir só sem cotações; com cotações, desativar.
- **Cotações** (tabela `cotacoes`, por oportunidade do Kanban + número do item + fornecedor): preço unitário digitado pelo usuário, marca, prazo, validade e frete. Vale a cotação escolhida ou, sem escolha, a mais barata.
- **Cálculo**: margem no estimado = (estimado × (1 − impostos) − custo) ÷ estimado (líquida de impostos, comparável com a margem desejada); preço mínimo = custo ÷ (1 − impostos − margem), com impostos e margem por oportunidade (`cot_impostos_pct`, `cot_margem_pct`). Item sem valor estimado (ou sigiloso) fica "sem referência", nunca comparado com zero.
- **Pedidos de cotação** (`cotacao_pedidos`): gravados só quando o usuário confirma que enviou (WhatsApp/e-mail abertos no aparelho dele); ficam "aguardando" até registrar a resposta daquele fornecedor (vira "respondido") ou marcar "sem retorno". Reenvio ao mesmo fornecedor junta os itens no pedido aberto.
- **Frete** (`cotacao_fretes`, um por fornecedor e oportunidade): CIF ou FOB com transportadora e valor; o valor FOB é rateado pelo valor (preço × qtd) dos itens em que aquele fornecedor é o usado e soma no custo unitário. Cotações antigas usam `cotacoes.frete_incluso` (FOB sem valor = pendente).
- **Tributos** (`web/js/tributos.js`, usado no navegador e no servidor): Simples por alíquota efetiva (LC 123, Anexos I–III), Presumido (presunção × IRPJ/CSLL + PIS/COFINS cumulativo + ICMS/ISS), Real (PIS/COFINS após créditos + ICMS/ISS + IR/CSLL estimado). Guardado em `oportunidades.cot_tributos` e em `clientes.tributos_json` (padrão da empresa).
- **Link do fornecedor** (`services/cotacao-link.js`, tabela `cotacao_links`): um por fornecedor e oportunidade. O banco guarda só um `nonce` aleatório; o link é `/cotar/<nonce>.<HMAC-SHA256(JWT_SECRET)>` (trocar o JWT_SECRET invalida os links). Rotas públicas `/publico/cotacao/:token` (GET/POST, limite por IP, no-store, noindex). Expira no encerramento das propostas (ou 30 dias). A resposta usa `registrarCotacoes` com `origem='fornecedor'` e notifica quem gerou o link e o responsável do card.
- **Sigilo da descrição** (`web/js/sigilo.js`, usado no navegador e no servidor): acha na descrição do item trechos com órgão/ente, convênio/repasse, nº de processo/edital, CNPJ e o nome do órgão/unidade/município da licitação (sem acento). O pedido destaca (negrito no WhatsApp) ou tira; `cotacaoPublica` sempre tira antes de mandar ao fornecedor.
- **Página Cotações** (`#/cotacoes`, `GET /api/cotacoes/pedidos?status=`): `listarPedidos` junta `cotacao_pedidos` de todas as oportunidades da conta (respeita a empresa em foco), com contagem por situação e acesso ao link.
- **Comprovante da cotação** (`services/comprovante-cotacao.js`, `lib/pdf-simples.js`, tabela `cotacao_recebimentos`): cada POST do link grava data/hora, respondente, e-mail e a fotografia do que chegou (descrição já sem trechos da licitação). Depois da resposta o servidor envia o PDF (gerador próprio, Helvetica/WinAnsi, sem dependência) por `enviarEmail` (SMTP_URL), com resposta para quem gerou o link; falha não desfaz a cotação e fica em `comprovante_status`. Rotas `GET /api/kanban/:id/recebimentos/:rid/pdf` e `POST .../reenviar`.
- **Dashboard > Fornecedores** (`GET /api/painel/fornecedores`, `painelFornecedores`): contagem por situação, taxa de resposta (respondidos ÷ resolvidos), tempo médio, top 12 fornecedores, aguardando com dias até a proposta e oportunidades com propostas em 7 dias e itens sem cotação.
- **Impressão/PDF**: página própria gerada no navegador (A4 paisagem) com `window.print()`; o PDF sai pelo "Salvar como PDF" do navegador.
- **Pedido de cotação**: texto montado com os itens marcados, para o usuário copiar ou abrir no WhatsApp (wa.me) ou e-mail (mailto). O sistema não envia nada sozinho.
- Fornecedor sugerido por item quando todas as palavras de uma expressão de "produtos" aparecem na descrição do item.

## Fase 4 (parte 1): preços e contratos
- **Contratos** (`server/connectors/pncpContratos.js`, `server/services/contratos.js`): fonte `pncp_contratos`, PNCP `/v1/contratos` dia a dia por data de publicação (todo o Brasil; o endpoint não filtra UF). Carga inicial dos últimos 30 dias; cada dia concluído avança o cursor. Liga o contrato à licitação por `numeroControlePncpCompra`.
- **Pesquisa de preços** (`server/services/precos.js`): consulta sob demanda ao Compras.gov.br (módulo 03), por PDM/CATMAT ou CATSER, no período escolhido (padrão 12 meses, Lei 14.133 art. 23 §1º II / IN SEGES/ME 65/2021 art. 5º II). Cache de 24h em `precos_consultas`. Estatística por unidade de fornecimento; "fora da curva" pelo critério de Tukey só marca, nunca descarta.
- **Catálogo** (`catalogo_compras` + FTS): PDM de materiais e itens de serviço, baixado pelo agendador se vazio ou com mais de 30 dias.
