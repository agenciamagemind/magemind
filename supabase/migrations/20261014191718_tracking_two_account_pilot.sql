-- Only the explicitly named master account and tester may use Tracking.
-- Resolve verified Auth identities instead of trusting profile roles or metadata.
do $$begin
 if(select count(*) from auth.users where lower(email) in('ogabrielmrossi@gmail.com','testetrack@gmail.com') and email_confirmed_at is not null)<>2 then raise exception 'Two confirmed pilot accounts required';end if;
end $$;
update private.tracking_pilot_allowlist set enabled=false where user_id not in(select id from auth.users where lower(email) in('ogabrielmrossi@gmail.com','testetrack@gmail.com') and email_confirmed_at is not null);
insert into private.tracking_pilot_allowlist(user_id,enabled) select id,true from auth.users where lower(email) in('ogabrielmrossi@gmail.com','testetrack@gmail.com') and email_confirmed_at is not null on conflict(user_id) do update set enabled=true;
create or replace function private.tracking_account_enabled(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join private.tracking_pilot_allowlist a on a.user_id=p.id join auth.users usr on usr.id=p.id where p.id=u and p.active and p.archived_at is null and a.enabled and usr.email_confirmed_at is not null and lower(usr.email) in('ogabrielmrossi@gmail.com','testetrack@gmail.com'));
$$;
revoke all on function private.tracking_account_enabled(uuid) from public,anon,authenticated;
grant execute on function private.tracking_account_enabled(uuid) to service_role;
