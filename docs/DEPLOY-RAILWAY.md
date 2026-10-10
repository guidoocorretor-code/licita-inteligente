# Publicar no Railway (passo a passo)

Custo: plano Hobby, mínimo de US$ 5/mês em uso (https://railway.com/pricing).
O sistema roda 24h no servidor: o agendador busca o PNCP sozinho, sem depender do seu computador.

## 1. Conta
1. Acesse https://railway.com e clique em **Login** → **Login with GitHub** (use a conta `guidoocorretor-code`).
2. Assine o plano **Hobby** em *Account Settings → Plans*.

## 2. Criar o serviço a partir do GitHub
1. **New Project** → **Deploy from GitHub repo** → escolha `licita-inteligente`.
   Se o repositório não aparecer, clique em *Configure GitHub App* e libere o acesso a ele.
2. O Railway detecta o `Dockerfile` e o `railway.json` sozinho. A primeira publicação pode falhar
   por falta das variáveis do passo 3 — é normal.

## 3. Variáveis (aba **Variables** do serviço)
| Variável | Valor |
|---|---|
| `JWT_SECRET` | um texto aleatório longo (64+ caracteres). Ex.: gere em https://www.random.org/strings/ ou peça ao Claude |
| `ADMIN_EMAIL` | seu e-mail de acesso |
| `ADMIN_SENHA` | senha com 10+ caracteres, letras e números |
| `ADMIN_NOME` | seu nome |
| `EMPRESA_NOME` | nome da empresa |
| `PNCP_UFS` | `ES` (ou `ES,RJ,MG,BA`) — limita a primeira carga às UFs escolhidas |
| `HTTP_USER_AGENT` | `LicitaInteligente/0.2 (contato: seu-email)` |

O administrador só é criado na primeira inicialização. Depois disso, troque a senha em
*Configurações* no sistema e **apague `ADMIN_SENHA`** das variáveis.

## 4. Volume (onde o banco de dados fica guardado)
1. No projeto, clique com o botão direito no fundo da tela (ou `Ctrl+K`) → **New Volume**.
2. Escolha o serviço `licita-inteligente` e informe o caminho de montagem: **`/app/storage`**.
Sem o volume, os dados se perdem a cada nova publicação.

## 5. Endereço público
Serviço → **Settings → Networking → Generate Domain**. O Railway cria um endereço
`https://...up.railway.app`. Abra, entre com o e-mail e a senha do passo 3.

## 6. Conferir
- *Fontes de dados*: em alguns minutos o PNCP deve mostrar "Última sincronização OK" e registros importados.
- Aba **Deployments → View logs** no Railway: mostra linhas `[agendador] pncp: ...` a cada sincronização.
- Atualizações de código entram no ar sozinhas a cada mudança aprovada no GitHub (branch `main`).

## 7. Alertas por e-mail (Fase 3)
Os alertas aparecem sempre dentro do sistema. Para recebê-los também por e-mail:
1. Na conta Google que vai enviar (ex.: `guidolicitacoes@gmail.com`), ative a **verificação em duas etapas**.
2. Crie uma **senha de app** em https://myaccount.google.com/apppasswords (o Google mostra 16 letras; copie sem os espaços).
   Ajuda oficial: https://support.google.com/accounts/answer/185833
3. No Railway, em **Variables**, crie:
   - `SMTP_URL` = `smtps://guidolicitacoes%40gmail.com:SENHA_DE_APP@smtp.gmail.com:465` (o `@` do e-mail vira `%40`)
   - `APP_URL` = o endereço público do sistema (ex.: `https://licita-inteligente-production.up.railway.app`)
4. Depois do deploy, em *Configurações → Alertas por e-mail*, informe o e-mail que recebe os alertas e clique em **Enviar e-mail de teste**.

A senha de app fica só nas variáveis do Railway: nunca no código, no log ou na tela. Para revogar, apague-a na conta Google.
