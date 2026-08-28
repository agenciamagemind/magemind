begin;

create or replace function public.admin_reorder_solutions(p_solution_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested integer;
  v_existing integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sessao invalida';
  end if;
  if not public.is_staff_admin() then
    raise exception 'Somente CEO ou Gerente podem ordenar solucoes';
  end if;

  v_requested := coalesce(cardinality(p_solution_ids), 0);
  if v_requested = 0 then return; end if;

  if (select count(distinct solution_id) from unnest(p_solution_ids) solution_id) <> v_requested then
    raise exception 'A lista de solucoes contem itens duplicados';
  end if;

  select count(*) into v_existing
  from public.plans p
  where p.id = any(p_solution_ids)
    and coalesce(p.is_custom, false) is false;

  if v_existing <> v_requested then
    raise exception 'Uma ou mais solucoes nao existem ou sao personalizadas';
  end if;

  update public.plans p
  set sort_order = ordered.position - 1,
      updated_at = now()
  from unnest(p_solution_ids) with ordinality as ordered(solution_id, position)
  where p.id = ordered.solution_id;
end;
$$;

revoke all on function public.admin_reorder_solutions(uuid[]) from public, anon;
grant execute on function public.admin_reorder_solutions(uuid[]) to authenticated;

alter table public.docs
  add column if not exists created_by uuid references auth.users(id) default auth.uid();

drop policy if exists docs_select_authorized on public.docs;
create policy docs_select_authorized
on public.docs for select to authenticated
using (
  public.is_staff_admin()
  or public.is_gestor()
  or public.is_editor()
  or (public.is_affiliate() and visibility in ('affiliate', 'public'))
  or (public.is_client() and (
    visibility = 'public'
    or client_id = public.my_client_id()
  ))
);

drop policy if exists docs_insert_operational_staff on public.docs;
create policy docs_insert_authorized
on public.docs for insert to authenticated
with check (
  public.is_staff_admin()
  or ((public.is_gestor() or public.is_editor()) and visibility <> 'restricted')
  or (
    public.is_client()
    and created_by = (select auth.uid())
    and client_id = public.my_client_id()
    and visibility = 'client'
  )
);

drop policy if exists docs_update_operational_staff on public.docs;
create policy docs_update_authorized
on public.docs for update to authenticated
using (
  public.is_staff_admin()
  or ((public.is_gestor() or public.is_editor()) and visibility <> 'restricted')
  or (
    public.is_client()
    and created_by = (select auth.uid())
    and client_id = public.my_client_id()
    and visibility = 'client'
  )
)
with check (
  public.is_staff_admin()
  or ((public.is_gestor() or public.is_editor()) and visibility <> 'restricted')
  or (
    public.is_client()
    and created_by = (select auth.uid())
    and client_id = public.my_client_id()
    and visibility = 'client'
  )
);

drop policy if exists docs_storage_select_secure on storage.objects;
create policy docs_storage_select_secure
on storage.objects for select to authenticated
using (
  bucket_id = 'magemind-docs'
  and exists (
    select 1
    from public.docs d
    where d.storage_path = storage.objects.name
      and (
        d.visibility <> 'restricted'
        or public.is_staff_admin()
        or (public.is_client() and d.client_id = public.my_client_id())
      )
  )
);

drop policy if exists docs_storage_insert_operational on storage.objects;
create policy docs_storage_insert_authorized
on storage.objects for insert to authenticated
with check (
  bucket_id = 'magemind-docs'
  and (
    public.is_operational_staff()
    or (public.is_client() and name like ('docs/' || (select auth.uid())::text || '\_%') escape '\')
  )
);

drop policy if exists docs_storage_update_operational on storage.objects;
create policy docs_storage_update_authorized
on storage.objects for update to authenticated
using (
  bucket_id = 'magemind-docs'
  and (
    public.is_operational_staff()
    or (public.is_client() and name like ('docs/' || (select auth.uid())::text || '\_%') escape '\')
  )
)
with check (
  bucket_id = 'magemind-docs'
  and (
    public.is_operational_staff()
    or (public.is_client() and name like ('docs/' || (select auth.uid())::text || '\_%') escape '\')
  )
);

drop policy if exists docs_storage_delete_operational on storage.objects;
create policy docs_storage_delete_authorized
on storage.objects for delete to authenticated
using (
  bucket_id = 'magemind-docs'
  and (
    public.is_operational_staff()
    or (public.is_client() and name like ('docs/' || (select auth.uid())::text || '\_%') escape '\')
  )
);

commit;
