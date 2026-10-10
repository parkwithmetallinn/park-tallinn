-- Crowdsourced unknown-parking type votes + verified results.
-- Run in Supabase SQL editor (service role already used by API).

create table if not exists public.parking_type_votes (
  id bigserial primary key,
  parking_id text not null,
  proposed_type text not null check (proposed_type in ('FREE', 'TIMED', 'PAID')),
  client_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists parking_type_votes_parking_created_idx
  on public.parking_type_votes (parking_id, created_at desc);

create index if not exists parking_type_votes_hash_created_idx
  on public.parking_type_votes (client_hash, created_at desc);

create table if not exists public.parking_type_verified (
  parking_id text primary key,
  verified_type text not null check (verified_type in ('FREE', 'TIMED', 'PAID')),
  vote_count int not null default 2,
  verified_at timestamptz not null default now()
);

-- Optional: block anon/authenticated; API uses service role.
alter table public.parking_type_votes enable row level security;
alter table public.parking_type_verified enable row level security;
