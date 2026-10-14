-- Order status notifications use the existing APP push enrollment.
alter table public.tracking_notification_preferences
 add column pending boolean not null default true,
 add column refusals boolean not null default true,
 add column cancellations boolean not null default true,
 add column chargebacks boolean not null default true,
 add column disputes boolean not null default true,
 alter column sales set default true,
 alter column renewals set default true,
 alter column refunds set default true,
 alter column failures set default true;
-- The pilot owner explicitly requested all order notifications.
update public.tracking_notification_preferences p
 set sales=true,renewals=true,refunds=true,failures=true
 from public.tracking_workspaces w
 where w.id=p.workspace_id and w.owner_id=p.user_id
 and private.tracking_account_enabled(w.owner_id);

alter table public.tracking_deliveries
 add column created_at timestamptz not null default now(),
 add column order_snapshot jsonb not null default '{}';

create function private.tracking_queue_order_notification(oid uuid,kind text,key text,send_push boolean default true)
 returns void language plpgsql security definer set search_path='' as $$
declare o public.tracking_orders;pref public.tracking_notification_preferences;snapshot jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Internal service only';end if;
 select * into strict o from public.tracking_orders where id=oid;
 if not exists(select 1 from public.tracking_workspaces w where w.id=o.workspace_id and private.tracking_account_enabled(w.owner_id)) then return;end if;
 if kind not in('pending','sale','renewal','refused','cancelled','refund','chargeback','disputed') then raise exception 'Invalid notification category';end if;
 snapshot:=jsonb_build_object('status',o.status,'gross_minor',o.gross_minor,'refund_minor',o.refund_minor,'currency',o.currency,'amount_scale',o.amount_scale,'payment_method',o.payment_method);
 for pref in
  select p.* from public.tracking_notification_preferences p join public.tracking_members m using(workspace_id,user_id)
  where p.workspace_id=o.workspace_id and private.tracking_account_enabled(p.user_id) and
   case kind when 'pending' then p.pending when 'sale' then p.sales when 'renewal' then p.renewals when 'refused' then p.refusals when 'cancelled' then p.cancellations when 'refund' then p.refunds when 'chargeback' then p.chargebacks when 'disputed' then p.disputes else false end
 loop
  insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key,order_snapshot)
   values(o.workspace_id,o.id,pref.user_id,'in_app',kind,key||':in_app:'||pref.user_id,snapshot) on conflict do nothing;
  if send_push and exists(
   select 1 from public.push_subscriptions s join public.notification_preferences p on p.user_id=s.user_id
   where s.user_id=pref.user_id and s.enabled and p.push_enabled and p.sales
  ) then
   insert into public.tracking_deliveries(workspace_id,order_id,user_id,channel,category,event_key,order_snapshot)
    values(o.workspace_id,o.id,pref.user_id,'push',kind,key||':push:'||pref.user_id,snapshot) on conflict do nothing;
  end if;
 end loop;
end $$;
revoke all on function private.tracking_queue_order_notification(uuid,text,text,boolean) from public,anon,authenticated;

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
 if not coalesce((e->>'historical')::boolean,false) then
  if first_paid then
   perform private.tracking_queue_order_notification(o.id,case when o.renewal then 'renewal' else 'sale' end,o.id::text||':approved');
   if exists(select 1 from private.tracking_conversion_destinations d where d.workspace_id=intg.workspace_id and d.enabled and d.coordinated_emitter and d.consent and d.test_event_code is not null) then
    insert into public.tracking_deliveries(workspace_id,order_id,channel,category,event_key) values(intg.workspace_id,o.id,'capi','purchase','mm:'||o.id::text||':approved') on conflict do nothing;
   end if;
  elsif o.status in('pending','refused','cancelled','disputed') and (old.id is null or old.status is distinct from o.status) then
   perform private.tracking_queue_order_notification(o.id,o.status,rec.event_key||':status:'||o.status);
  end if;
  if o.refund_minor>old_refund or (o.status='chargeback' and old.status is distinct from o.status) then
   perform private.tracking_queue_order_notification(o.id,case when o.status='chargeback' then 'chargeback' else 'refund' end,rec.event_key||':refund:'||o.refund_minor::text);
  end if;
 end if;
 update public.tracking_order_events set order_id=o.id,processing='processed' where id=r;
 update private.tracking_jobs set state='done',locked_until=null where receipt_id=r;
 return o.id;
