begin;

alter function public.admin_reorder_solutions(uuid[]) security invoker;

create index if not exists docs_created_by_idx
  on public.docs(created_by)
  where created_by is not null;

commit;
