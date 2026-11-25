-- Allow separate named manual tariffs within the same checkout and currency.
create or replace function public.tracking_save_cost(w uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v uuid; mode text := coalesce(p->>'calculation','legacy'); cat text := p->>'category';
  label text := trim(p->>'name'); amount bigint := (p->>'amount_minor')::bigint;
  rate integer := (p->>'rate_bps')::integer; cur text := p->>'currency';
  product text := nullif(p->>'product_id',''); prov text := nullif(p->>'provider',''); tz text;
  schedule jsonb := nullif(p->'fee_schedule','null');
  integration uuid := (nullif(p->>'integration_id',''))::uuid;
begin
  if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(w::text || ':costs',0));
  if integration is not null then
    select i.name, i.provider into label, prov from public.tracking_integrations i
      where i.workspace_id = w and i.id = integration and length(i.name) between 1 and 120;
    if not found then raise exception 'Integração indisponível nesta operação.'; end if;
  end if;
  if label is null or length(label) not between 1 and 120 or cur is null
    or cur not in ('BRL','USD','EUR','JPY','KWD')
    or cat is null or cat not in ('product','tax','fee','expense')
    or amount < 0 or amount > 9007199254740991 or rate < 0 or rate > 10000 or length(product) > 200
    or prov not in ('custom','kiwify','hotmart','cartpanda','perfectpay','kirvano','appmax','yampi','cakto') then
    raise exception 'Dados de custo inválidos';
  end if;
  if mode = 'fee_schedule' then
    if cat <> 'fee' or product is not null or rate is not null or amount is not null then
      raise exception 'Selecione uma taxa de pagamento válida.';
    end if;
    perform private.tracking_validate_fee(schedule);
    if exists (select 1 from public.tracking_cost_rules r
      where r.workspace_id = w and r.archived_at is null and r.currency = cur and r.calculation = 'fee_schedule'
        and r.provider is not distinct from prov and r.integration_id is not distinct from integration
        and (integration is not null or lower(trim(r.name)) = lower(label))) then
      if integration is not null then
        raise exception 'Já existe uma taxa vinculada a esta integração. Edite a taxa existente.';
      end if;
      raise exception 'Já existe uma taxa com esse nome para este checkout. Use outro nome ou edite a taxa existente.';
    end if;
  else
    if integration is not null or schedule is not null then raise exception 'Configuração de taxa inválida.'; end if;
    if mode <> 'legacy' then
      if not (
        (cat = 'product' and mode = 'fixed_per_item' and amount is not null and rate is null)
        or (cat in ('tax','fee','expense') and mode = 'percentage' and rate is not null and amount is null)
        or (cat in ('fee','expense') and mode = 'fixed_per_sale' and amount is not null and rate is null)
        or (cat = 'expense' and mode = 'fixed_once' and amount is not null and rate is null)
      ) then raise exception 'Selecione apenas valor fixo ou percentual compatível com o tipo'; end if;
      if exists (select 1 from public.tracking_cost_rules r
        where r.workspace_id = w and r.archived_at is null and r.currency = cur and r.category = cat
          and r.calculation <> 'fee_schedule'
          and (r.name = label or (cat = 'product' and r.product_id is not distinct from product and r.provider is not distinct from prov))) then
        raise exception 'Já existe um custo ativo para essa configuração. Edite o custo existente';
      end if;
    end if;
  end if;
  select timezone into tz from public.tracking_workspaces where id = w;
  insert into public.tracking_cost_rules (
    workspace_id, name, product_id, provider, category, calculation, amount_minor, rate_bps, currency,
    valid_from, valid_to, effective_from, fee_schedule, integration_id
  ) values (
    w, label, product, prov, cat, mode, amount, rate, cur,
    case when mode = 'legacy' then (p->>'valid_from')::date else (now() at time zone tz)::date end,
    case when mode = 'legacy' then (p->>'valid_to')::date end,
    case when mode <> 'legacy' then now() end, schedule, integration
  ) returning id into v;
  insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,auth.uid(),'cost.create',v::text);
  return v;
end $$;

create or replace function private.tracking_scheduled_fee(o public.tracking_orders, approval_day date) returns bigint
language sql stable set search_path = '' as $$
  -- Override broader defaults only when the more specific scope has a price for this payment.
  with applicable as (
    select picked.price
    from public.tracking_cost_rules r
    cross join lateral (select case
      when upper(o.payment_method) = 'PIX' then 'pix'
      when upper(o.payment_method) in ('CREDIT_CARD','CREDIT','CARD','CC','CREDITCARD','CREDIT_CARD_RECURRENT') then 'card'
    end as method) m
    left join lateral (
      select tier->m.method as price
      from jsonb_array_elements(coalesce(r.fee_schedule->'tiers','[]')) tier
      where tier ? m.method and o.gross_minor between (tier->>'min_minor')::bigint and (tier->>'max_minor')::bigint
      limit 1
    ) tier on true
    cross join lateral (select coalesce(
      case when m.method = 'card' then r.fee_schedule->'installments'->(o.installments::text) end,
      tier.price, r.fee_schedule->m.method
    ) as price) picked
    where r.workspace_id = o.workspace_id and r.currency = o.currency and r.calculation = 'fee_schedule'
      and (r.provider is null or r.provider = o.provider)
      and (r.integration_id is null or exists (select 1 from public.tracking_integrations i
        where i.workspace_id = o.workspace_id and i.id = r.integration_id and i.provider = o.provider and i.account_id = o.account_id))
      and r.valid_from <= approval_day and (r.valid_to is null or r.valid_to >= approval_day)
      and r.effective_from <= o.approved_at and (r.effective_until is null or o.approved_at < r.effective_until)
      and (o.recipient_minor is null or o.money_components->>'manual_fees' = 'true')
      and o.gateway_fee_minor is null
      and picked.price is not null
    order by (r.integration_id is not null) desc, (r.provider is not null) desc
    fetch first 1 row with ties
  )
  select least(o.gross_minor, sum(
    (price->>'amount_minor')::numeric
      + round(o.gross_minor::numeric * (price->>'rate_bps')::integer / 10000)
  ))::bigint
  from applicable
  having count(*) > 0
$$;
