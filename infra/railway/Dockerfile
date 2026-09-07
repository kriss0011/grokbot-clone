# Published upstream image for commit 8bb0f4ea65a3dbe312208fca5396ff742dafdaad.
# Reuse its dependency layers, then build the checked-out fork's source.
FROM ghcr.io/elie222/rakazo/app@sha256:ff7d2486a812b16294429cebe79e3e049d4c4c6487e2277e65ff3e99079a474e
USER root
WORKDIR /app
COPY --chmod=755 . .
RUN CI=true pnpm install --frozen-lockfile
RUN pnpm --filter @rakazo/db generate
RUN pnpm exec vitest run packages/adapters/src/pi-astra.test.ts packages/adapters/src/pi-models.test.ts packages/adapters/src/pi-runtime-models.test.ts packages/adapters/src/pi-credentials.test.ts packages/adapters/src/pi-oauth.test.ts packages/adapters/src/pi-runtime-transport.test.ts
RUN node --test infra/railway/start-backend.test.mjs
RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
# Railway mounts new volumes as root. The launcher prepares /data, then drops
# privileges before migrations, the API or worker start.
CMD ["node", "/app/infra/railway/start-backend.mjs"]
