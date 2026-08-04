import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  AssistantMessageDto,
  ChatDetailDto,
  ChatSessionDto,
} from "../shared.ts";
import { api } from "./api.ts";
import { PlusIcon } from "./icons.tsx";
import { RunMarkdown } from "./run-markdown.tsx";

export function ChatIndexPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<readonly ChatSessionDto[]>();
  const [error, setError] = useState<unknown>();
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      setSessions(await api.chats());
    } catch (caught) {
      setError(caught);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const create = async () => {
    setCreating(true);
    setError(undefined);
    try {
      const session = await api.createChat();
      navigate(`/chat/${session.id}`);
    } catch (caught) {
      setError(caught);
      setCreating(false);
    }
  };

  return (
    <section className="page chat-index-page">
      <div className="page-heading">
        <div>
          <div className="section-label">Springroll assistant</div>
          <h1 className="display-title">Chat</h1>
        </div>
        <button
          className="button primary"
          disabled={creating}
          onClick={() => void create()}
          type="button"
        >
          <PlusIcon />
          {creating ? "Starting…" : "New chat"}
        </button>
      </div>
      <p className="page-intro">
        Ask Springroll about your connections, recipes, runs, and model setup.
        Changes will be proposed for review before they happen.
      </p>
      {error ? <ChatError error={error} retry={load} /> : null}
      {!sessions ? <div className="loading-line" role="status" /> : null}
      {sessions?.length === 0 ? (
        <section className="empty-state">
          <span className="empty-orbit" aria-hidden="true" />
          <h2>Start with what you want</h2>
          <p>
            Try “Connect Microsoft Clarity” or “Why did yesterday’s digest
            fail?”
          </p>
          <button
            className="button primary"
            disabled={creating}
            onClick={() => void create()}
            type="button"
          >
            Start a chat
          </button>
        </section>
      ) : null}
      {sessions && sessions.length > 0 ? (
        <nav className="chat-history" aria-label="Chat history">
          {sessions.map((session) => (
            <Link
              className="chat-history-row"
              key={session.id}
              to={`/chat/${session.id}`}
            >
              <span>
                <strong>{session.title || "New conversation"}</strong>
                <small>
                  {session.activeTurnId ? "Working…" : "Ready"}
                  {session.lastMessageAt
                    ? ` · ${formatRelativeDate(session.lastMessageAt)}`
                    : ""}
                </small>
              </span>
              <i aria-hidden="true">›</i>
            </Link>
          ))}
        </nav>
      ) : null}
    </section>
  );
}

export function ChatDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ChatDetailDto>();
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(undefined);
      setDetail(await api.chat(id));
    } catch (caught) {
      setError(caught);
    }
  }, [id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!detail?.session.activeTurnId) return;
    const timer = window.setInterval(() => void load(), 750);
    return () => window.clearInterval(timer);
  }, [detail?.session.activeTurnId, load]);

  const archive = async () => {
    if (!id) return;
    try {
      await api.archiveChat(id);
      navigate("/chat", { replace: true });
    } catch (caught) {
      setError(caught);
    }
  };

  if (!id) return null;
  if (!detail && !error) {
    return (
      <section className="page narrow">
        <div className="loading-line" role="status" />
      </section>
    );
  }

  return (
    <section className="page chat-detail-page">
      <div className="chat-detail-head">
        <div>
          <Link className="back-link" to="/chat">
            ‹ Chat history
          </Link>
          <h1>{detail?.session.title || "New conversation"}</h1>
          {detail ? <ChatUsage detail={detail} /> : null}
        </div>
        <button
          className="quiet-button"
          disabled={Boolean(detail?.session.activeTurnId)}
          onClick={() => void archive()}
          type="button"
        >
          {detail?.session.activeTurnId ? "Working…" : "Archive"}
        </button>
      </div>
      {error ? <ChatError error={error} retry={load} /> : null}
      {detail ? <ChatConversation detail={detail} onReload={load} /> : null}
    </section>
  );
}

