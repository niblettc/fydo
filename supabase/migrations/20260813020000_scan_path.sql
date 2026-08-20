-- Optional directory scope per project: monorepos with multiple products can
-- limit scanning (commit analysis + dependency graph) to one directory.
-- Null means the whole repository is scanned.

alter table public.repos
  add column scan_path text;
