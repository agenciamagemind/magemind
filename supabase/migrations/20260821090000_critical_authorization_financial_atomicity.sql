-- MM-001, MM-002 e MM-003
-- Autorizacao ativa centralizada, invariantes financeiras e operacoes
-- administrativas atomicas. Esta migracao preserva todo o historico existente.

alter table public.clients
  add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_commission_rate_range'
  ) then
    alter table public.profiles
      add constraint profiles_commission_rate_range
      check (
        commission_rate between 0 and 100
        and commission_rate::text not in ('NaN', 'Infinity', '-Infinity')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_archive_requires_inactive'
  ) then
    alter table public.profiles
      add constraint profiles_archive_requires_inactive
      check (archived_at is null or active is false) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sales'::regclass
      and conname = 'sales_value_positive_finite'
  ) then
    alter table public.sales
      add constraint sales_value_positive_finite
      check (
        value > 0
        and value::text not in ('NaN', 'Infinity', '-Infinity')
      ) not valid;
  end if;
end
$$;

alter table public.profiles validate constraint profiles_commission_rate_range;
alter table public.profiles validate constraint profiles_archive_requires_inactive;
alter table public.sales validate constraint sales_value_positive_finite;

create index if not exists clients_archived_at_idx
  on public.clients (archived_at)
  where archived_at is null;

-- Um unico predicado governa toda autorizacao de sessoes autenticadas.
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

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() in ('ceo','manager'), false); $$;

create or replace function public.is_ceo()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() = 'ceo', false); $$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() = 'manager', false); $$;

create or replace function public.is_gestor()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() = 'gestor', false); $$;

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() = 'editor', false); $$;

create or replace function public.is_affiliate()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() = 'affiliate', false); $$;

create or replace function public.is_client()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() = 'client', false); $$;

create or replace function public.is_staff_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() in ('ceo','manager'), false); $$;

create or replace function public.is_operational_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() in ('ceo','manager','gestor','editor'), false); $$;

create or replace function public.my_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.client_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active is true
    and p.archived_at is null
    and exists (
      select 1 from public.clients c
      where c.id=p.client_id and c.status <> 'Inativo' and c.archived_at is null
    );
$$;

