import { useEffect, useId, useRef, useState } from "react";
export function SettingsPicker({
  label,
  value: selected,
  options,
  disabled,
  onChange,
  className = "",
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
  }[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === selected),
      ),
    );
    setOpen(true);
  };
  useEffect(() => {
    if (open && !disabled) optionRefs.current[active]?.focus();
    if (disabled) setOpen(false);
  }, [open, active, disabled]);
  return (
    <div className={`model-picker settings-picker ${className}`}>
      <button
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="combo-trigger"
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="combo-value">
          {options.find((option) => option.value === selected)?.label}
        </span>
        <span aria-hidden="true" className="combo-chev">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && !disabled ? (
        <>
          <button
            aria-label={`Close ${label.toLowerCase()}`}
            className="enable-backdrop"
            tabIndex={-1}
            type="button"
            onClick={close}
          />
          <div className="combo-panel align-end">
            <div
              id={listId}
              aria-label={label}
              className="combo-list"
              role="listbox"
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === selected}
                  aria-disabled={option.disabled || undefined}
                  tabIndex={index === active ? 0 : -1}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  className={`combo-option${index === active ? " active" : ""}${option.value === selected ? " selected" : ""}`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      close();
                    } else if (event.key === "Tab") {
                      close();
                    } else if (
                      ["ArrowDown", "ArrowUp", "Home", "End"].includes(
                        event.key,
                      )
                    ) {
                      event.preventDefault();
                      setActive(
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? options.length - 1
                            : (index +
                                (event.key === "ArrowDown" ? 1 : -1) +
                                options.length) %
                              options.length,
                      );
                    }
                  }}
                  onClick={() => {
                    if (option.disabled) return;
                    close();
                    onChange(option.value);
                  }}
                >
                  <span aria-hidden="true" className="combo-tick">
                    ✓
                  </span>
                  <span className="combo-name">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
