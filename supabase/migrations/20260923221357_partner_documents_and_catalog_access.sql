alter policy docs_insert_authorized on public.docs  with check ((is_staff_admin() OR ((is_gestor() OR (is_editor() OR (select public.current_user_role())='partner')) AND (visibility <> 'restricted'::text)) OR (is_client() AND (created_by = ( SELECT auth.uid() AS uid)) AND (client_id = my_client_id()) AND (visibility = 'client'::text))));
alter policy docs_select_authorized on public.docs using ((is_staff_admin() OR is_gestor() OR (is_editor() OR (select public.current_user_role())='partner') OR (is_affiliate() AND (visibility = ANY (ARRAY['affiliate'::text, 'public'::text]))) OR (is_client() AND ((visibility = 'public'::text) OR (client_id = my_client_id()))))) ;
alter policy docs_update_authorized on public.docs using ((is_staff_admin() OR ((is_gestor() OR (is_editor() OR (select public.current_user_role())='partner')) AND (visibility <> 'restricted'::text)) OR (is_client() AND (created_by = ( SELECT auth.uid() AS uid)) AND (client_id = my_client_id()) AND (visibility = 'client'::text)))) with check ((is_staff_admin() OR ((is_gestor() OR (is_editor() OR (select public.current_user_role())='partner')) AND (visibility <> 'restricted'::text)) OR (is_client() AND (created_by = ( SELECT auth.uid() AS uid)) AND (client_id = my_client_id()) AND (visibility = 'client'::text))));
alter policy plans_select_catalog on public.plans using ((( SELECT is_staff_admin() AS is_staff_admin) OR (( SELECT is_affiliate() AS is_affiliate) AND active AND (NOT is_custom)) OR (( SELECT is_client() AS is_client) AND ((active AND (NOT is_custom)) OR (id = ( SELECT client.plan_id
   FROM clients client
  WHERE (client.id = ( SELECT my_client_id() AS my_client_id)))) OR (EXISTS ( SELECT 1
   FROM client_plans client_plan
  WHERE ((client_plan.client_id = ( SELECT my_client_id() AS my_client_id)) AND (client_plan.plan_id = plans.id))))))) OR ((select public.current_user_role())='partner' and active and not is_custom));
CREATE OR REPLACE FUNCTION private.partner_share_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare heading text; body text;
begin
 if tg_op='UPDATE' and row(new.amount,new.state,new.rate,new.included) is not distinct from row(old.amount,old.state,old.rate,old.included) then return new;end if;
 heading:=case when new.state='cancelled' then 'Participação cancelada' when new.state='available' then 'Saldo liberado para você' else 'Nova venda vinculada' end;
 body:=case when new.state='cancelled' then 'A participação desta venda foi cancelada. Consulte seu histórico na Carteira.' else 'Sua parte: R$ '||replace(to_char(new.amount,'FM999999990.00'),'.',',')||' ('||new.rate||'%). '||case when new.state='available' then 'O valor já está disponível na carteira.' else 'O saldo será liberado quando a venda for fechada.' end end;
 insert into public.notifications(to_user_id,icon,icon_bg,title,body,event_type,created_by) values(new.partner_id,'💰','var(--emeraldbg)',heading,body,'partner_sale_updated',auth.uid());
 insert into public.partner_financial_events(partner_id,actor_id,event_type,details) values(new.partner_id,auth.uid(),'sale_share',jsonb_build_object('sale_id',new.sale_id,'amount',new.amount,'rate',new.rate,'state',new.state,'included',new.included));
 return new;
end;$function$
;
CREATE OR REPLACE FUNCTION private.partner_withdrawal_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare heading text;
begin
 heading:=case new.status when 'pending' then 'Saque solicitado' when 'approved' then 'Saque aprovado' when 'paid' then 'Pagamento registrado' when 'rejected' then 'Saque não aprovado' when 'cancelled' then 'Saque cancelado' else 'Pagamento estornado' end;
 insert into public.partner_financial_events(partner_id,actor_id,event_type,details) values(new.partner_id,auth.uid(),'withdrawal_'||new.status,jsonb_build_object('withdrawal_id',new.id,'amount',new.amount,'note',new.note));
 insert into public.notifications(to_user_id,icon,icon_bg,title,body,event_type,created_by)
 values(new.partner_id,'💳','var(--violetbg)',heading,'R$ '||replace(to_char(new.amount,'FM999999990.00'),'.',',')||'. Acompanhe os detalhes na sua Carteira.','partner_withdrawal_'||new.status,auth.uid());
 if new.status='pending' then
  insert into public.notifications(to_user_id,icon,icon_bg,title,body,event_type,created_by)
  select id,'💳','var(--violetbg)','Saque de parceiro solicitado',left(new.partner_name,100)||' solicitou R$ '||replace(to_char(new.amount,'FM999999990.00'),'.',',')||'. Revise em Saques.','partner_withdrawal_requested',auth.uid() from public.profiles where role in ('ceo','manager') and active and archived_at is null;
 end if;
 return new;
end;$function$
;
