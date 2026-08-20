begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.list_demand_clients()
returns table(id uuid, name text, converted_to_team boolean)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.id, c.name, c.converted_to_team
  from public.clients c
  where public.current_user_role() in ('ceo', 'manager', 'gestor', 'editor')
     or (public.is_client() and c.id = public.my_client_id());
$$;

create or replace function private.list_demand_team()
returns table(id uuid, name text, role text, av text, photo text, active boolean)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select p.id, p.name, p.role, p.av, p.photo, p.active
  from public.profiles p
  where p.role in ('ceo', 'manager', 'gestor', 'editor')
    and (
      public.current_user_role() in ('ceo', 'manager', 'gestor', 'editor')
      or (
        public.is_client()
        and exists (
          select 1 from public.demands d
          where d.client_id = public.my_client_id() and d.assignee_id = p.id
        )
      )
    );
$$;

revoke execute on function private.list_demand_clients() from public, anon;
revoke execute on function private.list_demand_team() from public, anon;
grant execute on function private.list_demand_clients() to authenticated;
grant execute on function private.list_demand_team() to authenticated;

drop view if exists public.demand_client_directory;
create view public.demand_client_directory
with (security_invoker = true, security_barrier = true)
as select * from private.list_demand_clients();

drop view if exists public.demand_team_directory;
create view public.demand_team_directory
with (security_invoker = true, security_barrier = true)
as select * from private.list_demand_team();

revoke all on public.demand_client_directory, public.demand_team_directory from public, anon;
grant select on public.demand_client_directory, public.demand_team_directory to authenticated;

commit;