function ChatConversation({
  detail,
  onReload,
}: {
  readonly detail: ChatDetailDto;
  readonly onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [syncError, setSyncError] = useState<unknown>();
  const endRef = useRef<HTMLDivElement>(null);
  const serverMessageIdRef = useRef(detail.messages.at(-1)?.id);
  const sessionId = detail.session.id;
  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantMessageDto>({
        api: `/api/chats/${encodeURIComponent(sessionId)}/messages`,
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          if (trigger !== "submit-message") {
            throw new Error("Regeneration is not available yet");
          }
          const message = messages.at(-1);
          if (message?.role !== "user") {
            throw new Error("A new user message is required");
          }
          return { body: { message } };
        },
      }),
    [sessionId],
  );
  const { messages, sendMessage, setMessages, status, error, clearError } =
    useChat<AssistantMessageDto>({
      id: sessionId,
      messages: [...detail.messages],
      transport,
      onFinish: () => void syncFromServer(),
    });

  async function syncFromServer() {
    try {
      const next = await api.chat(sessionId);
      serverMessageIdRef.current = next.messages.at(-1)?.id;
      setMessages([...next.messages]);
      await onReload();
    } catch (caught) {
      setSyncError(caught);
    }
  }

  useEffect(() => {
    const nextMessageId = detail.messages.at(-1)?.id;
    if (status === "ready" && nextMessageId !== serverMessageIdRef.current) {
      serverMessageIdRef.current = nextMessageId;
      setMessages([...detail.messages]);
    }
  }, [detail.messages, setMessages, status]);
  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: messages.length > 0 && status !== "error" ? "smooth" : "auto",
      block: "end",
    });
  }, [messages, status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || status !== "ready" || detail.session.activeTurnId) return;
    setDraft("");
    setSyncError(undefined);
    clearError();
    await sendMessage({ text });
  };

  const busy = status === "submitted" || status === "streaming";
  return (
    <div className="chat-shell">
      <div className="chat-transcript" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <BrandMark />
            <h2>What would you like Springroll to handle?</h2>
            <p>
              I can inspect the app now. I’ll propose changes and keep secrets
              in the app’s credential controls, not in chat.
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {busy ? (
          <div className="chat-thinking">Springroll is working…</div>
        ) : null}
        {detail.session.activeTurnId && !busy ? (
          <div className="chat-thinking">
            This response is continuing in the background…
          </div>
        ) : null}
        {error || syncError ? <ChatError error={error ?? syncError} /> : null}
        <div ref={endRef} />
      </div>
      <form className="chat-composer" onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label="Message Springroll"
          disabled={busy || Boolean(detail.session.activeTurnId)}
          maxLength={8_000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Ask about a connection, recipe, or run"
          rows={3}
          value={draft}
        />
        <div className="chat-composer-foot">
          <span>
            Credentials are collected separately and never sent through chat.
          </span>
          <button
            className="button primary"
            disabled={
              busy ||
              Boolean(detail.session.activeTurnId) ||
              draft.trim().length === 0
            }
            type="submit"
          >
            {busy ? "Working…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatMessage({ message }: { readonly message: AssistantMessageDto }) {
  return (
    <article className={`chat-message ${message.role}`}>
      <div className="chat-message-role">
        {message.role === "user" ? "You" : "Springroll"}
      </div>
      <div className="chat-message-content">
        {message.parts.map((part) => (
          <ChatPart
            key={`${message.id}:${chatPartKey(part)}`}
            part={part}
            role={message.role}
          />
        ))}
      </div>
      {message.role === "assistant" && message.metadata?.modelId ? (
        <small className="chat-message-meta">
          {message.metadata.provider} · {message.metadata.modelId}
        </small>
      ) : null}
    </article>
  );
}

function ChatPart({
  part,
  role,
}: {
  readonly part: AssistantMessageDto["parts"][number];
  readonly role: AssistantMessageDto["role"];
}) {
  if (part.type === "text") {
    return role === "assistant" ? (
      <RunMarkdown content={part.text} />
    ) : (
      <p>{part.text}</p>
    );
  }
  if (part.type === "source-url") {
    const href = safeExternalUrl(part.url);
    if (!href) {
      return <div className="chat-source">Source link unavailable</div>;
    }
    return (
      <a className="chat-source" href={href} rel="noreferrer" target="_blank">
        {part.title || part.url}
      </a>
    );
  }
  if (part.type === "source-document") {
    return <div className="chat-source">Source: {part.title}</div>;
  }
  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
    const state =
      "state" in part && typeof part.state === "string"
        ? part.state
        : "working";
    return (
      <div className="chat-tool-state">
        <span aria-hidden="true" />
        {toolLabel(part.type)} · {friendlyToolState(state)}
      </div>
    );
  }
  if (part.type.startsWith("data-")) {
    return (
      <div className="chat-tool-state">
        Springroll updated this conversation.
      </div>
    );
  }
  return null;
}

function ChatUsage({ detail }: { readonly detail: ChatDetailDto }) {
  const cost =
    detail.usage.actualCostUsdMicros || detail.usage.estimatedCostUsdMicros;
  if (detail.usage.totalTokens === 0 && cost === 0) return null;
  return (
    <div className="chat-usage">
      {detail.usage.totalTokens.toLocaleString()} tokens
      {cost ? ` · $${(cost / 1_000_000).toFixed(4)}` : ""}
    </div>
  );
}

function ChatError({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry?: () => Promise<void>;
}) {
  return (
    <div className="error-notice" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry ? (
        <button
          className="quiet-button"
          onClick={() => void retry()}
          type="button"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

function BrandMark() {
  return (
    <svg aria-hidden="true" className="chat-brand-mark" viewBox="0 0 24 24">
      <path d="M4 7c4 1 7 4 8 9M20 4c-5 1-8 5-8 12M8 20h8" />
    </svg>
  );
}

function toolLabel(type: string): string {
  const name = type
    .replace(/^tool-/, "")
    .replace(/^springroll_/, "")
    .replaceAll("_", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function friendlyToolState(state: string): string {
  if (state.includes("error")) return "failed";
  if (state.startsWith("output")) return "done";
  if (state.includes("approval")) return "waiting for approval";
  return "working";
}

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function chatPartKey(part: AssistantMessageDto["parts"][number]): string {
  if ("id" in part && typeof part.id === "string") {
    return `${part.type}:${part.id}`;
  }
  if ("toolCallId" in part && typeof part.toolCallId === "string") {
    return `${part.type}:${part.toolCallId}`;
  }
  if (part.type === "text") return `text:${part.text.slice(0, 120)}`;
  if (part.type === "source-url") return `source:${part.url}`;
  return part.type;
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}
