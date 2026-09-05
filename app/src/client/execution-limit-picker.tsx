import { useState } from "react";
import { SettingsPicker } from "./settings-picker.tsx";

export function ExecutionLimitPicker({
  label,
  value,
  presets,
  defaultValue,
  min,
  max,
  step = 1,
  unit,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly presets: readonly number[];
  readonly defaultValue: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit: "turns" | "USD";
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  const [editingCustom, setEditingCustom] = useState(false);
  const custom = editingCustom || (value !== 0 && !presets.includes(value));
  const options = [
    { value: "0", label: "Off" },
    ...presets.map((preset) => ({
      value: String(preset),
      label: unit === "USD" ? `$${preset.toFixed(2)}` : `${preset} turns`,
    })),
    { value: "custom", label: "Custom…" },
  ];
  const selected = custom ? "custom" : String(value);
  return (
    <div className="execution-limit-controls">
      <SettingsPicker
        label={label}
        value={selected}
        options={options}
        disabled={disabled}
        className="execution-limit-picker"
        onChange={(selected) => {
          setEditingCustom(selected === "custom");
          if (selected !== "custom") onChange(Number(selected));
        }}
      />
      {custom ? (
        <>
          <input
            aria-label={`Custom ${label.toLowerCase()}`}
            className="execution-limit-input"
            disabled={disabled}
            type="number"
            min={min}
            max={max}
            step={step}
            defaultValue={value || defaultValue}
            key={value}
            onBlur={(event) => {
              const parsed = Number(event.target.value);
              if (
                Number.isFinite(parsed) &&
                parsed >= min &&
                (max === undefined || parsed <= max) &&
                (unit !== "turns" || Number.isInteger(parsed))
              ) {
                onChange(parsed);
              } else {
                event.target.value = String(value || defaultValue);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <span className="execution-limit-unit">{unit}</span>
        </>
      ) : null}
    </div>
  );
}
