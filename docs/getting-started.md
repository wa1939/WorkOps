# Getting started

This guide takes you from zero to a running WorkOps instance on your machine. For server deployments, read this first, then the deployment guides: [Vercel](deployment/vercel.md), [Self-hosting](deployment/self-hosting.md), [Database](deployment/database.md).

## Prerequisites

- **Node.js 22.22.2** or a compatible newer runtime (see `package.json`) and **npm**
- **PostgreSQL** — the schema is developed against PostgreSQL 16
- Optional integrations later: a Resend account (email), your choice of OpenAI, Anthropic/Claude, or an OpenAI-compatible service (AI features)

## 1. Get the code and install

```bash
git clone https://github.com/wa1939/WorkOps.git
cd WorkOps
npm ci
```

`npm ci` runs `prisma generate` automatically (postinstall), so the Prisma client is ready after install.
If you downloaded a source archive instead, extract it, open its directory and start with `npm ci`.

## 2. Configure the environment

```bash
cp .env.example .env
```

Minimum for local development:

| Variable | Example / notes |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:...@localhost:5432/workops?schema=public` |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `APP_BASE_URL` | `http://localhost:3000` (used for links in emails) |

`AUTH_TRUST_HOST=true` is already set in the example file for local development. The full variable reference — including optional email, AI, Entra ID, push, and cron settings — is in [Configuration](configuration.md).

## 3. Create an empty database

Create a **new, empty** database. For example:

```sql
CREATE DATABASE workops;
```

Nothing else is needed — WorkOps brings its own schema via committed Prisma migrations.

## 4. Initialize the schema

```bash
npm run db:setup
```

`db:setup` initializes an empty database using the committed migration chain. It refuses unknown non-empty schemas; it does not reset an existing installation. For an existing WorkOps installation, review pending migrations and follow the [database guide](deployment/database.md).

WorkOps uses **Prisma Migrate only**. Never use `prisma db push`, `migrate reset`, or `--force` against any database holding real data.

## 5. Create the first administrator

```bash
npm run setup:admin
```

Follow the email, name and hidden-password prompts. For unattended setup, provide `ADMIN_EMAIL`, `ADMIN_NAME` and a unique `ADMIN_PASSWORD` (12+ characters, including letters and digits). The script creates a verified active administrator, a WorkOps workspace and its OWNER membership. If any user already exists, it refuses to overwrite credentials or elevate an account.

Why a script: in production mode, signing in requires a **set password and a verified email**. Without transactional email configured, an account created through the sign-up page cannot verify itself — so the first administrator is bootstrapped directly.

There is no reusable demo password. Create your administrator first; optional demo loading below preserves its credentials.

## 6. Run and sign in

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the administrator account. In development mode the password/verification checks are relaxed (see [Architecture → Authentication](architecture.md#authentication)), but anything you intend to expose beyond your machine should run with production settings.

## 7. Optional: demo data

```bash
WORKOPS_DEMO_SEED=1 npm run db:demo
```

This is an explicit, local-only synthetic-data operation for a new demonstration database. It refuses production mode, remote hosts and conflicting real task/project/KPI data. It never deletes existing records or publishes a shared password. `db:seed` is an alias of the same guarded seeder. See [Demo data](demo-data.md) for its scope and safeguards.

## 8. Verify the install

- The sign-in page loads and accepts the administrator account.
- Creating a task, a project, and a note works.
- The health endpoint responds: `GET /api/health`.
- `npm run setup:verify` checks the configured database, migration state and active administrator without modifying them.

## Next steps

- Turn on [email](configuration.md#email-resend) so verification, password reset, and notification emails work.
- Optionally [configure AI](configuration.md#ai-optional) — core work tracking does not require it.
- Set up [scheduled jobs](configuration.md#scheduled-jobs) (reminders and digests) for a long-running deployment.
- Read the [user guide](user-guide.md) for how the modules fit together.
