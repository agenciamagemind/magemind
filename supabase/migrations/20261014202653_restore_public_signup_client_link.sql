-- Restore the APP's pre-Tracking account lifecycle. Ordinary public signups
-- must have a client record, without creating sales, plans or commissions.
-- Resolve affected records from trusted Auth/profile data, never fixed IDs.
do $repair$
declare v_profile record; c public.clients%rowtype; matches integer;
begin
  for v_profile in
    select p.* from public.profiles p join auth.users u on u.id=p.id
    where p.role='client' and p.client_id is null and p.active is true
      and p.archived_at is null and u.email_confirmed_at is not null
      and lower(p.email)=lower(u.email)
      and coalesce(u.raw_app_meta_data->>'source','') not in ('internal','managed_client')
    for update of p
  loop
    if v_profile.phone is null or v_profile.phone !~ '^[0-9]{10,15}$' then
      raise exception 'Client repair requires a valid profile contact';
    end if;
    select count(*) into matches from public.clients where lower(email)=lower(v_profile.email);
    if matches>1 then raise exception 'Ambiguous client email during repair'; end if;
    if matches=1 then
      select * into strict c from public.clients where lower(email)=lower(v_profile.email) for update;
      if c.archived_at is not null or c.status='Inativo' or coalesce(c.converted_to_team,false)
        or exists(select 1 from public.profiles other where other.client_id=c.id and other.id<>v_profile.id) then
        raise exception 'Existing client cannot be safely linked';
      end if;
    else
      insert into public.clients(name,email,phone,status,created_at)
      values(v_profile.name,v_profile.email,v_profile.phone,'Ativo',v_profile.created_at) returning * into c;
    end if;
    update public.profiles set client_id=c.id where id=v_profile.id and client_id is null;
  end loop;
end $repair$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source text := new.raw_app_meta_data->>'source';
  v_role text := new.raw_app_meta_data->>'role';
  v_name text := coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  v_phone text := nullif(btrim(new.raw_user_meta_data->>'phone'), '');
  v_client_id uuid;
begin
  -- Internal accounts are created only by an Admin API call that can write
  -- raw_app_meta_data. Public sign-up cannot forge this branch.
  if v_source = 'internal' and v_role in ('manager', 'partner', 'gestor', 'editor', 'affiliate') then
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
$function$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.active is true and p.archived_at is null and (
      p.role <> 'client'
      or exists (
        select 1 from public.clients c
        where c.id=p.client_id and c.status <> 'Inativo' and c.archived_at is null
      )
    )
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active is true
    and p.archived_at is null
    and (
      p.role <> 'client'
      or exists (
        select 1 from public.clients c
        where c.id=p.client_id and c.status <> 'Inativo' and c.archived_at is null
      )
    );
$$;


revoke execute on function public.handle_new_user() from public,anon,authenticated;
grant execute on function public.handle_new_user() to service_role;
