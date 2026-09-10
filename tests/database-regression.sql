-- All fixtures, queued HTTP calls and changes are rolled back.
begin;
create temporary table regression_ids(key text primary key,id uuid);
create temporary table regression_results(test text,passed boolean);
grant all on regression_ids,regression_results to authenticated;
insert into regression_ids select 'ceo',id from public.profiles where role='ceo' and active limit 1;
insert into regression_ids select 'manager',id from public.profiles where role='manager' and active limit 1;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from regression_ids where key='ceo'),'role','authenticated')::text,true);
set local role authenticated;
with c as (insert into public.clients(name,email,status,phone) values('Regression rollback 369','regression-369@example.invalid','Ativo','5500000000000') returning id) insert into regression_ids select 'client',id from c;
with c as (insert into public.clients(name,email,status,phone) values('Regression rollback other','regression-other@example.invalid','Ativo','5500000000001') returning id) insert into regression_ids select 'other-client',id from c;
with d as (insert into public.demands(title,client_id,created_by) values('Teste 369',(select id from regression_ids where key='client'),auth.uid()) returning id) insert into regression_ids select 'd1',id from d;
with d as (insert into public.demands(title,client_id,created_by) values('Teste 369',(select id from regression_ids where key='client'),auth.uid()) returning id) insert into regression_ids select 'd2',id from d;
with d as (insert into public.demands(title,client_id,created_by) values('Teste 369',(select id from regression_ids where key='client'),auth.uid()) returning id) insert into regression_ids select 'd3',id from d;
insert into regression_results select 'duplicate titles numbered',array_agg(title order by title)=array['Teste 369','Teste 369 (2)','Teste 369 (3)'] from public.demands where client_id=(select id from regression_ids where key='client');
with d as (insert into public.demands(title,client_id,created_by) values('Teste 369',(select id from regression_ids where key='other-client'),auth.uid()) returning id,title) insert into regression_results select 'other client retains original title',title='Teste 369' from d;
with s as (insert into public.sales(client_id,demand_id,service,value,status,sale_date) values((select id from regression_ids where key='client'),(select id from regression_ids where key='d1'),'Regression',369,'Pendente',current_date) returning id) insert into regression_ids select 'sale',id from s;
insert into regression_results select 'sale insert persists demand',demand_id=(select id from regression_ids where key='d1') from public.sales where id=(select id from regression_ids where key='sale');
update public.sales set demand_id=(select id from regression_ids where key='d2') where id=(select id from regression_ids where key='sale');
insert into regression_results select 'sale edit persists demand',demand_id=(select id from regression_ids where key='d2') from public.sales where id=(select id from regression_ids where key='sale');
do $$ begin
 begin
 update public.sales set client_id=(select id from regression_ids where key='other-client') where id=(select id from regression_ids where key='sale');
 insert into regression_results values('cross-client demand rejected',false);
 exception when raise_exception then insert into regression_results values('cross-client demand rejected',true);end;
end $$;
insert into regression_ids values('notification',public.create_notification(null,'admin','!','var(--amberbg)','Regression','Rollback only',null,'general'));
select public.mark_notifications_read(array[(select id from regression_ids where key='notification')]);
insert into regression_results select 'reader sees read',exists(select 1 from public.get_my_notifications() n where n->>'id'=(select id::text from regression_ids where key='notification') and (n->>'read')::boolean);
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from regression_ids where key='manager'),'role','authenticated')::text,true);
set local role authenticated;
insert into regression_results select 'other staff still unread',exists(select 1 from public.get_my_notifications() n where n->>'id'=(select id::text from regression_ids where key='notification') and not (n->>'read')::boolean);
do $$ begin
 begin
 insert into public.notification_reads(user_id,notification_id) values((select id from regression_ids where key='ceo'),(select id from regression_ids where key='notification'));
 insert into regression_results values('cannot write another readers receipt',false);
 exception when insufficient_privilege then insert into regression_results values('cannot write another readers receipt',true);end;
end $$;
reset role;
insert into regression_results select 'dispatcher rejects invalid token',not public.validate_push_dispatch_token('not-a-token');
select jsonb_agg(to_jsonb(r)) as regression_results from regression_results r;
rollback;
