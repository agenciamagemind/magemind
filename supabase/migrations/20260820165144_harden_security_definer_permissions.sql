-- Close the default Postgres EXECUTE grants on SECURITY DEFINER functions.
-- Trigger-only functions are never exposed as RPCs; authenticated users retain
-- only the helpers and guarded RPCs needed by RLS and the application.

begin;

alter function public.is_admin() set search_path = public, pg_temp;
alter function public.my_client_id() set search_path = public, pg_temp;
alter function public.update_updated_at() set search_path = public, pg_temp;

revoke execute on function public.calc_affiliate_commission() from public, anon, authenticated;
revoke execute on function public.can_manage_user(uuid) from public, anon, authenticated;
revoke execute on function public.current_user_role() from public, anon, authenticated;
revoke execute on function public.enforce_role_on_new_profile() from public, anon, authenticated;
revoke execute on function public.guard_notification_update() from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.is_affiliate() from public, anon, authenticated;
revoke execute on function public.is_ceo() from public, anon, authenticated;
revoke execute on function public.is_client() from public, anon, authenticated;
revoke execute on function public.is_editor() from public, anon, authenticated;
revoke execute on function public.is_gestor() from public, anon, authenticated;
revoke execute on function public.is_manager() from public, anon, authenticated;
revoke execute on function public.is_operational_staff() from public, anon, authenticated;
revoke execute on function public.is_staff_admin() from public, anon, authenticated;
revoke execute on function public.my_client_id() from public, anon, authenticated;
revoke execute on function public.protect_ceo_delete() from public, anon, authenticated;
revoke execute on function public.protect_ceo_profile() from public, anon, authenticated;
revoke execute on function public.protect_demand_assignee() from public, anon, authenticated;
revoke execute on function public.protect_demand_client() from public, anon, authenticated;
revoke execute on function public.set_my_phone(text) from public, anon, authenticated;
revoke execute on function public.set_user_role(uuid, text) from public, anon, authenticated;

grant execute on function public.can_manage_user(uuid) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_affiliate() to authenticated;
grant execute on function public.is_ceo() to authenticated;
grant execute on function public.is_client() to authenticated;
grant execute on function public.is_editor() to authenticated;
grant execute on function public.is_gestor() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_operational_staff() to authenticated;
grant execute on function public.is_staff_admin() to authenticated;
grant execute on function public.my_client_id() to authenticated;
grant execute on function public.set_my_phone(text) to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;

commit;

