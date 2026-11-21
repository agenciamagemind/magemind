alter table public.tracking_integrations
  add column provider_profile_id text check (provider_profile_id ~ '^[0-9]{1,40}$'),
  add column provider_profile_name text check (length(provider_profile_name) <= 120),
  add column management_access boolean,
  add column connection_checked_at timestamptz,
  add column connection_generation uuid not null default gen_random_uuid(),
  add column meta_sync_claim uuid,
  add column meta_sync_started_at timestamptz;

create index tracking_meta_profile_accounts on public.tracking_integrations(workspace_id, provider_profile_id)
  where provider = 'meta' and connected;

alter table public.tracking_ad_entities
  add column provider_status text,
  add column status_request_id uuid,
  add column status_request_until timestamptz;

create function public.tracking_disconnect_meta_profile(w uuid, p text) returns void
language plpgsql security invoker set search_path = '' as $$
declare integration uuid;
begin
  if not private.tracking_access(w,'write') then raise exception 'Forbidden'; end if;
  for integration in
    select id from public.tracking_integrations
      where workspace_id = w and provider = 'meta' and provider_profile_id = p and connected
      order by id
  loop
    perform public.tracking_disconnect(w, integration);
  end loop;
end $$;
revoke all on function public.tracking_disconnect_meta_profile(uuid,text) from public, anon;
grant execute on function public.tracking_disconnect_meta_profile(uuid,text) to authenticated;

create function public.tracking_claim_meta_sync(i uuid, g uuid) returns uuid
language sql security invoker set search_path = '' as $$
  update public.tracking_integrations integration
  set meta_sync_claim = gen_random_uuid(), meta_sync_started_at = clock_timestamp()
  where (select auth.role()) = 'service_role'
    and integration.id = i and integration.provider = 'meta' and integration.connected
    and integration.connection_generation = g
    and (meta_sync_started_at is null or meta_sync_started_at < now() - interval '3 minutes')
    and coalesce(retry_after_at, '-infinity') <= now()
    and coalesce(error_code, '') not in ('token_revoked','meta_confirmation_required','meta_read_denied','provider_http_400_200','provider_http_400_10')
    and (last_sync_at is null or error_code is not null
      or last_sync_at <= now() - make_interval(secs => sync_interval_seconds))
    and exists (select 1 from public.tracking_ad_accounts a where a.selected
      and a.workspace_id = integration.workspace_id and a.provider = 'meta' and a.account_id = integration.account_id)
  returning meta_sync_claim
$$;

