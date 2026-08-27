-- Mobile Web Push: per-user preferences, per-device subscriptions and
-- idempotent delivery tracking. The browser can only manage its own records;
-- deliveries remain service-role only.

alter table public.notifications
  add column if not exists event_type text not null default 'general';

do $$
begin
  alter table public.notifications add constraint notifications_event_type_safe
    check (event_type ~ '^[a-z][a-z0-9_]{0,47}$');
exception when duplicate_object then null;
end $$;

create or replace function public.create_notification(
  p_to_user_id uuid,
  p_to_role text,
  p_icon text,
  p_icon_bg text,
  p_title text,
  p_body text,
  p_link_demand_id uuid,
  p_event_type text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_active_user() then raise exception 'Inactive user'; end if;
  if (p_to_user_id is null) = (p_to_role is null) then raise exception 'Exactly one recipient is required'; end if;
  if p_to_role is not null and p_to_role <> 'admin' then raise exception 'Invalid role recipient'; end if;
  if public.is_operational_staff() then
    if p_to_user_id is null and p_to_role <> 'admin' then raise exception 'Invalid recipient'; end if;
  elsif p_to_user_id is not null or p_to_role <> 'admin' then
    raise exception 'Clients can only notify the operational team';
  end if;

  insert into public.notifications (
    to_user_id, to_role, icon, icon_bg, title, body, link_demand_id,
    event_type, read, created_by
  ) values (
    p_to_user_id, p_to_role, p_icon, p_icon_bg, p_title, coalesce(p_body, ''),
    p_link_demand_id, coalesce(nullif(p_event_type, ''), 'general'), false, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_notification(uuid,text,text,text,text,text,uuid,text) from public, anon;
grant execute on function public.create_notification(uuid,text,text,text,text,text,uuid,text) to authenticated;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default false,
  demand_updates boolean not null default true,
  comments boolean not null default true,
  sales boolean not null default true,
  team_activity boolean not null default true,
  general boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  platform text not null default 'other'
    check (platform in ('ios', 'android', 'desktop', 'other')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, endpoint),
  check (length(endpoint) between 20 and 4096),
  check (length(p256dh) between 20 and 512),
  check (length(auth) between 8 and 256)
);

create table if not exists public.push_deliveries (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'expired')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (notification_id, subscription_id)
);

create index if not exists push_subscriptions_user_enabled_idx
  on public.push_subscriptions (user_id) where enabled is true;
create index if not exists push_deliveries_status_idx
  on public.push_deliveries (status, updated_at);

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;

create policy notification_preferences_select_own
on public.notification_preferences for select to authenticated
using (public.is_active_user() and user_id = (select auth.uid()));

create policy notification_preferences_insert_own
on public.notification_preferences for insert to authenticated
with check (public.is_active_user() and user_id = (select auth.uid()));

create policy notification_preferences_update_own
on public.notification_preferences for update to authenticated
using (public.is_active_user() and user_id = (select auth.uid()))
with check (public.is_active_user() and user_id = (select auth.uid()));

create policy push_subscriptions_select_own
on public.push_subscriptions for select to authenticated
using (public.is_active_user() and user_id = (select auth.uid()));

create policy push_subscriptions_insert_own
on public.push_subscriptions for insert to authenticated
with check (public.is_active_user() and user_id = (select auth.uid()));

create policy push_subscriptions_update_own
on public.push_subscriptions for update to authenticated
using (public.is_active_user() and user_id = (select auth.uid()))
with check (public.is_active_user() and user_id = (select auth.uid()));

create policy push_subscriptions_delete_own
on public.push_subscriptions for delete to authenticated
using (public.is_active_user() and user_id = (select auth.uid()));

revoke all on public.notification_preferences, public.push_subscriptions, public.push_deliveries from anon;
revoke all on public.push_deliveries from authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.update_updated_at();

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at
before update on public.push_subscriptions
for each row execute function public.update_updated_at();

-- Keep notification metadata immutable just like its recipient and content.
create or replace function public.guard_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and (
    new.to_user_id is distinct from old.to_user_id
    or new.to_role is distinct from old.to_role
    or new.icon is distinct from old.icon
    or new.icon_bg is distinct from old.icon_bg
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.link_demand_id is distinct from old.link_demand_id
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
