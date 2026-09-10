-- Incremental migration. Existing commercial records and titles are preserved.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;

create table public.notification_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(user_id,notification_id)
);
create index notification_reads_notification_idx on public.notification_reads(notification_id);
alter table public.notification_reads enable row level security;
grant select,insert on public.notification_reads to authenticated;
grant all on public.notification_reads to service_role;
create policy reads_select_own on public.notification_reads for select to authenticated
using (user_id=(select auth.uid()) and public.is_active_user());
create policy reads_insert_own_visible on public.notification_reads for insert to authenticated
with check (user_id=(select auth.uid()) and public.is_active_user() and exists
  (select 1 from public.notifications n where n.id=notification_id));
-- Preserve the legacy read state once; subsequent reads are always personal.
insert into public.notification_reads(user_id,notification_id)
select p.id,n.id from public.notifications n join public.profiles p on
 n.to_user_id=p.id or (n.to_role='admin' and (p.role in ('ceo','manager','gestor') or
 (p.role='editor' and exists(select 1 from public.demands d where d.id=n.link_demand_id and d.assignee_id=p.id))))
where n.read is true on conflict do nothing;
revoke update on public.notifications from authenticated;

create function public.get_my_notifications() returns setof jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(n)||jsonb_build_object('read',exists(select 1 from public.notification_reads r
 where r.notification_id=n.id and r.user_id=(select auth.uid())))
 from public.notifications n order by n.created_at desc,n.id limit 100;
$$;
create function public.mark_notifications_read(p_ids uuid[]) returns integer
language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if not public.is_active_user() then raise exception 'Sessão inválida'; end if;
 if cardinality(p_ids)>100 then raise exception 'Limite de 100 notificações'; end if;
 insert into public.notification_reads(user_id,notification_id)
 select auth.uid(),n.id from public.notifications n where n.id=any(p_ids)
 on conflict do nothing;
 get diagnostics v_count=row_count;
 return v_count;
end; $$;
revoke all on function public.get_my_notifications(), public.mark_notifications_read(uuid[]) from public,anon;
grant execute on function public.get_my_notifications(), public.mark_notifications_read(uuid[]) to authenticated;
alter publication supabase_realtime add table public.notification_reads;

-- Resolve clients on the server without exposing their profiles to staff directories.
create function public.notify_client(p_client_id uuid,p_icon text,p_icon_bg text,p_title text,p_body text,p_link_demand_id uuid,p_event_type text)
returns uuid[] language plpgsql security definer set search_path='' as $$
declare v_target record; v_ids uuid[]='{}'; v_role text=public.current_user_role();
begin
 if v_role is null or v_role not in ('ceo','manager','gestor','editor') then raise exception 'Sem permissão'; end if;
 if p_link_demand_id is not null and not exists(select 1 from public.demands d where d.id=p_link_demand_id
   and d.client_id=p_client_id and (v_role<>'editor' or d.assignee_id=auth.uid())) then raise exception 'Demanda fora do escopo'; end if;
 if v_role in ('gestor','editor') and p_link_demand_id is null then raise exception 'Demanda obrigatória'; end if;
 for v_target in select p.id from public.profiles p join public.clients c on c.id=p.client_id
 where p.client_id=p_client_id and p.role='client' and p.active and p.archived_at is null
 and c.archived_at is null and c.status<>'Inativo' loop
   v_ids=array_append(v_ids,public.create_notification(v_target.id,null,p_icon,p_icon_bg,p_title,p_body,p_link_demand_id,p_event_type));
 end loop;
 return v_ids;
end; $$;
revoke all on function public.notify_client(uuid,text,text,text,text,uuid,text) from public,anon;
grant execute on function public.notify_client(uuid,text,text,text,text,uuid,text) to authenticated;

-- Exact title collisions are serialized per client, including concurrent inserts.
create function private.number_demand_title() returns trigger language plpgsql security definer set search_path='' as $$
declare v_base text; v_i integer=2;
begin
 if tg_op='UPDATE' and new.title is not distinct from old.title and new.client_id is not distinct from old.client_id then return new; end if;
 new.title=btrim(new.title);
 if new.title is null or new.title='' then raise exception 'Título obrigatório'; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(new.client_id::text,'unassigned'),369));
 if not exists(select 1 from public.demands d where d.client_id is not distinct from new.client_id and d.title=new.title and d.id<>new.id) then return new; end if;
 v_base=regexp_replace(new.title,' \([2-9][0-9]*\)$| \(1[0-9]+\)$','');
 loop
   new.title=v_base||' ('||v_i||')';
   exit when not exists(select 1 from public.demands d where d.client_id is not distinct from new.client_id and d.title=new.title and d.id<>new.id);
   v_i=v_i+1;
 end loop;
 return new;
end; $$;
revoke all on function private.number_demand_title() from public,anon,authenticated;
create trigger zz_number_demand_title before insert or update of title,client_id on public.demands
for each row execute function private.number_demand_title();

