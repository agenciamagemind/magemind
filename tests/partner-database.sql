-- Always executed after the migration inside BEGIN ... ROLLBACK.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('a1000000-0000-4000-8000-000000000001','partner-qa-admin@example.invalid','{"source":"internal","role":"manager"}','{"name":"QA Admin"}'),
('a1000000-0000-4000-8000-000000000002','partner-qa-one@example.invalid','{"source":"internal","role":"partner"}','{"name":"QA Partner One"}'),
('a1000000-0000-4000-8000-000000000003','partner-qa-two@example.invalid','{"source":"internal","role":"partner"}','{"name":"QA Partner Two"}'),
('a1000000-0000-4000-8000-000000000004','partner-qa-referral@example.invalid','{"source":"internal","role":"affiliate"}','{"name":"QA Referral"}'),
('a1000000-0000-4000-8000-000000000005','partner-qa-editor@example.invalid','{"source":"internal","role":"editor"}','{"name":"QA Editor"}');
update public.profiles set affiliate_status='approved',commission_rate=10 where id='a1000000-0000-4000-8000-000000000004';
insert into public.clients(id,name,email,phone,status,affiliate_id) values('a2000000-0000-4000-8000-000000000001','QA Private Client','private@example.invalid','11999999999','Ativo','a1000000-0000-4000-8000-000000000004');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare s jsonb; sid uuid; begin
 s:=public.save_sale_with_partners(null,jsonb_build_object('client_id','a2000000-0000-4000-8000-000000000001','service','QA Criativo','value',100,'status','Fechado','sale_date','2026-09-23'),'[{"partner_id":"a1000000-0000-4000-8000-000000000002","rate":50}]');
 sid:=(s->>'id')::uuid;perform set_config('qa.partner_sale_id',sid::text,true);
 if (select amount from public.partner_sale_shares where sale_id=sid)<>50 then raise exception 'QA: partner amount incorrect';end if;
 if (select commission_value from public.affiliate_commissions where sale_id=sid)<>10 then raise exception 'QA: referral amount incorrect';end if;
 if (public.get_partner_wallet('a1000000-0000-4000-8000-000000000002')->>'available')::numeric<>50 then raise exception 'QA: available incorrect';end if;
 begin
  perform public.save_sale_with_partners(sid,s,'[{"partner_id":"a1000000-0000-4000-8000-000000000002","rate":95}]');
  raise exception 'QA: over-allocation accepted';
 exception when others then if sqlerrm='QA: over-allocation accepted' then raise;end if;end;
 s:=public.save_sale_with_partners(null,jsonb_build_object('client_id','a2000000-0000-4000-8000-000000000001','service','QA Pending','value',100,'status','Pendente','sale_date','2026-09-23'),'[{"partner_id":"a1000000-0000-4000-8000-000000000002","rate":50},{"partner_id":"a1000000-0000-4000-8000-000000000003","rate":20}]');
 if (public.get_partner_wallet('a1000000-0000-4000-8000-000000000002')->>'pending')::numeric<>50 then raise exception 'QA: pending incorrect';end if;
end;$$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
do $$declare w jsonb;v numeric;begin
 if exists(select 1 from public.clients) then raise exception 'QA: client contacts exposed';end if;
 if exists(select 1 from public.sales) then raise exception 'QA: raw sales exposed';end if;
 if exists(select 1 from public.profiles where role in ('ceo','manager','client','affiliate')) then raise exception 'QA: protected profiles exposed';end if;
 if exists(select 1 from public.partner_sale_shares where partner_id<>auth.uid()) then raise exception 'QA: another wallet exposed';end if;
 if not exists(select 1 from public.demand_client_directory where id='a2000000-0000-4000-8000-000000000001') then raise exception 'QA: safe demand directory missing';end if;
 update public.profiles set role='gestor',name='QA Edited' where id='a1000000-0000-4000-8000-000000000005';
 begin
  update public.profiles set role='manager' where id='a1000000-0000-4000-8000-000000000005';
  raise exception 'QA: escalation accepted';
 exception when others then if sqlerrm='QA: escalation accepted' then raise;end if;end;
 begin
  perform public.get_partner_wallet('a1000000-0000-4000-8000-000000000003');raise exception 'QA: foreign wallet RPC accepted';
 exception when others then if sqlerrm='QA: foreign wallet RPC accepted' then raise;end if;end;
 begin
  perform public.save_sale_with_partners(null,'{}','[]');raise exception 'QA: partner sale write accepted';
 exception when others then if sqlerrm='QA: partner sale write accepted' then raise;end if;end;
 w:=public.request_partner_withdrawal(40,'email','pix@example.invalid','a3000000-0000-4000-8000-000000000001');
 perform set_config('qa.partner_withdrawal_id',w->>'id',true);
 perform public.request_partner_withdrawal(40,'email','pix@example.invalid','a3000000-0000-4000-8000-000000000001');
 if (public.get_partner_wallet()->>'available')::numeric<>10 then raise exception 'QA: withdrawal idempotency or reservation failed';end if;
 begin
  perform public.request_partner_withdrawal(11,'email','pix@example.invalid','a3000000-0000-4000-8000-000000000002');raise exception 'QA: overspend accepted';
 exception when others then if sqlerrm='QA: overspend accepted' then raise;end if;end;
 if exists(select 1 from public.notifications where to_user_id<>auth.uid() and link_demand_id is null) then raise exception 'QA: financial notifications leaked';end if;
