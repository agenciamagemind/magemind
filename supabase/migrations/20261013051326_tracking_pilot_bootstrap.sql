do $$begin if to_regclass('public.tracking_workspaces') is not null then raise exception 'Tracking already installed';end if;if(select count(*) from auth.users where lower(email)='gabrielmelo@gmail.com' and email_confirmed_at is not null)<>1 then raise exception 'Confirmed pilot account required';end if;end $$;
 create table private.tracking_environment(id text primary key,environment text not null);insert into private.tracking_environment values('magemind-tracking-pilot-v1','pilot');revoke all on private.tracking_environment from public,anon,authenticated;grant all on private.tracking_environment to service_role;
create table public.tracking_workspaces (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 120), currency text not null default 'BRL' check(currency in ('BRL','USD','EUR','JPY','KWD')),
 timezone text not null default 'America/Sao_Paulo', attribution_days integer not null default 7 check(attribution_days between 1 and 90),
 retention_days integer not null default 90 check(retention_days between 7 and 365), created_at timestamptz not null default now()
);
create table public.tracking_members (
 workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 user_id uuid not null references auth.users on delete cascade, role text not null check(role in ('owner','admin','viewer')),
 can_view_buyers boolean not null default false, created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create index tracking_members_user on public.tracking_members(user_id,workspace_id);
create function private.tracking_session_valid() returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists(select 1 from auth.sessions s where s.user_id=(select auth.uid()) and s.id::text=(select auth.jwt()->>'session_id'));
$$;
revoke all on function private.tracking_session_valid() from public,anon;
grant execute on function private.tracking_session_valid() to authenticated,service_role;
create function private.tracking_access(w uuid, capability text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
 select (select private.tracking_session_valid()) and exists(select 1 from public.tracking_members m where m.workspace_id=w and m.user_id=(select auth.uid())
 and case capability when 'write' then m.role in ('owner','admin') when 'owner' then m.role='owner' when 'pii' then m.can_view_buyers else true end);
$$;
grant usage on schema private to authenticated;
revoke all on function private.tracking_access(uuid,text) from public,anon;
grant execute on function private.tracking_access(uuid,text) to authenticated,service_role;
create function private.tracking_workspace_ids(capability text default 'read') returns setof uuid language sql stable security definer set search_path='' as $$
 select m.workspace_id from public.tracking_members m where m.user_id=(select auth.uid()) and (select private.tracking_session_valid()) and
 case capability when 'pii' then m.can_view_buyers when 'write' then m.role in ('owner','admin') when 'owner' then m.role='owner' else true end;
$$;
revoke all on function private.tracking_workspace_ids(text) from public,anon;
grant execute on function private.tracking_workspace_ids(text) to authenticated,service_role;

create table public.tracking_integrations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 provider text not null check(provider in ('meta','google','kiwify','hotmart','custom')), account_id text not null,
 name text not null, mode text not null default 'simulated' check(mode in ('simulated','awaiting_credentials','real_test_pending','approved_test')),
 connected boolean not null default true, last_sync_at timestamptz, last_received_at timestamptz, error_code text,
 selected_products text[] not null default '{}', sync_cursor jsonb not null default '{}', retry_after_at timestamptz, error_count integer not null default 0,
 sync_interval_seconds integer not null default 600 check(sync_interval_seconds between 300 and 86400), created_at timestamptz not null default now(),
 unique(workspace_id,provider,account_id), unique(workspace_id,id)
);
create table private.tracking_credentials (
 integration_id uuid primary key references public.tracking_integrations on delete cascade,
 cipher text, token_hash text unique, revision integer not null default 1, revoked_at timestamptz
);
create table private.tracking_oauth_states (
 state_hash text primary key, workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 user_id uuid not null references auth.users on delete cascade, provider text not null,
 expires_at timestamptz not null, used_at timestamptz
);
create table public.tracking_ad_accounts (
 workspace_id uuid not null references public.tracking_workspaces on delete cascade, provider text not null, account_id text not null,
 name text not null, currency text not null, timezone text not null, selected boolean not null default false,
 primary key(workspace_id,provider,account_id)
);
create table public.tracking_ad_entities (
 workspace_id uuid not null, provider text not null, account_id text not null, entity_id text not null,
 level text not null check(level in ('campaign','group','ad')), parent_id text, name text not null,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','PAUSED')), revision integer not null default 0, status_updated_at timestamptz,
 primary key(workspace_id,provider,account_id,entity_id), foreign key(workspace_id,provider,account_id) references public.tracking_ad_accounts on delete cascade
);
create table public.tracking_ad_stats_daily (
 workspace_id uuid not null, provider text not null, account_id text not null, entity_id text not null,
 date date not null, granularity text not null check(granularity in ('ad','campaign')), breakdown text not null default '',
 currency text not null, amount_scale integer not null check(amount_scale between 0 and 3),
 spend_minor bigint not null check(spend_minor>=0), impressions bigint not null default 0, clicks bigint not null default 0,
 network_purchases numeric, network_purchase_value_minor bigint, synced_at timestamptz not null default now(),
 primary key(workspace_id,provider,account_id,entity_id,date,granularity,breakdown),
 foreign key(workspace_id,provider,account_id,entity_id) references public.tracking_ad_entities on delete cascade
);
create index tracking_stats_period on public.tracking_ad_stats_daily(workspace_id,date,currency);
create table public.tracking_sites (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 domain text not null, public_key text not null unique default gen_random_uuid()::text,
 checkout_domains text[] not null default '{}', enabled boolean not null default true, unique(workspace_id,id)
);
create table public.tracking_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 site_id uuid, event_id text not null, session_id text not null, click_id text, event_name text not null
 check(event_name in ('page_view','view_content','add_to_cart','checkout_click','initiate_checkout')),
 occurred_at timestamptz not null, received_at timestamptz not null default now(), tracking jsonb not null default '{}',
 persisted boolean not null default false, unique(workspace_id,site_id,event_id),
 foreign key(workspace_id,site_id) references public.tracking_sites(workspace_id,id) on delete cascade
);
create index tracking_events_click on public.tracking_events(workspace_id,click_id,occurred_at desc);
create index tracking_events_period on public.tracking_events(workspace_id,occurred_at,event_name);
create table public.tracking_customers (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 provider text not null, account_id text not null, external_id text not null,
 name text, email text, phone text, anonymized_at timestamptz, created_at timestamptz not null default now(),
 unique(workspace_id,provider,account_id,external_id), unique(workspace_id,id)
);
create index tracking_customers_lookup on public.tracking_customers(workspace_id,lower(email));
create table public.tracking_orders (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 provider text not null, account_id text not null, external_id text not null, customer_id uuid, customer_identity_reliable boolean not null default false,
 status text not null check(status in ('pending','paid','refused','refunded','chargeback','disputed','cancelled')),
 currency text not null, amount_scale integer not null check(amount_scale between 0 and 3),
 gross_minor bigint not null check(gross_minor>=0), gateway_fee_minor bigint, recipient_minor bigint,
 refund_minor bigint not null default 0 check(refund_minor>=0), recipient_refund_minor bigint,
 renewal boolean not null default false, root_order_id text, payment_method text,
 created_at timestamptz not null, approved_at timestamptz, last_occurred_at timestamptz not null,
 received_at timestamptz not null default now(), is_test boolean not null default true, money_components jsonb not null default '{}',
 foreign key(workspace_id,customer_id) references public.tracking_customers(workspace_id,id),
 unique(workspace_id,provider,account_id,external_id), unique(workspace_id,id), check(refund_minor<=gross_minor),
 check(recipient_minor is null or recipient_minor between 0 and gross_minor),
 check(gateway_fee_minor is null or gateway_fee_minor between 0 and gross_minor)
);
create index tracking_orders_period on public.tracking_orders(workspace_id,approved_at desc,currency);
create index tracking_orders_listing on public.tracking_orders(workspace_id,created_at desc,id);
create index tracking_orders_customer on public.tracking_orders(workspace_id,customer_id);
create table public.tracking_order_items (
 workspace_id uuid not null, order_id uuid not null, line integer not null, product_id text not null,
 name text not null, quantity integer not null check(quantity>0), amount_minor bigint not null check(amount_minor>=0),
 primary key(order_id,line), foreign key(workspace_id,order_id) references public.tracking_orders(workspace_id,id) on delete cascade
);
create table public.tracking_attributions (
 workspace_id uuid not null, order_id uuid primary key, channel text not null, ad_id text, account_id text,
 evidence text not null, confidence text not null, model text not null default 'last_non_direct_click_v1',
 first_touch jsonb not null default '{}', frozen_touch jsonb not null, reason text, created_at timestamptz not null default now(),
 foreign key(workspace_id,order_id) references public.tracking_orders(workspace_id,id) on delete cascade
);
create table public.tracking_cost_rules (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 name text not null, product_id text, category text not null check(category in ('product','fee','tax','expense')),
 amount_minor bigint, rate_bps integer check(rate_bps between 0 and 10000), currency text not null default 'BRL',
 valid_from date not null, valid_to date, created_at timestamptz not null default now(),
 check(valid_to is null or valid_to>=valid_from), check(amount_minor is null or amount_minor>=0),
 check(amount_minor is not null or rate_bps is not null),
 check(category<>'expense' or(amount_minor is not null and rate_bps is null))
);
create index tracking_cost_rules_period on public.tracking_cost_rules(workspace_id,currency,valid_from,valid_to);
create table public.tracking_ledger (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, order_id uuid not null, event_key text not null,
 occurred_at timestamptz not null, currency text not null, amount_scale integer not null,
 gross_delta_minor bigint not null, refund_delta_minor bigint not null, recipient_delta_minor bigint,
 cost_delta_minor bigint, unique(order_id,event_key),
 foreign key(workspace_id,order_id) references public.tracking_orders(workspace_id,id) on delete cascade
);
create index tracking_ledger_period on public.tracking_ledger(workspace_id,occurred_at,currency);
create table public.tracking_order_events (
 id uuid primary key, workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 order_id uuid, provider text not null, event_key text not null, status text not null, occurred_at timestamptz not null,
 received_at timestamptz not null default now(), processing text not null default 'queued', reason text,
 foreign key(workspace_id,order_id) references public.tracking_orders(workspace_id,id) on delete cascade
);
create table private.tracking_receipts (
 id uuid primary key default gen_random_uuid(), integration_id uuid not null references public.tracking_integrations on delete cascade,
 workspace_id uuid not null references public.tracking_workspaces on delete cascade, event_key text not null,
 payload_hash text not null, payload jsonb not null, received_at timestamptz not null default now(),
 unique(integration_id,event_key)
);
create table private.tracking_jobs (
 id uuid primary key default gen_random_uuid(), receipt_id uuid unique references private.tracking_receipts on delete cascade,
 integration_id uuid references public.tracking_integrations on delete cascade, kind text not null default 'order',
 state text not null default 'queued' check(state in ('queued','running','done','dead')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(), locked_until timestamptz,
 error_code text
);
create index tracking_jobs_due on private.tracking_jobs(next_attempt_at) where state in ('queued','running');
create table public.tracking_notification_preferences (
 workspace_id uuid not null, user_id uuid not null, sales boolean not null default false, renewals boolean not null default false,
 refunds boolean not null default false, failures boolean not null default false, hide_amount boolean not null default true,
 primary key(workspace_id,user_id), foreign key(workspace_id,user_id) references public.tracking_members on delete cascade
);
create table private.tracking_push_subscriptions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid not null,
 endpoint text not null, p256dh text not null, auth text not null, enabled boolean not null default true,
 unique(workspace_id,user_id,endpoint), foreign key(workspace_id,user_id) references public.tracking_members on delete cascade
);
create table public.tracking_deliveries (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, order_id uuid, integration_id uuid,
 user_id uuid references auth.users, channel text not null check(channel in ('in_app','push','capi')),
 category text not null, event_key text not null unique, state text not null default 'queued', attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(), delivered_at timestamptz, error_code text, locked_until timestamptz,
 foreign key(workspace_id,order_id) references public.tracking_orders(workspace_id,id) on delete cascade,
 foreign key(workspace_id,integration_id) references public.tracking_integrations(workspace_id,id) on delete cascade
);
create table private.tracking_conversion_destinations (
 workspace_id uuid primary key references public.tracking_workspaces on delete cascade,
 pixel_id text, test_event_code text, cipher text, enabled boolean not null default false,
 coordinated_emitter boolean not null default false, consent boolean not null default false
);
create table public.tracking_audit (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.tracking_workspaces on delete cascade,
 actor_id uuid, action text not null, entity_id text, occurred_at timestamptz not null default now(), details jsonb not null default '{}'
);

do $$ declare t text; begin
 foreach t in array array['tracking_workspaces','tracking_members','tracking_integrations','tracking_ad_accounts','tracking_ad_entities','tracking_ad_stats_daily','tracking_sites','tracking_events','tracking_orders','tracking_order_items','tracking_attributions','tracking_cost_rules','tracking_ledger','tracking_order_events','tracking_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy member_read on public.%I for select to authenticated using (%s in (select private.tracking_workspace_ids()))',t,case when t='tracking_workspaces' then 'id' else 'workspace_id' end);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
alter table public.tracking_customers enable row level security;
create policy buyers_read on public.tracking_customers for select to authenticated using(workspace_id in (select private.tracking_workspace_ids('pii')));
grant select on public.tracking_customers to authenticated;
alter table public.tracking_deliveries enable row level security;
create policy delivery_read on public.tracking_deliveries for select to authenticated using(workspace_id in (select private.tracking_workspace_ids()) and user_id=(select auth.uid()));
grant select on public.tracking_deliveries to authenticated;
alter table public.tracking_notification_preferences enable row level security;
create policy preference_read on public.tracking_notification_preferences for select to authenticated using(user_id=(select auth.uid()) and workspace_id in (select private.tracking_workspace_ids()));
create policy preference_write on public.tracking_notification_preferences for all to authenticated using(user_id=(select auth.uid()) and workspace_id in (select private.tracking_workspace_ids())) with check(user_id=(select auth.uid()) and workspace_id in (select private.tracking_workspace_ids()));
grant select,insert,update,delete on public.tracking_notification_preferences to authenticated;
-- All financial writes are internal RPCs. There is no client INSERT policy for orders, ledger or advertising snapshots.




create function public.tracking_create_workspace(p_name text,p_currency text default 'BRL',p_timezone text default 'America/Sao_Paulo') returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 if not private.tracking_session_valid() then raise exception 'Unauthorized'; end if;
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
 insert into public.tracking_workspaces(owner_id,name,currency,timezone) values((select auth.uid()),p_name,p_currency,p_timezone) returning id into w;
 insert into public.tracking_members values(w,(select auth.uid()),'owner',true,now());
 insert into public.tracking_notification_preferences(workspace_id,user_id) values(w,(select auth.uid()));
 return w; end $$;
create function public.tracking_update_workspace(w uuid,p_name text,p_days integer,p_retention integer) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 update public.tracking_workspaces set name=p_name,attribution_days=p_days,retention_days=p_retention where id=w;
 insert into public.tracking_audit(workspace_id,actor_id,action) values(w,(select auth.uid()),'workspace.settings');
end $$;
create function public.tracking_set_member(w uuid,u uuid,p_role text,p_pii boolean) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'owner') or p_role not in ('admin','viewer') or exists(select 1 from public.tracking_workspaces where id=w and owner_id=u) then raise exception 'Forbidden'; end if;
 insert into public.tracking_members(workspace_id,user_id,role,can_view_buyers) values(w,u,p_role,p_pii) on conflict(workspace_id,user_id) do update set role=excluded.role,can_view_buyers=excluded.can_view_buyers;
 insert into public.tracking_notification_preferences(workspace_id,user_id) values(w,u) on conflict do nothing;
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'member.grant',u::text);
end $$;
create function public.tracking_save_cost(w uuid,p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid; begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 insert into public.tracking_cost_rules(workspace_id,name,product_id,category,amount_minor,rate_bps,currency,valid_from,valid_to)
 values(w,p->>'name',nullif(p->>'product_id',''),p->>'category',(p->>'amount_minor')::bigint,(p->>'rate_bps')::integer,p->>'currency',(p->>'valid_from')::date,(p->>'valid_to')::date) returning id into v;
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'cost.create',v::text);
 return v; end $$;

