import { describe, expect, test } from "bun:test";
import {
  askBarScopeForPath,
  chatOriginBackLink,
  chatSessionForSubject,
  chatSubjectHref,
  droppedChipScope,
  runDiagnoseEntry,
} from "../src/client/chat-session-entry.ts";
import type { ChatSessionDto } from "../src/shared.ts";

function session(
  id: string,
  context: NonNullable<ChatSessionDto["context"]>,
): ChatSessionDto {
  return {
    id,
    title: null,
    status: "active",
    context,
    activeTurnId: null,
    latestTurnStatus: null,
    lastMessageAt: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("run letter chat entry", () => {
  test("scopes diagnose entry to the run without putting credentials in the prompt", () => {
    expect(
      runDiagnoseEntry({ id: "run-1", taskName: "Morning digest" }),
    ).toEqual({
      context: {
        version: 1,
        intent: "run.diagnose",
        origin: "runs",
        subjects: [{ kind: "run", id: "run-1" }],
        suggestedPrompt:
          "Help me understand the run for “Morning digest”. Inspect the real run details and explain the outcome, any failure, and the next useful action.",
      },
    });
  });

  test("resumes the existing thread for a run instead of opening a new one", () => {
    const match = session("chat-run", {
      version: 1,
      intent: "run.diagnose",
      origin: "runs",
      subjects: [{ kind: "run", id: "run-1" }],
    });
    expect(
      chatSessionForSubject(
        [
          session("chat-other", {
            version: 1,
            intent: "run.diagnose",
            origin: "runs",
            subjects: [{ kind: "run", id: "run-2" }],
          }),
          match,
          session("chat-general", {
            version: 1,
            intent: "general",
            origin: "chat",
            subjects: [],
          }),
        ],
        "run",
        "run-1",
      )?.id,
    ).toBe("chat-run");
    expect(chatSessionForSubject([match], "run", "missing")).toBeUndefined();
  });
});

describe("ask bar scope", () => {
  test("keeps the bar on thread and run letter pages, scoped to that page", () => {
    expect(askBarScopeForPath("/chat/abc")).toMatchObject({
      placeholder: "Reply, or ask anything",
      continueSessionId: "abc",
      entry: { context: { intent: "general", subjects: [] } },
    });
    expect(
      askBarScopeForPath("/inbox/run-1", { run: "Morning digest" }),
    ).toMatchObject({
      placeholder: "Reply to this letter, or ask anything",
      chip: { label: "Morning digest" },
      entry: {
        context: {
          intent: "run.diagnose",
          origin: "runs",
          subjects: [{ kind: "run", id: "run-1" }],
        },
      },
    });
    expect(
      askBarScopeForPath("/runs/run-1", { run: "Morning digest" }),
    ).toMatchObject({
      chip: { label: "Morning digest" },
      entry: {
        context: { subjects: [{ kind: "run", id: "run-1" }] },
      },
    });
  });

  test("scopes recipe and connection detail pages with a chip", () => {
    expect(
      askBarScopeForPath("/recipes/task-1", { task: "Morning digest" }),
    ).toMatchObject({
      placeholder: "Ask, or change anything — schedule, model, connections…",
      chip: { label: "Morning digest" },
      entry: {
        context: {
          intent: "task.manage",
          origin: "recipes",
          subjects: [{ kind: "task", id: "task-1" }],
        },
      },
    });
    expect(
      askBarScopeForPath("/connections/gmail", { connection: "Gmail" }),
    ).toMatchObject({
      chip: { label: "Gmail" },
      entry: {
        context: {
          intent: "connection.manage",
          subjects: [{ kind: "connection", id: "gmail" }],
        },
      },
    });
  });

  test("uses list and general placeholders without a chip", () => {
    expect(askBarScopeForPath("/inbox")).toMatchObject({
      placeholder: "Ask Springroll, or describe a recipe you want",
      entry: { context: { intent: "general", subjects: [] } },
    });
    expect(askBarScopeForPath("/recipes")).toMatchObject({
      placeholder: "Describe a new recipe, or ask about the ones you have",
      entry: { context: { intent: "task.create", origin: "recipes" } },
    });
    expect(askBarScopeForPath("/connections")).toMatchObject({
      placeholder: "Ask, or describe an integration you want",
      entry: { context: { intent: "connection.create" } },
    });
    expect(askBarScopeForPath("/settings")).toMatchObject({
      placeholder: "Ask Springroll",
      entry: { context: { intent: "general", subjects: [] } },
    });
  });

  test("dropping the chip keeps origin and becomes a general ask", () => {
    const scoped = askBarScopeForPath("/recipes/task-1", {
      task: "Morning digest",
    });
    expect(droppedChipScope(scoped)).toEqual({
      placeholder: "Ask Springroll, or describe a recipe you want",
      entry: {
        mode: "new",
        context: {
          version: 1,
          intent: "general",
          origin: "recipes",
          subjects: [],
        },
      },
    });
    expect(droppedChipScope(askBarScopeForPath("/chat/abc"))).toEqual({
      placeholder: "Ask Springroll, or describe a recipe you want",
      entry: {
        mode: "new",
        context: {
          version: 1,
          intent: "general",
          origin: "chat",
          subjects: [],
        },
      },
    });
  });

  test("subject and origin links point at product pages, not chat index", () => {
    expect(chatSubjectHref("task", "task-1")).toBe("/recipes/task-1");
    expect(chatSubjectHref("run", "run-1")).toBe("/inbox/run-1");
    expect(chatOriginBackLink("chat")).toEqual({
      to: "/inbox",
      label: "Inbox",
    });
    expect(chatOriginBackLink("recipes")).toEqual({
      to: "/recipes",
      label: "Recipes",
    });
  });
});
