# Self-hosting with Docker Compose

> **Verification:** the runner and tools images have been built locally. The Compose flow was
> exercised with empty PostgreSQL 16: all migrations, first administrator/OWNER workspace,
> read-only verification, genuine sign-in, and task creation/readback. Report installation gaps via
> [SUPPORT](../../SUPPORT.md).

## How the stack fits together

For unattended initialization, use `docker compose run --rm -e WORKOPS_DB_INIT_ON_BUILD=1 tools npm run db:setup` after explicitly selecting a fresh empty database. For unattended administrator creation, pass your own credentials through environment variables with `-e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD`; never put a reusable password in a shell command or a published example.

`compose.yaml` defines three services:

| Service | Image | Purpose |
|---|---|---|
| `db` | `postgres:16-bookworm` | The only stateful part. Data lives in the `workops_pgdata` volume; the port is **not** published to the host by default. Health-checked with `pg_isready`. |
| `app` | built from `Dockerfile` target `runner` | The lean production server: standalone Next.js output plus OpenSSL. It intentionally contains **no npm, tsx, Prisma CLI or setup scripts** — a smaller surface, nothing to exploit at request time. |
| `tools` | built from `Dockerfile` target `tools` | A **builder-derived image with full dependencies** (npm, tsx, Prisma CLI, `scripts/setup`). Used only for one-off database work. It is under `profiles: ["tools"]`, so `docker compose up` never starts it — `docker compose run` starts it on demand and `--rm` discards it afterwards. |

`app` and `tools` share one environment anchor (`x-app-env`), so both always see the same
database and settings.

**The one rule to remember:** `docker compose exec app npm run …` does **not** work and is not
supposed to. All database operations go through the tools image:

```bash
docker compose run --rm tools npm run db:setup      # empty-database init
docker compose run --rm tools npm run setup:admin   # first admin
docker compose run --rm tools npm run db:deploy     # pending migrations
docker compose run --rm tools npm run setup:verify  # read-only health check
```

Run these from an interactive terminal: `docker compose run` allocates a TTY, which
`db:setup` (confirmation prompt) and `setup:admin` (hidden password prompt) need.

## Prerequisites

- Docker Engine 24+ with Compose v2 (`docker compose version`)
- ~2 GB free RAM for the stack
- A terminal (for the interactive confirmations above)

## 1. Configure the environment

```bash
cp .env.example .env
```

Required — compose refuses to boot without them:

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | Strong random, **no default on purpose** (`openssl rand -base64 24`). It is embedded in `DATABASE_URL`, so avoid URL-special characters (`@ : / ? # %`) or percent-encode them. |
| `AUTH_SECRET` | `openssl rand -base64 32` — Auth.js JWT signing secret. |
| `NEXTAUTH_URL` | Absolute base URL, e.g. `http://localhost:3000` or `https://workops.example.com`. |

Recommended:

| Variable | Notes |
|---|---|
| `COMMUNICATION_INTERNAL_DOMAINS` | Comma-separated internal email domains. Fail-closed: unset/empty disables the internal-communication features. |
| `POSTGRES_DB`, `POSTGRES_USER` | **Choose explicitly before first start** (defaults `workops`/`workops`). The Postgres volume is initialized with them on first boot; changing them later means recreating the volume. |
| `APP_PORT` | Host port for the app (default `3000`). |

Optional integrations (unset = feature off): `RESEND_API_KEY`/`EMAIL_FROM`, `GLM_API_KEY`,
`CRON_SECRET`, `SABAH_CREDENTIAL_KEY`, `WEB_PUSH_VAPID_*`, `AZURE_AD_*`.
Full reference: [configuration](../configuration.md).

## 2. Start the stack

```bash
docker compose up -d --build
docker compose ps          # db: healthy, app: running
```

## 3. Initialize the database (empty-only)

```bash
docker compose run --rm tools npm run db:setup
```

Safety contract (unit-tested in `scripts/setup/lib`):

- Proceeds **only when the target database has zero tables**. It applies the full historical
  migration chain via `prisma migrate deploy` — it creates schema, it never drops or truncates.
- Asks you to type `yes` before writing anything.
- Exit `2`: the database already has WorkOps migration history → use `db:deploy` instead.
- Exit `3`: non-empty schema with **no** WorkOps history (possible production/other app) →
  double-check `DATABASE_URL`; nothing was written.
- Non-interactive contexts refuse unless you explicitly set `WORKOPS_DB_INIT_ON_BUILD=1`
  (the exact value `1` — this IS the consent).

The target is `db:5432/<POSTGRES_DB>` from your `.env`. To initialize a **different, explicitly
chosen** database, set `POSTGRES_DB` before the first `up` (or point `DATABASE_URL` at it);
the empty-only guard makes a wrong guess fail loudly instead of writing to the wrong place.

## 4. Create the first admin

```bash
docker compose run --rm tools npm run setup:admin
```

- Prompts for email, optional name, and a **hidden** password (min 12 chars, letters + digits,
  not email-derived or common). Never printed, logged, or stored in plain text (bcrypt, cost 12).
- **Refuses (exit 4) when any user already exists** — bootstrap is first-admin-only. Manage
  later users inside the app (Settings › team).
- Scripted installs: set `ADMIN_EMAIL`, `ADMIN_NAME` (optional, defaults `WorkOps Admin`) and
  `ADMIN_PASSWORD` in the environment instead of prompting.

## 5. Verify the install

```bash
docker compose run --rm tools npm run setup:verify
```

Read-only doctor: required/optional env vars, database reachability and state, user/admin
counts, applied-migration count, next-step advice. Exit `5` = missing required env, `6` =
database unreachable, `3` = unknown non-empty schema.

## 6. Sign in

Open `http://localhost:3000/login` (or `NEXTAUTH_URL`) with the admin credentials.

## Day-2 operations

**Backups** — see [database.md](database.md). Quick form:

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "workops-$(date +%F).sql"
```

**Upgrades** — in this order:

1. Take and verify a fresh backup.
2. `git pull` (or check out the new tag), then `docker compose build --pull`.
3. `docker compose run --rm tools npm run db:deploy` — pending-only, safe, idempotent.
4. `docker compose up -d` to roll the new app forward.
5. `docker compose run --rm tools npm run setup:verify`.
6. Rollback = stop the stack, restore the backup, start the previous image (tag builds, e.g.
   `docker tag` after each successful upgrade, before discarding the old image).

**Changing env vars** — edit `.env`, then `docker compose up -d` to recreate the containers.

**Reverse proxy / TLS** — terminate TLS upstream (Caddy, Traefik, nginx). Set `NEXTAUTH_URL`
to the public URL; `AUTH_TRUST_HOST=true` is already set by compose. Publish only `APP_PORT`;
keep 5432 unpublished (or bind it to `127.0.0.1` only, as noted in `compose.yaml`).

**Teardown** — `docker compose down` keeps the volume; `docker compose down -v` **destroys the
database**.

## Demo data

None. The compose stack initializes empty databases only, by design; there is no seeded demo
path here. (The legacy `npm run db:demo` seed is deprecated and not part of this stack — do not
run it against a database you care about.)
