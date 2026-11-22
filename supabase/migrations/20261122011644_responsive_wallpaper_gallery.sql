alter table public.dashboard_backgrounds
  alter column object_path drop not null,
  add column preset_id smallint,
  add column background_disabled boolean not null default false,
  add column mobile_zoom numeric,
  add column mobile_position_x numeric,
  add column mobile_position_y numeric,
  add constraint dashboard_background_preset_range check (preset_id between 1 and 46),
  add constraint dashboard_background_source check (
    num_nonnulls(object_path, preset_id) = case when background_disabled then 0 else 1 end
  ),
  add constraint dashboard_background_mobile_crop check (
    num_nonnulls(mobile_zoom, mobile_position_x, mobile_position_y) = 0
    or (
      num_nonnulls(mobile_zoom, mobile_position_x, mobile_position_y) = 3
      and mobile_zoom between 1 and 3
      and mobile_position_x between 0 and 100
      and mobile_position_y between 0 and 100
    )
  );