create function public.tracking_ingest(i uuid,e jsonb,h text,p_historical boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.tracking_integrations; r uuid; prior_hash text; begin
 if (select auth.role()) <> 'service_role' then raise exception 'Internal service only'; end if;
 select * into strict v from public.tracking_integrations where id=i and connected; if not private.tracking_account_enabled((select owner_id from public.tracking_workspaces where id=v.workspace_id)) then raise exception 'Pilot access revoked';end if;
 if e->>'schema_version'<>'1' or length(e->>'event_id') not between 1 and 200 or length(e->>'order_id') not between 1 and 200 or e->>'currency' not in ('BRL','USD','EUR','JPY','KWD')
 or e->>'status' not in ('pending','paid','refused','refunded','chargeback','disputed','cancelled') or coalesce((e->>'is_test')::boolean,false) is not true then raise exception 'Invalid normalized test event'; end if;
 if (e->>'gross_amount_minor')::bigint<0 or (e->>'refunded_amount_minor')::bigint<0 or (e->>'refunded_amount_minor')::bigint>(e->>'gross_amount_minor')::bigint then raise exception 'Invalid money'; end if;
 insert into private.tracking_receipts(integration_id,workspace_id,event_key,payload_hash,payload)
 values(i,v.workspace_id,e->>'event_id',h,e||jsonb_build_object('historical',p_historical))
 on conflict(integration_id,event_key) do nothing returning id into r;
 if r is null then
   select id,payload_hash into r,prior_hash from private.tracking_receipts where integration_id=i and event_key=e->>'event_id';
   if prior_hash<>h then raise exception 'Event ID reused with different content'; end if;
   return r;
 end if;
 insert into public.tracking_order_events(id,workspace_id,provider,event_key,status,occurred_at)
 values(r,v.workspace_id,v.provider,e->>'event_id',e->>'status',(e->>'occurred_at')::timestamptz);
 insert into private.tracking_jobs(receipt_id,integration_id) values(r,i);
 update public.tracking_integrations set last_received_at=now() where id=i;
 return r; end $$;

create function public.tracking_process_receipt(r uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec private.tracking_receipts; intg public.tracking_integrations; e jsonb; old public.tracking_orders; o public.tracking_orders;
 c uuid; first_paid boolean; old_gross bigint:=0; new_gross bigint:=0; old_refund bigint:=0; old_net bigint; new_net bigint;
 tr jsonb; touch jsonb; ch text; ad text; acct text; ev text; reason text; costs bigint; extra_costs bigint; approval_date date; pref record;
begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select * into strict rec from private.tracking_receipts where id=r;
 select * into strict intg from public.tracking_integrations where id=rec.integration_id;
 e:=rec.payload;
 if cardinality(intg.selected_products)>0 and not exists(select 1 from jsonb_array_elements(e->'items') it where it->>'external_product_id'=any(intg.selected_products)) then
  update public.tracking_order_events set processing='ignored',reason='Product outside selected scope' where id=r;
  update private.tracking_jobs set state='done',locked_until=null where receipt_id=r;
  return null;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(intg.workspace_id::text||intg.provider||intg.account_id||(e->>'order_id'),0));
 if exists(select 1 from private.tracking_jobs where receipt_id=r and state='done') then
  return (select order_id from public.tracking_order_events where id=r);
 end if;
 select * into old from public.tracking_orders where workspace_id=intg.workspace_id and provider=intg.provider and account_id=intg.account_id and external_id=e->>'order_id' for update;
 if old.id is not null and (old.currency<>e->>'currency' or old.amount_scale<>(e->>'amount_scale')::integer or old.gross_minor<>(e->>'gross_amount_minor')::bigint) then raise exception 'Order identity or amount changed'; end if;
 if old.id is not null and ((e->>'occurred_at')::timestamptz<old.last_occurred_at or (old.approved_at is not null and e->>'status' in ('pending','refused','cancelled')) or (old.status in ('refunded','chargeback') and e->>'status' in ('paid','disputed'))) then
  update public.tracking_order_events set order_id=old.id,processing='ignored',reason='Stale or regressive event' where id=r;
  update private.tracking_jobs set state='done' where receipt_id=r; return old.id;
 end if;
 if nullif(e->'customer'->>'external_id','') is not null then
  insert into public.tracking_customers(workspace_id,provider,account_id,external_id,name,email,phone)
  values(intg.workspace_id,intg.provider,intg.account_id,e->'customer'->>'external_id',e->'customer'->>'name',e->'customer'->>'email',e->'customer'->>'phone')
  on conflict(workspace_id,provider,account_id,external_id) do update set name=case when tracking_customers.anonymized_at is null then coalesce(excluded.name,tracking_customers.name) end,email=case when tracking_customers.anonymized_at is null then coalesce(excluded.email,tracking_customers.email) end,phone=case when tracking_customers.anonymized_at is null then coalesce(excluded.phone,tracking_customers.phone) end returning id into c;
 end if;
 first_paid:=e->>'status'='paid' and old.approved_at is null;
 if old.approved_at is not null then old_gross:=old.gross_minor; old_refund:=old.refund_minor; end if;
 select coalesce(sum(recipient_delta_minor),0) into old_net from public.tracking_ledger where order_id=old.id;
 insert into public.tracking_orders(workspace_id,provider,account_id,external_id,customer_id,customer_identity_reliable,status,currency,amount_scale,gross_minor,gateway_fee_minor,recipient_minor,refund_minor,recipient_refund_minor,renewal,root_order_id,payment_method,created_at,approved_at,last_occurred_at)
 values(intg.workspace_id,intg.provider,intg.account_id,e->>'order_id',c,c is not null and coalesce((e->'customer'->>'identity_reliable')::boolean,true),e->>'status',e->>'currency',(e->>'amount_scale')::integer,(e->>'gross_amount_minor')::bigint,
 (e->>'gateway_fee_minor')::bigint,(e->>'recipient_revenue_minor')::bigint,coalesce((e->>'refunded_amount_minor')::bigint,0),(e->>'recipient_refunded_minor')::bigint,
 coalesce((e->>'renewal')::boolean,false),e->>'root_order_id',e->>'payment_method',(e->>'created_at')::timestamptz,
 coalesce(old.approved_at,case when e->>'status' in ('paid','refunded','chargeback','disputed') then (e->>'approved_at')::timestamptz end),(e->>'occurred_at')::timestamptz)
 on conflict(workspace_id,provider,account_id,external_id) do update set status=excluded.status,customer_id=case when not tracking_orders.customer_identity_reliable and excluded.customer_identity_reliable then excluded.customer_id else coalesce(tracking_orders.customer_id,excluded.customer_id) end,customer_identity_reliable=tracking_orders.customer_identity_reliable or excluded.customer_identity_reliable,
 gateway_fee_minor=coalesce(excluded.gateway_fee_minor,tracking_orders.gateway_fee_minor),recipient_minor=coalesce(excluded.recipient_minor,tracking_orders.recipient_minor),
 refund_minor=greatest(tracking_orders.refund_minor,excluded.refund_minor),recipient_refund_minor=coalesce(excluded.recipient_refund_minor,tracking_orders.recipient_refund_minor),
 approved_at=coalesce(tracking_orders.approved_at,excluded.approved_at),last_occurred_at=excluded.last_occurred_at,received_at=now()
 returning * into o;
 update public.tracking_orders set money_components=coalesce(e->'money_components','{}') where id=o.id and e ? 'money_components';
 if old.id is null then
  insert into public.tracking_order_items(workspace_id,order_id,line,product_id,name,quantity,amount_minor)
  select intg.workspace_id,o.id,n::integer,x->>'external_product_id',x->>'name',(x->>'quantity')::integer,(x->>'amount_minor')::bigint
  from jsonb_array_elements(e->'items') with ordinality a(x,n);
  tr:=coalesce(e->'tracking','{}'); touch:=tr;
  select t.tracking into touch from public.tracking_events t join public.tracking_workspaces w on w.id=t.workspace_id
  where t.workspace_id=intg.workspace_id and t.click_id=tr->>'mm_click_id'
  and t.occurred_at<=(e->>'created_at')::timestamptz and t.occurred_at>=(e->>'created_at')::timestamptz-make_interval(days=>w.attribution_days)
  and coalesce(t.tracking->>'utm_source','') not in ('','direct') order by t.occurred_at desc limit 1;
  if touch is null then touch:=tr; ev:='checkout_metadata'; else ev:='click_id'; end if;
  ch:=case lower(coalesce(touch->>'utm_source','')) when 'facebook' then 'meta' when 'fb' then 'meta' when 'instagram' then 'meta' else lower(coalesce(touch->>'utm_source','unattributed')) end;
  ad:=coalesce(touch->>'ad_id',touch->>'utm_content');
  select a.account_id into acct from public.tracking_ad_entities a join public.tracking_ad_accounts ac using(workspace_id,provider,account_id)
  where a.workspace_id=intg.workspace_id and a.provider=ch and a.entity_id=ad and a.level='ad' and ac.selected limit 1;
  if acct is null then ad:=null; reason:='No matching selected advertising account'; end if;
  if ch='' then ch:='unattributed'; end if;
  insert into public.tracking_attributions(workspace_id,order_id,channel,ad_id,account_id,evidence,confidence,first_touch,frozen_touch,reason)
  values(intg.workspace_id,o.id,ch,ad,acct,ev,case when ev='click_id' then 'medium' when ad is not null then 'medium' else 'low' end,coalesce(touch->'first_touch',e->'tracking'->'first_touch','{}'),coalesce(touch,'{}'),reason);
 end if;
 if o.approved_at is not null then new_gross:=o.gross_minor; end if;
 new_net:=case when o.approved_at is null then 0 when o.recipient_minor is null or (o.refund_minor>0 and o.recipient_refund_minor is null) then null else o.recipient_minor-coalesce(o.recipient_refund_minor,0) end;
 costs:=0;
 if first_paid then
  -- Snapshot cost rules at approval. Later rule changes do not rewrite prior ledger entries.
  select (o.approved_at at time zone w.timezone)::date into approval_date from public.tracking_workspaces w where w.id=intg.workspace_id;
  select case when bool_or(cr.id is null) then null else sum(coalesce(cr.amount_minor,0)*it.quantity+(it.amount_minor*coalesce(cr.rate_bps,0)+5000)/10000) end into costs
  from public.tracking_order_items it left join lateral (
   select r.* from public.tracking_cost_rules r where r.workspace_id=intg.workspace_id and r.category='product' and r.currency=o.currency
   and (r.product_id=it.product_id or r.product_id is null) and r.valid_from<=approval_date and (r.valid_to is null or r.valid_to>=approval_date)
   order by (r.product_id is not null) desc,r.valid_from desc,r.created_at desc limit 1
  ) cr on true where it.order_id=o.id;
  select coalesce(sum(coalesce(r.amount_minor,0)+(o.gross_minor*coalesce(r.rate_bps,0)+5000)/10000),0) into extra_costs from (
   select distinct on(name,category) * from public.tracking_cost_rules r where r.workspace_id=intg.workspace_id and r.currency=o.currency
   and r.category in ('tax','fee') and r.valid_from<=approval_date and (r.valid_to is null or r.valid_to>=approval_date)
   and (r.category<>'fee' or (o.recipient_minor is null and o.gateway_fee_minor is null))
   order by name,category,valid_from desc,created_at desc
  ) r;
  costs:=costs+extra_costs;
 end if;
 if new_gross<>old_gross or o.refund_minor<>old_refund or (new_net is not null and new_net is distinct from old_net) then
  insert into public.tracking_ledger(workspace_id,order_id,event_key,occurred_at,currency,amount_scale,gross_delta_minor,refund_delta_minor,recipient_delta_minor,cost_delta_minor)
  values(intg.workspace_id,o.id,rec.event_key,case when first_paid then o.approved_at else (e->>'occurred_at')::timestamptz end,o.currency,o.amount_scale,new_gross-old_gross,o.refund_minor-old_refund,new_net-old_net,costs);
 end if;
 if first_paid and not coalesce((e->>'historical')::boolean,false) then
  for pref in select p.* from public.tracking_notification_preferences p join public.tracking_members m using(workspace_id,user_id) where p.workspace_id=intg.workspace_id and case when o.renewal then p.renewals else p.sales end loop
   insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
   values(intg.workspace_id,o.id,pref.user_id,'in_app',case when o.renewal then 'renewal' else 'sale' end,o.id::text||':approved:in_app:'||pref.user_id::text) on conflict do nothing;
   if exists(select 1 from private.tracking_push_subscriptions s where s.workspace_id=intg.workspace_id and s.user_id=pref.user_id and s.enabled) then
    insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
    values(intg.workspace_id,o.id,pref.user_id,'push','sale',o.id::text||':approved:push:'||pref.user_id::text) on conflict do nothing;
   end if;
  end loop;
  if exists(select 1 from private.tracking_conversion_destinations d where d.workspace_id=intg.workspace_id and d.enabled and d.coordinated_emitter and d.consent and d.test_event_code is not null) then
   insert into public.tracking_deliveries(workspace_id,order_id,channel,category,event_key) values(intg.workspace_id,o.id,'capi','purchase','mm:'||o.id::text||':approved') on conflict do nothing;
  end if;
 end if;
 if o.refund_minor>old_refund and not coalesce((e->>'historical')::boolean,false) then
  for pref in select p.* from public.tracking_notification_preferences p join public.tracking_members m using(workspace_id,user_id) where p.workspace_id=intg.workspace_id and p.refunds loop
   insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
   values(intg.workspace_id,o.id,pref.user_id,'in_app','refund',o.id::text||':refund:'||o.refund_minor::text||':in_app:'||pref.user_id::text) on conflict do nothing;
   if exists(select 1 from private.tracking_push_subscriptions s where s.workspace_id=intg.workspace_id and s.user_id=pref.user_id and s.enabled) then
    insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
    values(intg.workspace_id,o.id,pref.user_id,'push','refund',o.id::text||':refund:'||o.refund_minor::text||':push:'||pref.user_id::text) on conflict do nothing;
   end if;
  end loop;
 end if;
 update public.tracking_order_events set order_id=o.id,processing='processed' where id=r;
 update private.tracking_jobs set state='done',locked_until=null where receipt_id=r;
 return o.id;
end $$;

create function public.tracking_claim_jobs(p_limit integer default 20) returns setof private.tracking_jobs
language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 return query update private.tracking_jobs j set state='running',attempts=attempts+1,locked_until=now()+interval '2 minutes'
 where j.id in(select q.id from private.tracking_jobs q where (q.state='queued' or (q.state='running' and q.locked_until<now())) and q.next_attempt_at<=now() and q.attempts<8 order by q.next_attempt_at for update skip locked limit least(p_limit,100))
 returning j.*; end $$;
create function public.tracking_fail_job(j uuid,code text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 update private.tracking_jobs set state=case when attempts>=8 then 'dead' else 'queued' end,error_code=left(code,80),
 next_attempt_at=now()+make_interval(secs=>least(3600,(power(2,attempts)*5)::integer)),locked_until=null where id=j;
 update public.tracking_order_events set processing=case when (select state from private.tracking_jobs where id=j)='dead' then 'dead' else 'retry' end,reason=left(code,80) where id=(select receipt_id from private.tracking_jobs where id=j);
end $$;
create function public.tracking_retry(w uuid,e uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 update private.tracking_receipts set payload=jsonb_set(payload,'{historical}','true') where id=e and workspace_id=w and exists(select 1 from public.tracking_order_events ev where ev.id=e and ev.processing='ignored' and ev.reason='Product outside selected scope');
 update private.tracking_jobs set state='queued',attempts=0,next_attempt_at=now() where receipt_id=e and(state<>'done' or exists(select 1 from public.tracking_order_events ev where ev.id=e and ev.processing='ignored' and ev.reason='Product outside selected scope')) and exists(select 1 from private.tracking_receipts r where r.id=e and r.workspace_id=w);
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'event.retry',e::text);
end $$;
create function public.tracking_delete_workspace(w uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'owner') then raise exception 'Forbidden'; end if;
 delete from public.tracking_workspaces where id=w;
end $$;
create function public.tracking_prune() returns void language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 delete from public.tracking_events e using public.tracking_workspaces w where e.workspace_id=w.id and e.received_at<now()-make_interval(days=>w.retention_days);
 delete from private.tracking_receipts r using public.tracking_workspaces w where r.workspace_id=w.id and r.received_at<now()-make_interval(days=>w.retention_days) and exists(select 1 from private.tracking_jobs j where j.receipt_id=r.id and j.state='done');
 delete from private.tracking_oauth_states where expires_at<now()-interval '1 day';
end $$;
create view public.tracking_daily_metrics with(security_invoker=true) as
 select l.workspace_id,(l.occurred_at at time zone w.timezone)::date date,l.currency,l.amount_scale,
 sum(gross_delta_minor) gross_minor,sum(refund_delta_minor) refund_minor,
 case when bool_or(o.recipient_minor is null or (o.refund_minor>0 and o.recipient_refund_minor is null)) then null else sum(coalesce(recipient_delta_minor,0)) end recipient_minor,
 case when bool_or(cost_delta_minor is null) then null else sum(cost_delta_minor) end costs_minor
 from public.tracking_ledger l join public.tracking_workspaces w on w.id=l.workspace_id join public.tracking_orders o on o.id=l.order_id group by l.workspace_id,date,l.currency,l.amount_scale;
grant select on public.tracking_daily_metrics to authenticated;

grant execute on function public.tracking_create_workspace(text,text,text),public.tracking_update_workspace(uuid,text,integer,integer),
 public.tracking_set_member(uuid,uuid,text,boolean),public.tracking_save_cost(uuid,jsonb),public.tracking_retry(uuid,uuid),public.tracking_delete_workspace(uuid) to authenticated;
grant execute on function public.tracking_ingest(uuid,jsonb,text,boolean),public.tracking_process_receipt(uuid),public.tracking_claim_jobs(integer),public.tracking_fail_job(uuid,text),public.tracking_prune() to service_role;

-- Narrow internal interfaces. The private schema is never exposed by PostgREST.
create function public.tracking_environment_info() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',id,'environment',environment) from private.tracking_environment limit 1 $$;
create function public.tracking_internal_credential(i uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 return (select to_jsonb(c)||jsonb_build_object('integration',to_jsonb(g)) from private.tracking_credentials c join public.tracking_integrations g on g.id=c.integration_id where c.integration_id=i and g.connected);
end $$;
create function public.tracking_internal_save_credential(i uuid,p_cipher text,p_hash text default null) returns void language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 insert into private.tracking_credentials(integration_id,cipher,token_hash) values(i,p_cipher,p_hash) on conflict(integration_id) do update set cipher=excluded.cipher,token_hash=excluded.token_hash,revoked_at=null,revision=tracking_credentials.revision+1;
end $$;
create function public.tracking_resolve_api_credential(h text) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 return (select to_jsonb(i) from private.tracking_credentials c join public.tracking_integrations i on i.id=c.integration_id where c.token_hash=h and c.revoked_at is null and i.connected and i.provider='custom');
end $$;
create function public.tracking_oauth_prepare(h text,w uuid,u uuid,p text) returns void language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' or not exists(select 1 from public.tracking_members where workspace_id=w and user_id=u and role in ('owner','admin')) then raise exception 'Forbidden'; end if;
 insert into private.tracking_oauth_states(state_hash,workspace_id,user_id,provider,expires_at) values(h,w,u,p,now()+interval '10 minutes');
end $$;
create function public.tracking_oauth_consume(h text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.tracking_oauth_states; begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 update private.tracking_oauth_states set used_at=now() where state_hash=h and used_at is null and expires_at>now() returning * into r;
 if r.state_hash is null or not exists(select 1 from public.tracking_members where workspace_id=r.workspace_id and user_id=r.user_id and role in ('owner','admin')) then raise exception 'Invalid OAuth state'; end if;
 return to_jsonb(r);
end $$;
create function public.tracking_connect(w uuid,p_provider text,p_account text,p_name text,p_mode text default 'simulated') returns uuid
language plpgsql security definer set search_path='' as $$
declare i uuid; begin
 if not private.tracking_access(w,'write') or p_mode not in ('simulated','awaiting_credentials','real_test_pending') then raise exception 'Forbidden'; end if;
 insert into public.tracking_integrations(workspace_id,provider,account_id,name,mode) values(w,p_provider,p_account,p_name,p_mode)
 on conflict(workspace_id,provider,account_id) do update set connected=true,error_code=null returning id into i;
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'integration.connect',i::text);
 return i;
end $$;
create function public.tracking_disconnect(w uuid,i uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 update public.tracking_integrations set connected=false where workspace_id=w and id=i;
 delete from private.tracking_credentials where integration_id=i and exists(select 1 from public.tracking_integrations where workspace_id=w and id=i);
 update public.tracking_ad_accounts set selected=false where workspace_id=w and (provider,account_id) in(select provider,account_id from public.tracking_integrations where id=i and workspace_id=w);
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'integration.disconnect',i::text);
end $$;
create function public.tracking_save_site(w uuid,p_domain text,p_checkout_domains text[]) returns uuid language plpgsql security definer set search_path='' as $$ declare s uuid; begin
 if not private.tracking_access(w,'write') or p_domain !~ '^[a-zA-Z0-9.-]+$' or array_length(p_checkout_domains,1)>20 then raise exception 'Forbidden or invalid domain'; end if;
 insert into public.tracking_sites(workspace_id,domain,checkout_domains) values(w,p_domain,p_checkout_domains) returning id into s;return s;
end $$;
create function public.tracking_collect(p_key text,p_origin text,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.tracking_sites; begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select * into strict s from public.tracking_sites where public_key=p_key and domain=p_origin and enabled;
 if p->>'event_name' not in ('page_view','view_content','add_to_cart','checkout_click','initiate_checkout') or abs(extract(epoch from now()-(p->>'occurred_at')::timestamptz))>86400 then raise exception 'Invalid public behavior event'; end if;
 insert into public.tracking_events(workspace_id,site_id,event_id,session_id,click_id,event_name,occurred_at,tracking,persisted)
 values(s.workspace_id,s.id,p->>'event_id',p->>'session_id',p->>'click_id',p->>'event_name',(p->>'occurred_at')::timestamptz,coalesce(p->'tracking','{}'),coalesce((p->>'persisted')::boolean,false)) on conflict do nothing;
end $$;
create function public.tracking_internal_ad_snapshot(i uuid,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare g public.tracking_integrations; row jsonb; begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select * into strict g from public.tracking_integrations where id=i and connected and provider in ('meta','google');
 if not exists(select 1 from public.tracking_ad_accounts where workspace_id=g.workspace_id and provider=g.provider and account_id=g.account_id and selected) then raise exception 'Account not selected'; end if;
 for row in select value from jsonb_array_elements(p) loop
  delete from public.tracking_ad_stats_daily where workspace_id=g.workspace_id and provider=g.provider and account_id=g.account_id and date=(row->>'date')::date and granularity<>row->>'granularity';
  insert into public.tracking_ad_entities(workspace_id,provider,account_id,entity_id,level,name,parent_id)
  values(g.workspace_id,g.provider,g.account_id,row->>'entity_id',case when row->>'granularity'='campaign' then 'campaign' else 'ad' end,row->>'name',row->>'group_id')
  on conflict(workspace_id,provider,account_id,entity_id) do update set name=excluded.name,parent_id=excluded.parent_id;
  if row->>'campaign_id' is not null then
   insert into public.tracking_ad_entities(workspace_id,provider,account_id,entity_id,level,name)
   values(g.workspace_id,g.provider,g.account_id,row->>'campaign_id','campaign',row->>'campaign_name') on conflict do nothing;
  end if;
  if row->>'group_id' is not null then
   insert into public.tracking_ad_entities(workspace_id,provider,account_id,entity_id,level,name,parent_id)
   values(g.workspace_id,g.provider,g.account_id,row->>'group_id','group',row->>'group_name',row->>'campaign_id') on conflict do nothing;
  end if;
  insert into public.tracking_ad_stats_daily(workspace_id,provider,account_id,entity_id,date,granularity,currency,amount_scale,spend_minor,impressions,clicks,network_purchases,network_purchase_value_minor)
  values(g.workspace_id,g.provider,g.account_id,row->>'entity_id',(row->>'date')::date,row->>'granularity',row->>'currency',(row->>'amount_scale')::integer,(row->>'spend_minor')::bigint,(row->>'impressions')::bigint,(row->>'clicks')::bigint,(row->>'network_purchases')::numeric,(row->>'network_purchase_value_minor')::bigint)
  on conflict(workspace_id,provider,account_id,entity_id,date,granularity,breakdown) do update set spend_minor=excluded.spend_minor,impressions=excluded.impressions,clicks=excluded.clicks,network_purchases=excluded.network_purchases,network_purchase_value_minor=excluded.network_purchase_value_minor,synced_at=now();
 end loop;
 update public.tracking_integrations set last_sync_at=now(),error_code=null where id=i;
end $$;
create function public.tracking_internal_account(i uuid,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare g public.tracking_integrations; begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select * into strict g from public.tracking_integrations where id=i and connected;
 if g.account_id<>p->>'account_id' then raise exception 'Account mismatch'; end if;
 insert into public.tracking_ad_accounts(workspace_id,provider,account_id,name,currency,timezone,selected)
 values(g.workspace_id,g.provider,g.account_id,p->>'name',p->>'currency',p->>'timezone',true)
 on conflict(workspace_id,provider,account_id) do update set selected=true,name=excluded.name;
end $$;
create function public.tracking_internal_status(i uuid,p_code text) returns void language plpgsql security definer set search_path='' as $$ declare g public.tracking_integrations; p record; incident text; begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select * into strict g from public.tracking_integrations where id=i for update;
 update public.tracking_integrations set error_code=p_code where id=i;
 if p_code is not null and p_code is distinct from g.error_code then
  incident:=i::text||':failure:'||gen_random_uuid()::text;
  for p in select pref.* from public.tracking_notification_preferences pref join public.tracking_members m using(workspace_id,user_id) where pref.workspace_id=g.workspace_id and pref.failures loop
   insert into public.tracking_deliveries(workspace_id,integration_id,user_id,channel,category,event_key) values(g.workspace_id,i,p.user_id,'in_app','failure',incident||':in_app:'||p.user_id::text);
   if exists(select 1 from private.tracking_push_subscriptions s where s.workspace_id=g.workspace_id and s.user_id=p.user_id and s.enabled) then
    insert into public.tracking_deliveries(workspace_id,integration_id,user_id,channel,category,event_key) values(g.workspace_id,i,p.user_id,'push','failure',incident||':push:'||p.user_id::text);
   end if;
  end loop;
 end if;
end $$;
create function public.tracking_internal_outbox() returns jsonb language plpgsql security definer set search_path='' as $$ declare ids uuid[]; begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select coalesce(array_agg(id),'{}') into ids from (
  select id from public.tracking_deliveries where (state in ('queued','retry') or (state='running' and locked_until<now())) and next_attempt_at<=now() and attempts<8 order by next_attempt_at limit 50 for update skip locked
 ) claimed;
 update public.tracking_deliveries set state='running',locked_until=now()+interval '2 minutes' where id=any(ids);
 return coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('order',to_jsonb(o),'customer',to_jsonb(c),'preference',to_jsonb(p),'destination',to_jsonb(dest),'subscriptions',coalesce((select jsonb_agg(to_jsonb(s)) from private.tracking_push_subscriptions s where s.workspace_id=d.workspace_id and s.user_id=d.user_id and s.enabled),'[]')))
 from (select * from public.tracking_deliveries where id=any(ids)) d
 left join public.tracking_orders o on o.id=d.order_id left join public.tracking_customers c on c.id=o.customer_id left join public.tracking_notification_preferences p on p.workspace_id=d.workspace_id and p.user_id=d.user_id left join private.tracking_conversion_destinations dest on dest.workspace_id=d.workspace_id),'[]');
end $$;
create function public.tracking_delivery_result(i uuid,p_success boolean,p_code text default null) returns void language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 update public.tracking_deliveries set attempts=attempts+1,state=case when p_success then 'accepted' when attempts>=7 then 'dead' else 'retry' end,error_code=left(p_code,80),delivered_at=case when p_success then now() end,next_attempt_at=now()+make_interval(secs=>least(3600,power(2,attempts)::integer*15)) where id=i;
end $$;
create function public.tracking_push_subscribe(w uuid,p jsonb) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w) or p->>'endpoint' !~ '^https://(fcm.googleapis.com|updates.push.services.mozilla.com|web.push.apple.com)/' then raise exception 'Invalid subscription'; end if;
 insert into private.tracking_push_subscriptions(workspace_id,user_id,endpoint,p256dh,auth) values(w,(select auth.uid()),p->>'endpoint',p->'keys'->>'p256dh',p->'keys'->>'auth') on conflict(workspace_id,user_id,endpoint) do update set enabled=true,p256dh=excluded.p256dh,auth=excluded.auth;
end $$;
create function public.tracking_internal_expire_push(i uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 update private.tracking_push_subscriptions set enabled=false where id=i;
end $$;
create function public.tracking_internal_capi(w uuid,p jsonb,p_cipher text) returns void language plpgsql security definer set search_path='' as $$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 insert into private.tracking_conversion_destinations(workspace_id,pixel_id,test_event_code,cipher,enabled,coordinated_emitter,consent)
 values(w,p->>'pixel_id',p->>'test_event_code',p_cipher,(p->>'enabled')::boolean,(p->>'coordinated_emitter')::boolean,(p->>'consent')::boolean)
 on conflict(workspace_id) do update set pixel_id=excluded.pixel_id,test_event_code=excluded.test_event_code,cipher=excluded.cipher,enabled=excluded.enabled,coordinated_emitter=excluded.coordinated_emitter,consent=excluded.consent;
end $$;
revoke execute on function public.tracking_environment_info(),public.tracking_internal_credential(uuid),public.tracking_internal_save_credential(uuid,text,text),public.tracking_resolve_api_credential(text),public.tracking_oauth_prepare(text,uuid,uuid,text),public.tracking_oauth_consume(text),
 public.tracking_collect(text,text,jsonb),public.tracking_internal_ad_snapshot(uuid,jsonb),public.tracking_internal_account(uuid,jsonb),public.tracking_internal_status(uuid,text),public.tracking_internal_outbox(),public.tracking_delivery_result(uuid,boolean,text),public.tracking_internal_expire_push(uuid),public.tracking_internal_capi(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.tracking_environment_info(),public.tracking_internal_credential(uuid),public.tracking_internal_save_credential(uuid,text,text),public.tracking_resolve_api_credential(text),public.tracking_oauth_prepare(text,uuid,uuid,text),public.tracking_oauth_consume(text),
 public.tracking_collect(text,text,jsonb),public.tracking_internal_ad_snapshot(uuid,jsonb),public.tracking_internal_account(uuid,jsonb),public.tracking_internal_status(uuid,text),public.tracking_internal_outbox(),public.tracking_delivery_result(uuid,boolean,text),public.tracking_internal_expire_push(uuid),public.tracking_internal_capi(uuid,jsonb,text) to service_role;
revoke execute on function public.tracking_connect(uuid,text,text,text,text),public.tracking_disconnect(uuid,uuid),public.tracking_save_site(uuid,text,text[]),public.tracking_push_subscribe(uuid,jsonb) from public,anon;
grant execute on function public.tracking_connect(uuid,text,text,text,text),public.tracking_disconnect(uuid,uuid),public.tracking_save_site(uuid,text,text[]),public.tracking_push_subscribe(uuid,jsonb) to authenticated;

create function public.tracking_ad_management(w uuid,f date,t date,cur text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare out jsonb;
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 with recursive entities as (
  select e.*,i.mode,i.connected from public.tracking_ad_entities e join public.tracking_integrations i using(workspace_id,provider,account_id) join public.tracking_ad_accounts a using(workspace_id,provider,account_id) where e.workspace_id=w and a.selected
 ), tree as (
  select provider,account_id,entity_id root,entity_id descendant,0 depth from entities
  union all
  select tr.provider,tr.account_id,tr.root,e.entity_id,tr.depth+1 from tree tr join entities e on e.provider=tr.provider and e.account_id=tr.account_id and e.parent_id=tr.descendant where tr.depth<8
 ), metrics as (
  select tr.provider,tr.account_id,tr.root,sum(s.spend_minor) spend_minor,sum(s.impressions) impressions,sum(s.clicks) clicks,case when bool_or(s.network_purchases is null) then null else sum(s.network_purchases) end network_purchases
  from tree tr join public.tracking_ad_stats_daily s on s.workspace_id=w and s.provider=tr.provider and s.account_id=tr.account_id and s.entity_id=tr.descendant and s.date between f and t and s.currency=cur and s.breakdown=''
  where not exists(select 1 from entities c where c.provider=tr.provider and c.account_id=tr.account_id and c.parent_id=tr.descendant)
  group by tr.provider,tr.account_id,tr.root
 ), purchases as (
  select tr.provider,tr.account_id,tr.root,count(distinct o.id) purchases from tree tr join public.tracking_attributions a on a.workspace_id=w and a.channel=tr.provider and a.account_id=tr.account_id and a.ad_id=tr.descendant
  join public.tracking_orders o on o.id=a.order_id join public.tracking_workspaces ww on ww.id=w where o.currency=cur and (o.approved_at at time zone ww.timezone)::date between f and t group by tr.provider,tr.account_id,tr.root
 )
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into out from (
  select e.*,not exists(select 1 from tree tr join entities parent on parent.provider=tr.provider and parent.account_id=tr.account_id and parent.entity_id=tr.root where tr.provider=e.provider and tr.account_id=e.account_id and tr.descendant=e.entity_id and parent.status='PAUSED') effective_active,
  m.spend_minor,m.impressions,m.clicks,m.network_purchases,coalesce(p.purchases,0) checkout_purchases
  from entities e left join metrics m on m.provider=e.provider and m.account_id=e.account_id and m.root=e.entity_id left join purchases p on p.provider=e.provider and p.account_id=e.account_id and p.root=e.entity_id order by e.provider,e.account_id,e.level,e.name
 )r;
 return jsonb_build_object('rows',out);
end $$;
revoke execute on function public.tracking_ad_management(uuid,date,date,text) from public,anon;
grant execute on function public.tracking_ad_management(uuid,date,date,text) to authenticated;
create function public.tracking_set_ad_status(w uuid,provider_name text,account text,entity text,target_status text,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare before_status text; current_revision integer;
begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 if target_status not in ('ACTIVE','PAUSED') then raise exception 'Invalid status'; end if;
 -- The local review can manage synthetic accounts only. Never mutate a live
 -- ad account through a control presented as part of the preview.
 if not exists(select 1 from public.tracking_integrations where workspace_id=w and provider=provider_name and account_id=account and connected and mode='simulated') then raise exception 'Conta precisa de autorização de gerenciamento'; end if;
 select status,revision into before_status,current_revision from public.tracking_ad_entities where workspace_id=w and provider=provider_name and account_id=account and entity_id=entity for update;
 if not found then raise exception 'Entidade indisponível'; end if;
 if expected_revision is distinct from current_revision then raise exception 'Status atualizado em outra sessão. Atualize a lista'; end if;
 update public.tracking_ad_entities set status=target_status,revision=revision+1,status_updated_at=now() where workspace_id=w and provider=provider_name and account_id=account and entity_id=entity;
 insert into public.tracking_audit(workspace_id,actor_id,action,details) values(w,auth.uid(),'ad.status',jsonb_build_object('provider',provider_name,'account_id',account,'entity_id',entity,'before',before_status,'after',target_status));
end $$;
revoke execute on function public.tracking_set_ad_status(uuid,text,text,text,text,integer) from public,anon;
grant execute on function public.tracking_set_ad_status(uuid,text,text,text,text,integer) to authenticated;
create function public.tracking_report(w uuid,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare action text:=p->>'action'; f date:=coalesce((p->>'from')::date,current_date-6); t date:=coalesce((p->>'to')::date,current_date);
 cur text:=coalesce(p->>'currency','BRL'); page integer:=greatest(1,coalesce((p->>'page')::integer,1)); out jsonb; n bigint; tz text; gross bigint; refund bigint; net bigint; costs bigint; spend bigint; expense bigint; paid bigint; acquisition bigint; pending bigint; attributed bigint; last_order timestamptz; last_sync timestamptz;
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 select timezone into tz from public.tracking_workspaces where id=w;
 if action='summary' then
  select coalesce(sum(gross_minor),0),coalesce(sum(refund_minor),0),case when bool_or(recipient_minor is null) then null else coalesce(sum(recipient_minor),0) end,case when bool_or(costs_minor is null) then null else coalesce(sum(costs_minor),0) end
  into gross,refund,net,costs from public.tracking_daily_metrics where workspace_id=w and date between f and t and currency=cur;
  select sum(s.spend_minor),max(s.synced_at) into spend,last_sync from public.tracking_ad_stats_daily s join public.tracking_ad_accounts a using(workspace_id,provider,account_id) where s.workspace_id=w and a.selected and s.date between f and t and s.currency=cur and s.breakdown='';
  select coalesce(sum((amount_minor/(coalesce(valid_to,valid_from)-valid_from+1))*greatest(0,least(t,coalesce(valid_to,valid_from))-greatest(f,valid_from)+1)
  +greatest(0,least(t,valid_from+(amount_minor%(coalesce(valid_to,valid_from)-valid_from+1))::integer-1)-greatest(f,valid_from)+1)),0) into expense
  from public.tracking_cost_rules where workspace_id=w and category='expense' and currency=cur and valid_from<=t and coalesce(valid_to,valid_from)>=f;
  select count(*) filter(where o.status='pending'),count(*) filter(where o.approved_at is not null and a.channel in ('meta','google')),
  count(*) filter(where o.approved_at is not null and a.channel in ('meta','google') and not o.renewal and o.customer_id is not null and o.customer_identity_reliable and not exists(select 1 from public.tracking_orders prior where prior.workspace_id=w and prior.customer_id=o.customer_id and (prior.approved_at<o.approved_at or(prior.approved_at=o.approved_at and prior.id<o.id)))),max(o.received_at)
  into pending,paid,acquisition,last_order from public.tracking_orders o left join public.tracking_attributions a on a.order_id=o.id where o.workspace_id=w and (coalesce(o.approved_at,o.created_at) at time zone tz)::date between f and t and o.currency=cur;
  select coalesce(sum(l.gross_delta_minor-l.refund_delta_minor),0) into attributed from public.tracking_ledger l join public.tracking_attributions a on a.order_id=l.order_id where l.workspace_id=w and a.channel in ('meta','google') and (l.occurred_at at time zone tz)::date between f and t and l.currency=cur;
  return jsonb_build_object('daily',coalesce((select jsonb_agg(to_jsonb(d)) from(select * from public.tracking_daily_metrics where workspace_id=w and date between f and t and currency=cur order by date)d),'[]'),'gross_minor',gross,'refund_minor',refund,'recipient_minor',net,'costs_minor',costs,'expense_minor',expense,'spend_minor',spend,'estimated_minor',net-costs-spend-expense,'attributed_minor',attributed,'pending',pending,'paid',paid,'acquisitions',acquisition,'last_order',last_order,'last_sync',last_sync,'currency',cur);
 elsif action in ('list/orders','export') then
  select count(*) into n from public.tracking_orders o left join public.tracking_attributions a on a.order_id=o.id left join public.tracking_customers c on c.id=o.customer_id
  where o.workspace_id=w and (o.created_at at time zone tz)::date between f and t and o.currency=cur
  and (coalesce(p->>'status','')='' or o.status=p->>'status') and(coalesce(p->>'provider','')='' or o.provider=p->>'provider')
  and(coalesce(p->>'channel','')='' or a.channel=p->>'channel') and(coalesce(p->>'payment','')='' or o.payment_method=p->>'payment')
  and(coalesce(p->>'search','')='' or o.external_id ilike '%'||(p->>'search')||'%' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%' or c.phone ilike '%'||(p->>'search')||'%' or exists(select 1 from public.tracking_order_items it where it.order_id=o.id and it.name ilike '%'||(p->>'search')||'%'));
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into out from (
   select o.*,a.channel,a.evidence,c.name buyer_name,c.email buyer_email from public.tracking_orders o left join public.tracking_attributions a on a.order_id=o.id left join public.tracking_customers c on c.id=o.customer_id
   where o.workspace_id=w and (o.created_at at time zone tz)::date between f and t and o.currency=cur
   and(coalesce(p->>'status','')='' or o.status=p->>'status') and(coalesce(p->>'provider','')='' or o.provider=p->>'provider') and(coalesce(p->>'channel','')='' or a.channel=p->>'channel') and(coalesce(p->>'payment','')='' or o.payment_method=p->>'payment')
   and(coalesce(p->>'search','')='' or o.external_id ilike '%'||(p->>'search')||'%' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%' or c.phone ilike '%'||(p->>'search')||'%' or exists(select 1 from public.tracking_order_items it where it.order_id=o.id and it.name ilike '%'||(p->>'search')||'%'))
   order by o.created_at desc,o.id limit 25 offset (page-1)*25
  )r;return jsonb_build_object('rows',out,'total',n,'page',page,'size',25);
 elsif action='order' then
  select to_jsonb(o)||jsonb_build_object('buyer_name',c.name,'buyer_email',c.email,'buyer_phone',c.phone) into out from public.tracking_orders o left join public.tracking_customers c on c.id=o.customer_id where o.workspace_id=w and o.id=(p->>'id')::uuid;
  if out is null then raise exception 'Order unavailable'; end if;
  return jsonb_build_object('order',out,'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.tracking_order_items i where i.workspace_id=w and i.order_id=(p->>'id')::uuid),'[]'),'attribution',(select to_jsonb(a) from public.tracking_attributions a where a.workspace_id=w and a.order_id=(p->>'id')::uuid),'history',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at,e.received_at) from public.tracking_order_events e where e.workspace_id=w and e.order_id=(p->>'id')::uuid),'[]'),'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.occurred_at) from public.tracking_ledger l where l.workspace_id=w and l.order_id=(p->>'id')::uuid),'[]'));
 elsif action='list/customers' then
  if not private.tracking_access(w,'pii') then raise exception 'Buyer permission required'; end if;
  select count(*) into n from public.tracking_customers c where c.workspace_id=w and (coalesce(p->>'search','')='' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%');
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into out from(select c.*,count(o.id) orders from public.tracking_customers c left join public.tracking_orders o on o.customer_id=c.id where c.workspace_id=w and(coalesce(p->>'search','')='' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%') group by c.id order by c.created_at desc limit 25 offset(page-1)*25)r;
  return jsonb_build_object('rows',out,'total',n,'page',page,'size',25);
 elsif action='customer' then
  if not private.tracking_access(w,'pii') then raise exception 'Buyer permission required'; end if;
  select to_jsonb(c) into out from public.tracking_customers c where c.workspace_id=w and c.id=(p->>'id')::uuid;
  if out is null then raise exception 'Buyer unavailable'; end if;
  return jsonb_build_object('customer',out,'orders',coalesce((select jsonb_agg(to_jsonb(o)) from(select * from public.tracking_orders where workspace_id=w and customer_id=(p->>'id')::uuid order by created_at desc limit 25)o),'[]'));
 elsif action='list/ads' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into out from (
   select s.provider,s.account_id,s.entity_id,e.name,sum(s.spend_minor) spend_minor,sum(s.impressions) impressions,sum(s.clicks) clicks,sum(s.network_purchases) network_purchases,max(s.synced_at) synced_at,
   (select count(*) from public.tracking_orders o join public.tracking_attributions att on att.order_id=o.id where o.workspace_id=w and o.currency=cur and (o.approved_at at time zone tz)::date between f and t and att.channel=s.provider and att.account_id=s.account_id and att.ad_id=s.entity_id) checkout_purchases
   from public.tracking_ad_stats_daily s join public.tracking_ad_accounts a using(workspace_id,provider,account_id) join public.tracking_ad_entities e using(workspace_id,provider,account_id,entity_id)
   where s.workspace_id=w and s.date between f and t and s.currency=cur and a.selected and s.breakdown=''
   and(coalesce(p->>'provider','')='' or s.provider=p->>'provider') and(coalesce(p->>'account_id','')='' or s.account_id=p->>'account_id')
   and(coalesce(p->>'entity_id','')='' or s.entity_id=p->>'entity_id' or e.parent_id=p->>'entity_id' or exists(select 1 from public.tracking_ad_entities parent where parent.workspace_id=w and parent.provider=s.provider and parent.account_id=s.account_id and parent.entity_id=e.parent_id and parent.parent_id=p->>'entity_id'))
   group by s.provider,s.account_id,s.entity_id,e.name order by sum(s.spend_minor) desc limit 100
  )r;return jsonb_build_object('rows',out);
 elsif action='ad-options' then
  return jsonb_build_object('accounts',coalesce((select jsonb_agg(to_jsonb(a)) from public.tracking_ad_accounts a where a.workspace_id=w and a.selected),'[]'),'entities',coalesce((select jsonb_agg(to_jsonb(e)) from(select * from public.tracking_ad_entities where workspace_id=w order by name limit 500)e),'[]'));
 elsif action='funnel' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from(select event_name,count(distinct session_id) sessions,count(*) events from public.tracking_events where workspace_id=w and(occurred_at at time zone tz)::date between f and t group by event_name)r),'[]'),'orders',coalesce((select jsonb_agg(to_jsonb(r)) from(select status,count(*) orders from public.tracking_orders where workspace_id=w and(created_at at time zone tz)::date between f and t and currency=cur group by status)r),'[]'),'coverage','Jornada observada pelo coletor próprio; checkout_click não mede início real. Pedidos vêm do checkout autenticado.');
 elsif action='diagnostics' then
  select count(*) into n from public.tracking_order_events where workspace_id=w;
  return jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(r)) from(select * from public.tracking_order_events where workspace_id=w order by received_at desc limit 25 offset(page-1)*25)r),'[]'),'integrations',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'error_code',error_code,'last_sync_at',last_sync_at,'last_received_at',last_received_at)) from public.tracking_integrations where workspace_id=w),'[]'),'deliveries',coalesce((select jsonb_agg(to_jsonb(r)) from(select * from public.tracking_deliveries where workspace_id=w order by next_attempt_at desc limit 25)r),'[]'),'total',n,'page',page);
 elsif action='settings' then
  return jsonb_build_object('workspace',(select to_jsonb(x) from public.tracking_workspaces x where id=w),'members',coalesce((select jsonb_agg(to_jsonb(x)) from public.tracking_members x where workspace_id=w),'[]'),'preferences',coalesce((select to_jsonb(x) from public.tracking_notification_preferences x where workspace_id=w and user_id=(select auth.uid())),'{}'),'environment','test','backend','Supabase local isolado; credenciais externas de teste');
 elsif action='notifications' then
  return coalesce((select jsonb_agg(to_jsonb(r)) from(select d.id,d.order_id,d.integration_id,d.category,d.state,p.hide_amount,o.gross_minor,o.currency from public.tracking_deliveries d left join public.tracking_orders o on o.id=d.order_id left join public.tracking_notification_preferences p on p.workspace_id=d.workspace_id and p.user_id=d.user_id where d.workspace_id=w and d.channel='in_app' order by d.next_attempt_at desc limit 20)r),'[]');
 end if;
 raise exception 'Unknown report';
