begin;

-- Existing rows were historically inserted with sort_order = 0. Give every
-- card a stable position before exposing the reorder RPC.
with ranked as (
  select
    demand.id,
    row_number() over (
      partition by demand.status
      order by demand.sort_order asc nulls last, demand.created_at desc nulls last, demand.id
    ) - 1 as new_sort_order
  from public.demands demand
)
update public.demands demand
set sort_order = ranked.new_sort_order,
    updated_at = now()
from ranked
where demand.id = ranked.id
  and demand.sort_order is distinct from ranked.new_sort_order;

create or replace function public.reorder_demands(
  p_status text,
  p_demand_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  if v_role in ('ceo', 'manager', 'gestor') then
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
$$;

revoke all on function public.reorder_demands(text, uuid[]) from public, anon;
grant execute on function public.reorder_demands(text, uuid[]) to authenticated;

commit;
