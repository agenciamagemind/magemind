# Piloto restrito no app oficial — 13/10/2026

O usuário autorizou explicitamente o piloto em app.magemind.com.br, somente para testetrack@gmail.com e admins, e escolheu Meta Ads + Kiwify como primeiras fontes reais. Essa autorização substitui o bloqueio anterior de publicação apenas para este piloto. A liberação para todos continua proibida.

Conta identificada por Auth, confirmada e ativa. A allowlist guarda o UUID obtido do e-mail no momento da migração, sem depender de user_metadata ou de comparação de e-mail no navegador. CEO/Gerente ativos também são autorizados; os demais perfis não. Tracking usa novas tabelas e funções prefixadas, sem alterar registros comerciais ou os grants das funções existentes do APP. RLS e RPCs verificam conta ativa, sessão existente, piloto autorizado e membership da operação.

Novas ferramentas ficam ocultas no Menu, rotas, Soluções, Custos, Notificações e geradores para usuários sem liberação. A verificação do backend retorna zero clientes comuns habilitados. O cliente aprovado vê os campos privados de conexão real. O UI para Google/Hotmart/TikTok fica em preparação nesta etapa.

Meta: conta act_ e token de acesso; leitura verificada no provedor antes de conectar, contas/entidades/hierarquia/estados e gastos importados. Ativação/pausa passa por Edge autenticada, com checagem de conta/entidade/revisão e permissão ads_management do token. Não há alteração automática de orçamento. OAuth de login único Meta depende de app próprio e credenciais, ainda não configurados; o piloto usa conexão por token.

Kiwify: Account ID, Client ID e Client Secret; geração/renovação automática de Bearer token, conferência de leitura da conta, histórico e webhook HTTPS individual. O cliente precisa cadastrar o endereço exibido nos eventos da Kiwify. Cada hint recebido por webhook só vira pedido após consulta autenticada à API da mesma conta. Não se cria compra, saque ou reembolso para testar.

Credenciais cifradas com AES-GCM; chave e segredo do worker ficam em Vault, acessíveis apenas ao serviço. Nenhuma senha do cliente ou token dos provedores foi incluído no código, commit ou logs. A senha fornecida pelo usuário foi usada somente em memória para verificar a própria conta, via entrada sem eco.

Cron dispara o worker a cada minuto, independentemente do navegador. Primeira importação cobre 90 dias; atualizações seguintes revisitam 7 dias, com cursores e backoff. Recebimentos têm fila/idempotência e snapshots financeiros exatos. Realtime atualiza pedidos e gastos; uma sincronização pedida pela interface entra no próximo ciclo do worker.

Geradores trocam para a operação Demonstração. O banco impede integração simulada na operação real e integração real na demonstração. Pedidos de exemplo não entram no faturamento da operação real. Custos e desconexões continuam preservando o histórico.

Verificado: 59 testes Node/PostgreSQL, 81 verificações locais de interface, 9 verificações de backend/interface com Supabase real e 7 verificações adicionais no domínio publicado. Login/allowlist/negação anônima, formulários reais e ocultação sem liberação passaram. Um webhook HTTPS recebeu uma venda de demonstração e o cron processou o pedido automaticamente; a operação real permaneceu sem pedidos de exemplo. Worker online respondeu HTTP 200. A revisão corrigiu a restauração de inert em componentes movidos durante um modal, a reconexão após backoff e a primeira importação de pedidos já reembolsados, preservando aprovação/custo e estorno nas respectivas datas.

Advisors revisados: sem erro de RLS ou exposição de tabelas do Tracking. Os avisos de SECURITY DEFINER restantes correspondem a RPCs intencionalmente autenticadas, com validação de sessão/allowlist/membership. Funções internas de ingestão/processamento/fila foram explicitamente revogadas dos clientes, com EXECUTE exclusivo do serviço confirmado em consulta. O aviso de proteção de senha preexistente não foi alterado.

Limite da homologação: ainda não foram inseridas credenciais reais da Meta/Kiwify nem comparados gastos/pedidos reais contra os painéis desses provedores. Backend online e fluxo de recebimento foram verificados; a conciliação real exige o cliente conectar as duas fontes. Não declarar 100% homologado para liberação geral com base nesses testes.
