#!/usr/bin/env bash
set -euo pipefail
# Run as root on a dedicated VM. Configuration is a mode-600 Docker env file.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${COMPUTER_ENV_FILE:-/etc/grokbot-computer.env}"
APP_IMAGE="${RAKAZO_APP_IMAGE:-ghcr.io/elie222/rakazo/app@sha256:ff7d2486a812b16294429cebe79e3e049d4c4c6487e2277e65ff3e99079a474e}"
test -f "$ENV_FILE"
if ! docker info >/dev/null 2>&1; then
  sysctl -w net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1
  nohup dockerd --firewall-backend=nftables --ipv6=true >/var/log/grokbot-docker.log 2>&1 </dev/null &
  for attempt in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  docker info >/dev/null
fi
install -d -m 750 -o 1000 -g 1000 /data /data/homes
DOCKER_GID="$(stat -c %g /var/run/docker.sock)"
if ! docker container inspect grokbot-supervisor >/dev/null 2>&1; then
  docker run -d --name grokbot-supervisor --restart unless-stopped --init \
    --network host --user 1000:1000 --group-add "$DOCKER_GID" \
    --cap-drop ALL --security-opt no-new-privileges:true --memory 512m --pids-limit 256 \
    --env-file "$ENV_FILE" -e HOSTNAME= -e DATA_DIR=/data \
    -e SUPERVISOR_HOST=127.0.0.1 -e SUPERVISOR_PORT=7091 \
    -e SANDBOX_SCREEN_NETWORK=published -e SANDBOX_SCREEN_HOST=127.0.0.1 \
    -e RAKAZO_COMPUTER_IMAGE=grokbot/computer:local \
    -e RAKAZO_COMPUTER_MEMORY=2g -e RAKAZO_COMPUTER_CPUS=2 \
    -v /var/run/docker.sock:/var/run/docker.sock -v /data:/data \
    "$APP_IMAGE" node --import tsx /app/infra/sandboxes/supervisor/src/index.ts
else docker start grokbot-supervisor >/dev/null; fi
if ! docker container inspect grokbot-computer-gateway >/dev/null 2>&1; then
  docker run -d --name grokbot-computer-gateway --restart unless-stopped --init \
    --network host --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
    --memory 128m --pids-limit 128 --env-file "$ENV_FILE" -e PORT=8080 \
    -v "$ROOT_DIR/infra/railway/computer-gateway.mjs:/app/computer-gateway.mjs:ro" \
    "$APP_IMAGE" node /app/computer-gateway.mjs
else docker start grokbot-computer-gateway >/dev/null; fi
