-- O afiliado recebe somente contagens e valores agregados dos clientes que
-- indicou. Detalhes de demandas continuam protegidos pelas politicas existentes.
create or replace function public.get_my_affiliate_client_metrics()
returns table (
  client_id uuid,
  client_name text,
  client_status text,
  registered_at timestamptz,
  demand_count bigint,
  commission_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p
    where p.id=v_uid and p.role='affiliate' and p.active is true
  ) then
    raise exception 'Somente afiliados ativos podem consultar estas metricas';
  end if;

  return query
  select c.id,c.name,c.status,c.created_at,
    (select count(*) from public.demands d where d.client_id=c.id),
    coalesce((
      select sum(ac.commission_value)
      from public.affiliate_commissions ac
      where ac.client_id=c.id
        and ac.affiliate_id=v_uid
        and ac.status in ('pendente','aprovada','paga')
    ),0)::numeric(12,2)
  from public.clients c
  where c.affiliate_id=v_uid and c.converted_to_team is false;
end;
$$;

revoke all on function public.get_my_affiliate_client_metrics() from public, anon;
grant execute on function public.get_my_affiliate_client_metrics() to authenticated;

create or replace function public.get_my_affiliate_commission_sales()
returns table (
  sale_id uuid,
  client_id uuid,
  commission_value numeric,
  client_name text,
  sale_status text,
  sale_date date,
  assignee text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p
    where p.id=v_uid and p.role='affiliate' and p.active is true
  ) then
    raise exception 'Somente afiliados ativos podem consultar estas comissoes';
  end if;

  return query
  select s.id,s.client_id,
    coalesce(ac.commission_value,0)::numeric(12,2),
    c.name,
    s.status,
    s.sale_date,
    coalesce(s.assignee,'')
  from public.sales s
  join public.clients c on c.id=s.client_id and c.affiliate_id=v_uid
  left join public.affiliate_commissions ac
    on ac.sale_id=s.id and ac.affiliate_id=v_uid and ac.status<>'cancelada'
  order by s.sale_date desc nulls last,s.created_at desc;
end;
$$;

revoke all on function public.get_my_affiliate_commission_sales() from public, anon;
grant execute on function public.get_my_affiliate_commission_sales() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sales') then
      alter publication supabase_realtime add table public.sales;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='affiliate_commissions') then
      alter publication supabase_realtime add table public.affiliate_commissions;
    end if;
  end if;
end $$;

-- Ao vincular, trocar ou remover o afiliado de um cliente, todas as vendas ja
-- fechadas sao recalculadas pela mesma rotina financeira usada em novas vendas.
-- O update e transacional: se houver saldo reservado/pago que impeça a troca,
-- a operacao inteira e recusada sem deixar dados parciais.
create or replace function public.sync_client_affiliate_commissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.affiliate_id is distinct from NEW.affiliate_id then
    update public.sales s
      set value=s.value
      where s.client_id=NEW.id and s.status='Fechado';
  end if;
  return NEW;
end;
$$;

revoke all on function public.sync_client_affiliate_commissions() from public, anon, authenticated;
drop trigger if exists trg_sync_client_affiliate_commissions on public.clients;
create trigger trg_sync_client_affiliate_commissions
  after update of affiliate_id on public.clients
  for each row execute function public.sync_client_affiliate_commissions();

-- A notificacao nasce junto com o credito, dentro da mesma transacao. Assim
-- nao existe o caso de a venda gerar saldo e a mensagem se perder no frontend.
create or replace function public.notify_new_affiliate_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount text;
begin
  if NEW.affiliate_id is null or NEW.status<>'aprovada' then return NEW; end if;
  v_amount := replace(replace(replace(
    to_char(NEW.commission_value,'FM999,999,990.00'),',','#'),'.',','),'#','.');
  insert into public.notifications(to_user_id,icon,icon_bg,title,body,read)
  values(NEW.affiliate_id,'💰','var(--emeraldbg)','Nova venda!','Sua comissão: R$ '||v_amount,false);
  return NEW;
end;
$$;

revoke all on function public.notify_new_affiliate_commission() from public,anon,authenticated;
drop trigger if exists trg_notify_new_affiliate_commission on public.affiliate_commissions;
create trigger trg_notify_new_affiliate_commission
  after insert on public.affiliate_commissions
  for each row execute function public.notify_new_affiliate_commission();

comment on function public.get_my_affiliate_client_metrics() is
  'Metricas agregadas e limitadas aos clientes indicados pelo afiliado autenticado.';

