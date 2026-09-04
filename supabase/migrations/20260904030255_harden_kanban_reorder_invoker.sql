begin;

-- RLS already expresses the same CEO/manager/gestor/editor/client boundaries
-- validated inside the function. Keep it as a second authorization layer and
-- avoid elevated privileges for a routine exposed through PostgREST.
alter function public.reorder_demands(text, uuid[])
  security invoker;

commit;
