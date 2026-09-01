-- Telefones de cadastro passam a ser somente numericos. A validacao roda no
-- banco para proteger tambem chamadas feitas fora da interface web.
create or replace function public.guard_numeric_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_phone text := btrim(coalesce(new.phone, ''));
begin
  if tg_op = 'UPDATE' and new.phone is not distinct from old.phone then
    return new;
  end if;

  if tg_table_name = 'clients' and tg_op = 'INSERT' and v_phone = '' then
    raise exception 'Faltou informar o numero de WhatsApp do cliente.';
  end if;

  if v_phone <> '' and v_phone !~ '^[0-9]{10,15}$' then
    raise exception 'O WhatsApp deve conter somente de 10 a 15 numeros.';
  end if;

  new.phone := nullif(v_phone, '');
  return new;
end;
$$;

drop trigger if exists clients_guard_numeric_phone on public.clients;
create trigger clients_guard_numeric_phone
before insert or update of phone on public.clients
for each row execute function public.guard_numeric_phone();

drop trigger if exists profiles_guard_numeric_phone on public.profiles;
create trigger profiles_guard_numeric_phone
before insert or update of phone on public.profiles
for each row execute function public.guard_numeric_phone();

-- Remove apenas valores legados comprovadamente compostos por letras. Outros
-- telefones antigos ficam intactos ate serem corrigidos pelo responsavel.
update public.clients
set phone = null
where coalesce(phone, '') ~ '[[:alpha:]]';

update public.profiles
set phone = null, updated_at = now()
where coalesce(phone, '') ~ '[[:alpha:]]';
