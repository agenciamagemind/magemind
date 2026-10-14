-- Existing account eligibility and the one-operation rule stay unchanged.
CREATE OR REPLACE FUNCTION public.tracking_order_costs(w uuid, oid uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  and(r.category<>'fee' or((o.recipient_minor is null or o.money_components->>'manual_fees'='true') and o.gateway_fee_minor is null))
  order by name,category,r.valid_from desc,r.effective_from desc nulls last,r.created_at desc
 )r;
 return base+extra;
end $function$
;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.tracking_integrations'::regclass and contype='c' and pg_get_constraintdef(oid) like '%provider%' loop execute format('alter table public.tracking_integrations drop constraint %I',c.conname);end loop;
end $$;
alter table public.tracking_integrations add constraint tracking_provider_supported check(provider in('meta','google','kiwify','hotmart','custom','cartpanda','perfectpay'));
alter table public.tracking_integrations add column connection_kind text not null default 'api' check(connection_kind in('api','oauth','webhook'));
create unique index tracking_checkout_per_provider on public.tracking_integrations(workspace_id,provider) where provider in('kiwify','hotmart','cartpanda','perfectpay');

create table private.tracking_platform_apps(provider text primary key check(provider='meta'),app_id text not null,config_id text,api_version text not null,secret_cipher text not null,allow_management boolean not null default true,updated_at timestamptz not null default now(),updated_by uuid references auth.users on delete set null);
alter table private.tracking_platform_apps enable row level security;
create or replace function private.tracking_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select private.tracking_session_valid() and exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role='ceo' and lower(u.email)='ogabrielmrossi@gmail.com');
$$;
revoke all on function private.tracking_platform_admin() from public,anon,authenticated;
create function public.tracking_platform_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a private.tracking_platform_apps;begin
 if not private.tracking_session_valid() then raise exception 'Unauthorized';end if;
 select * into a from private.tracking_platform_apps where provider='meta';
 return jsonb_build_object('configured',a.app_id is not null,'can_configure',private.tracking_platform_admin(),'app_id',case when private.tracking_platform_admin() then a.app_id end,'config_id',case when private.tracking_platform_admin() then a.config_id end,'api_version',coalesce(a.api_version,'v25.0'),'allow_management',coalesce(a.allow_management,true));
end $$;
create function public.tracking_platform_save(p jsonb,c text) returns void language plpgsql security definer set search_path='' as $$
declare old private.tracking_platform_apps;begin
 if not private.tracking_platform_admin() then raise exception 'Configuração exclusiva do administrador master';end if;
 if p->>'app_id' !~ '^[0-9]{5,30}$' or coalesce(p->>'api_version','v25.0') !~ '^v[0-9]{1,3}\.[0-9]{1,2}$' or (nullif(p->>'config_id','') is not null and p->>'config_id' !~ '^[0-9]{5,30}$') then raise exception 'Configuração inválida';end if;
 select * into old from private.tracking_platform_apps where provider='meta' for update;
 if nullif(c,'') is null and(old.app_id is null or old.app_id<>p->>'app_id') then raise exception 'Informe o segredo do aplicativo';end if;
 insert into private.tracking_platform_apps(provider,app_id,config_id,api_version,secret_cipher,allow_management,updated_by)
 values('meta',p->>'app_id',nullif(p->>'config_id',''),coalesce(p->>'api_version','v25.0'),coalesce(nullif(c,''),old.secret_cipher),coalesce((p->>'allow_management')::boolean,true),auth.uid())
 on conflict(provider) do update set app_id=excluded.app_id,config_id=excluded.config_id,api_version=excluded.api_version,secret_cipher=excluded.secret_cipher,allow_management=excluded.allow_management,updated_by=excluded.updated_by,updated_at=now();
end $$;
create function public.tracking_platform_internal() returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.role()<>'service_role' then raise exception 'Internal service only';end if;
 return(select to_jsonb(a) from private.tracking_platform_apps a where provider='meta');
end $$;

