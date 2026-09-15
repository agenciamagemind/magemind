-- Expenses share the sales ledger, but never expose a client or commission link.
alter table public.sales drop constraint sales_status_check;
alter table public.sales add constraint sales_status_check check(status in ('Fechado','Pendente','Cancelado','Gasto'));
alter table public.sales add constraint expense_fields_check check(status <> 'Gasto' or
 (client_id is null and plan_id is null and demand_id is null and sale_date is not null and length(trim(coalesce(service,'')))>0));
drop policy sales_select_authorized on public.sales;
create policy sales_select_authorized on public.sales for select to authenticated using
 (public.is_staff_admin() or (status <> 'Gasto' and (
 (public.is_affiliate() and exists(select 1 from public.clients c where c.id=sales.client_id and c.affiliate_id=(select auth.uid())))
 or (public.is_client() and client_id=public.my_client_id()))));

create table public.goals (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(trim(title)) between 1 and 160),
 description text not null default '' check(length(description)<=2000),
 metric text not null check(metric in ('revenue','count','manual')),
 target numeric(14,2) not null check(target>0 and target::text not in ('NaN','Infinity','-Infinity')),
 manual_value numeric(14,2) not null default 0 check(manual_value>=0 and manual_value::text not in ('NaN','Infinity','-Infinity')),
 unit text not null default 'unidades' check(length(trim(unit)) between 1 and 40),
 plan_id uuid references public.plans(id) on delete restrict,
 start_date date not null,
 end_date date not null check(end_date>=start_date),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint goals_metric_fields check((metric<>'manual' or plan_id is null) and (metric<>'count' or target=trunc(target)))
);
create index goals_plan_idx on public.goals(plan_id);
create index goals_period_idx on public.goals(archived,end_date);
alter table public.goals enable row level security;
revoke all on public.goals from anon;
grant select,insert,update,delete on public.goals to authenticated;
grant all on public.goals to service_role;
create policy goals_read on public.goals for select to authenticated using ((select public.current_user_role()) in ('ceo','manager'));
create policy goals_create on public.goals for insert to authenticated with check ((select public.current_user_role()) in ('ceo','manager'));
create policy goals_update on public.goals for update to authenticated using ((select public.current_user_role()) in ('ceo','manager')) with check ((select public.current_user_role()) in ('ceo','manager'));
create policy goals_delete on public.goals for delete to authenticated using ((select public.current_user_role()) in ('ceo','manager'));
create function private.touch_goal() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=clock_timestamp(); return new; end; $$;
create trigger goals_touch before update on public.goals for each row execute function private.touch_goal();

-- Aggregate in Postgres so automatic goals include the full ledger, even beyond API page limits.
create view public.goal_progress with (security_invoker=true) as
select g.*,coalesce(p.name,'Todos os planos') as plan_name,
 case when g.metric='manual' then g.manual_value when g.metric='count' then totals.quantity else totals.revenue end as current_value
from public.goals g left join public.plans p on p.id=g.plan_id
cross join lateral (
 select count(*)::numeric as quantity,coalesce(sum(s.value),0) as revenue from public.sales s
 where s.status='Fechado' and coalesce(s.sale_date,(s.created_at at time zone 'America/Sao_Paulo')::date)
 between g.start_date and least(g.end_date,(now() at time zone 'America/Sao_Paulo')::date)
 and (g.plan_id is null or s.plan_id=g.plan_id)
) totals;
revoke all on public.goal_progress from anon;
grant select on public.goal_progress to authenticated,service_role;
alter publication supabase_realtime add table public.goals;
