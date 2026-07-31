import {
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
  ModelOptionDto,
  ModelProviderDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelSettingsDto,
  RunDetailDto,
  RunSummaryDto,
  TaskProposalDto,
  TaskSummaryDto,
} from "../shared.ts";
import { api } from "./api.ts";
import { RunMarkdown } from "./run-markdown.tsx";

export function ShrimpRollApp() {
  return (
    <div className="app-frame">
      <header className="titlebar">
        <Link className="brand" to="/runs" aria-label="ShrimpRoll home">
          <span className="brand-mark" aria-hidden="true" />
          ShrimpRoll
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/runs">Runs</NavLink>
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/models">Models</NavLink>
          <NavLink to="/connections">Connections</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/runs" replace />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/new" element={<NewTaskPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="*" element={<Navigate to="/runs" replace />} />
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
  const attention = runs.value?.filter((run) => run.needsAttention) ?? [];

  return (
    <Page>
      <PageHeading
        eyebrow="What happened"
        title="Runs"
        action={
          <Link className="button primary" to="/tasks/new">
            New task
          </Link>
        }
      />
      {runs.loading ? <LoadingLine /> : null}
      {runs.error ? (
        <ErrorNotice error={runs.error} retry={runs.reload} />
      ) : null}
      {attention.length > 0 ? (
        <section className="attention-stack" aria-label="Needs your attention">
          <div className="section-label">Needs you</div>
          {attention.map((run) => (
            <Link
              className="attention-card"
              to={`/runs/${run.id}`}
              key={run.id}
            >
              <span className="attention-dot" />
              <span>
                <strong>{run.taskName} needs attention</strong>
                <small>{run.error ?? "The run did not finish."}</small>
              </span>
              <b>Review</b>
            </Link>
          ))}
        </section>
      ) : null}
      {!runs.loading && runs.value?.length === 0 ? (
        <EmptyState
          title="No runs yet"
          body="Create a task, try it once, and its note will appear here."
          action={
            <Link className="text-action" to="/tasks/new">
              Create the first task
            </Link>
          }
        />
      ) : null}
      <div className="run-feed">
        {feed.map((item) =>
          item.kind === "day" ? (
            <div className="day-heading" key={item.key}>
              {item.label}
            </div>
          ) : item.kind === "aggregate" ? (
            <div className="run-row aggregate" key={item.key}>
              <time />
              <strong>
                {item.taskName} ran {item.count}×
              </strong>
              <span>{item.summary}</span>
            </div>
          ) : (
            <Link
              className="run-row"
              to={`/runs/${item.run.id}`}
              key={item.run.id}
            >
              <time>{formatTime(item.run.scheduledTime)}</time>
              <strong>{item.run.taskName}</strong>
              <span>{runOutcome(item.run)}</span>
              <i aria-hidden="true">›</i>
            </Link>
          ),
        )}
      </div>
    </Page>
  );
}

function RunDetailPage() {
  const { id = "" } = useParams();
  const run = useLoad(useCallback(() => api.run(id), [id]));

  return (
    <Page narrow>
      <BackLink to="/runs">Runs</BackLink>
      {run.loading ? <LoadingLine /> : null}
      {run.error ? <ErrorNotice error={run.error} retry={run.reload} /> : null}
      {run.value ? <RunLetter run={run.value} /> : null}
    </Page>
  );
}

function RunLetter({ run }: { readonly run: RunDetailDto }) {
  const body =
    run.result?.body.content ??
    run.body ??
    run.error ??
    "This run has not produced a note yet.";
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
      <h1>{run.taskName}</h1>
      <p className="letter-subtitle">
        {run.executionLocation === "local"
          ? "Ran on this Mac"
          : "Ran while this Mac was away"}
        {" · "}
        {humanStatus(run.status)}
      </p>
      <div className="letter-body">
        <RunMarkdown content={body} />
      </div>
      <footer className="mechanics">
        {primaryMechanics.length > 0 ? (
          <div>{primaryMechanics.join(" · ")}</div>
        ) : null}
        <small>{detailMechanics.join(" · ")}</small>
      </footer>
    </article>
  );
}

function TasksPage() {
  const tasks = useLoad(api.tasks);
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string>();

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
      navigate(`/runs/${run.id}`);
    } catch (error) {
      tasks.setError(error);
      setBusyId(undefined);
    }
  };

  return (
    <Page>
      <PageHeading
        eyebrow="What should happen"
        title="Tasks"
        action={
          <Link className="button primary" to="/tasks/new">
            New task
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
          body="Describe one useful thing and ShrimpRoll will turn it into a proposal."
          action={
            <Link className="text-action" to="/tasks/new">
              Describe a task
            </Link>
          }
        />
      ) : null}
      <div className="task-list">
        {tasks.value?.map((task) => (
          <article
            className={`task-card ${task.enabled ? "" : "paused"}`}
            key={task.id}
          >
            <Link className="task-copy" to={`/tasks/${task.id}`}>
              <span className="status-dot" aria-hidden="true" />
              <span>
                <strong>{task.name}</strong>
                <small>
                  {describeSchedule(task.schedule)} ·{" "}
                  {task.connectionNames.join(", ")}
                </small>
              </span>
            </Link>
            <div className="row-actions">
              <button
                className="quiet-button"
                disabled={busyId === task.id}
                onClick={() => runNow(task)}
                type="button"
              >
                Run now
              </button>
              <button
                className="quiet-button"
                disabled={busyId === task.id}
                onClick={() => toggleTask(task)}
                type="button"
              >
                {task.enabled ? "Pause" : "Enable"}
              </button>
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
  const models = useLoad(api.models);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const update = async (input: Parameters<typeof api.updateTask>[1]) => {
    setBusy(true);
    try {
      await api.updateTask(id, input);
      await task.reload();
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
      navigate(`/runs/${run.id}`);
    } catch (error) {
      task.setError(error);
      setBusy(false);
    }
  };

  return (
    <Page narrow>
      <BackLink to="/tasks">Tasks</BackLink>
      {task.loading ? <LoadingLine /> : null}
      {task.error ? (
        <ErrorNotice error={task.error} retry={task.reload} />
      ) : null}
      {task.value ? (
        <article className="task-detail">
          <div className="task-detail-heading">
            <div>
              <div className="section-label">
                {task.value.enabled ? "Scheduled" : "Paused"}
              </div>
              <h1>{task.value.name}</h1>
            </div>
            <button
              className="button primary"
              disabled={busy}
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
          <button
            className="text-action"
            disabled={busy}
            onClick={() => update({ enabled: !task.value?.enabled })}
            type="button"
          >
            {task.value.enabled ? "Pause this task" : "Enable this task"}
          </button>
        </article>
      ) : null}
    </Page>
  );
}

function NewTaskPage() {
  const navigate = useNavigate();
  const [sentence, setSentence] = useState("");
  const [proposal, setProposal] = useState<TaskProposalDto>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<"propose" | "run" | "schedule">();

  const propose = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("propose");
    setError(undefined);
    try {
      setProposal(
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
        navigate(`/runs/${run.id}`);
      } else {
        navigate(`/tasks/${task.id}`);
      }
    } catch (caught) {
      setError(caught);
      setBusy(undefined);
    }
  };

  return (
    <Page narrow>
      <BackLink to="/tasks">Tasks</BackLink>
      <PageHeading eyebrow="New task" title="What would you like handled?" />
      <form className="composer" onSubmit={propose}>
        <textarea
          aria-label="Describe the task"
          maxLength={2_000}
          onChange={(event) => {
            setSentence(event.target.value);
            setProposal(undefined);
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
            <Link className="text-action" to="/connections">
              Check Connections
            </Link>
          }
        />
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
          <details>
            <summary>Edit details</summary>
            <label>
              Schedule
              <input
                onChange={(event) =>
                  setProposal({ ...proposal, schedule: event.target.value })
                }
                value={proposal.schedule}
              />
            </label>
            <label>
              Timezone
              <input
                onChange={(event) =>
                  setProposal({ ...proposal, timezone: event.target.value })
                }
                value={proposal.timezone}
              />
            </label>
            <label>
              Instructions
              <textarea
                onChange={(event) =>
                  setProposal({ ...proposal, prompt: event.target.value })
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
              className="button secondary"
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

function ModelsPage() {
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
      <PageHeading eyebrow="How ShrimpRoll thinks" title="Models" />
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
        <span className={`connection-glyph ${provider.id}`} aria-hidden="true">
          {provider.name.slice(0, 1)}
        </span>
        <span>
          <h2>{provider.name}</h2>
          <small>
            {provider.kind === "aggregator" ? "Aggregator" : "Direct API"}
          </small>
        </span>
        <span className={`connection-status ${provider.status}`}>
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

function ConnectionsPage() {
  const connections = useLoad(api.connections);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string>();
  const [neonUrl, setNeonUrl] = useState("");
  const [neonToken, setNeonToken] = useState("");

  const refresh = async () => {
    setError(undefined);
    await connections.reload();
  };

  const perform = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError(undefined);
    try {
      await action();
      setNeonToken("");
      await refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  };

  const cards = new Map(connections.value?.map((card) => [card.id, card]));
  const neon = cards.get("neon");
  const gmail = cards.get("gmail");

  useEffect(() => {
    if (neon?.endpoint && !neonUrl) {
      setNeonUrl(neon.endpoint);
    }
  }, [neon?.endpoint, neonUrl]);

  return (
    <Page>
      <PageHeading eyebrow="What ShrimpRoll may use" title="Connections" />
      <p className="page-intro">
        Connections give tasks tools and data. AI providers and model choice
        live under Models; every secret stays in your Mac’s Keychain.
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
              onDisconnect={() => perform("neon", api.disconnectNeon)}
            />
          ) : (
            <form
              className="connection-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform("neon", () => api.connectNeon(neonUrl, neonToken));
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
        <ConnectionCard card={gmail}>
          <p className="coming-soon">Read-only access · next phase</p>
        </ConnectionCard>
      </div>
    </Page>
  );
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
        <span className={`connection-glyph ${card.id}`} aria-hidden="true">
          {card.name.slice(0, 1)}
        </span>
        <div>
          <h2>{card.name}</h2>
          <p>{card.description}</p>
        </div>
        <span className={`connection-status ${card.status}`}>
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
}: {
  readonly detail: string;
  readonly disabled: boolean;
  readonly onDisconnect: () => void;
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
        Disconnect
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
  readonly eyebrow: string;
  readonly title: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="section-label">{eyebrow}</div>
        <h1>{title}</h1>
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

type RunFeedItem =
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | { readonly kind: "run"; readonly run: RunSummaryDto }
  | {
      readonly kind: "aggregate";
      readonly key: string;
      readonly taskName: string;
      readonly count: number;
      readonly summary: string;
    };

function buildRunFeed(runs: readonly RunSummaryDto[]): readonly RunFeedItem[] {
  const feed: RunFeedItem[] = [];
  const groups = new Map<string, RunSummaryDto[]>();
  for (const run of runs) {
    const day = dayKey(run.scheduledTime);
    const dayRuns = groups.get(day) ?? [];
    dayRuns.push(run);
    groups.set(day, dayRuns);
  }

  for (const [day, dayRuns] of groups) {
    feed.push({
      kind: "day",
      key: day,
      label: formatDay(dayRuns[0]?.scheduledTime ?? day),
    });
    const quiet = new Map<string, RunSummaryDto[]>();

    for (const run of dayRuns) {
      if (isQuietRun(run)) {
        const taskRuns = quiet.get(run.taskId) ?? [];
        taskRuns.push(run);
        quiet.set(run.taskId, taskRuns);
      } else {
        feed.push({ kind: "run", run });
      }
    }

    for (const [taskId, taskRuns] of quiet) {
      if (taskRuns.length === 1) {
        const onlyRun = taskRuns[0];
        if (onlyRun) {
          feed.push({ kind: "run", run: onlyRun });
        }
      } else {
        const first = taskRuns[0];
        if (first) {
          feed.push({
            kind: "aggregate",
            key: `${day}-${taskId}`,
            taskName: first.taskName,
            count: taskRuns.length,
            summary: first.summary ?? "nothing needed attention",
          });
        }
      }
    }
  }

  return feed;
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

function runOutcome(run: RunSummaryDto): string {
  if (run.error) {
    return run.error;
  }
  if (run.summary) {
    return run.summary;
  }
  return humanStatus(run.status);
}

function humanStatus(status: RunSummaryDto["status"]): string {
  return {
    claimed: "Waiting",
    running: "Running",
    succeeded: "Finished",
    failed: "Needs attention",
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
