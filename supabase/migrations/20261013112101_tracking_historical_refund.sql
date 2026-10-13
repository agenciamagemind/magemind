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