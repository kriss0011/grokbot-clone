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

`SANDBOX_PROVIDER=none` supports core setup only: sending a bot message still
requires a computer. Railway's ordinary service containers cannot run this Docker
supervisor. A dedicated Railway Cloud Agent VM can run it with Docker 29's native
nftables firewall backend. Cloud Agent VMs are a beta product billed at VM rates;
they must stay running for bot messages to work. Alternatively use E2B, Daytona,
Box (ascii.dev), or another Docker host.

## Dedicated computer VM

Install Docker 29, its Buildx plugin, and this checkout on the dedicated VM.
Build the desktop image with `docker build -t grokbot/computer:local
infra/sandboxes/computer`. Create `/etc/grokbot-computer.env` with mode 600 and
two values: an independent random `SANDBOX_SUPERVISOR_TOKEN` (at least 32 bytes)
and `COMPUTER_PUBLIC_ORIGIN=https://<vm-public-domain>`. Never reuse account,
database, or model credentials for this token.

Run `bash infra/railway/start-computer-vm.sh` as root. It starts Docker, an
unprivileged supervisor with Docker socket access, and a gateway on port 8080.
Each computer has a separate Docker network, resource limits, and its own home
under `/data/homes`. Only these homes are mounted into bot containers. The
supervisor creates homes on the VM; API/worker files remain on their Railway
volume and use the sandbox file adapter to access the remote computer.

The startup script selects `SANDBOX_EXEC_TRANSPORT=http`. This opt-in transport
runs commands through a token-protected listener on port 7071 inside each
computer, because OCI `docker exec` did not enter the correct filesystem on the
tested Cloud Agent VM. The listener runs as the container's unprivileged user,
bounds command duration/output, and supports cancellation and binary stdin.
It is reachable only from the VM and its computer's isolated network. The
default Docker exec transport remains unchanged for normal Docker hosts.
Deploy the matching computer image and supervisor source together when updating
this transport; the startup script mounts this checkout's supervisor source.

The gateway authenticates supervisor requests and translates desktop URLs into
expiring, signed loopback-port capabilities. The web app seals remote desktop
targets and restores VNC tokens server-side. Docker's socket, supervisor port,
and desktop ports are never published directly to the internet.

Set the backend to `SANDBOX_PROVIDER=docker`,
`SANDBOX_SUPERVISOR_URL=https://<vm-public-domain>`, and the same supervisor token.
Deploy both backend and web from this revision. Check `/health`, an actual bot
response, a sandbox command, and the authenticated desktop websocket.

Containers restart after a Docker daemon restart. Railway sleep preserves the
disk but stops processes: after manually waking a VM, run the startup script
again over SSH. Avoid sleeping the VM while bots are needed. The ephemeral
Railway Sandbox product has an idle destruction limit and is not a substitute
for this persistent VM. No local laptop process or SSH tunnel is required for
normal operation.

Local launcher checks require only Node:

```sh
node --test infra/railway/start-backend.test.mjs
```

Deploy backend changes with `railway up --service backend --detach` after linking
this directory to the intended project and environment. This uploads local source;
it does not publish a Git commit or configure GitHub autodeployment.
