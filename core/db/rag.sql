-- Yojana Darshak RAG store. Run once in Supabase → SQL Editor (safe to re-run).
-- Core talks to it over HTTPS (Supabase REST API) with the secret/service_role key, so it works on networks that block port 5432.

create extension if not exists vector;

create table if not exists rag_chunks (
  id text primary key,
  scheme_id text not null,
  tier text not null check (tier in ('tier1', 'extra')),
  title text not null,
  section text not null,
  lang text not null,
  source_url text not null,
  content text not null,
  content_hash text not null,
  embedding vector(1536) not null,
  updated_at timestamptz not null default now()
);

create index if not exists rag_chunks_embedding_idx on rag_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists rag_chunks_scheme_idx on rag_chunks (scheme_id);

-- RLS on with no policies: the public (anon) key can't read or write; the secret key bypasses RLS.
alter table rag_chunks enable row level security;

create or replace function match_rag_chunks(query_embedding vector(1536), scheme_filter text[] default null, match_count int default 4)
returns table (id text, scheme_id text, tier text, title text, section text, source_url text, content text, score float)
language sql stable
as $$
  select c.id, c.scheme_id, c.tier, c.title, c.section, c.source_url, c.content, 1 - (c.embedding <=> query_embedding) as score
  from rag_chunks c
  where scheme_filter is null or c.scheme_id = any(scheme_filter)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Only the server (secret key) may call it.
revoke execute on function match_rag_chunks(vector, text[], int) from public, anon, authenticated;
grant execute on function match_rag_chunks(vector, text[], int) to service_role;
