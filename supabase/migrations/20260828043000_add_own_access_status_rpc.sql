-- Authenticated users need to know only their own lifecycle status before the
-- regular RLS-protected profile load. This enables a precise blocked-account
-- message without exposing any other profile or client data.

create or replace function public.get_my_access_status()
returns table (
  profile_role text,
  profile_active boolean,
  client_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role, profile.active, client.status
  from public.profiles profile
  left join public.clients client on client.id = profile.client_id
  where profile.id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.get_my_access_status() from public, anon;
grant execute on function public.get_my_access_status() to authenticated;
