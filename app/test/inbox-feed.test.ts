import { describe, expect, test } from "bun:test";
import {
  askedDotClass,
  askedRowLabel,
  askedRowResponse,
  buildInboxFeed,
  parseInboxView,
  runMatchesInboxFilter,
  runRowLabel,
  runRowResponse,
  sessionMatchesInboxFilter,
} from "../src/client/inbox-feed.ts";
import type { ChatSessionDto, RunSummaryDto } from "../src/shared.ts";

const now = new Date("2026-08-12T18:00:00.000Z");
const names = {
  tasks: new Map([["task-1", "Morning digest"]]),
  connections: new Map([["gmail", "Gmail"]]),
  runs: new Map([["run-1", "Morning digest"]]),
};

function run(
  overrides: Partial<RunSummaryDto> & Pick<RunSummaryDto, "id">,
): RunSummaryDto {
  return {
    taskId: "task-1",
    taskName: "Morning digest",
    status: "succeeded",
    scheduledTime: "2026-08-12T08:00:00.000Z",
    needsAttention: false,
    ...overrides,
  };
}

describe("inbox view", () => {
  test("reads All · Scheduled · Asked from the query string", () => {
    expect(parseInboxView(null)).toBe("all");
    expect(parseInboxView("scheduled")).toBe("scheduled");
    expect(parseInboxView("asked")).toBe("asked");
    expect(parseInboxView("nope")).toBe("all");
  });
});

function session(
  overrides: Partial<ChatSessionDto> & Pick<ChatSessionDto, "id">,
): ChatSessionDto {
  return {
    title: "Pause the digest",
    status: "active",
    context: {
      version: 1,
      intent: "task.manage",
      origin: "recipes",
      subjects: [{ kind: "task", id: "task-1" }],
    },
    activeTurnId: null,
    latestTurnStatus: "completed",
    lastMessageAt: "2026-08-12T15:00:00.000Z",
    createdAt: "2026-08-12T14:00:00.000Z",
    updatedAt: "2026-08-12T15:00:00.000Z",
    ...overrides,
  };
}

describe("asked rows", () => {
  test("put the subject label before the conversation response", () => {
    expect(askedRowLabel(session({ id: "chat-1" }), names)).toBe(
      "Morning digest",
    );
    expect(askedRowResponse(session({ id: "chat-1" }))).toBe(
      "Pause the digest",
    );
    expect(
      askedRowLabel(
        session({
          id: "chat-2",
          context: {
            version: 1,
            intent: "general",
            origin: "chat",
            subjects: [],
          },
        }),
        names,
      ),
    ).toBe("Springroll");
    expect(
      askedRowLabel(
        session({
          id: "chat-3",
          context: {
            version: 1,
            intent: "run.diagnose",
            origin: "runs",
            subjects: [{ kind: "run", id: "run-1" }],
          },
        }),
        names,
      ),
    ).toBe("Morning digest");
  });

  test("maps turn status onto the same dots as runs", () => {
    expect(askedDotClass(session({ id: "ok" }))).toBe("ok");
    expect(askedDotClass(session({ id: "live", activeTurnId: "turn-1" }))).toBe(
      "live",
    );
    expect(
      askedDotClass(
        session({ id: "wait", latestTurnStatus: "waiting_for_user" }),
      ),
    ).toBe("attention");
    expect(
      askedDotClass(session({ id: "fail", latestTurnStatus: "failed" })),
    ).toBe("bad");
  });
});

describe("scheduled rows", () => {
  test("put the recipe label before the run response", () => {
    expect(
      runRowLabel(run({ id: "run-1", summary: "9 emails worth reading" })),
    ).toBe("Morning digest");
    expect(
      runRowResponse(run({ id: "run-1", summary: "9 emails worth reading" })),
    ).toBe("9 emails worth reading");
    expect(
      runRowResponse(
        run({ id: "run-2", status: "failed", error: "Gmail 401" }),
      ),
    ).toBe("Gmail 401");
  });
});

