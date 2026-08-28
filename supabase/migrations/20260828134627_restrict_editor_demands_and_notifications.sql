begin;

-- Editors see and move only demands assigned to their own profile.
create or replace function public.guard_editor_demand_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() = 'editor' then
    if old.assignee_id is distinct from (select auth.uid())
       or new.assignee_id is distinct from (select auth.uid()) then
      raise exception 'Editor can update only assigned demands';
    end if;
    if new.id is distinct from old.id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.refs is distinct from old.refs
       or new.client_id is distinct from old.client_id
       or new.assignee_id is distinct from old.assignee_id
       or new.priority is distinct from old.priority
       or new.due_date is distinct from old.due_date
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Editors can change only demand status and order';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_editor_demand_update on public.demands;
create trigger trg_guard_editor_demand_update
before update on public.demands
for each row execute function public.guard_editor_demand_update();
revoke execute on function public.guard_editor_demand_update() from public, anon, authenticated;

drop policy if exists demands_select_authorized on public.demands;
create policy demands_select_authorized
on public.demands for select to authenticated
using (
  public.is_staff_admin()
  or public.is_gestor()
  or (public.is_editor() and assignee_id = (select auth.uid()))
  or (public.is_client() and client_id = public.my_client_id())
);

drop policy if exists demands_insert_authorized on public.demands;
create policy demands_insert_authorized
on public.demands for insert to authenticated
with check (
  public.is_staff_admin()
  or public.is_gestor()
  or (
    public.client_has_demand_management_plan()
    and client_id = public.my_client_id()
    and created_by = (select auth.uid())
    and assignee_id is null
  )
);

drop policy if exists demands_update_authorized on public.demands;
create policy demands_update_authorized
on public.demands for update to authenticated
using (
  public.is_staff_admin()
  or public.is_gestor()
  or (public.is_editor() and assignee_id = (select auth.uid()))
  or (public.client_has_demand_management_plan() and client_id = public.my_client_id())
)
with check (
  public.is_staff_admin()
  or public.is_gestor()
  or (public.is_editor() and assignee_id = (select auth.uid()))
  or (public.client_has_demand_management_plan() and client_id = public.my_client_id())
);

drop policy if exists demands_delete_authorized on public.demands;
create policy demands_delete_authorized
on public.demands for delete to authenticated
using (
  public.is_staff_admin()
  or public.is_gestor()
  or (public.client_has_demand_management_plan() and client_id = public.my_client_id())
);

-- Broadcast notifications remain broad for leadership, but Editors receive
-- only demand-linked events for work assigned to them.
drop policy if exists notifications_select_recipient on public.notifications;
create policy notifications_select_recipient
on public.notifications for select to authenticated
using (
  public.is_active_user()
  and (
    (
      public.is_editor()
      and link_demand_id is not null
      and (to_user_id = (select auth.uid()) or to_role = 'admin')
      and exists (
        select 1 from public.demands demand
        where demand.id = link_demand_id and demand.assignee_id = (select auth.uid())
      )
    )
    or (
      not public.is_editor()
      and (
        to_user_id = (select auth.uid())
        or (to_role = 'admin' and public.is_operational_staff())
      )
    )
  )
);

drop policy if exists notifications_update_recipient on public.notifications;
create policy notifications_update_recipient
on public.notifications for update to authenticated
using (
  public.is_active_user()
  and (
    (
      public.is_editor()
      and link_demand_id is not null
      and (to_user_id = (select auth.uid()) or to_role = 'admin')
      and exists (
        select 1 from public.demands demand
        where demand.id = link_demand_id and demand.assignee_id = (select auth.uid())
      )
    )
    or (
      not public.is_editor()
      and (
        to_user_id = (select auth.uid())
        or (to_role = 'admin' and public.is_operational_staff())
      )
    )
  )
)
with check (
  public.is_active_user()
  and (
    (
      public.is_editor()
      and link_demand_id is not null
      and (to_user_id = (select auth.uid()) or to_role = 'admin')
      and exists (
        select 1 from public.demands demand
        where demand.id = link_demand_id and demand.assignee_id = (select auth.uid())
      )
    )
    or (
      not public.is_editor()
      and (
        to_user_id = (select auth.uid())
        or (to_role = 'admin' and public.is_operational_staff())
      )
    )
  )
);

-- Safe client directory: active lifecycle state is exposed, but team profiles
-- and their legacy client records never become demand clients.
drop view if exists public.demand_client_directory;
drop function if exists private.list_demand_clients();

create function private.list_demand_clients()
returns table(id uuid, name text, status text, converted_to_team boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select client.id, client.name, client.status, client.converted_to_team
  from public.clients client
  where client.archived_at is null
    and coalesce(client.converted_to_team, false) is false
    and not exists (
      select 1 from public.profiles profile
      where profile.role <> 'client'
        and profile.archived_at is null
        and (
          profile.client_id = client.id
          or (
            nullif(lower(btrim(coalesce(profile.email, ''))), '') is not null
            and lower(btrim(profile.email)) = lower(btrim(coalesce(client.email, '')))
          )
        )
    )
    and (
      public.current_user_role() in ('ceo', 'manager', 'gestor', 'editor')
      or (public.is_client() and client.id = public.my_client_id())
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
