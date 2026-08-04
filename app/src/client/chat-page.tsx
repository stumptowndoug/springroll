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
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  AssistantMessageDto,
  ChatDetailDto,
  ChatSessionContextDto,
  ChatSessionDto,
  ChatUsageDto,
  ConnectionCardDto,
  IntegrationProposalOutcomeDto,
  TaskProposalOutcomeDto,
  TaskSummaryDto,
} from "../shared.ts";
import { api } from "./api.ts";
import {
  connectionResearchOutcomeFromToolPart,
  describeChatToolPart,
  taskProposalOutcomeFromToolPart,
} from "./chat-tool-presentation.ts";
import { PlusIcon } from "./icons.tsx";
import { RunMarkdown } from "./run-markdown.tsx";

export function ChatIndexPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<readonly ChatSessionDto[]>();
  const [error, setError] = useState<unknown>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      setSessions(await api.chats(includeArchived));
    } catch (caught) {
      setError(caught);
    }
  }, [includeArchived]);
  useEffect(() => void load(), [load]);

  const create = async () => {
    setCreating(true);
    setError(undefined);
    try {
      const session = await api.enterChat({
        mode: "new",
        context: {
          version: 1,
          intent: "general",
          origin: "chat",
          subjects: [],
        },
      });
      navigate(`/chat/${session.id}`);
    } catch (caught) {
      setError(caught);
      setCreating(false);
    }
  };

  const restore = async (id: string) => {
    try {
      setError(undefined);
      await api.updateChat(id, { status: "active" });
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSessions = sessions?.filter(
    (session) =>
      !normalizedQuery ||
      (session.title || "New conversation")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
  );

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
      <div className="chat-history-controls">
        <label>
          <span>Search conversations</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chat titles"
            type="search"
            value={query}
          />
        </label>
        <label className="chat-archive-toggle">
          <input
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            type="checkbox"
          />
          Show archived
        </label>
      </div>
      {error ? <ChatError error={error} retry={load} /> : null}
      {!sessions ? <div className="loading-line" role="status" /> : null}
      {sessions?.length === 0 && !includeArchived ? (
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
      {visibleSessions?.length === 0 && sessions && sessions.length > 0 ? (
        <div className="chat-history-empty">
          No conversations match that search.
        </div>
      ) : null}
      {visibleSessions && visibleSessions.length > 0 ? (
        <nav className="chat-history" aria-label="Chat history">
          {visibleSessions.map((session) => (
            <div className="chat-history-row" key={session.id}>
              <Link to={`/chat/${session.id}`}>
                <span>
                  <strong>{chatSessionTitle(session)}</strong>
                  <small>
                    {session.status === "archived"
                      ? "Archived"
                      : session.activeTurnId
                        ? "Working…"
                        : "Ready"}
                    {session.lastMessageAt
                      ? ` · ${formatRelativeDate(session.lastMessageAt)}`
                      : ""}
                  </small>
                </span>
                {session.status === "active" ? (
                  <i aria-hidden="true">›</i>
                ) : null}
              </Link>
              {session.status === "archived" ? (
                <button
                  className="quiet-button"
                  onClick={() => void restore(session.id)}
                  type="button"
                >
                  Restore
                </button>
              ) : null}
            </div>
          ))}
        </nav>
      ) : null}
    </section>
  );
}

export function ChatDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ChatDetailDto>();
  const [error, setError] = useState<unknown>();
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

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
    setTitleDraft(detail?.session.title || "");
  }, [detail?.session.title]);
  useEffect(() => {
    if (renaming) titleInputRef.current?.focus();
  }, [renaming]);
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

  const restore = async () => {
    if (!id) return;
    try {
      setError(undefined);
      await api.updateChat(id, { status: "active" });
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  const permanentlyDelete = async () => {
    if (!id) return;
    if (
      !window.confirm(
        "Permanently delete this conversation and its usage history? This cannot be undone.",
      )
    )
      return;
    try {
      setError(undefined);
      await api.deleteChat(id);
      navigate("/chat", { replace: true });
    } catch (caught) {
      setError(caught);
    }
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!id || !titleDraft.trim()) return;
    try {
      setError(undefined);
      await api.updateChat(id, { title: titleDraft.trim() });
      setRenaming(false);
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  if (!id) return null;
  const initialPrompt =
    detail?.messages.length === 0
      ? detail.session.context?.suggestedPrompt
      : undefined;
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
          {renaming ? (
            <form
              className="chat-title-editor"
              onSubmit={(event) => void rename(event)}
            >
              <input
                aria-label="Chat title"
                maxLength={200}
                onChange={(event) => setTitleDraft(event.target.value)}
                ref={titleInputRef}
                value={titleDraft}
              />
              <button className="button primary" type="submit">
                Save
              </button>
              <button
                className="quiet-button"
                onClick={() => setRenaming(false)}
                type="button"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="chat-title-line">
              {detail?.session.context ? (
                <div className="section-label">
                  {chatContextLabel(detail.session.context.intent)}
                </div>
              ) : null}
              <h1>
                {detail ? chatSessionTitle(detail.session) : "New conversation"}
              </h1>
              {detail ? (
                <button
                  className="quiet-button"
                  onClick={() => setRenaming(true)}
                  type="button"
                >
                  Rename
                </button>
              ) : null}
            </div>
          )}
          {detail ? <ChatUsage detail={detail} /> : null}
        </div>
        <div className="chat-detail-actions">
          <button
            className="quiet-button"
            disabled={Boolean(detail?.session.activeTurnId)}
            onClick={() => void load()}
            type="button"
          >
            Refresh
          </button>
          <button
            className="quiet-button"
            disabled={Boolean(detail?.session.activeTurnId)}
            onClick={() =>
              void (detail?.session.status === "archived"
                ? restore()
                : archive())
            }
            type="button"
          >
            {detail?.session.activeTurnId
              ? "Working…"
              : detail?.session.status === "archived"
                ? "Restore"
                : "Archive"}
          </button>
          {detail?.session.status === "archived" ? (
            <button
              className="quiet-button danger"
              onClick={() => void permanentlyDelete()}
              type="button"
            >
              Delete permanently
            </button>
          ) : null}
        </div>
      </div>
      {error ? <ChatError error={error} retry={load} /> : null}
      {searchParams.get("oauthError") ? (
        <ChatError error={searchParams.get("oauthError")} />
      ) : null}
      {searchParams.get("oauth") === "connected" ? (
        <div className="chat-oauth-return" role="status">
          Sign-in completed. Springroll discovered and safely tested the
          connection.
        </div>
      ) : null}
      {detail ? (
        <ChatConversation
          detail={detail}
          {...(initialPrompt ? { initialDraft: initialPrompt } : undefined)}
          onReload={load}
        />
      ) : null}
    </section>
  );
}

function ChatConversation({
  detail,
  initialDraft,
  onReload,
}: {
  readonly detail: ChatDetailDto;
  readonly initialDraft?: string;
  readonly onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [syncError, setSyncError] = useState<unknown>();
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
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
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    error,
    clearError,
    stop,
  } = useChat<AssistantMessageDto>({
    id: sessionId,
    messages: [...detail.messages],
    transport,
    onFinish: () => void syncFromServer(),
    onError: () => void syncFromServer(),
  });

  async function syncFromServer() {
    try {
      const next = await api.chat(sessionId);
      serverMessageIdRef.current = next.messages.at(-1)?.id;
      setMessages([...next.messages]);
      if (!next.session.activeTurnId) clearError();
      await onReload();
    } catch (caught) {
      setSyncError(caught);
    }
  }

  useEffect(() => {
    const nextMessageId = detail.messages.at(-1)?.id;
    if (
      (status === "ready" || status === "error") &&
      nextMessageId !== serverMessageIdRef.current
    ) {
      serverMessageIdRef.current = nextMessageId;
      setMessages([...detail.messages]);
      if (status === "error") clearError();
    }
  }, [clearError, detail.messages, setMessages, status]);
  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: messages.length > 0 && status !== "error" ? "smooth" : "auto",
      block: "end",
    });
  }, [messages, status]);
  useEffect(() => {
    if (initialDraft) composerRef.current?.focus();
  }, [initialDraft]);

  const busy = status === "submitted" || status === "streaming";
  const archived = detail.session.status === "archived";
  const latestTurn = detail.turns.at(-1);
  const usageByTurn = new Map(
    detail.turns.map((turn) => [turn.id, turn.usage] as const),
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || archived || status !== "ready" || detail.session.activeTurnId)
      return;
    setDraft("");
    setSyncError(undefined);
    clearError();
    await sendMessage({ text });
  };

  const retryLatestTurn = async () => {
    if (archived || status !== "ready" || detail.session.activeTurnId) return;
    const original = messages.findLast(
      (message) =>
        message.role === "user" && message.metadata?.turnId === latestTurn?.id,
    );
    const text = original ? messageText(original) : undefined;
    if (!text) return;
    setSyncError(undefined);
    clearError();
    await sendMessage({ text });
  };

  const editMessage = (message: AssistantMessageDto) => {
    const text = messageText(message);
    if (!text || archived || busy || detail.session.activeTurnId) return;
    setDraft(text);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(text.length, text.length);
    });
  };

  const stopActiveTurn = async () => {
    if (!busy && !detail.session.activeTurnId) return;
    setSyncError(undefined);
    try {
      await api.cancelChat(sessionId);
      await stop();
      await syncFromServer();
    } catch (caught) {
      setSyncError(caught);
    }
  };

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
          <ChatMessage
            context={detail.session.context}
            interactive={!archived && !busy && !detail.session.activeTurnId}
            key={message.id}
            message={message}
            {...(message.role === "assistant" && message.metadata?.turnId
              ? { usage: usageByTurn.get(message.metadata.turnId) }
              : undefined)}
            {...(message.role === "user" &&
            !archived &&
            !busy &&
            !detail.session.activeTurnId
              ? { onEdit: () => editMessage(message) }
              : undefined)}
          />
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
        {archived ? (
          <div className="chat-turn-notice">
            <div>
              <strong>This conversation is archived.</strong>
              <span>Restore it to continue chatting.</span>
            </div>
          </div>
        ) : null}
        {(latestTurn?.status === "failed" ||
          latestTurn?.status === "cancelled") &&
        !busy ? (
          <div className="chat-turn-notice" role="alert">
            <div>
              <strong>
                {latestTurn.status === "cancelled"
                  ? "The previous response was stopped."
                  : "The previous response did not finish."}
              </strong>
              <span>
                {latestTurn.error ||
                  (latestTurn.status === "cancelled"
                    ? "You can retry the same request whenever you're ready."
                    : "Springroll could not complete it.")}
              </span>
            </div>
            <button
              className="quiet-button"
              disabled={archived || Boolean(detail.session.activeTurnId)}
              onClick={() => void retryLatestTurn()}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      <form className="chat-composer" onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label="Message Springroll"
          disabled={archived || busy || Boolean(detail.session.activeTurnId)}
          maxLength={8_000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            archived
              ? "Restore this conversation to continue"
              : "Ask about a connection, recipe, or run"
          }
          ref={composerRef}
          rows={3}
          value={draft}
        />
        <div className="chat-composer-foot">
          <span>
            Credentials are collected separately and never sent through chat.
          </span>
          {archived ? (
            <span>Restore this conversation to send another message.</span>
          ) : busy || detail.session.activeTurnId ? (
            <button
              className="quiet-button"
              onClick={() => void stopActiveTurn()}
              type="button"
            >
              Stop
            </button>
          ) : (
            <button
              className="button primary"
              disabled={draft.trim().length === 0}
              type="submit"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ChatMessage({
  context,
  message,
  interactive,
  onEdit,
  usage,
}: {
  readonly message: AssistantMessageDto;
  readonly context: ChatSessionContextDto | null;
  readonly interactive: boolean;
  readonly onEdit?: () => void;
  readonly usage?: ChatUsageDto | undefined;
}) {
  const metadata = assistantMessageMetadata(message, usage);
  return (
    <article className={`chat-message ${message.role}`}>
      <div className="chat-message-role">
        <span>{message.role === "user" ? "You" : "Springroll"}</span>
        {onEdit ? (
          <button onClick={onEdit} type="button">
            Edit
          </button>
        ) : null}
      </div>
      <div className="chat-message-content">
        {message.parts.map((part) => (
          <ChatPart
            key={`${message.id}:${chatPartKey(part)}`}
            part={part}
            role={message.role}
            interactive={interactive}
            context={context}
          />
        ))}
      </div>
      {metadata ? (
        <small className="chat-message-meta">{metadata}</small>
      ) : null}
    </article>
  );
}

function ChatPart({
  context,
  part,
  role,
  interactive,
}: {
  readonly part: AssistantMessageDto["parts"][number];
  readonly context: ChatSessionContextDto | null;
  readonly role: AssistantMessageDto["role"];
  readonly interactive: boolean;
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
    const presentation = describeChatToolPart(part);
    const researchOutcome = connectionResearchOutcomeFromToolPart(part);
    const taskOutcome = taskProposalOutcomeFromToolPart(part);
    return (
      <div className="chat-tool-event">
        <div
          className={`chat-tool-state ${state.includes("error") ? "failed" : ""}`}
        >
          <span aria-hidden="true" />
          {presentation.label} · {friendlyToolState(state)}
        </div>
        {presentation.detail ? (
          <small className="chat-tool-detail">{presentation.detail}</small>
        ) : null}
        {researchOutcome ? (
          <ConnectionResearchCard
            context={context}
            interactive={interactive}
            outcome={researchOutcome}
          />
        ) : null}
        {taskOutcome ? (
          <TaskProposalCard
            context={context}
            interactive={interactive}
            outcome={taskOutcome}
          />
        ) : null}
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

function TaskProposalCard({
  context,
  outcome,
  interactive,
}: {
  readonly outcome: TaskProposalOutcomeDto;
  readonly context: ChatSessionContextDto | null;
  readonly interactive: boolean;
}) {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<TaskSummaryDto>();
  const [createError, setCreateError] = useState<unknown>();
  const durableTaskId =
    context?.intent === "task.manage"
      ? context.subjects.find((subject) => subject.kind === "task")?.id
      : undefined;

  useEffect(() => {
    if (!durableTaskId || created?.id === durableTaskId) return;
    void api
      .task(durableTaskId)
      .then(setCreated)
      .catch(() => undefined);
  }, [created?.id, durableTaskId]);

  if (outcome.status !== "ready") {
    return (
      <section className="chat-connection-result chat-task-proposal unavailable">
        <div className="section-label">
          {outcome.status === "needs_integration"
            ? "Needs an integration"
            : "Not supported"}
        </div>
        <strong>{outcome.title}</strong>
        <p>{outcome.explanation}</p>
        {outcome.status === "needs_integration" ? (
          <Link className="quiet-button" to="/integrations/connections/new">
            Set up an integration
          </Link>
        ) : null}
      </section>
    );
  }

  const { proposal } = outcome;
  const create = async () => {
    if (!interactive || creating || created) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const task = await api.createTask(proposal, false);
      setCreated(task);
      if (sessionId) {
        await api.updateChatContext(sessionId, {
          version: 1,
          intent: "task.manage",
          origin: "recipes",
          subjects: [{ kind: "task", id: task.id }],
        });
      }
    } catch (caught) {
      setCreateError(caught);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="chat-connection-result chat-task-proposal ready">
      <div className="section-label">Recipe proposal</div>
      <h3>{proposal.title}</h3>
      <p>{proposal.prompt}</p>
      <div className="chat-task-facts">
        <span>{proposal.scheduleLabel}</span>
        <span>{proposal.timezone}</span>
        <span>{proposal.connectionName}</span>
      </div>
      <ul className="connector-tool-list" aria-label="Proposed recipe tools">
        {proposal.tools.map((item) => (
          <li key={item.name}>
            <i aria-hidden="true" className={`risk-dot risk-${item.effect}`} />
            {item.name}
          </li>
        ))}
      </ul>
      <div className="chat-task-contract">
        <strong>What it may do</strong>
        <p>{proposal.contract}</p>
      </div>
      {createError ? <ChatError error={createError} /> : null}
      {created ? (
        <div className="chat-connection-success" role="status">
          <strong>Recipe created and paused.</strong>
          <button
            className="quiet-button"
            onClick={() => navigate(`/recipes/${created.id}`)}
            type="button"
          >
            Review recipe
          </button>
        </div>
      ) : (
        <button
          className="button primary"
          disabled={!interactive || creating}
          onClick={() => void create()}
          type="button"
        >
          {creating
            ? "Creating…"
            : interactive
              ? "Create paused recipe"
              : "Restore chat to create"}
        </button>
      )}
    </section>
  );
}

function ConnectionResearchCard({
  context,
  outcome,
  interactive,
}: {
  readonly outcome: IntegrationProposalOutcomeDto;
  readonly context: ChatSessionContextDto | null;
  readonly interactive: boolean;
}) {
  if (outcome.status !== "ready") {
    return (
      <section className="chat-connection-result unavailable">
        <div className="section-label">Not verified</div>
        <strong>{outcome.title}</strong>
        <p>{outcome.explanation}</p>
        <Link className="quiet-button" to="/integrations/connections/manual">
          Enter an MCP server manually
        </Link>
      </section>
    );
  }
  return (
    <ReadyConnectionProposal
      context={context}
      interactive={interactive}
      outcome={outcome}
    />
  );
}

function ReadyConnectionProposal({
  context,
  outcome,
  interactive,
}: {
  readonly outcome: Extract<
    IntegrationProposalOutcomeDto,
    { readonly status: "ready" }
  >;
  readonly interactive: boolean;
  readonly context: ChatSessionContextDto | null;
}) {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const { proposal } = outcome;
  const recommended =
    proposal.variants.find((variant) => variant.recommended) ??
    proposal.variants[0];
  const [selectedId, setSelectedId] = useState(recommended?.id ?? "");
  const [prepared, setPrepared] = useState<ConnectionCardDto>();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [setupError, setSetupError] = useState<unknown>();
  const selected = proposal.variants.find(
    (variant) => variant.id === selectedId,
  );

  const markConnected = useCallback(
    async (connectorId: string) => {
      setConnected(true);
      if (sessionId) {
        await api.updateChatContext(sessionId, {
          version: 1,
          intent: "connection.manage",
          origin: "connections",
          subjects: [{ kind: "connection", id: connectorId }],
        });
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const connectorId =
      searchParams.get("connector") ??
      (context?.intent === "connection.manage"
        ? context.subjects.find((subject) => subject.kind === "connection")?.id
        : undefined);
    if (!connectorId) return;
    void api
      .connections()
      .then((connections) => {
        if (
          connections.some(
            (connection) =>
              connection.id === connectorId &&
              connection.name === proposal.name &&
              connection.status === "connected",
          )
        ) {
          if (interactive) {
            void markConnected(connectorId).catch(setSetupError);
          } else {
            setConnected(true);
          }
        }
      })
      .catch(() => undefined);
  }, [context, interactive, markConnected, proposal.name, searchParams]);

  const begin = async () => {
    if (!interactive || !selected || busy) return;
    setBusy(true);
    setSetupError(undefined);
    try {
      const card = await api.prepareIntegrationVariant(
        proposal.templateId,
        selected.id,
      );
      setPrepared(card);
      if (card.credentialKind === "oauth") {
        const returnTo = sessionId
          ? `/chat/${encodeURIComponent(sessionId)}?connector=${encodeURIComponent(card.id)}`
          : undefined;
        const result = await api.startConnectorOAuth(card.id, returnTo);
        if (result.status === "redirect") {
          window.location.assign(result.authorizationUrl);
          return;
        }
        await markConnected(card.id);
      } else if (card.credentialKind === "none") {
        await api.connectConnector(card.id);
        await markConnected(card.id);
      }
    } catch (caught) {
      setSetupError(caught);
    } finally {
      setBusy(false);
    }
  };

  const connectWithKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!interactive || !prepared || !apiKey.trim() || busy) return;
    setBusy(true);
    setSetupError(undefined);
    try {
      await api.connectConnector(prepared.id, apiKey);
      setApiKey("");
      await markConnected(prepared.id);
    } catch (caught) {
      setSetupError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat-connection-result ready">
      <div className="section-label">
        {proposal.trust === "registry-verified"
          ? "Registry verified"
          : "Springroll curated"}
      </div>
      <h3>{proposal.name}</h3>
      <p>{proposal.description}</p>
      <div className="chat-connection-host">Hosted by {proposal.operator}</div>
      {proposal.sources?.length ? (
        <nav className="chat-connection-sources" aria-label="Research sources">
          {proposal.sources.map((source) => {
            const href = safeExternalUrl(source.url);
            return href ? (
              <a href={href} key={source.url} rel="noreferrer" target="_blank">
                {source.title}
              </a>
            ) : null;
          })}
        </nav>
      ) : null}
      {proposal.variants.length > 1 ? (
        <fieldset disabled={!interactive || busy || connected}>
          <legend>Setup method</legend>
          {proposal.variants.map((variant) => (
            <label key={variant.id}>
              <input
                checked={selectedId === variant.id}
                name={`chat-connection-${proposal.templateId}`}
                onChange={() => {
                  setSelectedId(variant.id);
                  setPrepared(undefined);
                  setApiKey("");
                  setSetupError(undefined);
                }}
                type="radio"
              />
              {variant.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {selected ? (
        <div className="chat-connection-guidance">
          <p>{selected.guidance.summary}</p>
          {selected.guidance.steps.length ? (
            <ol>
              {selected.guidance.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {safeExternalUrl(selected.guidance.docsUrl) ? (
            <a
              href={safeExternalUrl(selected.guidance.docsUrl)}
              rel="noreferrer"
              target="_blank"
            >
              Official setup documentation
            </a>
          ) : null}
        </div>
      ) : null}
      {setupError ? <ChatError error={setupError} /> : null}
      {connected ? (
        <div className="chat-connection-success" role="status">
          <strong>Connected and safely tested.</strong>
          <button
            className="quiet-button"
            onClick={() => navigate("/integrations/connections")}
            type="button"
          >
            View connection
          </button>
        </div>
      ) : prepared?.credentialKind === "api-key" ? (
        <form
          className="chat-credential-form"
          onSubmit={(event) => void connectWithKey(event)}
        >
          <label>
            {prepared.credentialPlaceholder ?? `${prepared.name} API key`}
            <input
              autoComplete="off"
              disabled={!interactive || busy}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              value={apiKey}
            />
          </label>
          <small>
            Saved to the system keychain and sent directly to the connector,
            never to the chat model.
          </small>
          <button
            className="button primary"
            disabled={!interactive || !apiKey.trim() || busy}
            type="submit"
          >
            {busy ? "Testing…" : "Connect & test"}
          </button>
        </form>
      ) : (
        <button
          className="button primary"
          disabled={!interactive || !selected || busy}
          onClick={() => void begin()}
          type="button"
        >
          {busy
            ? "Preparing…"
            : selected?.credentialKind === "oauth"
              ? selected.label
              : selected?.credentialKind === "api-key"
                ? "Continue securely"
                : "Connect & test"}
        </button>
      )}
    </section>
  );
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

function messageText(message: AssistantMessageDto): string | undefined {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || undefined;
}

function assistantMessageMetadata(
  message: AssistantMessageDto,
  usage: ChatUsageDto | undefined,
): string | undefined {
  if (message.role !== "assistant") return undefined;
  const parts: string[] = [];
  if (message.metadata?.modelId) {
    parts.push(
      message.metadata.provider
        ? `${message.metadata.provider} · ${message.metadata.modelId}`
        : message.metadata.modelId,
    );
  }
  if (usage?.totalTokens) {
    parts.push(`${usage.totalTokens.toLocaleString()} tokens`);
  }
  const actualCost = usage?.actualCostUsdMicros ?? 0;
  const estimatedCost = usage?.estimatedCostUsdMicros ?? 0;
  if (actualCost || estimatedCost) {
    parts.push(
      `${actualCost ? "" : "~"}$${((actualCost || estimatedCost) / 1_000_000).toFixed(4)}`,
    );
  }
  return parts.length ? parts.join(" · ") : undefined;
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

function chatSessionTitle(session: ChatSessionDto): string {
  if (session.title) return session.title;
  switch (session.context?.intent) {
    case "connection.create":
      return "New integration";
    case "connection.manage":
      return "Connection help";
    case "task.create":
      return "New recipe";
    case "task.manage":
      return "Recipe help";
    case "run.diagnose":
      return "Run diagnosis";
    default:
      return "New conversation";
  }
}

function chatContextLabel(
  intent: NonNullable<ChatSessionDto["context"]>["intent"],
): string {
  switch (intent) {
    case "connection.create":
      return "Creating an integration";
    case "connection.manage":
      return "Managing a connection";
    case "task.create":
      return "Creating a recipe";
    case "task.manage":
      return "Managing a recipe";
    case "run.diagnose":
      return "Diagnosing a run";
    default:
      return "Springroll assistant";
  }
}
