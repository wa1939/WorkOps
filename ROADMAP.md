# WorkOps Roadmap

This document describes the project's direction. It is a summary of intent, **not a commitment schedule** — there are no dates, and items can change or be dropped based on real usage. Works in progress and completed changes are visible in the repository history.

## Now — in flight

The current focus is making WorkOps a credible open-source product:

- **Open-source packaging** — MIT licensing, public documentation, honest feature presentation, and this repository's preparation for first publication.
- **Portable deployment** — host-neutral paths (Vercel, self-hosted Docker/server), a safe initialization path for brand-new databases, and a first-admin bootstrap, alongside the existing migration discipline.
- **Custom views & personal home** — the block-based view builder (task lists, charts, stat tiles, notes, embeds) and opt-in custom home pages are being completed and hardened.
- **AI workflow hardening** — Sabah's approval gates, job scheduling, and monitoring continue to be tightened so that AI-driven actions stay permission-grounded and reviewable.

## Next — planned next steps

- **First-run experience** — smoother out-of-the-box onboarding: clearer empty states, demo data for evaluation, and a guided first administrator setup.
- **Documentation depth** — expand self-hosting troubleshooting, backup/restore guidance for operators, and worked configuration examples.
- **Reporting polish** — iteratively improve weekly reports, utilization views, and PMO timelines based on day-to-day usage.

## Later — under consideration (no commitments)

Ideas being kept in view, without promises:

- Additional outbound integrations and connectors beyond the current AI/webhook surfaces
- More granular workload and capacity analytics
- Localization of the interface beyond English
- Packaging improvements for one-command self-hosting

## How direction is decided

WorkOps grew inside a real department, and the backlog is driven by what that usage exposes. Feature requests that describe a concrete department workflow (via the issue templates) are the strongest input. Nothing here is a commitment to a date or a release; see [SUPPORT.md](SUPPORT.md) for how to raise a need.
