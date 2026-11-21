create function private.guard_client_demand_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.current_user_role() = 'client' then
    if tg_op = 'INSERT' then
      new.status := 'Não iniciado';
    elsif new.status is distinct from old.status then
      raise exception 'A equipe de produção é responsável pelo status da demanda.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_client_demand_status() from public, anon, authenticated;

create trigger aa_guard_client_demand_status
  before insert or update of status on public.demands
  for each row execute function private.guard_client_demand_status();
