# Supabase

This workspace pins the [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase` dev dependency) and holds the database migrations in `migrations/`. A plain `npm install` at the repo root installs the CLI; run it via the scripts below or directly with `npx supabase <cmd>`.

## One-time setup

**1. Authenticate.** The CLI needs an access token before any remote command (this is why `link` fails with "Access token not provided"):

```bash
npx supabase login
```

This opens the browser to mint a personal access token. Alternatively, create a token at https://supabase.com/dashboard/account/tokens and export it:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
```

**2. Link the project.** `--project-ref` takes the project *ref* only — the subdomain of your project URL, **not** the full URL:

```bash
# Project URL: https://xiknowavzzppkcqxjddp.supabase.co  →  ref: xiknowavzzppkcqxjddp
npm run link -w @fydo/supabase -- --project-ref xiknowavzzppkcqxjddp
```

You'll be prompted for the database password (Dashboard → Settings → Database). The link is remembered in `.temp/` for subsequent commands.

## Migrations

| Command | What it does |
|---|---|
| `npm run db:push -w @fydo/supabase` | Apply pending `migrations/*.sql` to the linked project |
| `npm run migration:new -w @fydo/supabase -- <name>` | Create a new timestamped migration file |
| `npm run migration:list -w @fydo/supabase` | Show local vs remote migration status |
| `npm run db:diff -w @fydo/supabase` | Diff the database against local migrations |

The initial schema (`migrations/20260809000000_init.sql`) creates `repos`, `commit_analyses`, and `ai_reviews` with row-level security scoped to the signed-in user.

## Local stack (optional)

Requires Docker:

```bash
npm run start -w @fydo/supabase    # start local Supabase (db, auth, studio)
npm run status -w @fydo/supabase   # show local URLs and keys
npm run stop -w @fydo/supabase     # shut it down
npm run db:reset -w @fydo/supabase # recreate local db from migrations
```

## Type generation

Generate TypeScript types from the linked project's schema:

```bash
npm run gen:types -w @fydo/supabase > packages/web/src/database.types.ts
```

## Remember

- Enable the **GitHub auth provider** (Dashboard → Authentication → Providers) with a GitHub OAuth app's client id/secret — required for sign-in.
- The web app needs `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `packages/web/.env`; the server needs `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `packages/server/.env` (see the `.env.example` files).
