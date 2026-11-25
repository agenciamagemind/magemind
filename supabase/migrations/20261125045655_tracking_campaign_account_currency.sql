-- Opt in to native currencies so older app versions keep their reporting-currency contract.
create function public.tracking_ad_management(w uuid,f date,t date,cur text,native_amounts boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare out jsonb;
begin
 if not private.tracking_access(w) then raise exception 'Forbidden'; end if;
 with recursive entities as (
  select e.*,i.mode,i.connected,case when native_amounts then a.currency else cur end as account_currency from public.tracking_ad_entities e join public.tracking_integrations i using(workspace_id,provider,account_id) join public.tracking_ad_accounts a using(workspace_id,provider,account_id) where e.workspace_id=w and a.selected
 ), tree as (
  select provider,account_id,entity_id root,entity_id descendant,account_currency,0 depth from entities
  union all
  select tr.provider,tr.account_id,tr.root,e.entity_id,tr.account_currency,tr.depth+1 from tree tr join entities e on e.provider=tr.provider and e.account_id=tr.account_id and e.parent_id=tr.descendant where tr.depth<8
 ), metrics as (
  select tr.provider,tr.account_id,tr.root,sum(s.spend_minor) spend_minor,sum(s.impressions) impressions,sum(s.clicks) clicks,case when bool_or(s.network_purchases is null) then null else sum(s.network_purchases) end network_purchases
  from tree tr join public.tracking_ad_stats_daily s on s.workspace_id=w and s.provider=tr.provider and s.account_id=tr.account_id and s.entity_id=tr.descendant and s.date between f and t and s.currency=tr.account_currency and s.breakdown=''
  where not exists(select 1 from entities c where c.provider=tr.provider and c.account_id=tr.account_id and c.parent_id=tr.descendant)
  group by tr.provider,tr.account_id,tr.root
 ), purchases as (
  select tr.provider,tr.account_id,tr.root,count(distinct o.id) purchases from tree tr join public.tracking_attributions a on a.workspace_id=w and a.channel=tr.provider and a.account_id=tr.account_id and a.ad_id=tr.descendant
  join public.tracking_orders o on o.id=a.order_id join public.tracking_workspaces ww on ww.id=w where o.currency=cur and (o.approved_at at time zone ww.timezone)::date between f and t group by tr.provider,tr.account_id,tr.root
 )
 select coalesce(jsonb_agg(case when native_amounts then to_jsonb(r) else to_jsonb(r)-'account_currency' end),'[]') into out from (
  select e.*,not exists(select 1 from tree tr join entities parent on parent.provider=tr.provider and parent.account_id=tr.account_id and parent.entity_id=tr.root where tr.provider=e.provider and tr.account_id=e.account_id and tr.descendant=e.entity_id and parent.status='PAUSED') effective_active,
  m.spend_minor,m.impressions,m.clicks,m.network_purchases,coalesce(p.purchases,0) checkout_purchases
  from entities e left join metrics m on m.provider=e.provider and m.account_id=e.account_id and m.root=e.entity_id left join purchases p on p.provider=e.provider and p.account_id=e.account_id and p.root=e.entity_id order by e.provider,e.account_id,e.level,e.name
 )r;
 return jsonb_build_object('rows',out);
end $$;
revoke execute on function public.tracking_ad_management(uuid,date,date,text,boolean) from public,anon;
grant execute on function public.tracking_ad_management(uuid,date,date,text,boolean) to authenticated;

create or replace function public.tracking_ad_management(w uuid,f date,t date,cur text)
returns jsonb language sql security invoker set search_path='' as $$
 select public.tracking_ad_management(w,f,t,cur,false);
$$;
