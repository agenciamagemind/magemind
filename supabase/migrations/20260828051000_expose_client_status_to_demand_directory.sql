begin;

-- The operational UI needs the real lifecycle status to keep paused and
-- inactive clients out of the New Demand selector. Contact and financial
-- fields remain private.
drop view if exists public.demand_client_directory;
drop function if exists private.list_demand_clients();

create function private.list_demand_clients()
returns table(id uuid, name text, status text, converted_to_team boolean)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.id, c.name, c.status, c.converted_to_team
  from public.clients c
  where c.archived_at is null
    and (
      public.current_user_role() in ('ceo', 'manager', 'gestor', 'editor')
      or (public.is_client() and c.id = public.my_client_id())
    );
$$;

revoke execute on function private.list_demand_clients() from public, anon;
grant execute on function private.list_demand_clients() to authenticated;

create view public.demand_client_directory
with (security_invoker = true, security_barrier = true)
as select * from private.list_demand_clients();

revoke all on public.demand_client_directory from public, anon;
grant select on public.demand_client_directory to authenticated;

commit;
