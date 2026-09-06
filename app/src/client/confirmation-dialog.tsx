import { useEffect, useRef, useState } from "react";

/** App-owned confirmation: works in both browsers and the desktop webview. */
export function useConfirmationDialog() {
  const [message, setMessage] = useState<string>();
  const pending = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const finish = (confirmed: boolean) => {
    pending.current?.(confirmed);
    pending.current = undefined;
    setMessage(undefined);
  };
  useEffect(() => {
    if (message !== undefined) dialog.current?.showModal();
  }, [message]);
  useEffect(() => () => pending.current?.(false), []);
  return {
    confirm: (text: string) => {
      pending.current?.(false);
      return new Promise<boolean>((resolve) => {
        pending.current = resolve;
        setMessage(text);
      });
    },
    confirmation:
      message !== undefined ? (
        <dialog
          className="app-confirmation"
          ref={dialog}
          aria-label="Confirm action"
          onCancel={(event) => {
            event.preventDefault();
            finish(false);
          }}
        >
          <p>{message}</p>
          <div className="heading-actions">
            <button
              className="button"
              type="button"
              onClick={() => finish(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              type="button"
              onClick={() => finish(true)}
            >
              Confirm
            </button>
          </div>
        </dialog>
      ) : null,
  };
}
