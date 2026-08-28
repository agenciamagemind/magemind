-- Indique & Ganhe is a capability of any active profile, not a team role.
alter table public.profiles
  add column affiliate_status text not null default 'locked',
  add column affiliate_requested_at timestamptz,
  add column affiliate_reviewed_at timestamptz,
  add column affiliate_reviewed_by uuid references public.profiles(id) on delete set null;

alter table public.profiles
  add constraint profiles_affiliate_status_check
  check (affiliate_status in ('locked','pending','approved','rejected'));

create index profiles_affiliate_status_idx
  on public.profiles (affiliate_status)
  where archived_at is null;

-- Preserve the single legacy affiliate and all existing financial history.
update public.profiles
set affiliate_status='approved',
    affiliate_requested_at=coalesce(affiliate_requested_at,created_at),
    affiliate_reviewed_at=coalesce(affiliate_reviewed_at,now())
where role='affiliate';

create or replace function public.is_referral_participant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id=(select auth.uid())
      and p.active is true
      and p.archived_at is null
      and p.affiliate_status='approved'
  );
$$;

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
  privileged_referral_change boolean :=
    coalesce(current_setting('app.allow_affiliate_status_change', true), '') = 'on';
begin
  if actor_id is null then return new; end if;

  select p.role into actor_role
  from public.profiles p
  where p.id=actor_id and p.active is true and p.archived_at is null;
  if actor_role is null then raise exception 'Conta inativa ou sem permissao.'; end if;

  if (new.active is distinct from old.active or new.archived_at is distinct from old.archived_at)
     and not privileged_lifecycle_change then
    raise exception 'Ativacao e arquivamento exigem a operacao administrativa segura.';
  end if;

  if actor_id=old.id then
    if new.role is distinct from old.role
       or new.email is distinct from old.email
       or new.client_id is distinct from old.client_id
       or new.active is distinct from old.active
       or new.archived_at is distinct from old.archived_at
       or new.commission_rate is distinct from old.commission_rate
       or ((new.affiliate_status is distinct from old.affiliate_status
            or new.affiliate_requested_at is distinct from old.affiliate_requested_at
            or new.affiliate_reviewed_at is distinct from old.affiliate_reviewed_at
            or new.affiliate_reviewed_by is distinct from old.affiliate_reviewed_by)
           and not privileged_referral_change) then
      raise exception 'Campos privilegiados do proprio perfil nao podem ser alterados.';
    end if;
    return new;
  end if;

  if old.role='ceo' or new.role='ceo'
     or lower(coalesce(old.email,''))=lower('ogabrielmrossi@gmail.com') then
    raise exception 'O perfil do CEO e protegido.';
  end if;
  if actor_role in ('ceo','manager') then return new; end if;

  if actor_role='gestor' and old.role='editor' and new.role='editor'
     and new.email is not distinct from old.email
     and new.client_id is not distinct from old.client_id
     and new.active is not distinct from old.active
     and new.archived_at is not distinct from old.archived_at
     and new.commission_rate is not distinct from old.commission_rate
     and new.affiliate_status is not distinct from old.affiliate_status
     and new.affiliate_requested_at is not distinct from old.affiliate_requested_at
     and new.affiliate_reviewed_at is not distinct from old.affiliate_reviewed_at
     and new.affiliate_reviewed_by is not distinct from old.affiliate_reviewed_by then
    return new;
  end if;
  raise exception 'Voce nao tem permissao para alterar este perfil.';
end;
$$;

create or replace function public.request_indique_ganhe_access()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null then raise exception 'Sessao invalida.'; end if;
  select p.affiliate_status into v_status
  from public.profiles p
  where p.id=v_uid and p.active is true and p.archived_at is null
  for update;
  if not found then raise exception 'Conta inativa ou sem permissao.'; end if;
  if v_status in ('approved','pending') then return v_status; end if;

  perform set_config('app.allow_affiliate_status_change','on',true);
  update public.profiles
  set affiliate_status='pending', affiliate_requested_at=now(),
      affiliate_reviewed_at=null, affiliate_reviewed_by=null, updated_at=now()
  where id=v_uid;
  return 'pending';
