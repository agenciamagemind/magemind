-- Ciclo de vida seguro para afiliados, comissoes e saques.
-- Mantem auditoria financeira ao arquivar contas e permite estorno formal
-- de um pagamento confirmado por engano antes de cancelar a venda de origem.

alter table public.profiles
  add column if not exists archived_at timestamptz;

alter table public.affiliate_commissions
  add column if not exists affiliate_name_snapshot text;

update public.affiliate_commissions c
set affiliate_name_snapshot = coalesce(p.name, 'Afiliado removido')
from public.profiles p
where p.id = c.affiliate_id
  and c.affiliate_name_snapshot is null;

update public.affiliate_commissions
set affiliate_name_snapshot = 'Afiliado removido'
where affiliate_name_snapshot is null;

alter table public.affiliate_commissions
  alter column affiliate_name_snapshot set not null;

create or replace function public.snapshot_affiliate_commission_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.affiliate_id is not null and (
    TG_OP = 'INSERT'
    or NEW.affiliate_id is distinct from OLD.affiliate_id
    or NEW.affiliate_name_snapshot is null
  ) then
    select p.name into NEW.affiliate_name_snapshot
    from public.profiles p where p.id = NEW.affiliate_id;
  elsif TG_OP = 'UPDATE' and NEW.affiliate_id is null and OLD.affiliate_id is not null then
    NEW.affiliate_name_snapshot := coalesce(OLD.affiliate_name_snapshot, 'Afiliado removido');
  end if;
  NEW.affiliate_name_snapshot := coalesce(NEW.affiliate_name_snapshot, 'Afiliado removido');
  return NEW;
end;
$$;

revoke all on function public.snapshot_affiliate_commission_identity() from public, anon, authenticated;
drop trigger if exists trg_snapshot_affiliate_commission_identity on public.affiliate_commissions;
create trigger trg_snapshot_affiliate_commission_identity
  before insert or update of affiliate_id, affiliate_name_snapshot
  on public.affiliate_commissions
  for each row execute function public.snapshot_affiliate_commission_identity();

-- Desvincular um afiliado arquivado nao deve reescrever comissoes historicas.
-- Trocar um afiliado por outro continua recalculando as vendas fechadas.
create or replace function public.sync_client_affiliate_commissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.affiliate_id is distinct from NEW.affiliate_id
     and NEW.affiliate_id is not null then
    update public.sales s
      set value = s.value
      where s.client_id = NEW.id and s.status = 'Fechado';
  end if;
  return NEW;
end;
$$;
revoke all on function public.sync_client_affiliate_commissions() from public, anon, authenticated;

alter table public.affiliate_withdrawals
  drop constraint if exists affiliate_withdrawals_status_check;
alter table public.affiliate_withdrawals
  add constraint affiliate_withdrawals_status_check
  check (status in ('pending','approved','paid','rejected','cancelled','reversed'));

alter table public.affiliate_withdrawal_events
  drop constraint if exists affiliate_withdrawal_events_event_type_check;
alter table public.affiliate_withdrawal_events
  add constraint affiliate_withdrawal_events_event_type_check
  check (event_type in ('requested','approved','paid','rejected','cancelled','reversed'));

create or replace function public.reverse_affiliate_withdrawal(
  p_withdrawal_id uuid,
  p_reason text
)
returns public.affiliate_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_row public.affiliate_withdrawals%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then raise exception 'Sessao invalida'; end if;
  select p.role into v_role
  from public.profiles p
  where p.id = v_uid and p.active is true and p.archived_at is null;
  if v_role not in ('ceo','manager') then
    raise exception 'Somente CEO ou Gerente podem estornar pagamentos';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Informe o motivo do estorno (3 a 500 caracteres)';
  end if;

  select * into v_row
  from public.affiliate_withdrawals w
  where w.id = p_withdrawal_id
  for update;
  if not found then raise exception 'Solicitacao nao encontrada'; end if;
  if v_row.status <> 'paid' then
    raise exception 'Somente pagamentos confirmados podem ser estornados';
  end if;
  if v_row.affiliate_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_row.affiliate_id::text, 9173));
  end if;

  update public.affiliate_withdrawals
  set status = 'reversed',
      admin_note = v_reason,
      updated_at = now()
  where id = p_withdrawal_id
  returning * into v_row;

  insert into public.affiliate_withdrawal_events(
    withdrawal_id, actor_id, event_type, from_status, to_status, details
  ) values (
    v_row.id, v_uid, 'reversed', 'paid', 'reversed', jsonb_build_object('reason', v_reason)
  );
  return v_row;
end;
$$;

revoke all on function public.reverse_affiliate_withdrawal(uuid,text) from public, anon;
grant execute on function public.reverse_affiliate_withdrawal(uuid,text) to authenticated;

comment on column public.profiles.archived_at is
  'Conta removida da operacao, preservada apenas quando existe historico financeiro.';
comment on column public.affiliate_commissions.affiliate_name_snapshot is
  'Nome imutavel para auditoria quando o perfil do afiliado for arquivado ou removido.';

