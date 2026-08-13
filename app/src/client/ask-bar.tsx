import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "./api.ts";
import {
  ASK_BAR_PLACEHOLDER,
  type AskBarScope,
  askBarScopeForPath,
  droppedChipScope,
} from "./chat-session-entry.ts";

export const ASK_BAR_PENDING_STATE = "pendingMessage";

type AskBarLabels = {
  readonly task?: string;
  readonly connection?: string;
  readonly run?: string;
};

export type AskBarThread = {
  readonly send: (text: string) => Promise<void>;
  readonly stop: () => void;
  readonly busy: boolean;
  readonly archived: boolean;
};

const AskBarRuntimeContext = createContext<{
  readonly focus: () => void;
  readonly seed: (text: string) => void;
  readonly register: (
    element: HTMLInputElement | null,
    seed?: (text: string) => void,
  ) => void;
  readonly setLabels: (labels: AskBarLabels) => void;
  readonly setThread: (thread: AskBarThread | null) => void;
  readonly labels: AskBarLabels;
  readonly thread: AskBarThread | null;
} | null>(null);

export function AskBarProvider({ children }: { readonly children: ReactNode }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seedRef = useRef<(text: string) => void>(() => undefined);
  const [labels, setLabels] = useState<AskBarLabels>({});
  const [thread, setThread] = useState<AskBarThread | null>(null);
  const controls = useMemo(
    () => ({
      focus: () => inputRef.current?.focus(),
      seed: (text: string) => {
        seedRef.current(text);
        inputRef.current?.focus();
      },
      register: (
        element: HTMLInputElement | null,
        seed?: (text: string) => void,
      ) => {
        inputRef.current = element;
        seedRef.current = element && seed ? seed : () => undefined;
      },
      setLabels,
      setThread,
    }),
    [],
  );
  const value = useMemo(
    () => ({ ...controls, labels, thread }),
    [controls, labels, thread],
  );
  return (
    <AskBarRuntimeContext.Provider value={value}>
      {children}
    </AskBarRuntimeContext.Provider>
  );
}

function useAskBarRuntime() {
  const runtime = useContext(AskBarRuntimeContext);
  if (!runtime) {
    throw new Error("Ask bar is missing");
  }
  return runtime;
}

export function useFocusAskBar() {
  return useAskBarRuntime().focus;
}

export function useAskBarSeed() {
  return useAskBarRuntime().seed;
}

export function useAskBarThread(thread: AskBarThread | null) {
  const { setThread } = useAskBarRuntime();
  useEffect(() => {
    setThread(thread);
  }, [setThread, thread]);
  useEffect(() => () => setThread(null), [setThread]);
}

export function useAskBarChip(
  kind: "task" | "connection" | "run",
  label: string | undefined,
) {
  const { setLabels } = useAskBarRuntime();
  useEffect(() => {
    if (!label) return;
    setLabels({ [kind]: label });
    return () => setLabels({});
  }, [kind, label, setLabels]);
}

export function AskBar() {
  const { pathname } = useLocation();
  const runtime = useAskBarRuntime();
  const pathScope = askBarScopeForPath(pathname, runtime.labels);
  return <AskBarForm key={pathname} pathScope={pathScope} />;
}

function AskBarForm({ pathScope }: { readonly pathScope: AskBarScope }) {
  const navigate = useNavigate();
  const runtime = useAskBarRuntime();
  const [chipDropped, setChipDropped] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    runtime.register(inputRef.current, (text) => {
      setDraft(text);
      inputRef.current?.focus();
    });
    return () => runtime.register(null);
  }, [runtime]);

  const scope = chipDropped ? droppedChipScope(pathScope) : pathScope;
  const thread = scope.continueSessionId ? runtime.thread : null;
  const continuing = Boolean(scope.continueSessionId) && !chipDropped;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const text = draft.trim();
    if (!text) return;
    if (continuing) {
      if (!thread || thread.archived || thread.busy) return;
      setSending(true);
      setError(undefined);
      try {
        await thread.send(text);
        setDraft("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSending(false);
      }
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const session = await api.enterChat(scope.entry);
      setDraft("");
      navigate(`/chat/${encodeURIComponent(session.id)}`, {
        state: { [ASK_BAR_PENDING_STATE]: text },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSending(false);
    }
  };

  const placeholder = thread?.archived
    ? "Restore this conversation to continue"
    : ASK_BAR_PLACEHOLDER;
  const disabled =
    sending || (continuing && (!thread || thread.archived || thread.busy));

  return (
    <div className="ask-bar-zone">
      <form
        className={`ask-bar${focused ? " focused" : ""}`}
        onSubmit={(event) => void submit(event)}
      >
        {scope.chip ? (
          <button
            aria-label={`Remove ${scope.chip.label} scope`}
            className="ask-bar-chip"
            onClick={() => setChipDropped(true)}
            type="button"
          >
            {scope.chip.label}
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        <input
          aria-label={placeholder}
          disabled={disabled}
          maxLength={8_000}
          onBlur={() => setFocused(false)}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (
              event.key === "Backspace" &&
              draft.length === 0 &&
              scope.chip &&
              !chipDropped
            ) {
              event.preventDefault();
              setChipDropped(true);
            }
          }}
          placeholder={placeholder}
          ref={inputRef}
          type="text"
          value={draft}
        />
        {thread?.busy ? (
          <button
            className="ask-bar-stop"
            onClick={() => thread.stop()}
            type="button"
          >
            Stop
          </button>
        ) : (
          <button
            className="button ask-bar-send"
            disabled={disabled || draft.trim().length === 0}
            type="submit"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        )}
      </form>
      {error ? (
        <p className="ask-bar-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
