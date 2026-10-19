# WorkOps Documentation

WorkOps is a self-hosted work-management application for departments and small teams — [overview in the README](../README.md). Start here:

| | Document | What it covers |
| --- | --- | --- |
| 🚀 | [Getting started](getting-started.md) | Prerequisites, install, database initialization, first admin, first run |
| 📖 | [User guide](user-guide.md) | Every module explained: tasks, projects, planner, PMO, KPIs, AI assistant |
| 🧭 | [Capabilities](capabilities.md) | Feature-by-feature reference and what each requires |
| ⚙️ | [Configuration](configuration.md) | Environment variables, integrations, scheduled jobs |
| 🏗️ | [Architecture](architecture.md) | Stack, data model, authentication, AI subsystem, notifications |
| 🛠️ | [Development](development.md) | Local development, tests, migration discipline |
| ❓ | [FAQ](faq.md) | Data, AI, accounts, operations questions |

## Deploying

| Guide | Purpose |
| --- | --- |
| [Vercel](deployment/vercel.md) | Deploying to Vercel, including scheduled jobs |
| [Self-hosting](deployment/self-hosting.md) | Docker and bare-server operation |
| [Database](deployment/database.md) | Creating a new database, applying migrations safely |

## Community & project

- [Roadmap](../ROADMAP.md) — Now / Next / Later
- [Contributing](../CONTRIBUTING.md) · [Security policy](../SECURITY.md) · [Support](../SUPPORT.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

## Conventions used in these docs

- Commands assume the repository root and `npm` as the package manager.
- Variables shown as `LIKE_THIS` are environment variables from [.env.example](../.env.example).
- Features that call external services (email, AI, push) are always optional; the core application runs without them.