end $$;
revoke execute on function public.tracking_report(uuid,jsonb) from public,anon;
grant execute on function public.tracking_report(uuid,jsonb) to authenticated;
create function public.tracking_remove_member(w uuid,u uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'owner') or exists(select 1 from public.tracking_workspaces where id=w and owner_id=u) then raise exception 'Forbidden'; end if;
 delete from public.tracking_members where workspace_id=w and user_id=u;
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'member.revoke',u::text);
end $$;
create function public.tracking_anonymize_customer(w uuid,c uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'write') or not private.tracking_access(w,'pii') then raise exception 'Forbidden'; end if;
 update public.tracking_customers set name=null,email=null,phone=null,anonymized_at=now() where workspace_id=w and id=c;
 update private.tracking_receipts r set payload=jsonb_set(payload,'{customer}',jsonb_build_object('external_id',payload->'customer'->>'external_id'))
 where r.workspace_id=w and exists(select 1 from public.tracking_orders o join public.tracking_integrations i on i.id=r.integration_id where o.workspace_id=w and o.customer_id=c and o.external_id=r.payload->>'order_id' and o.provider=i.provider and o.account_id=i.account_id);
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'buyer.anonymize',c::text);
end $$;
revoke execute on function public.tracking_remove_member(uuid,uuid),public.tracking_anonymize_customer(uuid,uuid) from public,anon;
grant execute on function public.tracking_remove_member(uuid,uuid),public.tracking_anonymize_customer(uuid,uuid) to authenticated;
create function public.tracking_select_products(w uuid,i uuid,ids text[]) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.tracking_access(w,'write') or coalesce(array_length(ids,1),0)>100 then raise exception 'Forbidden'; end if;
 update public.tracking_integrations set selected_products=ids where workspace_id=w and id=i and provider in ('kiwify','hotmart','custom');
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'integration.products',i::text);
end $$;
revoke execute on function public.tracking_select_products(uuid,uuid,text[]) from public,anon;
grant execute on function public.tracking_select_products(uuid,uuid,text[]) to authenticated;
alter table public.plans add column if not exists action_type text not null default 'service' check(action_type in ('service','tool'));
alter table public.plans add column if not exists tool_route text;
insert into public.plans(name,type,qty,price,price_orig,tagline,includes,solution_category,action_type,tool_route)
values('Magemind Tracking','Outro',1,0,0,'Pedidos, origem e resultado em um só lugar','Tracking gratuito','other','tool','tracking');
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.tracking_order_events;
 end if;
