import { spawn } from "node:child_process";
import { chown, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function runBackend({ migration, services, shutdownMs = 10_000 }) {
  const children = new Set();
  let stopping = false;
  let finish;
  let killTimer;
  const done = new Promise((resolve) => { finish = resolve; });

  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, shutdownMs);
    void Promise.all([...children].map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("close", resolve);
    }))).then(() => {
      clearTimeout(killTimer);
      finish(code);
    });
  };
  const onSignal = () => stop(0);
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  const launch = ({ command, args, cwd, env }, persistent) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: "inherit",
    });
    children.add(child);
    child.once("error", (error) => {
      console.error("Backend process could not start:", error.code);
      stop(1);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (persistent || code !== 0 || signal) stop(1);
    });
    return child;
  };

  const migrate = launch(migration, false);
  const migrated = await new Promise((resolve) => {
    migrate.once("exit", (code) => resolve(code === 0));
    migrate.once("error", () => resolve(false));
  });
  if (migrated && !stopping) {
    for (const service of services) launch(service, true);
  } else if (!stopping) stop(1);

  const code = await done;
  process.removeListener("SIGTERM", onSignal);
  process.removeListener("SIGINT", onSignal);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "../..");
  const dataDir = process.env.DATA_DIR ?? "/data";
  await mkdir(dataDir, { recursive: true });
  if (process.getuid?.() === 0) {
    await chown(dataDir, 1000, 1000);
    process.setgroups([]);
    process.setgid(1000);
    process.setuid(1000);
  }
  const workerEnv = { ...process.env, BETTER_AUTH_SECRET: "", SCREEN_PROXY_SECRET: "" };
  process.exitCode = await runBackend({
    migration: {
      command: process.execPath,
      args: ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      cwd: path.join(root, "packages/db"),
    },
    services: [
      {
        command: process.execPath,
        args: ["--import", "tsx", "src/index.ts"],
        cwd: path.join(root, "apps/api"),
      },
      {
        command: process.execPath,
        args: ["--import", "tsx", "src/index.ts"],
        cwd: path.join(root, "apps/worker"),
        env: workerEnv,
      },
    ],
  });
}
