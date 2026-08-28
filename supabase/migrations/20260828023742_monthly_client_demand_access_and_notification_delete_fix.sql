-- Monthly plans are an actual plan type in the UI and grant the linked client
-- self-service demand management. Keep authorization enforced in Postgres.

alter table public.plans drop constraint if exists plans_type_check;
alter table public.plans add constraint plans_type_check
  check (type in ('Avulso', 'Semanal', 'Diario', 'Mensal', 'Personalizado'));

create or replace function public.client_has_monthly_plan()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.clients client on client.id = profile.client_id
    where profile.id = (select auth.uid())
      and profile.role = 'client'
      and profile.active is true
      and profile.archived_at is null
      and client.status = 'Ativo'
      and client.archived_at is null
      and (
        exists (
          select 1
          from public.client_plans client_plan
          join public.plans plan on plan.id = client_plan.plan_id
          where client_plan.client_id = client.id and plan.type = 'Mensal'
        )
        or exists (
          select 1 from public.plans plan
          where plan.id = client.plan_id and plan.type = 'Mensal'
        )
      )
  );
$$;

revoke all on function public.client_has_monthly_plan() from public, anon;
grant execute on function public.client_has_monthly_plan() to authenticated;

drop policy if exists demands_insert_operational on public.demands;
create policy demands_insert_authorized
on public.demands for insert to authenticated
with check (
  public.is_operational_staff()
  or (
    public.client_has_monthly_plan()
    and client_id = public.my_client_id()
    and created_by = (select auth.uid())
    and assignee_id is null
  )
);

drop policy if exists demands_update_operational on public.demands;
create policy demands_update_authorized
on public.demands for update to authenticated
using (
  public.is_operational_staff()
  or (public.client_has_monthly_plan() and client_id = public.my_client_id())
)
with check (
  public.is_operational_staff()
  or (public.client_has_monthly_plan() and client_id = public.my_client_id())
);

drop policy if exists demands_delete_operational on public.demands;
create policy demands_delete_authorized
on public.demands for delete to authenticated
using (
  public.is_operational_staff()
  or (public.client_has_monthly_plan() and client_id = public.my_client_id())
);

update public.demands set status = 'Não iniciado' where status is null;
alter table public.demands alter column status set default 'Não iniciado';
alter table public.demands alter column status set not null;

-- notifications.link_demand_id is ON DELETE SET NULL. Allow only that
-- referential cleanup while keeping all notification metadata immutable.
create or replace function public.guard_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  demand_link_cleared_by_fk boolean;
begin
  demand_link_cleared_by_fk :=
    old.link_demand_id is not null
    and new.link_demand_id is null
    and not exists (
      select 1 from public.demands demand where demand.id = old.link_demand_id
    );

  if auth.uid() is not null and (
    new.to_user_id is distinct from old.to_user_id
    or new.to_role is distinct from old.to_role
    or new.icon is distinct from old.icon
    or new.icon_bg is distinct from old.icon_bg
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or (
      new.link_demand_id is distinct from old.link_demand_id
      and not demand_link_cleared_by_fk
    )
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.event_type is distinct from old.event_type
  ) then
    raise exception 'Only the read state of a notification can be changed';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_notification_update() from public, anon, authenticated;
