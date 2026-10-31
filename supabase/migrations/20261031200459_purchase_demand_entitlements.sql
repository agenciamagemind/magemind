begin;

-- A catalog assignment is not a purchase. Freeze the terms of each confirmed
-- sale so editing a client/catalog cannot reset usage or change a paid quota.
create function private.production_today() returns date
language sql stable set search_path='' as $$select (now() at time zone 'America/Sao_Paulo')::date$$;
create function private.production_month_end(p_start date) returns date
language sql immutable strict set search_path='' as $$select (p_start+interval '1 month')::date$$;
revoke all on function private.production_today(),private.production_month_end(date) from public,anon,authenticated;

create table private.production_entitlements(
 id uuid primary key, -- original sale id, retained even if that sale is deleted
 client_id uuid not null references public.clients(id) on delete cascade,
 plan_id uuid references public.plans(id) on delete set null,
 name text not null,
 cadence text not null check(cadence in('daily','weekly','package')),
 quantity integer not null check(quantity between 1 and 10000),
 weekdays smallint[] not null,
 starts_on date not null,
 ends_on date, -- exclusive anniversary: 01/10 -> expires at 00:00 on 01/11
 active boolean not null,
 legacy_consumed integer not null default 0 check(legacy_consumed>=0),
 created_at timestamptz not null default now(),
 check((cadence='package' and ends_on is null) or (cadence<>'package' and ends_on>starts_on))
);
create index production_entitlements_client_idx on private.production_entitlements(client_id,starts_on,ends_on);
create index production_entitlements_plan_idx on private.production_entitlements(plan_id);
alter table private.production_entitlements enable row level security;
create policy production_entitlements_service on private.production_entitlements for all to service_role using(true) with check(true);
revoke all on private.production_entitlements from public,anon,authenticated;
grant all on private.production_entitlements to service_role;
alter table private.production_demand_slots add column entitlement_id uuid references private.production_entitlements(id);
create index production_slots_entitlement_date_idx on private.production_demand_slots(entitlement_id,delivery_date);

insert into private.production_entitlements(id,client_id,plan_id,name,cadence,quantity,weekdays,starts_on,ends_on,active,created_at)
select s.id,s.client_id,p.id,p.name,p.delivery_cadence,p.delivery_quantity,p.delivery_weekdays,
 coalesce(s.sale_date,(s.created_at at time zone 'America/Sao_Paulo')::date,private.production_today()),
 case when p.delivery_cadence<>'package' then private.production_month_end(coalesce(s.sale_date,(s.created_at at time zone 'America/Sao_Paulo')::date,private.production_today())) end,
 true,coalesce(s.created_at,now())
from public.sales s join public.plans p on p.id=s.plan_id
where s.status='Fechado' and s.value>0 and s.client_id is not null and p.delivery_cadence<>'none';

create function private.sync_production_purchase() returns trigger
language plpgsql security definer set search_path='' as $$
declare contract private.production_entitlements;plan public.plans;start_day date;
begin
 -- Use the same client lock as reservations; cancellation and booking serialize.
 if tg_op='DELETE' then
  perform 1 from public.clients where id=old.client_id for update;
  update private.production_entitlements set active=false where id=old.id;
  return old;
 end if;
 perform 1 from public.clients where id=new.client_id for update;
 select * into contract from private.production_entitlements where id=new.id;
 if found then
  if new.client_id is distinct from contract.client_id or new.plan_id is distinct from contract.plan_id
   or (tg_op='UPDATE' and new.sale_date is distinct from old.sale_date) then
   raise exception 'Esta venda já liberou produção. Cancele a venda e registre outra para alterar cliente, plano ou início da vigência.';
  end if;
  update private.production_entitlements set active=(new.status='Fechado' and new.value>0) where id=new.id;
 elsif new.status='Fechado' and new.value>0 and new.client_id is not null then
  select * into plan from public.plans where id=new.plan_id and delivery_cadence<>'none';
  if found then
   start_day=coalesce(new.sale_date,private.production_today());
   insert into private.production_entitlements(id,client_id,plan_id,name,cadence,quantity,weekdays,starts_on,ends_on,active)
   values(new.id,new.client_id,plan.id,plan.name,plan.delivery_cadence,plan.delivery_quantity,plan.delivery_weekdays,start_day,
    case when plan.delivery_cadence<>'package' then private.production_month_end(start_day) end,true);
  end if;
 end if;
 return new;
