-- Turns the existing plans table into the single commercial solutions catalog.
-- Operational plan types remain intact for demand permissions, while the new
-- category column controls the four customer-facing catalog groups.

alter table public.plans
  add column if not exists solution_category text,
  add column if not exists is_custom boolean not null default false,
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

update public.plans
set solution_category = case
  when name ilike '%tráfego%' or name ilike '%reclame%' or name ilike '%site%' then 'other'
  when type = 'Avulso' then 'closed_package'
  when type in ('Semanal', 'Mensal') then 'weekly_monthly'
  when type = 'Diario' then 'infinite_plus'
  else 'other'
end
where solution_category is null;

update public.plans
set is_custom = true
where type = 'Personalizado';

alter table public.plans
  alter column solution_category set default 'other',
  alter column solution_category set not null;

alter table public.plans drop constraint if exists plans_solution_category_check;
alter table public.plans add constraint plans_solution_category_check
  check (solution_category in ('closed_package', 'weekly_monthly', 'infinite_plus', 'other'));

-- "Outro" is the operational counterpart for catalog services such as paid
-- traffic, websites and reputation management.
alter table public.plans drop constraint if exists plans_type_check;
alter table public.plans add constraint plans_type_check
  check (type in ('Avulso', 'Semanal', 'Diario', 'Mensal', 'Personalizado', 'Outro'));

create index if not exists plans_catalog_order_idx
  on public.plans (is_custom, solution_category, sort_order, created_at);

-- Customers receive active public solutions plus any plan explicitly assigned
-- to their own account. This last branch is what makes a private custom plan
-- available in Meu Perfil without publishing it in Solucoes.
drop policy if exists plans_select_business_roles on public.plans;
drop policy if exists plans_select_catalog on public.plans;
create policy plans_select_catalog
on public.plans for select to authenticated
using (
  (select public.is_staff_admin())
  or (
    (select public.is_affiliate())
    and active
    and not is_custom
  )
  or (
    (select public.is_client())
    and (
      (active and not is_custom)
      or id = (
        select client.plan_id
        from public.clients client
        where client.id = (select public.my_client_id())
      )
      or exists (
        select 1
        from public.client_plans client_plan
        where client_plan.client_id = (select public.my_client_id())
          and client_plan.plan_id = plans.id
      )
    )
  )
);

grant select, insert, update, delete on public.plans to authenticated;

comment on column public.plans.solution_category is
  'One of the four public catalog groups: closed_package, weekly_monthly, infinite_plus or other.';
comment on column public.plans.is_custom is
  'Private plan: never appears in the customer solutions catalog and is visible only to assigned customers.';
