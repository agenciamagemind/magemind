create or replace function public.create_notification(
  p_to_user_id uuid,
  p_to_role text,
  p_icon text,
  p_icon_bg text,
  p_title text,
  p_body text,
  p_link_demand_id uuid,
  p_event_type text
)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_title text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_body text := regexp_replace(btrim(coalesce(p_body, '')), '\s+', ' ', 'g');
  v_cut text;
  v_sentence text;
begin
  if not public.is_active_user() then raise exception 'Inactive user'; end if;
  if (p_to_user_id is null) = (p_to_role is null) then raise exception 'Exactly one recipient is required'; end if;
  if p_to_role is not null and p_to_role <> 'admin' then raise exception 'Invalid role recipient'; end if;
  if public.is_operational_staff() then
    if p_to_user_id is null and p_to_role <> 'admin' then raise exception 'Invalid recipient'; end if;
  elsif p_to_user_id is not null or p_to_role <> 'admin' then
    raise exception 'Clients can only notify the operational team';
  end if;

  if v_title = '' then v_title := 'Magemind'; end if;
  if char_length(v_title) > 28 then
    v_sentence := substring(v_title from '^.{12,27}[.!?]');
    if v_sentence is not null then
      v_title := btrim(v_sentence);
    else
      v_cut := regexp_replace(rtrim(left(v_title, 27)), '\s+\S*$', '');
      if char_length(v_cut) < 16 then v_cut := rtrim(left(v_title, 27)); end if;
      v_title := rtrim(v_cut, ' .,;:!?-') || '…';
    end if;
  end if;
  if char_length(v_body) > 72 then
    v_sentence := substring(v_body from '^.{30,71}[.!?]');
    if v_sentence is not null then
      v_body := btrim(v_sentence);
    else
      v_cut := regexp_replace(rtrim(left(v_body, 71)), '\s+\S*$', '');
      if char_length(v_cut) < 40 then v_cut := rtrim(left(v_body, 71)); end if;
      v_body := rtrim(v_cut, ' .,;:!?-') || '…';
    end if;
  end if;

  insert into public.notifications (
    to_user_id, to_role, icon, icon_bg, title, body, link_demand_id,
    event_type, read, created_by
  ) values (
    p_to_user_id, p_to_role, p_icon, p_icon_bg, v_title, v_body,
    p_link_demand_id, coalesce(nullif(p_event_type, ''), 'general'), false, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.create_notification(uuid,text,text,text,text,text,uuid,text) from public, anon;
grant execute on function public.create_notification(uuid,text,text,text,text,text,uuid,text) to authenticated;