describe("buildInboxFeed", () => {
  test("mixes asked threads with scheduled runs, newest first", () => {
    const feed = buildInboxFeed(
      [
        run({ id: "run-morning", scheduledTime: "2026-08-12T08:00:00.000Z" }),
        run({
          id: "run-yesterday",
          scheduledTime: "2026-08-11T08:00:00.000Z",
          summary: "Yesterday's digest",
        }),
      ],
      [
        session({
          id: "chat-today",
          lastMessageAt: "2026-08-12T15:00:00.000Z",
        }),
        session({
          id: "chat-old",
          lastMessageAt: "2026-08-10T12:00:00.000Z",
        }),
      ],
      "all",
      now,
    );

    expect(feed.map((day) => day.items.map((item) => item.id))).toEqual([
      ["chat-today", "run-morning"],
      ["run-yesterday"],
      ["chat-old"],
    ]);
    expect(feed[0]?.items[0]).toMatchObject({
      kind: "asked",
      id: "chat-today",
    });
    expect(feed[0]?.items[1]).toMatchObject({ kind: "run", id: "run-morning" });
  });

  test("Scheduled hides chats and Asked hides runs", () => {
    const runs = [run({ id: "run-1" })];
    const sessions = [session({ id: "chat-1" })];
    expect(
      buildInboxFeed(runs, sessions, "scheduled", now).flatMap((day) =>
        day.items.map((item) => item.kind),
      ),
    ).toEqual(["run"]);
    expect(
      buildInboxFeed(runs, sessions, "asked", now).flatMap((day) =>
        day.items.map((item) => item.kind),
      ),
    ).toEqual(["asked"]);
  });

  test("keeps a run letter and its diagnose thread as two rows", () => {
    const feed = buildInboxFeed(
      [run({ id: "run-1" })],
      [
        session({
          id: "chat-diagnose",
          title: "Fix the Gmail thing",
          context: {
            version: 1,
            intent: "run.diagnose",
            origin: "runs",
            subjects: [{ kind: "run", id: "run-1" }],
          },
        }),
      ],
      "all",
      now,
    );
    expect(feed[0]?.items.map((item) => item.kind)).toEqual(["asked", "run"]);
  });

  test("aggregates quiet runs without swallowing chats", () => {
    const feed = buildInboxFeed(
      [
        run({
          id: "quiet-1",
          scheduledTime: "2026-08-12T08:00:00.000Z",
          summary: "nothing needed attention",
        }),
        run({
          id: "quiet-2",
          scheduledTime: "2026-08-12T09:00:00.000Z",
          summary: "no new mail",
        }),
      ],
      [session({ id: "chat-1", lastMessageAt: "2026-08-12T10:00:00.000Z" })],
      "all",
      now,
    );
    expect(feed[0]?.items.map((item) => item.kind)).toEqual([
      "asked",
      "aggregate",
    ]);
    expect(feed[0]?.items[1]).toMatchObject({
      kind: "aggregate",
      count: 2,
      taskName: "Morning digest",
    });
  });

  test("includes archived sessions in the combined history", () => {
    const feed = buildInboxFeed(
      [],
      [session({ id: "archived", status: "archived" })],
      "asked",
      now,
    );
    expect(feed[0]?.items[0]?.id).toBe("archived");
  });
});

describe("inbox filters", () => {
  const tagByTask = new Map([["task-1", "news"]]);

  test("search matches asked titles and subject lines", () => {
    expect(
      sessionMatchesInboxFilter(session({ id: "chat-1" }), {
        search: "pause",
        status: "all",
        names,
      }),
    ).toBe(true);
    expect(
      sessionMatchesInboxFilter(session({ id: "chat-1" }), {
        search: "morning",
        status: "all",
        names,
      }),
    ).toBe(true);
    expect(
      sessionMatchesInboxFilter(session({ id: "chat-1" }), {
        search: "gmail",
        status: "all",
        names,
      }),
    ).toBe(false);
  });

  test("status chips map onto last turn status", () => {
    const completed = session({ id: "ok" });
    const waiting = session({
      id: "wait",
      latestTurnStatus: "waiting_for_user",
    });
    const failed = session({ id: "fail", latestTurnStatus: "failed" });
    expect(
      sessionMatchesInboxFilter(completed, {
        search: "",
        status: "sent",
        names,
      }),
    ).toBe(true);
    expect(
      sessionMatchesInboxFilter(waiting, {
        search: "",
        status: "needs_you",
        names,
      }),
    ).toBe(true);
    expect(
      sessionMatchesInboxFilter(failed, {
        search: "",
        status: "failed",
        names,
      }),
    ).toBe(true);
    expect(
      sessionMatchesInboxFilter(completed, {
        search: "",
        status: "failed",
        names,
      }),
    ).toBe(false);
  });

  test("a recipe tag drops chats and keeps tagged runs", () => {
    expect(
      sessionMatchesInboxFilter(session({ id: "chat-1" }), {
        search: "",
        status: "all",
        tag: "news",
        names,
      }),
    ).toBe(false);
    expect(
      runMatchesInboxFilter(run({ id: "run-1" }), {
        search: "",
        status: "all",
        tag: "news",
        tagByTask,
      }),
    ).toBe(true);
    expect(
      runMatchesInboxFilter(run({ id: "run-2", taskId: "other" }), {
        search: "",
        status: "all",
        tag: "news",
        tagByTask,
      }),
    ).toBe(false);
  });
});
