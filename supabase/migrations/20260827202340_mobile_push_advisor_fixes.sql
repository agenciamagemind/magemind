-- Make the service-only intent explicit to the database linter. The service
-- role bypasses RLS; browser roles still have no table privileges.
create policy push_deliveries_service_only
on public.push_deliveries for all
to authenticated
using (false)
with check (false);

create index if not exists push_deliveries_subscription_idx
  on public.push_deliveries (subscription_id);
