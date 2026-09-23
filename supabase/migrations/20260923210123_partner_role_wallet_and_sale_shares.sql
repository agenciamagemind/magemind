-- Partner permissions. Client contacts and raw company sales remain inaccessible.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles drop constraint profiles_role_valid;
alter table public.profiles add constraint profiles_role_valid check(role in ('ceo','manager','partner','gestor','editor','affiliate','client'));
CREATE OR REPLACE FUNCTION public.notify_client(p_client_id uuid, p_icon text, p_icon_bg text, p_title text, p_body text, p_link_demand_id uuid, p_event_type text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target record; v_ids uuid[]='{}'; v_role text=public.current_user_role();
begin
 if v_role is null or v_role not in ('ceo','manager','partner','gestor','editor') then raise exception 'Sem permissão'; end if;
 if p_link_demand_id is not null and not exists(select 1 from public.demands d where d.id=p_link_demand_id
   and d.client_id=p_client_id and (v_role<>'editor' or d.assignee_id=auth.uid())) then raise exception 'Demanda fora do escopo'; end if;
 if v_role in ('partner','gestor','editor') and p_link_demand_id is null then raise exception 'Demanda obrigatória'; end if;
 for v_target in select p.id from public.profiles p join public.clients c on c.id=p.client_id
 where p.client_id=p_client_id and p.role='client' and p.active and p.archived_at is null
 and c.archived_at is null and c.status<>'Inativo' loop
   v_ids=array_append(v_ids,public.create_notification(v_target.id,null,p_icon,p_icon_bg,p_title,p_body,p_link_demand_id,p_event_type));
 end loop;
 return v_ids;
end; $function$;
CREATE OR REPLACE FUNCTION public.enforce_role_on_new_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.role not in ('ceo', 'manager', 'partner', 'gestor', 'editor', 'affiliate', 'client') then
    new.role := 'client';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
CREATE OR REPLACE FUNCTION public.is_operational_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select coalesce(public.current_user_role() in ('ceo','manager','partner','gestor','editor'), false); $function$;
CREATE OR REPLACE FUNCTION private.list_demand_clients()
 RETURNS TABLE(id uuid, name text, status text, converted_to_team boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select client.id, client.name, client.status, client.converted_to_team
  from public.clients client
  where client.archived_at is null
    and coalesce(client.converted_to_team, false) is false
    and not exists (
      select 1 from public.profiles profile
      where profile.role <> 'client'
        and profile.archived_at is null
        and (
          profile.client_id = client.id
          or (
            nullif(lower(btrim(coalesce(profile.email, ''))), '') is not null
            and lower(btrim(profile.email)) = lower(btrim(coalesce(client.email, '')))
          )
        )
    )
    and (
      public.current_user_role() in ('ceo', 'manager', 'partner', 'gestor', 'editor')
      or (public.is_client() and client.id = public.my_client_id())
    );
$function$;
CREATE OR REPLACE FUNCTION private.list_demand_team()
 RETURNS TABLE(id uuid, name text, role text, av text, photo text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.name, p.role, p.av, p.photo, p.active
  from public.profiles p
  where p.role in ('ceo', 'manager', 'partner', 'gestor', 'editor')
    and p.active is true
    and p.archived_at is null
    and (
      public.current_user_role() in ('ceo', 'manager', 'partner', 'gestor', 'editor')
      or (
        public.is_client()
        and exists (
          select 1 from public.demands d
          where d.client_id = public.my_client_id() and d.assignee_id = p.id
        )
      )
    );
$function$;
CREATE OR REPLACE FUNCTION public.protect_demand_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.assignee_id is distinct from old.assignee_id
     and public.current_user_role() not in ('ceo', 'manager', 'partner', 'gestor', 'editor') then
    raise exception 'Somente a equipe operacional pode alterar o responsável pela demanda.';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.protect_demand_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.client_id is distinct from old.client_id
     and public.current_user_role() not in ('ceo', 'manager', 'partner', 'gestor', 'editor') then
    raise exception 'Somente a equipe operacional pode alterar o cliente da demanda.';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.reorder_demands(p_status text, p_demand_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_requested integer := coalesce(cardinality(p_demand_ids), 0);
  v_existing integer;
begin
  if v_user_id is null then
    raise exception 'Sua sessao expirou. Entre novamente para ordenar as demandas.';
  end if;

  if p_status not in ('Não iniciado', 'Em andamento', 'Concluído') then
    raise exception 'A coluna informada nao existe no kanban.';
  end if;

  if v_requested = 0 then
    return;
  end if;

  if v_requested > 2000 then
    raise exception 'A coluna tem itens demais para ser ordenada de uma vez.';
  end if;

  if array_position(p_demand_ids, null) is not null
     or (select count(distinct demand_id) from unnest(p_demand_ids) demand_id) <> v_requested then
    raise exception 'A ordem enviada contem demandas invalidas ou repetidas.';
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    raise exception 'Seu acesso nao esta ativo para organizar demandas.';
  end if;

  -- Lock every requested card so two simultaneous drops cannot overwrite one
  -- another with a partially stale order.
  perform 1
  from public.demands demand
  where demand.id = any(p_demand_ids)
  order by demand.id
  for update;

  select count(*) into v_existing
  from public.demands demand
  where demand.id = any(p_demand_ids)
    and demand.status = p_status;

  if v_existing <> v_requested then
    raise exception 'Uma ou mais demandas mudaram de coluna. Atualize o kanban e tente novamente.';
  end if;

  if v_role in ('ceo', 'manager', 'partner', 'gestor') then
    null;
  elsif v_role = 'editor' then
    if exists (
      select 1
      from public.demands demand
      where demand.id = any(p_demand_ids)
        and demand.assignee_id is distinct from v_user_id
    ) then
      raise exception 'Editores podem ordenar somente as demandas sob sua responsabilidade.';
    end if;
  elsif v_role = 'client' then
    if not public.client_has_demand_management_plan()
       or exists (
         select 1
         from public.demands demand
         where demand.id = any(p_demand_ids)
           and demand.client_id is distinct from public.my_client_id()
       ) then
      raise exception 'Seu perfil nao tem permissao para organizar estas demandas.';
    end if;
  else
    raise exception 'Seu perfil nao tem permissao para organizar demandas.';
  end if;

  -- Reuse the positions already occupied by the visible cards. This preserves
  -- hidden cards when an Editor or a filtered view reorders only its subset.
  with requested as (
    select demand_id, position
    from unnest(p_demand_ids) with ordinality as item(demand_id, position)
  ), available_slots as (
    select
      demand.sort_order,
      row_number() over (
        order by demand.sort_order asc nulls last, demand.created_at desc nulls last, demand.id
      ) as position
    from public.demands demand
    where demand.id = any(p_demand_ids)
      and demand.status = p_status
  )
  update public.demands demand
  set sort_order = available_slots.sort_order,
      updated_at = now()
  from requested
  join available_slots using (position)
  where demand.id = requested.demand_id
    and demand.sort_order is distinct from available_slots.sort_order;
end;
$function$;
CREATE OR REPLACE FUNCTION public.can_manage_user(target_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_role text := public.current_user_role();
  target_role text;
  target_email text;
begin
  select role, email into target_role, target_email
  from public.profiles where id = target_user_id;

  if target_role is null
     or target_role = 'ceo'
     or lower(coalesce(target_email, '')) = lower('ogabrielmrossi@gmail.com') then
    return false;
  end if;

  if actor_role in ('ceo', 'manager') then
    return true;
  end if;

  return (actor_role = 'gestor' and target_role = 'editor') or (actor_role = 'partner' and target_role in ('gestor','editor'));
end;
$function$;
CREATE OR REPLACE FUNCTION public.guard_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if actor_role='partner' and old.role in ('gestor','editor') and new.role in ('gestor','editor')
     and new.email is not distinct from old.email and new.client_id is not distinct from old.client_id
     and new.commission_rate is not distinct from old.commission_rate
     and new.affiliate_status is not distinct from old.affiliate_status
     and new.affiliate_requested_at is not distinct from old.affiliate_requested_at
     and new.affiliate_reviewed_at is not distinct from old.affiliate_reviewed_at
     and new.affiliate_reviewed_by is not distinct from old.affiliate_reviewed_by then return new; end if;
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
$function$;
CREATE OR REPLACE FUNCTION public.admin_set_profile_active(p_target_id uuid, p_active boolean)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_profile public.profiles%rowtype;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('ceo','manager','partner') then raise exception 'Somente CEO ou Gerente podem alterar acessos.'; end if;
  if p_target_id=(select auth.uid()) then raise exception 'Voce nao pode alterar o proprio acesso.'; end if;
  if not public.can_manage_user(p_target_id) then raise exception 'Sem permissao para alterar este usuario.'; end if;
  select * into v_profile from public.profiles p where p.id=p_target_id for update;
  if not found or v_profile.archived_at is not null then raise exception 'Usuario nao encontrado ou arquivado.'; end if;
  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.profiles set active=p_active,updated_at=now() where id=p_target_id returning * into v_profile;
  return v_profile;
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id uuid, new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.current_user_role() is null or public.current_user_role() not in ('ceo', 'manager', 'partner') then
    raise exception 'Somente CEO ou Gerente podem alterar cargos.';
  end if;
  if new_role not in ('manager', 'partner', 'gestor', 'editor', 'affiliate', 'client') then
    raise exception 'Cargo inválido: %', new_role;
  end if;
  if not public.can_manage_user(target_user_id) then
    raise exception 'Você não tem permissão para alterar este usuário.';
  end if;

  if public.current_user_role()='partner' and new_role not in ('gestor','editor') then raise exception 'Cargo fora da sua hierarquia.'; end if;
  update public.profiles
  set role = new_role, updated_at = now()
  where id = target_user_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.create_notification(p_to_user_id uuid, p_to_role text, p_icon text, p_icon_bg text, p_title text, p_body text, p_link_demand_id uuid, p_event_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_role text=public.current_user_role();
begin
 if not public.is_active_user() then raise exception 'Inactive user'; end if;
 if (p_to_user_id is null)=(p_to_role is null) then raise exception 'Exactly one recipient is required'; end if;
 if p_to_role is not null and p_to_role<>'admin' then raise exception 'Invalid role recipient'; end if;
 if not public.is_operational_staff() and (p_to_user_id is not null or p_to_role<>'admin') then raise exception 'Clients can only notify the operational team'; end if;
 if p_link_demand_id is not null and not exists(select 1 from public.demands d where d.id=p_link_demand_id and
   (v_role in ('ceo','manager','partner','gestor') or (v_role='editor' and d.assignee_id=auth.uid()) or (v_role='client' and d.client_id=public.my_client_id()))) then raise exception 'Demanda fora do escopo'; end if;
 if v_role='editor' and p_link_demand_id is null then raise exception 'Demanda obrigatória'; end if;
 if p_to_user_id is not null and v_role in ('partner','gestor','editor') and not exists(select 1 from public.profiles p join public.demands d on d.id=p_link_demand_id
   where p.id=p_to_user_id and p.active and p.archived_at is null and (p.id=d.assignee_id or (p.role='client' and p.client_id=d.client_id))) then raise exception 'Destinatário fora do escopo'; end if;
 insert into public.notifications(to_user_id,to_role,icon,icon_bg,title,body,link_demand_id,event_type,read,created_by)
 values(p_to_user_id,p_to_role,p_icon,p_icon_bg,coalesce(nullif(btrim(p_title),''),'Magemind'),coalesce(p_body,''),p_link_demand_id,coalesce(nullif(p_event_type,''),'general'),false,auth.uid()) returning id into v_id;
 return v_id;
end; $function$;
CREATE OR REPLACE FUNCTION public.is_referral_participant()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id=(select auth.uid())
      and p.active is true
      and p.archived_at is null
      and p.affiliate_status='approved' and p.role <> 'partner'
  );
$function$;
CREATE OR REPLACE FUNCTION public.guard_client_referral_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.affiliate_id is not null and new.affiliate_id is distinct from old.affiliate_id
     and not exists (
       select 1 from public.profiles p where p.id=new.affiliate_id
       and p.affiliate_status='approved' and p.role<>'partner' and p.active is true and p.archived_at is null
     ) then
    raise exception 'Participante do Indique & Ganhe invalido ou inativo.';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.review_indique_ganhe_access(p_profile_id uuid, p_action text)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=(select auth.uid()); v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem analisar solicitacoes.'; end if;
  if p_action not in ('approve','reject') then raise exception 'Acao invalida.'; end if;
  select * into v_profile from public.profiles p where p.id=p_profile_id and p.active is true and p.archived_at is null for update;
  if not found then raise exception 'Perfil nao encontrado ou inativo.'; end if;
  if v_profile.role='partner' then raise exception 'Parceiros possuem carteira própria.'; end if;
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
$function$;
CREATE OR REPLACE FUNCTION public.request_indique_ganhe_access()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_role in ('ceo', 'manager', 'partner') then
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
alter policy comments_insert_related_demand on public.comments  with check (((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM demands d
  WHERE ((d.id = comments.demand_id) AND (is_staff_admin() OR (is_gestor() OR current_user_role()='partner') OR (is_editor() AND (d.assignee_id = ( SELECT auth.uid() AS uid))) OR (is_client() AND (d.client_id = my_client_id()))))))));
alter policy comments_select_related_demand on public.comments using ((EXISTS ( SELECT 1
   FROM demands d
  WHERE ((d.id = comments.demand_id) AND (is_staff_admin() OR (is_gestor() OR current_user_role()='partner') OR (is_editor() AND (d.assignee_id = ( SELECT auth.uid() AS uid))) OR (is_client() AND (d.client_id = my_client_id()))))))) ;
alter policy demands_delete_authorized on public.demands using ((is_staff_admin() OR (is_gestor() OR current_user_role()='partner') OR (client_has_demand_management_plan() AND (client_id = my_client_id())))) ;
alter policy demands_insert_authorized on public.demands  with check ((is_staff_admin() OR (is_gestor() OR current_user_role()='partner') OR (client_has_demand_management_plan() AND (client_id = my_client_id()) AND (created_by = ( SELECT auth.uid() AS uid)) AND (assignee_id IS NULL))));
alter policy demands_select_authorized on public.demands using ((is_staff_admin() OR (is_gestor() OR current_user_role()='partner') OR (is_editor() AND (assignee_id = ( SELECT auth.uid() AS uid))) OR (is_client() AND (client_id = my_client_id())))) ;
alter policy demands_update_authorized on public.demands using ((is_staff_admin() OR (is_gestor() OR current_user_role()='partner') OR (is_editor() AND (assignee_id = ( SELECT auth.uid() AS uid))) OR (client_has_demand_management_plan() AND (client_id = my_client_id())))) with check ((is_staff_admin() OR (is_gestor() OR current_user_role()='partner') OR (is_editor() AND (assignee_id = ( SELECT auth.uid() AS uid))) OR (client_has_demand_management_plan() AND (client_id = my_client_id()))));
alter policy profiles_select_authorized on public.profiles using (((id=auth.uid()) and is_active_user()) or is_staff_admin() or (is_gestor() and role='editor') or (current_user_role()='partner' and role in ('gestor','editor')));
alter policy notifications_select_recipient on public.notifications using (is_active_user() AND ((current_user_role()='partner' AND ((to_user_id=auth.uid() AND (left(event_type,8)='partner_' OR (link_demand_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.demands d WHERE d.id=link_demand_id AND d.assignee_id=auth.uid())))) OR (to_role='admin' AND link_demand_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.demands d WHERE d.id=link_demand_id AND d.assignee_id=auth.uid())))) OR (current_user_role()<>'partner' AND (is_active_user() AND ((is_editor() AND (link_demand_id IS NOT NULL) AND ((to_user_id = ( SELECT auth.uid() AS uid)) OR (to_role = 'admin'::text)) AND (EXISTS ( SELECT 1
   FROM demands demand
  WHERE ((demand.id = notifications.link_demand_id) AND (demand.assignee_id = ( SELECT auth.uid() AS uid)))))) OR ((NOT is_editor()) AND ((to_user_id = ( SELECT auth.uid() AS uid)) OR ((to_role = 'admin'::text) AND is_operational_staff())))))))) ;
alter policy notifications_update_recipient on public.notifications using (is_active_user() AND ((current_user_role()='partner' AND ((to_user_id=auth.uid() AND (left(event_type,8)='partner_' OR (link_demand_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.demands d WHERE d.id=link_demand_id AND d.assignee_id=auth.uid())))) OR (to_role='admin' AND link_demand_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.demands d WHERE d.id=link_demand_id AND d.assignee_id=auth.uid())))) OR (current_user_role()<>'partner' AND (is_active_user() AND ((is_editor() AND (link_demand_id IS NOT NULL) AND ((to_user_id = ( SELECT auth.uid() AS uid)) OR (to_role = 'admin'::text)) AND (EXISTS ( SELECT 1
   FROM demands demand
  WHERE ((demand.id = notifications.link_demand_id) AND (demand.assignee_id = ( SELECT auth.uid() AS uid)))))) OR ((NOT is_editor()) AND ((to_user_id = ( SELECT auth.uid() AS uid)) OR ((to_role = 'admin'::text) AND is_operational_staff())))))))) with check (is_active_user() AND ((current_user_role()='partner' AND ((to_user_id=auth.uid() AND (left(event_type,8)='partner_' OR (link_demand_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.demands d WHERE d.id=link_demand_id AND d.assignee_id=auth.uid())))) OR (to_role='admin' AND link_demand_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.demands d WHERE d.id=link_demand_id AND d.assignee_id=auth.uid())))) OR (current_user_role()<>'partner' AND (is_active_user() AND ((is_editor() AND (link_demand_id IS NOT NULL) AND ((to_user_id = ( SELECT auth.uid() AS uid)) OR (to_role = 'admin'::text)) AND (EXISTS ( SELECT 1
   FROM demands demand
  WHERE ((demand.id = notifications.link_demand_id) AND (demand.assignee_id = ( SELECT auth.uid() AS uid)))))) OR ((NOT is_editor()) AND ((to_user_id = ( SELECT auth.uid() AS uid)) OR ((to_role = 'admin'::text) AND is_operational_staff()))))))));
