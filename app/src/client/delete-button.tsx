import { TrashIcon } from "./icons.tsx";

/** Shared destructive action for deleting a saved record. */
export function DeleteButton({
  label,
  compact = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  readonly label: string;
  readonly compact?: boolean | undefined;
  readonly busy?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={busy ? "Deleting…" : label}
      aria-busy={busy || undefined}
      className={
        compact ? "ending-action danger" : "danger-action delete-action"
      }
      disabled={busy || disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      title={label}
      type="button"
    >
      <TrashIcon size={14} />
      <span>{busy ? "Deleting…" : compact ? "Delete" : label}</span>
    </button>
  );
}
