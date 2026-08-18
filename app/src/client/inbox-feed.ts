import {
  type ChatSessionDto,
  markdownPlainText,
  type RunSummaryDto,
} from "../shared.ts";
import { chatSessionTitle } from "./chat-session-entry.ts";

export type InboxView = "all" | "runs" | "chats";
export type InboxStatusFilter = "all" | "sent" | "needs_you" | "failed";

export interface InboxSubjectNames {
  readonly tasks: ReadonlyMap<string, string>;
  readonly connections: ReadonlyMap<string, string>;
  readonly runs: ReadonlyMap<string, string>;
}

export type InboxFeedItem =
  | {
      readonly kind: "run";
      readonly id: string;
      readonly at: number;
      readonly run: RunSummaryDto;
    }
  | {
      readonly kind: "asked";
      readonly id: string;
      readonly at: number;
      readonly session: ChatSessionDto;
    }
  | {
      readonly kind: "aggregate";
      readonly id: string;
      readonly at: number;
      readonly key: string;
      readonly taskName: string;
      readonly count: number;
      readonly summary: string;
    };

export interface InboxFeedDay {
  readonly key: string;
  readonly label: string;
  readonly items: readonly InboxFeedItem[];
}

export function parseInboxView(value: string | null | undefined): InboxView {
  if (value === "runs" || value === "scheduled") return "runs";
  if (value === "chats" || value === "asked") return "chats";
  return "all";
}

export function sessionOccurredAt(session: ChatSessionDto): string {
  return session.lastMessageAt ?? session.updatedAt ?? session.createdAt;
}

export function askedSubjectLabel(
  session: ChatSessionDto,
  names: InboxSubjectNames,
): string | undefined {
  const subject = session.context?.subjects[0];
  if (!subject) return undefined;
  switch (subject.kind) {
    case "task":
      return names.tasks.get(subject.id);
    case "connection":
      return names.connections.get(subject.id);
    case "run":
      return names.runs.get(subject.id);
  }
}

export function askedRowLabel(
  session: ChatSessionDto,
  _names?: InboxSubjectNames,
): string {
  return chatSessionTitle(session);
}

export function askedRowResponse(
  session: ChatSessionDto,
  names: InboxSubjectNames,
): string | undefined {
  if (session.latestTurnStatus === "failed") {
    return "Failed";
  }
  const subjectLabel = askedSubjectLabel(session, names);
  if (session.snippet) {
    return subjectLabel
      ? `${subjectLabel} · ${session.snippet}`
      : session.snippet;
  }
  return subjectLabel;
}

export function askedDotClass(session: ChatSessionDto): string {
  if (
    session.activeTurnId ||
    session.latestTurnStatus === "queued" ||
    session.latestTurnStatus === "streaming"
  ) {
    return "live";
  }
  if (session.latestTurnStatus === "waiting_for_user") return "attention";
  if (session.latestTurnStatus === "failed") return "bad";
  if (session.latestTurnStatus === "completed") return "ok";
  return "";
}

export function runRowLabel(run: RunSummaryDto): string {
  return run.taskName;
}

export function runRowResponse(run: RunSummaryDto): string | undefined {
  if (run.status === "waiting_for_approval") {
    return "Approval required";
  }
  if (run.status === "failed" && run.error) {
    return run.error;
  }
  if (run.summary === run.taskName || !run.summary) return undefined;
  return markdownPlainText(run.summary);
}

