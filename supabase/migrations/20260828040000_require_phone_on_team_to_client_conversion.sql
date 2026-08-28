-- Converting an internal profile to a client must produce a complete client
-- record, including the WhatsApp used by the Clients table action.

create or replace function public.admin_convert_team_to_client(p_user_id uuid, p_phone text)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_client public.clients%rowtype;
  v_phone text := btrim(coalesce(p_phone, ''));
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem converter cadastros.'; end if;
  if not public.can_manage_user(p_user_id) then raise exception 'Sem permissao para converter este usuario.'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) not between 10 and 15 then
    raise exception 'WhatsApp invalido.';
  end if;

  select * into v_profile
  from public.profiles profile
  where profile.id = p_user_id and profile.archived_at is null
  for update;
  if not found then raise exception 'Usuario nao encontrado.'; end if;

  select * into v_client
  from public.clients client
  where lower(client.email) = lower(coalesce(v_profile.email, ''))
    and client.archived_at is null
  for update;

  if found then
    update public.clients
    set name = v_profile.name,
        email = coalesce(v_profile.email, ''),
        phone = v_phone,
        converted_to_team = false,
        status = 'Ativo'
    where id = v_client.id
    returning * into v_client;
  else
    insert into public.clients(name, email, phone, status, converted_to_team)
    values(v_profile.name, coalesce(v_profile.email, ''), v_phone, 'Ativo', false)
    returning * into v_client;
  end if;

  update public.profiles
  set role = 'client',
      client_id = v_client.id,
      phone = v_phone,
      active = true,
      updated_at = now()
  where id = p_user_id;

  return v_client;
end;
$$;

revoke all on function public.admin_convert_team_to_client(uuid, text) from public, anon;
grant execute on function public.admin_convert_team_to_client(uuid, text) to authenticated;