end $$;

alter table public.tracking_cost_rules add column if not exists calculation text not null default 'legacy';
alter table public.tracking_cost_rules add column if not exists effective_from timestamptz;
alter table public.tracking_cost_rules add column if not exists effective_until timestamptz;
alter table public.tracking_cost_rules add column if not exists archived_at timestamptz;
alter table public.tracking_cost_rules add column if not exists supersedes_id uuid references public.tracking_cost_rules(id);
alter table public.tracking_cost_rules add column if not exists provider text;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.tracking_cost_rules'::regclass and contype='c' and pg_get_constraintdef(oid) like '%expense%' and pg_get_constraintdef(oid) like '%rate_bps%' and pg_get_constraintdef(oid) not like '%calculation%' loop execute format('alter table public.tracking_cost_rules drop constraint %I',c.conname); end loop;
end $$;
alter table public.tracking_cost_rules drop constraint if exists tracking_cost_mode_check;
alter table public.tracking_cost_rules add constraint tracking_cost_mode_check check(
 calculation='legacy' or
 (calculation='fixed_per_item' and category='product' and amount_minor is not null and rate_bps is null) or
 (calculation='percentage' and category in ('tax','fee','expense') and rate_bps is not null and amount_minor is null) or
 (calculation='fixed_per_sale' and category in ('fee','expense') and amount_minor is not null and rate_bps is null) or
 (calculation='fixed_once' and category='expense' and amount_minor is not null and rate_bps is null)
);
create index if not exists tracking_cost_current on public.tracking_cost_rules(workspace_id,currency,category) where archived_at is null;
create table if not exists public.tracking_onboarding (
 user_id uuid primary key references auth.users(id) on delete cascade,
 completed_at timestamptz, celebrated_at timestamptz, created_at timestamptz not null default now()
);
alter table public.tracking_onboarding enable row level security;
drop policy if exists own_onboarding on public.tracking_onboarding;
create policy own_onboarding on public.tracking_onboarding for select to authenticated using(user_id=(select auth.uid()) and (select private.tracking_session_valid()));
revoke all on public.tracking_onboarding from public,anon,authenticated;
grant select on public.tracking_onboarding to authenticated;
grant all on public.tracking_onboarding to service_role;

