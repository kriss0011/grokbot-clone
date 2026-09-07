import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createGateway, publicScreenUrl, screenTarget } from "./computer-gateway.mjs";

const secret = "offline-test-secret-that-is-at-least-32-characters";
test("screen capabilities bind the loopback port and expire", () => {
  const url = new URL(
    publicScreenUrl(
      "http://127.0.0.1:49152/embed.html?path=websockify",
      "https://computer.example",
      secret,
      1000,
    ),
  );
  assert.equal(screenTarget(url.pathname + url.search, secret, 1000)?.port, 49152);
  assert.equal(screenTarget(url.pathname.replace("49152", "7091"), secret, 1000), null);
  assert.equal(screenTarget(url.pathname, "wrong", 1000), null);
  assert.equal(screenTarget(url.pathname, secret, 3601001), null);
  assert.throws(() =>
    publicScreenUrl("http://127.0.0.1:7091/computers", "https://computer.example", secret),
  );
  assert.throws(() =>
    publicScreenUrl("http://evil.example:49152/embed.html", "https://computer.example", secret),
  );
});

test("gateway authenticates control, rewrites screens, and strips browser credentials", async (t) => {
  let received;
  const desktop = http.createServer((req, res) => {
    received = req.headers;
    res.end("desktop");
  });
  desktop.listen(0, "127.0.0.1");
  await once(desktop, "listening");
  const supervisor = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        screenUrl: `http://127.0.0.1:${desktop.address().port}/embed.html?path=websockify%3Ftoken%3Dprivate`,
      }),
    );
  });
  supervisor.listen(0, "127.0.0.1");
  await once(supervisor, "listening");
  const gateway = createGateway({
    secret,
    origin: "https://computer.example",
    supervisorPort: supervisor.address().port,
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
    supervisor.closeAllConnections();
    supervisor.close();
    desktop.closeAllConnections();
    desktop.close();
  });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  assert.equal((await fetch(base + "/computers/test/screen-mode", { method: "POST" })).status, 401);
  const response = await fetch(base + "/computers/test/screen-mode", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 200);
  const screen = new URL((await response.json()).screenUrl);
  assert.equal(screen.origin, "https://computer.example");
  const view = await fetch(base + screen.pathname, {
    headers: { authorization: "Bearer browser-secret", cookie: "private=1" },
  });
  assert.equal(await view.text(), "desktop");
  assert.equal(received.authorization, undefined);
  assert.equal(received.cookie, undefined);
  assert.equal((await fetch(base + screen.pathname, { method: "POST" })).status, 405);
});