create function private.validate_sale_demand() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.demand_id is not null and not exists(select 1 from public.demands d where d.id=new.demand_id and d.client_id=new.client_id) then
 raise exception 'A demanda vinculada precisa pertencer ao cliente da venda'; end if;
 return new;
end; $$;
revoke all on function private.validate_sale_demand() from public,anon,authenticated;
create trigger validate_sale_demand before insert or update of demand_id,client_id on public.sales
for each row execute function private.validate_sale_demand();

create table public.company_settings (
 id boolean primary key default true check(id), name text not null default '',email text not null default '',
 phone text not null default '554899391390' check(phone ~ '^[0-9]{10,15}$'), updated_at timestamptz not null default now()
);
alter table public.company_settings enable row level security;
grant select,update on public.company_settings to authenticated;
grant all on public.company_settings to service_role;
create policy company_read on public.company_settings for select to authenticated using(public.is_active_user());
create policy company_update on public.company_settings for update to authenticated using(public.is_staff_admin()) with check(public.is_staff_admin());
insert into public.company_settings(id) values(true);

alter table public.notifications add column dedupe_key text;
create unique index notifications_dedupe_idx on public.notifications(to_user_id,dedupe_key) where dedupe_key is not null;
create table private.notification_push_queue (
 notification_id uuid primary key references public.notifications(id) on delete cascade,
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 completed_at timestamptz, last_error text
);
alter table private.notification_push_queue enable row level security;
revoke all on private.notification_push_queue from public,anon,authenticated;

do $$ begin
 if not exists(select 1 from vault.secrets where name='magemind_push_dispatch_token') then
 perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'magemind_push_dispatch_token'); end if;
end $$;

create function public.validate_push_dispatch_token(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='magemind_push_dispatch_token' and decrypted_secret=p_token),false);
$$;
create function public.complete_notification_push(p_id uuid,p_error text default null) returns void
language sql security definer set search_path='' as $$
 update private.notification_push_queue set completed_at=case when p_error is null then now() else null end,
 last_error=left(p_error,500) where notification_id=p_id;
$$;
create function public.claim_push_delivery(p_notification_id uuid,p_subscription_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 insert into public.push_deliveries(notification_id,subscription_id,status,attempts,updated_at)
 values(p_notification_id,p_subscription_id,'pending',1,now())
 on conflict(notification_id,subscription_id) do update set status='pending',attempts=public.push_deliveries.attempts+1,updated_at=now(),last_error=null
 where public.push_deliveries.attempts<10 and (public.push_deliveries.status='failed' or
 (public.push_deliveries.status='pending' and public.push_deliveries.updated_at<now()-interval '5 minutes'));
 get diagnostics v_count=row_count;
 return v_count=1;
end; $$;
revoke all on function public.validate_push_dispatch_token(text),public.complete_notification_push(uuid,text),public.claim_push_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.validate_push_dispatch_token(text),public.complete_notification_push(uuid,text),public.claim_push_delivery(uuid,uuid) to service_role;

create function private.dispatch_notification_push() returns integer language plpgsql security definer set search_path='' as $$
declare v_row record; v_token text; v_count integer=0;
begin
 select decrypted_secret into strict v_token from vault.decrypted_secrets where name='magemind_push_dispatch_token';
 for v_row in select q.notification_id from private.notification_push_queue q
 where q.completed_at is null and q.attempts<10 and q.next_attempt_at<=now()
 order by q.next_attempt_at limit 60 for update skip locked loop
   perform net.http_post(url:='https://tsawxmlfvnvepzgcztfc.supabase.co/functions/v1/send-push',
     headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-token',v_token),
     body:=jsonb_build_object('notificationId',v_row.notification_id),timeout_milliseconds:=10000);
   update private.notification_push_queue set attempts=attempts+1,next_attempt_at=now()+interval '6 minutes' where notification_id=v_row.notification_id;
   v_count=v_count+1;
 end loop;
 return v_count;
end; $$;
create function private.enqueue_notification_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.notification_push_queue(notification_id) values(new.id) on conflict do nothing;
 -- pg_net only dispatches after the surrounding transaction commits.
 perform private.dispatch_notification_push();
 return new;
end; $$;
revoke all on function private.dispatch_notification_push(),private.enqueue_notification_push() from public,anon,authenticated;
create trigger enqueue_notification_push after insert on public.notifications for each row execute function private.enqueue_notification_push();

create function private.generate_pending_payment_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer; v_local timestamp=now() at time zone 'America/Sao_Paulo';
begin
 -- Hourly scheduler plus IANA timezone remains correct if timezone rules change.
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
revoke all on function private.generate_pending_payment_reminders() from public,anon,authenticated;
select cron.schedule('magemind-payment-noon','0 * * * *','select private.generate_pending_payment_reminders();');
select cron.schedule('magemind-push-retry','* * * * *','select private.dispatch_notification_push();');
-- Activated after the matching Edge Function is deployed and verified.
select cron.alter_job(job_id:=jobid,active:=false) from cron.job where jobname in ('magemind-payment-noon','magemind-push-retry');
