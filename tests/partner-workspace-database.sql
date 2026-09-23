-- Run inside a transaction and roll back. No production accounts are changed.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('b1000000-0000-4000-8000-000000000001','workspace-qa@example.invalid','{"source":"internal","role":"partner"}','{"name":"Workspace QA"}');
insert into public.docs(id,name,visibility) values
('b2000000-0000-4000-8000-000000000001','QA client brief','internal'),
('b2000000-0000-4000-8000-000000000002','QA protected contract','restricted');
insert into public.plans(id,name,type,active,is_custom) values
('b3000000-0000-4000-8000-000000000001','QA public plan','Mensal',true,false),
('b3000000-0000-4000-8000-000000000002','QA custom plan','Mensal',true,true),
('b3000000-0000-4000-8000-000000000003','QA inactive plan','Mensal',false,false);
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$begin
 if not exists(select 1 from public.docs where id='b2000000-0000-4000-8000-000000000001') then raise exception 'Document access missing';end if;
 update public.docs set name='QA updated brief' where id='b2000000-0000-4000-8000-000000000001';
 if not exists(select 1 from public.docs where id='b2000000-0000-4000-8000-000000000001' and name='QA updated brief') then raise exception 'Document edit missing';end if;
 update public.docs set name='Forbidden edit' where id='b2000000-0000-4000-8000-000000000002';
 if found then raise exception 'Restricted document edit allowed';end if;
 delete from public.docs where id='b2000000-0000-4000-8000-000000000001';
 if found then raise exception 'Document delete allowed';end if;
 if (select count(*) from public.plans where id in ('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003'))<>1 then raise exception 'Catalog scope wrong';end if;
 update public.plans set price=1 where id='b3000000-0000-4000-8000-000000000001';
 if found then raise exception 'Catalog modification allowed';end if;
 if exists(select 1 from public.clients) then raise exception 'Private client records exposed';end if;
 if exists(select 1 from public.profiles where role in ('ceo','manager')) then raise exception 'Private higher-role profiles exposed';end if;
 if not exists(select 1 from public.demand_team_directory where role='ceo') then raise exception 'CEO missing from safe directory';end if;
end;$$;
reset role;
select 'PASS: operational documents, restricted edit protection, catalog read-only, client privacy, safe team hierarchy' as result;
