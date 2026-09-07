import type { ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  connectedBotModelOptions,
  modelOptionKey,
  parseModelOptionKey,
} from "./bot-model-options.js";

const credential = (provider: string, modelId?: string): ModelCredential => ({
  id: provider,
  provider,
  modelId,
  label: provider,
  hasKey: true,
  isDefault: true,
});
const model = (provider: string, id: string, placeholder = false): ModelCatalogEntry => ({
  provider,
  id,
  label: id,
  billing: "",
  auth: "api-key",
  subscription: false,
  placeholder,
});

describe("connected bot models", () => {
  it("lists every connected provider model even if the saved default is retired", () => {
    const catalog = [
      model("openai-codex", "first"),
      model("openai-codex", "second"),
      model("openai", "api-only"),
    ];
    const options = connectedBotModelOptions([credential("openai-codex", "retired")], catalog);
    expect(options.map((item) => item.modelId)).toEqual(["first", "second", "retired"]);
    expect(options.some((item) => item.provider === "openai")).toBe(false);
    expect(
      connectedBotModelOptions([credential("openai-codex"), credential("openai")], catalog),
    ).toHaveLength(3);
  });
  it("keeps custom connections scoped to the entered model and deduplicates options", () => {
    const connection = credential("openai-compatible", "my-model");
    expect(
      connectedBotModelOptions(
        [connection, connection],
        [model("openai-compatible", "custom", true)],
      ).map((item) => item.modelId),
    ).toEqual(["my-model"]);
  });
  it("round trips model IDs containing separators and handles the space default", () => {
    expect(parseModelOptionKey(modelOptionKey("openai", "ft:gpt:test::one"))).toEqual({
      provider: "openai",
      modelId: "ft:gpt:test::one",
    });
    expect(parseModelOptionKey("")).toBeNull();
  });
});