export function runDotClass(run: RunSummaryDto): string {
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

export function isQuietRun(run: RunSummaryDto): boolean {
  const summary = run.summary?.toLowerCase() ?? "";
  return (
    run.status === "succeeded" &&
    (summary.includes("nothing") ||
      summary.includes("no new") ||
      summary.includes("no action"))
  );
}

export function runMatchesInboxFilter(
  run: RunSummaryDto,
  filter: {
    readonly search: string;
    readonly status: InboxStatusFilter;
    readonly tag?: string;
    readonly tagByTask: ReadonlyMap<string, string | undefined>;
  },
): boolean {
  if (
    filter.status === "sent" &&
    (run.status !== "succeeded" || run.needsAttention)
  ) {
    return false;
  }
  if (
    filter.status === "needs_you" &&
    (!run.needsAttention || run.status === "failed")
  ) {
    return false;
  }
  if (filter.status === "failed" && run.status !== "failed") {
    return false;
  }
  if (
    filter.tag !== undefined &&
    filter.tagByTask.get(run.taskId) !== filter.tag
  ) {
    return false;
  }
  return (
    filter.search === "" ||
    run.taskName.toLowerCase().includes(filter.search) ||
    (run.summary ?? "").toLowerCase().includes(filter.search) ||
    (run.error ?? "").toLowerCase().includes(filter.search)
  );
}

export function sessionMatchesInboxFilter(
  session: ChatSessionDto,
  filter: {
    readonly search: string;
    readonly status: InboxStatusFilter;
    readonly tag?: string;
    readonly names: InboxSubjectNames;
  },
): boolean {
  if (filter.tag !== undefined) return false;
  if (filter.status === "sent" && session.latestTurnStatus !== "completed") {
    return false;
  }
  if (
    filter.status === "needs_you" &&
    session.latestTurnStatus !== "waiting_for_user"
  ) {
    return false;
  }
  if (filter.status === "failed" && session.latestTurnStatus !== "failed") {
    return false;
  }
  if (filter.search === "") return true;
  const haystack = `${askedRowLabel(session, filter.names)} ${
    askedRowResponse(session, filter.names) ?? ""
  }`.toLowerCase();
  return haystack.includes(filter.search);
}

export function buildInboxFeed(
  runs: readonly RunSummaryDto[],
  sessions: readonly ChatSessionDto[],
  view: InboxView,
  now: Date = new Date(),
): InboxFeedDay[] {
  const includeRuns = view !== "chats";
  const includeChats = view !== "runs";
  const byDay = new Map<
    string,
    { runs: RunSummaryDto[]; sessions: ChatSessionDto[] }
  >();

  const bucket = (iso: string) => {
    const day = dayKey(iso);
    const group = byDay.get(day) ?? { runs: [], sessions: [] };
    byDay.set(day, group);
    return group;
  };

  if (includeRuns) {
    for (const run of runs) {
      bucket(run.scheduledTime).runs.push(run);
    }
  }
  if (includeChats) {
    for (const session of sessions) {
      bucket(sessionOccurredAt(session)).sessions.push(session);
    }
  }

  const feed: InboxFeedDay[] = [];
  for (const [day, group] of byDay) {
    const items: InboxFeedItem[] = [];
    const quiet = new Map<string, RunSummaryDto[]>();

    for (const run of group.runs) {
      if (isQuietRun(run)) {
        const taskRuns = quiet.get(run.taskId) ?? [];
        taskRuns.push(run);
        quiet.set(run.taskId, taskRuns);
      } else {
        items.push(runItem(run));
      }
    }

    for (const [taskId, taskRuns] of quiet) {
      if (taskRuns.length === 1) {
        const onlyRun = taskRuns[0];
        if (onlyRun) items.push(runItem(onlyRun));
      } else {
        const latest = taskRuns.reduce((current, run) =>
          Date.parse(run.scheduledTime) > Date.parse(current.scheduledTime)
            ? run
            : current,
        );
        items.push({
          kind: "aggregate",
          id: `${day}-${taskId}`,
          at: Date.parse(latest.scheduledTime),
          key: `${day}-${taskId}`,
          taskName: latest.taskName,
          count: taskRuns.length,
          summary: latest.summary ?? "nothing needed attention",
        });
      }
    }

    for (const session of group.sessions) {
      items.push({
        kind: "asked",
        id: session.id,
        at: Date.parse(sessionOccurredAt(session)),
        session,
      });
    }

    items.sort((left, right) => right.at - left.at);
    const labelIso =
      group.runs[0]?.scheduledTime ??
      (group.sessions[0] ? sessionOccurredAt(group.sessions[0]) : day);
    feed.push({
      key: day,
      label: formatInboxDay(labelIso, now),
      items,
    });
  }

  return feed.sort((left, right) => right.key.localeCompare(left.key));
}

function runItem(run: RunSummaryDto): InboxFeedItem {
  return {
    kind: "run",
    id: run.id,
    at: Date.parse(run.scheduledTime),
    run,
  };
}

function dayKey(value: string): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatInboxDay(value: string, now: Date): string {
  const date = new Date(value);
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
  }).format(date);
  if (date.toDateString() === now.toDateString()) {
    return `Today · ${formatted}`;
  }
  return formatted;
}
