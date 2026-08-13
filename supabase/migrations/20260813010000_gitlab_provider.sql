-- Multi-provider support: repos can now come from GitLab (public projects).
-- Existing rows are all GitHub; identity becomes (user, provider, full_name)
-- since the same path could exist on both hosts.

alter table public.repos
  add column provider text not null default 'github'
  check (provider in ('github', 'gitlab'));

alter table public.repos
  drop constraint repos_user_id_full_name_key;

alter table public.repos
  add constraint repos_user_id_provider_full_name_key
  unique (user_id, provider, full_name);
