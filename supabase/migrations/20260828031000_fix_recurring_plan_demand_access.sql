-- Infinite+ and weekly subscriptions are recurring plans even though their
-- technical type describes delivery cadence instead of monthly billing.

create or replace function public.client_has_demand_management_plan()
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
          where client_plan.client_id = client.id
            and plan.active is true
            and plan.type in ('Semanal', 'Diario', 'Mensal')
        )
        or exists (
          select 1
          from public.plans plan
          where plan.id = client.plan_id
            and plan.active is true
            and plan.type in ('Semanal', 'Diario', 'Mensal')
        )
      )
  );
$$;

revoke all on function public.client_has_demand_management_plan() from public, anon;
grant execute on function public.client_has_demand_management_plan() to authenticated;

drop policy if exists demands_insert_authorized on public.demands;
create policy demands_insert_authorized
on public.demands for insert to authenticated
with check (
  public.is_operational_staff()
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
  public.is_operational_staff()
  or (public.client_has_demand_management_plan() and client_id = public.my_client_id())
)
with check (
  public.is_operational_staff()
  or (public.client_has_demand_management_plan() and client_id = public.my_client_id())
);

drop policy if exists demands_delete_authorized on public.demands;
create policy demands_delete_authorized
on public.demands for delete to authenticated
using (
  public.is_operational_staff()
  or (public.client_has_demand_management_plan() and client_id = public.my_client_id())
);

drop function if exists public.client_has_monthly_plan();
