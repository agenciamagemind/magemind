create table public.tracking_catalog_snapshots (
  integration_id uuid primary key,
  workspace_id uuid not null,
  cipher text not null,
  currency text not null check (currency in ('BRL','USD','EUR','JPY','KWD')),
  edit_until timestamptz,
  allow_edit boolean not null default false,
  products jsonb not null check (jsonb_typeof(products) = 'array'),
  revision uuid not null default gen_random_uuid(),
  synced_at timestamptz not null default now(),
  foreign key (workspace_id, integration_id)
    references public.tracking_integrations (workspace_id, id) on delete cascade
);
create index tracking_catalog_snapshots_workspace on public.tracking_catalog_snapshots (workspace_id);
alter table public.tracking_catalog_snapshots enable row level security;
revoke all on public.tracking_catalog_snapshots from public, anon, authenticated;
grant select (integration_id, workspace_id, currency, allow_edit, products, revision, synced_at)
  on public.tracking_catalog_snapshots to authenticated;
grant select, insert, update on public.tracking_catalog_snapshots to service_role;
create policy tracking_catalog_snapshots_read on public.tracking_catalog_snapshots
  for select to authenticated using (private.tracking_access(workspace_id));

create function public.tracking_catalog(w uuid, q text default '', p integer default 1)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with operation as (
    select currency from public.tracking_workspaces where id = w and private.tracking_access(w)
  ),
  sources as (
    select i.id, i.name, i.provider, s.synced_at, s.currency, s.allow_edit, s.products
    from public.tracking_integrations i
    left join public.tracking_catalog_snapshots s on s.workspace_id = w and s.integration_id = i.id
    where i.workspace_id = w and i.connected and i.provider = 'cartpanda'
      and exists (select 1 from operation)
  ),
  observed as (
    select distinct on (o.provider, it.product_id, o.currency)
      o.provider, it.product_id, o.currency, it.name, i.name as store
    from public.tracking_orders o
    join public.tracking_order_items it on it.workspace_id = o.workspace_id and it.order_id = o.id
    left join public.tracking_integrations i on i.workspace_id = o.workspace_id
      and i.provider = o.provider and i.account_id = o.account_id
    where o.workspace_id = w and exists (select 1 from operation)
      and btrim(it.product_id) <> '' and length(it.product_id) <= 200
      and not exists (select 1 from sources s where s.id = i.id and s.synced_at is not null)
    order by o.provider, it.product_id, o.currency, o.created_at desc, o.id desc, it.line
  ),
  imported as (
    select x.product_id, x.name, x.image_url, x.price_minor, x.compare_minor,
      x.sku, x.has_variants, x.version, s.provider, s.name as store, s.currency,
      s.id as integration_id, s.allow_edit and x.version is not null as editable
    from sources s
    cross join lateral jsonb_to_recordset(s.products) as x(
      product_id text, name text, image_url text, price_minor bigint, compare_minor bigint,
      sku text, has_variants boolean, version text
    )
  ),
  catalog as (
    select * from imported
    union all
    select product_id, name, null, null, null, null, false, null,
      provider, store, currency, null, false
    from observed h
    where not exists (
      select 1 from imported s
      where s.provider = h.provider and s.product_id = h.product_id and s.currency = h.currency
    )
  ),
  matches as (
    select * from catalog
    where strpos(lower(concat_ws(' ', name, sku, product_id, store)), lower(left(coalesce(q, ''), 120))) > 0
       or btrim(coalesce(q, '')) = ''
  ),
  page as (
    select * from matches order by lower(name), provider, product_id, currency, integration_id
    limit 24 offset (greatest(1, least(coalesce(p, 1), 1000000)) - 1) * 24
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('cost_minor', r.amount_minor)
      order by lower(c.name), c.provider, c.product_id, c.currency, c.integration_id)
      from page c
      left join lateral (
        select amount_minor from public.tracking_cost_rules
        where workspace_id = w and category = 'product' and archived_at is null
          and effective_until is null and product_id = c.product_id and currency = c.currency
          and (provider = c.provider or provider is null)
        order by (provider is not null) desc, effective_from desc, created_at desc limit 1
      ) r on true), '[]'::jsonb),
    'total', (select count(*) from matches),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'synced_at', synced_at, 'allow_edit', allow_edit
    ) order by name, id) from sources), '[]'::jsonb)
  );
$$;

revoke execute on function public.tracking_catalog(uuid, text, integer) from public, anon;
grant execute on function public.tracking_catalog(uuid, text, integer) to authenticated;
