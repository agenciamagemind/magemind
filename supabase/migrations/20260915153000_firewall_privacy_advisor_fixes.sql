-- Finish the firewall privacy hardening after production data verification.
-- Invalid historical snapshots are discarded rather than retained as PII.
update public.security_access_logs
set email_snapshot = null
where email_snapshot is not null
  and email_snapshot !~ '^[^@]\*\*\*@[^@]+$';

-- Supports the foreign key and CEO audit queries without sequential scans.
create index if not exists security_blocked_ips_created_by_idx
  on public.security_blocked_ips (created_by);
