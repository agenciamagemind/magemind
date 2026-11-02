# Soluções e capacidade de produção

## Configuração

O cadastro unificado contém Pacote avulso, Plano mensal, Plano personalizado e Outro serviço. Planos personalizados têm formato mensal, avulso ou serviço e permanecem privados para os clientes vinculados.

Planos mensais definem entrega diária ou semanal, quantidade por período e dias da semana permitidos. O catálogo apresenta a quantidade e os dias diretamente desses campos, sem depender de números escritos na descrição comercial. Os planos existentes foram migrados com entregas de segunda a sexta; a equipe pode incluir sábados e domingos no editor.

## Regras de agendamento

- Cada demanda reserva **um criativo**, pela data de entrega.
- Novas demandas começam na primeira data com vaga, a partir do dia seguinte em São Paulo. O servidor calcula essa data considerando todos os planos ativos e suas reservas; um dia ou semana cheio é pulado automaticamente.
- O calendário recebe os limites mínimo/máximo e a disponibilidade de cada dia em uma única consulta por mês. Dias lotados, dias fora do plano e datas anteriores ao prazo mínimo aparecem apagados. Clientes não podem selecioná-los; CEO, gerente, sócio, gestor e editor podem selecionar essas datas. Editores alteram somente as datas dos cards atribuídos a eles, além das permissões anteriores de status e ordem. O reagendamento da equipe preserva a reserva e a compra originais, inclusive após o vencimento; criar novos cards ainda exige compra ativa e unidades totais disponíveis no pacote ou ciclo semanal. A reserva final continua sendo validada na transação de gravação.
- Clientes não podem agendar para hoje ou para datas passadas, nem enviando uma gravação diretamente pela API. Cards históricos não têm sua data alterada pela atualização. A equipe mantém a possibilidade de corrigir metadados históricos.
- Diário: quantidade máxima por data de entrega permitida. Dias sem uso não acumulam saldo em outros dias.
- Semanal: quantidade máxima de segunda a domingo e teto de quatro vezes essa quantidade no ciclo contratado. Por exemplo, 3/semana permite no máximo 12 no mês, mesmo em meses com cinco semanas. A semana que atravessa a virada do mês continua sendo uma única semana.
- A compra confirmada libera agendamentos imediatamente. O mês dos planos diários e semanais é contado pela **data original de entrega do primeiro criativo concluído dessa compra**, registrada no histórico de consumo, e inclui o aniversário no mês seguinte até o fim desse dia, em São Paulo. Ex.: compra em 19/10, primeira entrega em 20/10 → última entrega permitida em 20/11. A marcação de conclusão no dia seguinte não troca a data de entrega do card. Antes da primeira conclusão, o calendário usa uma janela provisória de um mês da compra; a primeira entrega fixa a janela definitiva. Concluir antecipadamente um card com data futura não posterga o início além de hoje. Reabrir, excluir, reagendar ou editar esse card não reinicia o mês. Cada nova compra mantém sua própria data inicial. Meses menores usam seu último dia: 31/01/2028 → 29/02/2028; 31/01/2027 → 28/02/2027. Novas reservas posteriores ao aniversário exigem outra contratação. Não há soma fixa de 30 dias nem cron. O teto semanal de quatro vezes a quantidade vale por ciclo contratado e não reinicia na virada do mês do calendário.
- Pacote avulso: quantidade total por compra, sem renovação automática. A entrega pode ir até o aniversário de um mês da criação original da demanda, inclusive. Editar ou reagendar não prorroga essa janela; o servidor define e protege a data de criação.
- Havendo mais de um plano, o servidor reserva primeiro no diário, depois no semanal e depois no pacote, considerando a disponibilidade de cada um.
- Demandas em aberto já reservam espaço; sua exclusão libera essa reserva. A conclusão consome o serviço e excluir ou reabrir o card não devolve um criativo já entregue.
- Alterar a data de uma demanda em aberto transfere a reserva após validar a nova data. Entregas concluídas mantêm o consumo original; a equipe pode corrigir os dados do card sem reabrir saldo.
- Demandas vinculadas a clientes exigem compra confirmada e saldo, inclusive quando criadas pela equipe. Demandas internas da equipe sem cliente não usam saldo. Um vínculo no cadastro de planos, isoladamente, nunca libera produção.
- Cada venda `Fechado`, com valor positivo, cliente e plano de produção, gera uma contratação independente. `Pendente`, `Cancelado`, exclusão da venda, cliente pausado/inativo e vencimento não liberam novas reservas. Reativar a mesma venda preserva seu saldo e sua vigência; renovar ou recomprar requer uma nova venda confirmada.
- Quantidade, cadência e dias da semana são fotografados na compra: alterações no catálogo ou nos vínculos do cliente não mudam compras anteriores. Uma venda que já liberou produção não permite trocar cliente, plano ou data; para corrigir esses campos é necessário cancelar e registrar a venda correta.

