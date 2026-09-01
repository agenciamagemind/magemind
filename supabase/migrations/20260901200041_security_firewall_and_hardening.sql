-- Security audit trail, abuse controls and authorization hardening.

create table if not exists public.security_access_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  email_snapshot text,
  event_type text not null,
  outcome text not null,
  ip_address text,
  country_code text,
  timezone text,
  locale text,
  user_agent text,
  browser text,
  operating_system text,
  device_type text,
  session_fingerprint text,
  path text,
  origin text,
  risk_level text not null default 'low',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  constraint security_access_event_check check (event_type in (
    'login_success','login_failure','signup_success','signup_failure',
    'session_access','page_view','logout','access_denied','rate_limited'
  )),
  constraint security_access_outcome_check check (outcome in ('success','failure','blocked')),
  constraint security_access_risk_check check (risk_level in ('low','medium','high')),
  constraint security_access_email_length check (email_snapshot is null or char_length(email_snapshot) <= 254),
  constraint security_access_ip_length check (ip_address is null or char_length(ip_address) <= 64),
  constraint security_access_context_length check (
    (user_agent is null or char_length(user_agent) <= 512) and
    (path is null or char_length(path) <= 240) and
    (origin is null or char_length(origin) <= 240) and
    (reason is null or char_length(reason) <= 300)
  )
);

create index if not exists security_access_logs_occurred_at_idx
  on public.security_access_logs (occurred_at desc);
create index if not exists security_access_logs_user_idx
  on public.security_access_logs (user_id, occurred_at desc);
create index if not exists security_access_logs_ip_idx
  on public.security_access_logs (ip_address, occurred_at desc);
create index if not exists security_access_logs_outcome_idx
  on public.security_access_logs (outcome, occurred_at desc);

alter table public.security_access_logs enable row level security;
revoke all on public.security_access_logs from public, anon, authenticated;
grant select on public.security_access_logs to authenticated;
grant all on public.security_access_logs to service_role;

drop policy if exists security_access_logs_ceo_read on public.security_access_logs;
create policy security_access_logs_ceo_read
on public.security_access_logs for select to authenticated
using (public.is_ceo());

comment on table public.security_access_logs is
  'Immutable server-side access trail. Contains no passwords, tokens or precise GPS coordinates.';

create table if not exists public.security_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);
alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;
grant all on public.security_rate_limits to service_role;

