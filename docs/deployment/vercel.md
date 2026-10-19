# Deploying to Vercel

> **Verification:** the production build entry was rehearsed locally on empty PostgreSQL,
> including migrations, first-admin/OWNER workspace bootstrap and a successful Next.js build.
> It has **not** been validated end-to-end on a real Vercel project. This is not a
> zero-configuration hosting service. The explicit first-install flags below allow schema
> initialization and administrator creation in one deployment. Rehearse against a disposable database before relying
> on it, and treat the verification checklist at the bottom as the definition of "done".

Vercel hosts the Next.js app; PostgreSQL stays on a managed provider you control. The build
entry point is `npm run vercel-build`, which is **exactly `next build`** unless you explicitly
opt in to database work with the setup gates below — a build never touches a database
implicitly.

## Prerequisites

- The repository accessible to Vercel (GitHub import).
- Managed PostgreSQL 16 **with automated backups** (see [database.md](database.md)). Migrations
  need a direct TCP connection from the build; use a direct/non-pooled endpoint for migrations
  if your provider distinguishes pooled vs direct.
- Node 22 (`package.json` requires `>=22.0.0`).

## 1. Create the database explicitly

Create a dedicated database and least-privilege user (naming and guardrails:
[database.md](database.md)). Never reuse your local compose database, and never point a
preview at the production database.

## 2. Import the project

1. Vercel → *Add New* → *Project* → import the repo. Next.js is auto-detected.
2. **Build command:** `vercel.json` selects `npm run vercel-build` and `npm ci` for you.
3. Install command: leave the default `npm ci` (its `postinstall` runs `prisma generate`).
4. Do **not** set `NEXT_OUTPUT_STANDALONE` on Vercel — that flag is a Docker-only opt-in.

## 3. Environment variables

Set in Project → Settings → Environment Variables.

**Required:**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, `?schema=public`. Treated as a secret. |
| `AUTH_SECRET` | `openssl rand -base64 32`. Rotating it invalidates all sessions. |
| `NEXTAUTH_URL` | Your public URL (e.g. `https://workops.example.com`). Required in production. |
| `AUTH_TRUST_HOST` | Set `true` — the app runs behind Vercel's proxy. |
| `COMMUNICATION_INTERNAL_DOMAINS` | Comma-separated internal email domains. Fail-closed: absent/empty disables those features. |

**Optional integrations** (unset = feature off): `RESEND_API_KEY` + `EMAIL_FROM`,
`GLM_API_KEY`, `CRON_SECRET`, `SABAH_CREDENTIAL_KEY`, `WEB_PUSH_VAPID_*`, `AZURE_AD_*`.
Full reference: [configuration](../configuration.md).

**Build gates** — set per-environment (Production vs Preview), never globally:

| Variable | Effect |
|---|---|
| `WORKOPS_DB_INIT_ON_BUILD=1` | Before building: initialize an **EMPTY** target database. Known WorkOps installs are skipped; unknown non-empty schemas abort the build. Intended for the **first-ever** deploy into a database you explicitly created; remove it afterwards. |
| `WORKOPS_DB_MIGRATE_ON_BUILD=1` | Before building: `prisma migrate deploy` (pending-only). Failing migrations **abort the build**. Enable only for environments that **own** their database — never on previews that could see production data. |
| `WORKOPS_BOOTSTRAP_ADMIN_ON_BUILD=1` | Creates the first verified active administrator and its OWNER workspace membership. Requires `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` (12+ characters, letters and digits); `ADMIN_NAME` is optional. Existing users are skipped, never overwritten. |

For one-deployment setup, enable `WORKOPS_DB_INIT_ON_BUILD=1` and `WORKOPS_BOOTSTRAP_ADMIN_ON_BUILD=1` on **Production only**, then deploy. After signing in, disable both first-install flags and remove `ADMIN_PASSWORD` from the platform settings. The canonical origin falls back to Vercel's real production alias when `APP_BASE_URL` and `NEXTAUTH_URL` are unset; enable access to Vercel's system environment variables. Set explicit final URLs for custom domains, email and OAuth.

Unknown non-empty schemas abort initialization. A known existing WorkOps installation may skip initial setup. Preview builds refuse setup flags entirely; initialize a separate, disposable preview database explicitly instead. Preview pages are `noindex` and have an empty sitemap.

## 4. Migrations in practice

Two acceptable patterns; pick one and be consistent:

- **Build-gated (simple):** set `WORKOPS_DB_MIGRATE_ON_BUILD=1` on the Production environment
  only. Each production build applies pending migrations before compiling. Previews stay
  gate-free and never touch a shared database.
- **Explicit (more control):** leave the gate off; after a verified backup, run
  `DATABASE_URL=... npm run db:deploy` from your machine or CI right before deploying. Backup
  → deploy → verify is the runbook in [database.md](database.md).

## 5. First admin

The build-time bootstrap above avoids a separate terminal step. Alternatively, after the schema exists, bootstrap
from a trusted terminal explicitly pointed at your selected database:

```bash
DATABASE_URL="postgresql://..." npm run setup:admin
```

- Interactive: hidden password prompt (min 12 chars, letters + digits).
- Non-interactive: set `ADMIN_EMAIL`, `ADMIN_NAME` (optional) and `ADMIN_PASSWORD` instead.
- Refuses (exit `4`) if any user already exists; the password is never printed or logged.

## 6. Cron jobs

`/api/cron/*` endpoints require `Authorization: Bearer $CRON_SECRET`. `vercel.json` currently
contains `"crons": []` — **nothing is scheduled yet**. Add schedule entries deliberately if and
when you adopt the cron endpoints; until then assume no background jobs run.

## 7. Verification checklist (what "verified" will mean)

Not yet executed — this is the bar before calling a Vercel deployment supported:

- [ ] `npm run vercel-build` completes on Vercel's Node 22 without DB access (no gates set).
- [ ] Login works for the bootstrapped admin (bcrypt password + `emailVerified` set).
- [ ] Init gate, run once against an explicitly created empty database, applies the full
      migration chain and refuses a non-empty target.
- [ ] Migrations applied exactly once; `setup:verify` (run locally against prod) is clean.
- [ ] `/api/cron/*` returns 401 without `CRON_SECRET`.
- [ ] A preview deployment demonstrably did **not** touch the production database.
- [ ] Serverless cold-start behavior with the Prisma engines observed acceptable.

## Upgrades and rollback

Follow the [database.md](database.md) runbook: fresh backup → apply pending migrations
(gate or explicit) → deploy → verify. Vercel makes the *code* rollback instant (redeploy the
previous build), but a **database** rollback always comes from your backup — plan for both.

## Security notes

- No secrets ever live in the repo, and the build receives none as build args.
- `DATABASE_URL` and `AUTH_SECRET` are secrets; scope them to the environments that need them.
- Least-privilege database user; backups encrypted/off-site per [database.md](database.md).