CREATE OR REPLACE FUNCTION public.protect_sale_financial_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.affiliate_commissions c where c.sale_id=OLD.id) or exists(select 1 from public.partner_sale_shares s where s.sale_id=OLD.id) then
    raise exception 'Venda com historico de comissao nao pode ser excluida. Altere o status para Cancelado.';
  end if;
  return OLD;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_archive_affiliate(p_affiliate_id uuid)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() and coalesce(public.current_user_role(),'')<>'partner' then raise exception 'Somente CEO ou Gerente podem arquivar participantes.'; end if;
  if not public.can_manage_user(p_affiliate_id) then raise exception 'Sem permissao para arquivar este usuario.'; end if;
  select * into v_profile from public.profiles p where p.id=p_affiliate_id and p.archived_at is null for update;
  if not found then raise exception 'Participante nao encontrado.'; end if;
  if not exists(select 1 from public.affiliate_commissions c where c.affiliate_id=p_affiliate_id)
     and not exists(select 1 from public.affiliate_withdrawals w where w.affiliate_id=p_affiliate_id)
     and v_profile.role<>'partner' then
    raise exception 'Este perfil nao possui historico financeiro para arquivamento especial.';
  end if;
  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.clients set affiliate_id=null where affiliate_id=p_affiliate_id;
  update public.profiles set active=false,archived_at=now(),updated_at=now() where id=p_affiliate_id returning * into v_profile;
  return v_profile;