create or replace function public.consume_security_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer, attempts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.security_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_bucket_key is null or char_length(p_bucket_key) > 180
     or p_limit < 1 or p_limit > 1000
     or p_window_seconds < 10 or p_window_seconds > 604800 then
    raise exception 'Invalid rate limit parameters';
  end if;

  insert into public.security_rate_limits(bucket_key, window_started_at, attempts, updated_at)
  values (p_bucket_key, v_now, 1, v_now)
  on conflict (bucket_key) do update set
    window_started_at = case
      when security_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
      then v_now else security_rate_limits.window_started_at end,
    attempts = case
      when security_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
      then 1 else security_rate_limits.attempts + 1 end,
    updated_at = v_now
  returning * into v_row;

  allowed := v_row.attempts <= p_limit;
  attempts := v_row.attempts;
  retry_after_seconds := greatest(0, ceil(extract(epoch from
    (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer);
  return next;
end;
$$;
revoke all on function public.consume_security_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text,integer,integer) to service_role;

-- Editors may only read/comment on demands assigned to them.
drop policy if exists comments_select_related_demand on public.comments;
create policy comments_select_related_demand
on public.comments for select to authenticated
using (exists (
  select 1 from public.demands d where d.id = comments.demand_id and (
    public.is_staff_admin() or public.is_gestor()
    or (public.is_editor() and d.assignee_id = (select auth.uid()))
    or (public.is_client() and d.client_id = public.my_client_id())
  )
));

drop policy if exists comments_insert_related_demand on public.comments;
create policy comments_insert_related_demand
on public.comments for insert to authenticated
with check (
  author_id = (select auth.uid()) and exists (
    select 1 from public.demands d where d.id = comments.demand_id and (
      public.is_staff_admin() or public.is_gestor()
      or (public.is_editor() and d.assignee_id = (select auth.uid()))
      or (public.is_client() and d.client_id = public.my_client_id())
    )
  )
);

-- Documents keep their original author and storage object. Only CEO/Managers
-- may change ownership, visibility or restricted-document metadata.
create or replace function public.guard_document_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_role text;
begin
  if auth.uid() is null then return new; end if;
  v_role := public.current_user_role();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    return new;
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Document authorship cannot be changed';
  end if;
  if v_role not in ('ceo','manager') and (
    new.client_id is distinct from old.client_id or
    new.visibility is distinct from old.visibility or
    new.storage_path is distinct from old.storage_path or
    new.file_url is distinct from old.file_url or
    new.file_name is distinct from old.file_name or
    old.visibility = 'restricted' or new.visibility = 'restricted'
  ) then
    raise exception 'Only administrators can change document ownership or visibility';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_document_update() from public, anon, authenticated;

drop trigger if exists trg_guard_document_update on public.docs;
create trigger trg_guard_document_update
before insert or update on public.docs
for each row execute function public.guard_document_update();

-- Direct notification inserts made abuse and spoofing possible. All creation
-- now goes through create_notification(), which validates and attributes it.
drop policy if exists notifications_insert_attributed on public.notifications;
revoke insert on public.notifications from authenticated;

alter table public.comments
  drop constraint if exists comments_text_security_check,
  add constraint comments_text_security_check check (char_length(btrim(text)) between 1 and 4000);
alter table public.activity
  drop constraint if exists activity_content_security_check,
  add constraint activity_content_security_check check (
    char_length(btrim(text)) between 1 and 600 and
    (icon is null or char_length(icon) <= 16) and
    (bg is null or char_length(bg) <= 64)
  );
alter table public.demands
  drop constraint if exists demands_content_security_check,
  add constraint demands_content_security_check check (
    char_length(btrim(title)) between 1 and 180 and
    (description is null or char_length(description) <= 12000) and
    (refs is null or char_length(refs) <= 8000)
  );
alter table public.docs
  drop constraint if exists docs_content_security_check,
  add constraint docs_content_security_check check (
    char_length(btrim(name)) between 1 and 180 and
    (category is null or char_length(category) <= 80) and
    (file_name is null or char_length(file_name) <= 255) and
    (storage_path is null or char_length(storage_path) <= 512)
  );

-- Every uploader writes under docs/<auth.uid()>_. Operational users may not
-- overwrite or delete another person's object; CEO/Managers retain recovery powers.
drop policy if exists docs_storage_insert_authorized on storage.objects;
create policy docs_storage_insert_authorized on storage.objects
for insert to authenticated with check (
  bucket_id = 'magemind-docs' and public.is_active_user()
  and name like ('docs/' || (select auth.uid())::text || '\_%') escape '\'
  and (public.is_operational_staff() or public.is_client())
);

drop policy if exists docs_storage_update_authorized on storage.objects;
create policy docs_storage_update_authorized on storage.objects
for update to authenticated using (
  bucket_id = 'magemind-docs' and public.is_active_user() and (
    public.is_staff_admin() or name like ('docs/' || (select auth.uid())::text || '\_%') escape '\'
  )
) with check (
  bucket_id = 'magemind-docs' and public.is_active_user() and (
    public.is_staff_admin() or name like ('docs/' || (select auth.uid())::text || '\_%') escape '\'
  )
);

drop policy if exists docs_storage_delete_authorized on storage.objects;
create policy docs_storage_delete_authorized on storage.objects
for delete to authenticated using (
  bucket_id = 'magemind-docs' and public.is_active_user() and (
    public.is_staff_admin() or name like ('docs/' || (select auth.uid())::text || '\_%') escape '\'
  )
);

-- Remove obsolete/public execution paths from earlier migrations.
revoke execute on function public.admin_archive_client(uuid) from public, anon;
revoke execute on function public.admin_set_profile_active(uuid,boolean) from public, anon;
revoke execute on function public.admin_sync_identity_email(uuid,text,text) from public, anon;
drop function if exists public.admin_convert_team_to_client(uuid);

-- Housekeeping is server-side only and retains six months of security events.
create or replace function public.prune_security_records()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.security_access_logs where occurred_at < now() - interval '180 days';
  delete from public.security_rate_limits where updated_at < now() - interval '7 days';
$$;
revoke all on function public.prune_security_records() from public, anon, authenticated;
grant execute on function public.prune_security_records() to service_role;
