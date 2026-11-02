begin;

-- The sale opens booking immediately. The first consumed delivery starts the
-- monthly clock; its original ledger date is frozen even if its card changes.
alter table private.production_entitlements add column first_delivery_on date;
alter table private.production_entitlements add constraint production_first_delivery_check
 check(first_delivery_on is null or (cadence in('daily','weekly') and first_delivery_on>=starts_on
  and ends_on=private.production_month_end(first_delivery_on)));

with first_deliveries as (
 select e.id,min(s.delivery_date) first_on
 from private.production_entitlements e join private.production_demand_slots s on s.entitlement_id=e.id
 where e.cadence in('daily','weekly') and s.consumed and s.delivery_date>=e.starts_on
  and s.delivery_date<=private.production_today()
 group by e.id
)
update private.production_entitlements e set first_delivery_on=f.first_on,
 ends_on=private.production_month_end(f.first_on) from first_deliveries f where e.id=f.id;

create function private.anchor_production_first_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare e private.production_entitlements;first_on date;
begin
 if not new.consumed or new.entitlement_id is null then return new;end if;
 select * into e from private.production_entitlements where id=new.entitlement_id for update;
 if not found or e.cadence='package' or e.first_delivery_on is not null or new.delivery_date<e.starts_on then return new;end if;
 -- Completing a future-dated card early cannot start the clock in the future.
 first_on=greatest(e.starts_on,least(new.delivery_date,private.production_today()));
 update private.production_entitlements set first_delivery_on=first_on,
  ends_on=private.production_month_end(first_on) where id=e.id and first_delivery_on is null;
 return new;
end;$$;
revoke all on function private.anchor_production_first_delivery() from public,anon,authenticated;
create trigger anchor_production_first_delivery before insert or update of consumed,entitlement_id
 on private.production_demand_slots for each row execute function private.anchor_production_first_delivery();

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
  elsif p_date<coalesce(p.first_delivery_on,p.starts_on) or (p.ends_on is not null and p_date>p.ends_on) then reason='A data de entrega está fora da vigência contratada.';
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
   'cadence',p.cadence,'quantity',p.quantity,'weekdays',p.weekdays,'starts_on',coalesce(p.first_delivery_on,p.starts_on),'purchased_on',p.starts_on,'first_delivery_on',p.first_delivery_on,'ends_on',p.ends_on,
   'max_date',case when p.cadence='package' then package_end else p.ends_on end,
   'day_used',n_day,'week_used',n_week,'month_used',n_cycle,'total_used',n_total,
   'month_limit',case when p.cadence='weekly' then p.quantity*4 when p.cadence='package' then p.quantity else
     p.quantity*(select count(*) from generate_series(coalesce(p.first_delivery_on,p.starts_on)::timestamp,p.ends_on::timestamp,interval '1 day')d where extract(isodow from d)::smallint=any(p.weekdays)) end,
   'remaining',greatest(0,available),'reason',reason));
 end loop;
 return jsonb_build_object('date',p_date,'plans',items,'weekdays',days,'allowed',selected is not null,
  'plan_id',selected_plan,'entitlement_id',selected,'reason',case when selected is not null then null
   when jsonb_array_length(items)=0 then 'Nenhuma compra confirmada com vigência ativa está disponível para este cliente.'
   else coalesce((select item->>'reason' from jsonb_array_elements(items)item where item->>'reason' not like '%dia da semana%' limit 1),items->0->>'reason') end);
end;$$;

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
 if not (capacity->>'allowed')::boolean then
  capacity=coalesce(private.approved_schedule_capacity(new.id,target,new.due_date),capacity);
  if not (capacity->>'allowed')::boolean then raise exception '%',capacity->>'reason';end if;
 end if;
 delete from private.production_schedule_exceptions x where x.demand_id=new.id
  and (x.client_id is distinct from target or x.delivery_date is distinct from new.due_date
   or exists(select 1 from private.production_entitlements e where e.id=x.entitlement_id and new.due_date<=e.ends_on));
 insert into private.production_demand_slots(demand_id,client_id,plan_id,entitlement_id,delivery_date,consumed,created_at)
 values(new.id,target,(capacity->>'plan_id')::uuid,(capacity->>'entitlement_id')::uuid,new.due_date,new.status='Concluído',new.created_at)
 on conflict(demand_id) do update set client_id=excluded.client_id,plan_id=excluded.plan_id,entitlement_id=excluded.entitlement_id,
  delivery_date=excluded.delivery_date,consumed=private.production_demand_slots.consumed or excluded.consumed;
 return new;
end;$$;