create or replace function public.tracking_save_cost(w uuid,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid; mode text:=coalesce(p->>'calculation','legacy'); cat text:=p->>'category'; label text:=trim(p->>'name'); amount bigint:=(p->>'amount_minor')::bigint; rate integer:=(p->>'rate_bps')::integer; cur text:=p->>'currency'; product text:=nullif(p->>'product_id',''); prov text:=nullif(p->>'provider',''); tz text;
begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 if label is null or length(label) not between 1 and 120 or cur is null or cur not in ('BRL','USD','EUR','JPY','KWD') or cat is null or cat not in ('product','tax','fee','expense') or amount<0 or amount>9007199254740991 or rate<0 or rate>10000 or length(product)>200 or prov not in ('custom','kiwify','hotmart') then raise exception 'Dados de custo inválidos'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||':costs',0));
 if mode<>'legacy' then
  if not ((cat='product' and mode='fixed_per_item' and amount is not null and rate is null) or(cat='tax' and mode='percentage' and rate is not null and amount is null) or(cat in ('fee','expense') and mode in ('percentage','fixed_per_sale') and ((mode='percentage' and rate is not null and amount is null) or(mode='fixed_per_sale' and amount is not null and rate is null))) or(cat='expense' and mode='fixed_once' and amount is not null and rate is null)) then raise exception 'Selecione apenas valor fixo ou percentual compatível com o tipo'; end if;
  if exists(select 1 from public.tracking_cost_rules where workspace_id=w and archived_at is null and currency=cur and category=cat and (name=label or(cat='product' and product_id is not distinct from product and provider is not distinct from prov))) then raise exception 'Já existe um custo ativo para essa configuração. Edite o custo existente'; end if;
 end if;
 select timezone into tz from public.tracking_workspaces where id=w;
 insert into public.tracking_cost_rules(workspace_id,name,product_id,provider,category,calculation,amount_minor,rate_bps,currency,valid_from,valid_to,effective_from)
 values(w,label,product,prov,cat,mode,amount,rate,cur,case when mode='legacy' then (p->>'valid_from')::date else(now() at time zone tz)::date end,case when mode='legacy' then(p->>'valid_to')::date else null end,case when mode='legacy' then null else now() end) returning id into v;
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,auth.uid(),'cost.create',v::text);
 return v;
end $$;

create or replace function public.tracking_update_cost(w uuid,c uuid,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.tracking_cost_rules; v uuid;
begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||':costs',0));
 select * into old from public.tracking_cost_rules where workspace_id=w and id=c for update;
 if not found or old.archived_at is not null then raise exception 'Esse custo já foi alterado ou removido. Atualize a lista'; end if;
 update public.tracking_cost_rules set archived_at=now(),effective_until=now() where id=c;
 v:=public.tracking_save_cost(w,p);
 update public.tracking_cost_rules set supersedes_id=c where id=v;
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id,details) values(w,auth.uid(),'cost.update',v::text,jsonb_build_object('previous_id',c));
 return v;
end $$;
create or replace function public.tracking_archive_cost(w uuid,c uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||':costs',0));
 update public.tracking_cost_rules set archived_at=now(),effective_until=now() where workspace_id=w and id=c and archived_at is null;
 if found then insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,auth.uid(),'cost.archive',c::text); end if;
end $$;

create or replace function public.tracking_order_costs(w uuid,oid uuid) returns bigint language plpgsql security invoker set search_path='' as $$
declare o public.tracking_orders; approval_date date; base bigint; extra bigint;
begin
 select * into strict o from public.tracking_orders where workspace_id=w and id=oid;
 select(o.approved_at at time zone timezone)::date into approval_date from public.tracking_workspaces where id=w;
 select case when bool_or(cr.id is null and not exists(select 1 from public.tracking_cost_rules prior where prior.workspace_id=w and prior.category='product' and prior.currency=o.currency and(prior.provider is null or prior.provider=o.provider) and(prior.product_id is null or prior.product_id=it.product_id) and prior.effective_until<=o.approved_at)) then null
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
  and(r.category<>'fee' or(o.recipient_minor is null and o.gateway_fee_minor is null))
  order by name,category,r.valid_from desc,r.effective_from desc nulls last,r.created_at desc
 )r;
 return base+extra;
end $$;
create or replace function public.tracking_period_expenses(w uuid,f date,t date,cur text) returns bigint language plpgsql security invoker set search_path='' as $$
declare tz text; v bigint; once bigint;
begin
 select timezone into tz from public.tracking_workspaces where id=w;
 select coalesce(sum((amount_minor/(coalesce(valid_to,valid_from)-valid_from+1))*greatest(0,least(t,cutoff.stop_date)-greatest(f,valid_from)+1)
 +greatest(0,least(t,cutoff.stop_date,valid_from+(amount_minor%(coalesce(valid_to,valid_from)-valid_from+1))::integer-1)-greatest(f,valid_from)+1)),0) into v
 from public.tracking_cost_rules cross join lateral(select least(coalesce(valid_to,valid_from),coalesce((effective_until at time zone tz)::date,coalesce(valid_to,valid_from))) stop_date) cutoff
 where workspace_id=w and category='expense' and calculation='legacy' and currency=cur and valid_from<=t and coalesce(valid_to,valid_from)>=f;
 select coalesce(sum(amount_minor),0) into once from public.tracking_cost_rules where workspace_id=w and category='expense' and calculation='fixed_once' and currency=cur and(effective_from at time zone tz)::date between f and t;
 return v+once;
end $$;
create or replace function public.tracking_cost_products(w uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from(select o.provider,it.product_id,max(it.name) name,o.currency from public.tracking_order_items it join public.tracking_orders o on o.id=it.order_id where it.workspace_id=w group by o.provider,it.product_id,o.currency order by max(it.name) limit 500)r),'[]');
end $$;

create or replace function public.tracking_onboarding_status(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); saved public.tracking_onboarding; checkout boolean; ads boolean; costs boolean; journey boolean; orders boolean; ad_history boolean; cost_history boolean; events boolean; n integer; tasks jsonb;
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 select exists(select 1 from public.tracking_integrations where workspace_id=w and connected and provider in('custom','kiwify','hotmart')) into checkout;
 select exists(select 1 from public.tracking_integrations where workspace_id=w and connected and provider in('meta','google')) into ads;
 select exists(select 1 from public.tracking_cost_rules where workspace_id=w and category='product' and archived_at is null) into costs;
 select exists(select 1 from public.tracking_events where workspace_id=w) into events;
 select exists(select 1 from public.tracking_sites s where s.workspace_id=w and s.enabled and exists(select 1 from public.tracking_events e where e.site_id=s.id)) into journey;
 select exists(select 1 from public.tracking_orders where workspace_id=w) into orders;
 select exists(select 1 from public.tracking_ad_stats_daily where workspace_id=w) into ad_history;
 select exists(select 1 from public.tracking_ledger where workspace_id=w and cost_delta_minor is not null) into cost_history;
 n:=checkout::integer+ads::integer+costs::integer+journey::integer+orders::integer;
 insert into public.tracking_onboarding(user_id,completed_at) values(uid,case when n=5 then now() end) on conflict(user_id) do update set completed_at=coalesce(tracking_onboarding.completed_at,excluded.completed_at) returning * into saved;
 tasks:=jsonb_build_array(jsonb_build_object('id','checkout','done',checkout),jsonb_build_object('id','ads','done',ads),jsonb_build_object('id','costs','done',costs),jsonb_build_object('id','journey','done',journey),jsonb_build_object('id','order','done',orders));
 return jsonb_build_object('tasks',tasks,'percent',case when saved.completed_at is not null then 100 else n*20 end,'completed_at',saved.completed_at,'celebration_pending',saved.completed_at is not null and saved.celebrated_at is null,
 'checkout_ready',checkout or orders,'ads_ready',ads or ad_history,'costs_ready',costs or cost_history,'journey_ready',events,'has_orders',orders,'has_checkout',checkout,'has_ads',ads);
