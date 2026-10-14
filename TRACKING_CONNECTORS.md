# Integrações de tracking

O piloto usa o painel original e permanece restrito a `ogabrielmrossi@gmail.com` (acompanhamento administrativo) e `gabrielmelo@gmail.com` (operação de cliente). Cada cliente possui uma única operação. A liberação geral depende de autorização posterior.

## Meta Ads

- Login oficial para empresas, autorização por código, estado descartável vinculado à sessão e seleção das contas autorizadas pelo provedor.
- Aplicativo Magemind: `2617276485382421`; configuração: `28771457415873111`.
- Retorno exato: `https://tsawxmlfvnvepzgcztfc.supabase.co/functions/v1/tracking-api?callback=meta`.
- Segredo do aplicativo e tokens de acesso são cifrados no backend privado. Não colocar valores em código, commits, logs, URLs ou documentação.
- O cliente seleciona as contas; o servidor consulta novamente a lista autorizada antes de instalar a conexão. Uma concessão expira em 30 minutos e só pode ser usada uma vez.
- O agendador roda a cada minuto; os anúncios são atualizados a cada dez minutos, com consulta inicial dos últimos 90 dias. Cada importação substitui o retrato diário, evitando somar o mesmo gasto novamente.
- Gerentes/CEO com acesso ao tracking consultam os clientes, sem autorização para operar anúncios. Apenas o master configura o aplicativo Meta.
- O app Meta continua em desenvolvimento. Usuários sem função nesse aplicativo dependem dos requisitos e da análise de permissões da Meta antes de uma liberação externa.

## Checkouts

| Plataforma | Configuração | Autenticação do recebimento |
| --- | --- | --- |
| Kiwify | Nome e URL em Apps → Webhooks | URL privada com token aleatório |
| Hotmart | Nome e Hottok; eventos versão 2.0.0 | URL privada e `X-HOTMART-HOTTOK` |
| PerfectPay | Nome e token do webhook | URL privada e token no corpo |
| Cartpanda | Nome e eventos de pedidos JSON da loja | URL privada com token aleatório |

O cadastro gera a URL; é necessário cadastrá-la no checkout. Webhooks recebem eventos futuros e os reenvios disponibilizados pela plataforma. O cadastro por webhook não promete importar vendas antigas automaticamente.

Na Cartpanda, o conector de loja recebe o bruto. O cliente deve cadastrar as taxas em Custos; o resultado é identificado como estimativa. Os itens mantêm as quantidades e o total do pedido é distribuído exatamente entre as linhas. Postbacks S2S de afiliados exigem outro contrato e não usam esta URL.

Eventos financeiros incompletos e reembolsos parciais sem valor cumulativo confiável são recusados para evitar corromper o saldo. Eventos não financeiros são ignorados. Nenhum dado de cartão recebido é persistido nos pedidos normalizados.

O recebimento autentica a conexão, normaliza os valores, registra um recibo durável e tenta processá-lo imediatamente. O agendador retenta os recibos pendentes. Reenvios não duplicam a receita. Desconectar revoga a credencial e mantém pedidos, compradores, custos registrados e totais históricos. Reconectar uma plataforma reutiliza sua identidade canônica.

## Origem das vendas

O lucro total usa pedidos, custos e gasto dos anúncios. UTMs devolvidas pelo checkout permitem associar vendas aos anúncios; sem elas, pedidos continuam no total e podem ficar sem atribuição. O script próprio é necessário para as visitas e etapas do funil e depende de consentimento e de domínio cadastrado. O coletor nunca aceita eventos financeiros.

## Validação

- 70 testes de contratos, finanças, banco e segurança passaram, incluindo aprovação Kiwify com data inconsistente, atualização de pendente para pago e reenvio sem duplicação da receita. A suíte do piloto cobre notificações por status, preferências, privacidade entre contas, inscrições de push já existentes, histórico silencioso e reenvios.
- 32 verificações de interface do cliente e 60 administrativas passaram sobre os arquivos publicados, com dados de QA isolados.
- Login Meta real, autorização, troca do token e listagem das contas foram verificados no navegador.
- A conta Meta escolhida pelo usuário, Magemind #1, importou 789 registros diários e 366 entidades. O período de 08/10/2026 a 14/10/2026 apresentou R$ 1.757,01 de investimento, conferido entre painel e banco.
- O webhook Magemind foi cadastrado na Kiwify para todos os produtos em que o usuário é produtor, com sete eventos: boleto, Pix, aprovação, recusa, reembolso, chargeback e renovação. A URL definitiva não usa o parâmetro de verificação.
- A entrega de verificação da Kiwify chegou ao servidor sem criar recibos ou pedidos. O recurso “Testar Webhook” do provedor envia aprovação no dia seguinte, com criação e atualização no momento do envio. O conector usa o primeiro recebimento persistido quando a aprovação é anterior à criação ou ultrapassa o recebimento em mais de cinco minutos; preserva as datas originais em `money_components.provider_approved_at` e `provider_updated_at`, com `timestamp_source=received_at_invalid_approval`. Datas válidas mantêm a aprovação original; criação ou atualização futura continuam recusadas. Reenvios usam o mesmo relógio persistido e a mesma identidade de evento. Datas sem offset da Kiwify são interpretadas em UTC, conforme observado na entrega do próprio provedor, e exibidas no fuso da operação.
- As amostras recebidas do “Testar Webhook” não contêm identificador de teste. A URL definitiva as processa como pedidos normais, inclusive nos totais quando aprovados; não é seguro classificá-las pelo nome do comprador, produto ou inconsistência de data. A URL de verificação (`verification=1`) continua verificando a entrega sem registrar pedidos.
- Os quatro parsers de webhook foram testados com exemplos dos contratos. Receber uma compra real de cada checkout continua sendo uma validação externa separada.

Descritores dos conectores: `tracking/connectors.mjs`. Parsers: `tracking/webhooks.mjs`. Catálogo do navegador: `scripts/tracking-connector-catalog.mjs --write`. Nova plataforma só deve ser habilitada após implementar sua autenticação, contrato de valores/status e testes.

## Notificações de pedidos

Pedidos pendentes, aprovados, recusados, cancelados, renovações, reembolsos, chargebacks e disputas têm categorias próprias. As preferências começam ativas; o cliente pode desativá-las individualmente em Configurações → Notificações. A central consulta os avisos do próprio usuário a cada cinco segundos e apresenta um aviso breve para novas entradas. Reenvios e eventos sem mudança de status não geram notificações repetidas; conciliação histórica permanece silenciosa.

Os avisos no aparelho usam as inscrições `public.push_subscriptions`, as preferências gerais de notificações do aplicativo e as chaves VAPID existentes. Não exigem uma segunda inscrição separada de tracking. O processador entrega os avisos antes de sincronizar anúncios, com retentativa em caso de falha. O recebimento por Apple/Google/Mozilla confirma aceitação pelo serviço; a exibição final depende do aparelho, permissão de notificações e configurações do sistema operacional. A central permanece disponível mesmo quando o push falha. O clique em um aviso abre o pedido correspondente após validar o acesso à operação.
