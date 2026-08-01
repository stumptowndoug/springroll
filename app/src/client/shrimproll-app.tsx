import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
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
} from "react-router-dom";
import type {
  ConnectionCardDto,
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
  TaskSummaryDto,
} from "../shared.ts";
import { api } from "./api.ts";
import { PlayIcon, PlusIcon } from "./icons.tsx";
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

export function ShrimpRollApp() {
  return (
    <div className="app-frame">
      <header className="titlebar">
        <Link className="brand" to="/inbox" aria-label="ShrimpRoll home">
          <BrandLogo />
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/inbox">Inbox</NavLink>
          <NavLink to="/recipes">Recipes</NavLink>
          <NavLink to="/integrations">Integrations</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="/inbox" element={<RunsPage />} />
          <Route path="/inbox/:id" element={<RunDetailPage />} />
          <Route path="/recipes" element={<TasksPage />} />
          <Route path="/recipes/new" element={<NewTaskPage />} />
          <Route path="/recipes/:id" element={<TaskDetailPage />} />
          {/* Legacy paths keep old links working */}
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/new" element={<NewTaskPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route
            path="/integrations"
            element={<Navigate to="/integrations/models" replace />}
          />
          <Route
            path="/integrations/models"
            element={<ModelIntegrationsPage />}
          />
          <Route
            path="/integrations/web-search"
            element={<WebSearchIntegrationsPage />}
          />
          <Route path="/integrations/mcps" element={<McpIntegrationsPage />} />
          <Route
            path="/integrations/custom"
            element={<CustomIntegrationsPage />}
          />
          <Route
            path="/models"
            element={<Navigate to="/integrations/models" replace />}
          />
          <Route
            path="/connections"
            element={<Navigate to="/integrations/mcps" replace />}
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function RunsPage() {
  const runs = useLoad(api.runs);
  const feed = useMemo(
    () => (runs.value ? buildRunFeed(runs.value) : []),
    [runs.value],
  );
  return (
    <Page>
      <PageHeading
        title="Inbox."
        action={
          <Link className="button primary" to="/recipes/new">
            <PlusIcon />
            New recipe
          </Link>
        }
      />
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

  return (
    <Page>
      <BackLink to="/inbox">Inbox</BackLink>
      {run.loading ? <LoadingLine /> : null}
      {run.error ? <ErrorNotice error={run.error} retry={run.reload} /> : null}
      {run.value ? (
        <>
          <RunLetter events={events} run={run.value} />
          {run.value.status === "succeeded" || run.value.status === "failed" ? (
            <div className="record-actions">
              <button
                className="text-action danger-action"
                disabled={deleting}
                onClick={deleteRun}
                type="button"
              >
                {deleting ? "Deleting…" : "Delete this run"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

function RunLetter({
  run,
  events,
}: {
  readonly run: RunDetailDto;
  readonly events: readonly RunEventDto[];
}) {
  const active = run.status === "claimed" || run.status === "running";
  const body =
    run.result?.body.content ??
    run.body ??
    run.error ??
    (active
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
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string>();
  const [menuTaskId, setMenuTaskId] = useState<string>();

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
          <Link className="button primary" to="/recipes/new">
            <PlusIcon />
            New recipe
          </Link>
        }
      />
      {tasks.loading ? <LoadingLine /> : null}
      {tasks.error ? (
        <ErrorNotice error={tasks.error} retry={tasks.reload} />
      ) : null}
      {!tasks.loading && tasks.value?.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          body="Describe one useful thing and ShrimpRoll will turn it into a recipe."
          action={
            <Link className="text-action" to="/recipes/new">
              Describe a recipe
            </Link>
          }
        />
      ) : null}
      <div className="recipe-grid">
        {tasks.value?.map((task) => (
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
            <p className="recipe-ask">{task.prompt}</p>
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
                        setMenuTaskId(
                          menuTaskId === task.id ? undefined : task.id,
                        )
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
        ))}
      </div>
    </Page>
  );
}

function TaskDetailPage() {
  const { id = "" } = useParams();
  const task = useLoad(useCallback(() => api.task(id), [id]));
  const execution = useLoad(useCallback(() => api.taskExecution(id), [id]));
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
    <Page narrow>
      <BackLink to="/recipes">Recipes</BackLink>
      {task.loading ? <LoadingLine /> : null}
      {task.error ? (
        <ErrorNotice error={task.error} retry={task.reload} />
      ) : null}
      {task.value ? (
        <article className="task-detail">
          <div className="task-detail-heading">
            <div>
              <div
                className={`status ${
                  task.value.enabled ? "status-good" : "status-quiet"
                }`}
              >
                {task.value.enabled ? "Scheduled" : "Paused"}
              </div>
              <h1 className="display-title">{task.value.name}</h1>
            </div>
            <button
              className="button primary"
              disabled={busy || execution.loading || Boolean(execution.error)}
              onClick={runNow}
              type="button"
            >
              Run now
            </button>
          </div>
          <blockquote>{task.value.prompt}</blockquote>
          <dl className="detail-grid">
            <div>
              <dt>Schedule</dt>
              <dd>
                {describeSchedule(task.value.schedule)}
                <small>{task.value.timezone}</small>
              </dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>{task.value.connectionNames.join(", ")}</dd>
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
                <small>
                  Choose a model just for this task, or keep the app default.
                </small>
                {execution.loading ? <LoadingLine /> : null}
                {execution.error ? (
                  <small className="execution-error">
                    {errorMessage(execution.error)}
                  </small>
                ) : null}
                {execution.value && !execution.error ? (
                  <ModelExecutionPreview
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
            <div>
              <dt>Next run</dt>
              <dd>{formatFullDate(task.value.nextRunAt)}</dd>
            </div>
          </dl>
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
                    Your Mac runs it first; ShrimpRoll Cloud covers when it is
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
              Delete this task
            </button>
          </div>
        </article>
      ) : null}
    </Page>
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
    setOutcome({ status: "ready", proposal: updated });
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
            <Link className="text-action" to="/integrations/models">
              Check Integrations
            </Link>
          }
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
            This task runs on this Mac. ShrimpRoll will ask again before any
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
  return (
    <section className="proposal unavailable-proposal" role="status">
      <div className="section-label">
        {needsIntegration ? "Needs an integration" : "Not supported yet"}
      </div>
      <h2>{outcome.title}</h2>
      <p>{outcome.explanation}</p>
      {needsIntegration ? (
        <div className="proposal-chips">
          <span>{outcome.missingCapability}</span>
          {outcome.suggestedIntegration ? (
            <span>{outcome.suggestedIntegration}</span>
          ) : null}
        </div>
      ) : null}
      {outcome.supportedAlternative ? (
        <div className="supported-alternative">
          <span>What ShrimpRoll can do</span>
          <p>{outcome.supportedAlternative}</p>
        </div>
      ) : null}
      <div className="proposal-unavailable-foot">
        <span>Revise the request above to try a narrower version.</span>
        {needsIntegration ? (
          <Link className="text-action" to="/integrations/custom">
            Review integrations
          </Link>
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
      <PageHeading title="Integrations." />
      <IntegrationTabs />
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
            <div>
              <div className="section-label">App default</div>
              <h2>Model for new and existing tasks</h2>
              <p>
                Automatic chooses an available provider at run time. Tasks can
                override this from their detail page.
              </p>
            </div>
            <ModelPicker
              disabled={busy !== undefined}
              inheritLabel="Automatic"
              models={configuration.value.models}
              onChange={updateDefault}
              value={configuration.value.defaultSelection}
            />
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
            ShrimpRoll stores only a Keychain reference in its database. Local
            keys are never copied to Turso or a hosted runner automatically;
            cloud access will require a separate, explicit secret setup.
          </p>
        </>
      ) : null}
    </Page>
  );
}

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
  return (
    <section className="provider-card">
      <div className="provider-heading">
        <span>
          <h2>{provider.name}</h2>
          <small>
            {provider.kind === "aggregator" ? "Aggregator" : "Direct API"}
          </small>
        </span>
        <span
          className={`connection-status status ${
            provider.status === "connected"
              ? "status-connected"
              : "status-quiet"
          }`}
        >
          {provider.status === "connected" ? "Connected" : "Not connected"}
        </span>
      </div>
      {provider.status === "connected" ? (
        <ConnectedRow
          detail="Available on this Mac"
          disabled={busy !== undefined}
          onDisconnect={onDisconnect}
        />
      ) : (
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            onConnect();
          }}
        >
          <label>
            API key
            <input
              autoComplete="off"
              onChange={(event) => onKeyChange(event.target.value)}
              placeholder={provider.keyPlaceholder}
              type="password"
              value={value}
            />
          </label>
          <div className="form-actions">
            <a
              className="text-action"
              href={provider.keyCreationUrl}
              rel="noreferrer"
              target="_blank"
            >
              Get an API key
            </a>
            <button
              className="button primary"
              disabled={!value || busy !== undefined}
              type="submit"
            >
              {busy === provider.id ? "Checking…" : "Connect"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ModelPicker({
  models,
  value,
  inheritLabel,
  disabled,
  onChange,
}: {
  readonly models: readonly ModelOptionDto[];
  readonly value: ModelSelectionDto | undefined;
  readonly inheritLabel: string;
  readonly disabled: boolean;
  readonly onChange: (selection: ModelSelectionDto | null) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedValue = value ? modelValue(value) : "";
  const selected = value
    ? models.find(
        (model) =>
          model.providerId === value.providerId &&
          model.modelId === value.modelId,
      )
    : undefined;
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

  return (
    <div className="model-picker">
      {models.length > 20 ? (
        <input
          aria-label="Search models"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${models.length} available models`}
          type="search"
          value={query}
        />
      ) : null}
      <select
        aria-label="AI model"
        disabled={disabled || models.length === 0}
        onChange={(event) => onChange(parseModelValue(event.target.value))}
        value={selectedValue}
      >
        <option value="">{inheritLabel}</option>
        {visibleModels.length === 0 ? (
          <option disabled>No matching models</option>
        ) : null}
        {[...grouped.entries()].map(([providerId, options]) => (
          <optgroup key={providerId} label={providerName(providerId)}>
            {options.map((model) => (
              <option key={modelValue(model)} value={modelValue(model)}>
                {model.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected ? <ModelFacts model={selected} /> : null}
      {models.length === 0 ? (
        <small>Connect an AI provider to choose a model.</small>
      ) : null}
    </div>
  );
}

function ModelFacts({ model }: { readonly model: ModelOptionDto }) {
  const facts = [
    model.reasoning ? "Reasoning" : undefined,
    model.toolCall ? "Tools" : undefined,
    model.contextTokens
      ? `${compactNumber(model.contextTokens)} context`
      : undefined,
    model.inputUsdPerMillionTokens === undefined
      ? undefined
      : `$${formatPrice(model.inputUsdPerMillionTokens)} in`,
    model.outputUsdPerMillionTokens === undefined
      ? undefined
      : `$${formatPrice(model.outputUsdPerMillionTokens)} out`,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="model-facts">
      {facts.map((fact) => (
        <span key={fact}>{fact}</span>
      ))}
    </div>
  );
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

function IntegrationTabs() {
  return (
    <nav className="integration-tabs" aria-label="Integration categories">
      <NavLink to="/integrations/models">Models</NavLink>
      <NavLink to="/integrations/web-search">Web Search</NavLink>
      <NavLink to="/integrations/mcps">MCPs</NavLink>
      <NavLink to="/integrations/custom">Custom</NavLink>
    </nav>
  );
}

function WebSearchIntegrationsPage() {
  const connections = useLoad(api.connections);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string>();
  const [webSearchKey, setWebSearchKey] = useState("");

  const perform = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError(undefined);
    try {
      await action();
      setWebSearchKey("");
      await connections.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  const cards = new Map(connections.value?.map((card) => [card.id, card]));
  const webSearch = cards.get("web-search");
  const upcoming = [
    "google-search",
    "tavily",
    "parallel",
    "firecrawl",
  ] as const;

  return (
    <Page>
      <PageHeading title="Integrations." />
      <IntegrationTabs />
      <p className="page-intro">
        Every model can use ShrimpRoll’s built-in Exa search. Add a personal key
        only when you want your own limits and account.
      </p>
      {connections.loading ? <LoadingLine /> : null}
      {connections.error ? (
        <ErrorNotice error={connections.error} retry={connections.reload} />
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="connection-grid">
        <ConnectionCard card={webSearch}>
          {webSearch?.credentialConfigured ? (
            <ConnectedRow
              actionLabel="Remove key"
              detail="Personal API key active · free fallback remains available"
              disabled={busy !== undefined}
              onDisconnect={() =>
                perform("web-search", api.disconnectWebSearch)
              }
            />
          ) : (
            <>
              <p className="integration-note">
                Free search and page reading are active with no setup.
              </p>
              <details className="integration-optional">
                <summary>Add your own Exa key</summary>
                <form
                  className="connection-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform("web-search", () =>
                      api.connectWebSearch(webSearchKey),
                    );
                  }}
                >
                  <label>
                    Exa API key
                    <input
                      autoComplete="off"
                      onChange={(event) => setWebSearchKey(event.target.value)}
                      placeholder="Stored in Keychain"
                      type="password"
                      value={webSearchKey}
                    />
                  </label>
                  <div className="form-actions">
                    {webSearch?.keyCreationUrl ? (
                      <a
                        className="text-action"
                        href={webSearch.keyCreationUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Create an Exa key
                      </a>
                    ) : null}
                    <button
                      className="button primary"
                      disabled={!webSearchKey.trim() || busy !== undefined}
                      type="submit"
                    >
                      {busy === "web-search" ? "Checking key…" : "Add key"}
                    </button>
                  </div>
                </form>
              </details>
            </>
          )}
        </ConnectionCard>
        {upcoming.map((id) => (
          <ConnectionCard card={cards.get(id)} key={id}>
            <p className="coming-soon">Additional search backend · planned</p>
          </ConnectionCard>
        ))}
      </div>
    </Page>
  );
}

function McpIntegrationsPage() {
  const connections = useLoad(api.connections);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string>();
  const [neonUrl, setNeonUrl] = useState("");
  const [neonToken, setNeonToken] = useState("");
  const neon = connections.value?.find((card) => card.id === "neon");

  useEffect(() => {
    if (neon?.endpoint && !neonUrl) {
      setNeonUrl(neon.endpoint);
    }
  }, [neon?.endpoint, neonUrl]);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy("neon");
    setError(undefined);
    try {
      await action();
      setNeonToken("");
      await connections.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Page>
      <PageHeading title="Integrations." />
      <IntegrationTabs />
      <p className="page-intro">
        Connect audited MCP servers here. ShrimpRoll pins only the tools a task
        is allowed to use.
      </p>
      {connections.loading ? <LoadingLine /> : null}
      {connections.error ? (
        <ErrorNotice error={connections.error} retry={connections.reload} />
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="connection-grid">
        <ConnectionCard card={neon}>
          {neon?.status === "connected" ? (
            <ConnectedRow
              detail={`${neon.toolCount ?? 0} MCP tools available`}
              disabled={busy !== undefined}
              onDisconnect={() => perform(api.disconnectNeon)}
            />
          ) : (
            <form
              className="connection-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(() => api.connectNeon(neonUrl, neonToken));
              }}
            >
              <label>
                MCP endpoint
                <input
                  onChange={(event) => setNeonUrl(event.target.value)}
                  placeholder="https://…"
                  type="url"
                  value={neonUrl}
                />
              </label>
              <label>
                Access token <small>optional</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setNeonToken(event.target.value)}
                  placeholder="Stored in Keychain"
                  type="password"
                  value={neonToken}
                />
              </label>
              <button
                className="button primary"
                disabled={!neonUrl || busy !== undefined}
                type="submit"
              >
                {busy === "neon" ? "Checking tools…" : "Connect"}
              </button>
            </form>
          )}
        </ConnectionCard>
      </div>
    </Page>
  );
}

function CustomIntegrationsPage() {
  const connections = useLoad(api.connections);
  const gmail = connections.value?.find((card) => card.id === "gmail");
  const customApi = connections.value?.find((card) => card.id === "custom-api");

  return (
    <Page>
      <PageHeading title="Integrations." />
      <IntegrationTabs />
      <p className="page-intro">
        Curated service templates and small custom APIs will live here when they
        can share the same permissions and run history as every other tool.
      </p>
      {connections.loading ? <LoadingLine /> : null}
      {connections.error ? (
        <ErrorNotice error={connections.error} retry={connections.reload} />
      ) : null}
      <div className="connection-grid">
        <ConnectionCard card={gmail}>
          <p className="coming-soon">Read-only access · next phase</p>
        </ConnectionCard>
        <ConnectionCard card={customApi}>
          <p className="coming-soon">OpenAPI and templates · planned</p>
        </ConnectionCard>
      </div>
    </Page>
  );
}

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
        A theme is two master colors on a ground pair. Status stays in the dots.
      </p>
      <section className="theme-settings" aria-labelledby="theme-heading">
        <div className="section-heading">
          <div className="section-label" id="theme-heading">
            Theme
          </div>
          <p>Your choice is saved only on this device.</p>
        </div>
        <div className="theme-grid" role="radiogroup" aria-label="App theme">
          {builtInThemes.map((theme) => {
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
                    <small>{theme.description}</small>
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
    <span className="theme-preview" style={themePreviewStyle(theme)}>
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

function ConnectionCard({
  card,
  children,
}: {
  readonly card: ConnectionCardDto | undefined;
  readonly children: ReactNode;
}) {
  if (!card) {
    return null;
  }

  return (
    <section className="connection-card">
      <div className="connection-heading">
        <div>
          <h2>{card.name}</h2>
          <p>{card.description}</p>
        </div>
        <span
          className={`connection-status status ${
            card.status === "connected" ? "status-connected" : "status-quiet"
          }`}
        >
          {card.status === "connected"
            ? "Connected"
            : card.status === "coming_soon"
              ? "Soon"
              : "Not connected"}
        </span>
      </div>
      {children}
    </section>
  );
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
  if (run.status === "failed" && run.error) {
    return run.error;
  }
  return runRowTitle(run) === run.taskName ? undefined : run.taskName;
}

function trailDotClass(status: RunSummaryDto["status"]): string {
  return {
    claimed: "",
    running: "live",
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
    succeeded: "Finished",
    failed: "Needs attention",
  }[status];
}

function runStatusClass(status: RunSummaryDto["status"]): string {
  return {
    claimed: "status-quiet",
    running: "status-running",
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

function parseModelValue(value: string): ModelSelectionDto | null {
  if (!value) return null;
  const separator = value.indexOf("::");
  if (separator < 1) return null;
  const providerId = value.slice(0, separator);
  if (
    providerId !== "openrouter" &&
    providerId !== "openai" &&
    providerId !== "xai"
  ) {
    return null;
  }
  return {
    providerId,
    modelId: value.slice(separator + 2),
  };
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
