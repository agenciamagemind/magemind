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
