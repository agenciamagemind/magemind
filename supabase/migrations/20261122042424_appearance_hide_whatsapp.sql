alter table public.dashboard_appearance
  alter column accent set default 'lime',
  add column hide_whatsapp boolean not null default false;