end;$$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
do $$declare sid uuid:=current_setting('qa.partner_sale_id')::uuid;wid uuid:=current_setting('qa.partner_withdrawal_id')::uuid;begin
 begin
  update public.sales set status='Cancelado' where id=sid;raise exception 'QA: spent sale cancellation accepted';
 exception when others then if sqlerrm='QA: spent sale cancellation accepted' then raise;end if;end;
 perform public.review_partner_withdrawal(wid,'approve','');
 perform public.review_partner_withdrawal(wid,'pay','Comprovante QA');
 if (public.get_partner_wallet('a1000000-0000-4000-8000-000000000002')->>'available')::numeric<>10 then raise exception 'QA: payment deducted twice';end if;
 perform public.review_partner_withdrawal(wid,'reverse','Teste de estorno');
 update public.sales set status='Cancelado' where id=sid;
 if (public.get_partner_wallet('a1000000-0000-4000-8000-000000000002')->>'available')::numeric<>0 then raise exception 'QA: cancellation did not remove credit';end if;
 if (select status from public.affiliate_commissions where sale_id=sid)<>'cancelada' then raise exception 'QA: referral cancellation broken';end if;
end;$$;
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare sid uuid;s jsonb;begin
 insert into public.sales(client_id,service,value,status,sale_date) values('a2000000-0000-4000-8000-000000000001','QA default',200,'Pendente',current_date) returning id into sid;
 if (select rate from public.partner_sale_shares where sale_id=sid)<>50 then raise exception 'QA: default missing';end if;
 perform public.set_partner_default('a1000000-0000-4000-8000-000000000002',40,true);
 update public.sales set value=300 where id=sid;
 if (select rate from public.partner_sale_shares where sale_id=sid)<>50 then raise exception 'QA: default changed historical split';end if;
 select to_jsonb(sales) into s from public.sales where id=sid;
 perform public.save_sale_with_partners(sid,s,'[]');
 if exists(select 1 from public.partner_sale_shares where sale_id=sid and (included or amount<>0)) then raise exception 'QA: exclusion failed';end if;
 update public.sales set value=400 where id=sid;
 if exists(select 1 from public.partner_sale_shares where sale_id=sid and included) then raise exception 'QA: excluded partner restored';end if;
end;$$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
do $$declare did uuid;begin
 insert into public.demands(title,client_id,assignee_id,created_by) values('QA partner demand','a2000000-0000-4000-8000-000000000001',auth.uid(),auth.uid()) returning id into did;
 update public.demands set title='QA partner edited' where id=did;
 if not exists(select 1 from public.demands where id=did and title='QA partner edited') then raise exception 'QA: demand update failed';end if;
 delete from public.demands where id=did;
 if exists(select 1 from public.demands where id=did) then raise exception 'QA: demand deletion failed';end if;
 perform public.admin_set_profile_active('a1000000-0000-4000-8000-000000000005',false);
 perform public.admin_set_profile_active('a1000000-0000-4000-8000-000000000005',true);
 begin
  update public.partner_sale_shares set amount=99999 where partner_id=auth.uid();raise exception 'QA: direct wallet mutation accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.set_partner_default(auth.uid(),99,true);raise exception 'QA: own rate mutation accepted';
 exception when others then if sqlerrm='QA: own rate mutation accepted' then raise;end if;end;
end;$$;
reset role;
select 'PASS: division, pending funds, privacy, hierarchy, wallet isolation, idempotency, overspend, reservation, payment, reversal and cancellation' as partner_verification;
