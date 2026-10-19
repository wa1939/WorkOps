# Demo data guide

`prisma/seed.ts` fills a **local** database with a small, fully synthetic demo
workspace so an authenticated admin can explore real product screens. Names,
projects, tasks and KPI values are synthetic, not organizational data.

## Usage

```bash
# Prerequisite: migrations applied and the first admin bootstrapped
npm run db:setup      # initialize an empty local database once
npm run setup:admin   # first-admin bootstrap (interactive, hidden password)

# Seed the demo (opt-in, refuses non-local databases)
WORKOPS_DEMO_SEED=1 npm run db:seed        # or: WORKOPS_DEMO_SEED=1 npm run db:demo
```

`db:demo` and `db:seed` use the same guarded synthetic seeder. Neither creates
a reusable demo password or replaces an existing administrator.

## Safety contract

- **Opt-in only** — exits unless `WORKOPS_DEMO_SEED=1` (or `true`).
- **Local databases only** — the resolved `DATABASE_URL` (env, `.env.local`,
  `.env`) must point at `localhost`, `127.0.0.1`, `::1`, or `db` (compose
  service). The connection string is never printed.
- **Requires the first admin** — refuses to run before `npm run setup:admin`.
  It reuses the earliest verified, active `ADMIN` as the demo owner and never
  creates an admin or touches that account's password, role, email, or state.
- **No reusable demo credentials** — the synthetic users below get
  unpredictable random passwords (bcrypt, cost 12) that are discarded and never
  logged. Sign in as the existing admin instead.
- **Idempotent** — stable IDs (`demo-*`, `DEMO-1xx`/`DEMO-2xx`) and
  upsert-only writes; safe to re-run. It never deletes rows.
- **Fresh-install only** — refuses a target containing non-demo tasks, projects or KPIs. Do not point a localhost tunnel at a remote or production database.

## What gets created

| Entity | Value |
| --- | --- |
| Workspace | Reuses the first admin's single active workspace (normally `WorkOps`); creates `Demo Workspace` only for a legacy admin without a workspace. Multiple active workspaces are refused. |
| Department | `Demo Operations` |
| Users | `avery.quinn@example.test` (MANAGER), `riley.chen@example.test`, `jordan.patel@example.test` (MEMBER), `casey.morgan@example.test` (VIEWER) — all `@example.test`, names suffixed `(Demo)` |
| Projects | `Onboarding Portal Revamp (Demo)` (HIGH, ON_TRACK), `Quarterly Reporting Automation (Demo)` (MEDIUM, AT_RISK), each with 3 stages (Discovery/Build/Launch, Design/Implement/Rollout) |
| Tasks | 12 tasks `DEMO-101…106`, `DEMO-201…206` covering every status, all priorities, and due dates from overdue to +30 days; varied assignees and `plannedShare` allocations |
| KPIs | 4 generic KPIs (Delivery / People / Quality) with 3 sample quarterly updates — department-level, no owner |

## Teardown

Keep demos in a disposable, explicitly selected local database. The seed never
deletes anything, and the reused workspace may contain the original admin's
membership. Prefer creating another isolated database for a clean rehearsal;
never run destructive cleanup against production.