end;
$function$;
-- Included in the versioned migration by the build script.
create table public.partner_defaults (
 partner_id uuid primary key references public.profiles(id) on delete cascade,
 rate numeric(5,2) not null default 50 check(rate>0 and rate<=100),
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.partner_sale_shares (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references public.sales(id) on delete restrict,
 partner_id uuid not null references public.profiles(id) on delete restrict,
 partner_name text not null,
 rate numeric(5,2) not null check(rate>0 and rate<=100),
 included boolean not null default true,
 base_value numeric(12,2) not null,
 amount numeric(12,2) not null check(amount>=0),
 state text not null check(state in ('pending','available','cancelled')),
 sale_label text not null,
 client_label text not null,
 sale_date date,
 demand_id uuid references public.demands(id) on delete set null,
 updated_at timestamptz not null default now(),
 unique(sale_id,partner_id)
);
create index partner_shares_wallet_idx on public.partner_sale_shares(partner_id,state);
create index partner_shares_demand_idx on public.partner_sale_shares(demand_id) where demand_id is not null;
create table public.partner_withdrawals (
 id uuid primary key default gen_random_uuid(),
 partner_id uuid not null references public.profiles(id) on delete restrict,
 partner_name text not null,
 amount numeric(12,2) not null check(amount>=1 and amount::text not in ('NaN','Infinity','-Infinity')),
 pix_key_type text not null check(pix_key_type in ('cpf','cnpj','email','phone','random')),
 pix_key text not null check(length(pix_key) between 3 and 140),
 status text not null default 'pending' check(status in ('pending','approved','paid','rejected','cancelled','reversed')),
 request_key uuid not null unique,
 requested_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id) on delete set null,
 note text not null default '' check(length(note)<=500)
);
create index partner_withdrawals_wallet_idx on public.partner_withdrawals(partner_id,status);
create index partner_withdrawals_reviewer_idx on public.partner_withdrawals(reviewed_by) where reviewed_by is not null;
create table public.partner_financial_events (
 id bigint generated always as identity primary key,
 partner_id uuid not null references public.profiles(id) on delete restrict,
 actor_id uuid references public.profiles(id) on delete set null,
 event_type text not null,
 details jsonb not null,
 created_at timestamptz not null default now()
);
create index partner_events_partner_idx on public.partner_financial_events(partner_id,created_at desc);
create index partner_events_actor_idx on public.partner_financial_events(actor_id) where actor_id is not null;
alter table public.partner_defaults enable row level security;
alter table public.partner_sale_shares enable row level security;
alter table public.partner_withdrawals enable row level security;
alter table public.partner_financial_events enable row level security;
revoke all on public.partner_defaults,public.partner_sale_shares,public.partner_withdrawals,public.partner_financial_events from public,anon,authenticated;
grant select on public.partner_defaults,public.partner_sale_shares,public.partner_withdrawals,public.partner_financial_events to authenticated;
grant all on public.partner_defaults,public.partner_sale_shares,public.partner_withdrawals,public.partner_financial_events to service_role;
grant usage,select on sequence public.partner_financial_events_id_seq to service_role;
create policy partner_defaults_read on public.partner_defaults for select to authenticated using(is_staff_admin() or (current_user_role()='partner' and partner_id=auth.uid()));
create policy partner_shares_read on public.partner_sale_shares for select to authenticated using(is_staff_admin() or (current_user_role()='partner' and partner_id=auth.uid()));
create policy partner_withdrawals_read on public.partner_withdrawals for select to authenticated using(is_staff_admin() or (current_user_role()='partner' and partner_id=auth.uid()));
create policy partner_events_read on public.partner_financial_events for select to authenticated using(is_staff_admin() or (current_user_role()='partner' and partner_id=auth.uid()));