end;$$;
revoke all on function private.sync_production_purchase() from public,anon,authenticated;
create trigger zz_production_purchase after insert or update or delete on public.sales
for each row execute function private.sync_production_purchase();

-- Preserve existing reservations and completed consumption. Match them once,
-- chronologically, to actual purchases; never create free credits from links.
do $$declare slot record;chosen uuid;begin
 for slot in select * from private.production_demand_slots order by created_at,demand_id loop
  select e.id into chosen from private.production_entitlements e
  where e.client_id=slot.client_id and e.plan_id=slot.plan_id
   and slot.delivery_date>=e.starts_on and (e.ends_on is null or slot.delivery_date<e.ends_on)
  order by (case when e.cadence='package' then
   (select count(*) from private.production_demand_slots s where s.entitlement_id=e.id)>=e.quantity else false end),e.starts_on,e.created_at,e.id limit 1;
  if chosen is not null then update private.production_demand_slots set entitlement_id=chosen where demand_id=slot.demand_id;end if;
 end loop;
end;$$;

-- Before per-creative reservations, one completed card could fulfill an entire
-- package. A sale explicitly linked to that completed card is already fulfilled.
-- Preserve that known consumption without rewriting or duplicating any card.
update private.production_entitlements e set legacy_consumed=greatest(0,e.quantity-
 (select count(*) from private.production_demand_slots slot where slot.entitlement_id=e.id))
from public.sales s join public.demands d on d.id=s.demand_id and d.client_id=s.client_id
where e.id=s.id and e.cadence='package' and d.status='Concluído';

drop trigger production_plan_assigned on public.client_plans;
drop trigger production_primary_plan_assigned on public.clients;
create or replace function private.seed_production_slots(p_client uuid) returns void
language plpgsql security definer set search_path='' as $$begin return;end;$$;

create function private.production_contracts(p_client uuid)
returns setof private.production_entitlements language sql stable security invoker set search_path='' as $$
 select e.* from private.production_entitlements e join public.clients c on c.id=e.client_id
 where e.client_id=p_client and e.active and c.status='Ativo' and c.archived_at is null and not c.converted_to_team
 and e.starts_on<=private.production_today() and (e.ends_on is null or private.production_today()<e.ends_on)
 order by case e.cadence when 'daily' then 0 when 'weekly' then 1 else 2 end,e.ends_on nulls last,e.starts_on,e.id;
