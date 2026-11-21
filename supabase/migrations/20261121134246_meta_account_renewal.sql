alter table private.tracking_oauth_states
  add column renewal_integration_id uuid,
  add column renewal_generation uuid;

create or replace function public.tracking_disconnect(w uuid, i uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.tracking_access(w, 'write') then raise exception 'Forbidden'; end if;
  update public.tracking_integrations set connected = false,
    connection_generation = case when provider = 'meta' then gen_random_uuid() else connection_generation end,
    meta_sync_claim = null, meta_sync_started_at = null
    where workspace_id = w and id = i;
  delete from private.tracking_credentials where integration_id = i and exists(
    select 1 from public.tracking_integrations where workspace_id = w and id = i
  );
  update public.tracking_ad_accounts set selected = false where workspace_id = w and (provider, account_id) in (
    select provider, account_id from public.tracking_integrations where id = i and workspace_id = w
  );
  insert into public.tracking_audit(workspace_id, actor_id, action, entity_id)
    values(w, (select auth.uid()), 'integration.disconnect', i::text);
end $$;

create function public.tracking_begin_meta_renewal(h text, w uuid, u uuid, s uuid, i uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.tracking_integrations;
begin
  perform public.tracking_oauth_begin(h, w, u, 'meta', s);
  select * into target from public.tracking_integrations
    where id = i and workspace_id = w and provider = 'meta'
      and account_id ~ '^act_[0-9]+$' and mode <> 'simulated';
  if not found then raise exception 'Integration inaccessible' using errcode = 'P0002'; end if;
  update private.tracking_oauth_states
    set renewal_integration_id = target.id, renewal_generation = target.connection_generation
    where state_hash = h;
end $$;

revoke all on function public.tracking_begin_meta_renewal(text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.tracking_begin_meta_renewal(text, uuid, uuid, uuid, uuid) to service_role;

create or replace function public.tracking_oauth_grant(g uuid, u uuid, s uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  grant_row private.tracking_oauth_grants;
  renewal_id uuid;
begin
  if auth.role() <> 'service_role' or not private.tracking_account_enabled(u) then raise exception 'Forbidden'; end if;
  select * into strict grant_row from private.tracking_oauth_grants
    where id = g and user_id = u and session_id = s and expires_at > now() and used_at is null;
  if not exists(select 1 from auth.sessions where id = s and user_id = u) then raise exception 'Forbidden'; end if;
  select renewal_integration_id into renewal_id
    from private.tracking_oauth_states where state_hash = grant_row.state_hash;
  return to_jsonb(grant_row) || jsonb_build_object('renewal_integration_id', renewal_id);
end $$;

create or replace function public.tracking_install_oauth_accounts(g uuid, u uuid, s uuid, accounts jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  grant_row jsonb;
  renewal private.tracking_oauth_states;
  a jsonb;
  i uuid;
  workspace uuid;
  n integer := 0;
begin
  grant_row := public.tracking_oauth_grant(g, u, s);
  workspace := (grant_row->>'workspace_id')::uuid;
  perform 1 from private.tracking_oauth_grants where id = g and used_at is null for update;
  if not found then raise exception 'OAuth grant used' using errcode = 'P0002'; end if;
  if jsonb_typeof(accounts) is distinct from 'array' or jsonb_array_length(accounts) not between 1 and 20 then
    raise exception 'Selecione entre uma e vinte contas';
  end if;
  select * into strict renewal from private.tracking_oauth_states where state_hash = grant_row->>'state_hash';
  if renewal.renewal_integration_id is not null then
    if jsonb_array_length(accounts) <> 1 then
      raise exception 'Invalid renewal target' using errcode = '40001';
    end if;
    perform 1 from public.tracking_integrations
      where id = renewal.renewal_integration_id and workspace_id = workspace and provider = 'meta'
        and account_id = (accounts->0)->>'account_id' and connection_generation = renewal.renewal_generation
      for update;
    if not found then raise exception 'Meta connection changed' using errcode = '40001'; end if;
  end if;
  for a in select value from jsonb_array_elements(accounts) order by value->>'account_id' loop
    if a->>'account_id' !~ '^act_[0-9]+$' or not exists(select 1 from pg_timezone_names where name = a->>'timezone')
       or a->>'currency' not in ('BRL','USD','EUR','JPY','KWD') then raise exception 'Conta inválida'; end if;
    insert into public.tracking_integrations(workspace_id,provider,account_id,name,mode,connection_kind,error_code,
      provider_profile_id,provider_profile_name,management_access,connection_checked_at)
    values(workspace,'meta',a->>'account_id',left(a->>'name',200),'approved_test','oauth','sync_requested',
      a->>'profile_id',left(a->>'profile_name',120),(a->>'management_access')::boolean,now())
    on conflict(workspace_id,provider,account_id) do update set name=excluded.name,mode=excluded.mode,
      connection_kind='oauth',connected=true,error_code='sync_requested',retry_after_at=null,error_count=0,
      provider_profile_id=excluded.provider_profile_id,provider_profile_name=excluded.provider_profile_name,
      management_access=excluded.management_access,connection_checked_at=excluded.connection_checked_at,
      connection_generation=gen_random_uuid(),meta_sync_claim=null,meta_sync_started_at=null returning id into i;
    insert into private.tracking_credentials(integration_id,cipher) values(i,grant_row->>'cipher')
      on conflict(integration_id) do update set cipher=excluded.cipher,token_hash=null,revoked_at=null,
        revision=tracking_credentials.revision+1;
    insert into public.tracking_ad_accounts(workspace_id,provider,account_id,name,currency,timezone,selected)
      values(workspace,'meta',a->>'account_id',a->>'name',a->>'currency',a->>'timezone',true)
      on conflict(workspace_id,provider,account_id) do update set name=excluded.name,currency=excluded.currency,
        timezone=excluded.timezone,selected=true;
    update public.tracking_ad_entities set status_request_id=null,status_request_until=null
      where workspace_id=workspace and provider='meta' and account_id=a->>'account_id' and status_request_id is not null;
    n := n + 1;
  end loop;
  update private.tracking_oauth_grants set used_at = now(), cipher = '' where id = g;
  return n;
end $$;
