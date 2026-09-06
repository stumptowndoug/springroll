import type { FileUIPart } from "ai";
import {
  createContext,
  type FormEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ModelSelectionDto, ModelSettingsDto } from "../shared.ts";
import { api } from "./api.ts";
import {
  ASK_BAR_PLACEHOLDER,
  type AskBarScope,
  askBarScopeForPath,
  generalAskEntry,
} from "./chat-session-entry.ts";
import { ClockIcon, CloseIcon, PaperclipIcon } from "./icons.tsx";
import { parseInboxView } from "./inbox-feed.ts";
import { defaultModelLabel, ModelPicker } from "./model-picker.tsx";
import { modelSetupStage } from "./model-readiness.ts";

export const ASK_BAR_PENDING_STATE = "pendingMessage";
export const ASK_BAR_PENDING_FILES_STATE = "pendingFiles";
export const ASK_BAR_PENDING_SESSION_STATE = "pendingSessionId";
const ASK_BAR_MAX_HEIGHT_PX = 144;
const MAX_IMAGE_FILES = 4;
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function resizeAskBarComposer(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, ASK_BAR_MAX_HEIGHT_PX)}px`;
}

type AskBarLabels = {
  readonly task?: string;
  readonly connection?: string;
  readonly run?: string;
};

const AskBarRuntimeContext = createContext<{
  readonly focus: () => void;
  readonly seed: (text: string) => void;
  readonly register: (
    element: HTMLTextAreaElement | null,
    seed?: (text: string) => void,
  ) => void;
  readonly setLabels: (labels: AskBarLabels) => void;
  readonly labels: AskBarLabels;
  readonly models: ModelSettingsDto | undefined;
} | null>(null);

export function AskBarProvider({ children }: { readonly children: ReactNode }) {
  const { pathname } = useLocation();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const seedRef = useRef<(text: string) => void>(() => undefined);
  const [labels, setLabels] = useState<AskBarLabels>({});
  const [models, setModels] = useState<ModelSettingsDto>();
  const controls = useMemo(
    () => ({
      focus: () => inputRef.current?.focus(),
      seed: (text: string) => {
        seedRef.current(text);
        inputRef.current?.focus();
      },
      register: (
        element: HTMLTextAreaElement | null,
        seed?: (text: string) => void,
      ) => {
        inputRef.current = element;
        seedRef.current = element && seed ? seed : () => undefined;
      },
      setLabels,
    }),
    [],
  );
  // Refresh on navigation as well as credential/default changes and app focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is an intentional refresh trigger.
  useEffect(() => {
    let generation = 0;
    let active = true;
    const refresh = () => {
      const request = ++generation;
      void api
        .models()
        .then((value) => {
          if (active && request === generation) setModels(value);
        })
        .catch(() => {
          // Keep the last known setup status visible until a successful refresh.
        });
    };
    refresh();
    window.addEventListener("springroll-models-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("springroll-models-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);
  const value = useMemo(
    () => ({ ...controls, labels, models }),
    [controls, labels, models],
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

export function useAvailableChatModels() {
  return useAskBarRuntime().models;
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

export function askBarComposerAction(
  key: string,
  shiftKey: boolean,
): "submit" | "blur" | undefined {
  if (key === "Escape") return "blur";
  if (key === "Enter" && !shiftKey) return "submit";
  return undefined;
}

export function pendingAskBarSubmissionFromState(state: unknown): {
  readonly sessionId?: string;
  readonly text?: string;
  readonly files: readonly FileUIPart[];
} {
  if (!state || typeof state !== "object") return { files: [] };
  const values = state as Record<string, unknown>;
  const sessionId = values[ASK_BAR_PENDING_SESSION_STATE];
  const text = values[ASK_BAR_PENDING_STATE];
  const rawFiles = values[ASK_BAR_PENDING_FILES_STATE];
  const files = Array.isArray(rawFiles)
    ? rawFiles.filter(
        (part): part is FileUIPart =>
          Boolean(part) &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "file" &&
          typeof (part as { mediaType?: unknown }).mediaType === "string" &&
          typeof (part as { url?: unknown }).url === "string",
      )
    : [];
  return {
    ...(typeof sessionId === "string" && sessionId.trim()
      ? { sessionId }
      : undefined),
    ...(typeof text === "string" && text.trim() ? { text } : undefined),
    files,
  };
}

export function AskBar() {
  const { pathname } = useLocation();
  const runtime = useAskBarRuntime();
  const pathScope = askBarScopeForPath(pathname, runtime.labels);
  return <AskBarForm key={pathname} pathScope={pathScope} />;
}

function AskBarForm({ pathScope }: { readonly pathScope: AskBarScope }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const runtime = useAskBarRuntime();
  const [draft, setDraft] = useState("");
  // Navigation remounts this form: the model choice belongs to this draft.
  const [draftModel, setDraftModel] = useState<ModelSelectionDto | null>(null);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string>();
  const [files, setFiles] = useState<readonly FileUIPart[]>([]);
  const [usePageScope, setUsePageScope] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    runtime.register(inputRef.current, (text) => {
      setDraft(text);
      inputRef.current?.focus();
      requestAnimationFrame(() => resizeAskBarComposer(inputRef.current));
    });
    return () => runtime.register(null);
  }, [runtime]);

  const pageSubject = pathScope.entry.context.subjects[0];
  const pageIntent = pathScope.entry.context.intent;
  const hasPageDestination = Boolean(pageSubject || pageIntent !== "general");
  const activeDestination = usePageScope
    ? pageSubject
      ? {
          kind: pageSubject.kind,
          label:
            runtime.labels[pageSubject.kind] ??
            `This ${scopeKindLabel(pageSubject.kind).toLowerCase()}`,
        }
      : pageIntent === "task.create"
        ? { kind: "task" as const, label: "Create a recipe" }
        : pageIntent === "connection.create"
          ? {
              kind: "connection" as const,
              label: "Create an integration",
            }
          : undefined
    : undefined;

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
    if (sending || modelSetupStage(runtime.models) !== "ready") return;
    const text = draft.trim();
    if (!text && files.length === 0) return;
    setSending(true);
    setError(undefined);
    setDraft("");
    setFiles([]);
    requestAnimationFrame(() => resizeAskBarComposer(inputRef.current));
    try {
      const session = await api.enterChat({
        ...askBarSubmissionEntry(pathScope, usePageScope),
        modelSelection: draftModel,
      });
      setDraftModel(null);
      navigate(`/chat/${encodeURIComponent(session.id)}`, {
        state: {
          [ASK_BAR_PENDING_SESSION_STATE]: session.id,
          [ASK_BAR_PENDING_STATE]: text,
          ...(files.length > 0
            ? { [ASK_BAR_PENDING_FILES_STATE]: files }
            : undefined),
        },
      });
    } catch (caught) {
      // Session creation failed: nothing was sent, so preserve the draft to retry.
      setDraft(draft);
      setFiles(files);
      requestAnimationFrame(() => resizeAskBarComposer(inputRef.current));
      setError(caught instanceof Error ? caught.message : String(caught));
      setSending(false);
    }
  };

  const addFiles = async (nextFiles: readonly File[]) => {
    setError(undefined);
    try {
      const next = await imagePartsFromFiles(nextFiles, files);
      setFiles(next);
      inputRef.current?.focus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (pasted.length === 0) return;
    event.preventDefault();
    void addFiles(pasted);
  };

  const onComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const action = askBarComposerAction(event.key, event.shiftKey);
    if (action === "blur") {
      setExpanded(false);
      event.currentTarget.blur();
      return;
    }
    if (action === "submit") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const placeholder =
    activeDestination?.kind === "run"
      ? "Ask about this run"
      : activeDestination?.kind === "task"
        ? "Ask about this recipe"
        : activeDestination?.kind === "connection"
          ? "Ask about this integration"
          : ASK_BAR_PLACEHOLDER;
  const disabled = sending;
  const pickerValue = draftModel ?? undefined;
  const onChatHistory =
    (pathname === "/inbox" || pathname === "/runs") &&
    parseInboxView(new URLSearchParams(search).get("view")) === "chats";
  const pickerModels = files.length
    ? (runtime.models?.recipeModels.filter((model) =>
        model.inputModalities.includes("image"),
      ) ?? [])
    : (runtime.models?.recipeModels ?? []);

  if (modelSetupStage(runtime.models) !== "ready") return null;

  return (
    <div className={`ask-bar-zone${expanded ? " expanded" : ""}`}>
      <form
        className={`ask-bar${expanded ? " expanded" : ""}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setExpanded(false);
          }
        }}
        onFocus={() => setExpanded(true)}
        onSubmit={(event) => void submit(event)}
      >
        <div className="ask-bar-head">
          <div className="ask-bar-destination">
            {activeDestination ? (
              <span className="ask-bar-context">
                <span className="ask-bar-context-kind">
                  {scopeKindLabel(activeDestination.kind)}
                </span>
                <span className="ask-bar-context-label">
                  {activeDestination.label}
                </span>
                <button
                  aria-label={`Exclude ${activeDestination.label} from this chat`}
                  onClick={() => {
                    setUsePageScope(false);
                    inputRef.current?.focus();
                  }}
                  title="Remove context"
                  type="button"
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ) : !usePageScope && hasPageDestination ? (
              <button
                className="ask-bar-use-page"
                onClick={() => {
                  setUsePageScope(true);
                  inputRef.current?.focus();
                }}
                type="button"
              >
                {pageSubject
                  ? `Use this ${scopeKindLabel(pageSubject.kind).toLowerCase()}`
                  : pageIntent === "task.create"
                    ? "Create a recipe"
                    : pageIntent === "connection.create"
                      ? "Create an integration"
                      : "Reply here"}
              </button>
            ) : (
              <span className="ask-bar-new-chat">New chat</span>
            )}
          </div>
          <Link
            aria-current={onChatHistory ? "page" : undefined}
            aria-label="Chat history"
            className="ask-bar-history"
            to="/inbox?view=chats"
          >
            <ClockIcon size={16} />
            <span>History</span>
          </Link>
        </div>
        {files.length > 0 ? (
          <section className="ask-bar-attachments" aria-label="Attached images">
            {files.map((file, index) => (
              <figure className="ask-bar-attachment" key={file.url}>
                <img
                  alt={file.filename ?? `Attachment ${index + 1}`}
                  src={file.url}
                />
                <button
                  aria-label={`Remove ${file.filename ?? `attachment ${index + 1}`}`}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((_, candidate) => candidate !== index),
                    )
                  }
                  type="button"
                >
                  <CloseIcon size={12} />
                </button>
              </figure>
            ))}
          </section>
        ) : null}
        <textarea
          aria-label={placeholder}
          disabled={disabled}
          maxLength={8_000}
          onChange={(event) => {
            setDraft(event.target.value);
            resizeAskBarComposer(event.currentTarget);
          }}
          onKeyDown={onComposerKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          ref={inputRef}
          rows={1}
          value={draft}
        />
        <div className="ask-bar-foot">
          <div className="ask-bar-tools">
            <input
              accept="image/png,image/jpeg,image/webp"
              className="ask-bar-file-input"
              multiple
              onChange={(event) =>
                void addFiles(
                  event.currentTarget.files
                    ? [...event.currentTarget.files]
                    : [],
                )
              }
              ref={fileInputRef}
              type="file"
            />
            <button
              aria-label="Attach images"
              className="ask-bar-attach"
              disabled={disabled || files.length >= MAX_IMAGE_FILES}
              onClick={() => fileInputRef.current?.click()}
              title="Attach images"
              type="button"
            >
              <PaperclipIcon />
            </button>
            <ModelPicker
              compact
              disabled={disabled}
              inheritLabel={defaultModelLabel(runtime.models)}
              models={pickerModels}
              onChange={(selection) => {
                setDraftModel(selection);
              }}
              openUp
              value={pickerValue}
            />
          </div>
          <button
            className="button ask-bar-send"
            disabled={
              disabled || (draft.trim().length === 0 && files.length === 0)
            }
            type="submit"
          >
            {sending ? "Opening…" : "Send"}
          </button>
        </div>
      </form>
      {error ? (
        <p className="ask-bar-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function askBarSubmissionEntry(
  pathScope: AskBarScope,
  usePageScope: boolean,
): AskBarScope["entry"] {
  if (!usePageScope) return generalAskEntry("chat");
  return { ...pathScope.entry, mode: "new" };
}

function scopeKindLabel(kind: "task" | "connection" | "run"): string {
  if (kind === "task") return "Recipe";
  if (kind === "connection") return "Integration";
  return "Run";
}

export async function imagePartsFromFiles(
  incoming: readonly File[],
  existing: readonly FileUIPart[],
): Promise<readonly FileUIPart[]> {
  if (existing.length + incoming.length > MAX_IMAGE_FILES) {
    throw new Error(`Attach up to ${MAX_IMAGE_FILES} images at a time.`);
  }
  for (const file of incoming) {
    if (!IMAGE_MEDIA_TYPES.has(file.type)) {
      throw new Error("Images must be PNG, JPEG, or WebP files.");
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      throw new Error("Each image must be 10 MB or smaller.");
    }
  }
  const existingBytes = existing.reduce(
    (total, part) => total + dataUrlByteSize(part.url),
    0,
  );
  if (
    existingBytes + incoming.reduce((total, file) => total + file.size, 0) >
    MAX_IMAGE_TOTAL_BYTES
  ) {
    throw new Error("Attached images must total 20 MB or less.");
  }
  const parts = await Promise.all(
    incoming.map(
      async (file): Promise<FileUIPart> => ({
        type: "file",
        mediaType: file.type,
        filename: file.name || "pasted-image",
        url: await readFileDataUrl(file),
      }),
    ),
  );
  return [...existing, ...parts];
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Springroll could not read that image."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Springroll could not read that image."));
    reader.readAsDataURL(file);
  });
}

function dataUrlByteSize(value: string): number {
  const comma = value.indexOf(",");
  if (comma < 0) return 0;
  return Math.floor((value.length - comma - 1) * 0.75);
}
