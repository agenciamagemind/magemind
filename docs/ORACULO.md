# Oráculo no aplicativo Magemind

Publicado em 09/11/2026. A seção `oraculo` fica no grupo Trabalho, depois de Documentos, exclusivamente para `ceo` e `manager`. Outros cargos mantêm as páginas anteriores. O ícone `oracle-icon.png` é a imagem fornecida pelo responsável, usada como máscara de luminância.

O app carrega sob demanda `/embedded` no Worker existente `oraculo-magemind.oraculo-magemind.workers.dev`. A interface incorporada reutiliza `public/app.js` do Oráculo, com tema isolado, navegação interna por abas e adaptação para teclado móvel e paisagem. Não há cópia de conversas, nova instância do agente ou novo número de WhatsApp.

## Autenticação e persistência

- O app responde a pedidos de sessão somente do iframe esperado e da origem exata do Worker. O token fica em memória, não em URL, armazenamento do iframe ou arquivos públicos.
- Cada chamada a `/app-api/*` verifica o usuário no Supabase Auth e a função `get_oraculo_access`. O servidor exige perfil CEO/gerente ativo, não arquivado e sessão presente em `auth.sessions`, ainda vigente. Alterações exigem mesma origem e cabeçalho administrativo. Cookies do painel antigo não substituem essa verificação.
- O helper privilegiado fica no schema não exposto `oraculo_internal`; o RPC público é `SECURITY INVOKER`. Nenhuma política ou permissão dos outros módulos foi alterada.
- O Worker encaminha o acesso ao mesmo Durable Object `ORACULO.getByName('magemind')`, com o banco e alarmes existentes. Webhook, credenciais, agente e transporte Meta são preservados. O painel independente continua disponível com sua autenticação anterior.
- Sair da conta remove o iframe e seus dados de memória. Navegar para outra seção suspende as consultas periódicas do painel; retornar mantém a conversa e os rascunhos.

## Manutenção

Frontend: `oraculo.js`, `oraculo.css`, `oracle-icon.png` e os pontos de integração em `index.html`, `product-ui.js` e `service-worker.js`.

Backend do Oráculo: `cloud/app-auth.mjs`, `cloud/embedded.mjs`, `cloud/worker.mjs`, `public/app-bridge.js`, `public/app-theme.css`, `public/app.js`, `public/oracle-icon.png` e as duas variáveis públicas Magemind do Wrangler. Credenciais Meta/OpenAI/administrativas continuam como Secrets privados, sem passar pelo app.

Aplicar somente a migration `oraculo_app_access`. Não executar migrations antigas em lote nem repetir migração/restauração do banco do Oráculo.

Validação: 22 testes do app, 61 testes do Oráculo, 13 verificações SQL isoladas e 145 verificações no navegador com dados fictícios. Tamanhos: 1440, 1024, 768, 430, 390, 360, 320 e paisagem 844 × 390. Autorização real conferida com CEO, gerente, cliente e revogação das sessões temporárias. A suíte usa transporte simulado e não envia mensagens ao WhatsApp real.

O backup privado de publicação fica fora do repositório, em `%LOCALAPPDATA%/Magemind/OraculoBackups`, com ACL restrita. Relatórios e capturas fictícias da revisão ficam no workspace `oraculo-integration-review`.

## Reversão

Antes desta integração: frontend `78312bfe54ee2cbc163553b4ca2455dfb38fc73b`; Worker `89e209c3-a819-442e-a5ad-4379d4b55394`. Reverter código não exige restaurar ou substituir o banco. O gate Supabase pode permanecer sem afetar as páginas anteriores. Não alterar webhook, vínculo do Durable Object ou Secrets para reverter apenas a interface.
