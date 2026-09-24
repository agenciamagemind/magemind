-- Personal daily tasks for CEO and managers. Goals remain a separate shared ledger.
create table public.daily_tasks (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check (length(btrim(title)) between 1 and 160),
 notes text not null default '' check (length(notes) <= 4000),
 due_date date,
 priority text not null default 'Média' check (priority in ('Alta','Média','Baixa')),
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index daily_tasks_owner_open_idx on public.daily_tasks(owner_id,due_date,created_at) where completed_at is null;
create index daily_tasks_owner_done_idx on public.daily_tasks(owner_id,completed_at desc) where completed_at is not null;
alter table public.daily_tasks enable row level security;
revoke all on public.daily_tasks from anon, authenticated;
grant select, insert, update, delete on public.daily_tasks to authenticated;
grant all on public.daily_tasks to service_role;
create policy daily_tasks_select on public.daily_tasks for select to authenticated
 using (owner_id = (select auth.uid()) and (select public.current_user_role()) in ('ceo','manager'));
create policy daily_tasks_insert on public.daily_tasks for insert to authenticated
 with check (owner_id = (select auth.uid()) and (select public.current_user_role()) in ('ceo','manager'));
create policy daily_tasks_update on public.daily_tasks for update to authenticated
 using (owner_id = (select auth.uid()) and (select public.current_user_role()) in ('ceo','manager'))
 with check (owner_id = (select auth.uid()) and (select public.current_user_role()) in ('ceo','manager'));
create policy daily_tasks_delete on public.daily_tasks for delete to authenticated
 using (owner_id = (select auth.uid()) and (select public.current_user_role()) in ('ceo','manager'));
create function private.touch_daily_task() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=clock_timestamp(); return new; end; $$;
create trigger daily_tasks_touch before update on public.daily_tasks for each row execute function private.touch_daily_task();
alter publication supabase_realtime add table public.daily_tasks;
