<div align="center">

<img src="public/brand/workops-logo.png" alt="WorkOps logo" width="420">

# WorkOps

**Self-hosted task, project and workload management — built for departments.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwa1939%2FWorkOps&env=DATABASE_URL%2CAUTH_SECRET%2CAUTH_TRUST_HOST%2CWORKOPS_DB_INIT_ON_BUILD%2CWORKOPS_BOOTSTRAP_ADMIN_ON_BUILD%2CADMIN_EMAIL%2CADMIN_PASSWORD&envLink=https%3A%2F%2Fgithub.com%2Fwa1939%2FWorkOps%2Fblob%2Fmain%2Fdocs%2Fdeployment%2Fvercel.md&project-name=workops)

</div>

WorkOps is an MIT-licensed work-management application you run yourself, in front of your own PostgreSQL database. It covers the whole operating rhythm of a department: day-to-day **task management**, structured **project management**, deliberate **workload management and capacity planning**, time and utilization reporting, portfolio-style tracking of commitments owned outside the team, a shared department KPI scorecard, and an optional bring-your-own-key AI assistant.

It is designed for how departments actually work: shared goals owned by the whole team, managers coordinating capacity across people, and individual members who need one clear view of what is theirs today.

**Who it is for**

- **Department and team leads** who need to see who is overloaded *before* assigning the next piece of work — forward load, leave-aware capacity, and a planner for rebalancing.
- **Members** who want one clear list of their work, quick time logging, and fewer status meetings.
- **PMO-style coordinators** who chase commitments owned outside the team — vendors, other departments, partners — and need evidence and follow-up history, not another spreadsheet.
- **Self-hosters** who want department tooling under their own control: your database, your AI provider, your data.

## Highlights

- **Task management that fits how you look at work** — a spreadsheet-style list and a Kanban board over the same tasks, sharing one filter state carried in the URL, so a filtered view is a link you can paste. Scope tabs (My tasks / All tasks / Related to me, plus Created by me and Unassigned), a person picker, search, status, priority, and due-date filters, and sorting. An unassigned **floating pool** lets members claim work.
- **Projects with structure** — objectives, outputs, risks, stages, health, members, and a project roadmap on a Gantt timeline.
- **Workload management & capacity planning** — a per-person planner with available/booked/overloaded states and drag-to-reassign, a forward capacity heatmap on the team page, effort estimates with a documented fallback chain, leave-aware capacity, and a utilization report that separates what was planned from what was actually logged. [How the numbers work](docs/features/workload-capacity.md).
- **Time & utilization reporting** — time entries and timers per task, estimate-vs-actual variance, member-by-week capacity vs logged time with CSV export, and AI-assisted executive summaries and project briefs where AI is configured.
- **PMO & external actions** — follow projects and outside-team commitments through portfolio/timeline views, with accountable owners, due dates, evidence, reminder rules, follow-up history, and exports.
- **Department KPIs** — a shared scorecard with updates and reminders. KPIs belong to the department, not to individuals.
- **Custom views & personal home** — a block-based editor (task lists, charts, stat tiles, notes, embeds) for building saved views, with an opt-in custom home page.
- **The operational periphery** — notes (markdown + tags), leave requests with task handover plans, announcements, an inbox with notification preferences, and case studies.
- **Roles & workspaces** — department-level roles (Admin, Manager, Member, Viewer) plus scoped workspaces with their own membership.
- **Optional AI assistant (Sabah), bring your own provider** — OpenAI, native Claude/Anthropic, or a custom OpenAI-compatible service (Nuha, a local server, a proxy). Chat, task intake, and field assistance with permission-grounded, reviewable workflows; explicit approvals for write actions. Fully optional and off unless you configure it. [AI providers](docs/ai-providers.md).

## Workload is more than a task count

A board can show fifty tasks without telling you whether they represent five hours or five weeks. WorkOps adds the planning context:

- **Before assigning work:** inspect the team heatmap, weekly load drivers and leave-adjusted capacity instead of relying on task totals.
- **While planning:** use the daily planner to review scheduled effort, assignment shares and work that cannot fit; reassign or reschedule with the same task permissions.
- **When estimates are missing:** the weekly load engine uses a labeled effort fallback chain and confidence signal. The daily planner keeps unknown effort in its backlog rather than presenting a guessed schedule.
- **When people are away:** approved leave reduces capacity; handover plans record coverage without silently changing task ownership.
- **After delivery:** compare estimates with recorded time and review weekly utilization. Logged hours support planning conversations; they are not a productivity or performance score.