end $$;
create or replace function public.tracking_onboarding_celebrate(w uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 update public.tracking_onboarding set celebrated_at=now() where user_id=auth.uid() and completed_at is not null and celebrated_at is null;
 return found;
end $$;
revoke execute on function public.tracking_save_cost(uuid,jsonb),public.tracking_update_cost(uuid,uuid,jsonb),public.tracking_archive_cost(uuid,uuid),public.tracking_cost_products(uuid),public.tracking_onboarding_status(uuid),public.tracking_onboarding_celebrate(uuid) from public,anon;
grant execute on function public.tracking_save_cost(uuid,jsonb),public.tracking_update_cost(uuid,uuid,jsonb),public.tracking_archive_cost(uuid,uuid),public.tracking_cost_products(uuid),public.tracking_onboarding_status(uuid),public.tracking_onboarding_celebrate(uuid) to authenticated;
revoke execute on function public.tracking_order_costs(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tracking_order_costs(uuid,uuid) to service_role;
revoke execute on function public.tracking_period_expenses(uuid,date,date,text) from public,anon;
grant execute on function public.tracking_period_expenses(uuid,date,date,text) to authenticated,service_role;

create or replace function public.tracking_process_receipt(r uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec private.tracking_receipts; intg public.tracking_integrations; e jsonb; old public.tracking_orders; o public.tracking_orders;
 c uuid; first_paid boolean; old_gross bigint:=0; new_gross bigint:=0; old_refund bigint:=0; old_net bigint; new_net bigint;
 tr jsonb; touch jsonb; ch text; ad text; acct text; ev text; reason text; costs bigint; extra_costs bigint; approval_date date; pref record;
begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select * into strict rec from private.tracking_receipts where id=r;
 select * into strict intg from public.tracking_integrations where id=rec.integration_id;
 e:=rec.payload;
 if cardinality(intg.selected_products)>0 and not exists(select 1 from jsonb_array_elements(e->'items') it where it->>'external_product_id'=any(intg.selected_products)) then
  update public.tracking_order_events set processing='ignored',reason='Product outside selected scope' where id=r;
  update private.tracking_jobs set state='done',locked_until=null where receipt_id=r;
  return null;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(intg.workspace_id::text||intg.provider||intg.account_id||(e->>'order_id'),0));
 if exists(select 1 from private.tracking_jobs where receipt_id=r and state='done') then
  return (select order_id from public.tracking_order_events where id=r);
 end if;
 select * into old from public.tracking_orders where workspace_id=intg.workspace_id and provider=intg.provider and account_id=intg.account_id and external_id=e->>'order_id' for update;
 if old.id is not null and (old.currency<>e->>'currency' or old.amount_scale<>(e->>'amount_scale')::integer or old.gross_minor<>(e->>'gross_amount_minor')::bigint) then raise exception 'Order identity or amount changed'; end if;
 if old.id is not null and ((e->>'occurred_at')::timestamptz<old.last_occurred_at or (old.approved_at is not null and e->>'status' in ('pending','refused','cancelled')) or (old.status in ('refunded','chargeback') and e->>'status' in ('paid','disputed'))) then
  update public.tracking_order_events set order_id=old.id,processing='ignored',reason='Stale or regressive event' where id=r;
  update private.tracking_jobs set state='done' where receipt_id=r; return old.id;
 end if;
 if nullif(e->'customer'->>'external_id','') is not null then
  insert into public.tracking_customers(workspace_id,provider,account_id,external_id,name,email,phone)
  values(intg.workspace_id,intg.provider,intg.account_id,e->'customer'->>'external_id',e->'customer'->>'name',e->'customer'->>'email',e->'customer'->>'phone')
  on conflict(workspace_id,provider,account_id,external_id) do update set name=case when tracking_customers.anonymized_at is null then coalesce(excluded.name,tracking_customers.name) end,email=case when tracking_customers.anonymized_at is null then coalesce(excluded.email,tracking_customers.email) end,phone=case when tracking_customers.anonymized_at is null then coalesce(excluded.phone,tracking_customers.phone) end returning id into c;
 end if;
 first_paid:=e->>'status'='paid' and old.approved_at is null;
 if old.approved_at is not null then old_gross:=old.gross_minor; old_refund:=old.refund_minor; end if;
 select coalesce(sum(recipient_delta_minor),0) into old_net from public.tracking_ledger where order_id=old.id;
 insert into public.tracking_orders(workspace_id,provider,account_id,external_id,customer_id,customer_identity_reliable,status,currency,amount_scale,gross_minor,gateway_fee_minor,recipient_minor,refund_minor,recipient_refund_minor,renewal,root_order_id,payment_method,created_at,approved_at,last_occurred_at)
 values(intg.workspace_id,intg.provider,intg.account_id,e->>'order_id',c,c is not null and coalesce((e->'customer'->>'identity_reliable')::boolean,true),e->>'status',e->>'currency',(e->>'amount_scale')::integer,(e->>'gross_amount_minor')::bigint,
 (e->>'gateway_fee_minor')::bigint,(e->>'recipient_revenue_minor')::bigint,coalesce((e->>'refunded_amount_minor')::bigint,0),(e->>'recipient_refunded_minor')::bigint,
 coalesce((e->>'renewal')::boolean,false),e->>'root_order_id',e->>'payment_method',(e->>'created_at')::timestamptz,
 coalesce(old.approved_at,case when e->>'status' in ('paid','refunded','chargeback','disputed') then (e->>'approved_at')::timestamptz end),(e->>'occurred_at')::timestamptz)
 on conflict(workspace_id,provider,account_id,external_id) do update set status=excluded.status,customer_id=case when not tracking_orders.customer_identity_reliable and excluded.customer_identity_reliable then excluded.customer_id else coalesce(tracking_orders.customer_id,excluded.customer_id) end,customer_identity_reliable=tracking_orders.customer_identity_reliable or excluded.customer_identity_reliable,
 gateway_fee_minor=coalesce(excluded.gateway_fee_minor,tracking_orders.gateway_fee_minor),recipient_minor=coalesce(excluded.recipient_minor,tracking_orders.recipient_minor),
 refund_minor=greatest(tracking_orders.refund_minor,excluded.refund_minor),recipient_refund_minor=coalesce(excluded.recipient_refund_minor,tracking_orders.recipient_refund_minor),
 approved_at=coalesce(tracking_orders.approved_at,excluded.approved_at),last_occurred_at=excluded.last_occurred_at,received_at=now()
 returning * into o;
 update public.tracking_orders set money_components=coalesce(e->'money_components','{}') where id=o.id and e ? 'money_components';
 if old.id is null then
  insert into public.tracking_order_items(workspace_id,order_id,line,product_id,name,quantity,amount_minor)
  select intg.workspace_id,o.id,n::integer,x->>'external_product_id',x->>'name',(x->>'quantity')::integer,(x->>'amount_minor')::bigint
  from jsonb_array_elements(e->'items') with ordinality a(x,n);
  tr:=coalesce(e->'tracking','{}'); touch:=tr;
  select t.tracking into touch from public.tracking_events t join public.tracking_workspaces w on w.id=t.workspace_id
  where t.workspace_id=intg.workspace_id and t.click_id=tr->>'mm_click_id'
  and t.occurred_at<=(e->>'created_at')::timestamptz and t.occurred_at>=(e->>'created_at')::timestamptz-make_interval(days=>w.attribution_days)
  and coalesce(t.tracking->>'utm_source','') not in ('','direct') order by t.occurred_at desc limit 1;
  if touch is null then touch:=tr; ev:='checkout_metadata'; else ev:='click_id'; end if;
  ch:=case lower(coalesce(touch->>'utm_source','')) when 'facebook' then 'meta' when 'fb' then 'meta' when 'instagram' then 'meta' else lower(coalesce(touch->>'utm_source','unattributed')) end;
  ad:=coalesce(touch->>'ad_id',touch->>'utm_content');
  select a.account_id into acct from public.tracking_ad_entities a join public.tracking_ad_accounts ac using(workspace_id,provider,account_id)
  where a.workspace_id=intg.workspace_id and a.provider=ch and a.entity_id=ad and a.level='ad' and ac.selected limit 1;
  if acct is null then ad:=null; reason:='No matching selected advertising account'; end if;
  if ch='' then ch:='unattributed'; end if;
  insert into public.tracking_attributions(workspace_id,order_id,channel,ad_id,account_id,evidence,confidence,first_touch,frozen_touch,reason)
  values(intg.workspace_id,o.id,ch,ad,acct,ev,case when ev='click_id' then 'medium' when ad is not null then 'medium' else 'low' end,coalesce(touch->'first_touch',e->'tracking'->'first_touch','{}'),coalesce(touch,'{}'),reason);
 end if;
 if o.approved_at is not null then new_gross:=o.gross_minor; end if;
 new_net:=case when o.approved_at is null then 0 when o.recipient_minor is null or (o.refund_minor>0 and o.recipient_refund_minor is null) then null else o.recipient_minor-coalesce(o.recipient_refund_minor,0) end;
 costs:=0;
 if old.approved_at is null and o.approved_at is not null then
  -- Snapshot cost rules at approval. Later rule changes do not rewrite prior ledger entries.
  costs:=public.tracking_order_costs(intg.workspace_id,o.id);
  if not first_paid then
   -- Reconciliation may first discover an already-refunded payment.
   -- Recover approval in its original period, then book only the refund delta.
   insert into public.tracking_ledger(workspace_id,order_id,event_key,occurred_at,currency,amount_scale,gross_delta_minor,refund_delta_minor,recipient_delta_minor,cost_delta_minor)
   values(intg.workspace_id,o.id,rec.event_key||':approval',o.approved_at,o.currency,o.amount_scale,o.gross_minor,0,o.recipient_minor,costs);
   old_gross:=o.gross_minor;old_net:=o.recipient_minor;costs:=0;
  end if;
 end if;
 if new_gross<>old_gross or o.refund_minor<>old_refund or (new_net is not null and new_net is distinct from old_net) then
  insert into public.tracking_ledger(workspace_id,order_id,event_key,occurred_at,currency,amount_scale,gross_delta_minor,refund_delta_minor,recipient_delta_minor,cost_delta_minor)
  values(intg.workspace_id,o.id,rec.event_key,case when first_paid then o.approved_at else (e->>'occurred_at')::timestamptz end,o.currency,o.amount_scale,new_gross-old_gross,o.refund_minor-old_refund,new_net-old_net,costs);
 end if;
 if first_paid and not coalesce((e->>'historical')::boolean,false) then
  for pref in select p.* from public.tracking_notification_preferences p join public.tracking_members m using(workspace_id,user_id) where p.workspace_id=intg.workspace_id and case when o.renewal then p.renewals else p.sales end loop
   insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
   values(intg.workspace_id,o.id,pref.user_id,'in_app',case when o.renewal then 'renewal' else 'sale' end,o.id::text||':approved:in_app:'||pref.user_id::text) on conflict do nothing;
   if exists(select 1 from private.tracking_push_subscriptions s where s.workspace_id=intg.workspace_id and s.user_id=pref.user_id and s.enabled) then
    insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
    values(intg.workspace_id,o.id,pref.user_id,'push','sale',o.id::text||':approved:push:'||pref.user_id::text) on conflict do nothing;
   end if;
  end loop;
  if exists(select 1 from private.tracking_conversion_destinations d where d.workspace_id=intg.workspace_id and d.enabled and d.coordinated_emitter and d.consent and d.test_event_code is not null) then
   insert into public.tracking_deliveries(workspace_id,order_id,channel,category,event_key) values(intg.workspace_id,o.id,'capi','purchase','mm:'||o.id::text||':approved') on conflict do nothing;
  end if;
 end if;
 if o.refund_minor>old_refund and not coalesce((e->>'historical')::boolean,false) then
  for pref in select p.* from public.tracking_notification_preferences p join public.tracking_members m using(workspace_id,user_id) where p.workspace_id=intg.workspace_id and p.refunds loop
   insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
   values(intg.workspace_id,o.id,pref.user_id,'in_app','refund',o.id::text||':refund:'||o.refund_minor::text||':in_app:'||pref.user_id::text) on conflict do nothing;
   if exists(select 1 from private.tracking_push_subscriptions s where s.workspace_id=intg.workspace_id and s.user_id=pref.user_id and s.enabled) then
    insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key)
    values(intg.workspace_id,o.id,pref.user_id,'push','refund',o.id::text||':refund:'||o.refund_minor::text||':push:'||pref.user_id::text) on conflict do nothing;
   end if;
  end loop;
 end if;
 update public.tracking_order_events set order_id=o.id,processing='processed' where id=r;
 update private.tracking_jobs set state='done',locked_until=null where receipt_id=r;
 return o.id;
end $$;

create or replace function public.tracking_report(w uuid,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare action text:=p->>'action'; f date:=coalesce((p->>'from')::date,current_date-6); t date:=coalesce((p->>'to')::date,current_date);
 cur text:=coalesce(p->>'currency','BRL'); page integer:=greatest(1,coalesce((p->>'page')::integer,1)); out jsonb; n bigint; tz text; gross bigint; refund bigint; net bigint; costs bigint; spend bigint; expense bigint; paid bigint; acquisition bigint; pending bigint; attributed bigint; last_order timestamptz; last_sync timestamptz;
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 select timezone into tz from public.tracking_workspaces where id=w;
 if action='summary' then
  select coalesce(sum(gross_minor),0),coalesce(sum(refund_minor),0),case when bool_or(recipient_minor is null) then null else coalesce(sum(recipient_minor),0) end,case when bool_or(costs_minor is null) then null else coalesce(sum(costs_minor),0) end
  into gross,refund,net,costs from public.tracking_daily_metrics where workspace_id=w and date between f and t and currency=cur;
  select sum(s.spend_minor),max(s.synced_at) into spend,last_sync from public.tracking_ad_stats_daily s join public.tracking_ad_accounts a using(workspace_id,provider,account_id) where s.workspace_id=w and a.selected and s.date between f and t and s.currency=cur and s.breakdown='';
  expense:=public.tracking_period_expenses(w,f,t,cur);
  select count(*) filter(where o.status='pending'),count(*) filter(where o.approved_at is not null and a.channel in ('meta','google')),
  count(*) filter(where o.approved_at is not null and a.channel in ('meta','google') and not o.renewal and o.customer_id is not null and o.customer_identity_reliable and not exists(select 1 from public.tracking_orders prior where prior.workspace_id=w and prior.customer_id=o.customer_id and (prior.approved_at<o.approved_at or(prior.approved_at=o.approved_at and prior.id<o.id)))),max(o.received_at)
  into pending,paid,acquisition,last_order from public.tracking_orders o left join public.tracking_attributions a on a.order_id=o.id where o.workspace_id=w and (coalesce(o.approved_at,o.created_at) at time zone tz)::date between f and t and o.currency=cur;
  select coalesce(sum(l.gross_delta_minor-l.refund_delta_minor),0) into attributed from public.tracking_ledger l join public.tracking_attributions a on a.order_id=l.order_id where l.workspace_id=w and a.channel in ('meta','google') and (l.occurred_at at time zone tz)::date between f and t and l.currency=cur;
  return jsonb_build_object('daily',coalesce((select jsonb_agg(to_jsonb(d)) from(select * from public.tracking_daily_metrics where workspace_id=w and date between f and t and currency=cur order by date)d),'[]'),'gross_minor',gross,'refund_minor',refund,'recipient_minor',net,'costs_minor',costs,'expense_minor',expense,'spend_minor',spend,'estimated_minor',net-costs-spend-expense,'attributed_minor',attributed,'pending',pending,'paid',paid,'acquisitions',acquisition,'last_order',last_order,'last_sync',last_sync,'currency',cur);
 elsif action in ('list/orders','export') then
  select count(*) into n from public.tracking_orders o left join public.tracking_attributions a on a.order_id=o.id left join public.tracking_customers c on c.id=o.customer_id
  where o.workspace_id=w and (o.created_at at time zone tz)::date between f and t and o.currency=cur
  and (coalesce(p->>'status','')='' or o.status=p->>'status') and(coalesce(p->>'provider','')='' or o.provider=p->>'provider')
  and(coalesce(p->>'channel','')='' or a.channel=p->>'channel') and(coalesce(p->>'payment','')='' or o.payment_method=p->>'payment')
  and(coalesce(p->>'search','')='' or o.external_id ilike '%'||(p->>'search')||'%' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%' or c.phone ilike '%'||(p->>'search')||'%' or exists(select 1 from public.tracking_order_items it where it.order_id=o.id and it.name ilike '%'||(p->>'search')||'%'));
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into out from (
   select o.*,a.channel,a.evidence,c.name buyer_name,c.email buyer_email from public.tracking_orders o left join public.tracking_attributions a on a.order_id=o.id left join public.tracking_customers c on c.id=o.customer_id
   where o.workspace_id=w and (o.created_at at time zone tz)::date between f and t and o.currency=cur
   and(coalesce(p->>'status','')='' or o.status=p->>'status') and(coalesce(p->>'provider','')='' or o.provider=p->>'provider') and(coalesce(p->>'channel','')='' or a.channel=p->>'channel') and(coalesce(p->>'payment','')='' or o.payment_method=p->>'payment')
   and(coalesce(p->>'search','')='' or o.external_id ilike '%'||(p->>'search')||'%' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%' or c.phone ilike '%'||(p->>'search')||'%' or exists(select 1 from public.tracking_order_items it where it.order_id=o.id and it.name ilike '%'||(p->>'search')||'%'))
   order by o.created_at desc,o.id limit 25 offset (page-1)*25
  )r;return jsonb_build_object('rows',out,'total',n,'page',page,'size',25);
 elsif action='order' then
  select to_jsonb(o)||jsonb_build_object('buyer_name',c.name,'buyer_email',c.email,'buyer_phone',c.phone) into out from public.tracking_orders o left join public.tracking_customers c on c.id=o.customer_id where o.workspace_id=w and o.id=(p->>'id')::uuid;
  if out is null then raise exception 'Order unavailable'; end if;
  return jsonb_build_object('order',out,'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.tracking_order_items i where i.workspace_id=w and i.order_id=(p->>'id')::uuid),'[]'),'attribution',(select to_jsonb(a) from public.tracking_attributions a where a.workspace_id=w and a.order_id=(p->>'id')::uuid),'history',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at,e.received_at) from public.tracking_order_events e where e.workspace_id=w and e.order_id=(p->>'id')::uuid),'[]'),'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.occurred_at) from public.tracking_ledger l where l.workspace_id=w and l.order_id=(p->>'id')::uuid),'[]'));
 elsif action='list/customers' then
  if not private.tracking_access(w,'pii') then raise exception 'Buyer permission required'; end if;
  select count(*) into n from public.tracking_customers c where c.workspace_id=w and (coalesce(p->>'search','')='' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%');
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into out from(select c.*,count(o.id) orders from public.tracking_customers c left join public.tracking_orders o on o.customer_id=c.id where c.workspace_id=w and(coalesce(p->>'search','')='' or c.name ilike '%'||(p->>'search')||'%' or c.email ilike '%'||(p->>'search')||'%') group by c.id order by c.created_at desc limit 25 offset(page-1)*25)r;
  return jsonb_build_object('rows',out,'total',n,'page',page,'size',25);
 elsif action='customer' then
  if not private.tracking_access(w,'pii') then raise exception 'Buyer permission required'; end if;
  select to_jsonb(c) into out from public.tracking_customers c where c.workspace_id=w and c.id=(p->>'id')::uuid;
  if out is null then raise exception 'Buyer unavailable'; end if;
  return jsonb_build_object('customer',out,'orders',coalesce((select jsonb_agg(to_jsonb(o)) from(select * from public.tracking_orders where workspace_id=w and customer_id=(p->>'id')::uuid order by created_at desc limit 25)o),'[]'));
 elsif action='list/ads' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into out from (
   select s.provider,s.account_id,s.entity_id,e.name,sum(s.spend_minor) spend_minor,sum(s.impressions) impressions,sum(s.clicks) clicks,sum(s.network_purchases) network_purchases,max(s.synced_at) synced_at,
   (select count(*) from public.tracking_orders o join public.tracking_attributions att on att.order_id=o.id where o.workspace_id=w and o.currency=cur and (o.approved_at at time zone tz)::date between f and t and att.channel=s.provider and att.account_id=s.account_id and att.ad_id=s.entity_id) checkout_purchases
   from public.tracking_ad_stats_daily s join public.tracking_ad_accounts a using(workspace_id,provider,account_id) join public.tracking_ad_entities e using(workspace_id,provider,account_id,entity_id)
   where s.workspace_id=w and s.date between f and t and s.currency=cur and a.selected and s.breakdown=''
   and(coalesce(p->>'provider','')='' or s.provider=p->>'provider') and(coalesce(p->>'account_id','')='' or s.account_id=p->>'account_id')
   and(coalesce(p->>'entity_id','')='' or s.entity_id=p->>'entity_id' or e.parent_id=p->>'entity_id' or exists(select 1 from public.tracking_ad_entities parent where parent.workspace_id=w and parent.provider=s.provider and parent.account_id=s.account_id and parent.entity_id=e.parent_id and parent.parent_id=p->>'entity_id'))
   group by s.provider,s.account_id,s.entity_id,e.name order by sum(s.spend_minor) desc limit 100
  )r;return jsonb_build_object('rows',out);
 elsif action='ad-options' then
  return jsonb_build_object('accounts',coalesce((select jsonb_agg(to_jsonb(a)) from public.tracking_ad_accounts a where a.workspace_id=w and a.selected),'[]'),'entities',coalesce((select jsonb_agg(to_jsonb(e)) from(select * from public.tracking_ad_entities where workspace_id=w order by name limit 500)e),'[]'));
 elsif action='funnel' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from(select event_name,count(distinct session_id) sessions,count(*) events from public.tracking_events where workspace_id=w and(occurred_at at time zone tz)::date between f and t group by event_name)r),'[]'),'orders',coalesce((select jsonb_agg(to_jsonb(r)) from(select status,count(*) orders from public.tracking_orders where workspace_id=w and(created_at at time zone tz)::date between f and t and currency=cur group by status)r),'[]'),'coverage','Jornada observada pelo coletor próprio; checkout_click não mede início real. Pedidos vêm do checkout autenticado.');
 elsif action='diagnostics' then
  select count(*) into n from public.tracking_order_events where workspace_id=w;
  return jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(r)) from(select * from public.tracking_order_events where workspace_id=w order by received_at desc limit 25 offset(page-1)*25)r),'[]'),'integrations',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'error_code',error_code,'last_sync_at',last_sync_at,'last_received_at',last_received_at)) from public.tracking_integrations where workspace_id=w),'[]'),'deliveries',coalesce((select jsonb_agg(to_jsonb(r)) from(select * from public.tracking_deliveries where workspace_id=w order by next_attempt_at desc limit 25)r),'[]'),'total',n,'page',page);
 elsif action='settings' then
  return jsonb_build_object('workspace',(select to_jsonb(x) from public.tracking_workspaces x where id=w),'members',coalesce((select jsonb_agg(to_jsonb(x)) from public.tracking_members x where workspace_id=w),'[]'),'preferences',coalesce((select to_jsonb(x) from public.tracking_notification_preferences x where workspace_id=w and user_id=(select auth.uid())),'{}'),'environment','test','backend','Supabase local isolado; credenciais externas de teste');
 elsif action='notifications' then
  return coalesce((select jsonb_agg(to_jsonb(r)) from(select d.id,d.order_id,d.integration_id,d.category,d.state,p.hide_amount,o.gross_minor,o.currency from public.tracking_deliveries d left join public.tracking_orders o on o.id=d.order_id left join public.tracking_notification_preferences p on p.workspace_id=d.workspace_id and p.user_id=d.user_id where d.workspace_id=w and d.channel='in_app' order by d.next_attempt_at desc limit 20)r),'[]');
 end if;
 raise exception 'Unknown report';
