import { describe, expect, test } from "bun:test";
import {
  askBarScopeForPath,
  chatOriginBackLink,
  chatSessionHref,
  chatSubjectHref,
  initialChatDraft,
  runDiagnoseEntry,
  showsChatLauncher,
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
      mode: "new",
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
});

describe("contextual starter prompt", () => {
  const suggestedPrompt = "Help me understand this run.";

  test("prefills only a genuinely empty thread", () => {
    expect(
      initialChatDraft({
        enteredWithSubmission: false,
        messageCount: 0,
        suggestedPrompt,
      }),
    ).toBe(suggestedPrompt);
    expect(
      initialChatDraft({
        enteredWithSubmission: false,
        messageCount: 1,
        suggestedPrompt,
      }),
    ).toBeUndefined();
  });

  test("does not replace a launcher submission during its send transition", () => {
    expect(
      initialChatDraft({
        enteredWithSubmission: true,
        messageCount: 0,
        suggestedPrompt,
      }),
    ).toBeUndefined();
  });
});

describe("ask bar scope", () => {
  test("shows the launcher on product pages but not inside a thread", () => {
    expect(showsChatLauncher("/inbox/run-1")).toBeTrue();
    expect(showsChatLauncher("/recipes/task-1")).toBeTrue();
    expect(showsChatLauncher("/chat/chat-1")).toBeFalse();
  });

  test("keeps threads standalone and gives run launchers fresh context", () => {
    expect(askBarScopeForPath("/chat/abc")).toMatchObject({
      entry: { context: { intent: "general", subjects: [] } },
    });
    expect(
      askBarScopeForPath("/inbox/run-1", { run: "Morning digest" }),
    ).toMatchObject({
      entry: {
        mode: "new",
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
      entry: {
        mode: "new",
        context: { subjects: [{ kind: "run", id: "run-1" }] },
      },
    });
  });

  test("scopes recipe and connection detail pages from the route", () => {
    expect(
      askBarScopeForPath("/recipes/task-1", { task: "Morning digest" }),
    ).toMatchObject({
      entry: {
        context: {
          intent: "task.manage",
          origin: "recipes",
          subjects: [{ kind: "task", id: "task-1" }],
        },
      },
    });
    expect(
      askBarScopeForPath("/integrations/gmail", { connection: "Gmail" }),
    ).toMatchObject({
      entry: {
        context: {
          intent: "connection.manage",
          subjects: [{ kind: "connection", id: "gmail" }],
        },
      },
    });
    expect(
      askBarScopeForPath("/connections/gmail", { connection: "Gmail" }),
    ).toMatchObject({
      entry: {
        context: {
          intent: "connection.manage",
          subjects: [{ kind: "connection", id: "gmail" }],
        },
      },
    });
  });

  test("uses list and general intents without a subject", () => {
    expect(askBarScopeForPath("/inbox")).toMatchObject({
      entry: { context: { intent: "general", subjects: [] } },
    });
    expect(askBarScopeForPath("/recipes")).toMatchObject({
      entry: { context: { intent: "task.create", origin: "recipes" } },
    });
    expect(askBarScopeForPath("/integrations")).toMatchObject({
      entry: { context: { intent: "connection.create" } },
    });
    expect(askBarScopeForPath("/connections")).toMatchObject({
      entry: { context: { intent: "connection.create" } },
    });
    expect(askBarScopeForPath("/settings")).toMatchObject({
      entry: { context: { intent: "general", subjects: [] } },
    });
  });

  test("subject and origin links point at product pages, not chat index", () => {
    expect(chatSubjectHref("task", "task-1")).toBe("/recipes/task-1");
    expect(chatSubjectHref("run", "run-1")).toBe("/inbox/run-1");
    expect(chatSubjectHref("connection", "gmail")).toBe("/integrations/gmail");
    expect(chatOriginBackLink("chat")).toEqual({
      to: "/inbox",
      label: "Inbox",
    });
    expect(chatOriginBackLink("recipes")).toEqual({
      to: "/recipes",
      label: "Recipes",
    });
    expect(chatOriginBackLink("integrations")).toEqual({
      to: "/integrations",
      label: "Integrations",
    });
    expect(chatOriginBackLink("connections")).toEqual({
      to: "/integrations",
      label: "Integrations",
    });
  });

  test("opens every conversation on its full-screen thread surface", () => {
    expect(
      chatSessionHref(
        session("chat-run", {
          version: 1,
          intent: "run.diagnose",
          origin: "runs",
          subjects: [{ kind: "run", id: "run/one" }],
        }),
      ),
    ).toBe("/chat/chat-run");
    expect(
      chatSessionHref(
        session("chat/general", {
          version: 1,
          intent: "general",
          origin: "chat",
          subjects: [],
        }),
      ),
    ).toBe("/chat/chat%2Fgeneral");
  });
});
