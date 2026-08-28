begin;

alter table public.profiles
  add column if not exists avatar_prompt_count smallint default 2;

update public.profiles
set avatar_prompt_count = 2
where avatar_prompt_count is null;

alter table public.profiles
  alter column avatar_prompt_count set default 0,
  alter column avatar_prompt_count set not null;

alter table public.profiles
  drop constraint if exists profiles_avatar_prompt_count_check;
alter table public.profiles
  add constraint profiles_avatar_prompt_count_check
  check (avatar_prompt_count between 0 and 2);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  2097152,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_images_insert_own on storage.objects;
create policy profile_images_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-images'
  and public.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists profile_images_update_own on storage.objects;
create policy profile_images_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-images'
  and public.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-images'
  and public.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists profile_images_delete_own on storage.objects;
create policy profile_images_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-images'
  and public.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.get_avatar_directory()
returns table(profile_id uuid, client_id uuid, av text, photo text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.client_id, p.av, p.photo
  from public.profiles p
  where public.is_active_user()
    and p.active is true
    and p.archived_at is null;
$$;

revoke all on function public.get_avatar_directory() from public, anon;
grant execute on function public.get_avatar_directory() to authenticated;

create or replace function public.claim_avatar_prompt()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
begin
  if v_uid is null or not public.is_active_user() then return false; end if;

  select * into v_profile
  from public.profiles p
  where p.id = v_uid
  for update;

  if not found
    or nullif(btrim(coalesce(v_profile.photo, '')), '') is not null
    or v_profile.avatar_prompt_count >= 2 then
    return false;
  end if;

  update public.profiles
  set avatar_prompt_count = avatar_prompt_count + 1,
      updated_at = now()
  where id = v_uid;
  return true;
end;
$$;

revoke all on function public.claim_avatar_prompt() from public, anon;
grant execute on function public.claim_avatar_prompt() to authenticated;

create or replace function public.set_my_avatar(p_photo_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prefix text := 'https://tsawxmlfvnvepzgcztfc.supabase.co/storage/v1/object/public/profile-images/';
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Sessao invalida';
  end if;
  if p_photo_url is null
    or char_length(p_photo_url) > 1000
    or p_photo_url not like (v_prefix || v_uid::text || '/%') then
    raise exception 'Imagem de perfil invalida';
  end if;

  update public.profiles
  set photo = p_photo_url,
      avatar_prompt_count = 2,
      updated_at = now()
  where id = v_uid;
end;
$$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

commit;
