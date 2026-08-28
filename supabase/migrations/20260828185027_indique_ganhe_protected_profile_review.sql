-- Allow the audited Indique & Ganhe RPCs to update even a protected CEO
-- profile, while keeping every other privileged field immutable.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid()); actor_role text;
  privileged_lifecycle_change boolean:=coalesce(current_setting('app.allow_profile_lifecycle_change',true),'')='on';
  privileged_referral_change boolean:=coalesce(current_setting('app.allow_affiliate_status_change',true),'')='on';
begin
  if actor_id is null then return new; end if;
  select p.role into actor_role from public.profiles p
  where p.id=actor_id and p.active is true and p.archived_at is null;
  if actor_role is null then raise exception 'Conta inativa ou sem permissao.'; end if;

  if (new.active is distinct from old.active or new.archived_at is distinct from old.archived_at)
     and not privileged_lifecycle_change then
    raise exception 'Ativacao e arquivamento exigem a operacao administrativa segura.';
  end if;

  if privileged_referral_change
     and new.role is not distinct from old.role
     and new.email is not distinct from old.email
     and new.client_id is not distinct from old.client_id
     and new.active is not distinct from old.active
     and new.archived_at is not distinct from old.archived_at then
    return new;
  end if;

  if actor_id=old.id then
    if new.role is distinct from old.role or new.email is distinct from old.email
       or new.client_id is distinct from old.client_id or new.active is distinct from old.active
       or new.archived_at is distinct from old.archived_at or new.commission_rate is distinct from old.commission_rate
       or new.affiliate_status is distinct from old.affiliate_status
       or new.affiliate_requested_at is distinct from old.affiliate_requested_at
       or new.affiliate_reviewed_at is distinct from old.affiliate_reviewed_at
       or new.affiliate_reviewed_by is distinct from old.affiliate_reviewed_by then
      raise exception 'Campos privilegiados do proprio perfil nao podem ser alterados.';
    end if;
    return new;
  end if;

  if old.role='ceo' or new.role='ceo' or lower(coalesce(old.email,''))=lower('ogabrielmrossi@gmail.com') then
    raise exception 'O perfil do CEO e protegido.';
  end if;
  if actor_role in ('ceo','manager') then return new; end if;
  if actor_role='gestor' and old.role='editor' and new.role='editor'
     and new.email is not distinct from old.email and new.client_id is not distinct from old.client_id
     and new.active is not distinct from old.active and new.archived_at is not distinct from old.archived_at
     and new.commission_rate is not distinct from old.commission_rate
     and new.affiliate_status is not distinct from old.affiliate_status
     and new.affiliate_requested_at is not distinct from old.affiliate_requested_at
     and new.affiliate_reviewed_at is not distinct from old.affiliate_reviewed_at
     and new.affiliate_reviewed_by is not distinct from old.affiliate_reviewed_by then return new;
  end if;
  raise exception 'Voce nao tem permissao para alterar este perfil.';
end;
$$;

create or replace function public.review_indique_ganhe_access(p_profile_id uuid,p_action text)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=(select auth.uid()); v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem analisar solicitacoes.'; end if;
  if p_action not in ('approve','reject') then raise exception 'Acao invalida.'; end if;
  select * into v_profile from public.profiles p where p.id=p_profile_id and p.active is true and p.archived_at is null for update;
  if not found then raise exception 'Perfil nao encontrado ou inativo.'; end if;
  if v_profile.affiliate_status<>'pending' then raise exception 'Esta solicitacao nao esta mais em analise.'; end if;
  perform set_config('app.allow_affiliate_status_change','on',true);
  update public.profiles set
    affiliate_status=case when p_action='approve' then 'approved' else 'rejected' end,
    affiliate_reviewed_at=now(),affiliate_reviewed_by=v_uid,
    commission_rate=case when p_action='approve' and commission_rate=0 then 10 else commission_rate end,
    updated_at=now()
  where id=p_profile_id returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.admin_update_affiliate_commission(p_affiliate_id uuid,p_rate numeric)
returns numeric language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem alterar comissoes.'; end if;
  if p_rate is null or p_rate<0 or p_rate>100 or p_rate::text in ('NaN','Infinity','-Infinity') then raise exception 'A comissao deve estar entre 0 e 100.'; end if;
  perform 1 from public.profiles p where p.id=p_affiliate_id and p.affiliate_status='approved' and p.active is true and p.archived_at is null for update;
  if not found then raise exception 'Participante nao encontrado ou inativo.'; end if;
  perform set_config('app.allow_affiliate_status_change','on',true);
  update public.profiles set commission_rate=p_rate,updated_at=now() where id=p_affiliate_id;
  return p_rate;
end;
$$;

revoke all on function public.review_indique_ganhe_access(uuid,text) from public,anon;
revoke all on function public.admin_update_affiliate_commission(uuid,numeric) from public,anon;
grant execute on function public.review_indique_ganhe_access(uuid,text) to authenticated;
grant execute on function public.admin_update_affiliate_commission(uuid,numeric) to authenticated;
