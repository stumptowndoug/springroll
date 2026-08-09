import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  ChatSessionEntryDto,
  ConnectionCardDto,
  ConnectionDetailDto,
  IntegrationProposalOutcomeDto,
  ModelExecutionDto,
  ModelOptionDto,
  ModelProviderDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelSettingsDto,
  RunDetailDto,
  RunEventDto,
  RunSummaryDto,
  TaskProposalDto,
  TaskProposalOutcomeDto,
  TaskRecipeKnowledgeDto,
  TaskSummaryDto,
  ToolApprovalDto,
} from "../shared.ts";
import { api } from "./api.ts";
import { ChatDetailPage, ChatIndexPage } from "./chat-page.tsx";
import {
  type ConnectionStatusFilter,
  connectionCatalogTags,
  filterIntegrationCatalog,
  visibleIntegrationCatalog,
} from "./connection-catalog.ts";
import {
  DegradedConnectionsNotice,
  taskProposalDegradedConnectionPolicy,
} from "./degraded-connections.tsx";
import { PlayIcon, PlusIcon, SlidersIcon } from "./icons.tsx";
import { RunMarkdown } from "./run-markdown.tsx";
import {
  builtInThemes,
  readTextSizePreference,
  readThemePreference,
  saveTextSizePreference,
  saveThemePreference,
  type TextSize,
  type ThemeDefinition,
  type ThemeId,
  textSizes,
} from "./themes.ts";

