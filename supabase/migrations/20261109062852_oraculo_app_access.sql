-- Only the current, active CEO/manager Auth session may open the shared Oráculo.
-- This gate reads existing records; it does not change any role or app policy.
create schema if not exists oraculo_internal;
revoke all on schema oraculo_internal from public, anon;
grant usage on schema oraculo_internal to authenticated;
create or replace function oraculo_internal.current_access()
returns table(user_id uuid, profile_role text)
language sql stable security definer
set search_path = ''
as $function$
  select p.id, p.role
  from public.profiles p
  join auth.sessions s on s.user_id = p.id
  where p.id = (select auth.uid())
    and p.role in ('ceo', 'manager')
    and p.active is true and p.archived_at is null
    and s.id::text = (select auth.jwt()->>'session_id')
    and (s.not_after is null or s.not_after > now())
  limit 1;
$function$;
revoke all on function oraculo_internal.current_access() from public, anon;
grant execute on function oraculo_internal.current_access() to authenticated;
create or replace function public.get_oraculo_access()
returns table(user_id uuid, profile_role text)
language sql stable security invoker
set search_path = ''
as $function$
  select * from oraculo_internal.current_access();
$function$;
revoke all on function public.get_oraculo_access() from public, anon;
grant execute on function public.get_oraculo_access() to authenticated;
comment on function public.get_oraculo_access() is 'Access to the shared Oráculo for active CEO/manager profiles and non-revoked Auth sessions.';
