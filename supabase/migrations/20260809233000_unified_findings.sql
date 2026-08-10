-- Unified finding model: manual triage overrides + wipe of pre-unified dev data.
-- Old rows store the retired pass/warn/fail status vocabulary and unstructured
-- AI observations; dev data is disposable, so users simply re-onboard.

truncate table public.repos cascade;

create table public.finding_overrides (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos (id) on delete cascade,
  sha text not null,
  finding_id text not null,
  status text not null check (status in ('open', 'dismissed', 'resolved')),
  note text,
  updated_at timestamptz not null default now(),
  unique (repo_id, finding_id)
);

create index finding_overrides_repo_idx on public.finding_overrides (repo_id);

alter table public.finding_overrides enable row level security;

create policy "Users manage finding overrides of their own repos"
  on public.finding_overrides
  for all
  using (exists (select 1 from public.repos r where r.id = repo_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.repos r where r.id = repo_id and r.user_id = auth.uid()));
