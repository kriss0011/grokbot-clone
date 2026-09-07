import { clampThinkingLevel, getSupportedThinkingLevels, Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelAcceptsImageInput } from "./model-vision.js";
import { listPiCatalog } from "./pi-models.js";
import { modelsForRequest, reliableStreamOptions } from "./pi-runtime.js";

const modelId = "gpt-6-astra";
const efforts = ["low", "medium", "high", "xhigh", "max"];

afterEach(() => vi.unstubAllGlobals());

describe("GPT-6 Astra", () => {
  it.each(["openai", "openai-codex"])(
    "keeps the %s picker, runtime and image capabilities consistent",
    (provider) => {
      const models = modelsForRequest({ model: { provider, id: modelId } }, provider);
      const model = models.getModel(provider, modelId)!;
      expect(model).toBeDefined();
      expect(model.api).toBe(provider === "openai" ? "openai-responses" : "openai-codex-responses");
      const levels = getSupportedThinkingLevels(model);
      expect(levels).toEqual(provider === "openai-codex" ? ["minimal", ...efforts] : efforts);
      for (const preferred of ["off", "minimal"] as const) {
        const level = clampThinkingLevel(model, preferred);
        expect(model.thinkingLevelMap?.[level] ?? level).toBe("low");
      }
      expect(modelAcceptsImageInput(provider, modelId)).toBe(true);
      expect(
        listPiCatalog().find((entry) => entry.provider === provider && entry.id === modelId),
      ).toMatchObject({ label: "GPT-6 Astra", reasoning: true, thinkingLevels: levels });
    },
  );

  it("resolves Astra with the request's stored ChatGPT subscription credential", async () => {
    const provider = "openai-codex";
    const models = modelsForRequest(
      {
        model: {
          provider,
          id: modelId,
          oauth: {
            credential: {
              type: "oauth",
              access: "fixture-access",
              refresh: "fixture-refresh",
              expires: Date.now() + 3_600_000,
            },
          },
        },
      },
      provider,
    );
    expect(models.getModel(provider, modelId)?.id).toBe(modelId);
    expect((await models.getAuth(provider))?.auth.apiKey).toBe("fixture-access");
    expect(
      listPiCatalog().find((entry) => entry.provider === provider && entry.id === modelId),
    ).toMatchObject({ signIn: "device-code", subscription: true });
  });

  it.each(["openai", "openai-codex"])(
    "builds a valid %s Responses tool request without contacting a provider",
    async (provider) => {
      const fetch = vi.fn(() => {
        throw new Error("Unexpected network request");
      });
      vi.stubGlobal("fetch", fetch);
      const claims = btoa(
        JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } }),
      );
      const apiKey = provider === "openai-codex" ? `fixture.${claims}.signature` : "fixture-key";
      const models = modelsForRequest(
        {
          model: {
            provider,
            id: modelId,
            ...(provider === "openai-codex"
              ? {
                  oauth: {
                    credential: {
                      type: "oauth",
                      access: apiKey,
                      refresh: "fixture-refresh",
                      expires: Date.now() + 3_600_000,
                    },
                  },
                }
              : {}),
          },
        },
        provider,
      );
      const model = models.getModel(provider, modelId)!;
      let payload: Record<string, unknown> | undefined;
      const stream = models.streamSimple(
        model,
        {
          messages: [{ role: "user", content: "Use the echo tool.", timestamp: 0 }],
          tools: [
            {
              name: "echo",
              description: "Echo text",
              parameters: Type.Object({ text: Type.String() }),
            },
          ],
        },
        reliableStreamOptions(model, {
          apiKey,
          reasoning: "max",
          onPayload(body) {
            payload = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
            throw new Error("Offline payload captured");
          },
        }),
      );
      const result = await stream.result();
      expect(result.errorMessage).toContain("Offline payload captured");
      expect(payload).toMatchObject({
        model: modelId,
        reasoning: { effort: "max" },
        tools: [expect.objectContaining({ type: "function", name: "echo" })],
      });
      for (const parameter of ["temperature", "top_p", "top_logprobs", "prompt_cache_retention"]) {
        expect(payload).not.toHaveProperty(parameter);
      }
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