create or replace function private.reschedule_demands_preserving_content(p_client uuid,p_changes jsonb,p_actor uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb;card public.demands;contract private.production_entitlements;
 before_cards jsonb;expected integer;changed integer=0;exceptions integer=0;next_date date;other_hash text;
begin
 if current_user<>'postgres' then raise exception 'Operação exclusiva da manutenção do banco.' using errcode='42501';end if;
 if not exists(select 1 from public.profiles where id=p_actor and role='ceo' and active and archived_at is null) then raise exception 'CEO inválido.';end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 500 then raise exception 'Lote inválido.';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Informe o motivo.';end if;
 expected=jsonb_array_length(p_changes);
 if (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_changes)x)<>expected then raise exception 'Demandas duplicadas.';end if;
 -- Trigger changes acquire the same exclusive lock, so no concurrent writer
 -- can observe disabled metadata triggers. Every statement rolls back on error.
 lock table public.demands in access exclusive mode;
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'Cliente inválido.';end if;
 for item in select value from jsonb_array_elements(p_changes) loop
  select * into card from public.demands where id=(item->>'id')::uuid;
  if not found or card.client_id is distinct from p_client or card.status not in('Não iniciado','Em andamento')
   or md5(to_jsonb(card)::text) is distinct from item->>'hash' then
   raise exception 'Uma demanda mudou desde a revisão. Nenhuma alteração foi aplicada.';
  end if;
  next_date=(item->>'new_date')::date;
  if next_date is null or next_date=card.due_date or extract(isodow from next_date) not between 1 and 5 then raise exception 'Nova data inválida.';end if;
  if exists(select 1 from private.production_demand_slots where demand_id=card.id and consumed) then raise exception 'Uma demanda já consumiu o serviço. Revise o lote.';end if;
 end loop;
 select jsonb_agg(to_jsonb(d) order by d.id) into before_cards from public.demands d
 where d.id in(select (x->>'id')::uuid from jsonb_array_elements(p_changes)x);
 select md5(string_agg(to_jsonb(d)::text,',' order by d.id)) into other_hash from public.demands d
 where d.id not in(select (x->>'id')::uuid from jsonb_array_elements(p_changes)x);
 if (select count(*) from pg_trigger where tgrelid='public.demands'::regclass and tgname in('demands_updated_at','zz_place_demand_chronologically') and tgenabled='O')<>2 then raise exception 'Triggers de metadados inesperados.';end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
 -- Waivers are only for the reviewed cards and exact approved dates.
 for item in select value from jsonb_array_elements(p_changes) loop
  if nullif(item->>'entitlement_id','') is not null then
   select * into contract from private.production_entitlements where id=(item->>'entitlement_id')::uuid and client_id=p_client and active;
   if not found or contract.ends_on is null or (item->>'new_date')::date<=contract.ends_on then raise exception 'Exceção de vigência inválida.';end if;
   insert into private.production_schedule_exceptions(demand_id,client_id,entitlement_id,delivery_date,authorized_by,reason)
   values((item->>'id')::uuid,p_client,contract.id,(item->>'new_date')::date,p_actor,btrim(p_reason));
   exceptions=exceptions+1;
  end if;
 end loop;
 -- Release only open reservations in this same transaction. Final allocations
 -- are checked by the normal guard including the daily/weekly quantity.
 delete from private.production_demand_slots where demand_id in(select (x->>'id')::uuid from jsonb_array_elements(p_changes)x) and not consumed;
 alter table public.demands disable trigger demands_updated_at;
 alter table public.demands disable trigger zz_place_demand_chronologically;
 for item in select value from jsonb_array_elements(p_changes) order by value->>'new_date' desc,value->>'id' loop
  update public.demands set due_date=(item->>'new_date')::date where id=(item->>'id')::uuid;
  changed=changed+1;
 end loop;
 alter table public.demands enable trigger demands_updated_at;
 alter table public.demands enable trigger zz_place_demand_chronologically;
 if changed<>expected or exists(select 1 from jsonb_array_elements(before_cards)b
  left join public.demands d on d.id=(b->>'id')::uuid where d.id is null or (to_jsonb(d)-'due_date') is distinct from (b-'due_date')) then raise exception 'Conteúdo inesperado: operação revertida.';end if;
 if other_hash is distinct from (select md5(string_agg(to_jsonb(d)::text,',' order by d.id)) from public.demands d where d.id not in(select (x->>'id')::uuid from jsonb_array_elements(p_changes)x)) then raise exception 'Outra demanda foi alterada: operação revertida.';end if;
 return jsonb_build_object('updated',changed,'exceptions',exceptions,'only_due_date_changed',true);
end;$$;

-- A waiver stops applying as soon as a card returns to the ordinary calendar.
delete from private.production_schedule_exceptions x
using public.demands d,private.production_entitlements e
where d.id=x.demand_id and e.id=x.entitlement_id and
 (x.client_id is distinct from d.client_id or x.delivery_date is distinct from d.due_date or d.due_date<=e.ends_on);

revoke all on function private.production_capacity(uuid,date,uuid) from public,anon,authenticated;
revoke all on function private.guard_production_capacity() from public,anon,authenticated;
revoke all on function private.reschedule_demands_preserving_content(uuid,jsonb,uuid,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
