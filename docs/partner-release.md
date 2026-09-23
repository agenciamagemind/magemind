# Parceiros — 23/09/2026

## Operação

- CEO/Gerente cadastram o cargo Parceiro em Equipe. O primeiro parceiro ativo recebe padrão de 50% para novas vendas; parceiros seguintes começam fora do padrão, evitando dividir automaticamente mais de 100%.
- Em Parceiros, a administração ajusta os padrões e analisa saques. Cada venda permite alterar percentuais, remover participações e adicionar outros parceiros. Vendas antigas não recebem participações retroativas.
- A indicação continua independente, vinculada ao cliente. Indicação e parceiros somam no máximo 100% da venda, incluindo a conferência do arredondamento em centavos.
- Vendas pendentes geram saldo a receber; fechadas liberam saldo. Gastos não geram participação. Cancelamentos removem créditos, preservando o histórico.
- Pedidos de saque reservam saldo. Aprovação mantém a reserva; registro de pagamento converte a reserva em pago, sem descontar duas vezes. Recusa/cancelamento libera a reserva. Estorno exige motivo. Registrar pagamento não executa Pix: o pagamento bancário deve ser feito antes pela administração.
- Vendas com saldo comprometido não podem ser reduzidas/canceladas sem regularizar o saque correspondente. A carteira mantém trilha de eventos.

## Acesso

- Parceiros recebem apenas suas participações e carteira. Os cadastros de clientes (email, telefone, observações) e as vendas brutas da empresa permanecem bloqueados por RLS/RPC.
- O diretório de demandas apresenta somente dados operacionais mínimos. Textos livres e arquivos que alguém inserir em uma demanda continuam visíveis à equipe que pode acessá-la; o sistema não remove contatos escritos nesses conteúdos.
- Parceiros podem gerenciar demandas e Gestores/Editores, sem administrar CEO, Gerente ou outros parceiros.
- Contas com histórico de indicação não são convertidas em Parceiro: um acesso separado preserva a carteira e os vínculos anteriores.
- Notificações financeiras são individuais; notificações de demandas são restritas às atribuídas ao parceiro. Preferências push continuam sendo respeitadas.

## Validação

- 16 testes Node: regressões existentes, hierarquia, acesso às páginas, divisão entre indicação e múltiplos parceiros, rejeição de excesso e duplicidade.
- SQL com fixtures em transação revertida: privacidade, impedimento de alteração direta da carteira, defaults/histórico/exclusão, demandas CRUD, gestão de subordinados, saldo pendente/disponível, idempotência, reserva, pagamento, estorno e cancelamento. Nenhuma conta de teste persistiu.
- Prévia isolada com dados fictícios: desktop 1440×900, mobile 390×844 e 320×568, modais, pedido/cancelamento de saque e divisão por venda.
- Quatro Edge Functions atualizadas: create-user, delete-user, set-user-active, send-push.
- Advisor de segurança mantém alertas das funções privilegiadas legadas e proteção contra senhas vazadas desativada. As novas RPCs financeiras usam fachadas invoker e implementação privada com checagem de ator. Referências: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable e https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .
- Políticas financeiras usam subconsultas para avaliar o usuário uma vez por consulta. Índices novos ainda sem uso são esperados antes das primeiras transações.
