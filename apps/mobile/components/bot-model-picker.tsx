import type { Me, ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import { connectedBotModelOptions } from "@rakazo/core";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export function BotModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [credentials, setCredentials] = useState<ModelCredential[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc<ModelCredential[]>("models/credentials"),
      rpc<ModelCatalogEntry[]>("models/list"),
      rpc<Me>("me"),
    ])
      .then(([nextCredentials, nextCatalog, nextMe]) => {
        if (!active) return;
        setCredentials(nextCredentials);
        setCatalog(nextCatalog);
        setMe(nextMe);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : t("Could not load models"));
      });
    return () => {
      active = false;
    };
  }, [open]);
  const options = [
    { key: "", label: `${t("Space default")}${me?.defaultModel ? ` (${me.defaultModel})` : ""}` },
    ...connectedBotModelOptions(credentials, catalog),
  ];
  if (value && !options.some((option) => option.key === value))
    options.push({ key: value, label: value });
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ color: tokens.mutedForeground, marginBottom: 8 }}>{t("Model")}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Model")}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={{ padding: 16, borderRadius: 11, backgroundColor: tokens.muted }}
      >
        <Text style={{ color: tokens.foreground }}>
          {options.find((option) => option.key === value)?.label}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={{ flex: 1, padding: 24, paddingTop: 48, backgroundColor: tokens.background }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={{ alignSelf: "flex-end", padding: 12 }}
          >
            <Text style={{ color: tokens.foreground }}>{t("Done")}</Text>
          </Pressable>
          <TextInput
            accessibilityLabel={t("Search models")}
            placeholder={t("Search models")}
            placeholderTextColor={tokens.mutedForeground}
            value={query}
            onChangeText={setQuery}
            style={{
              padding: 16,
              color: tokens.foreground,
              backgroundColor: tokens.muted,
              borderRadius: 11,
            }}
          />
          {error ? (
            <Text accessibilityRole="alert" style={{ color: tokens.destructive, marginTop: 16 }}>
              {error}
            </Text>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled">
            {options
              .filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
              .map((option) => (
                <Pressable
                  key={option.key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: value === option.key }}
                  onPress={() => {
                    onChange(option.key);
                    setOpen(false);
                  }}
                  style={{
                    paddingVertical: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: tokens.border,
                  }}
                >
                  <Text
                    style={{
                      color: tokens.foreground,
                      fontWeight: value === option.key ? "600" : "400",
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
