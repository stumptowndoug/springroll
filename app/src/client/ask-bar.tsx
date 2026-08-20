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
} from "./chat-session-entry.ts";
import { CloseIcon, ListIcon, PaperclipIcon } from "./icons.tsx";
import { parseInboxView } from "./inbox-feed.ts";
import { defaultModelLabel, ModelPicker } from "./model-picker.tsx";

export const ASK_BAR_PENDING_STATE = "pendingMessage";
export const ASK_BAR_PENDING_FILES_STATE = "pendingFiles";
const ASK_BAR_MAX_HEIGHT_PX = 112;
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

export type AskBarThread = {
  readonly send: (text: string, files?: readonly FileUIPart[]) => Promise<void>;
  readonly stop: () => void;
  readonly busy: boolean;
  readonly archived: boolean;
  readonly modelOverride?: ModelSelectionDto;
  readonly setModel: (selection: ModelSelectionDto | null) => Promise<void>;
};

const AskBarRuntimeContext = createContext<{
  readonly focus: () => void;
  readonly seed: (text: string) => void;
  readonly register: (
    element: HTMLTextAreaElement | null,
    seed?: (text: string) => void,
  ) => void;
  readonly setLabels: (labels: AskBarLabels) => void;
  readonly setThread: (thread: AskBarThread | null) => void;
  readonly labels: AskBarLabels;
  readonly thread: AskBarThread | null;
  readonly models: ModelSettingsDto | undefined;
  readonly draftModel: ModelSelectionDto | null | undefined;
  readonly setDraftModel: (selection: ModelSelectionDto | null) => void;
} | null>(null);

export function AskBarProvider({ children }: { readonly children: ReactNode }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const seedRef = useRef<(text: string) => void>(() => undefined);
  const [labels, setLabels] = useState<AskBarLabels>({});
  const [thread, setThread] = useState<AskBarThread | null>(null);
  const [models, setModels] = useState<ModelSettingsDto>();
  const [draftModel, setDraftModel] = useState<
    ModelSelectionDto | null | undefined
  >();
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
      setThread,
      setDraftModel,
    }),
    [],
  );
  useEffect(() => {
    void api
      .models()
      .then(setModels)
      .catch(() => undefined);
  }, []);
  const value = useMemo(
    () => ({ ...controls, labels, thread, models, draftModel }),
    [controls, draftModel, labels, models, thread],
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

export function askBarComposerAction(
  key: string,
  shiftKey: boolean,
): "submit" | "blur" | undefined {
  if (key === "Escape") return "blur";
  if (key === "Enter" && !shiftKey) return "submit";
  return undefined;
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
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string>();
  const [files, setFiles] = useState<readonly FileUIPart[]>([]);
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

  const thread = pathScope.continueSessionId ? runtime.thread : null;
  const continuing = Boolean(pathScope.continueSessionId);

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
    if (!text && files.length === 0) return;
    if (continuing) {
      if (!thread || thread.archived || thread.busy) return;
      setSending(true);
      setError(undefined);
      try {
        await thread.send(text, files);
        setDraft("");
        setFiles([]);
        requestAnimationFrame(() => resizeAskBarComposer(inputRef.current));
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
      const session = await api.enterChat({
        ...pathScope.entry,
        ...(runtime.draftModel === undefined
          ? undefined
          : { modelSelection: runtime.draftModel }),
      });
      setDraft("");
      requestAnimationFrame(() => resizeAskBarComposer(inputRef.current));
      navigate(`/chat/${encodeURIComponent(session.id)}`, {
        state: {
          [ASK_BAR_PENDING_STATE]: text,
          ...(files.length > 0
            ? { [ASK_BAR_PENDING_FILES_STATE]: files }
            : undefined),
        },
      });
      setFiles([]);
    } catch (caught) {
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
      event.currentTarget.blur();
      return;
    }
    if (action === "submit") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const placeholder = thread?.archived
    ? "Restore this conversation to continue"
    : ASK_BAR_PLACEHOLDER;
  const disabled =
    sending || (continuing && (!thread || thread.archived || thread.busy));
  const pickerValue = continuing
    ? thread?.modelOverride
    : (runtime.draftModel ?? undefined);
  const onChatHistory =
    (pathname === "/inbox" || pathname === "/runs") &&
    parseInboxView(new URLSearchParams(search).get("view")) === "chats";
  const pickerModels = files.length
    ? (runtime.models?.models.filter((model) =>
        model.inputModalities.includes("image"),
      ) ?? [])
    : (runtime.models?.models ?? []);

  return (
    <div className="ask-bar-zone">
      <form
        className={`ask-bar${focused ? " focused" : ""}`}
        onSubmit={(event) => void submit(event)}
      >
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
        <Link
          aria-current={onChatHistory ? "page" : undefined}
          aria-label="Chat history"
          className="ask-bar-history"
          to="/inbox?view=chats"
        >
          <ListIcon size={16} />
        </Link>
        <ModelPicker
          compact
          disabled={disabled}
          inheritLabel={defaultModelLabel(runtime.models)}
          models={pickerModels}
          onChange={(selection) => {
            runtime.setDraftModel(selection);
            if (continuing && thread) {
              void thread.setModel(selection);
            }
          }}
          openUp
          value={pickerValue}
        />
        <input
          accept="image/png,image/jpeg,image/webp"
          className="ask-bar-file-input"
          multiple
          onChange={(event) =>
            void addFiles(
              event.currentTarget.files ? [...event.currentTarget.files] : [],
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
        <textarea
          aria-label={placeholder}
          disabled={disabled}
          maxLength={8_000}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setDraft(event.target.value);
            resizeAskBarComposer(event.currentTarget);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={onComposerKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          ref={inputRef}
          rows={1}
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
            disabled={
              disabled || (draft.trim().length === 0 && files.length === 0)
            }
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

async function imagePartsFromFiles(
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
