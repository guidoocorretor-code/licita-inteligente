# Manual de uso — Licita Inteligente

## 1. Entrar
Acesse o endereço do sistema, informe e-mail e senha. Após 5 senhas erradas a conta fica bloqueada por 15 minutos.
No celular, use "Adicionar à tela inicial" para instalar como aplicativo.

## 2. Primeira configuração (administrador)
1. **Fontes de dados → PNCP → Configurar**: escolha as UFs que interessam (ex.: `ES,RJ,MG`; vazio = Brasil todo)
   e as modalidades (6 = Pregão eletrônico, 8 = Dispensa, 4 = Concorrência eletrônica…).
2. Clique **Testar** (verifica a conexão real) e depois **Carregar abertas** (traz as licitações com propostas em aberto).
3. Deixe **Habilitada** marcada: o sistema passa a buscar novidades e alterações sozinho na frequência configurada.
4. Se o servidor não alcançar o PNCP, use **Importar arquivo JSON oficial** (instruções na própria tela).
5. **Configurações → Usuários**: crie as contas da equipe com o papel adequado.

## 3. Buscar licitações
- Abas: **Abertas**, **Em disputa**, **Encerradas**, **Desertas ou fracassadas** e **Outras**.
- Combine filtros: palavras-chave, palavras obrigatórias, palavras a excluir, UF, município, órgão, valor, datas,
  prazo restante, ME/EPP, SRP etc. A busca ignora acentos.
- **Salvar pesquisa**: guarda os filtros; marque alerta para ser avisado quando surgirem novas compatíveis.
- **CSV / Excel**: exporta o resultado filtrado (até 10 mil linhas).
- ☆ favorita; **PNCP ↗** e **Edital ↗** abrem a página oficial.

## 4. Entender o status
| Status | Significado |
|---|---|
| Aguardando propostas | O prazo de envio ainda não começou |
| Aberta | Recebendo propostas |
| Prazo encerrado (aguardando resultado) | Prazo acabou; a fonte ainda não publicou resultado |
| Em disputa/julgamento | Prazo acabou e os itens seguem "em andamento" na fonte |
| Resultado parcial | Parte dos itens já tem resultado |
| Encerrada (homologada) | Itens finalizados com ao menos um homologado |
| Deserta / Fracassada | **Somente** quando a fonte oficial informa os itens como deserto/fracassado |
| Suspensa / Revogada / Anulada | Situação oficial informada pela fonte |

A **etapa interna** (Kanban) é separada da situação oficial.

## 5. Detalhe da licitação
Mostra todos os campos, itens, documentos, origem dos dados e histórico. "Não informado" significa que a fonte não enviou
o dado; "zero informado pela fonte" significa que a fonte enviou 0; "Sigiloso" indica orçamento sigiloso.
Use **Atualizar itens e documentos** para consultar a fonte na hora.

## 6. Jornal de licitações
Feed com novas publicações, alterações (prazo, valor, objeto), novos documentos, mudanças de situação e resultados,
na ordem em que o sistema detectou.

## 7. Kanban
No detalhe, clique **+ Acompanhar no Kanban**. Arraste os cartões entre etapas (no celular, use o seletor "Mover").
Clique no cartão para definir responsável, prazo interno e comentários. Todo movimento fica no histórico.

