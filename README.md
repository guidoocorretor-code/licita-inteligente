# Licita Inteligente

Sistema web para pesquisar, centralizar, monitorar e gerenciar licitações públicas a partir de fontes oficiais
(PNCP e Compras.gov.br). Versão **0.2 — Fases 1 e 2**.

- Documentação técnica: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- Manual de uso: [`docs/MANUAL.md`](docs/MANUAL.md)
- Relatório da entrega: [`docs/RELATORIO-FASES-1-2.md`](docs/RELATORIO-FASES-1-2.md)

## Requisitos
- Node.js **22.13 ou superior** (usa o SQLite embutido do Node, sem instalar banco separado).
- Acesso de rede a `pncp.gov.br` e `dadosabertos.compras.gov.br`.

## Executar localmente
```bash
npm install
cp .env.example .env            # preencha JWT_SECRET
npm run create-admin -- "Minha Empresa" "Seu Nome" voce@empresa.com.br "SenhaForte2026"
npm start                       # http://localhost:3000
```
Depois de entrar: **Fontes de dados → PNCP → Configurar** (ex.: UF = ES) → **Carregar abertas**.

## Testes
```bash
npm test                    # 31 testes de regras de negócio, API, segurança e sincronização (sem rede)
npm run test:integration    # testes REAIS contra PNCP e Compras.gov.br (precisa de internet)
```

## Publicar (exemplo com Docker)
```bash
docker build -t licita-inteligente .
docker run -d -p 3000:3000 --env-file .env -v licita_dados:/app/storage licita-inteligente
docker exec -it <container> node --disable-warning=ExperimentalWarning scripts/create-admin.js "Empresa" "Nome" email senha
```
Serviços como Render, Railway ou Fly.io aceitam este Dockerfile. Use **um volume persistente** para `/app/storage`
(banco SQLite) e HTTPS obrigatório. Backup: copie `storage/licita.db` diariamente (ver `docs/ARQUITETURA.md`).

## Trocar nome e identidade visual
- Nome: variável `APP_NAME` e `web/manifest.webmanifest`.
- Cores: variáveis CSS no topo de `web/css/app.css` (`--cor-primaria`, `--cor-destaque`).
- Ícone: `web/icons/`.

## Publicação no Railway
Passo a passo em [docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md). Variáveis de configuração inicial: `ADMIN_EMAIL`, `ADMIN_SENHA`, `ADMIN_NOME`, `EMPRESA_NOME` e `PNCP_UFS` (usadas só em banco novo).