create function private.partner_balance(p_id uuid) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select sum(amount) from public.partner_sale_shares where partner_id=p_id and state='available'),0)
 - coalesce((select sum(amount) from public.partner_withdrawals where partner_id=p_id and status in ('pending','approved','paid')),0);
$$;
create function private.initialize_partner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='partner' then
  perform pg_advisory_xact_lock(829174001);
  insert into public.partner_defaults(partner_id,enabled) values(new.id,not exists(select 1 from public.partner_defaults d join public.profiles p on p.id=d.partner_id where d.enabled and p.role='partner' and p.active and p.archived_at is null)) on conflict do nothing;
 end if;
 return new;
end;$$;
create trigger initialize_partner after insert or update of role on public.profiles for each row execute function private.initialize_partner();
create function private.guard_partner_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='partner' and old.role<>'partner' and (exists(select 1 from public.affiliate_commissions where affiliate_id=old.id) or exists(select 1 from public.affiliate_withdrawals where affiliate_id=old.id) or exists(select 1 from public.clients where affiliate_id=old.id)) then
  raise exception 'Este perfil possui indicações ou histórico de indicação. Crie um acesso separado para a parceria para preservar os vínculos e a carteira existentes.';
 end if;
 if old.role='partner' and new.role<>'partner' and exists(select 1 from public.partner_sale_shares where partner_id=old.id) then
  raise exception 'Parceiro com histórico financeiro não pode mudar de cargo. Desative o acesso para preservar a carteira.';
 end if;
 return new;
