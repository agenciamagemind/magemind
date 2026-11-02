begin;

-- Date overrides do not grant purchases, add package units, change contract
-- dates or broaden which cards each role can edit.
create function private.staff_delivery_date_capacity(p_client uuid,p_date date,p_exclude uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare role_name text=public.current_user_role();slot private.production_demand_slots;e private.production_entitlements;
begin
 if p_date is null or auth.uid() is null or not public.is_active_user()
  or role_name not in('ceo','manager','partner','gestor','editor') then return null;end if;
 if role_name='editor' and (p_exclude is null or not exists(select 1 from public.demands d
  where d.id=p_exclude and d.client_id=p_client and d.assignee_id=auth.uid())) then return null;end if;
 -- Moving an existing reservation changes only its date, even after expiry.
 if p_exclude is not null then
  select s.* into slot from private.production_demand_slots s join public.demands d on d.id=s.demand_id
  where s.demand_id=p_exclude and s.client_id=p_client and d.client_id=p_client;
  if found then return jsonb_build_object('allowed',true,'reason',null,'plan_id',slot.plan_id,'entitlement_id',slot.entitlement_id);end if;
 end if;
 -- A new reservation still needs a confirmed active purchase and total units.
 for e in select * from private.production_contracts(p_client) loop
  if e.cadence='daily' or (select count(*) from private.production_demand_slots s where s.entitlement_id=e.id
   and (p_exclude is null or s.demand_id<>p_exclude or s.consumed))+e.legacy_consumed
   <(case when e.cadence='weekly' then e.quantity*4 else e.quantity end) then
   return jsonb_build_object('allowed',true,'reason',null,'plan_id',e.plan_id,'entitlement_id',e.id);
  end if;
 end loop;
 return null;
end;$$;
revoke all on function private.staff_delivery_date_capacity(uuid,date,uuid) from public,anon,authenticated;

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
 capacity=coalesce(private.staff_delivery_date_capacity(target,new.due_date,case when tg_op='UPDATE' then new.id end),
  private.production_capacity(target,new.due_date,case when tg_op='UPDATE' then new.id end));
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

create or replace function private.authorized_demand_capacity(p_client uuid,p_date date,p_exclude uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare role_name text=public.current_user_role();result jsonb;
begin
 if not public.is_active_user() or auth.uid() is null or role_name not in('ceo','manager','partner','gestor','editor','client') then raise exception 'Sem permissão.' using errcode='42501';end if;
 if role_name='client' and p_client is distinct from public.my_client_id() then raise exception 'Sem permissão.' using errcode='42501';end if;
 if role_name='editor' and not exists(select 1 from public.demands d where d.client_id=p_client and d.assignee_id=auth.uid()) then raise exception 'Sem permissão.' using errcode='42501';end if;
 if p_exclude is not null and not exists(select 1 from public.demands d where d.id=p_exclude and d.client_id=p_client) then raise exception 'Demanda inválida.';end if;
 result=private.production_capacity(p_client,p_date,p_exclude);
 result=result||coalesce(private.staff_delivery_date_capacity(p_client,p_date,p_exclude),'{}'::jsonb);
 if role_name='client' and p_date<private.production_today()+1 then result=result||jsonb_build_object('allowed',false,'reason','As entregas devem ser agendadas a partir de amanhã.');end if;
 return result;
end;$$;

create or replace function public.guard_editor_demand_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() = 'editor' then
    if old.assignee_id is distinct from (select auth.uid())
       or new.assignee_id is distinct from (select auth.uid()) then
      raise exception 'Editor can update only assigned demands';
    end if;
    if new.id is distinct from old.id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.refs is distinct from old.refs
       or new.client_id is distinct from old.client_id
       or new.assignee_id is distinct from old.assignee_id
       or new.priority is distinct from old.priority
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Editors can change only demand status and order';
    end if;
  end if;
  return new;
end;
$$;


notify pgrst,'reload schema';
commit;
