alter table public.tracking_orders
  add column installments smallint check (installments between 1 and 60);

-- The receipt processor stores normalized payment metadata before recording the cost.
create function private.tracking_order_payment() returns trigger
language plpgsql set search_path = '' as $$
declare
  method text := new.money_components->>'payment_method';
  count_text text := new.money_components->>'installments';
begin
  if method ~ '^[A-Z][A-Z0-9_]{0,39}$'
    and (method <> 'OTHER' or new.payment_method is null) then
    new.payment_method := method;
  end if;
  if new.payment_method in ('CREDIT_CARD','CREDIT','CARD','CC','CREDITCARD','CREDIT_CARD_RECURRENT') then
    if count_text ~ '^[0-9]{1,2}$' and count_text::integer between 1 and 60 then
      new.installments := count_text::smallint;
    end if;
  else
    new.installments := null;
  end if;
  return new;
end $$;
revoke all on function private.tracking_order_payment() from public, anon, authenticated;
create trigger tracking_order_payment before update of money_components on public.tracking_orders
  for each row execute function private.tracking_order_payment();

alter table public.tracking_cost_rules
  add column fee_schedule jsonb,
  add column integration_id uuid,
  add constraint tracking_cost_integration foreign key (workspace_id, integration_id)
    references public.tracking_integrations(workspace_id, id) on delete cascade;

alter table public.tracking_cost_rules drop constraint tracking_cost_mode_check;
-- Older installations have an unnamed check requiring a fixed amount or percentage.
do $$
declare old_check text;
begin
  select conname into strict old_check from pg_constraint
    where conrelid = 'public.tracking_cost_rules'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) = 'CHECK (((amount_minor IS NOT NULL) OR (rate_bps IS NOT NULL)))';
  execute format('alter table public.tracking_cost_rules drop constraint %I', old_check);
end $$;

alter table public.tracking_cost_rules add constraint tracking_cost_mode_check check (
  case when calculation = 'fee_schedule' then
    category = 'fee' and product_id is null and amount_minor is null and rate_bps is null
      and fee_schedule is not null and jsonb_typeof(fee_schedule) = 'object'
  else
    fee_schedule is null and integration_id is null and (amount_minor is not null or rate_bps is not null)
    and (
      calculation = 'legacy'
      or (calculation = 'fixed_per_item' and category = 'product' and amount_minor is not null and rate_bps is null)
      or (calculation = 'percentage' and category in ('tax','fee','expense') and rate_bps is not null and amount_minor is null)
      or (calculation = 'fixed_per_sale' and category in ('fee','expense') and amount_minor is not null and rate_bps is null)
      or (calculation = 'fixed_once' and category = 'expense' and amount_minor is not null and rate_bps is null)
    )
  end
);

create index tracking_cost_integration_history on public.tracking_cost_rules(workspace_id, integration_id)
  where integration_id is not null;
create index tracking_fee_timeline on public.tracking_cost_rules(workspace_id, currency, effective_from)
  where calculation = 'fee_schedule';

create function private.tracking_fee_price_valid(price jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(price) = 'object'
      and jsonb_typeof(price->'rate_bps') = 'number'
      and jsonb_typeof(price->'amount_minor') = 'number'
      and (price->>'rate_bps') ~ '^[0-9]{1,5}$'
      and (price->>'amount_minor') ~ '^[0-9]{1,16}$'
      and case when (price->>'rate_bps') ~ '^[0-9]{1,5}$' and (price->>'amount_minor') ~ '^[0-9]{1,16}$'
        then (price->>'rate_bps')::integer <= 10000 and (price->>'amount_minor')::bigint <= 9007199254740991
        else false end,
    false
  )
$$;

