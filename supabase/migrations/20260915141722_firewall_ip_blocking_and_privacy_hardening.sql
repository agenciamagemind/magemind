-- Blocked addresses are evaluated by the authentication gateway before any
-- password check. Only the CEO can manage this list from the application.
create table public.security_blocked_ips (
  ip_address inet primary key,
  active boolean not null default true,
  reason text not null default 'Bloqueado manualmente'
    check (char_length(btrim(reason)) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint security_blocked_ips_expiry_check
    check (expires_at is null or expires_at > created_at)
);

create index security_blocked_ips_active_idx
  on public.security_blocked_ips (active, expires_at)
  where active is true;

alter table public.security_blocked_ips enable row level security;
revoke all on public.security_blocked_ips from public, anon, authenticated;
grant select, insert, update, delete on public.security_blocked_ips to authenticated;
grant all on public.security_blocked_ips to service_role;

create policy security_blocked_ips_ceo_read
on public.security_blocked_ips for select to authenticated
using ((select public.is_ceo()));

create policy security_blocked_ips_ceo_create
on public.security_blocked_ips for insert to authenticated
with check ((select public.is_ceo()) and created_by = (select auth.uid()));

create policy security_blocked_ips_ceo_update
on public.security_blocked_ips for update to authenticated
using ((select public.is_ceo()))
with check ((select public.is_ceo()) and created_by is not null);

create policy security_blocked_ips_ceo_delete
on public.security_blocked_ips for delete to authenticated
using ((select public.is_ceo()));

create function private.touch_security_blocked_ip()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger security_blocked_ips_touch
before update on public.security_blocked_ips
for each row execute function private.touch_security_blocked_ip();

-- Access logs must remain useful without becoming another contact directory.
-- The trigger masks e-mail snapshots on every insertion, including failed login.
create function private.mask_security_log_email()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_local text;
  v_domain text;
begin
  if new.email_snapshot is null or position('@' in new.email_snapshot) = 0 then
    new.email_snapshot := null;
    return new;
  end if;
  v_local := split_part(lower(btrim(new.email_snapshot)), '@', 1);
  v_domain := split_part(lower(btrim(new.email_snapshot)), '@', 2);
  new.email_snapshot := left(v_local, 1) || '***@' || v_domain;
  return new;
end;
$$;

create trigger security_access_logs_mask_email
before insert or update of email_snapshot on public.security_access_logs
for each row execute function private.mask_security_log_email();

update public.security_access_logs
set email_snapshot = left(split_part(lower(btrim(email_snapshot)), '@', 1), 1)
  || '***@' || split_part(lower(btrim(email_snapshot)), '@', 2)
where email_snapshot is not null
  and position('@' in email_snapshot) > 0
  and email_snapshot !~ '^[^@]\*\*\*@';

-- Telephone numbers belong in the RLS-protected business records. Remove the
-- redundant copy from user-editable Auth metadata for current accounts.
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'phone'
where coalesce(raw_user_meta_data, '{}'::jsonb) ? 'phone';

alter publication supabase_realtime add table public.security_blocked_ips;
