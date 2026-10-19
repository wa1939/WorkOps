# Development

Setting up a WorkOps development environment and the project's working rules.

## Setup

Follow [Getting started](getting-started.md) — the short version:

```bash
npm ci
cp .env.example .env      # point DATABASE_URL at a LOCAL, disposable database
npm run db:setup          # or the manual migration path described there
npm run dev
```

## Scripts

Verified against [`package.json`](../package.json):

| Script | What it does |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run start` | `prisma migrate deploy` then `next start` |
| `npm run lint` | ESLint (next config) |
| `npm run test:unit` | Vitest unit/component tests |
| `npm run test:unit:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright e2e, guarded by the local-database check |
| `npm run db:migrate:dev` | `prisma migrate dev` behind the local-database check |
| `npm run db:seed` | Development seed (see [Getting started](getting-started.md#5-create-the-first-administrator) for caveats) |

`postinstall` runs `prisma generate`. First-run setup uses `db:setup` and `setup:admin`; optional synthetic data requires `WORKOPS_DEMO_SEED=1 npm run db:demo`. See [Getting started](getting-started.md) for the complete sequence.

## Database rules (please internalize these)

This codebase runs real departments. A past incident — a schema-sync command dropping production tables — is why these rules exist:

1. **Prisma Migrate only.** Never `prisma db push`, never `migrate reset`, never `--force` on any database with data you care about.
2. **Local first.** Generate changes with `npm run db:migrate:dev -- --name describe-the-change`. The wrapper asserts your `DATABASE_URL` looks local and refuses otherwise.
3. **Read the SQL.** Every migration is a file under `prisma/migrations/`. Review it before committing; destructive statements must be justified in the PR.
4. **Migrations are append-only history.** Don't edit applied migrations; add a new one.

## Testing

- **Unit/component** (`npm run test:unit`): colocated `*.test.ts(x)` files, Vitest + Testing Library. Add tests alongside new lib logic — the codebase has strong coverage of authz, AI gates, and task queries, so follow the local pattern.
- **E2E** (`npm run test:e2e`): Playwright specs in `e2e/`. The script runs behind `scripts/assert-local-database.ts`, which hard-fails if `DATABASE_URL` doesn't look local — e2e writes real data.
- **Lint** (`npm run lint`) must pass; match surrounding formatting.

## Codebase conventions

- **TypeScript everywhere**; keep types honest and avoid `any` where a real type exists.
- **Server-side authorization**: new API routes must check role and workspace permissions in the handler (see `src/lib/authz/`), not just hide UI.
- **UI**: Tailwind + Radix primitives in `src/components/ui`; reuse before introducing new components.
- **Workspace-awareness**: new tables/queries should consider workspace scoping and the audit log where security-relevant.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`), matching existing history.

## Adding an environment variable

1. Add it to [.env.example](../.env.example) with a comment (no real values).
2. Read it through a single access point where practical (e.g., `src/lib/glm.ts` for AI settings).
3. Document it in [Configuration](configuration.md) — including whether the feature is optional and what breaks without it.
4. Fail loudly and early at runtime if a required variable is missing; degrade gracefully for optional ones.

## AI-related development

- Provider resolution lives in `src/lib/glm.ts` (default GLM target, fallback model, admin-assigned alternatives).
- New assistant capabilities must respect the write gates and permission scoping — see [Architecture → AI subsystem](architecture.md#ai-subsystem) and the existing tests (`src/lib/ai/*.test.ts`) for the expected shape.
- Anything autonomous (jobs, monitors, connectors) stays behind explicit admin configuration; don't add default-on autonomy.

## Where to make changes

| Area | Path |
| --- | --- |
| A module's pages | `src/app/(app)/<module>/` |
| An API surface | `src/app/api/<area>/` |
| Shared logic | `src/lib/<area>/` |
| Schema | `prisma/schema.prisma` + a new migration |
| These docs | `docs/` |

Then see [CONTRIBUTING](../CONTRIBUTING.md) for the branch/PR process.
