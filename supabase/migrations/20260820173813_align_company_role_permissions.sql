-- Magemind company authorization matrix.
-- CEO: unrestricted company administration (the CEO account itself is protected).
-- Manager: same company access as CEO, except changing/removing the CEO.
-- Gestor: operational leadership for demands and Editor accounts.
-- Editor: complete demand operations, without customer/financial/admin data.

begin;

-- ---------------------------------------------------------------------------
-- Canonical role helpers and profile hierarchy.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select role in ('ceo', 'manager') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_manage_user(target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text := public.current_user_role();
  target_role text;
  target_email text;
begin
  select role, email into target_role, target_email
  from public.profiles where id = target_user_id;

  if target_role is null
     or target_role = 'ceo'
     or lower(coalesce(target_email, '')) = lower('ogabrielmrossi@gmail.com') then
    return false;
  end if;

  if actor_role in ('ceo', 'manager') then
    return true;
  end if;

  return actor_role = 'gestor' and target_role = 'editor';
end;
$$;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
begin
  -- Admin API, Auth cascades and other trusted server operations have no end-user uid.
  if actor_id is null then
    return new;
  end if;

  select role into actor_role from public.profiles where id = actor_id;

  -- Every user may update only presentation/contact fields on their own profile.
  if actor_id = old.id then
    if new.role is distinct from old.role
       or new.email is distinct from old.email
       or new.client_id is distinct from old.client_id
       or new.active is distinct from old.active
       or new.commission_rate is distinct from old.commission_rate then
      raise exception 'Campos privilegiados do próprio perfil não podem ser alterados.';
    end if;
    return new;
  end if;

  -- There is one CEO and the account is immutable to every other user.
  if old.role = 'ceo' or new.role = 'ceo'
     or lower(coalesce(old.email, '')) = lower('ogabrielmrossi@gmail.com') then
    raise exception 'O perfil do CEO é protegido.';
  end if;

  if actor_role in ('ceo', 'manager') then
    return new;
  end if;

  -- Gestor may maintain an Editor, but cannot change the Editor's authority.
  if actor_role = 'gestor' and old.role = 'editor' and new.role = 'editor'
     and new.email is not distinct from old.email
     and new.client_id is not distinct from old.client_id
     and new.commission_rate is not distinct from old.commission_rate then
    return new;
  end if;

  raise exception 'Você não tem permissão para alterar este perfil.';
end;
$$;

create or replace function public.set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() not in ('ceo', 'manager') then
    raise exception 'Somente CEO ou Gerente podem alterar cargos.';
  end if;
  if new_role not in ('manager', 'gestor', 'editor', 'affiliate', 'client') then
    raise exception 'Cargo inválido: %', new_role;
  end if;
  if not public.can_manage_user(target_user_id) then
    raise exception 'Você não tem permissão para alterar este usuário.';
  end if;

  update public.profiles
  set role = new_role, updated_at = now()
  where id = target_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Demand authority. Internal FK cascades must not be mistaken for user edits.
-- ---------------------------------------------------------------------------

create or replace function public.protect_demand_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.assignee_id is distinct from old.assignee_id
     and public.current_user_role() not in ('ceo', 'manager', 'gestor', 'editor') then
    raise exception 'Somente a equipe operacional pode alterar o responsável pela demanda.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_demand_client()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.client_id is distinct from old.client_id
     and public.current_user_role() not in ('ceo', 'manager', 'gestor', 'editor') then
    raise exception 'Somente a equipe operacional pode alterar o cliente da demanda.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_demand_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif new.created_by is distinct from old.created_by then
    raise exception 'O autor original da demanda não pode ser alterado.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_demand_audit on public.demands;
create trigger trg_guard_demand_audit
before insert or update on public.demands
for each row execute function public.guard_demand_audit();

-- Removing an Affiliate must not erase historical financial records.
alter table public.affiliate_commissions alter column affiliate_id drop not null;
alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_affiliate_id_fkey;
alter table public.affiliate_commissions
  add constraint affiliate_commissions_affiliate_id_fkey
  foreign key (affiliate_id) references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Remove the accumulated legacy/duplicate policies and rebuild one matrix.
-- ---------------------------------------------------------------------------

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'activity', 'affiliate_commissions', 'client_plans', 'clients',
        'comments', 'demands', 'docs', 'notifications', 'plans', 'profiles', 'sales'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;

alter table public.activity enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.client_plans enable row level security;
alter table public.clients enable row level security;
alter table public.comments enable row level security;
alter table public.demands enable row level security;
alter table public.docs enable row level security;
alter table public.notifications enable row level security;
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.sales enable row level security;

revoke all on table public.activity, public.affiliate_commissions,
  public.client_plans, public.clients, public.comments, public.demands,
  public.docs, public.notifications, public.plans, public.profiles, public.sales
from anon;

revoke all on table public.activity, public.affiliate_commissions,
  public.client_plans, public.clients, public.comments, public.demands,
  public.docs, public.notifications, public.plans, public.profiles, public.sales
from authenticated;

grant select, insert on public.activity to authenticated;
grant select, insert, update, delete on public.affiliate_commissions to authenticated;
grant select, insert, update, delete on public.client_plans to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, delete on public.comments to authenticated;
grant select, insert, update, delete on public.demands to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select, insert, update on public.notifications to authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.sales to authenticated;

-- Activity
create policy activity_select_company_admin
on public.activity for select to authenticated
using (public.is_staff_admin());

create policy activity_insert_operational
on public.activity for insert to authenticated
with check (public.is_operational_staff() and created_by = (select auth.uid()));

-- Affiliate commissions
create policy commissions_select_authorized
on public.affiliate_commissions for select to authenticated
using (public.is_staff_admin() or (public.is_affiliate() and affiliate_id = (select auth.uid())));

create policy commissions_insert_company_admin
on public.affiliate_commissions for insert to authenticated
with check (public.is_staff_admin());

create policy commissions_update_company_admin
on public.affiliate_commissions for update to authenticated
using (public.is_staff_admin()) with check (public.is_staff_admin());

create policy commissions_delete_company_admin
on public.affiliate_commissions for delete to authenticated
using (public.is_staff_admin());

-- Client plans
create policy client_plans_select_authorized
on public.client_plans for select to authenticated
using (
  public.is_staff_admin()
  or (public.is_affiliate() and exists (
    select 1 from public.clients c where c.id = client_id and c.affiliate_id = (select auth.uid())
  ))
  or (public.is_client() and client_id = public.my_client_id())
);

create policy client_plans_insert_company_admin
on public.client_plans for insert to authenticated with check (public.is_staff_admin());
create policy client_plans_update_company_admin
on public.client_plans for update to authenticated
using (public.is_staff_admin()) with check (public.is_staff_admin());
create policy client_plans_delete_company_admin
on public.client_plans for delete to authenticated using (public.is_staff_admin());

-- Clients: operational users consume only the safe directory view below.
create policy clients_select_authorized
on public.clients for select to authenticated
using (
  public.is_staff_admin()
  or (public.is_affiliate() and affiliate_id = (select auth.uid()))
  or (public.is_client() and id = public.my_client_id())
);

create policy clients_insert_company_admin
on public.clients for insert to authenticated
with check (public.is_staff_admin());

create policy clients_update_company_admin
on public.clients for update to authenticated
using (public.is_staff_admin()) with check (public.is_staff_admin());

-- Comments
create policy comments_select_related_demand
on public.comments for select to authenticated
using (exists (
  select 1 from public.demands d
  where d.id = demand_id
    and (
      public.is_operational_staff()
      or (public.is_client() and d.client_id = public.my_client_id())
    )
));

create policy comments_insert_related_demand
on public.comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.demands d
    where d.id = demand_id
      and (
        public.is_operational_staff()
        or (public.is_client() and d.client_id = public.my_client_id())
      )
  )
);

