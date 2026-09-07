import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runBackend } from "./start-backend.mjs";

const node = (code) => ({ command: process.execPath, args: ["-e", code] });

test("failed migrations prevent application startup", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rakazo-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "started");
  const result = await runBackend({
    migration: node("process.exit(7)"),
    services: [node(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`)],
  });
  assert.equal(result, 1);
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("an exited service stops its running sibling and fails the deployment", { timeout: 5000 }, async () => {
  const result = await runBackend({
    migration: node("process.exit(0)"),
    services: [node("setTimeout(() => process.exit(9), 100)"), node("setInterval(() => {}, 1000)")],
    shutdownMs: 200,
  });
  assert.equal(result, 1);
});

test("SIGTERM drains the service group and exits successfully", { timeout: 5000 }, async () => {
  const script = `
    import { runBackend } from ${JSON.stringify(new URL("./start-backend.mjs", import.meta.url).href)};
    const node = code => ({command: process.execPath, args: ['-e', code]});
    process.exitCode = await runBackend({
      migration: node('process.exit(0)'),
      services: [node('console.log("ready"); setInterval(() => {}, 1000)')],
      shutdownMs: 200
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  const closed = once(child, "exit");
  await once(child.stdout, "data");
  child.kill("SIGTERM");
  assert.deepEqual(await closed, [0, null]);
});