function BrandLogo() {
  return (
    <svg
      className="brand-logo"
      role="presentation"
      viewBox="0 0 512 512"
      width="26"
      height="26"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M228.725 444.385C219.919 440.492 211.121 436.627 202.316 432.734C206.341 419.518 207.006 404.424 210.859 390.986C216.804 370.27 226.175 351.944 232.558 331.853C217.995 284.098 179.202 245.608 142.696 224.726C131.621 218.378 117.653 208.584 106.26 210.947C131.124 224.712 156.447 240.603 177.912 262.636C184.497 269.409 192.275 276.08 196.037 285.18C155.005 294.132 112.758 283.306 78.1806 245.467C65.3048 231.372 54.5344 214.042 42.9879 198.332C33.4232 185.299 19.6923 172.962 12.3907 158.456C67.812 138.743 137.904 166.047 181.829 222.649C197.742 243.137 211.923 265.994 226.37 288.014C231.985 296.545 235.782 307.291 242.446 313.837C248.49 303.968 255.618 293.67 260.289 282.59C264.026 273.762 265.027 262.452 267.845 252.917C273.388 234.107 281.365 215.552 290.398 199.383C324.589 138.223 376.057 100.861 437.08 88.7369C457.423 84.7049 479.49 80.6692 500.772 85.051C498.615 91.9034 494.477 97.3195 491.358 103.565C484.725 116.925 478.544 130.612 472.572 144.481C451.306 193.929 434.513 249.279 394.166 279.061C377.24 291.574 358.505 298.793 338.737 303.799C322.215 308.023 299.989 314.02 282.594 307.065C300.728 257.247 344.756 213.717 380.477 184.189C359.186 186.517 339.018 209.325 323.384 224.871C288.243 259.832 263.659 308.368 244.993 359.506C235.771 384.795 228.035 415.017 228.725 444.385Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.512"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SpringrollApp() {
  return (
    <div className="app-frame">
      <header className="titlebar">
        <Link className="brand" to="/chat" aria-label="Springroll home">
          <BrandLogo />
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/chat">Chat</NavLink>
          <NavLink to="/inbox">Inbox</NavLink>
          <NavLink to="/recipes">Recipes</NavLink>
          <NavLink to="/models">Models</NavLink>
          <NavLink to="/connections">Connections</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatIndexPage />} />
          <Route path="/chat/:id" element={<ChatDetailPage />} />
          <Route path="/inbox" element={<RunsPage />} />
          <Route path="/inbox/:id" element={<RunDetailPage />} />
          <Route path="/recipes" element={<TasksPage />} />
          <Route
            path="/recipes/new"
            element={<NewRecipeConversationEntryPage />}
          />
          <Route path="/recipes/new/manual" element={<NewTaskPage />} />
          <Route path="/recipes/:id" element={<TaskDetailPage />} />
          {/* Legacy paths keep old links working */}
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route
            path="/tasks/new"
            element={<NewRecipeConversationEntryPage />}
          />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route
            path="/integrations"
            element={<Navigate to="/connections" replace />}
          />
          <Route
            path="/integrations/models"
            element={<Navigate to="/models" replace />}
          />
          <Route
            path="/integrations/web-search"
            element={<Navigate to="/connections?tag=search" replace />}
          />
          <Route
            path="/integrations/connections"
            element={<Navigate to="/connections" replace />}
          />
          <Route
            path="/integrations/connections/new"
            element={<Navigate to="/connections/new" replace />}
          />
          <Route
            path="/integrations/connections/manual"
            element={<Navigate to="/connections/manual" replace />}
          />
          <Route
            path="/integrations/mcps"
            element={<Navigate to="/connections" replace />}
          />
          <Route
            path="/integrations/custom"
            element={<Navigate to="/connections" replace />}
          />
          <Route path="/models" element={<ModelIntegrationsPage />} />
          <Route
            path="/connections"
            element={<ConnectionsIntegrationsPage />}
          />
          <Route
            path="/connections/new"
            element={<NewIntegrationConversationEntryPage />}
          />
          <Route path="/connections/manual" element={<NewIntegrationPage />} />
          <Route path="/connections/:id" element={<ConnectionDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function RunsPage() {
  const runs = useLoad(api.runs);
  const tasks = useLoad(api.tasks);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "sent" | "needs_you" | "failed"
  >("all");
  const [tagFilter, setTagFilter] = useState<string>();

  const tagByTask = new Map(
    tasks.value?.map((task) => [task.id, task.tag] as const),
  );
  const tags = [
    ...new Set(
      runs.value?.flatMap((run) => {
        const tag = tagByTask.get(run.taskId);
        return tag ? [tag] : [];
      }),
    ),
  ].sort();
  const filterOn =
    query.trim() !== "" || statusFilter !== "all" || tagFilter !== undefined;
  const search = query.trim().toLowerCase();
  const visibleRuns = runs.value?.filter((run) => {
    if (
      statusFilter === "sent" &&
      (run.status !== "succeeded" || run.needsAttention)
    ) {
      return false;
    }
    if (
      statusFilter === "needs_you" &&
      (!run.needsAttention || run.status === "failed")
    ) {
      return false;
    }
    if (statusFilter === "failed" && run.status !== "failed") {
      return false;
    }
    if (tagFilter !== undefined && tagByTask.get(run.taskId) !== tagFilter) {
      return false;
    }
    return (
      search === "" ||
      run.taskName.toLowerCase().includes(search) ||
      (run.summary ?? "").toLowerCase().includes(search) ||
      (run.error ?? "").toLowerCase().includes(search)
    );
  });
  const feed = visibleRuns ? buildRunFeed(visibleRuns) : [];

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setTagFilter(undefined);
  };

  return (
    <Page>
      <PageHeading
        title="Inbox."
        action={
          <div className="heading-actions">
            <FilterControl
              label="Filter inbox"
              on={filterOn}
              open={filterOpen}
              setOpen={setFilterOpen}
            >
              <input
                aria-label="Search inbox"
                className="filter-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search inbox"
                type="search"
                value={query}
              />
              <div className="filter-section-label">Status</div>
              <div className="filter-chips">
                {(["all", "sent", "needs_you", "failed"] as const).map(
                  (status) => (
                    <button
                      className={`filter-chip ${
                        statusFilter === status ? "on" : ""
                      }`}
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      type="button"
                    >
                      {status === "all"
                        ? "All"
                        : status === "sent"
                          ? "Sent"
                          : status === "needs_you"
                            ? "Needs you"
                            : "Failed"}
                    </button>
                  ),
                )}
              </div>
              <div className="filter-section-label">Tags</div>
              {tags.length > 0 ? (
                <div className="filter-chips">
                  {tags.map((tag) => (
                    <button
                      className={`filter-chip ${tagFilter === tag ? "on" : ""}`}
                      key={tag}
                      onClick={() =>
                        setTagFilter(tagFilter === tag ? undefined : tag)
                      }
                      type="button"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="filter-empty-note">
                  No tags yet — set one on a recipe page.
                </p>
              )}
              {filterOn ? (
                <button
                  className="text-action filter-clear"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </FilterControl>
            <Link className="button primary" to="/recipes/new">
              <PlusIcon />
              New recipe
            </Link>
          </div>
        }
      />
      {filterOn && visibleRuns?.length === 0 && runs.value?.length ? (
        <EmptyState
          title="No matches"
          body="No runs match the current filters."
          action={
            <button
              className="text-action"
              onClick={clearFilters}
              type="button"
            >
              Clear filters
            </button>
          }
        />
      ) : null}
      {runs.loading ? <LoadingLine /> : null}
      {runs.error ? (
        <ErrorNotice error={runs.error} retry={runs.reload} />
      ) : null}
      {!runs.loading && runs.value?.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Create a recipe, try it once, and its note will land here."
          action={
            <Link className="text-action" to="/recipes/new">
              Create your first recipe
            </Link>
          }
        />
      ) : null}
      <div className="run-feed">
        {feed.map((day) => (
          <section className="run-day" key={day.key}>
            <div className="day-heading">{day.label}</div>
            <div className="run-group">
              {day.items.map((item) =>
                item.kind === "aggregate" ? (
                  <div className="run-row aggregate" key={item.key}>
                    <time />
                    <span className="run-dot" aria-hidden="true" />
                    <span className="run-title">{item.summary}</span>
                    <small>
                      {item.taskName} · {item.count}×
                    </small>
                  </div>
                ) : (
                  <Link
                    className="run-row"
                    id={`run-${item.run.id}`}
                    to={`/inbox/${item.run.id}`}
                    key={item.run.id}
                  >
                    <time>{formatTime(item.run.scheduledTime)}</time>
                    <span
                      className={`run-dot ${runDotClass(item.run)}`}
                      aria-hidden="true"
                    />
                    <span className="run-title">{runRowTitle(item.run)}</span>
                    {runRowSub(item.run) ? (
                      <small
                        className={
                          item.run.status === "failed" && item.run.error
                            ? "bad"
                            : ""
                        }
                      >
                        {runRowSub(item.run)}
                      </small>
                    ) : null}
                    <i aria-hidden="true">›</i>
                  </Link>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}

function RunDetailPage() {
  const { id = "" } = useParams();
  const run = useLoad(useCallback(() => api.run(id), [id]));
  const navigate = useNavigate();
  const [events, setEvents] = useState<readonly RunEventDto[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setEvents([]);
    return api.subscribeToRunEvents(id, {
      onEvent(event) {
        setEvents((current) => {
          if (current.some((item) => item.id === event.id)) {
            return current;
          }
          return [...current, event].sort(
            (left, right) => left.sequence - right.sequence,
          );
        });
      },
      onComplete() {
        void run.reload();
      },
    });
  }, [id, run.reload]);

  const deleteRun = async () => {
    if (
      !window.confirm(
        "Delete this run and its activity history? This cannot be undone.",
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteRun(id);
      navigate("/inbox", { replace: true });
    } catch (error) {
      run.setError(error);
      setDeleting(false);
    }
  };

  const decideApprovals = async (approved: boolean) => {
    const required = new Set(run.value?.requiredApprovalIds ?? []);
    const approvals = run.value?.approvals.filter(({ id }) => required.has(id));
    if (!approvals?.length || deciding) return;
    setDeciding(true);
    run.setError(undefined);
    try {
      await api.decideRunApprovals(
        id,
        approvals.map((approval) => ({
          id: approval.id,
          approved:
            approval.status === "approved"
              ? true
              : approval.status === "denied"
                ? false
                : approved,
          ...(approval.reason
            ? { reason: approval.reason }
            : !approved
              ? { reason: "Denied by user" }
              : undefined),
        })),
      );
      await run.reload();
    } catch (error) {
      run.setError(error);
    } finally {
      setDeciding(false);
    }
  };

  const retryRun = async () => {
    if (!run.value || retrying) return;
    setRetrying(true);
    run.setError(undefined);
    try {
      const retried = await api.runTask(run.value.taskId);
      navigate(`/inbox/${retried.id}`);
    } catch (error) {
      run.setError(error);
      setRetrying(false);
    }
  };

  return (
    <Page>
      <BackLink to="/inbox">Inbox</BackLink>
      {run.loading ? <LoadingLine /> : null}
      {run.error ? <ErrorNotice error={run.error} retry={run.reload} /> : null}
      {run.value ? (
        <>
          <RunLetter
            deciding={deciding}
            events={events}
            onDecision={decideApprovals}
            run={run.value}
          />
          <div className="record-actions">
            {run.value.canRetry ? (
              <button
                className="quiet-button"
                disabled={retrying}
                onClick={() => void retryRun()}
                type="button"
              >
                {retrying ? "Starting…" : "Run again"}
              </button>
            ) : null}
            <ChatContextButton
              entry={{
                context: {
                  version: 1,
                  intent: "run.diagnose",
                  origin: "runs",
                  subjects: [{ kind: "run", id: run.value.id }],
                  suggestedPrompt: `Help me understand the run for “${run.value.taskName}”. Inspect the real run details and explain the outcome, any failure, and the next useful action.`,
                },
              }}
            />
            {run.value.status === "succeeded" ||
            run.value.status === "failed" ? (
              <button
                className="text-action danger-action"
                disabled={deleting}
                onClick={deleteRun}
                type="button"
              >
                {deleting ? "Deleting…" : "Delete this run"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </Page>
  );
}

function RunLetter({
  run,
  events,
  deciding,
  onDecision,
}: {
  readonly run: RunDetailDto;
  readonly events: readonly RunEventDto[];
  readonly deciding: boolean;
  readonly onDecision: (approved: boolean) => void | Promise<void>;
}) {
  const active = run.status === "claimed" || run.status === "running";
  const body =
    run.result?.body.content ??
    run.body ??
    run.error ??
    (run.status === "waiting_for_approval"
      ? "This run is paused before a consequential connector call. Review the exact input above to continue."
      : active
        ? "The finished note will appear here when the agent is done."
        : "This run did not produce a note.");
  const totalTokens =
    run.totalTokens ??
    (run.inputTokens !== undefined || run.outputTokens !== undefined
      ? (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
      : undefined);
  const primaryMechanics = [
    run.modelProvider || run.modelId
      ? [run.modelProvider, run.modelId].filter(Boolean).join(" · ")
      : undefined,
    totalTokens === undefined
      ? undefined
      : `${totalTokens.toLocaleString()} tokens`,
    runCostLabel(run),
  ].filter((item): item is string => Boolean(item));
  const detailMechanics = [
    run.inputTokens === undefined
      ? undefined
      : `${run.inputTokens.toLocaleString()} input`,
    run.outputTokens === undefined
      ? undefined
      : `${run.outputTokens.toLocaleString()} output`,
    !run.cachedInputTokens
      ? undefined
      : `${run.cachedInputTokens.toLocaleString()} cached`,
    !run.reasoningTokens
      ? undefined
      : `${run.reasoningTokens.toLocaleString()} reasoning`,
    `${run.toolCalls} tool ${run.toolCalls === 1 ? "call" : "calls"}`,
    !run.webSearchRequests
      ? undefined
      : `${run.webSearchRequests} web ${
          run.webSearchRequests === 1 ? "search" : "searches"
        }`,
    run.durationMs === undefined ? undefined : formatDuration(run.durationMs),
  ].filter((item): item is string => Boolean(item));

  return (
    <article className="letter">
      <div className="letter-date">{formatFullDate(run.scheduledTime)}</div>
      <h1 className="display-title">{run.taskName}</h1>
      <p className="letter-subtitle">
        <span>
          {run.executionLocation === "local"
            ? "Ran on this Mac"
            : "Ran while this Mac was away"}
        </span>
        <span className={`status ${runStatusClass(run.status)}`}>
          {humanStatus(run.status)}
        </span>
      </p>
      {active ? <RunActivity active={active} events={events} /> : null}
      {run.status === "waiting_for_approval" ? (
        <RunApprovalPanel
          approvals={run.approvals.filter(({ id }) =>
            run.requiredApprovalIds.includes(id),
          )}
          deciding={deciding}
          onDecision={onDecision}
        />
      ) : null}
      <div className="letter-body">
        <RunMarkdown content={body} />
      </div>
      {!active ? <RunActivity active={active} events={events} /> : null}
      <footer className="mechanics">
        {primaryMechanics.length > 0 ? (
          <div>{primaryMechanics.join(" · ")}</div>
        ) : null}
        <small>{detailMechanics.join(" · ")}</small>
      </footer>
    </article>
  );
}

function RunApprovalPanel({
  approvals,
  deciding,
  onDecision,
}: {
  readonly approvals: readonly ToolApprovalDto[];
  readonly deciding: boolean;
  readonly onDecision: (approved: boolean) => void | Promise<void>;
}) {
  const required = approvals.filter(
    ({ status }) =>
      status === "pending" || status === "approved" || status === "denied",
  );
  const alreadyDecided = required.every(({ status }) => status !== "pending");

  return (
    <section className="chat-tool-approval run-tool-approval">
      <div className="section-label">Approval required</div>
      <strong>
        {required.length === 1
          ? "Review this exact connector call"
          : `Review ${required.length} exact connector calls`}
      </strong>
      <p>
        Springroll paused before making these changes. Credentials are injected
        by the host and are never part of these inputs.
      </p>
      {required.map((approval) => (
        <div className="run-approval-call" key={approval.id}>
          <span>
            {approval.toolName} · {approval.riskEffect}
          </span>
          <pre>{JSON.stringify(approval.input, null, 2)}</pre>
        </div>
      ))}
      <div className="chat-card-actions">
        <button
          className="button primary"
          disabled={deciding || required.length === 0}
          onClick={() => void onDecision(true)}
          type="button"
        >
          {deciding
            ? "Continuing…"
            : alreadyDecided
              ? "Continue run"
              : "Approve and run"}
        </button>
        {!alreadyDecided ? (
          <button
            className="quiet-button"
            disabled={deciding || required.length === 0}
            onClick={() => void onDecision(false)}
            type="button"
          >
            Deny
          </button>
        ) : null}
      </div>
    </section>
  );
}

function RunActivity({
  events,
  active,
}: {
  readonly events: readonly RunEventDto[];
  readonly active: boolean;
}) {
  if (events.length === 0 && !active) {
    return null;
  }
  const visibleEvents = active ? events.slice(-16) : events;
  const list = (
    <ol>
      {visibleEvents.map((event) => (
        <li className={event.tone ?? "neutral"} key={event.id}>
          <span className={`activity-dot ${event.kind}`} aria-hidden="true" />
          <span>
            {event.sourceUrl ? (
              <a href={event.sourceUrl} rel="noreferrer" target="_blank">
                {event.title}
              </a>
            ) : (
              <strong>{event.title}</strong>
            )}
            {event.detail ? <small>{event.detail}</small> : null}
          </span>
          <time>{formatTime(event.occurredAt)}</time>
        </li>
      ))}
      {active ? (
        <li className="active">
          <span className="activity-dot pulse" aria-hidden="true" />
          <span>
            <strong>Working…</strong>
          </span>
        </li>
      ) : null}
    </ol>
  );

  if (!active) {
    return (
      <details className="run-activity quiet" aria-label="Run activity">
        <summary>
          Activity · {events.length} {events.length === 1 ? "step" : "steps"}
        </summary>
        {list}
      </details>
    );
  }

  return (
    <section className="run-activity" aria-label="Run activity">
      <div className="run-activity-heading">
        <span>Activity</span>
        <i className="status status-running">Live</i>
      </div>
      {list}
    </section>
  );
}

function TasksPage() {
  const tasks = useLoad(api.tasks);
  const models = useLoad(api.models);
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string>();
  const [menuTaskId, setMenuTaskId] = useState<string>();
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">(
    "all",
  );
  const [tagFilter, setTagFilter] = useState<string>();
  const [view, setView] = useState<"standard" | "tag">("standard");

  const tags = [
    ...new Set(tasks.value?.flatMap((task) => (task.tag ? [task.tag] : []))),
  ].sort();
  const filterOn =
    query.trim() !== "" || statusFilter !== "all" || tagFilter !== undefined;
  const search = query.trim().toLowerCase();
  const visibleTasks = tasks.value?.filter((task) => {
    if (statusFilter === "active" && !task.enabled) {
      return false;
    }
    if (statusFilter === "paused" && task.enabled) {
      return false;
    }
    if (tagFilter !== undefined && task.tag !== tagFilter) {
      return false;
    }
    return (
      search === "" ||
      task.name.toLowerCase().includes(search) ||
      task.prompt.toLowerCase().includes(search)
    );
  });

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setTagFilter(undefined);
  };

  const groups = new Map<string, TaskSummaryDto[]>();
  if (view === "tag") {
    for (const task of visibleTasks ?? []) {
      const label = task.tag ?? "untagged";
      groups.set(label, [...(groups.get(label) ?? []), task]);
    }
  }
  const tagGroups = [...groups.entries()].sort(([a], [b]) =>
    a === "untagged" ? 1 : b === "untagged" ? -1 : a.localeCompare(b),
  );

  const recipeCard = (task: TaskSummaryDto) => (
    <article
      className={`recipe-card ${task.enabled ? "" : "paused"}`}
      key={task.id}
    >
      <div className="recipe-card-head">
        <Link className="recipe-title" to={`/recipes/${task.id}`}>
          {task.name}
        </Link>
        {task.recentRunStatuses.length > 0 ? (
          <span
            className="run-trail"
            role="img"
            aria-label="Recent run outcomes"
          >
            {task.recentRunStatuses.map((status, index) => (
              <i
                className={trailDotClass(status)}
                // biome-ignore lint/suspicious/noArrayIndexKey: order-only list
                key={index}
              />
            ))}
          </span>
        ) : null}
      </div>
      <div className="recipe-section">
        <div className="section-label">Ingredients</div>
        <p className="recipe-ingredients">
          {[
            ...task.connectionNames,
            modelIngredient(task.modelOverride, models.value),
          ].join(" · ")}
          <small> · {describeSchedule(task.schedule)}</small>
        </p>
      </div>
      <div className="recipe-section">
        <div className="section-label">Instructions</div>
        <p className="recipe-instructions">{task.prompt}</p>
      </div>
      <div className="recipe-card-foot">
        <div className="row-actions">
          <button
            className="quiet-button"
            disabled={busyId === task.id}
            onClick={() => runNow(task)}
            type="button"
          >
            <PlayIcon size={12} />
            Run now
          </button>
          {task.enabled ? (
            <button
              className="quiet-button muted-action"
              disabled={busyId === task.id}
              onClick={() => toggleTask(task)}
              type="button"
            >
              Pause
            </button>
          ) : (
            <span className="enable-menu-wrap">
              <button
                className="quiet-button muted-action"
                disabled={busyId === task.id}
                onClick={() =>
                  setMenuTaskId(menuTaskId === task.id ? undefined : task.id)
                }
                type="button"
              >
                Enable ▾
              </button>
              {menuTaskId === task.id ? (
                <>
                  <button
                    aria-label="Close menu"
                    className="enable-backdrop"
                    onClick={() => setMenuTaskId(undefined)}
                    type="button"
                  />
                  <span className="enable-menu">
                    <button
                      onClick={() => {
                        setMenuTaskId(undefined);
                        void toggleTask(task);
                      }}
                      type="button"
                    >
                      <span>
                        <b>On this Mac</b>
                        <small>Runs while this Mac is awake</small>
                      </span>
                    </button>
                    <span className="enable-menu-item disabled">
                      <span>
                        <b>Anywhere</b>
                        <small>Cloud covers when your Mac sleeps</small>
                      </span>
                      <i className="soon-chip">soon</i>
                    </span>
                  </span>
                </>
              ) : null}
            </span>
          )}
        </div>
        <span className="recipe-next">
          {task.enabled
            ? `next ${formatNextRun(task.nextRunAt)} · this Mac`
            : "paused"}
        </span>
      </div>
    </article>
  );

  const toggleTask = async (task: TaskSummaryDto) => {
    setBusyId(task.id);
    try {
      await api.updateTask(task.id, { enabled: !task.enabled });
      await tasks.reload();
    } finally {
      setBusyId(undefined);
    }
  };

  const runNow = async (task: TaskSummaryDto) => {
    setBusyId(task.id);
    try {
      const run = await api.runTask(task.id);
      navigate(`/inbox/${run.id}`);
    } catch (error) {
      tasks.setError(error);
      setBusyId(undefined);
    }
  };

  return (
    <Page>
      <PageHeading
        title="Recipes."
        action={
          <div className="heading-actions">
            <FilterControl
              label="Filter recipes"
              on={filterOn}
              open={filterOpen}
              setOpen={setFilterOpen}
            >
              <input
                aria-label="Search recipes"
                className="filter-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search recipes"
                type="search"
                value={query}
              />
              <div className="filter-section-label">Status</div>
              <div className="filter-chips">
                {(["all", "active", "paused"] as const).map((status) => (
                  <button
                    className={`filter-chip ${
                      statusFilter === status ? "on" : ""
                    }`}
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    type="button"
                  >
                    {status === "all"
                      ? "All"
                      : status === "active"
                        ? "Active"
                        : "Paused"}
                  </button>
                ))}
              </div>
              <div className="filter-section-label">Tags</div>
              {tags.length > 0 ? (
                <div className="filter-chips">
                  {tags.map((tag) => (
                    <button
                      className={`filter-chip ${tagFilter === tag ? "on" : ""}`}
                      key={tag}
                      onClick={() =>
                        setTagFilter(tagFilter === tag ? undefined : tag)
                      }
                      type="button"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="filter-empty-note">
                  No tags yet — set one on a recipe page.
                </p>
              )}
              <div className="filter-section-label">View</div>
              <div className="filter-chips">
                {(["standard", "tag"] as const).map((option) => (
                  <button
                    className={`filter-chip ${view === option ? "on" : ""}`}
                    key={option}
                    onClick={() => setView(option)}
                    type="button"
                  >
                    {option === "standard" ? "Standard" : "Tag"}
                  </button>
                ))}
                <button className="filter-chip disabled" disabled type="button">
                  Calendar<i className="soon-chip">soon</i>
                </button>
              </div>
              {filterOn ? (
                <button
                  className="text-action filter-clear"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </FilterControl>
            <Link className="button primary" to="/recipes/new">
              <PlusIcon />
              New recipe
            </Link>
          </div>
        }
      />
      {tasks.loading ? <LoadingLine /> : null}
      {tasks.error ? (
        <ErrorNotice error={tasks.error} retry={tasks.reload} />
      ) : null}
      {!tasks.loading && tasks.value?.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          body="Describe one useful thing and Springroll will turn it into a recipe."
          action={
            <Link className="text-action" to="/recipes/new">
              Describe a recipe
            </Link>
          }
        />
      ) : null}
      {filterOn && visibleTasks?.length === 0 && tasks.value?.length ? (
        <EmptyState
          title="No matches"
          body="No recipes match the current filters."
          action={
            <button
              className="text-action"
              onClick={clearFilters}
              type="button"
            >
              Clear filters
            </button>
          }
        />
      ) : null}
      {view === "tag" ? (
        <div className="recipe-groups">
          {tagGroups.map(([label, group]) => (
            <section className="recipe-group" key={label}>
              <div className="day-heading">{label}</div>
              <div className="recipe-grid">{group.map(recipeCard)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="recipe-grid">{visibleTasks?.map(recipeCard)}</div>
      )}
    </Page>
  );
}

function TaskDetailPage() {
  const { id = "" } = useParams();
  const task = useLoad(useCallback(() => api.task(id), [id]));
  const execution = useLoad(useCallback(() => api.taskExecution(id), [id]));
  const recipeKnowledge = useLoad(
    useCallback(() => api.taskRecipeKnowledge(id), [id]),
  );
  const models = useLoad(api.models);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const update = async (input: Parameters<typeof api.updateTask>[1]) => {
    setBusy(true);
    try {
      await api.updateTask(id, input);
      await Promise.all([task.reload(), execution.reload()]);
    } catch (error) {
      task.setError(error);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const run = await api.runTask(id);
      navigate(`/inbox/${run.id}`);
    } catch (error) {
      task.setError(error);
      setBusy(false);
    }
  };

  const approveRecipeKnowledge = async (revision: number) => {
    setBusy(true);
    try {
      await api.approveTaskRecipeKnowledge(id, revision);
      await recipeKnowledge.reload();
    } catch (error) {
      recipeKnowledge.setError(error);
    } finally {
      setBusy(false);
    }
  };

  const deleteTask = async () => {
    if (
      !window.confirm(
        `Delete “${task.value?.name ?? "this task"}” and all of its run history? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.deleteTask(id);
      navigate("/recipes", { replace: true });
    } catch (error) {
      task.setError(error);
      setBusy(false);
    }
  };

  return (
    <Page>
      <BackLink to="/recipes">Recipes</BackLink>
      {task.loading ? <LoadingLine /> : null}
      {task.error ? (
        <ErrorNotice error={task.error} retry={task.reload} />
      ) : null}
      {task.value ? (
        <article className="task-detail">
          <div className="task-detail-heading">
            <div
              className={`status ${
                task.value.enabled ? "status-good" : "status-quiet"
              }`}
            >
              {task.value.enabled ? "Scheduled" : "Paused"}
            </div>
            <h1 className="display-title">{task.value.name}</h1>
          </div>
          <blockquote>{task.value.prompt}</blockquote>
          <dl className="detail-grid">
            <div className="detail-wide">
              <dt>Capability contract</dt>
              <dd>{task.value.contract || "Contract not yet re-reviewed."}</dd>
            </div>
          </dl>
          <div className="detail-actions">
            <button
              className="quiet-button"
              disabled={busy || execution.loading || Boolean(execution.error)}
              onClick={runNow}
              type="button"
            >
              <PlayIcon size={12} />
              Run now
            </button>
            <ChatContextButton
              entry={{
                context: {
                  version: 1,
                  intent: "task.manage",
                  origin: "recipes",
                  subjects: [{ kind: "task", id: task.value.id }],
                  suggestedPrompt: `Help me with “${task.value.name}”. Inspect its real configuration and recent runs before recommending what to do next.`,
                },
              }}
            />
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Schedule</dt>
              <dd>
                {describeSchedule(task.value.schedule)}
                <small>{task.value.timezone}</small>
              </dd>
            </div>
            <div>
              <dt>Next run</dt>
              <dd>{formatFullDate(task.value.nextRunAt)}</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>{task.value.connectionNames.join(", ")}</dd>
            </div>
            <div>
              <dt>Tag</dt>
              <dd>
                <input
                  aria-label="Recipe tag"
                  className="tag-input"
                  defaultValue={task.value.tag ?? ""}
                  disabled={busy}
                  key={task.value.tag ?? ""}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next !== (task.value?.tag ?? "")) {
                      void update({ tag: next || null });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="e.g. news"
                />
                <small>One tag, used to filter the Recipes page.</small>
              </dd>
            </div>
            <div className="detail-wide">
              <dt>Model</dt>
              <dd>
                <ModelPicker
                  disabled={busy || models.loading}
                  inheritLabel={defaultModelLabel(models.value)}
                  models={models.value?.models ?? []}
                  onChange={(selection) =>
                    update({ modelSelection: selection })
                  }
                  value={task.value.modelOverride}
                />
                {execution.loading ? <LoadingLine /> : null}
                {execution.error ? (
                  <small className="execution-error">
                    {errorMessage(execution.error)}
                  </small>
                ) : null}
                {execution.value && !execution.error ? (
                  <ModelExecutionLine
                    configuration={models.value}
                    execution={execution.value}
                  />
                ) : null}
              </dd>
            </div>
            <div>
              <dt>When this Mac wakes late</dt>
              <dd>
                <select
                  aria-label="Catch-up policy"
                  disabled={busy}
                  onChange={(event) =>
                    update({
                      catchUpPolicy: event.target.value as
                        | "catch_up"
                        | "skip_to_next",
                    })
                  }
                  value={task.value.catchUpPolicy}
                >
                  <option value="skip_to_next">Skip to the next time</option>
                  <option value="catch_up">Run once when it wakes</option>
                </select>
              </dd>
            </div>
          </dl>
          <RecipeKnowledge
            busy={busy}
            error={recipeKnowledge.error}
            loading={recipeKnowledge.loading}
            onApprove={approveRecipeKnowledge}
            value={recipeKnowledge.value}
          />
          <section className="where-runs" aria-labelledby="where-heading">
            <div className="section-label" id="where-heading">
              Where it runs
            </div>
            <div role="radiogroup" aria-label="Where this recipe runs">
              <label className="where-option">
                <input
                  checked={!task.value.enabled}
                  disabled={busy}
                  name="where-it-runs"
                  onChange={() => update({ enabled: false })}
                  type="radio"
                />
                <span>
                  <b>Paused</b>
                  <p>Keeps the recipe and its history; nothing runs.</p>
                </span>
              </label>
              <label className="where-option">
                <input
                  checked={task.value.enabled}
                  disabled={busy}
                  name="where-it-runs"
                  onChange={() => update({ enabled: true })}
                  type="radio"
                />
                <span>
                  <b>On this Mac</b>
                  <p>
                    Runs on schedule while this Mac is awake. Skipped runs
                    follow your catch-up policy.
                  </p>
                </span>
              </label>
              <label className="where-option disabled">
                <input disabled name="where-it-runs" type="radio" />
                <span>
                  <b>Anywhere</b>
                  <p>
                    Your Mac runs it first; Springroll Cloud covers when it is
                    asleep. Requires sharing this recipe's connections and model
                    key with your cloud space.
                  </p>
                </span>
                <i className="soon-chip">Requires Cloud · soon</i>
              </label>
            </div>
          </section>
          <div className="record-actions">
            <button
              className="text-action danger-action"
              disabled={busy}
              onClick={deleteTask}
              type="button"
            >
              Delete this recipe
            </button>
          </div>
        </article>
      ) : null}
    </Page>
  );
}

function RecipeKnowledge({
  busy,
  error,
  loading,
  onApprove,
  value,
}: {
  readonly busy: boolean;
  readonly error?: unknown;
  readonly loading: boolean;
  readonly onApprove: (revision: number) => Promise<void>;
  readonly value: TaskRecipeKnowledgeDto | null | undefined;
}) {
  return (
    <section className="learned-setup" aria-labelledby="learned-setup-heading">
      <div className="learned-setup-head">
        <div>
          <div className="section-label" id="learned-setup-heading">
            Recipe knowledge
          </div>
          <p>
            Durable context Springroll learned for this recipe. It guides future
            runs but never grants permission to use a tool.
          </p>
        </div>
        {value ? (
          <span className={`learned-setup-status status-${value.status}`}>
            {recipeKnowledgeStatus(value.status)}
          </span>
        ) : null}
      </div>
      {loading ? <LoadingLine /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      {!loading && !error && !value ? (
        <div className="learned-setup-empty">
          No recipe notes have been saved yet. When useful, you can keep concise
          sources, definitions, and caveats here for future runs.
        </div>
      ) : null}
      {value ? (
        <div className="learned-setup-body">
          <div className="learned-setup-provenance">
            Revision {value.revision}
            {value.sourceRunId ? (
              <>
                {" · learned from "}
                <Link to={`/inbox/${value.sourceRunId}`}>this run</Link>
              </>
            ) : null}
          </div>
          <div className="learned-setup-document">
            <RunMarkdown content={value.knowledge.markdown} />
          </div>
          {value.staleReason ? (
            <p className="learned-setup-warning">{value.staleReason}</p>
          ) : null}
          {value.status === "needs_review" ? (
            <div className="learned-setup-review">
              <p>
                Review the durable notes above. Approval lets later runs use
                them as context; it does not grant unattended access or change
                any tool policy.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void onApprove(value.revision)}
                type="button"
              >
                Approve recipe knowledge
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function recipeKnowledgeStatus(
  status: TaskRecipeKnowledgeDto["status"],
): string {
  switch (status) {
    case "learning":
      return "Learning";
    case "needs_review":
      return "Needs review";
    case "ready":
      return "Approved";
    case "stale":
      return "Needs repair";
    case "superseded":
      return "Superseded";
  }
}

function NewRecipeConversationEntryPage() {
  return (
    <ConversationEntryPage
      backTo="/recipes"
      entry={{
        mode: "new",
        context: {
          version: 1,
          intent: "task.create",
          origin: "recipes",
          subjects: [],
          suggestedPrompt: "I want to create a recipe that ",
        },
      }}
    />
  );
}

function NewTaskPage() {
  const navigate = useNavigate();
  const models = useLoad(api.models);
  const [sentence, setSentence] = useState("");
  const [outcome, setOutcome] = useState<TaskProposalOutcomeDto>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<"propose" | "run" | "schedule">();
  const proposal = outcome?.status === "ready" ? outcome.proposal : undefined;

  const updateProposal = (updated: TaskProposalDto) => {
    setOutcome({
      status: "ready",
      proposal: updated,
      ...(outcome?.degradedConnections
        ? { degradedConnections: outcome.degradedConnections }
        : undefined),
    });
  };

  const propose = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("propose");
    setError(undefined);
    try {
      setOutcome(
        await api.proposeTask(
          sentence,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  const confirm = async (mode: "run" | "schedule") => {
    if (!proposal) {
      return;
    }
    setBusy(mode);
    setError(undefined);
    try {
      const task = await api.createTask(proposal, mode === "schedule");
      if (mode === "run") {
        const run = await api.runTask(task.id);
        navigate(`/inbox/${run.id}`);
      } else {
        navigate(`/recipes/${task.id}`);
      }
    } catch (caught) {
      setError(caught);
      setBusy(undefined);
    }
  };

  return (
    <Page narrow>
      <BackLink to="/recipes">Recipes</BackLink>
      <PageHeading eyebrow="New recipe" title="What would you like handled?" />
      <form className="composer" onSubmit={propose}>
        <textarea
          aria-label="Describe the task"
          maxLength={2_000}
          onChange={(event) => {
            setSentence(event.target.value);
            setOutcome(undefined);
          }}
          placeholder="Summarize Hacker News every morning"
          rows={4}
          value={sentence}
        />
        <div className="composer-foot">
          <span>Use your own words. You’ll review everything next.</span>
          <button
            className="button primary"
            disabled={busy !== undefined || sentence.trim().length < 3}
            type="submit"
          >
            {busy === "propose" ? "Thinking…" : "Review task"}
          </button>
        </div>
      </form>
      {error ? (
        <ErrorNotice
          error={error}
          action={
            <Link className="text-action" to="/models">
              Check Models
            </Link>
          }
        />
      ) : null}
      {outcome?.status === "ready" ? (
        <DegradedConnectionsNotice
          connections={outcome.degradedConnections ?? []}
        />
      ) : null}
      {outcome && outcome.status !== "ready" ? (
        <UnavailableProposal outcome={outcome} />
      ) : null}
      {proposal ? (
        <section className="proposal">
          <div className="proposal-chips">
            <span>{proposal.scheduleLabel}</span>
            <span>{proposal.connectionName}</span>
            {proposal.tools.map((tool) => (
              <span key={tool.name}>
                {tool.name.replaceAll("_", " ")} · {tool.effect}
              </span>
            ))}
          </div>
          <h2>{proposal.title}</h2>
          <blockquote>“{proposal.contract}”</blockquote>
          <p className="proposal-mode">
            This task runs on this Mac. Springroll will ask again before any
            connection or capability changes.
          </p>
          {proposal.modelExecution ? (
            <ModelExecutionPreview
              configuration={models.value}
              execution={proposal.modelExecution}
            />
          ) : null}
          <details>
            <summary>Edit details</summary>
            <label>
              Schedule
              <input
                onChange={(event) =>
                  updateProposal({
                    ...proposal,
                    schedule: event.target.value,
                  })
                }
                value={proposal.schedule}
              />
            </label>
            <label>
              Timezone
              <input
                onChange={(event) =>
                  updateProposal({
                    ...proposal,
                    timezone: event.target.value,
                  })
                }
                value={proposal.timezone}
              />
            </label>
            <label>
              Instructions
              <textarea
                onChange={(event) =>
                  updateProposal({ ...proposal, prompt: event.target.value })
                }
                rows={5}
                value={proposal.prompt}
              />
            </label>
          </details>
          <div className="proposal-actions">
            <button
              className="button primary"
              disabled={busy !== undefined}
              onClick={() => confirm("run")}
              type="button"
            >
              {busy === "run" ? "Running…" : "Run it once now"}
            </button>
            <button
              className="text-action"
              disabled={busy !== undefined}
              onClick={() => confirm("schedule")}
              type="button"
            >
              {busy === "schedule"
                ? "Scheduling…"
                : `Schedule ${proposal.scheduleLabel.toLowerCase()}`}
            </button>
          </div>
        </section>
      ) : null}
    </Page>
  );
}

function UnavailableProposal({
  outcome,
}: {
  readonly outcome: Exclude<
    TaskProposalOutcomeDto,
    { readonly status: "ready" }
  >;
}) {
  const needsIntegration = outcome.status === "needs_integration";
  const degradedPolicy = taskProposalDegradedConnectionPolicy(outcome);
  return (
    <section className="proposal unavailable-proposal" role="status">
      <div className="section-label">
        {degradedPolicy.connectionNeedsAttention
          ? "Connection needs attention"
          : needsIntegration
            ? "Needs an integration"
            : "Not supported yet"}
      </div>
      {degradedPolicy.showUnavailableDetails ? (
        <>
          <h2>{outcome.title}</h2>
          <p>{outcome.explanation}</p>
        </>
      ) : null}
      <DegradedConnectionsNotice connections={degradedPolicy.connections} />
      {needsIntegration && degradedPolicy.showIntegrationSetup ? (
        <div className="proposal-chips">
          <span>{outcome.missingCapability}</span>
          {outcome.suggestedIntegration ? (
            <span>{outcome.suggestedIntegration}</span>
          ) : null}
        </div>
      ) : null}
      {outcome.supportedAlternative ? (
        <div className="supported-alternative">
          <span>What Springroll can do</span>
          <p>{outcome.supportedAlternative}</p>
        </div>
      ) : null}
      <div className="proposal-unavailable-foot">
        <span>
          {degradedPolicy.connectionNeedsAttention
            ? "Reconnect the existing connection, then try this proposal again."
            : "Revise the request above to try a narrower version."}
        </span>
        {needsIntegration && degradedPolicy.showIntegrationSetup ? (
          <ChatContextButton
            className="text-action"
            entry={{
              mode: "new",
              context: {
                version: 1,
                intent: "connection.create",
                origin: "recipes",
                subjects: [],
                suggestedPrompt: `Connect ${outcome.suggestedIntegration ?? outcome.missingCapability}`,
              },
            }}
            label="Set up integration"
          />
        ) : null}
      </div>
    </section>
  );
}

function ModelIntegrationsPage() {
  const configuration = useLoad(api.models);
  const [keys, setKeys] = useState<Record<ModelProviderId, string>>({
    openrouter: "",
    openai: "",
    xai: "",
  });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();

  const perform = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError(undefined);
    try {
      await action();
      setKeys((current) => ({
        ...current,
        [name as ModelProviderId]: "",
      }));
      await configuration.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  const updateDefault = async (selection: ModelSelectionDto | null) => {
    setBusy("default");
    setError(undefined);
    try {
      await api.updateDefaultModel(selection);
      await configuration.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Page>
      <PageHeading title="Models." />
      <p className="page-intro">
        Connect one or more AI providers, then choose a default. Only models
        available through your active providers appear below.
      </p>
      {configuration.loading ? <LoadingLine /> : null}
      {configuration.error ? (
        <ErrorNotice error={configuration.error} retry={configuration.reload} />
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      {configuration.value ? (
        <>
          <section className="model-default-card">
            <div className="model-default-head">
              <h2>Default model</h2>
              <ModelPicker
                align="end"
                disabled={busy !== undefined}
                inheritLabel="Automatic"
                models={configuration.value.models}
                onChange={updateDefault}
                value={configuration.value.defaultSelection}
              />
            </div>
            <p>
              Runs use this unless a recipe chooses its own. Automatic picks an
              available provider at run time.
            </p>
            <CatalogStatus configuration={configuration.value} />
          </section>

          <div className="section-heading">
            <div className="section-label">AI providers</div>
            <p>API keys are tested once, then saved in macOS Keychain.</p>
          </div>
          <div className="provider-grid">
            {configuration.value.providers.map((provider) => (
              <ModelProviderCard
                busy={busy}
                key={provider.id}
                onConnect={() =>
                  perform(provider.id, () =>
                    api.connectModelProvider(provider.id, keys[provider.id]),
                  )
                }
                onDisconnect={() =>
                  perform(provider.id, () =>
                    api.disconnectModelProvider(provider.id),
                  )
                }
                onKeyChange={(value) =>
                  setKeys((current) => ({
                    ...current,
                    [provider.id]: value,
                  }))
                }
                provider={provider}
                value={keys[provider.id]}
              />
            ))}
          </div>
          <p className="security-note">
            Springroll stores only a Keychain reference in its database. Local
            keys are never copied to Turso or a hosted runner automatically;
            cloud access will require a separate, explicit secret setup.
          </p>
        </>
      ) : null}
    </Page>
  );
}

const providerBlurbs: Record<ModelProviderId, string> = {
  openrouter: "one key routes to models from many labs.",
  openai: "GPT models, straight from the source.",
  xai: "Grok models, straight from the source.",
};

function ModelProviderCard({
  provider,
  value,
  busy,
  onKeyChange,
  onConnect,
  onDisconnect,
}: {
  readonly provider: ModelProviderDto;
  readonly value: string;
  readonly busy: string | undefined;
  readonly onKeyChange: (value: string) => void;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (provider.status === "connected") {
      setOpen(false);
    }
  }, [provider.status]);

  return (
    <section className="provider-card">
      <div className="provider-title">
        <ProviderMark svg={provider.logoSvg} />
        <h2>{provider.name}</h2>
      </div>
      <p className="provider-blurb">
        <b>{provider.kind === "aggregator" ? "Aggregator" : "Direct API"}</b>
        {" — "}
        {providerBlurbs[provider.id]}
      </p>
      {provider.status === "connected" ? (
        <ConnectedRow
          detail="Keychain · this Mac"
          disabled={busy !== undefined}
          onDisconnect={onDisconnect}
        />
      ) : (
        <div className="provider-foot">
          <a
            className="provider-get-key"
            href={provider.keyCreationUrl}
            rel="noreferrer"
            target="_blank"
          >
            Get a key ↗
          </a>
          <span className="connect-wrap">
            <button
              aria-expanded={open}
              className="quiet-button"
              disabled={busy !== undefined}
              onClick={() => setOpen((wasOpen) => !wasOpen)}
              type="button"
            >
              Connect
            </button>
            <ConnectKeyPopover
              busy={busy === provider.id}
              label={`${provider.name} API key`}
              onClose={() => setOpen(false)}
              onKeyChange={onKeyChange}
              onSubmit={onConnect}
              open={open}
              placeholder={provider.keyPlaceholder}
              submitDisabled={!value || busy !== undefined}
              value={value}
            />
          </span>
        </div>
      )}
    </section>
  );
}

function ProviderMark({
  svg,
  url,
  name,
}: {
  readonly svg: string | undefined;
  readonly url?: string | undefined;
  readonly name?: string;
}) {
  const imageUrl = safeConnectorImageUrl(url);
  if (!svg) {
    return imageUrl ? (
      <span aria-hidden="true" className="provider-logo provider-image">
        <img alt="" referrerPolicy="no-referrer" src={imageUrl} />
      </span>
    ) : name ? (
      <span aria-hidden="true" className="provider-logo provider-initial">
        {name.slice(0, 1).toUpperCase()}
      </span>
    ) : null;
  }
  return (
    <span
      aria-hidden="true"
      className="provider-logo"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized static SVG from the logo cache/seeds
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function safeConnectorImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function ConnectKeyPopover({
  open,
  label,
  placeholder,
  value,
  busy,
  submitDisabled,
  submitLabel = "Connect",
  keyCreationUrl,
  onClose,
  onKeyChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly busy: boolean;
  readonly submitDisabled: boolean;
  readonly submitLabel?: string;
  readonly keyCreationUrl?: string | undefined;
  readonly onClose: () => void;
  readonly onKeyChange: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      keyRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        aria-label="Close connect panel"
        className="enable-backdrop"
        onClick={onClose}
        type="button"
      />
      <form
        className="connect-panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          {label}
          <input
            autoComplete="off"
            onChange={(event) => onKeyChange(event.target.value)}
            placeholder={placeholder}
            ref={keyRef}
            type="password"
            value={value}
          />
        </label>
        <div className="connect-panel-actions">
          {keyCreationUrl ? (
            <a
              className="provider-get-key"
              href={keyCreationUrl}
              rel="noreferrer"
              target="_blank"
            >
              Get a key ↗
            </a>
          ) : null}
          <button
            className="button primary"
            disabled={submitDisabled}
            type="submit"
          >
            {busy ? "Checking…" : submitLabel}
          </button>
        </div>
        <small className="connect-panel-note">
          Tested once, then saved in macOS Keychain.
        </small>
      </form>
    </>
  );
}

function ModelPicker({
  models,
  value,
  inheritLabel,
  disabled,
  onChange,
  align = "start",
}: {
  readonly models: readonly ModelOptionDto[];
  readonly value: ModelSelectionDto | undefined;
  readonly inheritLabel: string;
  readonly disabled: boolean;
  readonly onChange: (selection: ModelSelectionDto | null) => void;
  readonly align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = value
    ? models.find(
        (model) =>
          model.providerId === value.providerId &&
          model.modelId === value.modelId,
      )
    : undefined;
  const triggerLabel = value ? (selected?.name ?? value.modelId) : inheritLabel;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleModels = normalizedQuery
    ? models.filter(
        (model) =>
          model.name.toLowerCase().includes(normalizedQuery) ||
          model.modelId.toLowerCase().includes(normalizedQuery) ||
          providerName(model.providerId)
            .toLowerCase()
            .includes(normalizedQuery),
      )
    : models;
  const grouped = groupModels(visibleModels);
  const showInherit = normalizedQuery === "";
  const optionCount = visibleModels.length + (showInherit ? 1 : 0);
  const flatIndexByModel = new Map(
    visibleModels.map((model, index) => [
      modelValue(model),
      index + (showInherit ? 1 : 0),
    ]),
  );

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    }
  }, [open]);

  const choose = (option: ModelOptionDto | null) => {
    setOpen(false);
    onChange(
      option
        ? { providerId: option.providerId, modelId: option.modelId }
        : null,
    );
  };

  const chooseActive = () => {
    if (optionCount === 0) {
      return;
    }
    if (showInherit && active === 0) {
      choose(null);
      return;
    }
    choose(visibleModels[active - (showInherit ? 1 : 0)] ?? null);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, optionCount - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseActive();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const optionClass = (index: number, isSelected: boolean) =>
    `combo-option ${index === active ? "active" : ""} ${
      isSelected ? "selected" : ""
    }`;
  const activeRef = (index: number) =>
    index === active
      ? (element: HTMLButtonElement | null) =>
          element?.scrollIntoView({ block: "nearest" })
      : undefined;

  return (
    <div className="model-picker">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="combo-trigger"
        disabled={disabled || models.length === 0}
        onClick={() => {
          setQuery("");
          setActive(0);
          setOpen((wasOpen) => !wasOpen);
        }}
        type="button"
      >
        <span className="combo-value">{triggerLabel}</span>
        <span aria-hidden="true" className="combo-chev">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {models.length === 0 ? (
        <small>Connect an AI provider to choose a model.</small>
      ) : null}
      {open ? (
        <>
          <button
            aria-label="Close model list"
            className="enable-backdrop"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div className={`combo-panel ${align === "end" ? "align-end" : ""}`}>
            <div className="combo-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search models"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder={`Search ${models.length} models`}
                ref={searchRef}
                value={query}
              />
            </div>
            <div aria-label="AI model" className="combo-list" role="listbox">
              {showInherit ? (
                <button
                  aria-selected={!value}
                  className={`${optionClass(0, !value)} combo-default`}
                  onClick={() => choose(null)}
                  onMouseEnter={() => setActive(0)}
                  ref={activeRef(0)}
                  role="option"
                  type="button"
                >
                  <span aria-hidden="true" className="combo-tick">
                    ✓
                  </span>
                  <span className="combo-name">{inheritLabel}</span>
                </button>
              ) : null}
              {visibleModels.length === 0 ? (
                <p className="combo-empty">No matching models</p>
              ) : null}
              {[...grouped.entries()].map(([providerId, options]) => (
                <div key={providerId}>
                  <div className="combo-group">{providerName(providerId)}</div>
                  {options.map((model) => {
                    const index = flatIndexByModel.get(modelValue(model)) ?? 0;
                    const isSelected =
                      value?.providerId === model.providerId &&
                      value?.modelId === model.modelId;
                    const facts = modelFactsLine(model);
                    return (
                      <button
                        aria-selected={isSelected}
                        className={optionClass(index, isSelected)}
                        key={modelValue(model)}
                        onClick={() => choose(model)}
                        onMouseEnter={() => setActive(index)}
                        ref={activeRef(index)}
                        role="option"
                        type="button"
                      >
                        <span aria-hidden="true" className="combo-tick">
                          ✓
                        </span>
                        <span className="combo-name">{model.name}</span>
                        {facts ? (
                          <span className="combo-facts">{facts}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function modelFactsLine(model: ModelOptionDto): string | undefined {
  const price =
    model.inputUsdPerMillionTokens !== undefined &&
    model.outputUsdPerMillionTokens !== undefined
      ? `$${formatPrice(model.inputUsdPerMillionTokens)} / $${formatPrice(
          model.outputUsdPerMillionTokens,
        )}`
      : undefined;
  const context = model.contextTokens
    ? compactNumber(model.contextTokens)
    : undefined;
  const line = [price, context]
    .filter((fact): fact is string => Boolean(fact))
    .join(" · ");
  return line || undefined;
}

function ModelExecutionLine({
  execution,
  configuration,
}: {
  readonly execution: ModelExecutionDto;
  readonly configuration: ModelSettingsDto | undefined;
}) {
  const model = configuration?.models.find(
    (option) =>
      option.providerId === execution.providerId &&
      option.modelId === execution.modelId,
  );
  const routes = execution.toolRoutes.filter(
    (route, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.profile === route.profile &&
          candidate.service === route.service,
      ) === index,
  );
  const selectionLabel = {
    automatic: "automatic choice",
    default: "app default",
    task: "chosen for this recipe",
  }[execution.selectedBy];
  const parts = [
    `Runs with ${model?.name ?? execution.modelId}`,
    providerName(execution.providerId),
    selectionLabel,
    ...routes.map((route) =>
      route.profile === "portable"
        ? "web via Exa"
        : route.profile === "managed-auto"
          ? "web via OpenRouter"
          : `web via ${providerName(
              route.service === "exa" ? execution.providerId : route.service,
            )}`,
    ),
  ];

  return <small className="execution-line">{parts.join(" · ")}</small>;
}

function ModelExecutionPreview({
  execution,
  configuration,
}: {
  readonly execution: ModelExecutionDto;
  readonly configuration: ModelSettingsDto | undefined;
}) {
  const model = configuration?.models.find(
    (option) =>
      option.providerId === execution.providerId &&
      option.modelId === execution.modelId,
  );
  const routes = execution.toolRoutes.filter(
    (route, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.profile === route.profile &&
          candidate.service === route.service,
      ) === index,
  );
  const selectionLabel = {
    automatic: "Automatic choice",
    default: "App default",
    task: "Task choice",
  }[execution.selectedBy];

  return (
    <aside className="execution-preview" aria-label="Execution preview">
      <span className="execution-label">Will run with</span>
      <strong>{model?.name ?? execution.modelId}</strong>
      <small>
        {providerName(execution.providerId)} · {selectionLabel}
      </small>
      {routes.map((route) => (
        <span
          className="execution-route"
          key={`${route.profile}:${route.service}`}
        >
          {route.profile === "portable"
            ? "Web via Exa · selected model stays unchanged"
            : route.profile === "managed-auto"
              ? "Web via OpenRouter · search engine chosen at run time"
              : `Web via ${providerName(route.service === "exa" ? execution.providerId : route.service)} native tools`}
        </span>
      ))}
    </aside>
  );
}

function CatalogStatus({
  configuration,
}: {
  readonly configuration: ModelSettingsDto;
}) {
  if (!configuration.catalogUpdatedAt) return null;
  return (
    <small className="catalog-status">
      models.dev catalog · updated{" "}
      {new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(configuration.catalogUpdatedAt))}
      {configuration.catalogStale ? " · offline copy" : ""}
    </small>
  );
}

function ConnectionsIntegrationsPage() {
  const connections = useLoad(api.connections);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState<string>();
  const [keyPanel, setKeyPanel] = useState<string>();
  const [connectorKey, setConnectorKey] = useState("");
  const [webSearchKey, setWebSearchKey] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ConnectionStatusFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | undefined>(
    () => searchParams.get("tag")?.trim().toLowerCase() || undefined,
  );

  const catalogCards = visibleIntegrationCatalog(connections.value ?? []);
  const tags = connectionCatalogTags(catalogCards);
  const filterOn =
    query.trim() !== "" || statusFilter !== "all" || tagFilter !== undefined;
  const cards = filterIntegrationCatalog(catalogCards, {
    query,
    status: statusFilter,
    ...(tagFilter ? { tag: tagFilter } : undefined),
  });

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setTagFilter(undefined);
  };

  const performWebSearch = async (action: () => Promise<unknown>) => {
    setBusy("web-search");
    connections.setError(undefined);
    try {
      await action();
      setWebSearchKey("");
      setKeyPanel(undefined);
      await connections.reload();
    } catch (error) {
      connections.setError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const startConnectionChat = async (prompt: string) => {
    setBusy("new-integration");
    connections.setError(undefined);
    try {
      const session = await api.enterChat({
        mode: "new",
        context: {
          version: 1,
          intent: "connection.create",
          origin: "connections",
          subjects: [],
          suggestedPrompt: prompt,
        },
      });
      navigate(`/chat/${session.id}`);
    } catch (error) {
      connections.setError(error);
      setBusy(undefined);
    }
  };

  const disconnect = async (card: ConnectionCardDto) => {
    const action =
      card.credentialKind === "oauth"
        ? "Sign out"
        : card.credentialKind === "none"
          ? "Disable"
          : "Disconnect";
    const consequence =
      card.credentialKind === "oauth"
        ? "Springroll will remove its OAuth credential from this Mac and disable its tools, but keep the connector so you can sign in again later. This does not revoke the provider-side grant."
        : card.credentialKind === "api-key"
          ? "Springroll will remove its API key from Keychain and disable its tools, but keep the connector so you can reconnect later."
          : "Springroll will disable its tools but keep the connector so you can enable it again later.";
    if (!window.confirm(`${action} ${card.name} on this Mac? ${consequence}`)) {
      return;
    }
    setBusy(card.id);
    connections.setError(undefined);
    try {
      await api.disconnectConnector(card.id);
      await connections.reload();
    } catch (error) {
      connections.setError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async (card: ConnectionCardDto) => {
    const catalogConsequence = card.custom
      ? "This custom connector will no longer appear in the catalog."
      : "Its curated template will remain in the catalog so you can add it again later.";
    if (
      !window.confirm(
        `Remove ${card.name} from Springroll? This deletes the installed connector configuration and any saved credential. It cannot be removed while a recipe still uses it. ${catalogConsequence}`,
      )
    ) {
      return;
    }
    setBusy(card.id);
    connections.setError(undefined);
    try {
      await api.removeConnector(card.id);
      setKeyPanel(undefined);
      setConnectorKey("");
      await connections.reload();
    } catch (error) {
      connections.setError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const reconnect = async (card: ConnectionCardDto) => {
    if (card.credentialKind === "api-key") {
      setConnectorKey("");
      setWebSearchKey("");
      setKeyPanel(card.id);
      return;
    }
    setBusy(card.id);
    connections.setError(undefined);
    try {
      if (card.credentialKind === "oauth") {
        const result = await api.startConnectorOAuth(card.id);
        if (result.status === "redirect") {
          window.location.assign(result.authorizationUrl);
          return;
        }
      } else {
        await api.connectConnector(card.id);
      }
      await connections.reload();
    } catch (error) {
      connections.setError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const reconnectWithKey = async (card: ConnectionCardDto) => {
    setBusy(card.id);
    connections.setError(undefined);
    try {
      await api.connectConnector(card.id, connectorKey);
      setKeyPanel(undefined);
      setConnectorKey("");
      await connections.reload();
    } catch (error) {
      connections.setError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const connectFeatured = async (card: ConnectionCardDto) => {
    if (!card.setupVariantId) return;
    setBusy(card.id);
    connections.setError(undefined);
    try {
      const prepared = await api.prepareIntegrationVariant(
        card.id,
        card.setupVariantId,
      );
      if (prepared.credentialKind === "oauth") {
        const result = await api.startConnectorOAuth(prepared.id);
        if (result.status === "redirect") {
          window.location.assign(result.authorizationUrl);
          return;
        }
        await connections.reload();
        return;
      }
      await startConnectionChat(`Connect ${card.name}`);
    } catch (error) {
      connections.setError(error);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Page>
      <PageHeading
        title="Connections."
        action={
          <div className="heading-actions">
            <FilterControl
              label="Filter connections"
              on={filterOn}
              open={filterOpen}
              setOpen={setFilterOpen}
            >
              <input
                aria-label="Search connections"
                className="filter-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search connections"
                type="search"
                value={query}
              />
              <div className="filter-section-label">Status</div>
              <div className="filter-chips">
                {(["all", "connected", "disconnected"] as const).map(
                  (status) => (
                    <button
                      className={`filter-chip ${statusFilter === status ? "on" : ""}`}
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      type="button"
                    >
                      {status === "all"
                        ? "All"
                        : status === "connected"
                          ? "Connected"
                          : "Not connected"}
                    </button>
                  ),
                )}
              </div>
              <div className="filter-section-label">Tags</div>
              <div className="filter-chips">
                {tags.map((tag) => (
                  <button
                    className={`filter-chip ${tagFilter === tag ? "on" : ""}`}
                    key={tag}
                    onClick={() =>
                      setTagFilter(tagFilter === tag ? undefined : tag)
                    }
                    type="button"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              {filterOn ? (
                <button
                  className="text-action filter-clear"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </FilterControl>
            <button
              className="button primary"
              disabled={busy !== undefined}
              onClick={() => void startConnectionChat("I want to connect ")}
              type="button"
            >
              <PlusIcon />
              {busy === "new-integration" ? "Starting…" : "New integration"}
            </button>
          </div>
        }
      />
      <p className="page-intro">
        Give Springroll access to search, services, and local tools. Connect a
        common service or describe what you need.
      </p>
      <section className="agent-access-summary">
        <div>
          <div className="section-label">What the agent sees</div>
          <h2>Connection tools load on demand.</h2>
        </div>
        <p>
          Springroll does not put every connector schema into every chat. The
          agent can inspect connection names, status, and discovered tool names
          and effects, then loads one connection's descriptions and JSON schemas
          when it needs them. Read tools can run directly; write and destructive
          tools are not directly exposed and stay behind the proposal and
          approval boundary.
        </p>
      </section>
      {connections.loading ? <LoadingLine /> : null}
      {connections.error ? (
        <ErrorNotice error={connections.error} retry={connections.reload} />
      ) : null}
      {searchParams.get("oauthError") ? (
        <ErrorNotice error={searchParams.get("oauthError")} />
      ) : null}
      {filterOn && cards.length === 0 && catalogCards.length > 0 ? (
        <EmptyState
          title="No matches"
          body="No connections match the current filters."
          action={
            <button
              className="text-action"
              onClick={clearFilters}
              type="button"
            >
              Clear filters
            </button>
          }
        />
      ) : null}
      <div className="provider-grid connection-provider-grid">
        {cards.map((card) => {
          if (card.id === "web-search") {
            const personalKey = Boolean(card.credentialConfigured);
            return (
              <section
                className="provider-card connector-provider-card"
                key={card.id}
              >
                <div className="provider-title">
                  <ProviderMark
                    name={card.name}
                    svg={card.logoSvg}
                    url={card.logoUrl}
                  />
                  <Link
                    className="connector-title-link"
                    to={`/connections/${encodeURIComponent(card.id)}`}
                  >
                    <h2>{card.name}</h2>
                  </Link>
                  <span className="status status-quiet">BUILT-IN</span>
                </div>
                <p className="provider-blurb">{card.description}</p>
                {card.tags?.length ? (
                  <div className="connector-tags">
                    {card.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
                <div className="connector-trust-line">
                  Provided by Exa · available to every model
                </div>
                <div className="connector-agent-line">
                  Agent tools load on demand
                  <Link to={`/connections/${encodeURIComponent(card.id)}`}>
                    View details
                  </Link>
                </div>
                {personalKey ? (
                  <ConnectedRow
                    actionLabel="Remove key"
                    detail="Personal key · Keychain"
                    disabled={busy !== undefined}
                    onDisconnect={() =>
                      void performWebSearch(api.disconnectWebSearch)
                    }
                  />
                ) : (
                  <div className="connected-row">
                    <span>
                      <i aria-hidden="true" />
                      Free search · no setup
                    </span>
                    <span className="connect-wrap">
                      <button
                        aria-expanded={keyPanel === card.id}
                        className="quiet-button"
                        disabled={busy !== undefined}
                        onClick={() => {
                          if (keyPanel === card.id) {
                            setKeyPanel(undefined);
                            setWebSearchKey("");
                          } else {
                            setKeyPanel(card.id);
                            setConnectorKey("");
                          }
                        }}
                        type="button"
                      >
                        Add your own key
                      </button>
                      <ConnectKeyPopover
                        busy={busy === card.id}
                        keyCreationUrl={card.keyCreationUrl}
                        label="Exa API key"
                        onClose={() => {
                          setKeyPanel(undefined);
                          setWebSearchKey("");
                        }}
                        onKeyChange={setWebSearchKey}
                        onSubmit={() =>
                          void performWebSearch(() =>
                            api.connectWebSearch(webSearchKey),
                          )
                        }
                        open={keyPanel === card.id}
                        placeholder="Your Exa key"
                        submitDisabled={
                          !webSearchKey.trim() || busy !== undefined
                        }
                        submitLabel="Add key"
                        value={webSearchKey}
                      />
                    </span>
                  </div>
                )}
              </section>
            );
          }
          const connected = card.status === "connected";
          const connectionIssue =
            card.connectionIssue === "credential_invalid"
              ? "Credential invalid"
              : card.connectionIssue === "credential_missing"
                ? card.credentialKind === "oauth"
                  ? "Sign-in expired"
                  : "Credential missing"
                : card.custom && !card.installed
                  ? "Setup required"
                  : "Disconnected";
          const locations = card.availableIn?.includes("hosted")
            ? "this Mac + cloud"
            : "this Mac";
          return (
            <section
              className="provider-card connector-provider-card"
              key={card.id}
            >
              <div className="provider-title">
                <ProviderMark
                  name={card.name}
                  svg={card.logoSvg}
                  url={card.logoUrl}
                />
                <Link
                  className="connector-title-link"
                  to={`/connections/${encodeURIComponent(card.id)}`}
                >
                  <h2>{card.name}</h2>
                </Link>
                {card.connectionType ? (
                  <span className="status status-quiet">
                    {card.connectionType.toUpperCase()}
                  </span>
                ) : null}
                {card.custom ? (
                  <span className="status status-quiet">Custom</span>
                ) : null}
              </div>
              <p className="provider-blurb">{card.description}</p>
              {card.tags?.length ? (
                <div className="connector-tags">
                  {card.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}
              <div className="connector-trust-line">
                Hosted by {card.operator ?? card.name} · {locations}
              </div>
              <div className="connector-agent-line">
                {card.toolCount === undefined
                  ? "Agent catalog available after connection"
                  : `Agent loads ${card.toolCount} ${card.toolCount === 1 ? "tool" : "tools"} on demand`}
                <Link to={`/connections/${encodeURIComponent(card.id)}`}>
                  View details
                </Link>
              </div>
              {connected ? (
                <div className="connected-row">
                  <span>
                    <i aria-hidden="true" />
                    {card.credentialKind === "none"
                      ? "Enabled"
                      : card.credentialKind === "oauth"
                        ? "Signed in"
                        : "Keychain"}
                    {` · tools discovered · ${card.toolCount ?? 0} tools`}
                  </span>
                  <span className="connector-card-actions">
                    <button
                      className="quiet-button"
                      disabled={busy !== undefined}
                      onClick={() => void disconnect(card)}
                      type="button"
                    >
                      {card.credentialKind === "oauth"
                        ? "Sign out"
                        : card.credentialKind === "none"
                          ? "Disable"
                          : "Disconnect"}
                    </button>
                    {card.removable ? (
                      <button
                        className="quiet-button danger-action"
                        disabled={busy !== undefined}
                        onClick={() => void remove(card)}
                        type="button"
                      >
                        Remove connector
                      </button>
                    ) : null}
                  </span>
                </div>
              ) : card.installed || card.custom ? (
                <div className="provider-foot">
                  <span className="status status-quiet">{connectionIssue}</span>
                  <span className="connector-card-actions connect-wrap">
                    <button
                      aria-expanded={keyPanel === card.id}
                      className="button secondary"
                      disabled={busy !== undefined}
                      onClick={() => void reconnect(card)}
                      type="button"
                    >
                      {busy === card.id
                        ? "Connecting…"
                        : card.installed
                          ? "Reconnect"
                          : "Connect"}
                    </button>
                    {card.removable ? (
                      <button
                        className="quiet-button danger-action"
                        disabled={busy !== undefined}
                        onClick={() => void remove(card)}
                        type="button"
                      >
                        Remove connector
                      </button>
                    ) : null}
                    {card.credentialKind === "api-key" ? (
                      <ConnectKeyPopover
                        busy={busy === card.id}
                        keyCreationUrl={card.keyCreationUrl}
                        label={
                          card.credentialPlaceholder ?? `${card.name} API key`
                        }
                        onClose={() => {
                          setKeyPanel(undefined);
                          setConnectorKey("");
                        }}
                        onKeyChange={setConnectorKey}
                        onSubmit={() => void reconnectWithKey(card)}
                        open={keyPanel === card.id}
                        placeholder={
                          card.credentialPlaceholder ?? "Paste API key"
                        }
                        submitDisabled={
                          !connectorKey.trim() || busy !== undefined
                        }
                        submitLabel={card.installed ? "Reconnect" : "Connect"}
                        value={connectorKey}
                      />
                    ) : null}
                  </span>
                </div>
              ) : card.status === "coming_soon" ? (
                <div className="provider-foot">
                  <span className="status status-quiet">Coming soon</span>
                </div>
              ) : (
                <div className="provider-foot">
                  <span className="status status-quiet">OAuth</span>
                  <button
                    className="button secondary"
                    disabled={!card.setupVariantId || busy !== undefined}
                    onClick={() => void connectFeatured(card)}
                    type="button"
                  >
                    {busy === card.id ? "Opening…" : "Sign in"}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Page>
  );
}

function ConnectionDetailPage() {
  const { id = "" } = useParams();
  const loadConnection = useCallback(() => api.connection(id), [id]);
  const connection = useLoad(loadConnection);

  return (
    <Page>
      <BackLink to="/connections">Connections</BackLink>
      {connection.loading ? <LoadingLine /> : null}
      {connection.error ? (
        <ErrorNotice error={connection.error} retry={connection.reload} />
      ) : null}
      {connection.value ? (
        <ConnectionDetailContent connection={connection.value} />
      ) : null}
    </Page>
  );
}

function ConnectionDetailContent({
  connection,
}: {
  readonly connection: ConnectionDetailDto;
}) {
  const connected = connection.status === "connected";
  const catalogLabel =
    connection.catalogSource === "live"
      ? "Live catalog"
      : connection.catalogSource === "last-discovered"
        ? "Last discovered catalog"
        : "Catalog unavailable";
  const statusLabel =
    connection.status === "connected"
      ? "Connected"
      : connection.status === "coming_soon"
        ? "Coming soon"
        : connection.connectionIssue === "credential_invalid"
          ? "Credential invalid — reconnect required"
          : connection.connectionIssue === "credential_missing"
            ? connection.credentialKind === "oauth"
              ? "Sign-in expired — reconnect required"
              : "Credential missing — reconnect required"
            : "Not connected";

  return (
    <>
      <div className="connection-detail-heading">
        <ProviderMark
          name={connection.name}
          svg={connection.logoSvg}
          url={connection.logoUrl}
        />
        <PageHeading
          eyebrow={connected ? "Connected" : "Connection"}
          title={`${connection.name}.`}
          action={
            <ChatContextButton
              entry={{
                mode: "new",
                context: {
                  version: 1,
                  intent: "connection.manage",
                  origin: "connections",
                  subjects: [{ kind: "connection", id: connection.id }],
                  suggestedPrompt: `Help me with my ${connection.name} connection`,
                },
              }}
            />
          }
        />
      </div>
      <p className="page-intro">{connection.description}</p>
      <dl className="detail-grid connection-detail-grid">
        <div>
          <dt>Status</dt>
          <dd>{statusLabel}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{connection.connectionType?.toUpperCase() ?? "Built-in"}</dd>
        </div>
        <div>
          <dt>Agent catalog</dt>
          <dd>{catalogLabel}</dd>
        </div>
        <div>
          <dt>Authentication</dt>
          <dd>
            {connection.credentialKind === "oauth"
              ? "OAuth"
              : connection.credentialKind === "api-key"
                ? "API key in Keychain"
                : "None"}
          </dd>
        </div>
      </dl>
      <section className="agent-access-summary connection-agent-summary">
        <div>
          <div className="section-label">Agent access</div>
          <h2>Lazy by default, complete when inspected.</h2>
        </div>
        <p>
          The base chat receives no {connection.name} tool schemas. When the
          agent inspects Connections, it sees this connection and the tool names
          and effects below. It then loads descriptions and JSON schemas for
          this connection on demand. Read tools can run directly. Write and
          destructive tools are not directly exposed and stay behind the
          proposal and approval boundary.
        </p>
      </section>
      <div className="section-heading connection-tools-heading">
        <div>
          <div className="section-label">Available tools</div>
          <h2>
            {connection.tools.length}{" "}
            {connection.tools.length === 1 ? "tool" : "tools"}
          </h2>
        </div>
        <span className="status status-quiet">{catalogLabel}</span>
      </div>
      {connection.tools.length ? (
        <div className="connection-tool-catalog">
          {connection.tools.map((tool) => (
            <article className="connection-tool-detail" key={tool.name}>
              <div className="connection-tool-name">
                <code className="connection-tool-code">{tool.name}</code>
                <span className={`tool-effect tool-effect-${tool.effect}`}>
                  {tool.effect}
                </span>
              </div>
              <p>
                {tool.description?.trim() ||
                  "This connector did not provide a tool description."}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No tool catalog yet"
          body={
            connected
              ? "Springroll could not load this connection's live tool catalog."
              : "Connect this service to discover the tools the agent can use."
          }
          action={
            <ChatContextButton
              entry={{
                mode: "new",
                context: {
                  version: 1,
                  intent: "connection.manage",
                  origin: "connections",
                  subjects: [{ kind: "connection", id: connection.id }],
                  suggestedPrompt: `Help me connect ${connection.name}`,
                },
              }}
              label={`Connect ${connection.name}`}
            />
          }
        />
      )}
      {connection.credentialAudit.length ? (
        <>
          <div className="section-heading connection-tools-heading">
            <div>
              <div className="section-label">Credential audit</div>
              <h2>Host-side activity</h2>
            </div>
          </div>
          <div className="connection-tool-catalog">
            {connection.credentialAudit.map((event) => (
              <article className="connection-tool-detail" key={event.id}>
                <div className="connection-tool-name">
                  <strong>{credentialAuditActionLabel(event.action)}</strong>
                  <span
                    className={`status ${event.status === "succeeded" ? "status-good" : "status-needs-you"}`}
                  >
                    {event.status}
                  </span>
                </div>
                <p>
                  {formatFullDate(event.createdAt)}
                  {event.failureCategory
                    ? ` · ${event.failureCategory.replaceAll("_", " ")}`
                    : ""}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function credentialAuditActionLabel(
  action: ConnectionDetailDto["credentialAudit"][number]["action"],
): string {
  switch (action) {
    case "test":
      return "Credential tested";
    case "oauth_start":
      return "OAuth started";
    case "oauth_complete":
      return "OAuth completed";
    case "revoke":
      return "Credential revoked";
    case "remove":
      return "Connector removed";
  }
}

function NewIntegrationConversationEntryPage() {
  const [searchParams] = useSearchParams();
  const suggestedPrompt =
    searchParams.get("prompt")?.trim() || "I want to connect ";
  return (
    <ConversationEntryPage
      backTo="/connections"
      entry={{
        mode: "new",
        context: {
          version: 1,
          intent: "connection.create",
          origin: "connections",
          subjects: [],
          suggestedPrompt,
        },
      }}
    />
  );
}

function NewIntegrationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPrompt = searchParams.get("prompt") ?? "";
  const [sentence, setSentence] = useState(initialPrompt);
  const [outcome, setOutcome] = useState<IntegrationProposalOutcomeDto>();
  const [selectedVariant, setSelectedVariant] = useState<string>();
  const [prepared, setPrepared] = useState<ConnectionCardDto>();
  const [customPrepared, setCustomPrepared] = useState<ConnectionCardDto>();
  const [customType, setCustomType] = useState<"mcp" | "api-docs" | "openapi">(
    "mcp",
  );
  const [customName, setCustomName] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customApiGoal, setCustomApiGoal] = useState("");
  const [customKeyCreationUrl, setCustomKeyCreationUrl] = useState("");
  const [customCredential, setCustomCredential] = useState<
    "oauth" | "api-key" | "none"
  >("oauth");
  const [customHeader, setCustomHeader] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string>();
  const prefillSubmitted = useRef(false);

  const perform = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  const propose = useCallback(async (request: string) => {
    if (!request.trim()) return;
    setBusy("proposal");
    setError(undefined);
    setOutcome(undefined);
    setPrepared(undefined);
    setCustomPrepared(undefined);
    setApiKey("");
    try {
      const result = await api.proposeIntegration(request);
      setOutcome(result);
      setSelectedVariant(
        result.status === "ready"
          ? (result.proposal.variants.find((variant) => variant.recommended)
              ?.id ?? result.proposal.variants[0]?.id)
          : undefined,
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => {
    if (!initialPrompt || prefillSubmitted.current) return;
    prefillSubmitted.current = true;
    void propose(initialPrompt);
  }, [initialPrompt, propose]);

  const beginSetup = async () => {
    if (outcome?.status !== "ready" || !selectedVariant) return;
    setBusy("setup");
    setError(undefined);
    try {
      const card = await api.prepareIntegrationVariant(
        outcome.proposal.templateId,
        selectedVariant,
      );
      setPrepared(card);
      if (card.credentialKind === "oauth") {
        const result = await api.startConnectorOAuth(card.id);
        if (result.status === "redirect") {
          window.location.assign(result.authorizationUrl);
          return;
        }
        setOutcome(undefined);
        setPrepared(undefined);
        navigate("/connections");
      } else if (card.credentialKind === "none") {
        await api.connectConnector(card.id);
        setOutcome(undefined);
        setPrepared(undefined);
        navigate("/connections");
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  const activeVariant =
    outcome?.status === "ready"
      ? outcome.proposal.variants.find(
          (variant) => variant.id === selectedVariant,
        )
      : undefined;

  return (
    <Page narrow>
      <BackLink to="/connections">Connections</BackLink>
      <PageHeading
        eyebrow="New integration"
        title="What would you like to connect?"
      />
      <form
        className="composer integration-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void propose(sentence);
        }}
      >
        <textarea
          aria-label="Integration request"
          onChange={(event) => setSentence(event.target.value)}
          placeholder="Connect Jira, Neon, GitHub, or another service"
          value={sentence}
        />
        <div className="composer-foot">
          <span>
            Credentials are collected separately and never sent through chat.
          </span>
          <button
            className="button primary"
            disabled={!sentence.trim() || busy !== undefined}
            type="submit"
          >
            {busy === "proposal" ? "Looking…" : "Find connection"}
          </button>
        </div>
      </form>
      <details className="integration-evidence custom-mcp-entry">
        <summary>I already have MCP configuration or API documentation</summary>
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform("custom", async () => {
              if (customType === "api-docs") {
                const session = await api.enterChat({
                  mode: "new",
                  context: {
                    version: 1,
                    intent: "connection.create",
                    origin: "connections",
                    subjects: [],
                    suggestedPrompt: `Create a small API integration${customName.trim() ? ` named ${customName.trim()}` : ""} for this goal: ${customApiGoal.trim()}\n\nAPI documentation: ${customEndpoint.trim()}`,
                  },
                });
                navigate(`/chat/${session.id}`);
                return;
              }
              const card =
                customType === "openapi"
                  ? await api.prepareCustomOpenApi({
                      ...(customName.trim() ? { name: customName.trim() } : {}),
                      specUrl: customEndpoint.trim(),
                      ...(customKeyCreationUrl.trim()
                        ? { keyCreationUrl: customKeyCreationUrl.trim() }
                        : {}),
                    })
                  : await api.prepareImportedRemoteMcp({
                      ...(customName.trim() ? { name: customName.trim() } : {}),
                      configuration: customEndpoint.trim(),
                      credentialKind: customCredential,
                      ...(customCredential === "api-key" && customHeader.trim()
                        ? { header: customHeader.trim() }
                        : {}),
                    });
              setCustomPrepared(card);
              if (card.credentialKind === "oauth") {
                const result = await api.startConnectorOAuth(card.id);
                if (result.status === "redirect") {
                  window.location.assign(result.authorizationUrl);
                  return;
                }
                navigate("/connections");
              } else if (card.credentialKind === "none") {
                await api.connectConnector(card.id);
                navigate("/connections");
              }
            });
          }}
        >
          <label>
            Connection type
            <select
              onChange={(event) => {
                setCustomType(
                  event.target.value as "mcp" | "api-docs" | "openapi",
                );
                setCustomPrepared(undefined);
                setError(undefined);
              }}
              value={customType}
            >
              <option value="mcp">Remote MCP server</option>
              <option value="api-docs">API documentation</option>
              <option value="openapi">OpenAPI 3.x API</option>
            </select>
          </label>
          <label>
            Name <small>optional</small>
            <input
              onChange={(event) => setCustomName(event.target.value)}
              placeholder="My connector"
              value={customName}
            />
          </label>
          <label htmlFor="custom-integration-endpoint">
            {customType === "openapi"
              ? "OpenAPI JSON URL"
              : customType === "api-docs"
                ? "API documentation URL"
                : "MCP URL or configuration JSON"}
            {customType === "mcp" ? (
              <textarea
                id="custom-integration-endpoint"
                onChange={(event) => setCustomEndpoint(event.target.value)}
                placeholder={
                  'https://example.com/mcp\n\nor\n\n{"mcpServers":{"example":{"url":"https://example.com/mcp"}}}'
                }
                required
                value={customEndpoint}
              />
            ) : (
              <input
                id="custom-integration-endpoint"
                onChange={(event) => setCustomEndpoint(event.target.value)}
                placeholder={
                  customType === "openapi"
                    ? "https://example.com/openapi.json"
                    : "https://example.com/api/docs"
                }
                required
                type="url"
                value={customEndpoint}
              />
            )}
          </label>
          {customType === "api-docs" ? (
            <>
              <label>
                What should Springroll do with this API?
                <textarea
                  onChange={(event) => setCustomApiGoal(event.target.value)}
                  placeholder="Look up the current exchange rate for a currency pair"
                  required
                  value={customApiGoal}
                />
              </label>
              <p className="proposal-mode">
                Springroll will summarize only the operations needed for this
                goal, show the adapter for review, and run an explicitly safe
                test when the documentation identifies one. OpenAPI is optional.
              </p>
            </>
          ) : null}
          {customType === "openapi" ? (
            <>
              <p className="proposal-mode">
                Springroll reads the API server, authentication header, and
                operations from the specification. Header API keys and bearer
                tokens are supported.
              </p>
              <label>
                API-key setup URL <small>optional</small>
                <input
                  onChange={(event) =>
                    setCustomKeyCreationUrl(event.target.value)
                  }
                  placeholder="https://example.com/settings/api-keys"
                  type="url"
                  value={customKeyCreationUrl}
                />
              </label>
            </>
          ) : customType === "mcp" ? (
            <>
              <label>
                Authentication
                <select
                  onChange={(event) =>
                    setCustomCredential(
                      event.target.value as "oauth" | "api-key" | "none",
                    )
                  }
                  value={customCredential}
                >
                  <option value="oauth">OAuth sign-in</option>
                  <option value="api-key">API key</option>
                  <option value="none">None</option>
                </select>
              </label>
              {customCredential === "api-key" ? (
                <label>
                  Header{" "}
                  <small>optional; defaults to Bearer authorization</small>
                  <input
                    onChange={(event) => setCustomHeader(event.target.value)}
                    placeholder="X-API-Key"
                    value={customHeader}
                  />
                </label>
              ) : null}
            </>
          ) : null}
          <div className="proposal-actions">
            <button
              className="button"
              disabled={
                !customEndpoint.trim() ||
                (customType === "api-docs" && !customApiGoal.trim()) ||
                busy !== undefined
              }
              type="submit"
            >
              {busy === "custom"
                ? "Checking…"
                : customType === "api-docs"
                  ? "Summarize API"
                  : "Continue"}
            </button>
          </div>
        </form>
        {customPrepared?.credentialKind === "api-key" ? (
          <form
            className="connection-form secure-credential-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform("custom-credential", async () => {
                await api.connectConnector(customPrepared.id, apiKey);
                setApiKey("");
                navigate("/connections");
              });
            }}
          >
            <label>
              {customPrepared.name} API key
              <input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  customPrepared.credentialPlaceholder ?? "Your API key"
                }
                type="password"
                value={apiKey}
              />
            </label>
            <div className="proposal-actions">
              <button
                className="button"
                disabled={!apiKey.trim() || busy !== undefined}
                type="submit"
              >
                {busy === "custom-credential"
                  ? "Connecting…"
                  : "Connect & discover tools"}
              </button>
            </div>
          </form>
        ) : null}
      </details>
      {searchParams.get("oauthError") ? (
        <ErrorNotice error={searchParams.get("oauthError")} />
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      {outcome?.status === "ready" ? (
        <section className="proposal integration-proposal">
          <div className="section-label">Connection proposal</div>
          <h2>{outcome.proposal.name}</h2>
          <p className="proposal-mode">{outcome.proposal.description}</p>
          <div className="connector-trust-line">
            Hosted by {outcome.proposal.operator} ·{" "}
            {outcome.proposal.trust === "registry-verified"
              ? "publisher verified by the official MCP Registry · tools discovered after sign-in"
              : outcome.proposal.trust === "openapi-verified"
                ? "official OpenAPI document verified · server, authentication, and operations derived by Springroll"
                : outcome.proposal.trust === "package-verified"
                  ? "package identity and source repository verified · tools discovered after launch"
                  : "Springroll curated · tools discovered after sign-in"}
          </div>
          {outcome.proposal.registryName ? (
            <p className="integration-registry-id">
              {outcome.proposal.registryName} · v
              {outcome.proposal.registryVersion}
            </p>
          ) : null}
          {outcome.proposal.tools?.length ? (
            <ul
              className="connector-tool-list integration-proposal-tools"
              aria-label={`${outcome.proposal.name} proposed tools`}
            >
              {outcome.proposal.tools.map((tool) => (
                <li key={tool.name}>
                  <i
                    className={`risk-dot risk-${tool.effect}`}
                    aria-hidden="true"
                  />
                  {tool.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="proposal-mode">
              The current tool list and schemas will be read directly from the
              connector after authentication.
            </p>
          )}
          <div
            className="integration-variants"
            role="radiogroup"
            aria-label="Setup method"
          >
            {outcome.proposal.variants.map((variant) => (
              <label key={variant.id}>
                <input
                  checked={selectedVariant === variant.id}
                  name="integration-variant"
                  onChange={() => {
                    setSelectedVariant(variant.id);
                    setPrepared(undefined);
                    setApiKey("");
                  }}
                  type="radio"
                  value={variant.id}
                />
                <span>
                  <b>{variant.label}</b>
                  {variant.recommended ? <small>Recommended</small> : null}
                </span>
              </label>
            ))}
          </div>
          {activeVariant ? (
            <div className="integration-guidance">
              <p>{activeVariant.guidance.summary}</p>
              <ol>
                {activeVariant.guidance.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <a
                href={activeVariant.guidance.docsUrl}
                rel="noreferrer"
                target="_blank"
              >
                Provider setup guide
              </a>
            </div>
          ) : null}
          {outcome.proposal.sources?.length ? (
            <details className="integration-evidence">
              <summary>Official sources reviewed</summary>
              <ul>
                {outcome.proposal.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} rel="noreferrer" target="_blank">
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {prepared?.credentialKind === "api-key" ? (
            <form
              className="connection-form secure-credential-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform("credential", async () => {
                  await api.connectConnector(prepared.id, apiKey);
                  setApiKey("");
                  setPrepared(undefined);
                  setOutcome(undefined);
                  navigate("/connections");
                });
              }}
            >
              <label>
                {prepared.name} API key
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={prepared.credentialPlaceholder ?? "Your API key"}
                  type="password"
                  value={apiKey}
                />
              </label>
              <div className="proposal-actions">
                <button
                  className="button"
                  disabled={!apiKey.trim() || busy !== undefined}
                  type="submit"
                >
                  {busy === "credential" ? "Verifying…" : "Verify & connect"}
                </button>
              </div>
            </form>
          ) : (
            <div className="proposal-actions">
              <button
                className="button"
                disabled={!activeVariant || busy !== undefined}
                onClick={() => void beginSetup()}
                type="button"
              >
                {busy === "setup"
                  ? "Opening…"
                  : (activeVariant?.label ?? "Continue")}
              </button>
            </div>
          )}
        </section>
      ) : outcome ? (
        <section className="proposal unavailable-proposal" role="status">
          <div className="section-label">
            {outcome.status === "unavailable"
              ? "Not ready yet"
              : "Not in the registry"}
          </div>
          <h2>{outcome.title}</h2>
          <p>{outcome.explanation}</p>
        </section>
      ) : null}
    </Page>
  );
}

const standardThemeIds = new Set([
  "system",
  "springroll-light",
  "springroll-dark",
]);
const themeGroups = [
  {
    label: "Standard",
    themes: builtInThemes.filter((theme) => standardThemeIds.has(theme.id)),
  },
  {
    label: "Dark",
    themes: builtInThemes.filter(
      (theme) =>
        !standardThemeIds.has(theme.id) &&
        !theme.id.endsWith("-glass") &&
        theme.appearance === "dark",
    ),
  },
  {
    label: "Light",
    themes: builtInThemes.filter(
      (theme) =>
        !standardThemeIds.has(theme.id) && theme.appearance === "light",
    ),
  },
  {
    label: "Glass",
    themes: builtInThemes.filter((theme) => theme.id.endsWith("-glass")),
  },
];

function SettingsPage() {
  const [themeId, setThemeId] = useState<ThemeId>(readThemePreference);
  const [textSize, setTextSize] = useState<TextSize>(readTextSizePreference);

  const selectTheme = (nextThemeId: ThemeId) => {
    saveThemePreference(nextThemeId);
    setThemeId(nextThemeId);
  };

  const selectTextSize = (nextSize: TextSize) => {
    saveTextSizePreference(nextSize);
    setTextSize(nextSize);
  };

  return (
    <Page>
      <PageHeading title="Settings." />
      <p className="page-intro">
        A theme is one accent and status hues on a ground pair. Status stays in
        the dots.
      </p>
      <section className="theme-settings" aria-labelledby="theme-heading">
        <div className="section-heading">
          <div className="section-label" id="theme-heading">
            Theme
          </div>
          <p>Your choice is saved only on this device.</p>
        </div>
        <div className="theme-rails">
          {themeGroups.map((group) => (
            <div key={group.label}>
              <div className="section-label theme-rail-label">
                {group.label}
              </div>
              <div className="theme-rail-wrap">
                <div
                  className="theme-rail"
                  role="radiogroup"
                  aria-label={`${group.label} themes`}
                >
                  {group.themes.map((theme) => {
                    const selected = theme.id === themeId;
                    return (
                      <label
                        className={`theme-option ${selected ? "selected" : ""}`}
                        key={theme.id}
                      >
                        <input
                          checked={selected}
                          name="theme"
                          onChange={() => selectTheme(theme.id)}
                          type="radio"
                          value={theme.id}
                        />
                        <ThemePreview theme={theme} />
                        <span className="theme-option-foot">
                          <span className="theme-option-copy">
                            <strong>{theme.name}</strong>
                          </span>
                          <span
                            className={`status ${
                              selected ? "status-good" : "status-quiet"
                            }`}
                          >
                            {selected
                              ? "Active"
                              : theme.appearance === "system"
                                ? "Automatic"
                                : theme.appearance}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <span aria-hidden="true" className="theme-rail-fade" />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section
        className="text-size-settings"
        aria-labelledby="text-size-heading"
      >
        <div className="section-heading">
          <div className="section-label" id="text-size-heading">
            Text size
          </div>
          <p>Applies across the whole app.</p>
        </div>
        <div className="size-options" role="radiogroup" aria-label="Text size">
          {textSizes.map((size) => {
            const selected = size.id === textSize;
            return (
              <label
                className={`size-option ${selected ? "selected" : ""}`}
                key={size.id}
              >
                <input
                  checked={selected}
                  name="text-size"
                  onChange={() => selectTextSize(size.id)}
                  type="radio"
                  value={size.id}
                />
                {size.name}
              </label>
            );
          })}
        </div>
      </section>
    </Page>
  );
}

function ThemePreview({ theme }: { readonly theme: ThemeDefinition }) {
  return (
    <span
      className={`theme-preview ${theme.glass ? "glassy" : ""}`}
      style={themePreviewStyle(theme)}
    >
      <span className="theme-preview-chrome">
        <i />
        <i />
        <i />
      </span>
      <span className="theme-preview-body">
        <strong>Inbox.</strong>
        <span className="theme-preview-line" />
        <span className="theme-preview-row">
          <i />
          <span />
          <b>Review</b>
        </span>
        <span className="theme-preview-button">New recipe</span>
      </span>
    </span>
  );
}

function themePreviewStyle(theme: ThemeDefinition): CSSProperties {
  return {
    "--preview-bg": theme.preview.bg,
    "--preview-fg": theme.preview.fg,
    "--preview-accent": theme.preview.accent,
    "--preview-ok": theme.preview.ok,
    "--preview-warn": theme.preview.warn,
    "--preview-danger": theme.preview.danger,
  } as CSSProperties;
}

function ConnectedRow({
  detail,
  disabled,
  onDisconnect,
  actionLabel = "Disconnect",
}: {
  readonly detail: string;
  readonly disabled: boolean;
  readonly onDisconnect: () => void;
  readonly actionLabel?: string;
}) {
  return (
    <div className="connected-row">
      <span>
        <i aria-hidden="true" />
        {detail}
      </span>
      <button
        className="quiet-button"
        disabled={disabled}
        onClick={onDisconnect}
        type="button"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function Page({
  children,
  narrow = false,
}: {
  readonly children: ReactNode;
  readonly narrow?: boolean;
}) {
  return <div className={`page ${narrow ? "narrow" : ""}`}>{children}</div>;
}

function FilterControl({
  label,
  on,
  open,
  setOpen,
  children,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  return (
    <span className="filter-wrap">
      <button
        aria-expanded={open}
        aria-label={label}
        className="icon-button"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <SlidersIcon />
        {on ? <i className="filter-on-dot" /> : null}
      </button>
      {open ? (
        <>
          <button
            aria-label="Close filters"
            className="enable-backdrop"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div className="filter-panel">{children}</div>
        </>
      ) : null}
    </span>
  );
}

function PageHeading({
  eyebrow,
  title,
  action,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <div className="section-label">{eyebrow}</div> : null}
        <h1 className="display-title">{title}</h1>
      </div>
      {action}
    </div>
  );
}

function ChatContextButton({
  entry,
  className = "quiet-button",
  label = "Ask Springroll",
}: {
  readonly entry: ChatSessionEntryDto;
  readonly className?: string;
  readonly label?: string;
}) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const session = await api.enterChat(entry);
      navigate(`/chat/${encodeURIComponent(session.id)}`);
    } catch (error) {
      window.alert(errorMessage(error));
      setStarting(false);
    }
  };

  return (
    <button
      className={className}
      disabled={starting}
      onClick={() => void start()}
      type="button"
    >
      {starting ? "Opening chat…" : label}
    </button>
  );
}

function ConversationEntryPage({
  entry,
  backTo,
}: {
  readonly entry: ChatSessionEntryDto;
  readonly backTo: string;
}) {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<unknown>();

  const open = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setError(undefined);
    try {
      const session = await api.enterChat(entry);
      navigate(`/chat/${encodeURIComponent(session.id)}`, { replace: true });
    } catch (caught) {
      setError(caught);
    }
  }, [entry, navigate]);

  useEffect(() => void open(), [open]);

  return (
    <Page narrow>
      <BackLink to={backTo}>Back</BackLink>
      <PageHeading title="Opening Springroll…" />
      {!error ? <LoadingLine /> : null}
      {error ? (
        <ErrorNotice
          error={error}
          retry={async () => {
            started.current = false;
            await open();
          }}
        />
      ) : null}
    </Page>
  );
}

function BackLink({
  to,
  children,
}: {
  readonly to: string;
  readonly children: ReactNode;
}) {
  return (
    <Link className="back-link" to={to}>
      ‹ {children}
    </Link>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action: ReactNode;
}) {
  return (
    <section className="empty-state">
      <span className="empty-orbit" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}

function LoadingLine() {
  return <div className="loading-line" aria-label="Loading" role="status" />;
}

function ErrorNotice({
  error,
  retry,
  action,
}: {
  readonly error: unknown;
  readonly retry?: () => Promise<unknown>;
  readonly action?: ReactNode;
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
      ) : (
        action
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useLoad<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await load();
      setValue(result);
      return result;
    } catch (caught) {
      setError(caught);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { value, error, loading, reload, setError };
}

type RunFeedEntry =
  | { readonly kind: "run"; readonly run: RunSummaryDto }
  | {
      readonly kind: "aggregate";
      readonly key: string;
      readonly taskName: string;
      readonly count: number;
      readonly summary: string;
    };

interface RunFeedDay {
  readonly key: string;
  readonly label: string;
  readonly items: readonly RunFeedEntry[];
}

function buildRunFeed(runs: readonly RunSummaryDto[]): readonly RunFeedDay[] {
  const groups = new Map<string, RunSummaryDto[]>();
  for (const run of runs) {
    const day = dayKey(run.scheduledTime);
    const dayRuns = groups.get(day) ?? [];
    dayRuns.push(run);
    groups.set(day, dayRuns);
  }

  const feed: RunFeedDay[] = [];
  for (const [day, dayRuns] of groups) {
    const items: RunFeedEntry[] = [];
    const quiet = new Map<string, RunSummaryDto[]>();

    for (const run of dayRuns) {
      if (isQuietRun(run)) {
        const taskRuns = quiet.get(run.taskId) ?? [];
        taskRuns.push(run);
        quiet.set(run.taskId, taskRuns);
      } else {
        items.push({ kind: "run", run });
      }
    }

    for (const [taskId, taskRuns] of quiet) {
      if (taskRuns.length === 1) {
        const onlyRun = taskRuns[0];
        if (onlyRun) {
          items.push({ kind: "run", run: onlyRun });
        }
      } else {
        const first = taskRuns[0];
        if (first) {
          items.push({
            kind: "aggregate",
            key: `${day}-${taskId}`,
            taskName: first.taskName,
            count: taskRuns.length,
            summary: first.summary ?? "nothing needed attention",
          });
        }
      }
    }

    feed.push({
      key: day,
      label: formatDay(dayRuns[0]?.scheduledTime ?? day),
      items,
    });
  }

  return feed;
}

function runRowTitle(run: RunSummaryDto): string {
  return run.summary ?? run.taskName;
}

function runRowSub(run: RunSummaryDto): string | undefined {
  if (run.status === "waiting_for_approval") {
    return "Approval required";
  }
  if (run.status === "failed" && run.error) {
    return run.error;
  }
  return runRowTitle(run) === run.taskName ? undefined : run.taskName;
}

function trailDotClass(status: RunSummaryDto["status"]): string {
  return {
    claimed: "",
    running: "live",
    waiting_for_approval: "attention",
    succeeded: "ok",
    failed: "bad",
  }[status];
}

function formatNextRun(value: string): string {
  const next = new Date(value);
  const now = new Date();
  const time = formatTime(value);
  const dayOf = (date: Date) => date.toDateString();
  if (dayOf(next) === dayOf(now)) {
    return `${time} today`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (dayOf(next) === dayOf(tomorrow)) {
    return `${time} tomorrow`;
  }
  return `${time} ${next.toLocaleDateString(undefined, { weekday: "short" })}`;
}

function runDotClass(run: RunSummaryDto): string {
  if (run.status === "failed") {
    return "bad";
  }
  if (run.needsAttention) {
    return "attention";
  }
  return {
    claimed: "waiting",
    running: "live",
    waiting_for_approval: "attention",
    succeeded: "ok",
    failed: "bad",
  }[run.status];
}

function isQuietRun(run: RunSummaryDto): boolean {
  const summary = run.summary?.toLowerCase() ?? "";
  return (
    run.status === "succeeded" &&
    (summary.includes("nothing") ||
      summary.includes("no new") ||
      summary.includes("no action"))
  );
}

function dayKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function humanStatus(status: RunSummaryDto["status"]): string {
  return {
    claimed: "Waiting",
    running: "Running",
    waiting_for_approval: "Waiting for approval",
    succeeded: "Finished",
    failed: "Needs attention",
  }[status];
}

function runStatusClass(status: RunSummaryDto["status"]): string {
  return {
    claimed: "status-quiet",
    running: "status-running",
    waiting_for_approval: "status-needs-you",
    succeeded: "status-good",
    failed: "status-needs-you",
  }[status];
}

function runCostLabel(run: RunDetailDto): string | undefined {
  if (run.modelBilling === "subscription") {
    return "Subscription usage";
  }
  const cost =
    run.actualCostUsdMicros ?? run.estimatedCostUsdMicros ?? run.costUsdMicros;
  if (cost === undefined) {
    return undefined;
  }
  const qualifier =
    run.actualCostUsdMicros !== undefined ||
    run.costSource === "provider_reported"
      ? "actual"
      : "estimated";
  return `${formatUsdMicros(cost)} ${qualifier}`;
}

function formatUsdMicros(value: number): string {
  const dollars = value / 1_000_000;
  return `$${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}

function modelValue(selection: ModelSelectionDto): string {
  return `${selection.providerId}::${selection.modelId}`;
}

function groupModels(
  models: readonly ModelOptionDto[],
): ReadonlyMap<ModelProviderId, readonly ModelOptionDto[]> {
  const grouped = new Map<ModelProviderId, ModelOptionDto[]>();
  for (const model of models) {
    const options = grouped.get(model.providerId) ?? [];
    options.push(model);
    grouped.set(model.providerId, options);
  }
  return grouped;
}

function providerName(providerId: ModelProviderId): string {
  if (providerId === "openrouter") return "OpenRouter";
  if (providerId === "openai") return "OpenAI";
  return "xAI";
}

function defaultModelLabel(
  configuration: ModelSettingsDto | undefined,
): string {
  if (!configuration?.defaultSelection) return "App default · Automatic";
  const selected = configuration.models.find(
    (model) =>
      model.providerId === configuration.defaultSelection?.providerId &&
      model.modelId === configuration.defaultSelection.modelId,
  );
  return selected
    ? `App default · ${selected.name}`
    : "App default · Automatic";
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPrice(value: number): string {
  return value < 0.01
    ? value.toFixed(4)
    : value < 1
      ? value.toFixed(2)
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDay(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Today · ${new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date)}`;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1_000).toFixed(1)} sec`;
}

function modelIngredient(
  override: TaskSummaryDto["modelOverride"],
  configuration: ModelSettingsDto | undefined,
): string {
  if (!override) {
    return "App default model";
  }
  const match = configuration?.models.find(
    (model) =>
      model.providerId === override.providerId &&
      model.modelId === override.modelId,
  );
  return match?.name ?? override.modelId;
}

function describeSchedule(schedule: string): string {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule);
  if (!match) {
    return schedule;
  }
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  const at = new Date(2000, 0, 1, hour, minute);
  return `Daily at ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(at)}`;
}