end;
$$;

create or replace function public.review_indique_ganhe_access(p_profile_id uuid,p_action text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then
    raise exception 'Somente CEO ou Gerente podem analisar solicitacoes.';
  end if;
  if p_action not in ('approve','reject') then raise exception 'Acao invalida.'; end if;

  select * into v_profile from public.profiles p
  where p.id=p_profile_id and p.active is true and p.archived_at is null for update;
  if not found then raise exception 'Perfil nao encontrado ou inativo.'; end if;
  if v_profile.affiliate_status<>'pending' then
    raise exception 'Esta solicitacao nao esta mais em analise.';
  end if;

  update public.profiles
  set affiliate_status=case when p_action='approve' then 'approved' else 'rejected' end,
      affiliate_reviewed_at=now(), affiliate_reviewed_by=v_uid,
      commission_rate=case when p_action='approve' and commission_rate=0 then 10 else commission_rate end,
      updated_at=now()
  where id=p_profile_id returning * into v_profile;
  return v_profile;
end;
$$;

drop policy if exists affiliate_commissions_select_authorized on public.affiliate_commissions;
create policy affiliate_commissions_select_authorized on public.affiliate_commissions
for select to authenticated
using (public.is_staff_admin() or (public.is_referral_participant() and affiliate_id=(select auth.uid())));

drop policy if exists affiliate_withdrawals_select on public.affiliate_withdrawals;
create policy affiliate_withdrawals_select on public.affiliate_withdrawals
for select to authenticated
using (public.is_staff_admin() or (public.is_referral_participant() and affiliate_id=(select auth.uid())));

drop policy if exists affiliate_withdrawal_events_select on public.affiliate_withdrawal_events;
create policy affiliate_withdrawal_events_select on public.affiliate_withdrawal_events
for select to authenticated
using (
  public.is_staff_admin()
  or (public.is_referral_participant() and exists (
    select 1 from public.affiliate_withdrawals w
    where w.id=affiliate_withdrawal_events.withdrawal_id and w.affiliate_id=(select auth.uid())
  ))
);

create or replace function public.get_my_affiliate_client_metrics()
returns table (client_id uuid,client_name text,client_status text,registered_at timestamptz,demand_count bigint,commission_total numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_referral_participant() then
    raise exception 'Participacao no Indique & Ganhe nao aprovada.';
  end if;
  return query
  select c.id,c.name,c.status,c.created_at,
    (select count(*) from public.demands d where d.client_id=c.id),
    coalesce((select sum(ac.commission_value) from public.affiliate_commissions ac
      where ac.client_id=c.id and ac.affiliate_id=v_uid and ac.status in ('pendente','aprovada','paga')),0)::numeric(12,2)
  from public.clients c
  where c.affiliate_id=v_uid and c.converted_to_team is false and c.archived_at is null;
end;
$$;

create or replace function public.get_my_affiliate_commission_sales()
returns table (sale_id uuid,client_id uuid,commission_value numeric,client_name text,sale_status text,sale_date date,assignee text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_referral_participant() then
    raise exception 'Participacao no Indique & Ganhe nao aprovada.';
  end if;
  return query
  select s.id,s.client_id,coalesce(ac.commission_value,0)::numeric(12,2),c.name,s.status,s.sale_date,coalesce(s.assignee,'')
  from public.sales s
  join public.clients c on c.id=s.client_id and c.affiliate_id=v_uid
  left join public.affiliate_commissions ac on ac.sale_id=s.id and ac.affiliate_id=v_uid and ac.status<>'cancelada'
  order by s.sale_date desc nulls last,s.created_at desc;
end;
$$;

create or replace function public.get_affiliate_wallet(p_affiliate_id uuid default null)
returns table (affiliate_id uuid,gross_earned numeric,available numeric,under_review numeric,withdrawn numeric,pending_commission numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid := coalesce(p_affiliate_id,v_uid);
begin
  if v_uid is null then raise exception 'Sessao invalida'; end if;
  if not public.is_staff_admin() and (v_target<>v_uid or not public.is_referral_participant()) then
    raise exception 'Sem permissao para consultar esta carteira';
  end if;
  if not exists (select 1 from public.profiles p where p.id=v_target and p.affiliate_status='approved' and p.active is true and p.archived_at is null) then
    raise exception 'Participante nao encontrado ou inativo';
  end if;
  return query select v_target,
    coalesce((select sum(c.commission_value) from public.affiliate_commissions c where c.affiliate_id=v_target and c.status in ('aprovada','paga')),0)::numeric(12,2),
    greatest(public.affiliate_available_balance(v_target),0)::numeric(12,2),
    coalesce((select sum(w.amount) from public.affiliate_withdrawals w where w.affiliate_id=v_target and w.status in ('pending','approved')),0)::numeric(12,2),
    (coalesce((select sum(w.amount) from public.affiliate_withdrawals w where w.affiliate_id=v_target and w.status='paid'),0)
      + coalesce((select sum(c.commission_value) from public.affiliate_commissions c where c.affiliate_id=v_target and c.status='paga'),0))::numeric(12,2),
    coalesce((select sum(c.commission_value) from public.affiliate_commissions c where c.affiliate_id=v_target and c.status='pendente'),0)::numeric(12,2);
end;
$$;

create or replace function public.request_affiliate_withdrawal(p_amount numeric,p_pix_key_type text,p_pix_key text,p_request_key uuid)
returns public.affiliate_withdrawals
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_profile public.profiles%rowtype;
  v_key text := btrim(coalesce(p_pix_key,'')); v_digits text; v_available numeric(12,2);
  v_existing public.affiliate_withdrawals%rowtype; v_created public.affiliate_withdrawals%rowtype;
begin
  if v_uid is null then raise exception 'Sessao invalida'; end if;
  if p_request_key is null then raise exception 'Identificador da solicitacao obrigatorio'; end if;
  select * into v_profile from public.profiles p where p.id=v_uid for update;
  if not found or v_profile.active is not true or v_profile.archived_at is not null or v_profile.affiliate_status<>'approved' then
    raise exception 'Apenas participantes aprovados podem solicitar saques';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,9173));
  select * into v_existing from public.affiliate_withdrawals w where w.request_key=p_request_key;
  if found then
    if v_existing.affiliate_id<>v_uid then raise exception 'Identificador de solicitacao invalido'; end if;
    return v_existing;
  end if;
  if p_amount is null or p_amount<1 or p_amount<>round(p_amount,2) then raise exception 'Informe um valor valido, com no maximo duas casas decimais'; end if;
  if p_pix_key_type not in ('cpf','cnpj','email','phone','random') then raise exception 'Tipo de chave PIX invalido'; end if;
  v_digits:=regexp_replace(v_key,'[^0-9]','','g');
  if (p_pix_key_type='cpf' and char_length(v_digits)<>11)
     or (p_pix_key_type='cnpj' and char_length(v_digits)<>14)
     or (p_pix_key_type='phone' and char_length(v_digits) not between 10 and 13)
     or (p_pix_key_type='email' and v_key !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
     or (p_pix_key_type='random' and v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Chave PIX invalida para o tipo selecionado';
  end if;
  if p_pix_key_type in ('cpf','cnpj','phone') then v_key:=v_digits; end if;
  if p_pix_key_type='email' then v_key:=lower(v_key); end if;
  v_available:=public.affiliate_available_balance(v_uid);
  if p_amount>v_available then raise exception 'Saldo insuficiente. Disponivel: R$ %',replace(to_char(v_available,'FM999G999G990D00'),'.',','); end if;
  insert into public.affiliate_withdrawals(affiliate_id,affiliate_name_snapshot,amount,pix_key_type,pix_key,request_key,available_balance_snapshot)
  values(v_uid,v_profile.name,p_amount,p_pix_key_type,v_key,p_request_key,v_available) returning * into v_created;
  insert into public.affiliate_withdrawal_events(withdrawal_id,actor_id,event_type,to_status,details)
  values(v_created.id,v_uid,'requested','pending',jsonb_build_object('amount',p_amount));
  return v_created;
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
  update public.profiles set commission_rate=p_rate,updated_at=now() where id=p_affiliate_id;
  return p_rate;
end;
$$;

create or replace function public.calc_affiliate_commission()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_affiliate uuid; v_old_affiliate uuid; v_rate numeric;
  v_existing public.affiliate_commissions%rowtype; v_lock uuid;
begin
  select c.affiliate_id into v_affiliate from public.clients c where c.id=NEW.client_id;
  select * into v_existing from public.affiliate_commissions c where c.sale_id=NEW.id;
  v_old_affiliate:=v_existing.affiliate_id;
  for v_lock in select distinct x from unnest(array[v_old_affiliate,v_affiliate]) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock::text,9173));
  end loop;
  if NEW.status<>'Fechado' or v_affiliate is null then
    if v_existing.id is not null and v_existing.status='aprovada' then
      if public.affiliate_available_balance(v_existing.affiliate_id)-v_existing.commission_value<0 then
        raise exception 'Esta venda possui comissao ja reservada ou paga. Cancele o saque antes de alterar a venda.';
      end if;
      update public.affiliate_commissions set status='cancelada',updated_at=now() where id=v_existing.id;
    end if;
    return NEW;
  end if;
  if v_existing.id is not null and v_existing.affiliate_id=v_affiliate then
    v_rate:=v_existing.commission_rate;
    if v_existing.status='aprovada' and public.affiliate_available_balance(v_affiliate)-v_existing.commission_value+round((NEW.value*v_rate/100)::numeric,2)<0 then
      raise exception 'A reducao desta venda deixaria a carteira do participante negativa.';
    end if;
  else
    select p.commission_rate into v_rate from public.profiles p
    where p.id=v_affiliate and p.affiliate_status='approved' and p.active is true and p.archived_at is null;
    if v_rate is null then return NEW; end if;
    if v_existing.id is not null and v_existing.status='aprovada'
       and public.affiliate_available_balance(v_existing.affiliate_id)-v_existing.commission_value<0 then
      raise exception 'A comissao anterior desta venda ja esta reservada ou paga.';
    end if;
  end if;
  insert into public.affiliate_commissions(sale_id,affiliate_id,client_id,base_value,commission_rate,commission_value,status,updated_at)
  values(NEW.id,v_affiliate,NEW.client_id,NEW.value,v_rate,round((NEW.value*v_rate/100)::numeric,2),'aprovada',now())
  on conflict (sale_id) do update set affiliate_id=excluded.affiliate_id,client_id=excluded.client_id,
    base_value=excluded.base_value,commission_rate=excluded.commission_rate,
    commission_value=excluded.commission_value,status='aprovada',updated_at=now();
  return NEW;
end;
$$;

create or replace function public.admin_archive_affiliate(p_affiliate_id uuid)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem arquivar participantes.'; end if;
  if not public.can_manage_user(p_affiliate_id) then raise exception 'Sem permissao para arquivar este usuario.'; end if;
  select * into v_profile from public.profiles p where p.id=p_affiliate_id and p.archived_at is null for update;
  if not found then raise exception 'Participante nao encontrado.'; end if;
  if not exists(select 1 from public.affiliate_commissions c where c.affiliate_id=p_affiliate_id)
     and not exists(select 1 from public.affiliate_withdrawals w where w.affiliate_id=p_affiliate_id) then
    raise exception 'Este perfil nao possui historico financeiro para arquivamento especial.';
  end if;
  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.clients set affiliate_id=null where affiliate_id=p_affiliate_id;
  update public.profiles set active=false,archived_at=now(),updated_at=now() where id=p_affiliate_id returning * into v_profile;
  return v_profile;
end;
$$;

-- Existing admin client RPCs use role='affiliate'. Replace only that predicate
-- through new overload-compatible implementations below.
create or replace function public.admin_update_client(
  p_client_id uuid,p_name text,p_email text,p_phone text,p_status text,p_notes text,
  p_customer_since timestamptz,p_affiliate_id uuid,p_plan_ids uuid[]
)
returns public.clients language plpgsql security definer set search_path = ''
as $$
declare
  v_client public.clients%rowtype; v_plan_ids uuid[]:=coalesce(p_plan_ids,array[]::uuid[]);
  v_plan_count integer; v_email text:=lower(btrim(coalesce(p_email,'')));
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem atualizar clientes.'; end if;
  if nullif(btrim(coalesce(p_name,'')),'') is null then raise exception 'Nome obrigatorio.'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'E-mail invalido.'; end if;
  if char_length(p_name)>160 or char_length(v_email)>320 or char_length(coalesce(p_phone,''))>40
     or char_length(coalesce(p_notes,''))>3000 then raise exception 'Dados do cliente excedem o limite permitido.'; end if;
  if p_status not in ('Ativo','Inativo','Pausado') then raise exception 'Status invalido.'; end if;
  if cardinality(v_plan_ids)<>(select count(distinct x) from unnest(v_plan_ids) x) then raise exception 'Planos duplicados.'; end if;
  select count(*) into v_plan_count from public.plans p where p.id=any(v_plan_ids);
  if v_plan_count<>cardinality(v_plan_ids) then raise exception 'Um ou mais planos sao invalidos.'; end if;
  if p_affiliate_id is not null and not exists (
    select 1 from public.profiles p where p.id=p_affiliate_id and p.affiliate_status='approved'
      and p.active is true and p.archived_at is null
  ) then raise exception 'Participante do Indique & Ganhe invalido ou inativo.'; end if;

  select * into v_client from public.clients c where c.id=p_client_id and c.archived_at is null for update;
  if not found then raise exception 'Cliente nao encontrado.'; end if;
  update public.clients set name=btrim(p_name),email=v_email,phone=btrim(coalesce(p_phone,'')),status=p_status,
    notes=coalesce(p_notes,''),customer_since=p_customer_since,affiliate_id=p_affiliate_id,plan_id=v_plan_ids[1]
  where id=p_client_id returning * into v_client;
  perform set_config('app.allow_profile_lifecycle_change','on',true);
  update public.profiles set name=btrim(p_name),email=v_email,phone=btrim(coalesce(p_phone,'')),
    active=(p_status<>'Inativo'),updated_at=now() where client_id=p_client_id;
  delete from public.client_plans where client_id=p_client_id;
  insert into public.client_plans(client_id,plan_id) select p_client_id,x from unnest(v_plan_ids) x;
  return v_client;
end;
$$;

create or replace function public.admin_create_client_record(
  p_name text,p_email text,p_phone text,p_status text,p_notes text,p_type text,
  p_customer_since timestamptz,p_affiliate_id uuid,p_plan_ids uuid[]
)
returns public.clients language plpgsql security definer set search_path = ''
as $$
declare
  v_client public.clients%rowtype; v_plan_ids uuid[]:=coalesce(p_plan_ids,array[]::uuid[]);
  v_plan_count integer; v_email text:=lower(btrim(coalesce(p_email,'')));
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem criar clientes.'; end if;
  if nullif(btrim(coalesce(p_name,'')),'') is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Nome ou e-mail invalido.';
  end if;
  if char_length(p_name)>160 or char_length(v_email)>320 or char_length(coalesce(p_phone,''))>40
     or char_length(coalesce(p_notes,''))>3000 or char_length(coalesce(p_type,''))>60 then
    raise exception 'Dados do cliente excedem o limite permitido.';
  end if;
  if p_status not in ('Ativo','Inativo','Pausado') then raise exception 'Status invalido.'; end if;
  if cardinality(v_plan_ids)<>(select count(distinct x) from unnest(v_plan_ids) x) then raise exception 'Planos duplicados.'; end if;
  select count(*) into v_plan_count from public.plans p where p.id=any(v_plan_ids);
  if v_plan_count<>cardinality(v_plan_ids) then raise exception 'Um ou mais planos sao invalidos.'; end if;
  if p_affiliate_id is not null and not exists (
    select 1 from public.profiles p where p.id=p_affiliate_id and p.affiliate_status='approved'
      and p.active is true and p.archived_at is null
  ) then raise exception 'Participante do Indique & Ganhe invalido ou inativo.'; end if;
  insert into public.clients(name,email,phone,type,status,since,notes,plan_id,affiliate_id,customer_since)
  values(btrim(p_name),v_email,btrim(coalesce(p_phone,'')),coalesce(nullif(btrim(p_type),''),'Mensal'),p_status,
    to_char(current_date,'Mon/YY'),coalesce(p_notes,''),v_plan_ids[1],p_affiliate_id,p_customer_since)
  returning * into v_client;
  insert into public.client_plans(client_id,plan_id) select v_client.id,x from unnest(v_plan_ids) x;
  return v_client;
end;
$$;

create or replace function public.admin_convert_client_to_team(p_client_id uuid,p_new_role text)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare v_client public.clients%rowtype; v_profile public.profiles%rowtype;
begin
  if not public.is_staff_admin() then raise exception 'Somente CEO ou Gerente podem converter cadastros.'; end if;
  if p_new_role not in ('manager','gestor','editor') then raise exception 'Cargo invalido.'; end if;
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

-- Validate referral links centrally, including calls made by existing RPCs.
create or replace function public.guard_client_referral_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.affiliate_id is not null and new.affiliate_id is distinct from old.affiliate_id
     and not exists (
       select 1 from public.profiles p where p.id=new.affiliate_id
       and p.affiliate_status='approved' and p.active is true and p.archived_at is null
     ) then
    raise exception 'Participante do Indique & Ganhe invalido ou inativo.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_client_referral_assignment on public.clients;
create trigger trg_guard_client_referral_assignment
before insert or update of affiliate_id on public.clients
for each row execute function public.guard_client_referral_assignment();

revoke all on function public.is_referral_participant() from public,anon;
revoke all on function public.request_indique_ganhe_access() from public,anon;
revoke all on function public.review_indique_ganhe_access(uuid,text) from public,anon;
revoke all on function public.get_affiliate_wallet(uuid) from public,anon;
revoke all on function public.request_affiliate_withdrawal(numeric,text,text,uuid) from public,anon;
revoke all on function public.get_my_affiliate_client_metrics() from public,anon;
revoke all on function public.get_my_affiliate_commission_sales() from public,anon;
revoke all on function public.guard_client_referral_assignment() from public,anon,authenticated;

grant execute on function public.is_referral_participant() to authenticated;
grant execute on function public.request_indique_ganhe_access() to authenticated;
grant execute on function public.review_indique_ganhe_access(uuid,text) to authenticated;
grant execute on function public.get_affiliate_wallet(uuid) to authenticated;
grant execute on function public.request_affiliate_withdrawal(numeric,text,text,uuid) to authenticated;
grant execute on function public.get_my_affiliate_client_metrics() to authenticated;
grant execute on function public.get_my_affiliate_commission_sales() to authenticated;

comment on column public.profiles.affiliate_status is
  'Estado da participacao no Indique & Ganhe, independente do cargo do perfil.';
