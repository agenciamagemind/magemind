-- Carteira e saques de afiliados.
-- O saldo e todas as mutacoes financeiras sao calculados no servidor. O cliente
-- autenticado recebe somente SELECT nas tabelas e EXECUTE nas RPCs validadas.

create table if not exists public.affiliate_withdrawals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid references public.profiles(id) on delete set null,
  affiliate_name_snapshot text not null,
  amount numeric(12,2) not null check (amount >= 1),
  pix_key_type text not null check (pix_key_type in ('cpf','cnpj','email','phone','random')),
  pix_key text not null check (char_length(pix_key) between 3 and 140),
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected','cancelled')),
  request_key uuid not null unique,
  available_balance_snapshot numeric(12,2) not null check (available_balance_snapshot >= amount),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  admin_note text check (char_length(admin_note) <= 500),
  rejection_reason text check (char_length(rejection_reason) <= 500),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_withdrawal_events (
  id bigint generated always as identity primary key,
  withdrawal_id uuid not null references public.affiliate_withdrawals(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('requested','approved','paid','rejected','cancelled')),
  from_status text,
  to_status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_withdrawals_affiliate_idx
  on public.affiliate_withdrawals (affiliate_id, requested_at desc);
create index if not exists affiliate_withdrawals_queue_idx
  on public.affiliate_withdrawals (status, requested_at)
  where status in ('pending','approved');
create index if not exists affiliate_withdrawal_events_withdrawal_idx
  on public.affiliate_withdrawal_events (withdrawal_id, created_at);
create index if not exists affiliate_withdrawals_reviewed_by_idx
  on public.affiliate_withdrawals (reviewed_by) where reviewed_by is not null;
create index if not exists affiliate_withdrawals_paid_by_idx
  on public.affiliate_withdrawals (paid_by) where paid_by is not null;

alter table public.affiliate_withdrawals enable row level security;
alter table public.affiliate_withdrawal_events enable row level security;

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='affiliate_withdrawals'
     ) then
    alter publication supabase_realtime add table public.affiliate_withdrawals;
  end if;
end $$;

drop policy if exists affiliate_withdrawals_select on public.affiliate_withdrawals;
create policy affiliate_withdrawals_select on public.affiliate_withdrawals
  for select to authenticated
  using (affiliate_id = (select auth.uid()) or public.is_staff_admin());

drop policy if exists affiliate_withdrawal_events_select on public.affiliate_withdrawal_events;
create policy affiliate_withdrawal_events_select on public.affiliate_withdrawal_events
  for select to authenticated
  using (
    public.is_staff_admin()
    or exists (
      select 1 from public.affiliate_withdrawals w
      where w.id = withdrawal_id and w.affiliate_id = (select auth.uid())
    )
  );

revoke all on public.affiliate_withdrawals from public, anon, authenticated;
revoke all on public.affiliate_withdrawal_events from public, anon, authenticated;
grant select on public.affiliate_withdrawals to authenticated;
grant select on public.affiliate_withdrawal_events to authenticated;
grant all on public.affiliate_withdrawals to service_role;
grant all on public.affiliate_withdrawal_events to service_role;
grant usage, select on sequence public.affiliate_withdrawal_events_id_seq to service_role;

-- Nenhum cliente pode editar creditos diretamente. As vendas e as RPCs sao as
-- unicas portas de entrada para o razao financeiro.
drop policy if exists "Admins insert commissions" on public.affiliate_commissions;
drop policy if exists "Admins update commissions" on public.affiliate_commissions;
drop policy if exists "Admins delete commissions" on public.affiliate_commissions;
drop policy if exists commissions_insert_company_admin on public.affiliate_commissions;
drop policy if exists commissions_update_company_admin on public.affiliate_commissions;
drop policy if exists commissions_delete_company_admin on public.affiliate_commissions;
revoke insert, update, delete on public.affiliate_commissions from anon, authenticated;

create or replace function public.affiliate_available_balance(p_affiliate_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sum(c.commission_value)
    from public.affiliate_commissions c
    where c.affiliate_id = p_affiliate_id and c.status = 'aprovada'
  ), 0)::numeric(12,2)
  - coalesce((
    select sum(w.amount)
    from public.affiliate_withdrawals w
    where w.affiliate_id = p_affiliate_id and w.status in ('pending','approved','paid')
  ), 0)::numeric(12,2)
