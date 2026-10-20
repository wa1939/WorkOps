# Capabilities

A feature-by-feature reference. "Core" features work with just a database and an `AUTH_SECRET`; anything that talks to the outside world is listed with its configuration requirement. See [Configuration](configuration.md) for the variables and [Architecture](architecture.md) for how the pieces fit.

## Work management (core)

| Capability | What it does | Notes |
| --- | --- | --- |
| Tasks | Grid, board, and Gantt views over the same tasks; priorities, statuses, tags, task types, dependencies, subscribers, comments with reactions; bulk edit and CSV-style export; a recent-tasks list | The command palette (⌘/Ctrl-K) reaches recent tasks and navigation |
| Floating pool | Unassigned tasks that any member can claim | Claim endpoint scopes to the task's workspace |
| Recurring tasks | Rules that generate recurring work | Processed by a scheduled job |
| Reminders | Task due-soon/overdue reminders and per-task reminders | Delivery channel depends on notification configuration |
| Time tracking | Time log entries and an active timer per task | Feeds utilization and reports |
| Projects | Objectives, outputs, risks, stages, health, members with access levels, and a roadmap Gantt per project | |
| Workload planner | Team workload view used to balance assignments | Aggregates are refreshed by a scheduled team-load job |
| Department KPIs | Shared scorecard — KPIs belong to the department, with updates, status, and reminder jobs | |
| PMO & external actions | Track commitments owned outside the team: actions, owners, evidence, reminder rules, follow-up events, portfolio and timeline views | Reminders run as a scheduled job; exports available |
| Reports | Weekly reports, time reports, utilization views, project reports; optional AI-assisted report generation | AI-assist requires [AI configuration](configuration.md#ai-optional) |
| Notes | Markdown note pages with tags | |
| Leave & handover | Leave requests with task handover plans and return reporting | |
| Case studies | Department case-study requests with members, department scoping, and report output | |
| Announcements | Department-wide announcements with priorities and seen-tracking | |
| Search | Cross-module search API behind the app | |
| Streaks | Lightweight personal usage streaks | |

## Structure & permissions (core)

| Capability | What it does |
| --- | --- |
| Department roles | `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER` — enforced server-side in API routes |
| Workspaces | Scoped areas with their own `OWNER` / `ADMIN` / `MEMBER` / `VIEWER` membership; tasks, notifications, and events are workspace-aware |
| Custom fields | Department-defined custom fields with values on work items |
| Audit log | Security-relevant events are recorded |

## Personalization (core)

| Capability | What it does | Notes |
| --- | --- | --- |
| Saved views | Named, votable saved views over task data | |
| Custom views (block builder) | Compose pages from blocks: text, todo lists, charts, stat tiles, progress, KPI and project snapshots, task views, callouts, quotes, images/galleries, code, embeds | |
| Custom home | Opt in to a block-built page as your home instead of the default dashboard | Opt-in only; the default dashboard remains available |
| Settings | Profile, password change, notification preferences, home preference | |

## Communication

| Capability | Works out of the box? | Configuration |
| --- | --- | --- |
| In-app notifications (inbox) and notification events | ✅ | — |
| Email delivery (verification, password reset, notification emails) | ❌ requires `RESEND_API_KEY` + `EMAIL_FROM` | [Email](configuration.md#email-resend) |
| Browser (web) push | ❌ requires key configuration | Push subscriptions are encrypted with `PWA_SUBSCRIPTION_KEY` (falls back to `SABAH_CREDENTIAL_KEY`) |
| Announcements digest / weekly digests | ❌ scheduled jobs | [Scheduled jobs](configuration.md#scheduled-jobs) |

## AI — optional (Sabah)

Nothing AI-related runs until a provider is configured. With configuration in place:

| Capability | Notes |
| --- | --- |
| Assistant chat with workspace context | Answers are grounded in data the signed-in user can access |
| Task intake | Draft tasks from natural-language input, reviewed before creation |
| Field assist | Per-field drafting/editing assistance |
| Task actions | Assistant-proposed task operations behind write gates |
| Reviewable workflows | Multi-step workflows with persisted approvals — the assistant cannot perform a write the user could not, and significant actions require explicit approval |
| Memory & continuity | Conversation summaries and scoped, provenance-tracked AI memory |
| Playbooks | Versioned, evaluated assistant playbooks |
| Jobs & monitors | Scheduled/observed AI jobs — **explicit admin configuration required** |
| Model management | Admin-managed provider credentials (encrypted at rest) and per-role model assignments |
| Connectors & webhooks | Inbound integration surfaces with delivery tracking — **explicit admin configuration required** |
| Consent tracking | Processing-consent decisions are recorded per user |

Bring your own OpenAI key, native Anthropic/Claude key, or custom OpenAI-compatible endpoint such as Nuha. Configure the provider, key and exact model ID; custom services also need an endpoint. GLM remains backward-compatible, not mandatory. Administrator CHAT/COMPRESSION assignments support editable model identifiers and encrypted credentials. New generic routes have no implicit cross-vendor fallback. Prompts and authorized task context go to the selected provider; individual models must support the tools/images used by each feature. See [AI configuration](configuration.md#ai-optional), [Architecture → AI subsystem](architecture.md#ai-subsystem), and [FAQ](faq.md#ai-and-your-data).

## Platform

| Capability | Notes |
| --- | --- |
| Credentials auth (email + bcrypt password) | Production requires a verified email and a set password |
| Optional Microsoft Entra ID sign-in | Enable with `AZURE_AD_*` variables — an additional provider, not a replacement |
| PWA | Installable web app with an app manifest |
| Health endpoint | `GET /api/health` |
| Scheduled jobs | HTTP endpoints protected with `CRON_SECRET` — [scheduled jobs](configuration.md#scheduled-jobs) |
| Exports | Task, project, PMO, report, and time-entry exports |

## Explicitly not included

- No hosted/cloud version is operated by the project — you deploy your own instance.
- No SSO beyond the optional Entra ID provider, no SCIM, no audit-export tooling.
- No mobile app — the web UI is responsive and installable as a PWA.
- AI providers are not bundled: you choose and configure the model provider.
