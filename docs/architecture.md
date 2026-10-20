# Architecture

WorkOps is a conventional, boring-on-purpose Next.js application: one deployable app, one PostgreSQL database, and optional outbound integrations. This page describes how it fits together.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, React 18, TypeScript), server components + route handlers |
| Database | PostgreSQL via Prisma ORM (Prisma Migrate; committed migrations only) |
| Auth | Auth.js / NextAuth v5 — JWT sessions, Prisma adapter, credentials + optional Microsoft Entra ID |
| UI | Tailwind CSS, Radix-based component primitives, Recharts, gantt-task-react, dnd-kit |
| Email | Resend |
| Push | Web push (subscriptions encrypted at rest) |
| AI | Configurable OpenAI/native Anthropic/custom OpenAI-compatible transport, with encrypted admin credentials and model-role assignments |
| Tests | Vitest (unit/component), Playwright (e2e), Testing Library |

## Repository layout

```
src/
├── app/
│   ├── (app)/            # Authenticated modules: tasks, projects, planner, pmo,
│   │                     # reports, time-entries, kpis, notes, leave, inbox,
│   │                     # announcements, case-studies, team, views, settings,
│   │                     # support, admin
│   ├── api/              # Route handlers: module APIs, /api/cron/*, /api/ai/*,
│   │                     # /api/sabah, /api/health, auth endpoints
│   ├── login/ signup/ verify-email/ forgot-password/ reset-password/
├── components/           # UI: ui/ primitives, layout/, tasks/ (grid|board|gantt),
│                         # view-blocks/ (custom view block editor + renderers), sabah/
├── lib/                  # auth, authz, ai/, sabah/, pmo/, tasks/, notifications,
│                         # email, glm.ts (AI client), rate-limit, security-headers
└── types/
prisma/                   # schema.prisma, migrations/, seed.ts, seed-kpis.js
docs/                     # This documentation
```

## Authentication

- **Providers** — a credentials provider (email + bcrypt-hashed password) is always registered. A Microsoft Entra ID provider is added **only** when `AZURE_AD_CLIENT_ID` is configured, so it appears as an additional sign-in option.
- **Session strategy** — JWT (stateless). The token carries the user id, role, and a `passwordVersion`; on every refresh the session is revalidated against the database — deactivated users or tokens from before a password change are rejected, and role changes take effect on refresh rather than lingering.
- **Credentials rules** — login attempts are rate-limited per email/IP with identical errors for unknown/inactive/invalid credentials (so the limiter can't become an oracle). In **production**, sign-in additionally requires a non-null `password` and a non-null `emailVerified`. In **development**, passwordless users may sign in — never expose a dev-mode instance.
- **Flows** — sign-up, email verification, forgot/reset password (hashed, expiring tokens), and in-app password change (Settings → Security, bumps `passwordVersion`).

## Authorization model

- Department roles: `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER` (schema enum `Role`).
- Workspaces: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` (`WorkspaceRole`), with membership-scoped tasks, notifications, and events; projects additionally carry per-project access levels.
- Checks live in `src/lib/authz/` and are enforced **in API route handlers** — the UI hides actions, but the server is the authority.
- Security-relevant events land in an `AuditLog`; response hardening is centralized in `security-headers`, and an origin guard protects mutating requests.

## Data model (selected groups)

- **Work**: `Task` (+ assignments, dependencies, tags, subscribers, reminders, recurring rules, time logs, active timers, comments), `Project` (+ objectives, outputs, risks, stages, members), `CaseStudy`, `SavedView`, `CustomField`
- **Department**: `KPI` + `KPIUpdate`, `Announcement`, `NotePage`, `LeaveRequest`, `Handover`, `WeeklyReport`
- **External commitments**: `WorkArea`, `ExternalContact`, `ExternalAction`, `ReminderRule`, `FollowUpEvent`, `ActionEvidence`
- **Structure**: `Department`, `User`, `UserDepartment`, `Workspace`/`WorkspaceMember`, `AppConfig`, `AuditLog`
- **Communication**: `NotificationEvent`/`Delivery`, `PushSubscription`, `NotificationPreference`, `TeamLoadSnapshot`/`TeamLoadRun`
- **AI**: conversations/messages/summaries, scoped memory with sources and provenance, playbooks (+versions/evaluations), workflows (+steps/events) with persisted `AiApproval`s, jobs/attempts, monitors, suggestions, connectors/webhook deliveries, provider credentials, model assignments, knowledge chunks/embeddings, processing-consent records

The full model is [`prisma/schema.prisma`](../prisma/schema.prisma).

## AI subsystem

Purpose-built around restraint:

- **Providers** — `src/lib/glm.ts` is the backward-compatible shared entry point. `src/lib/ai/provider-config.ts` resolves operator-owned provider/model/endpoint settings; `anthropic-adapter.ts` uses Anthropic's official SDK. OpenAI-compatible services reuse the bounded chat-completions transport. Generic providers have no automatic cross-vendor fallback; explicit admin CHAT/COMPRESSION assignments override deployment defaults. Legacy Z.AI/Nuha installations retain their existing behavior.
- **Credentials** — admin-registered provider credentials are encrypted at rest with `SABAH_CREDENTIAL_KEY` (32-byte, base64). The key must exist before credentials are stored and must be preserved.
- **Permissions** — every AI surface builds its context from what the signed-in user may read. The assistant has no separate data access.
- **Write gates** — task actions and workflow steps that mutate data go through executors with write gates; multi-step workflows persist `AiApproval` records so humans approve significant actions. Tests cover the gate behavior (`executors.write-gate.test.ts`, `pmo-executors.test.ts`).
- **Memory & learning** — conversations are summarized; memory is scoped (user/workspace), provenance-tracked, and freshness-aware; playbooks are versioned and evaluated; users' processing-consent decisions are recorded.
- **Autonomy surface** — jobs, monitors, suggestions, and connectors/webhooks exist behind explicit admin configuration; nothing autonomous runs by default.

**AI data flow:** user request → prompt assembled from permitted context (+ scoped memory) → configured provider endpoint → response → user-visible answer or a **reviewable** proposed action (approvals where required). Prompt/response metadata is logged for operations; task content goes only to the provider you configured.

## Notifications pipeline

Events (assignment, mention, due-soon, PMO reminders, digests…) produce `NotificationEvent`s with per-user `Delivery` records:

- **In-app inbox** — always available.
- **Email** — via Resend when configured, honoring per-user preferences and quiet hours.
- **Web push** — stored subscriptions are encrypted (`PWA_SUBSCRIPTION_KEY`); delivery follows preferences.

## Scheduled jobs

`/api/cron/*` endpoints (reminders, recurring tasks, digests, team-load refresh, AI jobs/monitors, backup support) require `Authorization: Bearer $CRON_SECRET`. [`vercel.json`](../vercel.json) schedules the main jobs for Vercel deployments; self-hosters wire their own scheduler — see [Configuration](configuration.md#scheduled-jobs).

## Testing & development guardrails

- `npm run test:unit` (Vitest) covers lib/component logic; `npm run test:e2e` (Playwright) covers flows.
- `db:migrate:dev` and `test:e2e` are wrapped by `scripts/assert-local-database.ts`, which refuses to run against a database that doesn't look local — a guard added after a real production data-loss incident. Treat it as a feature: schema changes happen on local databases, get their SQL reviewed, and ship as migrations.
