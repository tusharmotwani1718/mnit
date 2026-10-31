-- Yojana Darshak citizen accounts. Run once in Supabase → SQL Editor (safe to re-run).
-- Core reads and writes these over HTTPS with the secret key; RLS with no policies keeps the anon key out.

create table if not exists profiles (
  phone text primary key check (phone ~ '^\+91[6-9][0-9]{9}$'),
  name text,
  lang text not null default 'hi' check (lang in ('hi', 'mr', 'en')),
  facts jsonb not null default '{}'::jsonb,
  consent_at timestamptz,
  password_hash text,
  documents jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;
-- Added for password login (for tables created before it existed).
alter table profiles add column if not exists password_hash text;
alter table profiles add column if not exists documents jsonb not null default '[]'::jsonb;

-- One row per phone: the latest code (hashed) plus send counters for rate limiting.
create table if not exists otp_codes (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  send_count int not null default 0,
  window_start timestamptz not null default now(),
  last_sent_at timestamptz not null default now()
);
alter table otp_codes enable row level security;
