-- Magemind security hardening (2026-08-20)
-- Scope: authorization, stored-XSS entry points and private documents.
-- This migration preserves all existing rows and Storage objects.

begin;

-- ---------------------------------------------------------------------------
-- 1. Profiles/Auth: authorization never trusts user-editable metadata.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := new.raw_app_meta_data->>'source';
  v_role text := new.raw_app_meta_data->>'role';
  v_name text := coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  v_phone text := nullif(btrim(new.raw_user_meta_data->>'phone'), '');
  v_client_id uuid;
begin
  -- Internal accounts are created only by an Admin API call that can write
  -- raw_app_meta_data. Public sign-up cannot forge this branch.
  if v_source = 'internal' and v_role in ('manager', 'gestor', 'editor', 'affiliate') then
    insert into public.profiles (id, name, email, phone, role, active, client_id)
    values (new.id, v_name, new.email, v_phone, v_role, true, null)
    on conflict (id) do update
      set name = excluded.name,
          email = excluded.email,
          phone = excluded.phone;
    return new;
  end if;

  -- A managed client is prepared by the create-client Edge Function. The
  -- trusted client_id comes from app_metadata and must already exist.
  if v_source = 'managed_client' and v_role = 'client' then
    begin
      v_client_id := nullif(new.raw_app_meta_data->>'client_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid managed client id';
    end;

    if v_client_id is null or not exists (select 1 from public.clients where id = v_client_id) then
      raise exception 'Managed client record not found';
    end if;

    insert into public.profiles (id, name, email, phone, role, active, client_id)
    values (new.id, v_name, new.email, v_phone, 'client', true, v_client_id)
    on conflict (id) do update
      set name = excluded.name,
          email = excluded.email,
          phone = excluded.phone,
          client_id = excluded.client_id;
    return new;
  end if;

  -- Every ordinary public sign-up is always a client. raw_user_meta_data is
  -- used only for presentation fields, never for authorization.
  insert into public.clients (name, email, phone, status)
  values (v_name, new.email, v_phone, 'Ativo')
  returning id into v_client_id;

  insert into public.profiles (id, name, email, phone, role, active, client_id)
  values (new.id, v_name, new.email, v_phone, 'client', true, v_client_id)
  on conflict (id) do update
    set name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        role = 'client',
        active = true,
        client_id = excluded.client_id;

  return new;
end;
$$;

create or replace function public.enforce_role_on_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role not in ('ceo', 'manager', 'gestor', 'editor', 'affiliate', 'client') then
    new.role := 'client';
  end if;
  return new;
end;
$$;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
begin
  -- Service-role/admin maintenance has no end-user uid and remains available.
  if actor_id is null then
    return new;
  end if;

  select p.role into actor_role from public.profiles p where p.id = actor_id;

  -- A user may edit only presentation/contact fields on their own profile.
  if actor_id = old.id then
    if new.role is distinct from old.role
       or new.email is distinct from old.email
       or new.client_id is distinct from old.client_id
       or new.active is distinct from old.active
       or new.commission_rate is distinct from old.commission_rate then
      raise exception 'Privileged profile fields cannot be changed by the profile owner';
    end if;
    return new;
  end if;

  -- No interactive user can create or modify another CEO.
  if old.role = 'ceo' or new.role = 'ceo' then
    raise exception 'CEO role is protected';
  end if;

  if actor_role = 'ceo' then
    return new;
  end if;

  if actor_role = 'manager'
     and old.role in ('manager', 'gestor', 'editor', 'affiliate')
     and new.role in ('manager', 'gestor', 'editor', 'affiliate', 'client') then
    return new;
  end if;

  if actor_role = 'gestor' and old.role = 'editor' and new.role = 'editor' then
    return new;
  end if;

  raise exception 'Not authorized to change this profile';
end;
$$;

drop trigger if exists trg_guard_profile_update on public.profiles;
create trigger trg_guard_profile_update
before update on public.profiles
for each row execute function public.guard_profile_update();

do $$
begin
  alter table public.profiles
    add constraint profiles_role_valid
    check (role in ('ceo', 'manager', 'gestor', 'editor', 'affiliate', 'client'));
exception when duplicate_object then null;
end $$;

drop policy if exists "Admin insere perfis" on public.profiles;
drop policy if exists "Usuário edita próprio perfil" on public.profiles;
drop policy if exists "Usuário vê próprio perfil" on public.profiles;
drop policy if exists profiles_delete on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_insert_admin on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_update_own_or_admin on public.profiles;

create policy profiles_select_secure
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or public.is_staff_admin()
  or (
    public.current_user_role() in ('gestor', 'editor')
    and role in ('ceo', 'manager', 'gestor', 'editor')
  )
);

create policy profiles_update_secure
on public.profiles for update
to authenticated
using (id = (select auth.uid()) or public.can_manage_user(id))
with check (id = (select auth.uid()) or public.can_manage_user(id));

create policy profiles_delete_secure
on public.profiles for delete
to authenticated
using (public.can_manage_user(id));

revoke all on public.profiles from anon;
revoke insert, truncate, references, trigger on public.profiles from authenticated;
grant select, update, delete on public.profiles to authenticated;

-- Trigger functions are not RPC endpoints.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_role_on_new_profile() from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Notifications/activity: no anonymous writes; authenticated writes are
-- attributable and constrained. Frontend still escapes content on output.
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

alter table public.activity
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