alter table private.tracking_oauth_states add column session_id uuid references auth.sessions on delete cascade;
create function public.tracking_oauth_begin(h text,w uuid,u uuid,p text,s uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if auth.role()<>'service_role' or p<>'meta' or not private.tracking_account_enabled(u) or not exists(select 1 from auth.sessions where id=s and user_id=u) or not exists(select 1 from public.tracking_members m join public.profiles pr on pr.id=m.user_id where m.workspace_id=w and m.user_id=u and m.role='owner' and pr.role not in('ceo','manager')) then raise exception 'Forbidden';end if;
 insert into private.tracking_oauth_states(state_hash,workspace_id,user_id,provider,expires_at,session_id) values(h,w,u,p,now()+interval '10 minutes',s);
end $$;
create or replace function public.tracking_oauth_consume(h text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.tracking_oauth_states;begin
 if auth.role()<>'service_role' then raise exception 'Internal service only';end if;
 update private.tracking_oauth_states set used_at=now() where state_hash=h and used_at is null and expires_at>now() returning * into r;
 if r.state_hash is null or not private.tracking_account_enabled(r.user_id) or not exists(select 1 from auth.sessions where id=r.session_id and user_id=r.user_id) or not exists(select 1 from public.tracking_members m join public.profiles p on p.id=m.user_id where m.workspace_id=r.workspace_id and m.user_id=r.user_id and m.role='owner' and p.role not in('ceo','manager') and p.active and p.archived_at is null) then raise exception 'Invalid OAuth state';end if;
 return to_jsonb(r);
end $$;
create table private.tracking_oauth_grants(id uuid primary key default gen_random_uuid(),state_hash text not null unique references private.tracking_oauth_states on delete cascade,workspace_id uuid not null references public.tracking_workspaces on delete cascade,user_id uuid not null references auth.users on delete cascade,session_id uuid not null references auth.sessions on delete cascade,provider text not null check(provider='meta'),cipher text not null,expires_at timestamptz not null default now()+interval '30 minutes',used_at timestamptz);
create index tracking_grants_workspace on private.tracking_oauth_grants(workspace_id);
create index tracking_grants_user on private.tracking_oauth_grants(user_id);
create index tracking_grants_session on private.tracking_oauth_grants(session_id);
alter table private.tracking_oauth_grants enable row level security;
create function public.tracking_oauth_finish(h text,c text) returns uuid language plpgsql security definer set search_path='' as $$declare r private.tracking_oauth_states;g uuid;begin
 if auth.role()<>'service_role' then raise exception 'Internal service only';end if;
 select * into strict r from private.tracking_oauth_states where state_hash=h and used_at is not null and expires_at>now();
 if not private.tracking_account_enabled(r.user_id) or not exists(select 1 from auth.sessions where id=r.session_id and user_id=r.user_id) then raise exception 'Forbidden';end if;
 insert into private.tracking_oauth_grants(state_hash,workspace_id,user_id,session_id,provider,cipher) values(h,r.workspace_id,r.user_id,r.session_id,r.provider,c) returning id into g;return g;
end $$;
create function public.tracking_oauth_grant(g uuid,u uuid,s uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.tracking_oauth_grants;begin
 if auth.role()<>'service_role' or not private.tracking_account_enabled(u) then raise exception 'Forbidden';end if;
 select * into strict r from private.tracking_oauth_grants where id=g and user_id=u and session_id=s and expires_at>now() and used_at is null;
 if not exists(select 1 from auth.sessions where id=s and user_id=u) then raise exception 'Forbidden';end if;
 return to_jsonb(r);
end $$;
create function public.tracking_install_oauth_accounts(g uuid,u uuid,s uuid,accounts jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare grant_row jsonb;a jsonb;i uuid;n integer:=0;begin
 grant_row:=public.tracking_oauth_grant(g,u,s);
 perform 1 from private.tracking_oauth_grants where id=g and used_at is null for update;
 if not found or jsonb_array_length(accounts) not between 1 and 20 then raise exception 'Selecione entre uma e vinte contas';end if;
 for a in select * from jsonb_array_elements(accounts) loop
  if a->>'account_id' !~ '^act_[0-9]+$' or not exists(select 1 from pg_timezone_names where name=a->>'timezone') or a->>'currency' not in('BRL','USD','EUR','JPY','KWD') then raise exception 'Conta inválida';end if;
  insert into public.tracking_integrations(workspace_id,provider,account_id,name,mode,connection_kind,error_code) values((grant_row->>'workspace_id')::uuid,'meta',a->>'account_id',left(a->>'name',200),'approved_test','oauth','sync_requested')
  on conflict(workspace_id,provider,account_id) do update set name=excluded.name,mode=excluded.mode,connection_kind='oauth',connected=true,error_code='sync_requested',retry_after_at=null,error_count=0 returning id into i;
  insert into private.tracking_credentials(integration_id,cipher) values(i,grant_row->>'cipher') on conflict(integration_id) do update set cipher=excluded.cipher,token_hash=null,revoked_at=null,revision=tracking_credentials.revision+1;
  insert into public.tracking_ad_accounts(workspace_id,provider,account_id,name,currency,timezone,selected) values((grant_row->>'workspace_id')::uuid,'meta',a->>'account_id',a->>'name',a->>'currency',a->>'timezone',true)
  on conflict(workspace_id,provider,account_id) do update set name=excluded.name,currency=excluded.currency,timezone=excluded.timezone,selected=true;
  n:=n+1;
 end loop;
 update private.tracking_oauth_grants set used_at=now(),cipher='' where id=g;return n;
end $$;

create function public.tracking_install_webhook(w uuid,u uuid,s uuid,p text,n text,c text) returns uuid language plpgsql security definer set search_path='' as $$declare i uuid;begin
 if auth.role()<>'service_role' or not private.tracking_account_enabled(u) or not exists(select 1 from auth.sessions where id=s and user_id=u) or not exists(select 1 from public.tracking_workspaces ws join public.profiles pr on pr.id=ws.owner_id where ws.id=w and ws.owner_id=u and pr.role not in('ceo','manager')) then raise exception 'Forbidden';end if;
 if p not in('kiwify','hotmart','cartpanda','perfectpay','custom') or length(trim(n)) not between 1 and 120 or nullif(c,'') is null then raise exception 'Conexão inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||p,531971));
 select id into i from public.tracking_integrations where workspace_id=w and provider=p for update;
 if i is null then insert into public.tracking_integrations(workspace_id,provider,account_id,name,mode,connection_kind) values(w,p,'webhook:'||u::text,trim(n),'approved_test','webhook') returning id into i;
 else update public.tracking_integrations set name=trim(n),connected=true,mode='approved_test',connection_kind='webhook',error_code=null,retry_after_at=null,error_count=0 where id=i;end if;
 insert into private.tracking_credentials(integration_id,cipher) values(i,c) on conflict(integration_id) do update set cipher=excluded.cipher,token_hash=null,revoked_at=null,revision=tracking_credentials.revision+1;
 return i;
end $$;
create table private.tracking_webhook_clocks(integration_id uuid references public.tracking_integrations on delete cascade,payload_hash text,first_received_at timestamptz not null default now(),primary key(integration_id,payload_hash));
alter table private.tracking_webhook_clocks enable row level security;
create function public.tracking_webhook_clock(i uuid,h text) returns timestamptz language plpgsql security definer set search_path='' as $$declare t timestamptz;begin
 if auth.role()<>'service_role' then raise exception 'Internal service only';end if;
 insert into private.tracking_webhook_clocks(integration_id,payload_hash) values(i,h) on conflict do nothing;
 select first_received_at into t from private.tracking_webhook_clocks where integration_id=i and payload_hash=h;return t;
end $$;

revoke all on private.tracking_platform_apps,private.tracking_oauth_grants,private.tracking_webhook_clocks from public,anon,authenticated;
grant all on private.tracking_platform_apps,private.tracking_oauth_grants,private.tracking_webhook_clocks to service_role;
revoke execute on function public.tracking_platform_status(),public.tracking_platform_save(jsonb,text) from public,anon;
grant execute on function public.tracking_platform_status(),public.tracking_platform_save(jsonb,text) to authenticated;
revoke execute on function public.tracking_platform_internal(),public.tracking_oauth_begin(text,uuid,uuid,text,uuid),public.tracking_oauth_finish(text,text),public.tracking_oauth_grant(uuid,uuid,uuid),public.tracking_install_oauth_accounts(uuid,uuid,uuid,jsonb),public.tracking_install_webhook(uuid,uuid,uuid,text,text,text),public.tracking_webhook_clock(uuid,text) from public,anon,authenticated;
grant execute on function public.tracking_platform_internal(),public.tracking_oauth_begin(text,uuid,uuid,text,uuid),public.tracking_oauth_finish(text,text),public.tracking_oauth_grant(uuid,uuid,uuid),public.tracking_install_oauth_accounts(uuid,uuid,uuid,jsonb),public.tracking_install_webhook(uuid,uuid,uuid,text,text,text),public.tracking_webhook_clock(uuid,text) to service_role;

create index tracking_oauth_states_session on private.tracking_oauth_states(session_id);
create index tracking_platform_apps_actor on private.tracking_platform_apps(updated_by);

CREATE OR REPLACE FUNCTION public.tracking_ingest(i uuid, e jsonb, h text, p_historical boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.tracking_integrations; r uuid; prior_hash text; begin
 if (select auth.role()) <> 'service_role' then raise exception 'Internal service only'; end if;
 select * into strict v from public.tracking_integrations where id=i and connected; if not private.tracking_account_enabled((select owner_id from public.tracking_workspaces where id=v.workspace_id)) then raise exception 'Pilot access revoked';end if;
 if e->>'schema_version'<>'1' or length(e->>'event_id') not between 1 and 200 or length(e->>'order_id') not between 1 and 200 or e->>'currency' not in ('BRL','USD','EUR','JPY','KWD')
 or e->>'status' not in ('pending','paid','refused','refunded','chargeback','disputed','cancelled') or coalesce(jsonb_typeof(e->'is_test'),'')<>'boolean' then raise exception 'Invalid normalized event'; end if;
 if v.mode<>'simulated' and (e->>'is_test')::boolean then raise exception 'Synthetic events are unavailable';end if;
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
 return r; end $function$
;

CREATE OR REPLACE FUNCTION public.tracking_save_cost(w uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid; mode text:=coalesce(p->>'calculation','legacy'); cat text:=p->>'category'; label text:=trim(p->>'name'); amount bigint:=(p->>'amount_minor')::bigint; rate integer:=(p->>'rate_bps')::integer; cur text:=p->>'currency'; product text:=nullif(p->>'product_id',''); prov text:=nullif(p->>'provider',''); tz text;
begin
 if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
 if label is null or length(label) not between 1 and 120 or cur is null or cur not in ('BRL','USD','EUR','JPY','KWD') or cat is null or cat not in ('product','tax','fee','expense') or amount<0 or amount>9007199254740991 or rate<0 or rate>10000 or length(product)>200 or prov not in ('custom','kiwify','hotmart','cartpanda','perfectpay') then raise exception 'Dados de custo inválidos'; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.tracking_process_receipt(r uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 update public.tracking_orders set is_test=(e->>'is_test')::boolean where id=o.id;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.tracking_select_products(w uuid, i uuid, ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
 if not private.tracking_access(w,'write') or coalesce(array_length(ids,1),0)>100 then raise exception 'Forbidden'; end if;
 update public.tracking_integrations set selected_products=ids where workspace_id=w and id=i and provider in ('kiwify','hotmart','custom','cartpanda','perfectpay');
 insert into public.tracking_audit(workspace_id,actor_id,action,entity_id) values(w,(select auth.uid()),'integration.products',i::text);
end $function$
;

CREATE OR REPLACE FUNCTION public.tracking_onboarding_status(w uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); saved public.tracking_onboarding; checkout boolean; ads boolean; costs boolean; journey boolean; orders boolean; ad_history boolean; cost_history boolean; events boolean; n integer; tasks jsonb;
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 select exists(select 1 from public.tracking_integrations where workspace_id=w and connected and provider in('custom','kiwify','hotmart','cartpanda','perfectpay')) into checkout;
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
end $function$
;

