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
