# Database setup, migrations, backups

This is the authoritative reference for initializing WorkOps databases, applying migrations,
keeping them backed up, and upgrading safely. The self-hosted flow built on these primitives is
in [self-hosting.md](self-hosting.md); Vercel-specific wiring is in [vercel.md](vercel.md).

## Golden rules

1. **Schema changes only via Prisma migrations.** `prisma migrate deploy` is the *only* schema
   command ever allowed against a shared or production database.
2. **Never run** `prisma db push`, `prisma migrate reset`, or anything with `--force` against a
   shared database. These can silently drop and recreate tables — they do not reliably prompt
   before destroying data.
3. **Initialization is empty-only and explicit.** `db:setup` refuses any database that already
   contains tables and never drops anything.
4. **Backup first, verify the target second, write third.** No migration or upgrade on a shared
   database without a fresh, restore-tested backup and a double-checked `DATABASE_URL`.

## Choosing and creating a database

Pick an **explicit name and a dedicated, least-privilege user per environment** — e.g.
`workops_production`, `workops_staging`, `workops_preview_<id>`. Never point two environments at
one database.

- **Docker Compose:** set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` in `.env`
  **before the first** `docker compose up` — the `postgres:16` image creates them when the
  volume is first initialized. `DATABASE_URL` is derived for you. Selecting a new/different
  database = setting `POSTGRES_DB` (the empty-only guard in `db:setup` makes a wrong target
  fail loudly instead of writing somewhere unintended).
- **Managed providers:** create the database and user in the provider console, then use the
  PostgreSQL connection string with `?schema=public`. If your provider offers direct vs pooled
  endpoints, use the **direct** endpoint for migrations and the pooled endpoint (if any) for
  the app runtime.
- **Local development / e2e:** `npm run db:migrate:dev` and `npm run test:e2e` are guarded by
  `scripts/assert-local-database.ts` — localhost-only hosts, and e2e requires a database name
  ending in `_test`. These guards are a feature; do not bypass them.

## First-time initialization

The tooling classifies the target database before touching it:

| State | Meaning | Allowed action |
|---|---|---|
| `empty` | 0 tables in `public` | `db:setup` (after confirmation) |
| `existing-workops` | has `_prisma_migrations` | `db:deploy` only |
| `unknown-nonempty` | tables but no WorkOps history | **refused** — nothing written |

`npm run db:setup` (= `tsx scripts/setup/init-database.ts`):

1. Reads `DATABASE_URL` (env, then `.env.local`/`.env`).
2. Classifies the database (table above). Exit `2` for `existing-workops`, exit `3` for
   `unknown-nonempty`, exit `5` when `DATABASE_URL` is missing.
3. Asks for interactive confirmation (type `yes`). Non-TTY runs refuse unless
   `WORKOPS_DB_INIT_ON_BUILD=1` is set explicitly.
4. On an empty database only, runs `prisma migrate deploy` — the untouched, CI-verified
   historical migration chain. Creates schema; never drops.

Manual equivalent for a database you have **verified is empty**:
`npx prisma migrate deploy`.

## Ongoing migrations

- `npm run db:deploy` (= `prisma migrate deploy`) applies **pending** migrations only, in
  order, non-interactively; safe to re-run. This is the command for every deploy after the
  first.
- Apply migrations **before** rolling the new application version forward (compose upgrade
  order in [self-hosting.md](self-hosting.md); on Vercel, `WORKOPS_DB_MIGRATE_ON_BUILD=1` or an
  explicit step — see [vercel.md](vercel.md)).
- Developing schema changes: `npm run db:migrate:dev` (localhost-guarded), **read the generated
  SQL** in `prisma/migrations/`, then commit the migration files. Never edit a migration that
  has been applied anywhere.

## Pre-migration safety checklist (shared/production databases)

- [ ] `DATABASE_URL` points at the intended host **and** database (run `setup:verify` — it
      echoes a masked target).
- [ ] Fresh backup taken **and** restore-tested (see below).
- [ ] Read the pending migration SQL (`prisma/migrations/*`).
- [ ] No forbidden commands used anywhere in the flow (`db push`, `migrate reset`, `--force`,
      manual `DROP`/`TRUNCATE`).
- [ ] After deploying: `npm run setup:verify` reports the new migration count and no errors.

## Backups

An untested backup is not a backup — schedule restore drills.

**Docker Compose:**

```bash
# Dump (adjust user/db names to your .env)
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "workops-$(date +%F).sql"

# Scheduled (host cron, daily 02:30)
30 2 * * * cd /srv/workops && docker compose exec -T db pg_dump -U workops workops | gzip > /backups/workops-$(date +\%F).sql
```

Keep copies **off the database host**, prune old dumps deliberately, and periodically verify a
dump restores into a throwaway database:

```bash
createdb workops_restore_test -h 127.0.0.1 -U postgres
psql -h 127.0.0.1 -U postgres -d workops_restore_test < workops-2026-10-19.sql
```

**Managed providers:** enable automated backups and point-in-time recovery, and still export
periodic logical dumps — provider retention windows can be short.

## Upgrade runbook

1. Announce/stop writes if possible.
2. Fresh backup + restore test into a throwaway database.
3. Build the new images **without** touching the database
   (`docker compose build --pull`).
4. `docker compose run --rm tools npm run db:deploy` (pending-only).
5. `docker compose up -d` to roll the app forward; `setup:verify`.
6. Rollback: stop, restore the backup into a fresh database, repoint `DATABASE_URL`, start the
   previous image. Database rollbacks always come from the backup, not from ad-hoc SQL.

## Isolated previews

Previews (staging, PR environments, Vercel previews) are where databases get accidentally
shared — prevent that:

- **One throwaway database per preview**, named with the environment in it
  (`workops_preview_123`). Never a shared database, never production.
- Initialize with `db:setup` (previews are empty by definition) or a build gate scoped to the
  preview's own database — `WORKOPS_DB_INIT_ON_BUILD` only ever proceeds on an **empty**
  target, which is exactly the safety property you want here.
- In CI, keep the localhost/`_test` guards for anything automated
  (`scripts/assert-local-database.ts`).
- Destroy the database when the preview dies. No orphan data, no orphan cost.

## Troubleshooting

- **`P2022: column does not exist` at runtime** — the schema is out of sync with the code.
  Do **not** "repair" by resetting or regenerating anything. Back up, run
  `db:deploy`, and compare applied-migration counts via `setup:verify`.
- **`db:setup` exits `3` (unknown-nonempty)** — you are almost certainly pointed at the wrong
  `DATABASE_URL` (or someone else's database). Investigate before writing anything.
- **`setup:admin` exits `4`** — users already exist; the first-admin bootstrap is spent. Manage
  users in the app (Settings › team).
