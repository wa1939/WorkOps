# Workload & capacity

How WorkOps answers the question every manager asks: **who has room for more work, and who is already over?** This page explains what each number means, where it comes from, and what it does *not* measure.

WorkOps approaches workload from three complementary angles. The daily planner and weekly team-load snapshots have different inputs and should not be treated as identical calculations:

| Surface | Question it answers | Looks at | Basis |
| --- | --- | --- | --- |
| [Planner](#the-planner) (`/planner`) | How is upcoming work distributed, and how do I rebalance it? | The next few weeks | Planned effort per task |
| [Team page](#team-page-and-forward-heatmap) (`/team`) | How booked is each person this week — and next? | Current + forward weeks | Planned effort per task |
| [Utilization report](#utilization-what-it-measures) (`/reports/utilization`) | How much of their capacity did people actually log? | Past / current weeks | Logged time |

## Weekly load and daily planning are different views

Weekly team-load math lives in [`src/lib/team-load.ts`](https://github.com/wa1939/WorkOps/blob/main/src/lib/team-load.ts). Team cards, the forward heatmap and scheduled weekly snapshots reuse those helpers and bucket work by due date.

The daily planner uses [`src/lib/workload/planner-read-model.ts`](https://github.com/wa1939/WorkOps/blob/main/src/lib/workload/planner-read-model.ts): remaining effort or `estimateMinutes`, planned start/end dates, assignment shares, working-day capacity, approved leave and recorded time. A task without a planner estimate stays in an **unknown-effort backlog**; the planner does not silently substitute the weekly engine's median/default chain. Differences between these views can therefore be legitimate, not a promise that every screen will show the same number.

## How weekly team-load effort is estimated

Forward load needs an hour figure for every open task. WorkOps fills missing estimates with a documented fallback chain — each task carries the **source** of its hours, shown in the UI (for example in heatmap drivers):

1. **Manual estimate** — someone set an effort value on the task.
2. **Cached AI estimate** — if AI is configured, a prior estimation run may have stored an effort value on the task.
3. **The assignee's median** — median of actual logged hours on their completed tasks, once they have at least three such samples.
4. **The department's median** — median across all logged completed-task hours, used when a person has too little history.
5. **A 2-hour default** — the floor when nothing else is available.

Because some tasks always sit at the bottom of that chain, per-person **confidence** is computed alongside load: the share of a person's open tasks whose hours did *not* fall back to the default. A load number for someone with many unestimated tasks is explicitly less trustworthy than one for someone whose tasks all carry real estimates — the UI surfaces this rather than hiding it.

Optional AI assistance: when an AI provider is configured, a scheduled pass can estimate batches of unestimated tasks (bounded per run, with sane hour limits) and cache the result on the task. Without a provider, the chain simply runs on manual estimates and medians — load planning works fully without AI.

## Weeks, work days, and capacity

The shipped defaults use the following conventions; the weekly engine and daily planner apply them at different time resolutions:

- **Weeks start on Sunday.** Forward load is computed over week windows (four weeks by default).
- **The work week is Sunday–Thursday.** Friday and Saturday are treated as the weekend and never count as capacity days. This convention is currently built in, not configurable.
- **Capacity is hours per week, per person.** Each user's `capacityPerWeekHours` is used as-is; if it is not set, 35 hours/week is assumed. Managers and admins set this per person.

## Leave reduces capacity

Approved leave pro-rates the week: a person on leave for two of the five workdays has 60% of their normal capacity that week, floored at zero for full weeks out. The same task load therefore reads as a higher load percentage during a leave week — which is the point. Only **approved** leave requests count; pending requests do not affect capacity.

## Reading the numbers

- **Load hours** — the sum of effort for a person's open tasks (completed and canceled tasks are excluded) whose due date falls in that week. Tasks without a due date, and anything already overdue, land in the current week rather than disappearing.
- **Load %** — load hours divided by that week's leave-adjusted capacity. Above 100% means more planned effort than available hours. A person with work but zero available capacity (fully on leave) shows as a capped 200% sentinel rather than an meaningless infinity.
- **Drivers** — the top contributing tasks behind a week's total, each labeled with where its hours came from (manual, AI, median, or default), so a hot week can be traced to actual work items.

## The planner

The planner (`/planner`) is the working surface for rebalancing. It lays out team members against days and weeks, combining assignments, planned effort, approved leave, and logged time from a dedicated read model. You can:

- See per-person and per-day states — **available**, **booked**, or **overloaded** — plus load meters per member.
- See project rows alongside people, so over-allocation can be traced to a project as well as a person.
- **Drag tasks** between people (reassign) or between days (reschedule) — the planner computes the resulting assignment changes.
- Filter by person, project, and workspace, and adjust display settings in the settings drawer.

Changes you make in the planner are ordinary task assignment edits — subject to the same server-side permission checks as everywhere else.

## Team page and forward heatmap

The team page (`/team`) groups people by the department org tree and shows, per person: their load for the current week, their assignment picture, and leave status (including who is out now). A **forward capacity heatmap** extends this across upcoming weeks — each cell shows that week's load percentage and can be expanded to the drivers behind it, with the heatmap's cell states derived from the same load engine. This is where you spot that "next week looks fine" is only true for people who are not on leave that week.

## Utilization — what it measures

The utilization report (`/reports/utilization`) answers a different question from the planner: not "what is planned" but "**how much of their capacity did people actually log?**"

- It is built from **time entries** — the time your team actually logs against tasks — divided by capacity over the selected date range, shown per member per week.
- Alongside logged hours it shows **planned hours** for the same weeks, so you can compare plan versus reality in one table.
- A weekly trend chart plots team logged hours as a percentage of team capacity; the whole table exports to CSV.
- Where scheduled load snapshots exist, the report combines live actuals with those snapshots (the report states its data source).

Two honest caveats: utilization is only as good as time logging — if people do not log time, the report shows low utilization that isn't real; and utilization measures *logged effort against capacity*, not outcomes. High utilization is not automatically good, and low utilization is not automatically slack — it is one input into staffing conversations.

## Estimates vs actual work

Estimates and logged time are separate facts, and WorkOps keeps them distinct:

- **Weekly team-load effort** uses manual, AI-cached, median or default hour values. The **daily planner** uses remaining effort or its minute-based task estimate; unknown effort stays visible in the backlog.
- **Time entries** are *actual* work, logged manually or via the task timer.
- The time module computes **estimate-vs-actual variance** per task — under, on, or over estimate, with the delta and ratio — surfaced in time reporting and via the estimate-vs-actual report API.

Over time, recorded actual hours provide more samples for the weekly engine's median fallbacks. These remain estimates, not a guarantee of accuracy or an automatic update to the daily planner's estimate field.

## Snapshots and the scheduled refresh

Forward load is computed on demand for display, and can also be **published as snapshots** — one row per person per week, with load hours, load %, drivers, backlog size, and confidence, fingerprinted by input and calendar version so stale snapshots are detectable and out-of-range weeks are pruned.

Publishing runs through an authenticated HTTP endpoint (`/api/cron/team-load`), protected by `CRON_SECRET`. **Scheduling is operator opt-in**: on Vercel you enable the cron entries you want; self-hosted, you call the endpoint from your own scheduler. Until it runs (or if it never runs), the planner and team page still compute load live — snapshots are an optimization and a history, not a prerequisite.

## What is configured where

| Input | Where it is set | Required? |
| --- | --- | --- |
| Per-person weekly capacity (`capacityPerWeekHours`) | User profile (manager/admin) | No — defaults to 35 h/week |
| Approved leave | Leave module (managers approve) | No — affects capacity only when approved |
| Weekly task effort (`effortHours` / cached `aiEffortHours`) | Task effort values and optional estimation pass | No — weekly medians/default fill gaps |
| Daily planner effort (`remainingEffortHours` / `estimateMinutes`) | Task estimates and planning data | Missing values remain in the planner backlog |
| AI effort estimation | [AI configuration](../configuration.md#ai-optional) | No — fully optional |
| Scheduled load refresh | [Scheduled jobs](../configuration.md#scheduled-jobs) | No — optional; views compute live without it |
| Work-week convention (Sun–Thu) | Built in | Not currently configurable |

## Boundaries to know

- The Sunday–Thursday work week and 5-day capacity pro-rating are fixed conventions, not settings. If your department works a different week, capacity numbers need that caveat.
- The effort chain's median/default fallbacks are estimates, not commitments; confidence and per-driver sources are shown so you can judge them.
- Utilization depends on recorded time. Weekly team load buckets overdue/undated tasks into the current week; the daily planner instead uses planned dates and reports unknown, unassigned or unschedulable work in its backlog.
- No feature here predicts delivery dates or guarantees outcomes — WorkOps shows distribution and history; decisions stay with you.

Related: [Capabilities](../capabilities.md) · [User guide](../user-guide.md) · [Configuration](../configuration.md) · [AI providers](../ai-providers.md)
