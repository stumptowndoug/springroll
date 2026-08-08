import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
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
  AssistantWorkflowDto,
  ChatDetailDto,
  ChatSessionContextDto,
  ChatSessionDto,
  ChatUsageDto,
  ConnectionActionProposalOutcomeDto,
  ConnectionCardDto,
  IntegrationProposalOutcomeDto,
  TaskActionProposalOutcomeDto,
  TaskActionWorkflowResultDto,
  TaskProposalOutcomeDto,
  TaskSummaryDto,
  TaskToolRepairProposalOutcomeDto,
  TaskUpdateProposalOutcomeDto,
  ToolApprovalDto,
} from "../shared.ts";
import { api } from "./api.ts";
import {
  connectionActionProposalOutcomeFromToolPart,
  connectorProposalValidationIssuesFromToolPart,
  describeChatToolPart,
  taskActionProposalOutcomeFromToolPart,
  taskProposalOutcomeFromToolPart,
  taskToolRepairProposalOutcomeFromToolPart,
  taskUpdateProposalOutcomeFromToolPart,
  toolApprovalRiskPresentation,
  visibleConnectionResearchOutcomeFromToolPart,
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
          Sign-in completed. Springroll connected and discovered the live tools.
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
          if (message?.role === "user") {
            return { body: { message } };
          }
          const approvals = message
            ? approvalDecisionsFromMessage(message)
            : [];
          if (approvals.length === 0) {
            throw new Error("A new user message or approval is required");
          }
          return { body: { approvals } };
        },
      }),
    [sessionId],
  );
  const {
    messages,
    addToolApprovalResponse,
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
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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
  const waitingForApproval = latestTurn?.status === "waiting_for_user";
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
    setSyncError(undefined);
    clearError();
    if (text) {
      await sendMessage({ text });
      return;
    }
    const connectionWorkflow = detail.workflows.findLast(
      (workflow) =>
        workflow.kind === "connection_setup" &&
        (workflow.status === "completed" ||
          (workflow.status === "cancelled" &&
            workflow.outcome?.state === "declined")),
    );
    if (!connectionWorkflow) return;
    try {
      await api.continueConnectionWorkflow(sessionId, connectionWorkflow.id);
      await syncFromServer();
    } catch (caught) {
      setSyncError(caught);
    }
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
        {messages.map((message, index) => (
          <ChatMessage
            approvals={detail.approvals.filter(
              (approval) => approval.messageId === message.id,
            )}
            context={detail.session.context}
            interactive={
              !archived &&
              !busy &&
              (!detail.session.activeTurnId || waitingForApproval)
            }
            key={message.id}
            message={message}
            pending={
              index === messages.length - 1 &&
              (busy || Boolean(detail.session.activeTurnId))
            }
            workflows={detail.workflows.filter(
              (workflow) => workflow.sourceMessageId === message.id,
            )}
            onReload={syncFromServer}
            onApproval={(id, approved) =>
              addToolApprovalResponse({
                id,
                approved,
                ...(!approved ? { reason: "Denied by user" } : undefined),
              })
            }
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
  approvals,
  context,
  message,
  interactive,
  onEdit,
  pending,
  usage,
  workflows,
  onApproval,
  onReload,
}: {
  readonly approvals: readonly ToolApprovalDto[];
  readonly message: AssistantMessageDto;
  readonly context: ChatSessionContextDto | null;
  readonly interactive: boolean;
  readonly onEdit?: () => void;
  readonly pending: boolean;
  readonly usage?: ChatUsageDto | undefined;
  readonly workflows: readonly AssistantWorkflowDto[];
  readonly onReload: () => Promise<void>;
  readonly onApproval: (
    id: string,
    approved: boolean,
  ) => void | PromiseLike<void>;
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
            approvals={approvals}
            key={`${message.id}:${chatPartKey(part)}`}
            part={part}
            role={message.role}
            interactive={interactive}
            context={context}
            messageParts={message.parts}
            pending={pending}
            workflows={workflows}
            onReload={onReload}
            onApproval={onApproval}
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
  approvals,
  context,
  part,
  role,
  interactive,
  messageParts,
  workflows,
  pending,
  onApproval,
  onReload,
}: {
  readonly approvals: readonly ToolApprovalDto[];
  readonly part: AssistantMessageDto["parts"][number];
  readonly context: ChatSessionContextDto | null;
  readonly role: AssistantMessageDto["role"];
  readonly interactive: boolean;
  readonly messageParts: AssistantMessageDto["parts"];
  readonly pending: boolean;
  readonly workflows: readonly AssistantWorkflowDto[];
  readonly onReload: () => Promise<void>;
  readonly onApproval: (
    id: string,
    approved: boolean,
  ) => void | PromiseLike<void>;
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
    const proposalValidationIssues =
      connectorProposalValidationIssuesFromToolPart(part);
    const researchOutcome = visibleConnectionResearchOutcomeFromToolPart(
      part,
      messageParts,
      pending,
    );
    const taskOutcome = taskProposalOutcomeFromToolPart(part);
    const taskUpdateOutcome = taskUpdateProposalOutcomeFromToolPart(part);
    const taskRepairOutcome = taskToolRepairProposalOutcomeFromToolPart(part);
    const taskActionOutcome = taskActionProposalOutcomeFromToolPart(part);
    const connectionActionOutcome =
      connectionActionProposalOutcomeFromToolPart(part);
    const workflow =
      "toolCallId" in part && typeof part.toolCallId === "string"
        ? workflows.find(
            (candidate) => candidate.sourceToolCallId === part.toolCallId,
          )
        : undefined;
    const approval = approvalFromToolPart(part);
    const durableApproval = approval
      ? approvals.find((candidate) => candidate.id === approval.id)
      : undefined;
    return (
      <div className="chat-tool-event">
        <div
          className={`chat-tool-state ${state.includes("error") || proposalValidationIssues ? "failed" : ""}`}
        >
          <span aria-hidden="true" />
          {presentation.label} ·{" "}
          {proposalValidationIssues
            ? "needs correction"
            : friendlyToolState(state)}
        </div>
        {presentation.detail ? (
          <small className="chat-tool-detail">{presentation.detail}</small>
        ) : null}
        {proposalValidationIssues?.map((issue) => (
          <small
            className="chat-tool-detail"
            key={`${issue.path}:${issue.message}`}
          >
            {issue.path}: {issue.message}
          </small>
        ))}
        {approval ? (
          <ToolApprovalCard
            approval={approval}
            input={"input" in part ? part.input : undefined}
            interactive={interactive}
            label={presentation.label}
            onDecision={onApproval}
            riskEffect={durableApproval?.riskEffect ?? "destructive"}
          />
        ) : null}
        {researchOutcome ? (
          <ConnectionResearchCard
            context={context}
            interactive={interactive}
            onReload={onReload}
            outcome={researchOutcome}
            {...(workflow ? { workflow } : undefined)}
          />
        ) : null}
        {taskOutcome ? (
          <TaskProposalCard
            context={context}
            interactive={interactive}
            outcome={taskOutcome}
            workflows={workflows}
            {...(workflow ? { workflow } : undefined)}
          />
        ) : null}
        {taskUpdateOutcome ? (
          <TaskUpdateProposalCard
            interactive={interactive}
            outcome={taskUpdateOutcome}
            {...(workflow ? { workflow } : undefined)}
          />
        ) : null}
        {taskRepairOutcome ? (
          <TaskToolRepairProposalCard
            interactive={interactive}
            outcome={taskRepairOutcome}
            {...(workflow ? { workflow } : undefined)}
          />
        ) : null}
        {taskActionOutcome ? (
          <TaskActionProposalCard
            interactive={interactive}
            outcome={taskActionOutcome}
            {...(workflow ? { workflow } : undefined)}
          />
        ) : null}
        {connectionActionOutcome ? (
          <ConnectionActionProposalCard
            interactive={interactive}
            outcome={connectionActionOutcome}
            {...(workflow ? { workflow } : undefined)}
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

function ToolApprovalCard({
  approval,
  input,
  interactive,
  label,
  onDecision,
  riskEffect,
}: {
  readonly approval: {
    readonly id: string;
    readonly approved?: boolean;
    readonly reason?: string;
    readonly state: "requested" | "responded";
  };
  readonly input: unknown;
  readonly interactive: boolean;
  readonly label: string;
  readonly riskEffect: "read" | "write" | "destructive";
  readonly onDecision: (
    id: string,
    approved: boolean,
  ) => void | PromiseLike<void>;
}) {
  const [deciding, setDeciding] = useState(false);
  const details = toolApprovalDetails(input);
  const normalizedRisk = riskEffect === "write" ? "write" : "destructive";
  const risk = toolApprovalRiskPresentation(normalizedRisk);
  const decide = async (approved: boolean) => {
    if (!interactive || deciding || approval.state !== "requested") return;
    setDeciding(true);
    try {
      await onDecision(approval.id, approved);
    } finally {
      setDeciding(false);
    }
  };
  return (
    <section className={`chat-tool-approval ${risk.className}`}>
      <div className="section-label">{risk.eyebrow}</div>
      <strong>{risk.title}</strong>
      <p>{risk.description}</p>
      <span>Action: {label}</span>
      <span>Effect: {normalizedRisk}</span>
      {details.connectionId ? (
        <span>Connection: {details.connectionId}</span>
      ) : null}
      {details.toolName ? <span>Tool: {details.toolName}</span> : null}
      <pre>{details.input}</pre>
      {approval.state === "requested" ? (
        <div className="chat-card-actions">
          <button
            className={`button primary ${normalizedRisk === "destructive" ? "destructive-action" : ""}`}
            disabled={!interactive || deciding}
            onClick={() => void decide(true)}
            type="button"
          >
            {risk.approveLabel}
          </button>
          <button
            className="quiet-button"
            disabled={!interactive || deciding}
            onClick={() => void decide(false)}
            type="button"
          >
            Deny
          </button>
        </div>
      ) : (
        <small>
          {approval.approved ? "Approved" : "Denied"}
          {approval.reason ? ` · ${approval.reason}` : ""}
        </small>
      )}
    </section>
  );
}

function TaskProposalCard({
  context,
  outcome,
  interactive,
  workflow,
  workflows,
}: {
  readonly outcome: TaskProposalOutcomeDto;
  readonly context: ChatSessionContextDto | null;
  readonly interactive: boolean;
  readonly workflow?: AssistantWorkflowDto;
  readonly workflows: readonly AssistantWorkflowDto[];
}) {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<TaskSummaryDto>();
  const [createError, setCreateError] = useState<unknown>();
  const [actionApplying, setActionApplying] = useState<"run_now" | "resume">();
  const [actionError, setActionError] = useState<unknown>();
  const [testRunId, setTestRunId] = useState<string>();
  const durableTaskId =
    workflow?.status === "completed" && workflow.subjectKind === "task"
      ? (workflow.subjectId ?? undefined)
      : context?.intent === "task.manage"
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
          <Link className="quiet-button" to="/connections/new">
            Set up an integration
          </Link>
        ) : null}
      </section>
    );
  }

  const { proposal } = outcome;
  const approvalTools = proposal.tools.filter(
    (tool) => tool.approval === "before_call",
  );
  const canStart = approvalTools.length === 0;
  const durableTestRunId = workflow
    ? workflows.find(
        (candidate) =>
          candidate.kind === "task_action" &&
          candidate.sourceToolCallId ===
            `${workflow.sourceToolCallId}:follow-up:run_now` &&
          candidate.status === "completed" &&
          candidate.subjectKind === "run",
      )?.subjectId
    : undefined;
  const completedTestRunId = testRunId ?? durableTestRunId ?? undefined;
  const create = async () => {
    if (!interactive || creating || created) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const task = workflow
        ? await api.acceptTaskWorkflow(
            sessionId ?? workflow.sessionId,
            workflow.id,
          )
        : await api.createTask(proposal, false);
      setCreated(task);
      if (sessionId && !workflow) {
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
  const applyCreatedAction = async (action: "run_now" | "resume") => {
    if (!workflow || !interactive || actionApplying) return;
    setActionApplying(action);
    setActionError(undefined);
    try {
      const result = await api.acceptCreatedTaskActionWorkflow(
        sessionId ?? workflow.sessionId,
        workflow.id,
        action,
      );
      if (result.action === "run_now") {
        setTestRunId(result.run.id);
      } else {
        setCreated(result.task);
      }
    } catch (caught) {
      setActionError(caught);
    } finally {
      setActionApplying(undefined);
    }
  };

  return (
    <section className="chat-connection-result chat-task-proposal ready">
      <div className="section-label">Recipe proposal</div>
      <h3>{proposal.title}</h3>
      <p>{proposal.prompt}</p>
      <div className="chat-task-facts">
        <span>{proposal.scheduleLabel}</span>
        <span>{proposal.schedule}</span>
        <span>{proposal.timezone}</span>
        <span>{proposal.connectionName}</span>
        <span>Runs on this Mac</span>
        {proposal.maxToolCallsPerRun ? (
          <span>Up to {proposal.maxToolCallsPerRun} tool calls/run</span>
        ) : null}
        <span>
          {proposal.catchUpPolicy === "catch_up"
            ? "Runs once after downtime"
            : "Skips missed runs"}
        </span>
        {proposal.modelExecution ? (
          <>
            <span>
              {proposal.modelExecution.providerId} ·{" "}
              {proposal.modelExecution.modelId}
            </span>
            <span>
              {proposal.modelExecution.selectedBy === "automatic"
                ? "Model selected automatically"
                : proposal.modelExecution.selectedBy === "default"
                  ? "Default model"
                  : "Recipe model override"}
            </span>
            {proposal.modelExecution.toolRoutes.map((route) => (
              <span key={`${route.capability}:${route.service}`}>
                {route.capability} via {route.service}
              </span>
            ))}
          </>
        ) : null}
      </div>
      <ul className="connector-tool-list" aria-label="Proposed recipe tools">
        {proposal.tools.map((item) => (
          <li key={item.name}>
            <i aria-hidden="true" className={`risk-dot risk-${item.effect}`} />
            {item.name} · {item.effect} ·{" "}
            {item.approval === "never" ? "automatic" : "approval required"}
            {item.maxCallsPerRun ? ` · up to ${item.maxCallsPerRun}/run` : ""}
          </li>
        ))}
      </ul>
      <div className="chat-task-contract">
        <strong>Autonomy</strong>
        <p>
          {canStart
            ? "All selected tools are read-only. After you enable the schedule, Springroll may call them automatically during each run."
            : `This draft includes ${approvalTools.map((tool) => tool.name).join(", ")}, which requires interactive approval. Springroll will save it paused but cannot run or enable it until approval continuation is available.`}
        </p>
      </div>
      <div className="chat-task-contract">
        <strong>What it may do</strong>
        <p>{proposal.contract}</p>
      </div>
      {proposal.modelExecution ? (
        <p className="chat-task-update-note">
          Runs use the configured {proposal.modelExecution.providerId} model and
          may incur model, web-search, or connector usage charges.
        </p>
      ) : null}
      {createError || actionError ? (
        <ChatError error={createError ?? actionError} />
      ) : null}
      {created ? (
        <div
          className="chat-connection-success chat-recipe-created"
          role="status"
        >
          <div>
            <strong>
              {created.enabled
                ? "Recipe created and scheduled."
                : "Recipe created and paused."}
            </strong>
            <small>
              {created.enabled
                ? "Future runs will follow the reviewed schedule."
                : "It stays paused unless you explicitly start a test run or enable its schedule."}
            </small>
          </div>
          <div className="chat-recipe-follow-ups">
            {canStart ? (
              <>
                <button
                  className="quiet-button"
                  disabled={
                    !interactive ||
                    !workflow ||
                    Boolean(actionApplying) ||
                    Boolean(completedTestRunId)
                  }
                  onClick={() => void applyCreatedAction("run_now")}
                  type="button"
                >
                  {actionApplying === "run_now"
                    ? "Starting…"
                    : completedTestRunId
                      ? "Test run started"
                      : "Run once"}
                </button>
                {!created.enabled ? (
                  <button
                    className="quiet-button"
                    disabled={
                      !interactive || !workflow || Boolean(actionApplying)
                    }
                    onClick={() => void applyCreatedAction("resume")}
                    type="button"
                  >
                    {actionApplying === "resume"
                      ? "Enabling…"
                      : "Enable schedule"}
                  </button>
                ) : null}
              </>
            ) : (
              <small>
                Approval continuation is required before it can run.
              </small>
            )}
            <button
              className="quiet-button"
              onClick={() => navigate(`/recipes/${created.id}`)}
              type="button"
            >
              {created.enabled ? "Review recipe" : "Keep paused & review"}
            </button>
            {completedTestRunId ? (
              <button
                className="quiet-button"
                onClick={() => navigate(`/inbox/${completedTestRunId}`)}
                type="button"
              >
                View test run
              </button>
            ) : null}
          </div>
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

function TaskUpdateProposalCard({
  outcome,
  interactive,
  workflow,
}: {
  readonly outcome: TaskUpdateProposalOutcomeDto;
  readonly interactive: boolean;
  readonly workflow?: AssistantWorkflowDto;
}) {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const [applying, setApplying] = useState(false);
  const [updated, setUpdated] = useState<TaskSummaryDto>();
  const [applyError, setApplyError] = useState<unknown>();
  const durableTaskId =
    workflow?.status === "completed" && workflow.subjectKind === "task"
      ? (workflow.subjectId ?? undefined)
      : undefined;

  useEffect(() => {
    if (!durableTaskId || updated?.id === durableTaskId) return;
    void api
      .task(durableTaskId)
      .then(setUpdated)
      .catch(() => undefined);
  }, [durableTaskId, updated?.id]);

  if (outcome.status !== "ready") {
    return (
      <section className="chat-connection-result chat-task-proposal unavailable">
        <div className="section-label">Recipe update</div>
        <strong>{outcome.title}</strong>
        <p>{outcome.explanation}</p>
      </section>
    );
  }

  const { proposal } = outcome;
  const apply = async () => {
    if (!interactive || applying || updated) return;
    setApplying(true);
    setApplyError(undefined);
    try {
      const task = workflow
        ? await api.acceptTaskUpdateWorkflow(
            sessionId ?? workflow.sessionId,
            workflow.id,
          )
        : await api.updateTask(proposal.taskId, {
            name: proposal.after.name,
            prompt: proposal.after.prompt,
            schedule: proposal.after.schedule,
            timezone: proposal.after.timezone,
            catchUpPolicy: proposal.after.catchUpPolicy,
          });
      setUpdated(task);
    } catch (caught) {
      setApplyError(caught);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="chat-connection-result chat-task-proposal ready">
      <div className="section-label">Recipe update</div>
      <h3>{proposal.after.name}</h3>
      <div className="chat-task-update-changes">
        {proposal.changes.map((change) => (
          <div key={change.field}>
            <strong>{change.label}</strong>
            <p className="task-update-before">{change.before}</p>
            <p className="task-update-after">{change.after}</p>
          </div>
        ))}
      </div>
      <p className="chat-task-update-note">
        Connections and tools stay unchanged. Future runs use the updated recipe
        after you accept.
      </p>
      {applyError || workflow?.error ? (
        <ChatError error={applyError ?? workflow?.error} />
      ) : null}
      {updated ? (
        <div className="chat-connection-success" role="status">
          <strong>Recipe updated.</strong>
          <button
            className="quiet-button"
            onClick={() => navigate(`/recipes/${updated.id}`)}
            type="button"
          >
            Review recipe
          </button>
        </div>
      ) : (
        <button
          className="button primary"
          disabled={!interactive || applying}
          onClick={() => void apply()}
          type="button"
        >
          {applying
            ? "Updating…"
            : interactive
              ? "Apply recipe update"
              : "Restore chat to update"}
        </button>
      )}
    </section>
  );
}

function TaskToolRepairProposalCard({
  outcome,
  interactive,
  workflow,
}: {
  readonly outcome: TaskToolRepairProposalOutcomeDto;
  readonly interactive: boolean;
  readonly workflow?: AssistantWorkflowDto;
}) {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const [applying, setApplying] = useState(false);
  const [repaired, setRepaired] = useState<TaskSummaryDto>();
  const [applyError, setApplyError] = useState<unknown>();
  const durableTaskId =
    workflow?.status === "completed" && workflow.subjectKind === "task"
      ? (workflow.subjectId ?? undefined)
      : undefined;

  useEffect(() => {
    if (!durableTaskId || repaired?.id === durableTaskId) return;
    void api
      .task(durableTaskId)
      .then(setRepaired)
      .catch(() => undefined);
  }, [durableTaskId, repaired?.id]);

  if (outcome.status !== "ready") {
    return (
      <section className="chat-connection-result chat-task-proposal unavailable">
        <div className="section-label">Recipe tool repair</div>
        <strong>{outcome.title}</strong>
        <p>{outcome.explanation}</p>
      </section>
    );
  }

  const { proposal } = outcome;
  const apply = async () => {
    if (!interactive || applying || repaired) return;
    setApplying(true);
    setApplyError(undefined);
    try {
      const task = workflow
        ? await api.acceptTaskRepairWorkflow(
            sessionId ?? workflow.sessionId,
            workflow.id,
          )
        : await api.repairTaskTools(proposal.taskId, proposal);
      setRepaired(task);
    } catch (caught) {
      setApplyError(caught);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="chat-connection-result chat-task-proposal ready">
      <div className="section-label">Recipe tool repair</div>
      <h3>{proposal.taskName}</h3>
      <div className="chat-task-repair-changes">
        {proposal.changes.map((change) => (
          <div key={`${change.connectionId}:${change.toolName}`}>
            <strong>
              {change.connectionName} · {change.toolName}
            </strong>
            <p>{change.description}</p>
            <dl>
              <div>
                <dt>Schema</dt>
                <dd>
                  {shortHash(change.previousInputSchemaHash)} →{" "}
                  {shortHash(change.proposedInputSchemaHash)}
                </dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>
                  {riskLabel(change.previousRisk)} →{" "}
                  {riskLabel(change.proposedRisk)}
                </dd>
              </div>
            </dl>
            <details>
              <summary>Review live input schema</summary>
              <pre>{JSON.stringify(change.inputSchema, null, 2)}</pre>
            </details>
          </div>
        ))}
      </div>
      <p className="chat-task-update-note">
        Springroll revalidates the live contract when applying. The recipe text
        and connection stay unchanged.
      </p>
      {applyError || workflow?.error ? (
        <ChatError error={applyError ?? workflow?.error} />
      ) : null}
      {repaired ? (
        <div className="chat-connection-success" role="status">
          <strong>Recipe tools repaired.</strong>
          <button
            className="quiet-button"
            onClick={() => navigate(`/recipes/${repaired.id}`)}
            type="button"
          >
            Review recipe
          </button>
        </div>
      ) : (
        <button
          className="button primary"
          disabled={!interactive || applying}
          onClick={() => void apply()}
          type="button"
        >
          {applying
            ? "Repairing…"
            : interactive
              ? "Accept tool repair"
              : "Restore chat to repair"}
        </button>
      )}
    </section>
  );
}

function TaskActionProposalCard({
  outcome,
  interactive,
  workflow,
}: {
  readonly outcome: TaskActionProposalOutcomeDto;
  readonly interactive: boolean;
  readonly workflow?: AssistantWorkflowDto;
}) {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<TaskActionWorkflowResultDto>();
  const [applyError, setApplyError] = useState<unknown>();

  useEffect(() => {
    if (
      outcome.status !== "ready" ||
      workflow?.status !== "completed" ||
      !workflow.subjectId ||
      result
    ) {
      return;
    }
    if (
      outcome.proposal.action === "run_now" &&
      workflow.subjectKind === "run"
    ) {
      setResult({ action: "run_now", run: { id: workflow.subjectId } });
      return;
    }
    if (workflow.subjectKind === "task") {
      void api
        .task(workflow.subjectId)
        .then((task) =>
          setResult({
            action: outcome.proposal.action as "pause" | "resume",
            task,
          }),
        )
        .catch(() => undefined);
    }
  }, [outcome, result, workflow]);

  if (outcome.status !== "ready") {
    return (
      <section className="chat-connection-result chat-task-proposal unavailable">
        <div className="section-label">Recipe action</div>
        <strong>{outcome.title}</strong>
        <p>{outcome.explanation}</p>
      </section>
    );
  }

  const { proposal } = outcome;
  const actionLabel =
    proposal.action === "run_now"
      ? "Run now"
      : proposal.action === "pause"
        ? "Pause recipe"
        : "Resume recipe";
  const apply = async () => {
    if (!workflow || !interactive || applying || result) return;
    setApplying(true);
    setApplyError(undefined);
    try {
      setResult(
        await api.acceptTaskActionWorkflow(
          sessionId ?? workflow.sessionId,
          workflow.id,
        ),
      );
    } catch (caught) {
      setApplyError(caught);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="chat-connection-result chat-task-proposal ready">
      <div className="section-label">Recipe action</div>
      <h3>{proposal.taskName}</h3>
      <div className="chat-task-facts">
        <span>{actionLabel}</span>
        <span>
          {proposal.enabled ? "Currently active" : "Currently paused"}
        </span>
        <span>{proposal.schedule}</span>
        <span>{proposal.timezone}</span>
        <span>Next {formatRelativeDate(proposal.nextRunAt)}</span>
        {proposal.connectionNames.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <ul className="connector-tool-list" aria-label="Recipe tools">
        {proposal.tools.map((tool) => (
          <li key={`${tool.connectionName}:${tool.name}`}>
            <i aria-hidden="true" className={`risk-dot risk-${tool.effect}`} />
            {tool.connectionName} · {tool.name} · {tool.effect} ·{" "}
            {tool.approval === "never" ? "automatic" : "approval required"}
          </li>
        ))}
      </ul>
      <p className="chat-task-update-note">
        {proposal.action === "run_now"
          ? "This starts the recipe immediately and may spend model or connector credits. Its regular schedule is unchanged."
          : proposal.action === "pause"
            ? "This stops future scheduled runs. The recipe and its history stay intact."
            : "This enables future scheduled runs using the recipe's existing schedule."}
      </p>
      {applyError || workflow?.error ? (
        <ChatError error={applyError ?? workflow?.error} />
      ) : null}
      {result ? (
        <div className="chat-connection-success" role="status">
          <strong>
            {result.action === "run_now"
              ? "Recipe started."
              : result.action === "pause"
                ? "Recipe paused."
                : "Recipe resumed."}
          </strong>
          <button
            className="quiet-button"
            onClick={() =>
              navigate(
                result.action === "run_now"
                  ? `/inbox/${result.run.id}`
                  : `/recipes/${result.task.id}`,
              )
            }
            type="button"
          >
            {result.action === "run_now" ? "View run" : "Review recipe"}
          </button>
        </div>
      ) : (
        <button
          className="button primary"
          disabled={!interactive || applying || !workflow}
          onClick={() => void apply()}
          type="button"
        >
          {applying
            ? "Applying…"
            : !workflow
              ? "Action unavailable"
              : interactive
                ? actionLabel
                : "Restore chat to continue"}
        </button>
      )}
    </section>
  );
}

function ConnectionActionProposalCard({
  outcome,
  interactive,
  workflow,
}: {
  readonly outcome: ConnectionActionProposalOutcomeDto;
  readonly interactive: boolean;
  readonly workflow?: AssistantWorkflowDto;
}) {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const [apiKey, setApiKey] = useState("");
  const [applying, setApplying] = useState(false);
  const [completed, setCompleted] = useState(workflow?.status === "completed");
  const [applyError, setApplyError] = useState<unknown>();

  useEffect(() => {
    if (workflow?.status === "completed") setCompleted(true);
  }, [workflow?.status]);

  if (outcome.status !== "ready") {
    return (
      <section className="chat-connection-result chat-task-proposal unavailable">
        <div className="section-label">Connection action</div>
        <strong>{outcome.title}</strong>
        <p>{outcome.explanation}</p>
      </section>
    );
  }

  const { proposal } = outcome;
  const actionLabel =
    proposal.action === "reconnect"
      ? proposal.credentialKind === "oauth"
        ? `Sign in to ${proposal.connectionName}`
        : `Reconnect ${proposal.connectionName}`
      : proposal.action === "disconnect"
        ? proposal.credentialKind === "oauth"
          ? `Sign out of ${proposal.connectionName}`
          : `Disconnect ${proposal.connectionName}`
        : `Remove ${proposal.connectionName}`;
  const explanation =
    proposal.action === "reconnect"
      ? proposal.credentialKind === "oauth"
        ? "Springroll will open the provider's sign-in page, then return here. It does not ask the model for your credential."
        : proposal.credentialKind === "api-key"
          ? "Enter the API key below. It goes directly to the host credential store and connector test, never through chat or the model."
          : "Springroll will enable the installed connector and test its read-only probe."
      : proposal.action === "disconnect"
        ? proposal.credentialKind === "oauth"
          ? "Springroll will delete its OAuth credential from this Mac and disable these tools, while keeping the connector available for a later sign-in. This does not revoke the provider-side grant."
          : proposal.credentialKind === "api-key"
            ? "Springroll will delete the API key from Keychain and disable these tools, while keeping the connector available to reconnect later."
            : "Springroll will disable these tools while keeping the connector available to enable later."
        : "This permanently removes the installed connector configuration and its saved credential. Recipes must stop using it before removal can succeed.";

  const apply = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!workflow || !interactive || applying || completed) return;
    setApplying(true);
    setApplyError(undefined);
    try {
      const result = await api.acceptConnectionActionWorkflow(
        sessionId ?? workflow.sessionId,
        workflow.id,
        proposal.action === "reconnect" && proposal.credentialKind === "api-key"
          ? apiKey
          : undefined,
      );
      if (result.status === "redirect") {
        window.location.assign(result.authorizationUrl);
        return;
      }
      if (result.status !== "awaiting_api_key") {
        setApiKey("");
        setCompleted(true);
      }
    } catch (caught) {
      setApplyError(caught);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="chat-connection-result chat-task-proposal ready">
      <div className="section-label">
        {proposal.action === "remove"
          ? "Destructive connection action"
          : "Connection action"}
      </div>
      <h3>{proposal.connectionName}</h3>
      <div className="chat-task-facts">
        <span>{actionLabel}</span>
        <span>{proposal.toolCount} tools</span>
        <span>
          {proposal.credentialKind === "oauth"
            ? "OAuth"
            : proposal.credentialKind === "api-key"
              ? "API key · Keychain"
              : "No credential"}
        </span>
      </div>
      <p className="chat-task-update-note">{explanation}</p>
      {applyError || workflow?.error ? (
        <ChatError error={applyError ?? workflow?.error} />
      ) : null}
      {completed ? (
        <div className="chat-connection-success" role="status">
          <strong>
            {proposal.action === "reconnect"
              ? "Connection restored."
              : proposal.action === "disconnect"
                ? "Connection disconnected; connector kept."
                : "Connector removed."}
          </strong>
          {proposal.action !== "remove" ? (
            <button
              className="quiet-button"
              onClick={() =>
                navigate(
                  `/connections/${encodeURIComponent(proposal.connectionId)}`,
                )
              }
              type="button"
            >
              View connection
            </button>
          ) : null}
        </div>
      ) : proposal.action === "reconnect" &&
        proposal.credentialKind === "api-key" ? (
        <form className="chat-credential-form" onSubmit={apply}>
          <label>
            {proposal.connectionName} API key
            <input
              autoComplete="off"
              disabled={!interactive || applying}
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
            disabled={!interactive || !workflow || applying || !apiKey.trim()}
            type="submit"
          >
            {applying ? "Testing…" : "Save & reconnect"}
          </button>
        </form>
      ) : (
        <button
          className={`button primary ${proposal.action === "remove" ? "destructive-action" : ""}`}
          disabled={!interactive || applying || !workflow}
          onClick={() => void apply()}
          type="button"
        >
          {applying
            ? "Applying…"
            : !workflow
              ? "Action unavailable"
              : interactive
                ? actionLabel
                : "Restore chat to continue"}
        </button>
      )}
    </section>
  );
}

function shortHash(value: string): string {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

function riskLabel(risk: {
  readonly effect: "read" | "write" | "destructive";
  readonly openWorld: boolean;
  readonly idempotent: boolean;
}): string {
  return [
    risk.effect,
    risk.openWorld ? "external" : "local",
    risk.idempotent ? "idempotent" : "non-idempotent",
  ].join(" · ");
}

function safeUrlHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "API host";
  }
}

function ConnectionResearchCard({
  context,
  outcome,
  interactive,
  onReload,
  workflow,
}: {
  readonly outcome: IntegrationProposalOutcomeDto;
  readonly context: ChatSessionContextDto | null;
  readonly interactive: boolean;
  readonly onReload: () => Promise<void>;
  readonly workflow?: AssistantWorkflowDto;
}) {
  if (outcome.status === "candidate") {
    const registryHref = safeExternalUrl(outcome.candidate.registryUrl);
    const repositoryHref = safeExternalUrl(outcome.candidate.repositoryUrl);
    const logoHref = outcome.candidate.logo
      ? safeHttpsExternalUrl(outcome.candidate.logo.url)
      : undefined;
    return (
      <section className="chat-connection-result">
        <div className="section-label">GitHub MCP Registry candidate</div>
        <div className="chat-connection-candidate-heading">
          {logoHref ? (
            <img
              alt=""
              className="chat-connection-candidate-logo"
              referrerPolicy="no-referrer"
              src={logoHref}
            />
          ) : null}
          <strong>{outcome.title}</strong>
        </div>
        <p>{outcome.explanation}</p>
        <div className="chat-task-facts">
          <span>{outcome.candidate.packageName}</span>
          <span>
            {outcome.candidate.credentialRequired
              ? "Credential required"
              : "No credential declared"}
          </span>
        </div>
        <nav className="chat-connection-sources" aria-label="Candidate sources">
          {registryHref ? (
            <a href={registryHref} rel="noreferrer" target="_blank">
              GitHub registry entry
            </a>
          ) : null}
          {repositoryHref ? (
            <a href={repositoryHref} rel="noreferrer" target="_blank">
              Official repository candidate
            </a>
          ) : null}
        </nav>
        <p className="chat-connection-guidance">
          Springroll is verifying this package before offering setup.
        </p>
      </section>
    );
  }
  if (outcome.status !== "ready") {
    return (
      <section className="chat-connection-result unavailable">
        <div className="section-label">More information needed</div>
        <strong>{outcome.title}</strong>
        <p>{outcome.explanation}</p>
        <p>
          If you have official documentation or setup instructions, send the URL
          in this chat and Springroll will continue researching it.
        </p>
        <Link className="quiet-button" to="/connections/manual">
          I already have an MCP server URL
        </Link>
      </section>
    );
  }
  return (
    <ReadyConnectionProposal
      context={context}
      interactive={interactive}
      onReload={onReload}
      outcome={outcome}
      {...(workflow ? { workflow } : undefined)}
    />
  );
}

function ReadyConnectionProposal({
  context,
  outcome,
  interactive,
  onReload,
  workflow,
}: {
  readonly outcome: Extract<
    IntegrationProposalOutcomeDto,
    { readonly status: "ready" }
  >;
  readonly interactive: boolean;
  readonly onReload: () => Promise<void>;
  readonly context: ChatSessionContextDto | null;
  readonly workflow?: AssistantWorkflowDto;
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
  const localLaunchCommand = proposal.packageName
    ? [
        "npx",
        "--yes",
        `${proposal.packageName}@${proposal.packageVersion ?? "verified version"}`,
        ...(proposal.packageArgs ?? []),
      ].join(" ")
    : undefined;
  const durablePrepared = preparedConnectionWorkflow(workflow);
  const declined =
    workflow?.status === "cancelled" && workflow.outcome?.state === "declined";
  const durableConnectionId =
    workflow?.subjectKind === "connection"
      ? (workflow.subjectId ?? undefined)
      : undefined;

  const markConnected = useCallback(
    async (connectorId: string, updateContext = true) => {
      setConnected(true);
      if (sessionId && updateContext) {
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
      durableConnectionId ??
      searchParams.get("connector") ??
      (context?.intent === "connection.manage"
        ? context.subjects.find((subject) => subject.kind === "connection")?.id
        : undefined);
    if (!connectorId) return;
    void api
      .connections()
      .then((connections) => {
        const connection = connections.find(
          (candidate) => candidate.id === connectorId,
        );
        if (!connection || (!workflow && connection.name !== proposal.name)) {
          return;
        }
        if (
          durablePrepared?.credentialKind === "api-key" &&
          workflow?.status === "waiting_for_user"
        ) {
          setPrepared(connection);
        }
        if (connection.status === "connected") {
          if (interactive) {
            void markConnected(connectorId, !workflow).catch(setSetupError);
          } else {
            setConnected(true);
          }
        }
      })
      .catch(() => undefined);
  }, [
    context,
    durableConnectionId,
    durablePrepared?.credentialKind,
    interactive,
    markConnected,
    proposal.name,
    searchParams,
    workflow,
  ]);

  const begin = async () => {
    if (!interactive || !selected || busy) return;
    setBusy(true);
    setSetupError(undefined);
    try {
      if (workflow) {
        const result = await api.prepareConnectionWorkflow(
          sessionId ?? workflow.sessionId,
          workflow.id,
          selected.id,
        );
        if (result.status === "declined") {
          await onReload();
          return;
        }
        setPrepared(result.connection);
        if (result.status === "redirect") {
          window.location.assign(result.authorizationUrl);
          return;
        }
        if (result.status === "connected") {
          await markConnected(result.connection.id, false);
          await onReload();
        }
        return;
      }
      const connection = await api.prepareIntegrationVariant(
        proposal.templateId,
        selected.id,
      );
      setPrepared(connection);
      if (connection.credentialKind === "oauth") {
        const returnTo = sessionId
          ? `/chat/${encodeURIComponent(sessionId)}?connector=${encodeURIComponent(connection.id)}`
          : undefined;
        const result = await api.startConnectorOAuth(connection.id, returnTo);
        if (result.status === "redirect") {
          window.location.assign(result.authorizationUrl);
          return;
        }
        await markConnected(connection.id);
      } else if (connection.credentialKind === "none") {
        await api.connectConnector(connection.id);
        await markConnected(connection.id);
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
      let connection: ConnectionCardDto;
      if (workflow) {
        const result = await api.connectConnectionWorkflow(
          sessionId ?? workflow.sessionId,
          workflow.id,
          apiKey,
        );
        if (result.status !== "connected") {
          throw new Error("Connection setup did not finish");
        }
        connection = result.connection;
      } else {
        connection = await api.connectConnector(prepared.id, apiKey);
      }
      setApiKey("");
      await markConnected(connection.id, !workflow);
      if (workflow) await onReload();
    } catch (caught) {
      setSetupError(caught);
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!interactive || !workflow || busy) return;
    setBusy(true);
    setSetupError(undefined);
    try {
      await api.declineConnectionWorkflow(
        sessionId ?? workflow.sessionId,
        workflow.id,
      );
      setApiKey("");
      await onReload();
    } catch (caught) {
      setSetupError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (declined) {
    return (
      <section className="chat-connection-result unavailable">
        <div className="section-label">Setup declined</div>
        <strong>{proposal.name} was not connected</strong>
        <p>
          Declining did not send a credential. You can ask Springroll to revisit
          this connection whenever you need it.
        </p>
      </section>
    );
  }

  return (
    <section className="chat-connection-result ready">
      <div className="section-label">
        {proposal.trust === "registry-verified"
          ? "Registry verified"
          : proposal.trust === "package-verified"
            ? "Package metadata verified"
            : proposal.trust === "openapi-verified"
              ? "Official OpenAPI verified"
              : "Springroll curated"}
      </div>
      <h3>{proposal.name}</h3>
      <p>{proposal.description}</p>
      <div className="chat-connection-host">
        {localLaunchCommand
          ? `${localLaunchCommand} · runs locally · operator ${proposal.operator}`
          : `Hosted by ${proposal.operator}`}
      </div>
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
      {proposal.api ? (
        <div className="chat-api-review">
          <div className="chat-task-facts">
            <span>API</span>
            <span>{proposal.api.operationCount} operations</span>
            <span>{safeUrlHostname(proposal.api.baseUrl)}</span>
          </div>
          {proposal.tools?.length ? (
            <details>
              <summary>Review discovered API operations</summary>
              <ul className="chat-api-operation-list">
                {proposal.tools.map((tool) => (
                  <li key={tool.name}>
                    <i
                      className={`risk-dot risk-${tool.effect}`}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{tool.name}</strong>
                      {tool.description ? (
                        <small>{tool.description}</small>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {proposal.api.verification ? (
            <div className="chat-api-verification">
              <strong>Connection test</strong>
              <span>{proposal.api.verification.note}</span>
              <code>{proposal.api.verification.tool}</code>
            </div>
          ) : (
            <p className="chat-task-update-note">
              Springroll can verify the document and discover operations now;
              the credential will be exercised by the first real API call.
            </p>
          )}
          {proposal.api.notes?.length ? (
            <ul className="chat-api-notes">
              {proposal.api.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
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
      {!connected && (setupError || workflow?.error) ? (
        <ChatError error={setupError ?? workflow?.error} />
      ) : null}
      {connected ? (
        <div className="chat-connection-success" role="status">
          <strong>
            {proposal.api?.verification
              ? "Connected; credential tested and live operations discovered."
              : proposal.api
                ? "Connected; operations available. The credential will be tested on the first API call."
                : "Connected; live tools discovered."}
          </strong>
          <button
            className="quiet-button"
            onClick={() => navigate("/connections")}
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
            {busy
              ? proposal.api?.verification
                ? "Testing…"
                : "Connecting…"
              : proposal.api?.verification
                ? "Connect & test"
                : "Save & connect"}
          </button>
          {workflow ? (
            <button
              className="quiet-button"
              disabled={!interactive || busy}
              onClick={() => void decline()}
              type="button"
            >
              Not now
            </button>
          ) : null}
        </form>
      ) : (
        <div className="chat-card-actions">
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
          {workflow ? (
            <button
              className="quiet-button"
              disabled={!interactive || busy}
              onClick={() => void decline()}
              type="button"
            >
              Not now
            </button>
          ) : null}
        </div>
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
  if (state === "approval-requested") return "waiting for approval";
  if (state === "approval-responded") return "approval recorded";
  return "working";
}

function approvalFromToolPart(part: AssistantMessageDto["parts"][number]):
  | {
      readonly id: string;
      readonly approved?: boolean;
      readonly reason?: string;
      readonly state: "requested" | "responded";
    }
  | undefined {
  if (
    !("state" in part) ||
    (part.state !== "approval-requested" &&
      part.state !== "approval-responded") ||
    !("approval" in part) ||
    !isUnknownRecord(part.approval) ||
    typeof part.approval.id !== "string"
  ) {
    return undefined;
  }
  return {
    id: part.approval.id,
    state: part.state === "approval-requested" ? "requested" : "responded",
    ...(typeof part.approval.approved === "boolean"
      ? { approved: part.approval.approved }
      : undefined),
    ...(typeof part.approval.reason === "string"
      ? { reason: part.approval.reason }
      : undefined),
  };
}

function approvalDecisionsFromMessage(message: AssistantMessageDto) {
  return message.parts.flatMap((part) => {
    const approval = approvalFromToolPart(part);
    return approval?.state === "responded" &&
      typeof approval.approved === "boolean"
      ? [
          {
            id: approval.id,
            approved: approval.approved,
            ...(approval.reason ? { reason: approval.reason } : undefined),
          },
        ]
      : [];
  });
}

function toolApprovalDetails(input: unknown): {
  readonly connectionId?: string;
  readonly toolName?: string;
  readonly input: string;
} {
  const record = isUnknownRecord(input) ? input : undefined;
  const connectorInput = record?.input;
  const encoded = JSON.stringify(connectorInput ?? input ?? {}, null, 2);
  return {
    ...(typeof record?.connectionId === "string"
      ? { connectionId: record.connectionId }
      : undefined),
    ...(typeof record?.toolName === "string"
      ? { toolName: record.toolName }
      : undefined),
    input:
      encoded.length <= 4_000
        ? encoded
        : `${encoded.slice(0, 4_000)}\n… [truncated]`,
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function safeHttpsExternalUrl(value: string): string | undefined {
  const url = safeExternalUrl(value);
  return url?.startsWith("https://") ? url : undefined;
}

function preparedConnectionWorkflow(workflow: AssistantWorkflowDto | undefined):
  | {
      readonly connectorId: string;
      readonly credentialKind: "oauth" | "api-key" | "none";
    }
  | undefined {
  const outcome = workflow?.outcome;
  if (
    outcome?.phase !== "prepared" ||
    typeof outcome.connectorId !== "string" ||
    (outcome.credentialKind !== "oauth" &&
      outcome.credentialKind !== "api-key" &&
      outcome.credentialKind !== "none")
  ) {
    return undefined;
  }
  return {
    connectorId: outcome.connectorId,
    credentialKind: outcome.credentialKind,
  };
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