create function private.tracking_validate_fee(schedule jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare item record; tier jsonb; previous_max bigint := -1; low bigint; high bigint;
begin
  if schedule is null or jsonb_typeof(schedule) <> 'object'
    or schedule - array['pix','card','installments','tiers'] <> '{}'::jsonb
    or jsonb_typeof(coalesce(schedule->'installments','{}')) <> 'object'
    or jsonb_typeof(coalesce(schedule->'tiers','[]')) <> 'array'
    or jsonb_array_length(coalesce(schedule->'tiers','[]')) > 8
    or (not (schedule ?| array['pix','card']) and coalesce(schedule->'installments','{}') = '{}'::jsonb) then
    raise exception 'Configure ao menos uma tarifa de Pix ou cartão.';
  end if;
  for item in select key, value from jsonb_each(schedule - array['installments','tiers']) loop
    if not private.tracking_fee_price_valid(item.value) then raise exception 'Informe uma taxa válida para Pix ou cartão.'; end if;
  end loop;
  for item in select key, value from jsonb_each(coalesce(schedule->'installments','{}')) loop
    if item.key !~ '^([1-9]|[1-5][0-9]|60)$' or not private.tracking_fee_price_valid(item.value) then
      raise exception 'Informe taxas válidas de 1 a 60 parcelas.';
    end if;
  end loop;
  for tier in select value from jsonb_array_elements(coalesce(schedule->'tiers','[]')) loop
    if jsonb_typeof(tier) <> 'object' or tier - array['min_minor','max_minor','pix','card'] <> '{}'::jsonb
      or coalesce(tier->>'min_minor','') !~ '^[0-9]{1,15}$' or coalesce(tier->>'max_minor','') !~ '^[0-9]{1,15}$'
      or not (tier ?| array['pix','card'])
      or (tier ? 'pix' and not private.tracking_fee_price_valid(tier->'pix'))
      or (tier ? 'card' and not private.tracking_fee_price_valid(tier->'card')) then
      raise exception 'Informe valores válidos para a faixa de preço.';
    end if;
    low := (tier->>'min_minor')::bigint;
    high := (tier->>'max_minor')::bigint;
    if low <= previous_max or high < low then raise exception 'As faixas de preço devem ser crescentes e sem sobreposição.'; end if;
    previous_max := high;
  end loop;
end $$;
revoke all on function private.tracking_fee_price_valid(jsonb), private.tracking_validate_fee(jsonb) from public, anon, authenticated;

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
        and r.provider is not distinct from prov and r.integration_id is not distinct from integration) then
      raise exception 'Já existe uma taxa para esta integração ou checkout. Edite a taxa existente.';
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

create function private.tracking_scheduled_fee(o public.tracking_orders, approval_day date) returns bigint
language sql stable set search_path = '' as $$
  select least(o.gross_minor,
    (picked.price->>'amount_minor')::bigint
      + round(o.gross_minor::numeric * (picked.price->>'rate_bps')::integer / 10000)::bigint
  )
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
  order by (r.integration_id is not null) desc, (r.provider is not null) desc, r.effective_from desc
  limit 1
