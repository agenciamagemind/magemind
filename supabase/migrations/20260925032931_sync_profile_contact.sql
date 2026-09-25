-- A client editing their own profile must update the client record atomically.
-- The trigger is private and only accepts the authenticated owner of the row.
create or replace function private.sync_own_client_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is distinct from new.id then
    return new;
  end if;

  if new.role = 'client' and new.client_id is not null then
    if new.phone is null or new.phone !~ '^[0-9]{10,15}$' then
      raise exception 'Informe um WhatsApp valido com 10 a 15 numeros.';
    end if;
    update public.clients
       set name = new.name,
           phone = new.phone
     where id = new.client_id;
    if not found then
      raise exception 'Cadastro de cliente nao encontrado.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_own_client_contact() from public, anon, authenticated;

drop trigger if exists profiles_sync_own_client_contact on public.profiles;
create trigger profiles_sync_own_client_contact
after update of name, phone on public.profiles
for each row
when (old.name is distinct from new.name or old.phone is distinct from new.phone)
execute function private.sync_own_client_contact();