end;$$;
create trigger guard_partner_history before update of role on public.profiles for each row execute function private.guard_partner_history();

create function private.set_partner_default(p_id uuid,p_rate numeric,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_staff_admin() then raise exception 'Somente CEO e Gerente configuram participações.';end if;
 if p_rate is null or p_rate<=0 or p_rate>100 or p_rate<>round(p_rate,2) or p_rate::text in ('NaN','Infinity','-Infinity') then raise exception 'Percentual inválido.';end if;
 perform pg_advisory_xact_lock(829174001);
 if not exists(select 1 from public.profiles where id=p_id and role='partner' and archived_at is null) then raise exception 'Parceiro não encontrado.';end if;
 if p_enabled and p_rate+coalesce((select sum(d.rate) from public.partner_defaults d join public.profiles p on p.id=d.partner_id where d.enabled and d.partner_id<>p_id and p.active and p.archived_at is null and p.role='partner'),0)>100 then raise exception 'Os percentuais padrão não podem ultrapassar 100%%.';end if;
 insert into public.partner_defaults(partner_id,rate,enabled) values(p_id,p_rate,p_enabled) on conflict(partner_id) do update set rate=excluded.rate,enabled=excluded.enabled,updated_at=now();
end;$$;

create function private.partner_sale_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare splits jsonb; item jsonb; pid uuid; pct numeric; total numeric:=0; referral numeric:=0; share public.partner_sale_shares%rowtype; desired numeric; desired_state text; label text; pname text; seen uuid[]:='{}';
begin
 perform pg_advisory_xact_lock(829174001);
 splits:=nullif(current_setting('app.partner_sale_splits',true),'')::jsonb;
 if new.status='Gasto' then splits:='[]'::jsonb;
 elsif splits is null and tg_op='INSERT' then
  select coalesce(jsonb_agg(jsonb_build_object('partner_id',d.partner_id,'rate',d.rate)),'[]') into splits from public.partner_defaults d join public.profiles p on p.id=d.partner_id where d.enabled and p.role='partner' and p.active and p.archived_at is null;
 elsif splits is null then
  select coalesce(jsonb_agg(jsonb_build_object('partner_id',s.partner_id,'rate',s.rate)),'[]') into splits from public.partner_sale_shares s where s.sale_id=new.id and s.included;
 end if;
 if jsonb_typeof(splits)<>'array' or jsonb_array_length(splits)>20 then raise exception 'Lista de parceiros inválida.';end if;
 select coalesce(c.name,'Cliente') into label from public.clients c where c.id=new.client_id;
 for item in select * from jsonb_array_elements(splits) loop
  pid:=(item->>'partner_id')::uuid;pct:=(item->>'rate')::numeric;
  if pid is null or pid=any(seen) or pct is null or pct<=0 or pct>100 or pct<>round(pct,2) or pct::text in ('NaN','Infinity','-Infinity') then raise exception 'Parceiro repetido ou percentual inválido.';end if;
  select name into pname from public.profiles where id=pid and role='partner' and ((active and archived_at is null) or exists(select 1 from public.partner_sale_shares s where s.sale_id=new.id and s.partner_id=pid and s.included and s.rate=pct));
  if not found then raise exception 'Selecione um parceiro ativo.';end if;
  seen:=array_append(seen,pid); total:=total+pct;
 end loop;
 select commission_rate into referral from public.affiliate_commissions where sale_id=new.id and status in ('aprovada','paga');
 if referral is null then select p.commission_rate into referral from public.clients c join public.profiles p on p.id=c.affiliate_id where c.id=new.client_id and p.affiliate_status='approved' and p.active and p.archived_at is null;end if;
 if total+coalesce(referral,0)>100 then raise exception 'Parceiros e indicação somam mais de 100%%. Ajuste os percentuais desta venda.';end if;
 -- Rounded currency allocations must also fit the sale value.
 if coalesce((select sum(round(new.value*(x->>'rate')::numeric/100,2)) from jsonb_array_elements(splits) x),0)+round(new.value*coalesce(referral,0)/100,2)>new.value then raise exception 'A divisão excede o valor da venda após arredondamento.';end if;
 for share in select * from public.partner_sale_shares where sale_id=new.id order by partner_id loop
  select (x->>'rate')::numeric into pct from jsonb_array_elements(splits) x where (x->>'partner_id')::uuid=share.partner_id;
  desired:=case when pct is null then 0 else round(new.value*pct/100,2) end;
  desired_state:=case when pct is null or new.status in ('Cancelado','Gasto') then 'cancelled' when new.status='Fechado' then 'available' else 'pending' end;
  if share.state='available' and private.partner_balance(share.partner_id)-share.amount+(case when desired_state='available' then desired else 0 end)<0 then raise exception 'Participação já reservada ou paga. Cancele ou estorne o saque antes de reduzir esta venda.';end if;
  update public.partner_sale_shares set rate=coalesce(pct,rate),included=pct is not null,base_value=new.value,amount=desired,state=desired_state,sale_label=coalesce(new.service,'Venda'),client_label=coalesce(label,'Cliente'),sale_date=new.sale_date,demand_id=new.demand_id,updated_at=now() where id=share.id;
 end loop;
 for item in select * from jsonb_array_elements(splits) loop
  pid:=(item->>'partner_id')::uuid;pct:=(item->>'rate')::numeric;
  insert into public.partner_sale_shares(sale_id,partner_id,partner_name,rate,base_value,amount,state,sale_label,client_label,sale_date,demand_id)
  select new.id,pid,p.name,pct,new.value,round(new.value*pct/100,2),case when new.status='Fechado' then 'available' when new.status='Cancelado' then 'cancelled' else 'pending' end,coalesce(new.service,'Venda'),coalesce(label,'Cliente'),new.sale_date,new.demand_id from public.profiles p where p.id=pid
  on conflict(sale_id,partner_id) do nothing;
 end loop;
 return new;
end;$$;
create trigger z_partner_sale_sync after insert or update on public.sales for each row execute function private.partner_sale_sync();

create function private.partner_share_event() returns trigger language plpgsql security definer set search_path='' as $$
declare heading text; body text;
begin
 if tg_op='UPDATE' and row(new.amount,new.state,new.rate,new.included) is not distinct from row(old.amount,old.state,old.rate,old.included) then return new;end if;
 heading:=case when new.state='cancelled' then 'Participação cancelada' when new.state='available' then 'Saldo liberado para você' else 'Nova venda vinculada' end;
 body:=case when new.state='cancelled' then 'A participação desta venda foi cancelada. Consulte seu histórico no Financeiro.' else 'Sua parte: R$ '||replace(to_char(new.amount,'FM999999990.00'),'.',',')||' ('||new.rate||'%). '||case when new.state='available' then 'O valor já está disponível na carteira.' else 'O saldo será liberado quando a venda for fechada.' end end;
 insert into public.notifications(to_user_id,icon,icon_bg,title,body,event_type,created_by) values(new.partner_id,'💰','var(--emeraldbg)',heading,body,'partner_sale_updated',auth.uid());
 insert into public.partner_financial_events(partner_id,actor_id,event_type,details) values(new.partner_id,auth.uid(),'sale_share',jsonb_build_object('sale_id',new.sale_id,'amount',new.amount,'rate',new.rate,'state',new.state,'included',new.included));
 return new;
end;$$;
create trigger partner_share_event after insert or update on public.partner_sale_shares for each row execute function private.partner_share_event();

create function private.save_sale_with_partners(p_id uuid,p_sale jsonb,p_partners jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.sales%rowtype;
begin
 if not public.is_staff_admin() then raise exception 'Sem permissão para cadastrar ou editar vendas.';end if;
 if p_partners is null or jsonb_typeof(p_partners)<>'array' then raise exception 'Informe as participações da venda.';end if;
 perform set_config('app.partner_sale_splits',p_partners::text,true);
 if p_id is null then
  insert into public.sales(client_id,plan_id,demand_id,service,value,description,assignee,status,sale_date)
  values((p_sale->>'client_id')::uuid,nullif(p_sale->>'plan_id','')::uuid,nullif(p_sale->>'demand_id','')::uuid,p_sale->>'service',(p_sale->>'value')::numeric,p_sale->>'description',p_sale->>'assignee',p_sale->>'status',(p_sale->>'sale_date')::date) returning * into result;
 else
  update public.sales set client_id=(p_sale->>'client_id')::uuid,plan_id=nullif(p_sale->>'plan_id','')::uuid,demand_id=nullif(p_sale->>'demand_id','')::uuid,service=p_sale->>'service',value=(p_sale->>'value')::numeric,description=p_sale->>'description',assignee=p_sale->>'assignee',status=p_sale->>'status',sale_date=(p_sale->>'sale_date')::date where id=p_id returning * into result;
  if not found then raise exception 'Venda não encontrada. Atualize a lista.';end if;
 end if;
 perform set_config('app.partner_sale_splits','',true);
 return to_jsonb(result)||jsonb_build_object('clients',(select jsonb_build_object('name',name) from public.clients where id=result.client_id),'plans',(select jsonb_build_object('name',name) from public.plans where id=result.plan_id));
end;$$;

create function private.get_partner_wallet(p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,auth.uid());r text:=public.current_user_role();
begin
 if r is null or not (public.is_staff_admin() or (r='partner' and target=auth.uid())) then raise exception 'Carteira fora do seu acesso.';end if;
 if not exists(select 1 from public.profiles where id=target and role='partner') then raise exception 'Parceiro não encontrado.';end if;
 return jsonb_build_object('partner_id',target,'available',private.partner_balance(target),
 'earned',coalesce((select sum(amount) from public.partner_sale_shares where partner_id=target and state='available'),0),
 'pending',coalesce((select sum(amount) from public.partner_sale_shares where partner_id=target and state='pending'),0),
 'reserved',coalesce((select sum(amount) from public.partner_withdrawals where partner_id=target and status in ('pending','approved')),0),
 'paid',coalesce((select sum(amount) from public.partner_withdrawals where partner_id=target and status='paid'),0));
end;$$;

create function private.request_partner_withdrawal(p_amount numeric,p_type text,p_key text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); w public.partner_withdrawals%rowtype;key text:=btrim(p_key);digits text:=regexp_replace(p_key,'[^0-9]','','g');pname text;
begin
 if public.current_user_role() is distinct from 'partner' then raise exception 'Somente parceiros ativos podem solicitar saques.';end if;
 perform pg_advisory_xact_lock(829174001);
 select * into w from public.partner_withdrawals where request_key=p_request;
 if found then if w.partner_id<>uid then raise exception 'Identificador inválido.';end if;return to_jsonb(w);end if;
 if p_request is null or p_amount is null or p_amount<1 or p_amount<>round(p_amount,2) or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Valor inválido. Mínimo de R$ 1,00.';end if;
 if p_type is null or p_type not in ('cpf','cnpj','email','phone','random') or key is null or length(key)<3 or length(key)>140
 or (p_type='cpf' and length(digits)<>11) or (p_type='cnpj' and length(digits)<>14) or (p_type='phone' and length(digits) not between 10 and 13)
 or (p_type='email' and key !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
 or (p_type='random' and key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Chave Pix inválida.';end if;
 if p_type in ('cpf','cnpj','phone') then key:=digits;end if;
 if p_type='email' then key:=lower(key);end if;
 if p_amount>private.partner_balance(uid) then raise exception 'Saldo insuficiente ou já reservado para outro saque.';end if;
 select name into pname from public.profiles where id=uid;
 insert into public.partner_withdrawals(partner_id,partner_name,amount,pix_key_type,pix_key,request_key) values(uid,pname,p_amount,p_type,key,p_request) returning * into w;
 return to_jsonb(w);
end;$$;

create function private.review_partner_withdrawal(p_id uuid,p_action text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.partner_withdrawals%rowtype; next_status text;
begin
 if public.current_user_role() is null then raise exception 'Sessão inválida.';end if;
 perform pg_advisory_xact_lock(829174001);
 select * into w from public.partner_withdrawals where id=p_id for update;
 if not found then raise exception 'Saque não encontrado.';end if;
 if p_action='cancel' then
  if not(public.is_staff_admin() or (public.current_user_role()='partner' and w.partner_id=auth.uid())) or w.status<>'pending' then raise exception 'Somente solicitações pendentes podem ser canceladas.';end if;
  next_status:='cancelled';
 else
  if not public.is_staff_admin() then raise exception 'Somente CEO e Gerente analisam saques.';end if;
  next_status:=case when p_action='approve' and w.status='pending' then 'approved' when p_action='pay' and w.status='approved' then 'paid' when p_action='reject' and w.status in ('pending','approved') then 'rejected' when p_action='reverse' and w.status='paid' then 'reversed' else null end;
  if next_status is null then raise exception 'O saque mudou de situação. Atualize a lista.';end if;
  if p_action in ('reject','reverse') and length(btrim(coalesce(p_note,'')))<3 then raise exception 'Informe o motivo.';end if;
 end if;
 update public.partner_withdrawals set status=next_status,note=left(coalesce(p_note,''),500),reviewed_by=auth.uid(),updated_at=now() where id=p_id returning * into w;
 return to_jsonb(w);
end;$$;

create function private.partner_withdrawal_event() returns trigger language plpgsql security definer set search_path='' as $$
declare heading text;
begin
 heading:=case new.status when 'pending' then 'Saque solicitado' when 'approved' then 'Saque aprovado' when 'paid' then 'Pagamento registrado' when 'rejected' then 'Saque não aprovado' when 'cancelled' then 'Saque cancelado' else 'Pagamento estornado' end;
 insert into public.partner_financial_events(partner_id,actor_id,event_type,details) values(new.partner_id,auth.uid(),'withdrawal_'||new.status,jsonb_build_object('withdrawal_id',new.id,'amount',new.amount,'note',new.note));
 insert into public.notifications(to_user_id,icon,icon_bg,title,body,event_type,created_by)
 values(new.partner_id,'💳','var(--violetbg)',heading,'R$ '||replace(to_char(new.amount,'FM999999990.00'),'.',',')||'. Acompanhe os detalhes no seu Financeiro.','partner_withdrawal_'||new.status,auth.uid());
 if new.status='pending' then
  insert into public.notifications(to_user_id,icon,icon_bg,title,body,event_type,created_by)
  select id,'💳','var(--violetbg)','Saque de parceiro solicitado',left(new.partner_name,100)||' solicitou R$ '||replace(to_char(new.amount,'FM999999990.00'),'.',',')||'. Revise em Parceiros.','partner_withdrawal_requested',auth.uid() from public.profiles where role in ('ceo','manager') and active and archived_at is null;
 end if;
 return new;
end;$$;
create trigger partner_withdrawal_event after insert or update of status on public.partner_withdrawals for each row execute function private.partner_withdrawal_event();

-- Public invoker façades; privileged implementation checks the actor itself.
create function public.set_partner_default(p_id uuid,p_rate numeric,p_enabled boolean) returns void language sql set search_path='' as $$select private.set_partner_default(p_id,p_rate,p_enabled)$$;
create function public.save_sale_with_partners(p_id uuid,p_sale jsonb,p_partners jsonb) returns jsonb language sql set search_path='' as $$select private.save_sale_with_partners(p_id,p_sale,p_partners)$$;
create function public.get_partner_wallet(p_id uuid default null) returns jsonb language sql stable set search_path='' as $$select private.get_partner_wallet(p_id)$$;
create function public.request_partner_withdrawal(p_amount numeric,p_type text,p_key text,p_request uuid) returns jsonb language sql set search_path='' as $$select private.request_partner_withdrawal(p_amount,p_type,p_key,p_request)$$;
create function public.review_partner_withdrawal(p_id uuid,p_action text,p_note text default '') returns jsonb language sql set search_path='' as $$select private.review_partner_withdrawal(p_id,p_action,p_note)$$;
revoke all on function private.partner_balance(uuid),private.initialize_partner(),private.guard_partner_history(),private.partner_sale_sync(),private.partner_share_event(),private.partner_withdrawal_event() from public,anon,authenticated;
revoke all on function private.set_partner_default(uuid,numeric,boolean),private.save_sale_with_partners(uuid,jsonb,jsonb),private.get_partner_wallet(uuid),private.request_partner_withdrawal(numeric,text,text,uuid),private.review_partner_withdrawal(uuid,text,text) from public,anon;
revoke all on function public.set_partner_default(uuid,numeric,boolean),public.save_sale_with_partners(uuid,jsonb,jsonb),public.get_partner_wallet(uuid),public.request_partner_withdrawal(numeric,text,text,uuid),public.review_partner_withdrawal(uuid,text,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.set_partner_default(uuid,numeric,boolean),private.save_sale_with_partners(uuid,jsonb,jsonb),private.get_partner_wallet(uuid),private.request_partner_withdrawal(numeric,text,text,uuid),private.review_partner_withdrawal(uuid,text,text) to authenticated;
grant execute on function public.set_partner_default(uuid,numeric,boolean),public.save_sale_with_partners(uuid,jsonb,jsonb),public.get_partner_wallet(uuid),public.request_partner_withdrawal(numeric,text,text,uuid),public.review_partner_withdrawal(uuid,text,text) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.partner_sale_shares,public.partner_withdrawals,public.partner_defaults;
 end if;
end;$$;