$$;
revoke all on function private.tracking_scheduled_fee(public.tracking_orders,date) from public, anon;
grant execute on function private.tracking_scheduled_fee(public.tracking_orders,date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tracking_order_costs(w uuid, oid uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.tracking_orders; approval_date date; base bigint; extra bigint; scheduled_fee bigint;
begin
 select * into strict o from public.tracking_orders where workspace_id=w and id=oid;
 select(o.approved_at at time zone timezone)::date into approval_date from public.tracking_workspaces where id=w;
 scheduled_fee := private.tracking_scheduled_fee(o, approval_date);
 select case when bool_or(cr.id is null and not exists(select 1 from public.tracking_cost_rules prior where prior.workspace_id=w and prior.category='product' and prior.currency=o.currency and(prior.provider is null or prior.provider=o.provider) and(prior.product_id is null or prior.product_id=it.product_id) and prior.effective_until<=o.approved_at)) and scheduled_fee is null and not exists(select 1 from public.tracking_cost_rules configured where configured.workspace_id=w and configured.category<>'product' and configured.calculation<>'fee_schedule' and configured.currency=o.currency and(configured.provider is null or configured.provider=o.provider) and configured.valid_from<=approval_date and(configured.effective_from is null or configured.effective_from<=o.approved_at)) then null
 else coalesce(sum(coalesce(cr.amount_minor,0)*it.quantity+(it.amount_minor*coalesce(cr.rate_bps,0)+5000)/10000),0) end into base
 from public.tracking_order_items it left join lateral (
  select r.* from public.tracking_cost_rules r where r.workspace_id=w and r.category='product' and r.currency=o.currency and(r.provider is null or r.provider=o.provider)
  and(r.product_id=it.product_id or r.product_id is null) and r.valid_from<=approval_date and(r.valid_to is null or r.valid_to>=approval_date)
  and(r.effective_from is null or r.effective_from<=o.approved_at) and(r.effective_until is null or o.approved_at<r.effective_until)
  order by(r.product_id is not null) desc,(r.provider is not null) desc,r.valid_from desc,r.effective_from desc nulls last,r.created_at desc limit 1
 ) cr on true where it.order_id=oid;
 select coalesce(sum(coalesce(r.amount_minor,0)+(o.gross_minor*coalesce(r.rate_bps,0)+5000)/10000),0) into extra from(
  select distinct on(name,category) * from public.tracking_cost_rules r where r.workspace_id=w and r.currency=o.currency and(r.provider is null or r.provider=o.provider)
  and(r.category in ('tax','fee') or(r.category='expense' and r.calculation in ('percentage','fixed_per_sale')))
  and r.valid_from<=approval_date and(r.valid_to is null or r.valid_to>=approval_date) and(r.effective_from is null or r.effective_from<=o.approved_at) and(r.effective_until is null or o.approved_at<r.effective_until)
  and r.calculation <> 'fee_schedule'
  and (r.category <> 'fee' or (scheduled_fee is null and (o.recipient_minor is null or o.money_components->>'manual_fees'='true') and o.gateway_fee_minor is null))
  order by name,category,r.valid_from desc,r.effective_from desc nulls last,r.created_at desc
 )r;
 return base + extra + coalesce(scheduled_fee, 0);
end $function$;

CREATE OR REPLACE FUNCTION public.tracking_dashboard_order_cost(w uuid, oid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.tracking_orders; tz text; first_config timestamptz; ref timestamptz; ref_day date; recorded bigint;
 product bigint:=0;tax bigint:=0;fee bigint:=0;extra bigint:=0; total bigint; r record; amount bigint; remaining bigint; scheduled_fee bigint;
begin
 if not private.tracking_access(w) then raise exception 'Forbidden';end if;
 select * into strict o from public.tracking_orders where workspace_id=w and id=oid;
 select timezone into tz from public.tracking_workspaces where id=w;
 scheduled_fee := private.tracking_scheduled_fee(o, (o.approved_at at time zone tz)::date);
 fee := coalesce(scheduled_fee, 0);
 select case when bool_or(cost_delta_minor is null) then null else coalesce(sum(cost_delta_minor),0) end into recorded from public.tracking_ledger where order_id=oid;
 select min(coalesce(effective_from,valid_from::timestamp at time zone tz)) into first_config from public.tracking_cost_rules where workspace_id=w and currency=o.currency and calculation <> 'fee_schedule';
 if recorded is null and first_config is null and scheduled_fee is null then return jsonb_build_object('total',null,'estimated',false);end if;
 ref:=case when recorded is null then greatest(o.approved_at,first_config) else o.approved_at end;
 ref_day:=(ref at time zone tz)::date;
 select coalesce(sum(coalesce(c.amount_minor,0)*it.quantity+(it.amount_minor*coalesce(c.rate_bps,0)+5000)/10000),0) into product
 from public.tracking_order_items it left join lateral(
  select cr.* from public.tracking_cost_rules cr where cr.workspace_id=w and cr.category='product' and cr.currency=o.currency and(cr.provider is null or cr.provider=o.provider)
  and(cr.product_id is null or cr.product_id=it.product_id) and cr.valid_from<=ref_day and(cr.valid_to is null or cr.valid_to>=ref_day)
  and(cr.effective_from is null or cr.effective_from<=ref) and(cr.effective_until is null or ref<cr.effective_until)
  order by(cr.product_id is not null) desc,(cr.provider is not null) desc,cr.valid_from desc,cr.effective_from desc nulls last,cr.created_at desc limit 1
 ) c on true where it.order_id=oid;
 for r in select distinct on(name,category) * from public.tracking_cost_rules c where c.workspace_id=w and c.currency=o.currency and(c.provider is null or c.provider=o.provider)
  and(c.category in('tax','fee') or(c.category='expense' and c.calculation in('percentage','fixed_per_sale')))
  and c.valid_from<=ref_day and(c.valid_to is null or c.valid_to>=ref_day) and(c.effective_from is null or c.effective_from<=ref) and(c.effective_until is null or ref<c.effective_until)
  and c.calculation <> 'fee_schedule'
  and (c.category <> 'fee' or (scheduled_fee is null and (o.recipient_minor is null or o.money_components->>'manual_fees'='true') and o.gateway_fee_minor is null))
  order by name,category,valid_from desc,effective_from desc nulls last,created_at desc
 loop
  amount:=coalesce(r.amount_minor,0)+(o.gross_minor*coalesce(r.rate_bps,0)+5000)/10000;
  if r.category='tax' then tax:=tax+amount;elsif r.category='fee' then fee:=fee+amount;else extra:=extra+amount;end if;
 end loop;
 total:=coalesce(recorded,product+tax+fee+extra);
 if recorded is not null and recorded<>product+tax+fee+extra then
  remaining:=greatest(recorded,0);product:=least(product,remaining);remaining:=remaining-product;
  tax:=least(tax,remaining);remaining:=remaining-tax;fee:=least(fee,remaining);extra:=remaining-fee;
 end if;
 return jsonb_build_object('total',total,'product',product,'tax',tax,'manual_fees',fee,'extra',extra,'estimated',recorded is null,'reference_at',ref);
end $function$;

CREATE OR REPLACE FUNCTION public.tracking_update_cost(w uuid, c uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.tracking_cost_rules; v uuid;
begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||':costs',0));
 select * into old from public.tracking_cost_rules where workspace_id=w and id=c for update;
 if not found or old.archived_at is not null then raise exception 'Esse custo já foi alterado ou removido. Atualize a lista'; end if;
 update public.tracking_cost_rules set archived_at=now(),effective_until=now() where id=c;
 if old.integration_id is not null then
   p := p || jsonb_build_object('integration_id', old.integration_id);
 end if;
 v:=public.tracking_save_cost(w,p);
 update public.tracking_cost_rules set supersedes_id=c where id=v;
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id,details) values(w,auth.uid(),'cost.update',v::text,jsonb_build_object('previous_id',c));
 return v;
end $function$;
