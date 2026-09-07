# Railway deployment

This layout runs PostgreSQL, a backend service containing the API and Graphile
worker, and a separate web service. API and worker share the backend's `/data`
volume because Rakazo's filesystem storage must be shared between those processes.
Run one backend replica and disable service sleeping.

The Dockerfile reuses the published upstream image pinned to commit
`8bb0f4ea65a3dbe312208fca5396ff742dafdaad`, overlays this checkout, installs the
frozen lockfile, generates Prisma, runs focused provider/launcher tests, and
rebuilds the web app. Deploy both services from the same checkout using
`infra/railway/Dockerfile`. Local `.tmp` files are excluded from the Docker context.

Pi 0.85.1 supplies GPT-6 Astra (`gpt-6-astra`) for both OpenAI API credentials and
ChatGPT subscription sign-in. Select it in Models after connecting the relevant
account. Supported reasoning levels are low, medium, high, xhigh, and max; the
model accepts text and images. Account entitlement is still required. Regression
tests check catalog/runtime agreement and intercept actual Responses payloads
before network dispatch. They do not prove an account has access to Astra.

## Backend

- Dockerfile: `infra/railway/Dockerfile`
- Start command: `node /app/infra/railway/start-backend.mjs`
- Volume: `/data`
- Port: `3100`, private networking only
- Healthcheck: `/health`
- `API_HOST=::`, `API_PORT=3100`, `DATA_DIR=/data`, `NODE_ENV=production`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `AGENT_RUNTIME=pi`, `WAKEUP_DRIVER=graphile`, `SANDBOX_PROVIDER=none`
- `CLOUD_AGENT_PROVIDER=none`, `SIGNUPS_ENABLED=false`
- Independent random `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `SCREEN_PROXY_SECRET`
- Set `BETTER_AUTH_URL`, `WEB_ORIGIN`, and `API_URL` to the public HTTPS web origin.

The launcher initializes volume ownership and drops root privileges, runs Prisma
migrations, then starts API and worker. Either child exiting stops the group so
Railway can restart it. SIGTERM drains both children before shutdown.

## Web

- Dockerfile: `infra/railway/Dockerfile`, same revision as the backend.
- Start command: `node /app/infra/railway/start-web.mjs`.
- Run as UID 1000 (`RAILWAY_RUN_UID=1000`); only the backend launcher needs root
  initially to prepare its volume.
- Public HTTPS domain targets port `5173`.
- `API_PROXY_TARGET=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:3100`
- `RAKAZO_HOST` is the public hostname, without the scheme.
- `SCREEN_PROXY_SECRET` must match the backend.
- `WEB_PORT=5173`, `PORT=5173`, `NODE_ENV=production`
- The launcher explicitly allows the public hostname and
  `healthcheck.railway.app` in `preview.allowedHosts`, and runs from the web
  directory so Lingui finds its configuration. Vite's additional-server-hosts
  environment variable does not extend this application's explicit preview list.
- Healthcheck: `/`. Also verify an API request through the web proxy; the web
  healthcheck alone does not establish backend readiness.

## PostgreSQL

Use PostgreSQL 16 with a volume at `/var/lib/postgresql/data`,
`PGDATA=/var/lib/postgresql/data/pgdata`, and an independent random password.
Expose it only through Railway private networking. Its `DATABASE_URL` should use
the private hostname and reference its password variable.

## Owner access and verification

Keep registration closed on this public deployment. Provision the initial owner
privately using Better Auth password hashing and Rakazo's `bootstrapUserSpace`
helper; verify owner and membership records before exposing login. Never include
credentials in source or command arguments. Persistent signup policy is stored
in the database, so editing `SIGNUPS_ENABLED` after first startup does not change
the existing policy.

Verify all three Railway services, PostgreSQL connectivity, the worker startup
log, API `/health`, public sign-in, and the model catalog. Connect ChatGPT through
Rakazo's **Models** UI using the user's own interactive sign-in. A healthy core
deployment without a model connection cannot answer bot messages.

This deployment intentionally uses `SANDBOX_PROVIDER=none`. Railway's normal
service containers cannot run the privileged Docker supervisor used by the local
Compose setup. Connect E2B, Daytona, Box (ascii.dev), or a separately hosted Docker
supervisor before claiming browser/desktop computer support. No external provider
credential is needed to deploy the core.

Local launcher checks require only Node:

```sh
node --test infra/railway/start-backend.test.mjs
```

Deploy backend changes with `railway up --service backend --detach` after linking
this directory to the intended project and environment. This uploads local source;
it does not publish a Git commit or configure GitHub autodeployment.
