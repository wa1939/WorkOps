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
| `AI_PROVIDER` | `openai`, `anthropic` (native Claude API), `openai-compatible` (custom service), `zai`, or `nuha`. Unset preserves legacy GLM/Nuha routing. |
| `AI_MODEL` | Exact model identifier available to your account or local server. Model names are configurable, not restricted to bundled examples. Required with `AI_PROVIDER`. |
| `AI_API_KEY` | Server-only key for the selected provider. Alternatively use `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_COMPATIBLE_API_KEY`. |
| `AI_BASE_URL` | Operator-defined API base URL for `openai-compatible`, including the version path such as `/v1`. Used for custom Nuha deployments, proxies, or compatible local servers; never taken from chat input. |
| `AI_ALLOW_HTTP` | Set exactly `1` only for an operator-owned HTTP endpoint, such as a local model server. HTTPS is required by default. Never embed credentials in the URL. |
| `GLM_API_KEY` / `NUHA_API_KEY` | Backward-compatible keys for existing Z.AI and Nuha configurations. Neither is required for OpenAI, Claude, or a custom compatible service. |
| `SABAH_CREDENTIAL_KEY` | Base64 32-byte key used to encrypt admin-managed provider credentials at rest. Set it **before** admins register provider credentials, and preserve it — losing it makes stored credentials undecryptable. |

Choose the provider, enter its key and model ID, and restart the application. For a custom OpenAI-compatible service, also set its endpoint. No source edits are needed. The shared text and streaming layer powers chat, task assistance, report generation, workload insights, and work briefs. OpenAI and compatible services use chat completions; Claude uses Anthropic's native Messages API through its official SDK, not an OpenAI shim.

For example, OpenAI uses `AI_PROVIDER=openai` plus your `AI_MODEL` and `AI_API_KEY`; Claude uses `AI_PROVIDER=anthropic`; a custom Nuha endpoint uses `AI_PROVIDER=openai-compatible` plus `AI_BASE_URL`. API keys go only into server/platform secret settings, never the browser bundle or a committed file.

Saved administrator CHAT/COMPRESSION role assignments take precedence over the deployment defaults for those roles. The admin screen supports encrypted keys and editable model identifiers. Custom endpoints remain server-operator configuration rather than arbitrary URLs submitted through a public API. New OpenAI, Anthropic, and custom routes do **not** silently fall back to other vendors; cross-provider fallback must be explicitly configured. Existing legacy GLM/Nuha fallback settings are preserved.

AI is off unless configured. Core work management does not require an AI account. Models must support the features you use (chat, tool calls, images, structured output); protocol compatibility is not a guarantee that every model implements every feature. Provider protocol tests use synthetic, mocked responses, not a certification of every third-party service. Workflows, jobs, monitors and connectors additionally require explicit configuration. See [Architecture → AI subsystem](architecture.md#ai-subsystem).

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

Optional GitHub scheduler templates are included for Sabah job-lease recovery and monitors. They make no requests by default. To opt in, configure the `sabah-schedulers` environment with your own HTTPS `APP_BASE_URL` and `CRON_SECRET` secrets, then set repository variable `SABAH_SCHEDULERS_ENABLED=true`. Manual dispatch is an explicit opt-in too. Do not copy another deployment's credentials, and avoid running duplicate schedules if your host already manages them.

## Push notifications & webhooks — optional

| Variable | Purpose |
| --- | --- |
| `PWA_SUBSCRIPTION_KEY` | Key used to encrypt stored web-push subscriptions (falls back to `SABAH_CREDENTIAL_KEY`) |
| `WEBHOOK_SECRET` | Signing secret for inbound email/webhook routes |

## Notes

- Never commit real values. `.env*` files are gitignored except `.env.example`.
- Production sign-in requires users to have a **set password and verified email**; development mode relaxes this. Never run internet-facing with `NODE_ENV=development`.
- For deployment-specific configuration (platforms, TLS, process management), see the deployment guides: [Vercel](deployment/vercel.md), [Self-hosting](deployment/self-hosting.md), [Database](deployment/database.md).
