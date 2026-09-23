alter policy partner_defaults_read on public.partner_defaults using ((select public.is_staff_admin()) or ((select public.current_user_role())='partner' and partner_id=(select auth.uid())));
alter policy partner_shares_read on public.partner_sale_shares using ((select public.is_staff_admin()) or ((select public.current_user_role())='partner' and partner_id=(select auth.uid())));
alter policy partner_withdrawals_read on public.partner_withdrawals using ((select public.is_staff_admin()) or ((select public.current_user_role())='partner' and partner_id=(select auth.uid())));
alter policy partner_events_read on public.partner_financial_events using ((select public.is_staff_admin()) or ((select public.current_user_role())='partner' and partner_id=(select auth.uid())));
