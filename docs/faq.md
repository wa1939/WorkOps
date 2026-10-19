# FAQ

Quick answers to common questions. Deeper material: [Getting started](getting-started.md), [User guide](user-guide.md), [Configuration](configuration.md), [Architecture](architecture.md).

## Setup & operations

**Can I run WorkOps without any external services?**
Yes. The core (tasks, projects, planner, KPIs, notes, leave, PMO, in-app notifications) needs only PostgreSQL and the two or three required environment variables. Email, AI, and push are optional add-ons.

**Why can't I sign in with an account I just created?**
In production mode, sign-in requires a **verified email** and a **set password**. If email isn't configured, verification emails can't be sent — bootstrap the first admin with the setup script (see [Getting started](getting-started.md#5-create-the-first-administrator)) and configure [email](configuration.md#email-resend) for self-service sign-ups.

**Is there a hosted version or demo?**
No. WorkOps is software you self-host; there is no SaaS, no hosted demo, and no paid tiers.

**How do scheduled jobs work?**
They're HTTP endpoints under `/api/cron/*` protected by a bearer secret (`CRON_SECRET`). Vercel deployments use the schedules in `vercel.json`; self-hosters wire any scheduler. See [Configuration → Scheduled jobs](configuration.md#scheduled-jobs).

**How do I back up my data?**
It's a normal PostgreSQL database — use your platform's or your own `pg_dump`-based backup routine. There is a backup support endpoint under `/api/cron/`, but establishing and **testing** backups is the operator's responsibility.

**What Node/Postgres versions are supported?**
The tested runtime is Node.js 22.22.2; see `engines` in `package.json` for supported newer runtimes. PostgreSQL 16 is used for the clean-install rehearsal.

## AI and your data

**Is AI required? What runs by default?**
Nothing. No model provider is contacted until you set `GLM_API_KEY` or an admin registers provider credentials. All AI features — chat, intake, field assist, workflows — are inactive until then.

**What data leaves my server when AI is enabled?**
Prompts assembled from the context you're already viewing (task titles/descriptions, notes you ask about, scoped memory), sent over HTTPS to the provider **you** configured. Self-hosters choose the provider and therefore where that data goes. Nothing is sent to the WorkOps project — there is no WorkOps-side service.

**Can the AI assistant do things I'm not allowed to do?**
No. Assistant surfaces build context from what the signed-in user may read, and write actions pass through gates: significant or multi-step changes persist explicit approvals for a human to accept or reject. It cannot exceed your own permissions.

**What are the "advanced" AI features?**
Scheduled AI jobs, monitors, connectors/webhooks, and per-role model assignment. These exist behind explicit admin configuration and don't activate by default.

**Where is AI provider credentials storage?**
Admin-registered credentials are encrypted at rest with `SABAH_CREDENTIAL_KEY`. Set that key before storing credentials and back it up — losing it makes stored credentials unusable.

## Data & permissions

**Where does my data live?**
Entirely in your PostgreSQL database. The application keeps no external state (besides the optional outbound integrations above).

**Who sees what?**
Department roles (`ADMIN`/`MANAGER`/`MEMBER`/`VIEWER`) plus per-workspace membership control access, enforced server-side on every API call. KPIs are department-level, not personal.

**Is there an audit trail?**
Security-relevant events are written to an audit log (`AuditLog`).

**How are passwords stored?**
bcrypt-hashed. Changing a password invalidates existing sessions (JWTs carry a password version that's revalidated on refresh).

**Can I use Microsoft/Entra ID login?**
Yes, as an additional provider next to email+password — set the `AZURE_AD_*` variables (see [Configuration](configuration.md#microsoft-entra-id--optional)).

## Project

**What's the license?**
[MIT](../LICENSE) © 2026 Waleed Alhamed. Third-party notices are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

**Where do I report a security issue?**
Not in public issues — see [SECURITY.md](../SECURITY.md).

**How can I contribute?**
See [CONTRIBUTING.md](../CONTRIBUTING.md). Documentation improvements are a great starting point.

**Is there a roadmap?**
[Yes](../ROADMAP.md) — direction only, no dated commitments.
