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
