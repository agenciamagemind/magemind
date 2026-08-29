create or replace function public.request_indique_ganhe_access()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Sessao invalida.';
  end if;

  select p.affiliate_status, p.role
    into v_status, v_role
  from public.profiles p
  where p.id = v_uid
    and p.active is true
    and p.archived_at is null
  for update;

  if not found then
    raise exception 'Conta inativa ou sem permissao.';
  end if;

  if v_role in ('ceo', 'manager') then
    raise exception 'CEO e Gerente acessam a administracao do Indique & Ganhe e nao podem solicitar participacao.';
  end if;

  if v_status in ('approved', 'pending') then
    return v_status;
  end if;

  perform set_config('app.allow_affiliate_status_change', 'on', true);
  update public.profiles
  set affiliate_status = 'pending',
      affiliate_requested_at = now(),
      affiliate_reviewed_at = null,
      affiliate_reviewed_by = null,
      updated_at = now()
  where id = v_uid;

  return 'pending';
end;
$function$;
