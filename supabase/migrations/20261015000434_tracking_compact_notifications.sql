-- Show the amount by default; an explicit privacy preference remains available.
alter table public.tracking_notification_preferences alter column hide_amount set default false;
update public.tracking_notification_preferences p set hide_amount=false
from public.tracking_workspaces w
where w.id=p.workspace_id and w.owner_id=p.user_id
and private.tracking_account_enabled(w.owner_id);
