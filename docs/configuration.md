# Configuration

All configuration is via environment variables (see [.env.example](../.env.example) for the canonical template). Only the core group is required; everything else enables an optional integration.

## Core (required)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/workops?schema=public` |
| `AUTH_SECRET` | Signing secret for Auth.js (NextAuth) JWT sessions. Generate with `openssl rand -base64 32`. Rotate with care — rotation invalidates existing sessions. |
| `NEXTAUTH_URL` | Canonical origin (used by auth callbacks). Must match how users reach the app. |
| `APP_BASE_URL` | Canonical origin used when building links (e.g., in emails). |

`AUTH_TRUST_HOST=true` is acceptable for local development; on a real host, set the canonical URL instead of trusting arbitrary hosts.

## Email (Resend)

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | API key for [Resend](https://resend.com), used for verification, password reset, and notification emails |
| `EMAIL_FROM` | From address, e.g. `WorkOps <noreply@your-domain.example>` (a default exists, but set your own) |
| `COMMUNICATION_INTERNAL_DOMAINS` | Comma-separated domains trusted for manually entered digest recipients, e.g. `example.com,team.example.org`. Unset means no domain is implicitly trusted. External delivery still requires the existing explicit approval flow. |

Without email configured, password reset and email verification cannot complete — bootstrap your first admin as described in [Getting started](getting-started.md#5-create-the-first-administrator) and use in-app password change (Settings → Security) afterwards.

## AI (optional)

| Variable | Purpose |
| --- | --- |
| `GLM_API_KEY` | Key for a GLM-compatible provider (default AI target). The default model is a GLM flash-class model; admins can change model assignment per role. |
| `SABAH_CREDENTIAL_KEY` | Base64 32-byte key used to encrypt admin-managed provider credentials at rest. Set it **before** admins register provider credentials, and preserve it — losing it makes stored credentials undecryptable. |

AI is off unless configured. With a key present, chat/intake/assist features activate; workflows, jobs, monitors, connectors, and model assignments are administered in-app by admins and additionally gated behind explicit configuration. See [Architecture → AI subsystem](architecture.md#ai-subsystem).

## Microsoft Entra ID — optional

| Variable | Purpose |
| --- | --- |
| `AZURE_AD_CLIENT_ID` | Application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | Client secret |
| `AZURE_AD_TENANT_ID` | Tenant ID |

Adds an Entra ID sign-in option **alongside** credentials auth (credentials remain available). The provider is only registered when the client ID variable is set.

## Scheduled jobs

Background work runs through HTTP endpoints under `/api/cron/*`, each requiring `Authorization: Bearer $CRON_SECRET`:

| Variable | Purpose |
| --- | --- |
| `CRON_SECRET` | Shared secret for all `/api/cron/*` endpoints |

Endpoints present: due-task reminders, KPI reminders, PMO reminders, recurring-task processing, weekly summary, Sunday digest, weekly close nudge, team-load refresh, communications dispatch, and Sabah jobs/monitors. Legacy provider-specific backup code is not a portable PostgreSQL backup strategy; configure and restore-test your own database backups.

- **On Vercel**, [`vercel.json`](../vercel.json) ships without scheduled jobs. Enable only the endpoints you need, within your plan's cron limits; Vercel sends the `Authorization: Bearer $CRON_SECRET` header when that variable is set. See [deployment/vercel.md](deployment/vercel.md).
- **Self-hosted**, call the endpoints from your own scheduler (cron, systemd timer, etc.) with the header, e.g.:
  `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/due-reminders`
  (Check the individual endpoint for whether it expects GET or POST; the exact path list lives in `src/app/api/cron/`.)

Jobs are safe to skip on a laptop dev setup — reminders simply won't fire.

## Push notifications & webhooks — optional

| Variable | Purpose |
| --- | --- |
| `PWA_SUBSCRIPTION_KEY` | Key used to encrypt stored web-push subscriptions (falls back to `SABAH_CREDENTIAL_KEY`) |
| `WEBHOOK_SECRET` | Signing secret for inbound email/webhook routes |

## Notes

- Never commit real values. `.env*` files are gitignored except `.env.example`.
- Production sign-in requires users to have a **set password and verified email**; development mode relaxes this. Never run internet-facing with `NODE_ENV=development`.
- For deployment-specific configuration (platforms, TLS, process management), see the deployment guides: [Vercel](deployment/vercel.md), [Self-hosting](deployment/self-hosting.md), [Database](deployment/database.md).