create policy comments_delete_author_or_admin
on public.comments for delete to authenticated
using (public.is_staff_admin() or author_id = (select auth.uid()));

-- Demands: Editor has complete operational authority, but no financial/client table access.
create policy demands_select_authorized
on public.demands for select to authenticated
using (
  public.is_operational_staff()
  or (public.is_client() and client_id = public.my_client_id())
);

create policy demands_insert_operational
on public.demands for insert to authenticated
with check (public.is_operational_staff());

create policy demands_update_operational
on public.demands for update to authenticated
using (public.is_operational_staff()) with check (public.is_operational_staff());

create policy demands_delete_operational
on public.demands for delete to authenticated
using (public.is_operational_staff());

-- Documents: Editor is intentionally excluded; Gestor retains internal read access.
create policy docs_select_authorized
on public.docs for select to authenticated
using (
  public.is_staff_admin()
  or (public.is_gestor() and visibility in ('internal', 'public'))
  or (public.is_affiliate() and visibility in ('affiliate', 'public'))
  or (public.is_client() and (
    visibility = 'public' or (visibility = 'client' and client_id = public.my_client_id())
  ))
);

create policy docs_insert_company_admin
on public.docs for insert to authenticated with check (public.is_staff_admin());
create policy docs_update_company_admin
on public.docs for update to authenticated
using (public.is_staff_admin()) with check (public.is_staff_admin());
create policy docs_delete_company_admin
on public.docs for delete to authenticated using (public.is_staff_admin());