do $$
begin
  alter table public.notifications add constraint notifications_safe_lengths check (
    length(title) between 1 and 200
    and length(coalesce(body, '')) <= 1000
    and length(coalesce(icon, '')) <= 16
    and length(coalesce(icon_bg, '')) <= 64
    and (to_role is null or to_role = 'admin')
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.activity add constraint activity_safe_lengths check (
    length(text) between 1 and 1000
    and length(coalesce(icon, '')) <= 16
    and length(coalesce(bg, '')) <= 64
  );
exception when duplicate_object then null;
end $$;

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
  ) then
    raise exception 'Only the read state of a notification can be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_notification_update on public.notifications;
create trigger trg_guard_notification_update
before update on public.notifications
for each row execute function public.guard_notification_update();

drop policy if exists "Sistema insere notificações" on public.notifications;
drop policy if exists "Usuário marca como lida" on public.notifications;
drop policy if exists "Usuário vê próprias notificações" on public.notifications;
drop policy if exists notif_insert_all on public.notifications;
drop policy if exists notif_select_own on public.notifications;
drop policy if exists notif_update_own on public.notifications;
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;

create policy notifications_select_secure
on public.notifications for select
to authenticated
using (
  to_user_id = (select auth.uid())
  or (to_role = 'admin' and public.is_operational_staff())
);

create policy notifications_insert_secure
on public.notifications for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (public.is_operational_staff() and (to_user_id is not null or to_role = 'admin'))
    or (not public.is_operational_staff() and to_user_id is null and to_role = 'admin')
  )
);

create policy notifications_update_secure
on public.notifications for update
to authenticated
using (
  to_user_id = (select auth.uid())
  or (to_role = 'admin' and public.is_operational_staff())
)
with check (
  to_user_id = (select auth.uid())
  or (to_role = 'admin' and public.is_operational_staff())
);

revoke all on public.notifications from anon;
revoke delete, truncate, references, trigger on public.notifications from authenticated;
grant select, insert, update on public.notifications to authenticated;
revoke execute on function public.guard_notification_update() from public, anon, authenticated;

drop policy if exists "Admin vê atividades" on public.activity;
drop policy if exists "Sistema insere atividades" on public.activity;
drop policy if exists activity_insert_admin on public.activity;
drop policy if exists activity_select on public.activity;
drop policy if exists activity_select_admin on public.activity;

create policy activity_select_secure
on public.activity for select
to authenticated
using (public.is_staff_admin());

create policy activity_insert_secure
on public.activity for insert
to authenticated
with check (created_by = (select auth.uid()));

revoke all on public.activity from anon;
revoke update, delete, truncate, references, trigger on public.activity from authenticated;
grant select, insert on public.activity to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Private documents: metadata RLS and Storage access are aligned.
-- Existing base64 documents are preserved. New files use storage_path.
-- ---------------------------------------------------------------------------

alter table public.docs add column if not exists storage_path text;

do $$
begin
  alter table public.docs add constraint docs_visibility_valid
  check (visibility in ('internal', 'client', 'affiliate', 'public', 'restricted'));
exception when duplicate_object then null;
end $$;

drop policy if exists "Admin gerencia documentos" on public.docs;
drop policy if exists "Admin vê todos os documentos" on public.docs;
drop policy if exists "Cliente vê próprios documentos" on public.docs;
drop policy if exists docs_delete on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_select on public.docs;
drop policy if exists docs_select_own_or_admin on public.docs;
drop policy if exists docs_write_admin on public.docs;

create policy docs_select_secure
on public.docs for select
to authenticated
using (
  public.is_staff_admin()
  or (
    public.current_user_role() in ('gestor', 'editor')
    and visibility in ('internal', 'public')
  )
  or (
    public.current_user_role() = 'affiliate'
    and visibility in ('affiliate', 'public')
  )
  or (
    public.current_user_role() = 'client'
    and (
      visibility = 'public'
      or (visibility = 'client' and client_id = public.my_client_id())
    )
  )
);

create policy docs_insert_secure
on public.docs for insert
to authenticated
with check (public.is_staff_admin());

create policy docs_update_secure
on public.docs for update
to authenticated
using (public.is_staff_admin())
with check (public.is_staff_admin());

create policy docs_delete_secure
on public.docs for delete
to authenticated
using (public.is_staff_admin());

revoke all on public.docs from anon;
revoke truncate, references, trigger on public.docs from authenticated;
grant select, insert, update, delete on public.docs to authenticated;

update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array[
      'application/pdf',
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'text/plain', 'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]::text[]
where id = 'magemind-docs';

drop policy if exists docs_storage_read on storage.objects;
drop policy if exists docs_storage_write_admin on storage.objects;
drop policy if exists docs_storage_select_secure on storage.objects;
drop policy if exists docs_storage_insert_secure on storage.objects;
drop policy if exists docs_storage_update_secure on storage.objects;
drop policy if exists docs_storage_delete_secure on storage.objects;

create policy docs_storage_select_secure
on storage.objects for select
to authenticated
using (
  bucket_id = 'magemind-docs'
  and exists (
    select 1 from public.docs d
    where d.storage_path = storage.objects.name
  )
);

create policy docs_storage_insert_secure
on storage.objects for insert
to authenticated
with check (bucket_id = 'magemind-docs' and public.is_staff_admin());

create policy docs_storage_update_secure
on storage.objects for update
to authenticated
using (bucket_id = 'magemind-docs' and public.is_staff_admin())
with check (bucket_id = 'magemind-docs' and public.is_staff_admin());

create policy docs_storage_delete_secure
on storage.objects for delete
to authenticated
using (bucket_id = 'magemind-docs' and public.is_staff_admin());

commit;

