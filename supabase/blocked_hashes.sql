-- Abuse blocklist for community reports / type votes.
-- Apply with the Supabase SQL editor or CLI.
-- Browser clients never talk to this table — only the service-role API.

create table if not exists public.blocked_hashes (
  client_hash text primary key
);

-- Also store IP hashes alongside install hashes on vote tables so two votes
-- count as separate only when BOTH install and IP hashes differ.
alter table public.parking_reports
  add column if not exists ip_hash text;

alter table public.parking_type_votes
  add column if not exists ip_hash text;

create index if not exists parking_reports_ip_hash_created_at_idx
  on public.parking_reports (ip_hash, created_at desc);

create index if not exists parking_type_votes_ip_hash_created_at_idx
  on public.parking_type_votes (ip_hash, created_at desc);

-- RLS on, zero policies → anon/authenticated cannot read or write.
-- Service role bypasses RLS for /api/reports and /api/type-votes.
alter table public.blocked_hashes enable row level security;

revoke all on table public.blocked_hashes from anon, authenticated;
