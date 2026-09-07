import type { ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";

export function modelOptionKey(provider: string, modelId: string) {
  return `${provider}::${modelId}`;
}

export function parseModelOptionKey(key: string) {
  const separator = key.indexOf("::");
  if (separator <= 0 || separator + 2 === key.length) return null;
  return { provider: key.slice(0, separator), modelId: key.slice(separator + 2) };
}

/** Expand a connected provider to its catalog; preserve custom or retired saved IDs. */
export function connectedBotModelOptions(
  credentials: ModelCredential[],
  catalog: ModelCatalogEntry[],
) {
  const options = new Map<
    string,
    { key: string; provider: string; modelId: string; label: string }
  >();
  for (const credential of credentials) {
    const models = catalog.filter(
      (entry) => entry.provider === credential.provider && !entry.placeholder,
    );
    for (const entry of models) {
      const key = modelOptionKey(entry.provider, entry.id);
      options.set(key, {
        key,
        provider: entry.provider,
        modelId: entry.id,
        label: `${entry.providerName ?? entry.provider} · ${entry.label}`,
      });
    }
    if (credential.modelId) {
      const key = modelOptionKey(credential.provider, credential.modelId);
      if (!options.has(key))
        options.set(key, {
          key,
          provider: credential.provider,
          modelId: credential.modelId,
          label: `${credential.label} · ${credential.modelId}`,
        });
    }
  }
  return [...options.values()];
}
