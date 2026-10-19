# User guide

How WorkOps works day to day. For installation see [Getting started](getting-started.md); for environment settings see [Configuration](configuration.md).

## How the app is organized

WorkOps models a **department**: people with roles (`ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`), optionally organized into **workspaces** — scoped areas with their own membership (owner/admin/member/viewer) for things like a project, an initiative, or a sub-team. Tasks, projects, and notifications are workspace-aware. There are also department-level **KPIs** (owned by the department, not individuals), **announcements**, and **case studies**.

The left navigation covers the modules below; ⌘/Ctrl-K opens a command palette for quick navigation and recent tasks.

## Accounts

- **Sign in** at `/login` with email + password (or Microsoft Entra ID, if your deployment enabled it).
- **Sign up** at `/signup`. In production, accounts must have a **verified email** and a **set password** before they can sign in — an admin or the deployment's bootstrap process sets up the first account; see [Getting started](getting-started.md#5-create-the-first-administrator).
- **Forgot password** sends a reset link (requires email to be configured). Tokens expire.
- Change your password any time under **Settings → Security**; changing it signs out other sessions.

## Your home base

- **Dashboard** — your personal overview: your work, deadlines, and department signals.
- **Custom home (opt-in)** — in Settings you can opt in to a home page you build yourself from blocks (task lists, charts, stat tiles, KPI/project snapshots, notes, embeds). It replaces the default dashboard for you only.
- **Inbox** — in-app notifications for assignments, mentions, due dates, and more. Under **Settings** you control which events reach you and how (in-app, email where configured).

## Tasks

The core module, with three synchronized views of the same data:

- **Grid** — spreadsheet-style editing: statuses, priorities, tags, task types, custom fields, dependencies, and subscribers.
- **Board** — Kanban columns by status with drag and drop.
- **Gantt** — timeline view for scheduling and dependencies.

Key workflows:

- **Floating pool** — unassigned tasks sit in a pool; any member can **claim** one.
- **Assignments & dependencies** — multiple assignees per task, blocked-by relations, parent/child structure.
- **Recurring tasks** — define a rule and occurrences are generated on schedule.
- **Time tracking** — log time entries or run a timer on a task; entries feed reports and utilization.
- **Comments** — threaded discussion with reactions; mention people to notify them.
- **Bulk actions & export** — multi-select for bulk status/assignment changes; export task lists.
- **Reminders** — due-soon and overdue reminders via the notification pipeline (channels depend on deployment configuration).

## Projects

A project carries structure beyond tasks: **objectives**, planned **outputs**, **risks**, **stages**, a **health** status, and **members** with per-project access levels. Each project has linked tasks and a **roadmap** on a Gantt timeline. Project state feeds the planner, reports, and (optionally) AI summaries.

## Workload planner

The planner shows how work is distributed across the team — assignments, time, and leave — so managers can rebalance before assigning more. Aggregates are refreshed by a scheduled team-load job.

## Time & reports

- **Time entries** — log and review time per task, with exports.
- **Utilization** — capacity views based on logged time and availability.
- **Reports** — weekly reports and project reports; where AI is configured, drafting assistance is available and clearly marked as AI-generated.

## PMO & external actions

The PMO module tracks commitments whose owners sit **outside** your team — vendors, other departments, partners:

- **External actions** with owners, due dates, and reminder rules.
- **Evidence** attached to actions and **follow-up events** recording what happened.
- **Portfolio** and **timeline** views over the whole set, plus exports.
- Reminders (including to inactive owners) run through the scheduled PMO reminder job.

## Department KPIs

KPIs are shared department-level scorecard items — they have no individual owner. Update them on a cadence, track status and trend, and let scheduled reminders nudge updates. KPI snapshots can be pinned into custom views and homes.

## Notes, leave, and the periphery

- **Notes** — markdown pages with tags for runbooks, how-tos, and decisions.
- **Leave** — request leave with a task **handover** plan; returning members file a return report. Handover keeps work moving while someone is out.
- **Announcements** — department-wide posts with priority levels and seen-tracking.
- **Case studies** — structured department case-study requests with members and report output.
- **Team** — the people view: who is here, their roles, and workload signals.

## Working with Sabah (optional AI assistant)

Sabah is WorkOps' built-in assistant. **It does nothing unless the deployment has configured an AI provider.** When enabled:

- **Chat** — ask about your work; answers are grounded in data **you already have permission to see**.
- **Task intake** — describe work in natural language; Sabah drafts structured tasks that you review before anything is created.
- **Field assist** — drafting help inside editor fields.
- **Task actions & workflows** — Sabah can propose or perform task operations, but writes pass through explicit gates: multi-step workflows persist **approvals**, and the assistant cannot act beyond your own permissions.
- **Memory** — conversation context is summarized and stored with scoped, provenance-tracked memory; admins manage and can review AI data in the admin area.

What data goes where: prompts and context are sent to the configured model provider. See [Architecture → AI subsystem](architecture.md#ai-subsystem) and the [FAQ](faq.md#ai-and-your-data).

## Roles — who can do what

| Role | Typical abilities |
| --- | --- |
| **Admin** | Everything: user management, department settings, integrations, AI model configuration |
| **Manager** | Plan and assign work, see team workload, approve leave, manage projects and KPI cadence |
| **Member** | Work their assignments: claim pool tasks, log time, comment, update statuses, request leave |
| **Viewer** | Read-only visibility |

Workspaces layer their own roles on top for scoped areas. Enforcement is server-side: the UI hides what you cannot do, and the API checks it again.
