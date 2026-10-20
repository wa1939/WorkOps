# Contributing to WorkOps

Thank you for considering a contribution. WorkOps is an MIT-licensed, self-hosted work-management application, and contributions of code, documentation, and bug reports are welcome.

## Ways to contribute

- **Bug reports** — use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include your deployment type (Docker, Vercel, bare server, local dev), the commit you run, and relevant logs.
- **Feature proposals** — open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml). Describe the department workflow you are trying to support; concrete use cases carry more weight than abstract feature lists.
- **Documentation** — fixes and additions under [`docs/`](docs/README.md) are a great first contribution.
- **Code** — see the workflow below.

## Development setup

Follow [Getting started](docs/getting-started.md) for a full local install. The short version:

```bash
npm ci
cp .env.example .env        # point DATABASE_URL at a LOCAL, disposable database
npm run db:setup            # initialize the schema (see package.json for current scripts)
npm run dev
```

Development conventions and the test/migration workflow are described in [docs/development.md](docs/development.md). Read it before your first PR — especially the database safety rules.

## Database safety (non-negotiable)

This project uses **Prisma Migrate only**. Several operators run real departments on this codebase, and destructive database operations have caused data loss before.

- Never use `prisma db push`, `prisma migrate reset`, or `--force` flags against any shared or production database.
- Generate schema changes with `npm run db:migrate:dev` (it guards against accidentally targeting a non-local database) and **read the generated SQL** before committing it.
- PRs that include migrations must say so in the PR template checklist.

## Workflow

1. **Branch** from the default branch. Suggested naming: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. **Commit** with Conventional-Commit-style messages (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`), matching the existing history.
3. **Test** what you changed:
   - `npm run test:unit` — Vitest unit/component tests
   - `npm run lint` — ESLint
   - `npm run test:e2e` — Playwright end-to-end tests (requires a local test database; the script asserts you are not pointing at a shared database before it runs)
   - UI changes: include before/after screenshots in the PR.
4. **Open a PR** using the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). Keep PRs focused; separate refactors from behavior changes where you can.
5. **Respond to review**. Reviews are best-effort by the maintainer — there is no guaranteed turnaround time.

## Code style

### Protected default branch

Submit changes through a pull request. The default branch requires an up-to-date passing `test` check, an approving review, code-owner review where ownership applies, approval of the latest push, and resolved review conversations. Stale approvals are dismissed on new commits. Force-pushes and branch deletion are blocked separately, without a bypass. Repository administrators retain an explicit PR-only recovery bypass for the review/check rules; it is not the normal contribution route.

GitHub Actions tokens default to read-only and cannot approve PRs. All external fork contributors require maintainer approval before their workflows run. Never introduce `pull_request_target` execution of untrusted PR code or give forked code deployment secrets. Pin third-party actions to immutable commits and review dependency update PRs rather than auto-merging them.

- TypeScript throughout; keep new code typed, and avoid `any` where a real type is reachable.
- Follow the surrounding file's formatting; ESLint (`npm run lint`) is the arbiter.
- Prefer server-side authorization checks; the app enforces permissions in API routes, not only in the UI.
- UI is built with Tailwind CSS and Radix-based components in [`src/components/ui`](src/components/ui) — reuse them before adding new primitives.

## Licensing

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) that covers the project.

## Questions

See [SUPPORT.md](SUPPORT.md) for where to ask questions.