$$;

revoke all on function public.affiliate_available_balance(uuid) from public, anon, authenticated;
grant execute on function public.affiliate_available_balance(uuid) to service_role;

create or replace function public.get_affiliate_wallet(p_affiliate_id uuid default null)
returns table (
  affiliate_id uuid,
  gross_earned numeric,
  available numeric,
  under_review numeric,
  withdrawn numeric,
  pending_commission numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid := coalesce(p_affiliate_id, v_uid);
  v_role text;
begin
  if v_uid is null then raise exception 'Sessao invalida'; end if;
  select p.role into v_role from public.profiles p where p.id = v_uid and p.active is true;
  if v_role not in ('ceo','manager') and (v_role <> 'affiliate' or v_target <> v_uid) then
    raise exception 'Sem permissao para consultar esta carteira';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_target and p.role = 'affiliate') then
    raise exception 'Afiliado nao encontrado';
  end if;

  return query
  select v_target,
    coalesce((select sum(c.commission_value) from public.affiliate_commissions c where c.affiliate_id=v_target and c.status in ('aprovada','paga')),0)::numeric(12,2),
    greatest(public.affiliate_available_balance(v_target),0)::numeric(12,2),
    coalesce((select sum(w.amount) from public.affiliate_withdrawals w where w.affiliate_id=v_target and w.status in ('pending','approved')),0)::numeric(12,2),
    (coalesce((select sum(w.amount) from public.affiliate_withdrawals w where w.affiliate_id=v_target and w.status='paid'),0)
      + coalesce((select sum(c.commission_value) from public.affiliate_commissions c where c.affiliate_id=v_target and c.status='paga'),0))::numeric(12,2),
    coalesce((select sum(c.commission_value) from public.affiliate_commissions c where c.affiliate_id=v_target and c.status='pendente'),0)::numeric(12,2);
end;
$$;

create or replace function public.request_affiliate_withdrawal(
  p_amount numeric,
  p_pix_key_type text,
  p_pix_key text,
  p_request_key uuid
)
returns public.affiliate_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_key text := btrim(coalesce(p_pix_key,''));
  v_digits text;
  v_available numeric(12,2);
  v_existing public.affiliate_withdrawals%rowtype;
  v_created public.affiliate_withdrawals%rowtype;
