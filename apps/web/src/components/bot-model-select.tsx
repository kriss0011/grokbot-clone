import { Trans, useLingui } from "@lingui/react/macro";
import { type connectedBotModelOptions, parseModelOptionKey } from "@rakazo/core";
import { NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useId } from "react";

export function BotModelSelect({
  value,
  onChange,
  options,
  defaultLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReturnType<typeof connectedBotModelOptions>;
  defaultLabel?: string;
}) {
  const { t } = useLingui();
  const id = useId();
  return (
    <label htmlFor={id} className="mt-4 block text-[14px] text-muted-foreground">
      <Trans>Model</Trans>
      <NativeSelect
        id={id}
        className="mt-2 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <NativeSelectOption value="">
          {t`Space default`}
          {defaultLabel ? ` (${defaultLabel})` : ""}
        </NativeSelectOption>
        {value && !options.some((option) => option.key === value) ? (
          <NativeSelectOption value={value}>
            {parseModelOptionKey(value)?.modelId ?? value}
          </NativeSelectOption>
        ) : null}
        {options.map((option) => (
          <NativeSelectOption key={option.key} value={option.key}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
