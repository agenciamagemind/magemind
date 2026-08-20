-- Preserve notification history when a demand is deleted. The foreign key
-- notifications.link_demand_id uses ON DELETE SET NULL; this trigger must
-- allow that internal cleanup while continuing to reject user-authored edits.

begin;

create or replace function public.guard_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  demand_link_cleared_by_fk boolean;
begin
  demand_link_cleared_by_fk :=
    old.link_demand_id is not null
    and new.link_demand_id is null
    and not exists (
      select 1
      from public.demands d
      where d.id = old.link_demand_id
    );

  if auth.uid() is not null and (
    new.to_user_id is distinct from old.to_user_id
    or new.to_role is distinct from old.to_role
    or new.icon is distinct from old.icon
    or new.icon_bg is distinct from old.icon_bg
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or (
      new.link_demand_id is distinct from old.link_demand_id
      and not demand_link_cleared_by_fk
    )
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Only the read state of a notification can be changed';
  end if;

  return new;
end;
$$;

-- Trigger-only function: keep it unavailable as a public RPC.
revoke execute on function public.guard_notification_update() from public, anon, authenticated;

commit;
