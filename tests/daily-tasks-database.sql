-- Run as BEGIN; migration; this file; ROLLBACK; for a safe access and state check.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('c1000000-0000-4000-8000-000000000001','task-ceo-qa@example.invalid','{"source":"internal","role":"manager"}','{"name":"Task CEO QA"}'),
('c1000000-0000-4000-8000-000000000002','task-manager-qa@example.invalid','{"source":"internal","role":"manager"}','{"name":"Task Manager QA"}'),
('c1000000-0000-4000-8000-000000000003','task-editor-qa@example.invalid','{"source":"internal","role":"editor"}','{"name":"Task Editor QA"}');
update public.profiles set role='ceo' where id='c1000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
insert into public.daily_tasks(id,title,notes,due_date,priority) values
('c2000000-0000-4000-8000-000000000001','Preparar campanhas','Três conjuntos novos','2026-09-25','Alta');
do $$begin
 if (select owner_id from public.daily_tasks where id='c2000000-0000-4000-8000-000000000001') <> (select auth.uid()) then raise exception 'Task owner mismatch'; end if;
end;$$;
update public.daily_tasks set completed_at=now() where id='c2000000-0000-4000-8000-000000000001';
do $$begin
 if not exists(select 1 from public.daily_tasks where id='c2000000-0000-4000-8000-000000000001' and completed_at is not null) then raise exception 'Completion missing'; end if;
end;$$;
update public.daily_tasks set completed_at=null where id='c2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
do $$begin
 if exists(select 1 from public.daily_tasks where id='c2000000-0000-4000-8000-000000000001') then raise exception 'Manager saw CEO task'; end if;
 update public.daily_tasks set title='Wrong owner' where id='c2000000-0000-4000-8000-000000000001';
 if found then raise exception 'Manager changed CEO task'; end if;
end;$$;
insert into public.daily_tasks(id,title) values('c2000000-0000-4000-8000-000000000002','Revisar posts');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
do $$begin
 if exists(select 1 from public.daily_tasks) then raise exception 'Editor saw staff task'; end if;
 begin
  insert into public.daily_tasks(title) values('Denied');
  raise exception 'Editor created task';
 exception when check_violation then raise; when insufficient_privilege then null;
 end;
end;$$;
reset role;
select 'PASS: owner isolation, CEO/manager create, editor denial, completion and reopening' as result;
