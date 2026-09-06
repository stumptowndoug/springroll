import { useCallback, useState } from "react";
import { DeleteButton } from "./delete-button.tsx";
import { CheckIcon, CopyIcon } from "./icons.tsx";

export function CopyMarkdownButton({
  content,
  label = "Copy markdown",
  className,
}: {
  readonly content?: string | undefined;
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const text = content?.trim();

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }, [text]);

  if (!text) return null;

  return (
    <button
      aria-label={copied ? "Copied markdown to clipboard" : label}
      className={`ending-action${copied ? " copied" : ""}${className ? ` ${className}` : ""}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleCopy();
      }}
      title={copied ? "Copied!" : label}
      type="button"
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** Copy and delete at the end of a chat turn or run letter. */
export function EndingActions({
  copy,
  copyLabel,
  deleteBusy,
  deleteDisabled,
  deleteLabel = "Delete",
  onDelete,
}: {
  readonly copy?: string | undefined;
  readonly copyLabel?: string | undefined;
  readonly deleteBusy?: boolean | undefined;
  readonly deleteDisabled?: boolean | undefined;
  readonly deleteLabel?: string | undefined;
  readonly onDelete?: (() => void) | undefined;
}) {
  const deleteButton = onDelete ? (
    <DeleteButton
      compact
      label={deleteLabel}
      busy={deleteBusy}
      disabled={deleteDisabled}
      onClick={onDelete}
    />
  ) : null;
  const copyButton = <CopyMarkdownButton content={copy} label={copyLabel} />;
  if (!copy?.trim() && !deleteButton) return null;
  return (
    <div className="ending-actions">
      {copyButton}
      {deleteButton}
    </div>
  );
}