## Segurança e compatibilidade

Os campos canônicos são `plans.delivery_cadence`, `delivery_quantity` e `delivery_weekdays` (ISO: segunda = 1, domingo = 7). A coluna comercial legada `qty` é preservada na migração. O plano privado cujo nome diz “1 CRIATIVO / SEMANA” e cujo `qty` antigo era 4 foi interpretado corretamente como 1 por semana, sem reescrever seu cadastro comercial.

As contratações ficam em `private.production_entitlements` e as reservas em `private.production_demand_slots`, sem acesso direto de clientes. O acesso no frontend vem do servidor, não do catálogo. Respostas inválidas ou falhas de consulta bloqueiam a gravação. O trigger de demandas reserva a unidade na mesma transação da gravação e bloqueia a linha do cliente para serializar criações concorrentes. Gravações diretas pela API também passam por essa validação. As políticas de acesso às demandas e de escolha de responsável permanecem em vigor.

O RPC `get_demand_capacity` informa apenas os planos e o uso do cliente autorizado; não retorna contatos, preços nem dados de outros clientes. O contexto de produção mantém a filtragem anterior por cargo. O catálogo vinculado continua disponível como informação administrativa; a liberação de demandas depende exclusivamente das compras. A migração não altera títulos, datas, responsáveis, comentários ou ordenação dos cards existentes.

O RPC `get_demand_calendar` usa as mesmas verificações de sessão e escopo e retorna apenas datas disponíveis, a data mínima e a primeira vaga. O formulário não exibe nomes de planos nem contadores abaixo da data. No detalhe, o cliente vê o nome e avatar da pessoa responsável, sem poder alterar a atribuição; seu próprio nome não é repetido no painel lateral.

## Histórico e confirmação de compra

A migração `purchase_demand_entitlements` preserva os cards existentes e associa reservas antigas a compras confirmadas. No modelo antigo, uma demanda concluída podia representar o pacote inteiro: vendas de pacote explicitamente ligadas a esses cards são mantidas como integralmente consumidas, sem devolver créditos. Compras sem evidência de entrega mantêm seu saldo; a situação cadastral do cliente continua sendo exigida.

No fluxo comercial atual, `Fechado` é a confirmação de compra registrada pela administração. Links externos de contratação/WhatsApp não são comprovantes de pagamento; nenhum webhook de pagamento de serviços está implementado neste fluxo. Integrações de vendas do Tracking são dados analíticos de terceiros e não concedem pacotes da Magemind.

## Verificação

- `node --test tests/solution-capacity.test.mjs tests/demand-workspace.test.mjs tests/client-demand-intake.test.mjs tests/demand-placement.test.mjs`
- `node --test tests/demand-calendar.test.mjs tests/purchase-entitlements.test.mjs`
- `node --test tests/*.test.mjs`
- Os testes de banco usam PostgreSQL via PGlite, com RLS, triggers e transações reais. As solicitações concorrentes no harness são serializadas pelo PGlite; a proteção em PostgreSQL com múltiplas conexões depende do bloqueio de cliente, compartilhado por reservas e cancelamentos.
- `node scripts/solution-scheduling-qa.mjs` (1440, 375 e 320 px; dados isolados)
- `node scripts/first-delivery-rescheduling-qa.mjs` (CEO e cliente; 1440, 390 e 320 px; retorno de dezembro para os dias 19/11 e 20/11)
- `node scripts/creative-deliveries-qa.mjs`
- `node scripts/demand-detail-layout-qa.mjs`

Publicar o frontend somente com `node scripts/tracking-pilot-build.mjs --frontend`, depois de aplicar a migração `purchase_demand_entitlements`. Os testes de escrita usam exclusivamente a base local isolada e fixtures de navegador.

## Reagendamentos excepcionais autorizados

Desde 02/11/2026, autorizações pontuais podem permitir reagendar um card existente para uma data exata após a vigência. Elas ficam em `private.production_schedule_exceptions`, não prorrogam o plano e não permitem que o cliente crie novos cards fora da vigência. Quantidade e dias da semana continuam validados. Ao corrigir um card para uma data regular, sua autorização excepcional é removida; ela não pode ser reutilizada para voltar à data antiga fora da vigência.

O RPC `get_demand_schedule_alerts` fornece os alertas somente à equipe operacional; editores recebem apenas os cards atribuídos a eles. Clientes e participantes recebem lista vazia. No Kanban, a equipe vê borda/fundo vermelhos e o rótulo “Fora da vigência”; o cliente mantém a apresentação normal. O encerramento da sessão limpa os alertas em cache.

A rotina de manutenção do banco confere o snapshot de cada demanda e reagenda o lote em uma transação, preservando todos os campos públicos além de `due_date`, incluindo ordem e timestamps. Não há notificações nessa rotina. Qualquer falha desfaz todo o lote.
