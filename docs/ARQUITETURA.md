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
- E-mail e WhatsApp de alertas não implementados (dependem de SMTP/provedor).
- Módulos das Fases 3 a 6 aparecem no menu marcados com a fase e não exibem dados simulados.