end $$;

-- Included only in the restricted online pilot migration.
create table private.tracking_pilot_allowlist(user_id uuid primary key references auth.users on delete cascade,enabled boolean not null default true);
revoke all on private.tracking_pilot_allowlist from public,anon,authenticated;
grant all on private.tracking_pilot_allowlist to service_role;
insert into private.tracking_pilot_allowlist(user_id) select id from auth.users where lower(email) in('ogabrielmrossi@gmail.com','gabrielmelo@gmail.com') and email_confirmed_at is not null;
create function private.tracking_account_enabled(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join private.tracking_pilot_allowlist a on a.user_id=p.id join auth.users usr on usr.id=p.id where p.id=u and p.active and p.archived_at is null and a.enabled and usr.email_confirmed_at is not null and lower(usr.email) in('ogabrielmrossi@gmail.com','gabrielmelo@gmail.com'));
$$;
revoke all on function private.tracking_account_enabled(uuid) from public,anon,authenticated;
grant execute on function private.tracking_account_enabled(uuid) to service_role;
create or replace function private.tracking_session_valid() returns boolean language sql stable security definer set search_path='' as $$
 select private.tracking_account_enabled(auth.uid()) and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=(auth.jwt()->>'session_id'));
$$;
create function public.tracking_pilot_access() returns boolean language sql stable security definer set search_path='' as $$select private.tracking_session_valid()$$;
revoke all on function public.tracking_pilot_access() from public,anon;
grant execute on function public.tracking_pilot_access() to authenticated;
alter table public.tracking_workspaces add column simulation_only boolean not null default false;
create function public.tracking_demo_workspace() returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 if not private.tracking_session_valid() then raise exception 'Forbidden';end if;
 select id into w from public.tracking_workspaces where owner_id=auth.uid() and simulation_only limit 1;
 if w is null then w:=public.tracking_create_workspace('Demonstração');update public.tracking_workspaces set simulation_only=true where id=w;end if;
 return w;
end $$;
revoke all on function public.tracking_demo_workspace() from public,anon;
grant execute on function public.tracking_demo_workspace() to authenticated;
-- Never mix generated sales and real integrations in one operation.
create function private.tracking_connection_mode() returns trigger language plpgsql set search_path='' as $$
begin if(new.mode='simulated') is distinct from(select simulation_only from public.tracking_workspaces where id=new.workspace_id) then raise exception 'Use uma operação de demonstração separada para exemplos';end if;return new;end $$;
create trigger tracking_connection_mode before insert or update of mode,workspace_id on public.tracking_integrations for each row execute function private.tracking_connection_mode();
-- Cryptographic keys stay in Vault. Only the Edge service may read them.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'),'tracking_encryption_key');
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'tracking_worker_secret');
create function public.tracking_runtime_keys() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_object_agg(case name when 'tracking_encryption_key' then 'TRACKING_ENCRYPTION_KEY' else 'TRACKING_WORKER_SECRET' end,decrypted_secret) from vault.decrypted_secrets where name in('tracking_encryption_key','tracking_worker_secret');
$$;
revoke all on function public.tracking_runtime_keys() from public,anon,authenticated;
grant execute on function public.tracking_runtime_keys() to service_role;
create function private.tracking_tick() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(url:='https://tsawxmlfvnvepzgcztfc.supabase.co/functions/v1/tracking-worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='tracking_worker_secret' limit 1)),body:='{}',timeout_milliseconds:=55000);
$$;
revoke all on function private.tracking_tick() from public,anon,authenticated;
grant execute on function private.tracking_tick() to service_role;
select cron.schedule('tracking-pilot-worker','* * * * *','select private.tracking_tick();');
-- Supabase may grant authenticated EXECUTE by default; these RPCs are worker-only.
revoke execute on function public.tracking_ingest(uuid,jsonb,text,boolean),public.tracking_process_receipt(uuid),public.tracking_claim_jobs(integer),public.tracking_fail_job(uuid,text),public.tracking_prune() from authenticated;
do $$ declare t text;begin foreach t in array array['tracking_order_events','tracking_ad_stats_daily'] loop if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;end loop;end $$;

do $$declare r record;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r' and c.relname like 'tracking_%' loop execute format('grant all on %I.%I to service_role',r.nspname,r.relname);if r.nspname='private' then execute format('revoke all on %I.%I from public,anon,authenticated',r.nspname,r.relname);end if;end loop;for r in select p.oid::regprocedure fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'tracking_%' loop execute format('revoke execute on function %s from public,anon',r.fn);end loop;end $$;
-- The pilot allowlist is unchanged. Staff receive observation, never ownership.
alter table public.tracking_workspaces add column if not exists simulation_only boolean not null default false;
create index if not exists tracking_workspaces_owner on public.tracking_workspaces(owner_id,id);
create or replace function private.tracking_is_observer() returns boolean language sql stable security definer set search_path='' as $$
 select (select private.tracking_session_valid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and role in('ceo','manager') and active and archived_at is null);
$$;
revoke all on function private.tracking_is_observer() from public,anon;
grant execute on function private.tracking_is_observer() to authenticated,service_role;
create or replace function public.tracking_observer_access() returns boolean language sql stable security invoker set search_path='' as $$select private.tracking_is_observer()$$;
revoke all on function public.tracking_observer_access() from public,anon;
grant execute on function public.tracking_observer_access() to authenticated;

create or replace function private.tracking_observer_workspaces() returns setof uuid language sql stable security definer set search_path='' as $$
 select w.id from public.tracking_workspaces w join public.profiles p on p.id=w.owner_id where (select private.tracking_is_observer()) and p.role not in('ceo','manager');
$$;
revoke all on function private.tracking_observer_workspaces() from public,anon;
grant execute on function private.tracking_observer_workspaces() to authenticated,service_role;
create or replace function private.tracking_access(w uuid,capability text default 'read') returns boolean language sql stable security definer set search_path='' as $$
 select private.tracking_session_valid() and case when private.tracking_is_observer() then capability in('read','pii') and w in(select private.tracking_observer_workspaces()) else exists(select 1 from public.tracking_members m where m.workspace_id=w and m.user_id=auth.uid() and case capability when 'write' then m.role in('owner','admin') when 'owner' then m.role='owner' when 'pii' then m.can_view_buyers else true end) end;
$$;
create or replace function private.tracking_workspace_ids(capability text default 'read') returns setof uuid language sql stable security definer set search_path='' as $$
 select s from private.tracking_observer_workspaces() s where capability in('read','pii')
 union all select m.workspace_id from public.tracking_members m where not(select private.tracking_is_observer()) and(select private.tracking_session_valid()) and m.user_id=(select auth.uid()) and case capability when 'pii' then m.can_view_buyers when 'write' then m.role in('owner','admin') when 'owner' then m.role='owner' else true end;
$$;
create or replace function private.tracking_observer_catalog() returns table(id uuid,owner_id uuid,name text,client_name text,owner_role text,currency text,timezone text,simulation_only boolean) language sql stable security definer set search_path='' as $$
 select w.id,w.owner_id,w.name,coalesce(nullif(c.name,''),nullif(p.name,''),'Conta'),p.role::text,w.currency,w.timezone,w.simulation_only from public.tracking_workspaces w join public.profiles p on p.id=w.owner_id left join public.clients c on c.id=p.client_id where w.id in(select private.tracking_observer_workspaces());
$$;
revoke all on function private.tracking_observer_catalog() from public,anon;
grant execute on function private.tracking_observer_catalog() to authenticated,service_role;

-- Cover direct table access and mutation RPCs, including old own workspaces.
create or replace function private.tracking_deny_observer_creation() returns trigger language plpgsql set search_path='' as $$begin if private.tracking_is_observer() then raise exception 'Acompanhamento somente leitura';end if;return new;end $$;
revoke all on function private.tracking_deny_observer_creation() from public,anon;
drop trigger if exists tracking_observer_creation on public.tracking_workspaces;
create trigger tracking_observer_creation before insert on public.tracking_workspaces for each row execute function private.tracking_deny_observer_creation();
drop trigger if exists tracking_observer_onboarding on public.tracking_onboarding;
create trigger tracking_observer_onboarding before insert or update on public.tracking_onboarding for each row execute function private.tracking_deny_observer_creation();
drop policy if exists observer_no_preferences on public.tracking_notification_preferences;
create policy observer_no_preferences on public.tracking_notification_preferences as restrictive for all to authenticated using(not(select private.tracking_is_observer())) with check(not(select private.tracking_is_observer()));
create or replace function public.tracking_onboarding_celebrate(w uuid) returns boolean language plpgsql security definer set search_path='' as $$begin
 if private.tracking_is_observer() or not private.tracking_access(w) then raise exception 'Acompanhamento somente leitura';end if;
 update public.tracking_onboarding set celebrated_at=now() where user_id=auth.uid() and completed_at is not null and celebrated_at is null;return found;
end $$;
create or replace function public.tracking_push_subscribe(w uuid,p jsonb) returns void language plpgsql security definer set search_path='' as $$begin
 if private.tracking_is_observer() or not private.tracking_access(w) or p->>'endpoint' !~ '^https://(fcm.googleapis.com|updates.push.services.mozilla.com|web.push.apple.com)/' then raise exception 'Invalid subscription';end if;
 insert into private.tracking_push_subscriptions(workspace_id,user_id,endpoint,p256dh,auth) values(w,auth.uid(),p->>'endpoint',p->>'p256dh',p->>'auth') on conflict(workspace_id,user_id,endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,enabled=true;
end $$;
create or replace function public.tracking_oauth_consume(h text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.tracking_oauth_states;begin
 if auth.role()<>'service_role' then raise exception 'Internal service only';end if;
 update private.tracking_oauth_states set used_at=now() where state_hash=h and used_at is null and expires_at>now() returning * into r;
 if r.state_hash is null or not exists(select 1 from public.tracking_members m join public.profiles p on p.id=m.user_id where m.workspace_id=r.workspace_id and m.user_id=r.user_id and m.role in('owner','admin') and p.role not in('ceo','manager') and p.active and p.archived_at is null) then raise exception 'Invalid OAuth state';end if;
 return to_jsonb(r);
end $$;

create or replace function public.tracking_admin_report(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare action text:=coalesce(p->>'action','operations');f date:=coalesce((p->>'from')::date,current_date-6);t date:=coalesce((p->>'to')::date,current_date);cur text:=coalesce(p->>'currency','BRL');page integer:=greatest(1,coalesce((p->>'page')::integer,1));client uuid:=nullif(p->>'admin_client','')::uuid;demo boolean:=coalesce(p->>'admin_mode','real')='demo';sort text:=coalesce(p->>'admin_sort','newest');out jsonb;rows jsonb;total bigint;w uuid;
begin
 if not private.tracking_is_observer() then raise exception 'Acompanhamento indisponível';end if;
 if f>t or t-f>3660 or cur not in('BRL','USD','EUR','JPY','KWD') then raise exception 'Período ou moeda inválidos';end if;
 if action='catalog' then return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('role','viewer','can_view_buyers',true) order by c.client_name,c.name,c.id) from private.tracking_observer_catalog() c),'[]'));end if;
 if action='order' then
  w:=(p->>'workspace_id')::uuid;if w not in(select private.tracking_observer_workspaces()) then raise exception 'Operação indisponível';end if;
  return public.tracking_report(w,p||jsonb_build_object('action','order'));
 end if;
 if action='operations' then
  with scope as materialized(select * from private.tracking_observer_catalog() c where c.simulation_only=demo and(client is null or c.owner_id=client) and(coalesce(p->>'search','')='' or c.client_name ilike '%'||left(p->>'search',120)||'%' or c.name ilike '%'||left(p->>'search',120)||'%')),
  metrics as materialized(select c.*,public.tracking_report(c.id,p||jsonb_build_object('action','summary'))-'daily' s,
   (select count(*) from public.tracking_integrations i where i.workspace_id=c.id and i.connected and i.provider in('meta','google')) ad_accounts,
   coalesce((select jsonb_agg(distinct i.provider) from public.tracking_integrations i where i.workspace_id=c.id and i.connected),'[]') platforms,
   (select count(*) from public.tracking_orders o where o.workspace_id=c.id and o.currency=cur and o.approved_at>=(f::timestamp at time zone c.timezone) and o.approved_at<((t+1)::timestamp at time zone c.timezone)) approved_orders
   from scope c), decorated as(select m.*,case when (s->>'estimated_minor')::numeric is not null and (s->>'gross_minor')::numeric-(s->>'refund_minor')::numeric-(s->>'estimated_minor')::numeric>0 then round(100*(s->>'estimated_minor')::numeric/((s->>'gross_minor')::numeric-(s->>'refund_minor')::numeric-(s->>'estimated_minor')::numeric),2) end roi,case when(s->>'spend_minor')::numeric>0 then round((s->>'attributed_minor')::numeric/(s->>'spend_minor')::numeric,2) end roas from metrics m)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(d) order by case when sort='revenue' then(d.s->>'gross_minor')::numeric else(d.s->>'spend_minor')::numeric end desc nulls last,d.client_name,d.id) from decorated d),'[]'),
   'summary',jsonb_build_object('operations',count(*),'clients',count(distinct owner_id),'gross_minor',coalesce(sum((s->>'gross_minor')::bigint),0),'spend_minor',sum((s->>'spend_minor')::bigint),'attributed_minor',coalesce(sum((s->>'attributed_minor')::bigint),0),'approved_orders',coalesce(sum(approved_orders),0),'spend_known',count(*) filter(where s->>'spend_minor' is not null))) into out from decorated;
  return out;
 elsif action='orders' then
  if sort not in('newest','oldest','amount_desc','amount_asc','client') then raise exception 'Ordenação inválida';end if;
  with scope as materialized(select * from private.tracking_observer_catalog() c where c.simulation_only=demo and(client is null or c.owner_id=client)),filtered as materialized(
   select o.id,o.workspace_id,o.external_id,o.provider,o.status,o.currency,o.amount_scale,o.gross_minor,o.payment_method,o.renewal,o.created_at,o.approved_at,a.channel,c.name buyer_name,sc.client_name,sc.name operation_name
   from public.tracking_orders o join scope sc on sc.id=o.workspace_id left join public.tracking_attributions a on a.order_id=o.id left join public.tracking_customers c on c.id=o.customer_id
   where o.created_at>=(f::timestamp at time zone sc.timezone) and o.created_at<((t+1)::timestamp at time zone sc.timezone) and o.currency=cur and(coalesce(p->>'status','')='' or o.status=p->>'status') and(coalesce(p->>'provider','')='' or o.provider=p->>'provider') and(coalesce(p->>'channel','')='' or a.channel=p->>'channel') and(coalesce(p->>'payment','')='' or o.payment_method=p->>'payment')
   and(coalesce(p->>'search','')='' or o.external_id ilike '%'||left(p->>'search',120)||'%' or c.name ilike '%'||left(p->>'search',120)||'%' or c.email ilike '%'||left(p->>'search',120)||'%' or c.phone ilike '%'||left(p->>'search',120)||'%' or exists(select 1 from public.tracking_order_items it where it.order_id=o.id and it.name ilike '%'||left(p->>'search',120)||'%'))),paged as(
   select * from filtered order by case when sort='client' then lower(client_name) end asc,case when sort='oldest' then created_at end asc,case when sort='amount_asc' then gross_minor end asc,case when sort='amount_desc' then gross_minor end desc,created_at desc,id limit 25 offset(page-1)*25)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from paged r),'[]'),'total',(select count(*) from filtered),'page',page,'size',25) into out;return out;
 elsif action='integrations' then
  with scope as materialized(select * from private.tracking_observer_catalog() c where c.simulation_only=demo and(client is null or c.owner_id=client)),connections as materialized(
   select i.id,i.workspace_id,i.provider,i.account_id,i.name,i.connected,i.last_sync_at,i.last_received_at,i.error_code,sc.client_name,sc.name operation_name,sc.owner_id from public.tracking_integrations i join scope sc on sc.id=i.workspace_id)
  select jsonb_build_object('platforms',coalesce((select jsonb_agg(to_jsonb(a)) from(select provider,count(distinct account_id) filter(where connected) accounts,count(*) filter(where connected) connections,count(distinct owner_id) filter(where connected) clients,count(*) filter(where connected and error_code is not null and error_code<>'sync_requested') attention,max(greatest(last_sync_at,last_received_at)) last_update from connections group by provider)a),'[]'),'rows',coalesce((select jsonb_agg(to_jsonb(i) order by i.client_name,i.provider,i.account_id) from connections i),'[]')) into out;return out;
 end if;
 raise exception 'Relatório administrativo inválido';