create or replace function private.list_demand_team()
returns table(id uuid, name text, role text, av text, photo text, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.role, p.av, p.photo, p.active
  from public.profiles p
  where p.role in ('ceo', 'manager', 'gestor', 'editor')
    and p.active is true
    and p.archived_at is null
    and (
      public.current_user_role() in ('ceo', 'manager', 'gestor', 'editor')
      or (
        public.is_client()
        and exists (
          select 1 from public.demands d
          where d.client_id = public.my_client_id() and d.assignee_id = p.id
        )
      )
    );
$$;

-- A alteracao de active/archived_at so pode ocorrer pelos RPCs auditados.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  privileged_lifecycle_change boolean :=
    coalesce(current_setting('app.allow_profile_lifecycle_change', true), '') = 'on';
begin
  if actor_id is null then
    return new;
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.id = actor_id and p.active is true and p.archived_at is null;

  if actor_role is null then
    raise exception 'Conta inativa ou sem permissao.';
  end if;

  if (new.active is distinct from old.active or new.archived_at is distinct from old.archived_at)
     and not privileged_lifecycle_change then
    raise exception 'Ativacao e arquivamento exigem a operacao administrativa segura.';
  end if;

  if actor_id = old.id then
    if new.role is distinct from old.role
       or new.email is distinct from old.email
       or new.client_id is distinct from old.client_id
       or new.active is distinct from old.active
       or new.archived_at is distinct from old.archived_at
       or new.commission_rate is distinct from old.commission_rate then
      raise exception 'Campos privilegiados do proprio perfil nao podem ser alterados.';
    end if;
    return new;
  end if;

  if old.role = 'ceo' or new.role = 'ceo'
     or lower(coalesce(old.email, '')) = lower('ogabrielmrossi@gmail.com') then
    raise exception 'O perfil do CEO e protegido.';
  end if;

  if actor_role in ('ceo', 'manager') then
    return new;
  end if;

  if actor_role = 'gestor' and old.role = 'editor' and new.role = 'editor'
     and new.email is not distinct from old.email
     and new.client_id is not distinct from old.client_id
     and new.active is not distinct from old.active
     and new.archived_at is not distinct from old.archived_at
     and new.commission_rate is not distinct from old.commission_rate then
    return new;
  end if;

  raise exception 'Voce nao tem permissao para alterar este perfil.';
end;
$$;

create or replace function public.set_my_phone(new_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'Conta inativa ou sem permissao.';
  end if;
  if char_length(coalesce(new_phone, '')) > 40 then
    raise exception 'Telefone invalido.';
  end if;
  update public.profiles
  set phone = btrim(new_phone), updated_at = now()
  where id = (select auth.uid());
  select p.client_id into v_client_id
  from public.profiles p where p.id = (select auth.uid());
  if v_client_id is not null then
    update public.clients set phone = btrim(new_phone) where id = v_client_id;
  end if;
end;
$$;

-- Perfis inativos nao podem usar caminhos diretos que antes dependiam so do uid.
drop policy if exists affiliate_withdrawals_select on public.affiliate_withdrawals;
create policy affiliate_withdrawals_select on public.affiliate_withdrawals
for select to authenticated
using ((public.is_affiliate() and affiliate_id = (select auth.uid())) or public.is_staff_admin());

drop policy if exists affiliate_withdrawal_events_select on public.affiliate_withdrawal_events;
create policy affiliate_withdrawal_events_select on public.affiliate_withdrawal_events
for select to authenticated
using (
  public.is_staff_admin()
  or (
    public.is_affiliate()
    and exists (
      select 1 from public.affiliate_withdrawals w
      where w.id = affiliate_withdrawal_events.withdrawal_id
        and w.affiliate_id = (select auth.uid())
    )
  )
);

drop policy if exists comments_delete_author_or_admin on public.comments;
create policy comments_delete_author_or_admin on public.comments
for delete to authenticated
using (public.is_staff_admin() or (public.is_active_user() and author_id = (select auth.uid())));

drop policy if exists notifications_select_recipient on public.notifications;
create policy notifications_select_recipient on public.notifications
for select to authenticated
using (
  public.is_active_user()
  and (
    to_user_id = (select auth.uid())
    or (to_role = 'admin' and public.is_operational_staff())
  )
);

drop policy if exists notifications_update_recipient on public.notifications;
create policy notifications_update_recipient on public.notifications
for update to authenticated
using (
  public.is_active_user()
  and (
    to_user_id = (select auth.uid())
    or (to_role = 'admin' and public.is_operational_staff())
  )
)
with check (
  public.is_active_user()
  and (
    to_user_id = (select auth.uid())
    or (to_role = 'admin' and public.is_operational_staff())
  )
);

drop policy if exists profiles_select_authorized on public.profiles;
create policy profiles_select_authorized on public.profiles
for select to authenticated
using (
  (id = (select auth.uid()) and public.is_active_user())
  or public.is_staff_admin()
  or (public.is_gestor() and role = 'editor')
);

drop policy if exists profiles_update_authorized on public.profiles;
create policy profiles_update_authorized on public.profiles
for update to authenticated
using (
  (id = (select auth.uid()) and public.is_active_user())
  or public.can_manage_user(id)
)
with check (
  (id = (select auth.uid()) and public.is_active_user())
  or public.can_manage_user(id)
);

-- Atualizacao de cliente e planos em uma unica transacao.
create or replace function public.admin_update_client(
  p_client_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_status text,
  p_notes text,
  p_customer_since timestamptz,
  p_affiliate_id uuid,
  p_plan_ids uuid[]
)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_plan_ids uuid[] := coalesce(p_plan_ids, array[]::uuid[]);
  v_plan_count integer;
  v_email text := lower(btrim(coalesce(p_email,'')));
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem atualizar clientes.'; end if;
  if nullif(btrim(coalesce(p_name,'')), '') is null then raise exception 'Nome obrigatorio.'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'E-mail invalido.'; end if;
  if char_length(p_name) > 160 or char_length(v_email) > 320 or char_length(coalesce(p_phone,'')) > 40
     or char_length(coalesce(p_notes,'')) > 3000 then raise exception 'Dados do cliente excedem o limite permitido.'; end if;
  if p_status not in ('Ativo','Inativo','Pausado') then raise exception 'Status invalido.'; end if;
  if cardinality(v_plan_ids) <> (select count(distinct x) from unnest(v_plan_ids) x) then
    raise exception 'Planos duplicados.';
  end if;
  select count(*) into v_plan_count from public.plans p where p.id = any(v_plan_ids);
  if v_plan_count <> cardinality(v_plan_ids) then raise exception 'Um ou mais planos sao invalidos.'; end if;
  if p_affiliate_id is not null and not exists (
    select 1 from public.profiles p
    where p.id=p_affiliate_id and p.role='affiliate' and p.active is true and p.archived_at is null
  ) then raise exception 'Afiliado invalido ou inativo.'; end if;

  select * into v_client from public.clients c
  where c.id=p_client_id and c.archived_at is null for update;
  if not found then raise exception 'Cliente nao encontrado.'; end if;

  update public.clients set
    name=btrim(p_name), email=v_email, phone=btrim(coalesce(p_phone,'')), status=p_status,
    notes=coalesce(p_notes,''), customer_since=p_customer_since,
    affiliate_id=p_affiliate_id, plan_id=v_plan_ids[1]
  where id=p_client_id returning * into v_client;

  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.profiles set
    name=btrim(p_name), email=v_email, phone=btrim(coalesce(p_phone,'')),
    active=(p_status <> 'Inativo'), updated_at=now()
  where client_id=p_client_id;

  delete from public.client_plans where client_id=p_client_id;
  insert into public.client_plans(client_id,plan_id)
  select p_client_id,x from unnest(v_plan_ids) x;
  return v_client;
end;
$$;

create or replace function public.admin_create_client_record(
  p_name text,
  p_email text,
  p_phone text,
  p_status text,
  p_notes text,
  p_type text,
  p_customer_since timestamptz,
  p_affiliate_id uuid,
  p_plan_ids uuid[]
)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_plan_ids uuid[] := coalesce(p_plan_ids, array[]::uuid[]);
  v_plan_count integer;
  v_email text := lower(btrim(coalesce(p_email,'')));
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem criar clientes.'; end if;
  if nullif(btrim(coalesce(p_name,'')), '') is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Nome ou e-mail invalido.';
  end if;
  if char_length(p_name)>160 or char_length(v_email)>320 or char_length(coalesce(p_phone,''))>40
     or char_length(coalesce(p_notes,''))>3000 or char_length(coalesce(p_type,''))>60 then
    raise exception 'Dados do cliente excedem o limite permitido.';
  end if;
  if p_status not in ('Ativo','Inativo','Pausado') then raise exception 'Status invalido.'; end if;
  if cardinality(v_plan_ids) <> (select count(distinct x) from unnest(v_plan_ids) x) then raise exception 'Planos duplicados.'; end if;
  select count(*) into v_plan_count from public.plans p where p.id=any(v_plan_ids);
  if v_plan_count <> cardinality(v_plan_ids) then raise exception 'Um ou mais planos sao invalidos.'; end if;
  if p_affiliate_id is not null and not exists (
    select 1 from public.profiles p where p.id=p_affiliate_id and p.role='affiliate' and p.active is true and p.archived_at is null
  ) then raise exception 'Afiliado invalido ou inativo.'; end if;

  insert into public.clients(name,email,phone,type,status,since,notes,plan_id,affiliate_id,customer_since)
  values (
    btrim(p_name),v_email,btrim(coalesce(p_phone,'')),coalesce(nullif(btrim(p_type),''),'Mensal'),p_status,
    to_char(current_date,'Mon/YY'),coalesce(p_notes,''),v_plan_ids[1],p_affiliate_id,p_customer_since
  ) returning * into v_client;

  insert into public.client_plans(client_id,plan_id)
  select v_client.id,x from unnest(v_plan_ids) x;
  return v_client;
end;
$$;

-- Sincroniza o e-mail das tabelas publicas; Auth e compensado pela Edge Function.
create or replace function public.admin_sync_identity_email(
  p_target_id uuid,
  p_type text,
  p_new_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_new_email,'')));
  v_profile_id uuid;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem alterar e-mails.'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or char_length(v_email)>320 then
    raise exception 'E-mail invalido.';
  end if;
  if p_type='client' then
    perform 1 from public.clients c where c.id=p_target_id and c.archived_at is null for update;
    if not found then raise exception 'Cliente nao encontrado.'; end if;
    select p.id into v_profile_id from public.profiles p where p.client_id=p_target_id for update;
    update public.clients set email=v_email where id=p_target_id;
    if v_profile_id is not null then update public.profiles set email=v_email,updated_at=now() where id=v_profile_id; end if;
  elsif p_type='team' then
    perform 1 from public.profiles p where p.id=p_target_id and p.archived_at is null for update;
    if not found then raise exception 'Usuario nao encontrado.'; end if;
    if not public.can_manage_user(p_target_id) then raise exception 'Sem permissao para alterar este usuario.'; end if;
    update public.profiles set email=v_email,updated_at=now() where id=p_target_id;
  else
    raise exception 'Tipo de identidade invalido.';
  end if;
