# Security Policy

## Supported configuration

WorkOps is an early-stage, self-hosted open-source application. Security fixes are made on the default branch; there are no long-term-support release branches yet. Review updates and redeploy to pick up fixes.

### Dependency audit snapshot

For the initial publication on 2026-10-19, `npm audit --omit=dev` reports **zero runtime dependency findings**. The full audit retains **seven high-severity development/build-tool findings** in the Tailwind 3 and Next ESLint glob-watching chains. These are disclosed, not suppressed; compatible fixes were applied where available, while a breaking Tailwind/Next migration was not forced into this release. This snapshot is not a security certification or a claim that future audits will remain unchanged. Run audits against your installed lockfile and keep build inputs trusted.

## Reporting a vulnerability

**Please do not report vulnerabilities through public GitHub issues.**

Use GitHub's **private security advisory** feature (Security tab → Report a vulnerability) to contact the maintainer confidentially.

Include what you can of: the affected area (auth, permissions, AI workflows, API routes, deployment), reproduction steps, and impact. Please give the maintainer a reasonable window to address the issue before any public disclosure.

This is a best-effort, unfunded project: there is no security team, no bug bounty, and no guaranteed response time.

## Scope

In scope:

- Authentication and session handling (credentials login, JWT sessions, email verification, password reset)
- Authorization — anything that lets a user read or modify data beyond their role or workspace permissions
- The AI subsystem's approval and write-gating behavior (e.g., the assistant performing actions a user could not perform themselves)
- Injection, SSRF, or data exposure through API routes
- Secrets leaking through the client bundle or public assets

Out of scope:

- Misconfigured self-hosted deployments (publicly exposed databases, missing `AUTH_SECRET`, disabled HTTPS) — see [docs/configuration.md](docs/configuration.md) and the deployment guides for hardening guidance
- Vulnerabilities in dependencies — report upstream, but you may also file an advisory here so the dependency can be bumped
- The optional Microsoft Entra ID integration's own behavior — report those to Microsoft

## Security-relevant behavior to know about

- Passwords are hashed with bcrypt; production sign-in requires a verified email and a set password (development mode relaxes these — never run `NODE_ENV=development` facing the internet).
- Login attempts are rate-limited per account/IP.
- JWT sessions carry the user's role and a password version; changing a password or deactivating a user invalidates existing sessions on refresh.
- Scheduled-job endpoints are meant to be protected with `CRON_SECRET`.
- AI features are disabled until a model provider is configured, and admin-managed provider credentials are encrypted at rest with `SABAH_CREDENTIAL_KEY`.

## Deployment hardening

See [docs/configuration.md](docs/configuration.md) and the deployment guides under [`docs/deployment/`](docs/deployment/) for required environment settings, HTTPS, and cron protection.