end $function$
;
CREATE OR REPLACE FUNCTION public.tracking_report(w uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from(
   select d.id,d.order_id,d.integration_id,d.category,d.state,p.hide_amount,
    coalesce((d.order_snapshot->>'gross_minor')::bigint,o.gross_minor) gross_minor,
    coalesce((d.order_snapshot->>'refund_minor')::bigint,o.refund_minor) refund_minor,
    coalesce(d.order_snapshot->>'currency',o.currency) currency,
    coalesce((d.order_snapshot->>'amount_scale')::integer,o.amount_scale) amount_scale,
    coalesce(d.order_snapshot->>'status',o.status) order_status,
    d.created_at,d.delivered_at,d.next_attempt_at
   from public.tracking_deliveries d
   left join public.tracking_orders o on o.id=d.order_id
   left join public.tracking_notification_preferences p on p.workspace_id=d.workspace_id and p.user_id=d.user_id
   where d.workspace_id=w and d.user_id=auth.uid() and d.channel='in_app'
   order by d.created_at desc,d.id desc limit 50
  )r),'[]');
 end if;
 raise exception 'Unknown report';
end $function$
;
CREATE OR REPLACE FUNCTION public.tracking_internal_outbox()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare ids uuid[]; begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 select coalesce(array_agg(id),'{}') into ids from (
  select id from public.tracking_deliveries where (state in ('queued','retry') or (state='running' and locked_until<now())) and next_attempt_at<=now() and attempts<8 order by next_attempt_at limit 50 for update skip locked
 ) claimed;
 update public.tracking_deliveries set state='running',locked_until=now()+interval '2 minutes' where id=any(ids);
 return coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('order',to_jsonb(o),'customer',to_jsonb(c),'preference',to_jsonb(p),'destination',to_jsonb(dest),'subscriptions',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('source','app')) from public.push_subscriptions s join public.notification_preferences np on np.user_id=s.user_id where s.user_id=d.user_id and s.enabled and np.push_enabled and np.sales and exists(select 1 from public.tracking_members m where m.workspace_id=d.workspace_id and m.user_id=s.user_id)),'[]')))
 from (select * from public.tracking_deliveries where id=any(ids)) d
 left join public.tracking_orders o on o.id=d.order_id left join public.tracking_customers c on c.id=o.customer_id left join public.tracking_notification_preferences p on p.workspace_id=d.workspace_id and p.user_id=d.user_id left join private.tracking_conversion_destinations dest on dest.workspace_id=d.workspace_id),'[]');
end $function$
;
CREATE OR REPLACE FUNCTION public.tracking_internal_expire_push(i uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
 if (select auth.role())<>'service_role' then raise exception 'Internal service only'; end if;
 update public.push_subscriptions set enabled=false where id=i;
end $function$
;
revoke all on function public.tracking_process_receipt(uuid),public.tracking_internal_outbox(),public.tracking_internal_expire_push(uuid) from public,anon,authenticated;
grant execute on function public.tracking_process_receipt(uuid),public.tracking_internal_outbox(),public.tracking_internal_expire_push(uuid) to service_role;
revoke all on function public.tracking_report(uuid,jsonb) from public,anon;
grant execute on function public.tracking_report(uuid,jsonb) to authenticated;
-- Restore recent in-app history without sending a burst of old pushes.
do $$declare restored_order record;prior_role text:=current_setting('request.jwt.claim.role',true);begin
 perform set_config('request.jwt.claim.role','service_role',true);
 for restored_order in select o.* from public.tracking_orders o join public.tracking_workspaces w on w.id=o.workspace_id
  where private.tracking_account_enabled(w.owner_id) and o.received_at>now()-interval '24 hours'
  and not exists(select 1 from public.tracking_deliveries d where d.order_id=o.id and d.channel='in_app')
 loop
  perform private.tracking_queue_order_notification(restored_order.id,case restored_order.status when 'paid' then case when restored_order.renewal then 'renewal' else 'sale' end when 'refunded' then 'refund' else restored_order.status end,'restored:'||restored_order.id||':'||restored_order.status,false);
 end loop;
 perform set_config('request.jwt.claim.role',coalesce(prior_role,''),true);
end $$;
