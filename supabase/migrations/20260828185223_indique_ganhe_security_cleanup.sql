-- Consolidate the old affiliate SELECT policy into the capability-aware one.
drop policy if exists commissions_select_authorized on public.affiliate_commissions;

create index if not exists profiles_affiliate_reviewed_by_idx
  on public.profiles(affiliate_reviewed_by)
  where affiliate_reviewed_by is not null;

-- CREATE OR REPLACE can preserve older direct grants. The browser-facing RPCs
-- are authenticated-only; trigger functions are not API endpoints.
revoke all on function public.request_indique_ganhe_access() from PUBLIC,anon;
revoke all on function public.review_indique_ganhe_access(uuid,text) from PUBLIC,anon;
revoke all on function public.is_referral_participant() from PUBLIC,anon;
revoke all on function public.get_affiliate_wallet(uuid) from PUBLIC,anon;
revoke all on function public.request_affiliate_withdrawal(numeric,text,text,uuid) from PUBLIC,anon;
revoke all on function public.get_my_affiliate_client_metrics() from PUBLIC,anon;
revoke all on function public.get_my_affiliate_commission_sales() from PUBLIC,anon;
revoke all on function public.admin_update_affiliate_commission(uuid,numeric) from PUBLIC,anon;
revoke all on function public.admin_archive_affiliate(uuid) from PUBLIC,anon;
revoke all on function public.admin_update_client(uuid,text,text,text,text,text,timestamptz,uuid,uuid[]) from PUBLIC,anon;
revoke all on function public.admin_create_client_record(text,text,text,text,text,text,timestamptz,uuid,uuid[]) from PUBLIC,anon;
revoke all on function public.admin_convert_client_to_team(uuid,text) from PUBLIC,anon;
revoke all on function public.guard_profile_update() from PUBLIC,anon,authenticated;
revoke all on function public.guard_client_referral_assignment() from PUBLIC,anon,authenticated;
revoke all on function public.calc_affiliate_commission() from PUBLIC,anon,authenticated;

grant execute on function public.request_indique_ganhe_access() to authenticated;
grant execute on function public.review_indique_ganhe_access(uuid,text) to authenticated;
grant execute on function public.is_referral_participant() to authenticated;
grant execute on function public.get_affiliate_wallet(uuid) to authenticated;
grant execute on function public.request_affiliate_withdrawal(numeric,text,text,uuid) to authenticated;
grant execute on function public.get_my_affiliate_client_metrics() to authenticated;
grant execute on function public.get_my_affiliate_commission_sales() to authenticated;
grant execute on function public.admin_update_affiliate_commission(uuid,numeric) to authenticated;
grant execute on function public.admin_archive_affiliate(uuid) to authenticated;
grant execute on function public.admin_update_client(uuid,text,text,text,text,text,timestamptz,uuid,uuid[]) to authenticated;
grant execute on function public.admin_create_client_record(text,text,text,text,text,text,timestamptz,uuid,uuid[]) to authenticated;
grant execute on function public.admin_convert_client_to_team(uuid,text) to authenticated;
