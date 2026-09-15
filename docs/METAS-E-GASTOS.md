# Metas e gastos — 15/09/2026

## Comportamento

- Metas disponíveis somente a CEO e Gerente, com regras de acesso no PostgreSQL e na navegação.
- Tipos: faturamento automático, quantidade de vendas fechadas (todos os planos ou um plano) e objetivo livre com unidade e progresso manual.
- Período explícito e inclusivo; atalhos diária, semana de segunda a domingo e mês corrente preenchem as datas. Não criam recorrências automáticas.
- Metas automáticas usam `goal_progress`, view com `security_invoker=true`, agregando todo o histórico permitido. Vendas pendentes, canceladas, gastos e datas posteriores a hoje não entram. Datas civis seguem America/Sao_Paulo.
- Cada lançamento fechado conta uma venda; o vínculo usa o ID do plano, preservado quando o nome muda.
- Alterações nas vendas e metas acionam recarga por Realtime. A aba de metas também atualiza ao recuperar foco e a cada minuto enquanto visível.
- Progresso manual aceita total realizado, inclusive acima da meta. Arquivamento preserva o registro; restauração disponível no filtro Arquivadas.
- Edição de metas usa `updated_at` para impedir sobrescrever silenciosamente uma alteração concorrente.
- Gastos são lançamentos em `sales` com status `Gasto`, sem cliente/plano/demanda. Não geram comissão nem aviso de venda ao cliente.
- Indicadores: receita fechada, gastos, lucro líquido (receita menos gastos), negociação e ticket médio. Cálculos monetários no frontend em centavos.
- Atalhos de vendas: Hoje, Ontem, 7 dias, 14 dias, Este mês e Todo o período (até hoje). O período personalizado inclui as duas datas selecionadas e permite consulta de lançamentos futuros quando solicitado.
- Olho abre uma prévia separada, somente leitura, com descrição, referências e comentários da demanda. Editar demanda abre o editor existente sem navegar para outra seção.

## Arquivos

- `goals.js`: interface, formulários, CRUD e prévia de demanda.
- `goals.css`: cartões, indicadores financeiros e adaptação mobile.
- `app-core.js`: datas, filtros, totais e funções puras de progresso usadas nos testes.
- `index.html`: navegação, integração e listagem de vendas.
- `supabase/migrations/20260915024624_goals_and_expenses.sql`: tabelas, view, RLS e status de gastos.

## Verificação

- 12 testes Node aprovados: datas, centavos, lucro negativo, filtros, tipos de metas, cancelamento, vínculo de demanda e preferências push.
- UI com dados fictícios em 1440×900, 390×844 e 320×568: criar meta, atualizar progresso, arquivar/restaurar, registrar gasto, validar intervalo, abrir prévia e iniciar edição. Sem erros JavaScript no navegador.
- No banco real, testes em transações revertidas confirmaram: soma e contagem de vendas fechadas, regressão após cancelamento, exclusão de venda futura e plano diferente, e progresso manual.
- RLS testada com cargos ativos existentes: CEO/Gerente autorizados; Cliente/Afiliado bloqueados. Gestor/Editor não tinham contas ativas nesta verificação; ambos são excluídos explicitamente das políticas e das listas de navegação.
- Nenhum registro de teste permaneceu em metas, vendas ou planos.
- Auditor consultado: novos objetos não apresentaram alertas. Permanecem avisos sobre RPCs privilegiadas preexistentes e proteção de senhas vazadas, fora desta alteração. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Referências de organização

- https://support.pipedrive.com/en/article/insights-goals
- https://knowledge.hubspot.com/goals/understand-goals
