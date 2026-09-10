-- Preserve useful in-app content; push truncation belongs to the delivery surface.
create or replace function public.create_notification(p_to_user_id uuid,p_to_role text,p_icon text,p_icon_bg text,p_title text,p_body text,p_link_demand_id uuid,p_event_type text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_role text=public.current_user_role();
begin
 if not public.is_active_user() then raise exception 'Inactive user'; end if;
 if (p_to_user_id is null)=(p_to_role is null) then raise exception 'Exactly one recipient is required'; end if;
 if p_to_role is not null and p_to_role<>'admin' then raise exception 'Invalid role recipient'; end if;
 if not public.is_operational_staff() and (p_to_user_id is not null or p_to_role<>'admin') then raise exception 'Clients can only notify the operational team'; end if;
 if p_link_demand_id is not null and not exists(select 1 from public.demands d where d.id=p_link_demand_id and
   (v_role in ('ceo','manager','gestor') or (v_role='editor' and d.assignee_id=auth.uid()) or (v_role='client' and d.client_id=public.my_client_id()))) then raise exception 'Demanda fora do escopo'; end if;
 if v_role='editor' and p_link_demand_id is null then raise exception 'Demanda obrigatória'; end if;
 if p_to_user_id is not null and v_role in ('gestor','editor') and not exists(select 1 from public.profiles p join public.demands d on d.id=p_link_demand_id
   where p.id=p_to_user_id and p.active and p.archived_at is null and (p.id=d.assignee_id or (p.role='client' and p.client_id=d.client_id))) then raise exception 'Destinatário fora do escopo'; end if;
 insert into public.notifications(to_user_id,to_role,icon,icon_bg,title,body,link_demand_id,event_type,read,created_by)
 values(p_to_user_id,p_to_role,p_icon,p_icon_bg,coalesce(nullif(btrim(p_title),''),'Magemind'),coalesce(p_body,''),p_link_demand_id,coalesce(nullif(p_event_type,''),'general'),false,auth.uid()) returning id into v_id;
 return v_id;
end; $$;
revoke all on function public.create_notification(uuid,text,text,text,text,text,uuid,text) from public,anon;
grant execute on function public.create_notification(uuid,text,text,text,text,text,uuid,text) to authenticated;

-- Clock parameter is private and makes noon/idempotency testable without changing server time.
create function private.generate_pending_payment_reminders_at(p_at timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer; v_local timestamp=p_at at time zone 'America/Sao_Paulo';
begin
 if extract(hour from v_local)<>12 then return 0; end if;
 insert into public.notifications(to_user_id,title,body,icon,icon_bg,event_type,dedupe_key,read)
 select p.id,'Pagamento pendente',
   'Você tem R$ '||replace(replace(replace(to_char(sum(s.value),'FM999,999,999,990.00'),',','@'),'.',','),'@','.')||' pendentes. Fale com a Magemind pelo WhatsApp para acertar.',
   '⚠','var(--amberbg)','sale_payment_pending','payment:'||v_local::date::text,false
 from public.profiles p join public.clients c on c.id=p.client_id join public.sales s on s.client_id=c.id
 where p.role='client' and p.active and p.archived_at is null and c.archived_at is null and c.status<>'Inativo' and s.status='Pendente'
 group by p.id having sum(s.value)>0
 on conflict(to_user_id,dedupe_key) where dedupe_key is not null do nothing;
 get diagnostics v_count=row_count;
 return v_count;
end; $$;
create or replace function private.generate_pending_payment_reminders() returns integer language sql security definer set search_path='' as $$
 select private.generate_pending_payment_reminders_at(now());
$$;
revoke all on function private.generate_pending_payment_reminders_at(timestamptz),private.generate_pending_payment_reminders() from public,anon,authenticated;

create function private.guard_linked_demand_client() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.client_id is distinct from old.client_id and exists(select 1 from public.sales s where s.demand_id=new.id and s.client_id is distinct from new.client_id) then
 raise exception 'Desvincule a demanda das vendas antes de alterar seu cliente'; end if;
 return new;
end; $$;
revoke all on function private.guard_linked_demand_client() from public,anon,authenticated;
create trigger guard_linked_demand_client before update of client_id on public.demands for each row execute function private.guard_linked_demand_client();

create policy push_queue_service_only on private.notification_push_queue for all to service_role using(true) with check(true);
-- Delivery has custom authentication: a random 256-bit token kept only in Vault.
select cron.alter_job(job_id:=jobid,active:=true) from cron.job where jobname in ('magemind-payment-noon','magemind-push-retry');
