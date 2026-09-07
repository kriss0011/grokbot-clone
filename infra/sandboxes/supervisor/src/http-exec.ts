import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { readBoundedJsonResponse } from "@rakazo/core";

export async function runHttpComputerCommand(
  endpoint: { url: string; token: string },
  argv: string[],
  options: {
    workingDir?: string;
    env?: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
    stdinBase64?: string;
  },
) {
  const base = new URL(endpoint.url);
  base.port = "7071";
  base.pathname = "/";
  const headers = { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" };
  const readiness = AbortSignal.any([
    AbortSignal.timeout(10_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  for (;;) {
    readiness.throwIfAborted();
    try {
      const response = await fetch(new URL("ready", base), {
        method: "POST",
        headers,
        body: "{}",
        redirect: "error",
        signal: readiness,
      });
      await response.body?.cancel();
      if (response.ok) break;
      if (response.status === 401) throw new Error("Computer command authentication failed");
    } catch (error) {
      if (error instanceof Error && error.message === "Computer command authentication failed")
        throw error;
      readiness.throwIfAborted();
    }
    await delay(100, undefined, { signal: readiness });
  }
  const id = randomUUID();
  const timeoutMs = options.timeoutMs ?? 300_000;
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs + 10_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  try {
    const response = await fetch(new URL("exec", base), {
      method: "POST",
      headers,
      redirect: "error",
      signal,
      body: JSON.stringify({
        id,
        argv,
        workingDir: options.workingDir,
        env: options.env ?? ["DISPLAY=:1", "HOME=/home/rakazo"],
        timeoutMs,
        keepStdinOpen: Boolean(options.signal),
        stdinBase64: options.stdinBase64,
      }),
    });
    if (!response.ok) throw new Error(`Computer command failed: ${response.status}`);
    const result = await readBoundedJsonResponse<{ stdout: string; stderr: string; code: number }>(
      response,
      16 * 1024 * 1024,
      signal,
    );
    if (
      typeof result.stdout !== "string" ||
      typeof result.stderr !== "string" ||
      !Number.isInteger(result.code)
    ) {
      throw new Error("Invalid computer command response");
    }
    return result;
  } catch (error) {
    // Cancel the actual process group when the caller goes away, not just its HTTP request.
    await fetch(new URL("cancel", base), {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    })
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
    throw error;
  }
}
