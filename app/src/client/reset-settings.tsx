import { useEffect, useRef, useState } from "react";

type NativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
function nativeInvoke(): NativeInvoke | undefined {
  return (
    window as Window & { __TAURI__?: { core?: { invoke?: NativeInvoke } } }
  ).__TAURI__?.core?.invoke;
}

export function ResetSettings() {
  const [environment, setEnvironment] = useState<string>();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const invoke = nativeInvoke();
    if (invoke)
      void invoke<{ environment: string }>("reset_info")
        .then((info) => {
          if (active) setEnvironment(info.environment);
        })
        .catch(() => {
          if (active)
            setError(
              "Reset is unavailable until the desktop workspace is ready.",
            );
        });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      input.current?.focus();
    }
  }, [open]);
  const reset = async () => {
    const invoke = nativeInvoke();
    if (!invoke || confirmation !== "RESET" || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await invoke("reset_springroll", { confirmation });
      window.localStorage.clear();
      window.sessionStorage.clear();
      setFinished(true);
    } catch (reason) {
      setError(
        `${String(reason)} The app may have stopped and some sign-ins may have been cleared. Quit and reopen it before retrying.`,
      );
      setBusy(false);
    }
  };
  return (
    <section className="reset-settings" aria-labelledby="reset-heading">
      <h2 id="reset-heading">Reset Springroll</h2>
      <p>Erase this app environment and start fresh.</p>
      {!nativeInvoke() ? (
        <p>Open the Mac app to reset its local workspace.</p>
      ) : null}
      {error && !open ? <p role="alert">{error}</p> : null}
      <button
        className="quiet-button danger"
        type="button"
        disabled={!environment}
        onClick={() => {
          setConfirmation("");
          setError(undefined);
          setFinished(false);
          setOpen(true);
        }}
      >
        Reset Springroll…
      </button>
      {open ? (
        <dialog
          className="app-confirmation reset-confirmation"
          ref={dialog}
          aria-labelledby="reset-dialog-heading"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setOpen(false);
          }}
        >
          <h2 id="reset-dialog-heading">Reset {environment?.toLowerCase()}?</h2>
          <p>
            This permanently deletes this environment’s recipes, chats, runs,
            reports, settings, saved credentials, subscription sign-ins, and
            downloaded subscription support.
          </p>
          <p>
            Active jobs will be stopped. Other Springroll environments and
            separately installed Codex/Claude tools and their terminal sign-ins
            stay intact.
          </p>
          <p>
            Google and Microsoft may still list Springroll as authorized. This
            clears the saved access on this Mac.
          </p>
          <label htmlFor="reset-confirmation">Type RESET to confirm</label>
          <input
            id="reset-confirmation"
            ref={input}
            value={confirmation}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {error ? <p role="alert">{error}</p> : null}
          {busy ? (
            <p role="status">
              {finished
                ? "Reset complete. Restarting Springroll…"
                : "Stopping jobs and clearing this environment…"}
            </p>
          ) : null}
          <div className="heading-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              type="button"
              disabled={busy || confirmation !== "RESET"}
              onClick={() => void reset()}
            >
              Reset and restart
            </button>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
