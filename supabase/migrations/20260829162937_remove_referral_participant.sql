create or replace function public.admin_remove_referral_participant(p_profile_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
begin
  if v_uid is null or not public.is_staff_admin() then
    raise exception 'Somente CEO ou Gerente podem remover participantes.';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = p_profile_id
    and p.active is true
    and p.archived_at is null
  for update;

  if not found then
    raise exception 'Participante nao encontrado ou conta inativa.';
  end if;

  if v_profile.role in ('ceo', 'manager') then
    raise exception 'Perfis administrativos nao podem participar do Indique & Ganhe.';
  end if;

  if v_profile.affiliate_status <> 'approved' then
    raise exception 'Este perfil nao e um participante ativo do programa.';
  end if;

  update public.clients
  set affiliate_id = null,
      updated_at = now()
  where affiliate_id = p_profile_id;

  perform set_config('app.allow_affiliate_status_change', 'on', true);
  update public.profiles
  set affiliate_status = 'locked',
      affiliate_requested_at = null,
      affiliate_reviewed_at = now(),
      affiliate_reviewed_by = v_uid,
      commission_rate = 0,
      updated_at = now()
  where id = p_profile_id
  returning * into v_profile;

  return v_profile;
end;
$function$;

revoke all on function public.admin_remove_referral_participant(uuid) from public, anon;
grant execute on function public.admin_remove_referral_participant(uuid) to authenticated;