end $$;
revoke all on function public.tracking_admin_report(jsonb) from public,anon;
grant execute on function public.tracking_admin_report(jsonb) to authenticated;

-- Restricted availability, with the final customer workflow and no demo tools.
delete from private.tracking_pilot_allowlist where user_id not in (
 select id from auth.users where lower(email) in ('ogabrielmrossi@gmail.com','gabrielmelo@gmail.com')
);
insert into private.tracking_pilot_allowlist(user_id,enabled)
 select id,true from auth.users where lower(email) in ('ogabrielmrossi@gmail.com','gabrielmelo@gmail.com') and email_confirmed_at is not null
 on conflict(user_id) do update set enabled=true;
create or replace function private.tracking_account_enabled(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join private.tracking_pilot_allowlist a on a.user_id=p.id join auth.users usr on usr.id=p.id where p.id=u and p.active and p.archived_at is null and a.enabled and usr.email_confirmed_at is not null and lower(usr.email) in('ogabrielmrossi@gmail.com','gabrielmelo@gmail.com'));
$$;

-- The unique key protects concurrent first login requests too.
alter table public.tracking_workspaces add constraint tracking_no_demonstrations check(not simulation_only);
create unique index tracking_one_operation_per_account on public.tracking_workspaces(owner_id);
create or replace function public.tracking_create_workspace(p_name text,p_currency text default 'BRL',p_timezone text default 'America/Sao_Paulo') returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if not private.tracking_session_valid() then raise exception 'Unauthorized';end if;
 if private.tracking_is_observer() then raise exception 'Acompanhamento somente leitura';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,872391));
 select id into w from public.tracking_workspaces where owner_id=auth.uid();
 if w is not null then return w;end if;
 if not exists(select 1 from pg_timezone_names where name=p_timezone) or p_currency not in('BRL','USD','EUR','JPY','KWD') or length(trim(p_name)) not between 1 and 120 then raise exception 'Configuração inválida';end if;
 insert into public.tracking_workspaces(owner_id,name,currency,timezone) values(auth.uid(),trim(p_name),p_currency,p_timezone) returning id into w;
 insert into public.tracking_members(workspace_id,user_id,role,can_view_buyers) values(w,auth.uid(),'owner',true);
 insert into public.tracking_notification_preferences(workspace_id,user_id) values(w,auth.uid());
 return w;
end $$;
create or replace function private.tracking_connection_mode() returns trigger language plpgsql set search_path='' as $$
begin
 if new.mode='simulated' or exists(select 1 from public.tracking_workspaces where id=new.workspace_id and simulation_only) then raise exception 'Conexão indisponível';end if;
 return new;
end $$;
revoke execute on function public.tracking_demo_workspace(),public.tracking_delete_workspace(uuid),public.tracking_set_member(uuid,uuid,text,boolean),public.tracking_remove_member(uuid,uuid) from public,anon,authenticated;

-- Provision the single operation for enabled customers, never for observers.
do $$declare p record;w uuid;begin
 for p in select id,name from public.profiles where role='client' and private.tracking_account_enabled(id) loop
  select id into w from public.tracking_workspaces where owner_id=p.id;
  if w is null then
   insert into public.tracking_workspaces(owner_id,name) values(p.id,p.name) returning id into w;
   insert into public.tracking_members(workspace_id,user_id,role,can_view_buyers) values(w,p.id,'owner',true);
   insert into public.tracking_notification_preferences(workspace_id,user_id) values(w,p.id);
  end if;
 end loop;
end $$;

-- Administrative reports always use the customer operations.
create or replace function public.tracking_admin_report(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare action text:=coalesce(p->>'action','operations');f date:=coalesce((p->>'from')::date,current_date-6);t date:=coalesce((p->>'to')::date,current_date);cur text:=coalesce(p->>'currency','BRL');page integer:=greatest(1,coalesce((p->>'page')::integer,1));client uuid:=nullif(p->>'admin_client','')::uuid;demo boolean:=false;sort text:=coalesce(p->>'admin_sort','newest');out jsonb;rows jsonb;total bigint;w uuid;
begin
 if not private.tracking_is_observer() then raise exception 'Acompanhamento indisponível';end if;
 if f>t or t-f>3660 or cur not in('BRL','USD','EUR','JPY','KWD') then raise exception 'Período ou moeda inválidos';end if;
 if action='catalog' then return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('role','viewer','can_view_buyers',true) order by c.client_name,c.name,c.id) from private.tracking_observer_catalog() c),'[]'));end if;
 if action='order' then
  w:=(p->>'workspace_id')::uuid;if w not in(select private.tracking_observer_workspaces()) then raise exception 'Operação indisponível';end if;
  return public.tracking_report(w,p||jsonb_build_object('action','order'));
 end if;
 if action='operations' then
  with scope as materialized(select * from private.tracking_observer_catalog() c where c.simulation_only=demo and(client is null or c.owner_id=client) and(coalesce(p->>'search','')='' or c.client_name ilike '%'||left(p->>'search',120)||'%' or c.name ilike '%'||left(p->>'search',120)||'%')),
  metrics as materialized(select c.*,public.tracking_report(c.id,p||jsonb_build_object('action','summary'))-'daily' s,
   (select count(*) from public.tracking_integrations i where i.workspace_id=c.id and i.connected and i.provider in('meta','google')) ad_accounts,
   coalesce((select jsonb_agg(distinct i.provider) from public.tracking_integrations i where i.workspace_id=c.id and i.connected),'[]') platforms,
   (select count(*) from public.tracking_orders o where o.workspace_id=c.id and o.currency=cur and o.approved_at>=(f::timestamp at time zone c.timezone) and o.approved_at<((t+1)::timestamp at time zone c.timezone)) approved_orders
   from scope c), decorated as(select m.*,case when (s->>'estimated_minor')::numeric is not null and (s->>'gross_minor')::numeric-(s->>'refund_minor')::numeric-(s->>'estimated_minor')::numeric>0 then round(100*(s->>'estimated_minor')::numeric/((s->>'gross_minor')::numeric-(s->>'refund_minor')::numeric-(s->>'estimated_minor')::numeric),2) end roi,case when(s->>'spend_minor')::numeric>0 then round((s->>'attributed_minor')::numeric/(s->>'spend_minor')::numeric,2) end roas from metrics m)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(d) order by case when sort='revenue' then(d.s->>'gross_minor')::numeric else(d.s->>'spend_minor')::numeric end desc nulls last,d.client_name,d.id) from decorated d),'[]'),
   'summary',jsonb_build_object('operations',count(*),'clients',count(distinct owner_id),'gross_minor',coalesce(sum((s->>'gross_minor')::bigint),0),'spend_minor',sum((s->>'spend_minor')::bigint),'attributed_minor',coalesce(sum((s->>'attributed_minor')::bigint),0),'approved_orders',coalesce(sum(approved_orders),0),'spend_known',count(*) filter(where s->>'spend_minor' is not null))) into out from decorated;
  return out;
 elsif action='orders' then
  if sort not in('newest','oldest','amount_desc','amount_asc','client') then raise exception 'Ordenação inválida';end if;
  with scope as materialized(select * from private.tracking_observer_catalog() c where c.simulation_only=demo and(client is null or c.owner_id=client)),filtered as materialized(
   select o.id,o.workspace_id,o.external_id,o.provider,o.status,o.currency,o.amount_scale,o.gross_minor,o.payment_method,o.renewal,o.created_at,o.approved_at,a.channel,c.name buyer_name,sc.client_name,sc.name operation_name
   from public.tracking_orders o join scope sc on sc.id=o.workspace_id left join public.tracking_attributions a on a.order_id=o.id left join public.tracking_customers c on c.id=o.customer_id
   where o.created_at>=(f::timestamp at time zone sc.timezone) and o.created_at<((t+1)::timestamp at time zone sc.timezone) and o.currency=cur and(coalesce(p->>'status','')='' or o.status=p->>'status') and(coalesce(p->>'provider','')='' or o.provider=p->>'provider') and(coalesce(p->>'channel','')='' or a.channel=p->>'channel') and(coalesce(p->>'payment','')='' or o.payment_method=p->>'payment')
   and(coalesce(p->>'search','')='' or o.external_id ilike '%'||left(p->>'search',120)||'%' or c.name ilike '%'||left(p->>'search',120)||'%' or c.email ilike '%'||left(p->>'search',120)||'%' or c.phone ilike '%'||left(p->>'search',120)||'%' or exists(select 1 from public.tracking_order_items it where it.order_id=o.id and it.name ilike '%'||left(p->>'search',120)||'%'))),paged as(
   select * from filtered order by case when sort='client' then lower(client_name) end asc,case when sort='oldest' then created_at end asc,case when sort='amount_asc' then gross_minor end asc,case when sort='amount_desc' then gross_minor end desc,created_at desc,id limit 25 offset(page-1)*25)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from paged r),'[]'),'total',(select count(*) from filtered),'page',page,'size',25) into out;return out;
 elsif action='integrations' then
  with scope as materialized(select * from private.tracking_observer_catalog() c where c.simulation_only=demo and(client is null or c.owner_id=client)),connections as materialized(
   select i.id,i.workspace_id,i.provider,i.account_id,i.name,i.connected,i.last_sync_at,i.last_received_at,i.error_code,sc.client_name,sc.name operation_name,sc.owner_id from public.tracking_integrations i join scope sc on sc.id=i.workspace_id)
  select jsonb_build_object('platforms',coalesce((select jsonb_agg(to_jsonb(a)) from(select provider,count(distinct account_id) filter(where connected) accounts,count(*) filter(where connected) connections,count(distinct owner_id) filter(where connected) clients,count(*) filter(where connected and error_code is not null and error_code<>'sync_requested') attention,max(greatest(last_sync_at,last_received_at)) last_update from connections group by provider)a),'[]'),'rows',coalesce((select jsonb_agg(to_jsonb(i) order by i.client_name,i.provider,i.account_id) from connections i),'[]')) into out;return out;
 end if;
 raise exception 'Relatório administrativo inválido';
end $$;
revoke all on function public.tracking_admin_report(jsonb) from public,anon;
grant execute on function public.tracking_admin_report(jsonb) to authenticated;