-- Notifications
create policy notifications_select_recipient
on public.notifications for select to authenticated
using (
  to_user_id = (select auth.uid())
  or (to_role = 'admin' and public.is_operational_staff())
);

create policy notifications_insert_attributed
on public.notifications for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (public.is_operational_staff() and (to_user_id is not null or to_role = 'admin'))
    or (not public.is_operational_staff() and to_user_id is null and to_role = 'admin')
  )
);

create policy notifications_update_recipient
on public.notifications for update to authenticated
using (
  to_user_id = (select auth.uid())
  or (to_role = 'admin' and public.is_operational_staff())
)
with check (
  to_user_id = (select auth.uid())
  or (to_role = 'admin' and public.is_operational_staff())
);

-- Plans and financial data are not exposed to Gestor/Editor.
create policy plans_select_business_roles
on public.plans for select to authenticated
using (public.is_staff_admin() or public.is_affiliate() or public.is_client());

create policy plans_insert_company_admin
on public.plans for insert to authenticated with check (public.is_staff_admin());
create policy plans_update_company_admin
on public.plans for update to authenticated
using (public.is_staff_admin()) with check (public.is_staff_admin());
create policy plans_delete_company_admin
on public.plans for delete to authenticated using (public.is_staff_admin());

-- Profiles: Editor sees only self. Gestor sees self and Editors it manages.
create policy profiles_select_authorized
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or public.is_staff_admin()
  or (public.is_gestor() and role = 'editor')
);

create policy profiles_update_authorized
on public.profiles for update to authenticated
using (id = (select auth.uid()) or public.can_manage_user(id))
with check (id = (select auth.uid()) or public.can_manage_user(id));

-- Sales
create policy sales_select_authorized
on public.sales for select to authenticated
using (
  public.is_staff_admin()
  or (public.is_affiliate() and exists (
    select 1 from public.clients c where c.id = client_id and c.affiliate_id = (select auth.uid())
  ))
  or (public.is_client() and client_id = public.my_client_id())
);

create policy sales_insert_company_admin
on public.sales for insert to authenticated with check (public.is_staff_admin());
create policy sales_update_company_admin
on public.sales for update to authenticated
using (public.is_staff_admin()) with check (public.is_staff_admin());
create policy sales_delete_company_admin
on public.sales for delete to authenticated using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- Deliberately narrow directories for demand screens.
-- These views expose names/avatars only; client contacts and company data stay hidden.
-- ---------------------------------------------------------------------------

drop view if exists public.demand_client_directory;
create view public.demand_client_directory
with (security_barrier = true)
as
select c.id, c.name, c.converted_to_team
from public.clients c
where (
  public.current_user_role() in ('ceo', 'manager', 'gestor', 'editor')
  or (public.is_client() and c.id = public.my_client_id())
);

drop view if exists public.demand_team_directory;
create view public.demand_team_directory
with (security_barrier = true)
as
select p.id, p.name, p.role, p.av, p.photo, p.active
from public.profiles p
where p.role in ('ceo', 'manager', 'gestor', 'editor')
  and (
    public.current_user_role() in ('ceo', 'manager', 'gestor', 'editor')
    or (
      public.is_client()
      and exists (
        select 1 from public.demands d
        where d.client_id = public.my_client_id() and d.assignee_id = p.id
      )
    )
  );

revoke all on public.demand_client_directory, public.demand_team_directory from public, anon;
grant select on public.demand_client_directory, public.demand_team_directory to authenticated;

-- Trigger-only functions must never be callable as RPC endpoints.
revoke execute on function public.guard_demand_audit() from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
revoke execute on function public.protect_demand_assignee() from public, anon, authenticated;
revoke execute on function public.protect_demand_client() from public, anon, authenticated;

commit;



