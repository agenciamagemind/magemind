-- Gestor and Editor manage operational documents for any client, while the
-- restricted visibility remains exclusive to CEO and Manager.

begin;

drop policy if exists docs_select_authorized on public.docs;
create policy docs_select_authorized
on public.docs for select to authenticated
using (
  public.is_staff_admin()
  or ((public.is_gestor() or public.is_editor()) and visibility <> 'restricted')
  or (public.is_affiliate() and visibility in ('affiliate', 'public'))
  or (public.is_client() and (
    visibility = 'public'
    or (visibility = 'client' and client_id = public.my_client_id())
  ))
);

drop policy if exists docs_insert_company_admin on public.docs;
drop policy if exists docs_insert_operational_staff on public.docs;
create policy docs_insert_operational_staff
on public.docs for insert to authenticated
with check (
  public.is_staff_admin()
  or ((public.is_gestor() or public.is_editor()) and visibility <> 'restricted')
);

drop policy if exists docs_update_company_admin on public.docs;
drop policy if exists docs_update_operational_staff on public.docs;
create policy docs_update_operational_staff
on public.docs for update to authenticated
using (
  public.is_staff_admin()
  or ((public.is_gestor() or public.is_editor()) and visibility <> 'restricted')
)
with check (
  public.is_staff_admin()
  or ((public.is_gestor() or public.is_editor()) and visibility <> 'restricted')
);

-- Document deletion remains an administrative operation.

drop policy if exists docs_storage_insert_secure on storage.objects;
drop policy if exists docs_storage_insert_operational on storage.objects;
create policy docs_storage_insert_operational
on storage.objects for insert to authenticated
with check (bucket_id = 'magemind-docs' and public.is_operational_staff());

drop policy if exists docs_storage_update_secure on storage.objects;
drop policy if exists docs_storage_update_operational on storage.objects;
create policy docs_storage_update_operational
on storage.objects for update to authenticated
using (bucket_id = 'magemind-docs' and public.is_operational_staff())
with check (bucket_id = 'magemind-docs' and public.is_operational_staff());

drop policy if exists docs_storage_delete_secure on storage.objects;
drop policy if exists docs_storage_delete_operational on storage.objects;
create policy docs_storage_delete_operational
on storage.objects for delete to authenticated
using (bucket_id = 'magemind-docs' and public.is_operational_staff());

commit;
