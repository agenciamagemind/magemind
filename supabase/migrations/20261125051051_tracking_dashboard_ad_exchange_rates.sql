create table public.tracking_ad_exchange_rates (
  currency text primary key check (currency in ('USD', 'EUR', 'JPY', 'KWD')),
  brl_rate numeric(20,12) not null check (brl_rate > 0 and brl_rate < 10000),
  quoted_at timestamptz not null,
  checked_at timestamptz not null default now()
);

alter table public.tracking_ad_exchange_rates enable row level security;
revoke all on public.tracking_ad_exchange_rates from public, anon, authenticated;
grant select on public.tracking_ad_exchange_rates to authenticated;
grant select, insert, update on public.tracking_ad_exchange_rates to service_role;
create policy tracking_ad_exchange_rates_read on public.tracking_ad_exchange_rates
  for select to authenticated using (true);

create function public.tracking_save_ad_exchange_rates(p jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.tracking_ad_exchange_rates as current_rate (currency, brl_rate, quoted_at, checked_at)
  select rate.currency, rate.brl_rate, rate.quoted_at, now()
  from jsonb_to_recordset(p) as rate(currency text, brl_rate numeric, quoted_at timestamptz)
  where rate.quoted_at <= now() + interval '2 minutes'
  on conflict (currency) do update
    set brl_rate = excluded.brl_rate, quoted_at = excluded.quoted_at, checked_at = excluded.checked_at
    where current_rate.quoted_at <= excluded.quoted_at
$$;

revoke execute on function public.tracking_save_ad_exchange_rates(jsonb) from public, anon, authenticated;
grant execute on function public.tracking_save_ad_exchange_rates(jsonb) to service_role;

create function public.tracking_dashboard_brl(w uuid, f date, t date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  report jsonb;
  quotes jsonb;
  missing_quote boolean;
  foreign_spend numeric;
  foreign_sync timestamptz;
  spend numeric;
  net numeric;
  profit numeric;
begin
  report := public.tracking_dashboard_report(w, f, t, 'BRL');

  with foreign_costs as (
    select stats.currency,
      sum(stats.spend_minor::numeric / power(10::numeric, stats.amount_scale)) as amount,
      max(stats.synced_at) as synced_at
    from public.tracking_ad_stats_daily stats
    join public.tracking_ad_accounts accounts using (workspace_id, provider, account_id)
    where stats.workspace_id = w and accounts.selected
      and stats.date between f and t and stats.currency <> 'BRL'
      and stats.breakdown = '' and stats.spend_minor > 0
    group by stats.currency
  )
  select coalesce(jsonb_agg(jsonb_build_object('currency', costs.currency, 'quoted_at', rate.quoted_at,
        'rate', rate.brl_rate, 'stale', rate.checked_at < now() - interval '15 minutes')
      order by costs.currency), '[]'::jsonb),
    coalesce(bool_or(rate.currency is null), false),
    round(sum(costs.amount * rate.brl_rate) * 100),
    max(costs.synced_at)
  into quotes, missing_quote, foreign_spend, foreign_sync
  from foreign_costs costs
  left join public.tracking_ad_exchange_rates rate using (currency);

  if quotes = '[]'::jsonb then
    return report;
  end if;

  if not missing_quote then
    spend := coalesce((report->>'spend_minor')::numeric, 0) + foreign_spend;
  end if;
  net := (report->>'net_minor')::numeric;
  profit := net - spend - (report->>'costs_minor')::numeric - (report->>'expense_minor')::numeric;

  return report || jsonb_build_object(
    'spend_minor', spend,
    'profit_minor', profit,
    'estimated_minor', case when not missing_quote then (report->>'estimated_minor')::numeric - foreign_spend end,
    'roas', case when spend > 0 then round(net / spend, 4) end,
    'roi', case when net - profit > 0 then round(profit / (net - profit) * 100, 2) end,
    'margin', case when net > 0 then round(profit / net * 100, 2) end,
    'last_sync', greatest((report->>'last_sync')::timestamptz, foreign_sync),
    'ad_exchange_rates', quotes,
    'ad_exchange_incomplete', missing_quote
  );
end
$$;

revoke execute on function public.tracking_dashboard_brl(uuid,date,date) from public, anon;
grant execute on function public.tracking_dashboard_brl(uuid,date,date) to authenticated;
