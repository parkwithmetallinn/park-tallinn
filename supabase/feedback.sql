-- Central feedback inbox for NEW_PARKING / WRONG_DATA / ABUSE_REPORT.
-- Apply with the Supabase SQL editor or CLI.
-- Browser clients never talk to this table — only the service-role API.

create table if not exists public.parking_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null
    check (type in ('NEW_PARKING', 'WRONG_DATA', 'ABUSE_REPORT')),
  parking_id text null,
  lat double precision null,
  lng double precision null,
  note text not null default ''
    check (char_length(note) <= 200),
  client_hash text not null,
  status text not null default 'NEW'
    check (status in ('NEW', 'DONE', 'REJECTED'))
);

create index if not exists parking_feedback_created_at_idx
  on public.parking_feedback (created_at desc);

create index if not exists parking_feedback_client_hash_created_at_idx
  on public.parking_feedback (client_hash, created_at desc);

create index if not exists parking_feedback_status_created_at_idx
  on public.parking_feedback (status, created_at desc);

-- RLS on, zero policies → anon/authenticated cannot read or write.
-- Service role bypasses RLS for /api/feedback.
alter table public.parking_feedback enable row level security;

-- Optional: revoke broad grants (service role still has full access).
revoke all on table public.parking_feedback from anon, authenticated;

/**
 * Delete feedback rows older than 180 days.
 * Returns the number of deleted rows.
 * Call from a scheduler or /api/cleanup (service role).
 */
create or replace function public.cleanup_old_parking_feedback()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.parking_feedback
  where created_at < now() - interval '180 days';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.cleanup_old_parking_feedback() from public;
grant execute on function public.cleanup_old_parking_feedback() to service_role;