end;
$$;

create or replace function public.admin_set_profile_active(p_target_id uuid, p_active boolean)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem alterar acessos.'; end if;
  if p_target_id=(select auth.uid()) then raise exception 'Voce nao pode alterar o proprio acesso.'; end if;
  if not public.can_manage_user(p_target_id) then raise exception 'Sem permissao para alterar este usuario.'; end if;
  select * into v_profile from public.profiles p where p.id=p_target_id for update;
  if not found or v_profile.archived_at is not null then raise exception 'Usuario nao encontrado ou arquivado.'; end if;
  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.profiles set active=p_active,updated_at=now() where id=p_target_id returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.admin_update_affiliate_commission(p_affiliate_id uuid, p_rate numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem alterar comissoes.'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 or p_rate::text in ('NaN','Infinity','-Infinity') then
    raise exception 'A comissao deve estar entre 0 e 100.';
  end if;
  perform 1 from public.profiles p
  where p.id=p_affiliate_id and p.role='affiliate' and p.active is true and p.archived_at is null
  for update;
  if not found then raise exception 'Afiliado nao encontrado ou inativo.'; end if;
  update public.profiles set commission_rate=p_rate,updated_at=now() where id=p_affiliate_id;
  return p_rate;
end;
$$;

create or replace function public.admin_archive_client(p_client_id uuid)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare v_client public.clients%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem arquivar clientes.'; end if;
  select * into v_client from public.clients c where c.id=p_client_id and c.archived_at is null for update;
  if not found then raise exception 'Cliente nao encontrado.'; end if;
  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.clients set status='Inativo',archived_at=now() where id=p_client_id returning * into v_client;
  update public.profiles set active=false,archived_at=now(),updated_at=now() where client_id=p_client_id;
  return v_client;
end;
$$;

create or replace function public.admin_archive_affiliate(p_affiliate_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem arquivar afiliados.'; end if;
  if not public.can_manage_user(p_affiliate_id) then raise exception 'Sem permissao para arquivar este usuario.'; end if;
  select * into v_profile from public.profiles p
  where p.id=p_affiliate_id and p.role='affiliate' and p.archived_at is null for update;
  if not found then raise exception 'Afiliado nao encontrado.'; end if;
  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.clients set affiliate_id=null where affiliate_id=p_affiliate_id;
  update public.profiles set active=false,archived_at=now(),updated_at=now()
  where id=p_affiliate_id returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.admin_convert_client_to_team(p_client_id uuid, p_new_role text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem converter cadastros.'; end if;
  if p_new_role not in ('manager','gestor','editor','affiliate') then raise exception 'Cargo invalido.'; end if;
  select * into v_client from public.clients c where c.id=p_client_id and c.archived_at is null for update;
  if not found then raise exception 'Cliente nao encontrado.'; end if;
  select * into v_profile from public.profiles p where p.client_id=p_client_id for update;
  if not found then raise exception 'Acesso vinculado nao encontrado.'; end if;
  update public.profiles set role=p_new_role,client_id=null,phone=coalesce(v_client.phone,v_profile.phone),updated_at=now()
  where id=v_profile.id returning * into v_profile;
  update public.clients set converted_to_team=true where id=p_client_id;
  return v_profile;
end;
$$;

create or replace function public.admin_convert_team_to_client(p_user_id uuid)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_client public.clients%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem converter cadastros.'; end if;
  if not public.can_manage_user(p_user_id) then raise exception 'Sem permissao para converter este usuario.'; end if;
  select * into v_profile from public.profiles p where p.id=p_user_id and p.archived_at is null for update;
  if not found then raise exception 'Usuario nao encontrado.'; end if;
  select * into v_client from public.clients c
  where lower(c.email)=lower(coalesce(v_profile.email,'')) and c.archived_at is null for update;
  if found then
    update public.clients set converted_to_team=false,status='Ativo',phone=coalesce(nullif(v_profile.phone,''),phone)
    where id=v_client.id returning * into v_client;
  else
    insert into public.clients(name,email,phone,status,converted_to_team)
    values(v_profile.name,coalesce(v_profile.email,''),coalesce(v_profile.phone,''),'Ativo',false)
    returning * into v_client;
  end if;
  update public.profiles set role='client',client_id=v_client.id,updated_at=now() where id=p_user_id;
  return v_client;
end;
$$;

revoke all on function public.is_active_user() from public;
revoke all on function public.admin_update_client(uuid,text,text,text,text,text,timestamptz,uuid,uuid[]) from public;
revoke all on function public.admin_create_client_record(text,text,text,text,text,text,timestamptz,uuid,uuid[]) from public;
revoke all on function public.admin_sync_identity_email(uuid,text,text) from public;
revoke all on function public.admin_set_profile_active(uuid,boolean) from public;
revoke all on function public.admin_update_affiliate_commission(uuid,numeric) from public;
revoke all on function public.admin_archive_client(uuid) from public;
revoke all on function public.admin_archive_affiliate(uuid) from public;
revoke all on function public.admin_convert_client_to_team(uuid,text) from public;
revoke all on function public.admin_convert_team_to_client(uuid) from public;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.admin_update_client(uuid,text,text,text,text,text,timestamptz,uuid,uuid[]) to authenticated;
grant execute on function public.admin_create_client_record(text,text,text,text,text,text,timestamptz,uuid,uuid[]) to authenticated;
grant execute on function public.admin_sync_identity_email(uuid,text,text) to authenticated;
grant execute on function public.admin_set_profile_active(uuid,boolean) to authenticated;
grant execute on function public.admin_update_affiliate_commission(uuid,numeric) to authenticated;
grant execute on function public.admin_archive_client(uuid) to authenticated;
grant execute on function public.admin_archive_affiliate(uuid) to authenticated;
grant execute on function public.admin_convert_client_to_team(uuid,text) to authenticated;
grant execute on function public.admin_convert_team_to_client(uuid) to authenticated;

