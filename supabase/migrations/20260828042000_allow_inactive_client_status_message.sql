-- Inactive clients remain blocked by profiles.active and RLS. Clear legacy
-- Auth bans so the app can identify the account, show the status-specific
-- support message and immediately sign the session out.

update auth.users auth_user
set banned_until = null,
    updated_at = now()
where auth_user.banned_until is not null
  and exists (
    select 1
    from public.profiles profile
    join public.clients client on client.id = profile.client_id
    where profile.id = auth_user.id
      and profile.role = 'client'
      and profile.active is false
      and client.status = 'Inativo'
  );