$$;
revoke all on function private.production_contracts(uuid) from public,anon,authenticated;
create or replace function private.production_plans(p_client uuid)
returns table(id uuid,name text,cadence text,quantity integer,weekdays smallint[],assigned_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select e.plan_id,e.name,e.cadence,e.quantity,e.weekdays,e.created_at from private.production_contracts(p_client)e;
$$;

create or replace function private.production_capacity(p_client uuid,p_date date,p_exclude uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare p record;items jsonb='[]'::jsonb;days smallint[]='{}';selected uuid;selected_plan uuid;
 n_day integer;n_week integer;n_cycle integer;n_total integer;available integer;reason text;
 week_start date=date_trunc('week',p_date)::date;
 created_day date=private.production_today();package_end date;
begin
 if p_exclude is not null then
  select (d.created_at at time zone 'America/Sao_Paulo')::date into created_day
  from public.demands d where d.id=p_exclude and d.client_id=p_client;
  created_day=coalesce(created_day,private.production_today());
 end if;
 package_end=private.production_month_end(created_day);
 for p in select * from private.production_contracts(p_client) loop
  select count(*) filter(where s.delivery_date=p_date),
   count(*) filter(where s.delivery_date>=week_start and s.delivery_date<week_start+7),count(*),count(*)
  into n_day,n_week,n_cycle,n_total from private.production_demand_slots s
  where s.entitlement_id=p.id and (p_exclude is null or s.demand_id<>p_exclude or s.consumed);
  n_total=n_total+p.legacy_consumed;
  available=case p.cadence when 'daily' then p.quantity-n_day
   when 'weekly' then least(p.quantity-n_week,p.quantity*4-n_cycle) else p.quantity-n_total end;
  reason=null;
  if p_date is null then reason='Escolha uma data de entrega.';
  elsif p_date<p.starts_on or (p.ends_on is not null and p_date>=p.ends_on) then reason='A data de entrega está fora da vigência contratada.';
  elsif p.cadence='package' and p_date>package_end then reason='Pacotes permitem entrega até um mês após a criação da demanda.';
  elsif not extract(isodow from p_date)::smallint=any(p.weekdays) then reason='O plano não inclui entregas neste dia da semana.';
  elsif available<=0 then reason=case when p.cadence='daily' then 'O limite de criativos para este dia foi atingido.'
   when p.cadence='weekly' and n_cycle>=p.quantity*4 then 'O limite de criativos deste ciclo mensal foi atingido.'
   when p.cadence='weekly' then 'O limite de criativos para esta semana foi atingido.' else 'Todos os criativos deste pacote já foram utilizados.' end;
  end if;
  if reason is not null then available=0;
  elsif selected is null then selected=p.id;selected_plan=p.plan_id;end if;
  days=array(select distinct unnest(days||p.weekdays) order by 1);
  items=items||jsonb_build_array(jsonb_build_object('id',p.plan_id,'entitlement_id',p.id,'name',p.name,
   'cadence',p.cadence,'quantity',p.quantity,'weekdays',p.weekdays,'starts_on',p.starts_on,'ends_on',p.ends_on,
   'max_date',case when p.cadence='package' then package_end else p.ends_on-1 end,
   'day_used',n_day,'week_used',n_week,'month_used',n_cycle,'total_used',n_total,
   'month_limit',case when p.cadence='weekly' then p.quantity*4 when p.cadence='package' then p.quantity else
     p.quantity*(select count(*) from generate_series(p.starts_on::timestamp,(p.ends_on-1)::timestamp,interval '1 day')d where extract(isodow from d)::smallint=any(p.weekdays)) end,
   'remaining',greatest(0,available),'reason',reason));
 end loop;
 return jsonb_build_object('date',p_date,'plans',items,'weekdays',days,'allowed',selected is not null,
  'plan_id',selected_plan,'entitlement_id',selected,'reason',case when selected is not null then null
   when jsonb_array_length(items)=0 then 'Nenhuma compra confirmada com vigência ativa está disponível para este cliente.'
   else coalesce((select item->>'reason' from jsonb_array_elements(items)item where item->>'reason' not like '%dia da semana%' limit 1),items->0->>'reason') end);
end;$$;

create function private.client_has_purchased_production() returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(select 1 from public.profiles p
 where p.id=auth.uid() and p.role='client' and p.active and p.archived_at is null
 and exists(select 1 from private.production_contracts(p.client_id)));
$$;
revoke all on function private.client_has_purchased_production() from public,anon;
grant execute on function private.client_has_purchased_production() to authenticated;
create or replace function public.client_has_demand_management_plan() returns boolean
language sql stable security invoker set search_path='' as $$select private.client_has_purchased_production()$$;

create or replace function private.guard_production_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;slot private.production_demand_slots;capacity jsonb;role_name text=public.current_user_role();
begin
 target=case when tg_op='DELETE' then old.client_id else new.client_id end;
 -- Lock both clients in deterministic order when staff transfers a card.
 if tg_op='UPDATE' then
  perform 1 from public.clients where id in(target,old.client_id) order by id for update;
 else perform 1 from public.clients where id=target for update;end if;
 if tg_op='DELETE' then
  delete from private.production_demand_slots where demand_id=old.id and not consumed;
  return old;
 end if;
 if tg_op='INSERT' then new.created_at=now();
 elsif new.created_at is distinct from old.created_at then
  raise exception 'A data de criação da demanda não pode ser alterada.';
 end if;
 if tg_op='UPDATE' and new.client_id is not distinct from old.client_id and new.due_date is not distinct from old.due_date then
  if new.status='Concluído' then update private.production_demand_slots set consumed=true where demand_id=new.id;end if;
  return new;
 end if;
 select * into slot from private.production_demand_slots where demand_id=new.id;
 if found and slot.consumed then
  if tg_op='INSERT' then raise exception 'Esta demanda já consumiu um criativo e não pode ser recriada.';end if;
  if role_name='client' then raise exception 'Uma entrega já concluída mantém a data de consumo do plano. Peça à equipe para revisar a data.';end if;
  return new;
 end if;
 if target is null then
  if role_name='client' then raise exception 'Selecione o cliente da compra.';end if;
  delete from private.production_demand_slots where demand_id=new.id and not consumed;return new;
 end if;
 if new.due_date is null then raise exception 'Escolha uma data de entrega para utilizar a compra.';end if;
 if role_name='client' and new.due_date<private.production_today()+1 then raise exception 'As entregas devem ser agendadas a partir de amanhã.';end if;
 capacity=private.production_capacity(target,new.due_date,case when tg_op='UPDATE' then new.id end);
 if not (capacity->>'allowed')::boolean then raise exception '%',capacity->>'reason';end if;
 insert into private.production_demand_slots(demand_id,client_id,plan_id,entitlement_id,delivery_date,consumed,created_at)
 values(new.id,target,(capacity->>'plan_id')::uuid,(capacity->>'entitlement_id')::uuid,new.due_date,new.status='Concluído',new.created_at)
 on conflict(demand_id) do update set client_id=excluded.client_id,plan_id=excluded.plan_id,entitlement_id=excluded.entitlement_id,
  delivery_date=excluded.delivery_date,consumed=private.production_demand_slots.consumed or excluded.consumed;
 return new;
end;$$;

-- Finite search, bounded by the purchased term (or the package's one-month
-- delivery horizon). All callers use the exact same allocation rules.
create or replace function private.next_production_date(p_client uuid,p_start date,p_exclude uuid default null)
returns date language plpgsql volatile security invoker set search_path='' as $$
declare max_day date;day_date date;created_day date=private.production_today();capacity jsonb;
begin
 if p_exclude is not null then select (created_at at time zone 'America/Sao_Paulo')::date into created_day from public.demands where id=p_exclude and client_id=p_client;end if;
 select max(case when cadence='package' then private.production_month_end(coalesce(created_day,private.production_today())) else ends_on-1 end)
 into max_day from private.production_contracts(p_client);
 if max_day is null or p_start>max_day then return null;end if;
 for day_date in select d::date from generate_series(p_start::timestamp,max_day::timestamp,interval '1 day')d loop
  capacity=private.production_capacity(p_client,day_date,p_exclude);
  if (capacity->>'allowed')::boolean then return day_date;end if;
 end loop;
 return null;
end;$$;

create or replace function private.authorized_demand_capacity(p_client uuid,p_date date,p_exclude uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare role_name text=public.current_user_role();result jsonb;
begin
 if not public.is_active_user() or auth.uid() is null or role_name not in('ceo','manager','partner','gestor','editor','client') then raise exception 'Sem permissão.' using errcode='42501';end if;
 if role_name='client' and p_client is distinct from public.my_client_id() then raise exception 'Sem permissão.' using errcode='42501';end if;
 if role_name='editor' and not exists(select 1 from public.demands d where d.client_id=p_client and d.assignee_id=auth.uid()) then raise exception 'Sem permissão.' using errcode='42501';end if;
 if p_exclude is not null and not exists(select 1 from public.demands d where d.id=p_exclude and d.client_id=p_client) then raise exception 'Demanda inválida.';end if;
 result=private.production_capacity(p_client,p_date,p_exclude);
 if role_name='client' and p_date<private.production_today()+1 then result=result||jsonb_build_object('allowed',false,'reason','As entregas devem ser agendadas a partir de amanhã.');end if;
 return result;
end;$$;

create or replace function private.authorized_demand_calendar(p_client uuid,p_month date,p_exclude uuid,p_find_next boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare month_start date=date_trunc('month',coalesce(p_month,private.production_today()+1))::date;
 tomorrow date=private.production_today()+1;minimum date;maximum date;first_capacity jsonb;capacity jsonb;
 day_date date;days jsonb='[]'::jsonb;next_date date;
begin
 first_capacity=private.authorized_demand_capacity(p_client,month_start,p_exclude);
 minimum=case when public.current_user_role()='client' or p_exclude is null then tomorrow else null end;
 select max((p->>'max_date')::date) into maximum from jsonb_array_elements(first_capacity->'plans')p;
 for day_date in select d::date from generate_series(month_start::timestamp,(month_start+interval '1 month - 1 day')::timestamp,interval '1 day')d loop
  capacity=private.production_capacity(p_client,day_date,p_exclude);
  days=days||jsonb_build_array(jsonb_build_object('date',day_date,'available',
   (minimum is null or day_date>=minimum) and (capacity->>'allowed')::boolean));
 end loop;
 if p_find_next then next_date=private.next_production_date(p_client,tomorrow,p_exclude);end if;
 return jsonb_build_object('month',month_start,'days',days,'has_plans',jsonb_array_length(first_capacity->'plans')>0,
  'min_date',minimum,'max_date',maximum,'next_date',next_date,'reason',first_capacity->>'reason');
end;$$;

notify pgrst,'reload schema';
commit;