## 7.1 Fornecedores e cotações
1. Em **Fornecedores**, cadastre de quem a empresa compra (o CNPJ preenche os dados da Receita) e escreva os produtos e marcas que ele vende, separados por ";".
2. No Kanban, abra o card e clique em **💲 Cotações** (ou no botão de mesmo nome na licitação).
3. **✉ Pedir cotação** monta a mensagem com a descrição completa de cada item, para copiar, abrir no WhatsApp ou **Enviar por e-mail** (abre o programa de e-mail padrão, como o Outlook, já com o e-mail do fornecedor). O sistema não envia nada sozinho: depois ele pergunta se você enviou e, se sim, a cotação mostra **Aguardando retorno do fornecedor** até você registrar a resposta ou marcar "Sem retorno".
   - **Trechos que entregam a licitação:** a descrição vem do edital e às vezes cita órgão, cidade, convênio, nº de processo ou CNPJ. O "Pedir cotação" mostra esses trechos num aviso amarelo e, no WhatsApp, eles vão em **negrito** para você achar e apagar. Marcando **Tirar esses trechos da mensagem**, eles saem do texto. Na página do link o fornecedor nunca vê esses trechos. A detecção é por padrões: revise a mensagem antes de enviar.
   - **Comprovante para o fornecedor:** ao enviar pelo link, o fornecedor informa um e-mail (vem preenchido com o do cadastro) e recebe "Recebemos sua cotação" com o comprovante em PDF (protocolo, data e hora de Brasília, itens, preços e condições; sem dados da licitação). Precisa do e-mail do sistema configurado (SMTP_URL). Na cotação, o bloco **Recebidas pelo link** mostra a data e a hora de cada envio, quem respondeu, a situação do comprovante, o botão **📄 Comprovante** (PDF) e **Reenviar**.
   - **Menu Cotações** (abaixo de Fornecedores): todos os pedidos de todas as oportunidades, com abas Aguardando retorno, Sem retorno, Respondidos e Todos. Os que aguardam vêm primeiro, pelo prazo das propostas mais próximo, com dias sem resposta, se o fornecedor abriu o link e botões para abrir a cotação, cobrar no WhatsApp ou por e-mail (lembrete sem dados da licitação) e marcar "Sem retorno".
   - **🖨 Imprimir / PDF** gera o mapa de cotações (empresa, licitação, itens, fornecedor, prazo de entrega, comparativo e condições). Para PDF, escolha "Salvar como PDF" na impressão.
   - A **margem no estimado** já desconta os impostos informados, para comparar direto com a margem desejada.
   - **Frete:** na resposta do fornecedor, escolha CIF (entrega inclusa) ou FOB. No FOB, informe a transportadora e o valor total: ele é dividido entre os itens daquele fornecedor pelo valor de cada item e entra no custo. FOB sem valor fica marcado como pendente.
   - **Sigilo da licitação:** o pedido de cotação e o link levam só a descrição dos itens e a quantidade — sem órgão, número, cidade, objeto ou datas — para o fornecedor não descobrir a disputa. Atenção: a descrição copiada do edital às vezes cita o município; revise antes de enviar.
   - **Link para o fornecedor responder:** com a opção marcada no "Pedir cotação", a mensagem leva um link. O fornecedor abre no celular ou no computador, sem login, vê só os itens pedidos (nunca o valor estimado do órgão), preenche preço, marca, prazo, frete e pagamento, e a resposta entra direto na cotação com a etiqueta "pelo link". Você recebe aviso no 🔔. O link é o mesmo nos reenvios e expira quando encerram as propostas.
   - **Regime tributário:** em "Como calcular o preço mínimo", escolha Simples (anexo + receita dos últimos 12 meses), Lucro Presumido (+ ICMS/ISS) ou Lucro Real. O sistema calcula a alíquota e guarda o regime na empresa para as próximas cotações. É estimativa: confirme com o contador.
4. Quando o fornecedor responder, use **+ Registrar resposta** e digite o preço unitário de cada item cotado.
5. Informe impostos e margem desejada: a tela mostra custo, margem sobre o valor estimado, preço mínimo por item e os itens que ficam acima do estimado.

## 8. Alertas
O sino mostra notificações não lidas. Em **Alertas** você liga/desliga o alerta de cada pesquisa salva.
E-mail e WhatsApp ainda dependem de configuração de provedor.

## 9. Papéis
- **Leitor**: consulta, favoritos e pesquisas próprias.
- **Analista**: + Kanban e atualização de licitações.
- **Gestor**: + remover oportunidades do Kanban.
- **Admin**: + usuários, fontes, sincronização e auditoria.

## 10. Avisos importantes
- O sistema organiza informação pública; **não garante** habilitação, vitória ou conformidade jurídica.
- Sempre confira o edital oficial antes de decidir.

## Dashboard > Fornecedores

Aba ao lado de "Empresas": pedidos aguardando retorno, prazo apertado (propostas em até 3 dias), taxa e tempo médio de resposta, gráfico da situação dos pedidos, barras por fornecedor (respondidos, aguardando, sem retorno), lista de cotações aguardando pelo prazo da proposta com **Cobrar no WhatsApp** (lembrete sem dados da licitação) e oportunidades com propostas nos próximos 7 dias que ainda têm itens sem cotação.

## Menu

Seções destacadas: **Cadastro** (Empresa), **Oportunidades** (Dashboard, buscas, Kanban, alertas), **Gestão**, **Inteligência** e **Administração**.
