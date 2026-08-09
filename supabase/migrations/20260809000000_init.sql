-- Fydo initial schema: user-scoped repo setup, commit analyses, and AI reviews.
-- The dependency graph itself lives in Neo4j; Supabase stores account data.

create table public.repos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  full_name text not null,
  default_branch text not null,
  selected_branches text[] not null default '{}',
  framework text not null default 'owasp-top-10-2021',
  graph_ingested_sha text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, full_name)
);

create table public.commit_analyses (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos (id) on delete cascade,
  sha text not null,
  branch text not null,
  status text not null,
  message text not null default '',
  author text not null default '',
  author_avatar text,
  committed_at timestamptz,
  url text not null default '',
  files_changed integer not null default 0,
  additions integer not null default 0,
  deletions integer not null default 0,
  findings jsonb not null default '[]'::jsonb,
  report jsonb,
  created_at timestamptz not null default now(),
  unique (repo_id, branch, sha)
);

create index commit_analyses_repo_recent_idx
  on public.commit_analyses (repo_id, committed_at desc);

create table public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos (id) on delete cascade,
  sha text not null,
  review jsonb not null,
  model text not null default '',
  reviewed_at timestamptz not null default now(),
  unique (repo_id, sha)
);

create index ai_reviews_repo_idx on public.ai_reviews (repo_id);

alter table public.repos enable row level security;
alter table public.commit_analyses enable row level security;
alter table public.ai_reviews enable row level security;

create policy "Users manage their own repos"
  on public.repos
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users manage analyses of their own repos"
  on public.commit_analyses
  for all
  using (exists (select 1 from public.repos r where r.id = repo_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.repos r where r.id = repo_id and r.user_id = auth.uid()));

create policy "Users manage AI reviews of their own repos"
  on public.ai_reviews
  for all
  using (exists (select 1 from public.repos r where r.id = repo_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.repos r where r.id = repo_id and r.user_id = auth.uid()));