begin
  if v_uid is null then raise exception 'Sessao invalida'; end if;
  if p_request_key is null then raise exception 'Identificador da solicitacao obrigatorio'; end if;

  select * into v_profile from public.profiles p where p.id=v_uid for update;
  if not found or v_profile.active is not true or v_profile.role <> 'affiliate' then
    raise exception 'Somente afiliados ativos podem solicitar saques';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 9173));

  select * into v_existing from public.affiliate_withdrawals w where w.request_key=p_request_key;
  if found then
    if v_existing.affiliate_id <> v_uid then raise exception 'Identificador de solicitacao invalido'; end if;
    return v_existing;
  end if;

  if p_amount is null or p_amount < 1 or p_amount <> round(p_amount,2) then
    raise exception 'Informe um valor valido, com no maximo duas casas decimais';
  end if;
  if p_pix_key_type not in ('cpf','cnpj','email','phone','random') then raise exception 'Tipo de chave PIX invalido'; end if;
  v_digits := regexp_replace(v_key,'[^0-9]','','g');
  if (p_pix_key_type='cpf' and char_length(v_digits)<>11)
     or (p_pix_key_type='cnpj' and char_length(v_digits)<>14)
     or (p_pix_key_type='phone' and char_length(v_digits) not between 10 and 13)
     or (p_pix_key_type='email' and v_key !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
     or (p_pix_key_type='random' and v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Chave PIX invalida para o tipo selecionado';
  end if;
  if p_pix_key_type in ('cpf','cnpj','phone') then v_key := v_digits; end if;
  if p_pix_key_type='email' then v_key := lower(v_key); end if;

  v_available := public.affiliate_available_balance(v_uid);
  if p_amount > v_available then
    raise exception 'Saldo insuficiente. Disponivel: R$ %', replace(to_char(v_available,'FM999G999G990D00'),'.',',');
  end if;

  insert into public.affiliate_withdrawals(
    affiliate_id,affiliate_name_snapshot,amount,pix_key_type,pix_key,request_key,available_balance_snapshot
  ) values (v_uid,v_profile.name,p_amount,p_pix_key_type,v_key,p_request_key,v_available)
  returning * into v_created;
  insert into public.affiliate_withdrawal_events(withdrawal_id,actor_id,event_type,to_status,details)
  values(v_created.id,v_uid,'requested','pending',jsonb_build_object('amount',p_amount));
  return v_created;
end;
$$;

create or replace function public.review_affiliate_withdrawal(
  p_withdrawal_id uuid,
  p_action text,
  p_note text default null
)
returns public.affiliate_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_row public.affiliate_withdrawals%rowtype;
  v_from text;
  v_to text;
begin
  if v_uid is null then raise exception 'Sessao invalida'; end if;
  select p.role into v_role from public.profiles p where p.id=v_uid and p.active is true;
  if v_role not in ('ceo','manager') then raise exception 'Somente CEO ou Gerente podem analisar saques'; end if;
  if char_length(coalesce(p_note,'')) > 500 then raise exception 'Observacao muito longa'; end if;

  select * into v_row from public.affiliate_withdrawals w where w.id=p_withdrawal_id for update;
  if not found then raise exception 'Solicitacao nao encontrada'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_row.affiliate_id::text, 9173));
  v_from := v_row.status;

  if p_action='approve' and v_from='pending' then v_to := 'approved';
  elsif p_action='pay' and v_from='approved' then v_to := 'paid';
  elsif p_action='reject' and v_from in ('pending','approved') then v_to := 'rejected';
  else raise exception 'Transicao de status invalida';
  end if;
  if v_to='rejected' and char_length(btrim(coalesce(p_note,''))) < 3 then
    raise exception 'Informe o motivo da recusa';
  end if;

  update public.affiliate_withdrawals set
    status=v_to,
    reviewed_at=case when v_to in ('approved','rejected') then now() else reviewed_at end,
    reviewed_by=case when v_to in ('approved','rejected') then v_uid else reviewed_by end,
    paid_at=case when v_to='paid' then now() else paid_at end,
    paid_by=case when v_to='paid' then v_uid else paid_by end,
    admin_note=case when v_to in ('approved','paid') then nullif(btrim(coalesce(p_note,'')),'') else admin_note end,
    rejection_reason=case when v_to='rejected' then btrim(p_note) else rejection_reason end,
    updated_at=now()
  where id=p_withdrawal_id returning * into v_row;
  insert into public.affiliate_withdrawal_events(withdrawal_id,actor_id,event_type,from_status,to_status,details)
  values(v_row.id,v_uid,v_to,v_from,v_to,jsonb_build_object('note',nullif(btrim(coalesce(p_note,'')),'')));
  return v_row;
end;
$$;

create or replace function public.cancel_affiliate_withdrawal(p_withdrawal_id uuid)
returns public.affiliate_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.affiliate_withdrawals%rowtype;
begin
  if v_uid is null then raise exception 'Sessao invalida'; end if;
  select * into v_row from public.affiliate_withdrawals w where w.id=p_withdrawal_id for update;
  if not found or v_row.affiliate_id<>v_uid then raise exception 'Solicitacao nao encontrada'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 9173));
  if v_row.status<>'pending' then raise exception 'Somente saques em analise podem ser cancelados'; end if;
  update public.affiliate_withdrawals set status='cancelled',updated_at=now()
    where id=p_withdrawal_id returning * into v_row;
  insert into public.affiliate_withdrawal_events(withdrawal_id,actor_id,event_type,from_status,to_status)
  values(v_row.id,v_uid,'cancelled','pending','cancelled');
  return v_row;
end;
$$;

revoke all on function public.get_affiliate_wallet(uuid) from public, anon;
revoke all on function public.request_affiliate_withdrawal(numeric,text,text,uuid) from public, anon;
revoke all on function public.review_affiliate_withdrawal(uuid,text,text) from public, anon;
revoke all on function public.cancel_affiliate_withdrawal(uuid) from public, anon;
grant execute on function public.get_affiliate_wallet(uuid) to authenticated;
grant execute on function public.request_affiliate_withdrawal(numeric,text,text,uuid) to authenticated;
grant execute on function public.review_affiliate_withdrawal(uuid,text,text) to authenticated;
grant execute on function public.cancel_affiliate_withdrawal(uuid) to authenticated;