create function public.tracking_publish_meta_sync(
  i uuid, g uuid, claim uuid, stats jsonb, entities jsonb, failure text, retry_seconds integer
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare integration public.tracking_integrations;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Internal service only'; end if;
  select * into integration from public.tracking_integrations where id = i and provider = 'meta' and connected
    and connection_generation = g and meta_sync_claim = claim for update;
  if not found then return false; end if;
  if failure is not null then
    perform public.tracking_internal_status(i, failure);
    update public.tracking_integrations set
      meta_sync_claim = null, meta_sync_started_at = null,
      error_count = least(integration.error_count + 1, 10000),
      retry_after_at = now() + make_interval(secs => greatest(15, least(retry_seconds, 86400)))
      where id = i;
    return true;
  end if;
  perform public.tracking_internal_ad_snapshot(i, stats);
  insert into public.tracking_ad_entities as existing (
    workspace_id, provider, account_id, entity_id, level, name, parent_id, status, provider_status
  )
  select integration.workspace_id, 'meta', integration.account_id, e.entity_id, e.level, e.name, e.parent_id, e.status, e.provider_status
  from jsonb_to_recordset(entities) as e(entity_id text, level text, name text, parent_id text, status text, provider_status text)
  on conflict (workspace_id, provider, account_id, entity_id) do update
    set name = excluded.name, parent_id = excluded.parent_id, level = excluded.level,
      status = excluded.status, provider_status = excluded.provider_status,
      revision = existing.revision + case when existing.status <> excluded.status then 1 else 0 end,
      status_updated_at = case when existing.status <> excluded.status then now() else existing.status_updated_at end
    where coalesce(existing.status_request_until, '-infinity') <= now()
      and coalesce(existing.status_updated_at, '-infinity') < integration.meta_sync_started_at;
  perform public.tracking_internal_status(i, null);
  update public.tracking_integrations set meta_sync_claim = null, meta_sync_started_at = null, error_count = 0, retry_after_at = null
    where id = i;
  return true;
end $$;

create function public.tracking_record_meta_check(
  i uuid, g uuid, profile_id text, profile_name text, can_manage boolean, failure text
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare integration public.tracking_integrations;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Internal service only'; end if;
  select * into integration from public.tracking_integrations where id = i and provider = 'meta' and connected
    and connection_generation = g for update;
  if not found then return false; end if;
  update public.tracking_integrations set
    provider_profile_id = coalesce(profile_id, provider_profile_id),
    provider_profile_name = coalesce(profile_name, provider_profile_name),
    management_access = coalesce(can_manage, management_access),
    connection_checked_at = now()
    where id = i;
  if failure is not null then
    perform public.tracking_internal_status(i, failure);
  elsif profile_id is not null and coalesce(integration.error_code,'') in (
    'token_revoked','meta_confirmation_required','meta_read_denied','provider_http_400_200','provider_http_400_10'
  ) then
    update public.tracking_integrations set error_code = 'sync_requested', retry_after_at = null, error_count = 0 where id = i;
  end if;
  return true;
end $$;

create function public.tracking_claim_ad_status(i uuid, g uuid, e text, v integer) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare integration public.tracking_integrations; claim uuid;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Internal service only'; end if;
  select * into integration from public.tracking_integrations where id = i and provider = 'meta'
    and connection_generation = g and connected and mode <> 'simulated' for update;
  if not found or integration.management_access is false
    or coalesce(integration.error_code, '') in ('token_revoked','meta_confirmation_required','meta_read_denied','provider_http_400_200','provider_http_400_10')
    or not exists (select 1 from public.tracking_ad_accounts a
      where a.workspace_id = integration.workspace_id and a.provider = 'meta' and a.account_id = integration.account_id and a.selected) then return null; end if;
  update public.tracking_ad_entities set
    status_request_id = gen_random_uuid(), status_request_until = now() + interval '40 seconds'
    where workspace_id = integration.workspace_id and provider = 'meta' and account_id = integration.account_id
      and entity_id = e and revision = v and coalesce(status_request_until, '-infinity') <= now()
      and coalesce(provider_status, 'ACTIVE') in ('ACTIVE','PAUSED')
    returning status_request_id into claim;
  return claim;
end $$;

create function public.tracking_finish_ad_status(i uuid, g uuid, e text, claim uuid, target text, actor uuid, resync boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare integration public.tracking_integrations;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Internal service only'; end if;
  select * into integration from public.tracking_integrations where id = i and provider = 'meta'
    and connection_generation = g and connected for update;
  if not found then return false; end if;
  update public.tracking_ad_entities set
    status = coalesce(target, status), provider_status = coalesce(target, provider_status),
    revision = revision + case when target is null then 0 else 1 end,
    status_updated_at = case when target is null then status_updated_at else clock_timestamp() end,
    status_request_id = null, status_request_until = null
    where workspace_id = integration.workspace_id and provider = 'meta' and account_id = integration.account_id
      and entity_id = e and status_request_id = claim;
  if not found then return false; end if;
  if target is not null then
    insert into public.tracking_audit(workspace_id, actor_id, action, entity_id, details)
      values(integration.workspace_id, actor, 'ad.status', e, jsonb_build_object('provider','meta','status',target));
  end if;
  if resync then
    update public.tracking_integrations set error_code = 'sync_requested', retry_after_at = null
      where id = i and error_code is null;
  end if;
  return true;
end $$;

revoke all on function
  public.tracking_claim_meta_sync(uuid,uuid),
  public.tracking_publish_meta_sync(uuid,uuid,uuid,jsonb,jsonb,text,integer),
  public.tracking_record_meta_check(uuid,uuid,text,text,boolean,text),
  public.tracking_claim_ad_status(uuid,uuid,text,integer),
  public.tracking_finish_ad_status(uuid,uuid,text,uuid,text,uuid,boolean)
  from public, anon, authenticated;
grant execute on function
  public.tracking_claim_meta_sync(uuid,uuid),
  public.tracking_publish_meta_sync(uuid,uuid,uuid,jsonb,jsonb,text,integer),
  public.tracking_record_meta_check(uuid,uuid,text,text,boolean,text),
  public.tracking_claim_ad_status(uuid,uuid,text,integer),
  public.tracking_finish_ad_status(uuid,uuid,text,uuid,text,uuid,boolean)
  to service_role;

CREATE OR REPLACE FUNCTION public.tracking_install_oauth_accounts(g uuid, u uuid, s uuid, accounts jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare grant_row jsonb;a jsonb;i uuid;n integer:=0;begin
 grant_row:=public.tracking_oauth_grant(g,u,s);
 perform 1 from private.tracking_oauth_grants where id=g and used_at is null for update;
 if not found or jsonb_array_length(accounts) not between 1 and 20 then raise exception 'Selecione entre uma e vinte contas';end if;
 for a in select value from jsonb_array_elements(accounts) order by value->>'account_id' loop
  if a->>'account_id' !~ '^act_[0-9]+$' or not exists(select 1 from pg_timezone_names where name=a->>'timezone') or a->>'currency' not in('BRL','USD','EUR','JPY','KWD') then raise exception 'Conta inválida';end if;
  insert into public.tracking_integrations(workspace_id,provider,account_id,name,mode,connection_kind,error_code,provider_profile_id,provider_profile_name,management_access,connection_checked_at)
  values((grant_row->>'workspace_id')::uuid,'meta',a->>'account_id',left(a->>'name',200),'approved_test','oauth','sync_requested',a->>'profile_id',left(a->>'profile_name',120),(a->>'management_access')::boolean,now())
  on conflict(workspace_id,provider,account_id) do update set name=excluded.name,mode=excluded.mode,connection_kind='oauth',connected=true,error_code='sync_requested',retry_after_at=null,error_count=0,
    provider_profile_id=excluded.provider_profile_id,provider_profile_name=excluded.provider_profile_name,
    management_access=excluded.management_access,connection_checked_at=excluded.connection_checked_at,
    connection_generation=gen_random_uuid(),meta_sync_claim=null,meta_sync_started_at=null returning id into i;
  insert into private.tracking_credentials(integration_id,cipher) values(i,grant_row->>'cipher') on conflict(integration_id) do update set cipher=excluded.cipher,token_hash=null,revoked_at=null,revision=tracking_credentials.revision+1;
  insert into public.tracking_ad_accounts(workspace_id,provider,account_id,name,currency,timezone,selected) values((grant_row->>'workspace_id')::uuid,'meta',a->>'account_id',a->>'name',a->>'currency',a->>'timezone',true)
  on conflict(workspace_id,provider,account_id) do update set name=excluded.name,currency=excluded.currency,timezone=excluded.timezone,selected=true;
  update public.tracking_ad_entities set status_request_id=null,status_request_until=null
    where workspace_id=(grant_row->>'workspace_id')::uuid and provider='meta' and account_id=a->>'account_id'
      and status_request_id is not null;
  n:=n+1;
 end loop;
 update private.tracking_oauth_grants set used_at=now(),cipher='' where id=g;return n;
end $function$;
