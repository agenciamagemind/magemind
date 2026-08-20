create index if not exists affiliate_withdrawal_events_actor_idx
  on public.affiliate_withdrawal_events (actor_id)
  where actor_id is not null;

