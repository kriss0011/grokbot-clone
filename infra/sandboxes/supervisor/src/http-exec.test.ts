import { afterEach, expect, it, vi } from "vitest";
import { runHttpComputerCommand } from "./http-exec.js";

afterEach(() => vi.unstubAllGlobals());
it("executes once on the inspected computer and passes command input", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ stdout: "ok", stderr: "", code: 0 }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await runHttpComputerCommand(
    { url: "http://172.18.0.2:7070/v1/desktop", token: "private" },
    ["cat"],
    { stdinBase64: "b2s=" },
  );
  expect(result.stdout).toBe("ok");
  expect(fetchMock.mock.calls[1]![0].toString()).toBe("http://172.18.0.2:7071/exec");
  expect(fetchMock.mock.calls[1]![1].redirect).toBe("error");
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body).stdinBase64).toBe("b2s=");
});
it("cancels a failed dispatch without replaying the command", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockRejectedValueOnce(new Error("disconnected"))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    runHttpComputerCommand(
      { url: "http://172.18.0.2:7070/v1/desktop", token: "private" },
      ["work"],
      {},
    ),
  ).rejects.toThrow("disconnected");
  expect(fetchMock.mock.calls.map((call) => call[0].pathname)).toEqual([
    "/ready",
    "/exec",
    "/cancel",
  ]);
  expect(JSON.parse(fetchMock.mock.calls[2]![1].body).id).toBe(
    JSON.parse(fetchMock.mock.calls[1]![1].body).id,
  );
});
