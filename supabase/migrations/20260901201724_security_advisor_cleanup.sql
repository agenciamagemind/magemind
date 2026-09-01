-- Follow-up from Supabase security/performance advisors.
revoke execute on function public.is_active_user() from public, anon;

drop policy if exists security_rate_limits_no_client_access on public.security_rate_limits;
create policy security_rate_limits_no_client_access
on public.security_rate_limits for all to anon, authenticated
using (false) with check (false);

create index if not exists activity_created_by_idx on public.activity(created_by);
create index if not exists clients_plan_id_idx on public.clients(plan_id);
create index if not exists comments_author_id_idx on public.comments(author_id);
create index if not exists demands_created_by_idx on public.demands(created_by);
create index if not exists notifications_created_by_idx on public.notifications(created_by);
create index if not exists notifications_link_demand_id_idx on public.notifications(link_demand_id);
create index if not exists sales_demand_id_idx on public.sales(demand_id);
create index if not exists sales_plan_id_idx on public.sales(plan_id);

drop index if exists public.idx_notif_to_role;
drop index if exists public.idx_notif_to_user;