The weekly heatmap, daily planner and utilization report answer different questions. [The workload guide](docs/features/workload-capacity.md) explains their inputs, formulas, calendar defaults and limits.

## One connected operating rhythm

1. **Capture:** create a task, claim shared work, or review an AI-drafted task before saving it.
2. **Plan:** connect work to projects, review capacity and leave, and agree priorities and ownership.
3. **Deliver:** work from personal or team views; follow dependencies, external commitments and requests for help.
4. **Review:** use time reports, project briefs, shared KPIs and saved views to see progress and decide what changes next.

## Screenshots

These are genuine captures of this checkout running locally with synthetic demo data. No operational or customer data is shown.

| Dashboard | Task board | Mobile |
| --- | --- | --- |
| ![WorkOps dashboard](docs/images/workops-dashboard.png) | ![WorkOps tasks](docs/images/workops-tasks.png) | ![WorkOps on mobile](docs/images/workops-mobile.png) |

## Documentation

| Document | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, configure, initialize the database, first admin, first run |
| [User guide](docs/user-guide.md) | How each module works, day to day |
| [Capabilities](docs/capabilities.md) | Feature-by-feature reference, including what requires configuration |
| [Workload & capacity](docs/features/workload-capacity.md) | How load, effort estimates, capacity, and utilization are actually computed — and what they do and don't measure |
| [AI providers](docs/ai-providers.md) | Choosing and configuring OpenAI, Claude, or a custom compatible provider |
| [Configuration](docs/configuration.md) | Environment variables, integrations, scheduled jobs |
| [Architecture](docs/architecture.md) | Stack, data model, auth, and the AI subsystem |
| [Development](docs/development.md) | Local development, tests, migrations |
| [FAQ](docs/faq.md) | Common questions about data, AI, and operations |
| [Roadmap](ROADMAP.md) | Now / Next / Later — direction, not commitments |

Deployment guides: [Vercel](docs/deployment/vercel.md) · [Self-hosting](docs/deployment/self-hosting.md) · [Database setup](docs/deployment/database.md)

## Quick start (local development)

Prerequisites: Node.js 22.22.2 or a compatible newer runtime (see `engines` in `package.json`), PostgreSQL 16, and npm.

```bash
git clone https://github.com/wa1939/WorkOps.git
cd WorkOps
npm ci

# Configure the app
cp .env.example .env
#   - DATABASE_URL  → your local PostgreSQL database
#   - AUTH_SECRET   → generate with: openssl rand -base64 32

# Initialize a NEW database and create the first administrator
npm run db:setup        # safe initialization for an empty database
npm run setup:admin     # interactive first-admin bootstrap

# Optional: load synthetic data into an isolated local installation
WORKOPS_DEMO_SEED=1 npm run db:demo

# Run
npm run dev             # http://localhost:3000
```

`db:setup` refuses an existing or unknown non-empty database. `setup:admin` refuses an installation that already has users; it never resets accounts. Use `npm run setup:verify` for a read-only installation check. See [database setup](docs/deployment/database.md) for initialization and safe upgrades.

## Deployment

WorkOps is a standard Next.js (App Router) application with a PostgreSQL database, so it runs anywhere Node runs.

- **Vercel** — see [docs/deployment/vercel.md](docs/deployment/vercel.md)
- **Self-hosting (Docker / your own server)** — see [docs/deployment/self-hosting.md](docs/deployment/self-hosting.md)
- **Database initialization and migrations** — see [docs/deployment/database.md](docs/deployment/database.md)

### Deploy on Vercel

The **Deploy with Vercel** button at the top of this README creates a Vercel project from this repository and prompts for the required setup variables before the first build:

- `DATABASE_URL` — a PostgreSQL connection string. Any standard PostgreSQL provider works (Vercel Postgres, Neon, Supabase, or your own server); WorkOps does not depend on a specific database vendor.
- `AUTH_SECRET` — generate a unique signing secret with `openssl rand -base64 32`; set `AUTH_TRUST_HOST=true`.
- For a fresh empty database, set **`WORKOPS_DB_INIT_ON_BUILD=1`** and **`WORKOPS_BOOTSTRAP_ADMIN_ON_BUILD=1`** (exactly `1`, not `true`). Provide your own `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters, including letters and digits.
- The canonical origin can use Vercel's production-alias system variable on the first deployment. Set `NEXTAUTH_URL` / `APP_BASE_URL` for your final custom domain; see the guide for system-variable requirements.

Database setup is **opt-in, never implicit**. The two first-install gates initialize the schema and create a verified administrator with OWNER workspace membership in the same deployment. After signing in, disable both gates and remove `ADMIN_PASSWORD` from platform settings. `WORKOPS_DB_MIGRATE_ON_BUILD=1` is a separate pending-migration opt-in for environments that own their database; preview builds refuse setup flags. Full details: [docs/deployment/vercel.md](docs/deployment/vercel.md).

This flow is documented and has been exercised locally against the real build; it has not yet been verified on a live cloud deployment, and supplying your own PostgreSQL database is part of setup — it is not a zero-config deploy.

Scheduled background jobs (reminders, digests, recurring tasks, the team-load refresh) run through authenticated HTTP endpoints — [Configuration](docs/configuration.md) covers how to trigger them. Scheduling them is opt-in, and the workload views compute live even when no schedule is configured.

## Configuration at a glance

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_SECRET` | ✅ | Auth.js (NextAuth) JWT signing secret |
| `NEXTAUTH_URL` / `APP_BASE_URL` | ✅ | Canonical origin for callbacks and links |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Transactional email (verification, password reset, notifications) |
| `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` | optional | Your choice of OpenAI, native Anthropic/Claude, or a custom OpenAI-compatible service; custom services also use `AI_BASE_URL`. Existing GLM/Nuha variables remain supported. |
| `AZURE_AD_CLIENT_ID` / `_SECRET` / `_TENANT_ID` | optional | Microsoft Entra ID sign-in alongside credentials |
| `CRON_SECRET` | optional | Protects scheduled-job endpoints |
| `SABAH_CREDENTIAL_KEY` | optional | Encrypts admin-managed AI provider credentials |

The full reference, including optional web-push and webhook settings, is in [docs/configuration.md](docs/configuration.md).

## About the AI features

AI in WorkOps is **optional and bring-your-own-provider** — there is no bundled model and no hosted AI service operated by the project. Choose OpenAI, native Anthropic/Claude, or a custom OpenAI-compatible service such as Nuha or a local model server; define the key and exact model ID, plus the endpoint for custom services. GLM is supported for backward compatibility, not required. See [AI providers](docs/ai-providers.md) and [AI configuration](docs/configuration.md#ai-optional). When enabled:

- The assistant operates within the signed-in user's permissions — it does not see data the user cannot see.
- Write actions go through reviewable workflows with explicit approvals.
- Prompts and context are sent to the model provider you configure; self-hosters choose which provider (and therefore which jurisdiction) that is.
- AI can also cache effort estimates on unestimated tasks for the weekly team-load engine. The daily planner has separate estimate inputs; [the workload guide](docs/features/workload-capacity.md) explains the distinction. Load planning works without AI.
- Advanced job/monitor/model-assignment features require explicit admin configuration.

Details: [docs/architecture.md](docs/architecture.md) (AI subsystem) and [docs/capabilities.md](docs/capabilities.md).

## Project status

WorkOps is developed in the open in this repository, but it is young software: there is no hosted demo, no release yet, and no paid tiers — this is an MIT-licensed application you run yourself. The documented Vercel deployment flow has been exercised locally but has not yet been verified against a live cloud deployment.

Report reproducible problems through the channels in [SUPPORT.md](SUPPORT.md).

## Community

- [Contributing](CONTRIBUTING.md) — how to set up, branch, test, and submit changes
- [Security policy](SECURITY.md) — how to report vulnerabilities
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Support](SUPPORT.md) — where to ask questions

## License

[MIT](LICENSE) © 2026 Waleed Alhamed. Third-party components are covered by their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
