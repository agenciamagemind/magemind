create table public.dashboard_appearance (
  user_id uuid primary key references auth.users on delete cascade,
  accent text not null check (accent in (
    'blue','cyan','green','lime','yellow','orange','pink','magenta','purple','white'
  ))
);

create table public.dashboard_backgrounds (
  user_id uuid not null references auth.users on delete cascade,
  section text not null check (section in ('dashboard','demands','campaigns','orders','affiliates')),
  object_path text not null,
  width integer not null check (width between 1 and 2304),
  height integer not null check (height between 1 and 2304),
  position_x numeric not null check (position_x between 0 and 100),
  position_y numeric not null check (position_y between 0 and 100),
  zoom numeric not null check (zoom between 1 and 3),
  shade text not null check (shade in ('weak','medium','strong')),
  revision uuid not null default gen_random_uuid(),
  primary key (user_id, section),
  check (object_path ~ (
    '^' || user_id::text || '/' || section || '/[a-f0-9-]{36}\.(webp|jpg)$'
  ))
);

alter table public.dashboard_appearance enable row level security;
alter table public.dashboard_backgrounds enable row level security;

revoke all on public.dashboard_appearance, public.dashboard_backgrounds from public, anon, authenticated;
grant select, insert, update on public.dashboard_appearance to authenticated;
grant select, insert, update, delete on public.dashboard_backgrounds to authenticated;
create policy appearance_self on public.dashboard_appearance
  to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy backgrounds_self on public.dashboard_backgrounds
  to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dashboard-backgrounds', 'dashboard-backgrounds', false, 3145728, array['image/webp','image/jpeg'])
on conflict (id) do nothing;

create policy dashboard_image_read on storage.objects for select to authenticated
  using (bucket_id = 'dashboard-backgrounds' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy dashboard_image_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dashboard-backgrounds'
    and name ~ ('^' || (select auth.uid())::text || '/(dashboard|demands|campaigns|orders|affiliates)/[a-f0-9-]{36}\.(webp|jpg)$')
  );
create policy dashboard_image_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dashboard-backgrounds' and split_part(name, '/', 1) = (select auth.uid())::text);
