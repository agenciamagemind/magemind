# Segurança: firewall e dados pessoais

## Proteções aplicadas

- O firewall mantém uma lista de endereços IP bloqueados no banco. Somente o cargo CEO pode consultar ou alterar essa lista.
- O `secure-auth` recusa o IP bloqueado antes de verificar a senha. O `record-access` também encerra sessões já existentes que passem a usar um IP bloqueado.
- Os registros de segurança guardam o e-mail mascarado (`p***@dominio.com`). Valores históricos que não podiam ser mascarados foram removidos.
- Telefones não são mais duplicados em `auth.users.raw_user_meta_data`; permanecem somente nos registros de negócio protegidos por RLS.
- Senhas continuam sob o Supabase Auth: são armazenadas como hash bcrypt com salt e nunca ficam disponíveis para leitura pelo aplicativo.
- O banco do Supabase mantém criptografia em repouso. A aplicação usa TLS em trânsito e RLS para limitar quais linhas cada sessão pode consultar.
- HTML salvo na descrição das demandas passa por uma lista permitida. Scripts, atributos de evento, iframes, SVG e outros conteúdos executáveis são removidos antes de exibir ou salvar.

## Limite de confiança

A criptografia do próprio banco protege discos, backups e tráfego, mas não pode esconder os dados de quem detém acesso de proprietário ao projeto ou uma chave `service_role`: esse acesso precisa descriptografar dados para o sistema funcionar. A proteção contra um desenvolvedor sem autorização depende de não compartilhar essas credenciais, usar contas individuais com MFA, revisar acessos ao GitHub/Supabase e rotacionar segredos quando alguém sai da equipe. Nenhuma chave privilegiada foi encontrada no repositório.

## Operação do firewall

1. Acesse **Firewall** com uma conta CEO.
2. Use **Bloquear IP** para inserir manualmente um endereço ou use a ação **Bloquear** ao lado de um registro de acesso.
3. Informe um motivo curto para manter a auditoria compreensível.
4. Use **Liberar** na mesma linha caso o endereço tenha sido bloqueado por engano.

Bloquear um IP pode desconectar todas as pessoas que compartilham aquela rede. O motivo e o usuário responsável ficam registrados na tabela protegida `security_blocked_ips`.

## Verificações executadas

- Políticas RLS testadas com papel CEO e papel sem privilégio.
- Bloqueio presente e compilado nos dois pontos de entrada (`secure-auth` e `record-access`).
- Zero telefones restantes no metadado público de autenticação.
- Zero e-mails completos ou valores não mascarados nos logs de segurança.
- Sanitização da descrição testada contra scripts e atributos de evento.
- Interface revisada em 1440×900, 390×844 e 320×568.

Referências: [segurança de senhas do Supabase](https://supabase.com/docs/guides/auth/password-security), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) e [criptografia do banco](https://supabase.com/docs/guides/database/extensions/pgsodium).