-- Creditos de vendas fechadas entram automaticamente como disponiveis. A taxa
-- fica congelada no primeiro credito daquela venda; alteracoes futuras na taxa
-- do afiliado nao reescrevem o passado.
create or replace function public.calc_affiliate_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affiliate uuid;
  v_old_affiliate uuid;
  v_rate numeric;
  v_existing public.affiliate_commissions%rowtype;
  v_lock uuid;
begin
  select c.affiliate_id into v_affiliate from public.clients c where c.id=NEW.client_id;
  select * into v_existing from public.affiliate_commissions c where c.sale_id=NEW.id;
  v_old_affiliate := v_existing.affiliate_id;

  for v_lock in
    select distinct x from unnest(array[v_old_affiliate,v_affiliate]) x where x is not null order by x
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock::text,9173));
  end loop;

  if NEW.status<>'Fechado' or v_affiliate is null then
    if v_existing.id is not null and v_existing.status='aprovada' then
      if public.affiliate_available_balance(v_existing.affiliate_id) - v_existing.commission_value < 0 then
        raise exception 'Esta venda possui comissao ja reservada ou paga. Cancele o saque antes de alterar a venda.';
      end if;
      update public.affiliate_commissions set status='cancelada',updated_at=now() where id=v_existing.id;
    end if;
    return NEW;
  end if;

  if v_existing.id is not null and v_existing.affiliate_id=v_affiliate then
    v_rate := v_existing.commission_rate;
    if v_existing.status='aprovada'
       and public.affiliate_available_balance(v_affiliate) - v_existing.commission_value
           + round((NEW.value*v_rate/100)::numeric,2) < 0 then
      raise exception 'A reducao desta venda deixaria a carteira do afiliado negativa.';
    end if;
  else
    select p.commission_rate into v_rate from public.profiles p
      where p.id=v_affiliate and p.role='affiliate' and p.active is true;
    if v_rate is null then return NEW; end if;
    if v_existing.id is not null and v_existing.status='aprovada'
       and public.affiliate_available_balance(v_existing.affiliate_id)-v_existing.commission_value < 0 then
      raise exception 'A comissao anterior desta venda ja esta reservada ou paga.';
    end if;
  end if;

  insert into public.affiliate_commissions(
    sale_id,affiliate_id,client_id,base_value,commission_rate,commission_value,status,updated_at
  ) values (
    NEW.id,v_affiliate,NEW.client_id,NEW.value,v_rate,round((NEW.value*v_rate/100)::numeric,2),'aprovada',now()
  ) on conflict (sale_id) do update set
    affiliate_id=excluded.affiliate_id,
    client_id=excluded.client_id,
    base_value=excluded.base_value,
    commission_rate=excluded.commission_rate,
    commission_value=excluded.commission_value,
    status='aprovada',
    updated_at=now();
  return NEW;
end;
$$;

revoke all on function public.calc_affiliate_commission() from public, anon, authenticated;

update public.affiliate_commissions c set status='aprovada',updated_at=now()
where c.status='pendente'
  and exists (select 1 from public.sales s where s.id=c.sale_id and s.status='Fechado');

create or replace function public.protect_sale_financial_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.affiliate_commissions c where c.sale_id=OLD.id) then
    raise exception 'Venda com historico de comissao nao pode ser excluida. Altere o status para Cancelado.';
  end if;
  return OLD;
end;
$$;
revoke all on function public.protect_sale_financial_history() from public, anon, authenticated;
drop trigger if exists trg_protect_sale_financial_history on public.sales;
create trigger trg_protect_sale_financial_history
  before delete on public.sales for each row execute function public.protect_sale_financial_history();

comment on table public.affiliate_withdrawals is 'Solicitacoes de saque; mutacoes somente pelas RPCs financeiras.';
comment on table public.affiliate_withdrawal_events is 'Auditoria append-only de todas as transicoes de saque.';

