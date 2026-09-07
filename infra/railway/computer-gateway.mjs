import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const TTL = 60 * 60_000;
function signature(port, expires, secret) {
  return createHmac("sha256", secret).update(`desktop:${port}:${expires}`).digest("base64url");
}
function equal(a, b) {
  const left = Buffer.from(a ?? "");
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Only trusted supervisor responses can mint a capability for a loopback desktop port.
export function publicScreenUrl(raw, origin, secret, now = Date.now()) {
  const local = new URL(raw);
  if (
    local.protocol !== "http:" ||
    local.hostname !== "127.0.0.1" ||
    Number(local.port) < 1024 ||
    Number(local.port) > 65535 ||
    local.pathname !== "/embed.html"
  ) {
    throw new Error("Unexpected supervisor screen target");
  }
  const expires = now + TTL;
  return `${new URL(origin).origin}/screens/${local.port}/${expires}.${signature(local.port, expires, secret)}${local.pathname}${local.search}`;
}

export function screenTarget(raw, secret, now = Date.now()) {
  const match = raw?.match(/^\/screens\/(\d+)\/(\d+)\.([A-Za-z0-9_-]{43})(\/[^#]*)$/);
  if (!match) return null;
  const [, port, expires, mac, path] = match;
  if (
    Number(port) < 1024 ||
    Number(port) > 65535 ||
    Number(expires) <= now ||
    Number(expires) > now + TTL ||
    !equal(mac, signature(port, expires, secret))
  )
    return null;
  if (path.startsWith("//") || /[\r\n]/.test(path)) return null;
  return { port: Number(port), path, expires: Number(expires) };
}

function headersFor(headers) {
  const result = { ...headers, host: "127.0.0.1" };
  delete result.cookie;
  delete result.authorization;
  delete result["proxy-authorization"];
  return result;
}

export function createGateway({ secret, origin, supervisorPort = 7091 }) {
  if (!secret || secret.length < 32 || new URL(origin).protocol !== "https:") {
    throw new Error("Gateway needs a strong supervisor token and an HTTPS public origin");
  }
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      const probe = http.get(
        { hostname: "127.0.0.1", port: supervisorPort, path: "/health", timeout: 5000 },
        (upstream) => {
          res.writeHead(upstream.statusCode ?? 502, { "content-type": "application/json" });
          upstream.pipe(res);
        },
      );
      probe.on("timeout", () => probe.destroy());
      probe.on("error", () => {
        res.writeHead(503);
        res.end();
      });
      return;
    }
    const screen = screenTarget(req.url, secret);
    const control =
      /^\/computers(?:\/|\?|$)/.test(req.url ?? "") &&
      equal(req.headers.authorization, `Bearer ${secret}`);
    if (!screen && !control) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (screen && req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const headers = headersFor(req.headers);
    if (control) headers.authorization = `Bearer ${secret}`;
    // Compressing a screen-mode JSON response would prevent URL rewriting.
    delete headers["accept-encoding"];
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: screen?.port ?? supervisorPort,
        path: screen?.path ?? req.url,
        method: req.method,
        headers,
        timeout: 330_000,
      },
      (response) => {
        const outHeaders = { ...response.headers, "cache-control": "no-store" };
        delete outHeaders["set-cookie"];
        if (control && outHeaders.location && /\/screen(?:\?|$)/.test(req.url)) {
          try {
            outHeaders.location = publicScreenUrl(outHeaders.location, origin, secret);
          } catch {
            response.resume();
            res.writeHead(502);
            res.end();
            return;
          }
        }
        if (control && /\/screen-mode(?:\?|$)/.test(req.url) && response.statusCode === 200) {
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > 65536) {
              response.destroy();
              res.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              if (data.screenUrl) data.screenUrl = publicScreenUrl(data.screenUrl, origin, secret);
              const body = JSON.stringify(data);
              delete outHeaders["transfer-encoding"];
              outHeaders["content-length"] = Buffer.byteLength(body);
              res.writeHead(200, outHeaders);
              res.end(body);
            } catch {
              res.writeHead(502);
              res.end();
            }
          });
        } else {
          res.writeHead(response.statusCode ?? 502, outHeaders);
          response.pipe(res);
        }
        response.on("error", () => res.destroy());
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });
  server.on("upgrade", (req, socket, head) => {
    const target = screenTarget(req.url, secret);
    if (!target || !target.path.startsWith("/websockify") || req.method !== "GET") {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: target.port,
      path: target.path,
      headers: headersFor(req.headers),
      timeout: 15_000,
    });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
      for (const [key, value] of Object.entries(response.headers)) {
        if (value != null && key !== "set-cookie") socket.write(`${key}: ${value}\r\n`);
      }
      socket.write("\r\n");
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
      const timer = setTimeout(() => {
        remote.destroy();
        socket.destroy();
      }, target.expires - Date.now());
      timer.unref();
      socket.on("close", () => {
        clearTimeout(timer);
        remote.destroy();
      });
      remote.on("close", () => socket.destroy());
      remote.on("error", () => socket.destroy());
    });
    upstream.on("response", (response) => {
      response.resume();
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createGateway({
    secret: process.env.SANDBOX_SUPERVISOR_TOKEN,
    origin: process.env.COMPUTER_PUBLIC_ORIGIN,
  }).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
}
