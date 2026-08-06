import { describe, expect, test } from "bun:test";
import { openLocalDatabase } from "../src/storage/database.ts";
import { SqliteToolApprovalStore } from "../src/storage/sqlite-tool-approval-store.ts";

describe("SQLite tool approval persistence", () => {
  test("records exact inputs and guards approval lifecycle transitions", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const store = new SqliteToolApprovalStore(local.db);
      const createdAt = new Date("2026-08-06T12:00:00.000Z");
      expect(
        store.recordPending({
          id: "approval-1",
          contextKind: "chat",
          contextId: "turn-1",
          toolCallId: "call-1",
          toolName: "change_record",
          input: { recordId: "record-1", value: "new value" },
          riskEffect: "write",
          now: createdAt,
        }),
      ).toMatchObject({
        status: "pending",
        input: { recordId: "record-1", value: "new value" },
        riskEffect: "write",
      });

      const decidedAt = new Date("2026-08-06T12:01:00.000Z");
      expect(
        store.decide(
          "chat",
          "turn-1",
          [{ id: "approval-1", approved: true, reason: "Looks correct" }],
          decidedAt,
        ),
      ).toMatchObject([
        {
          status: "approved",
          reason: "Looks correct",
          decidedAt,
        },
      ]);
      expect(
        store.decide(
          "chat",
          "turn-1",
          [{ id: "approval-1", approved: true, reason: "Looks correct" }],
          decidedAt,
        ),
      ).toMatchObject([{ status: "approved" }]);
      expect(
        store.complete("approval-1", {
          status: "succeeded",
          outcome: { state: "output-available" },
          now: new Date("2026-08-06T12:02:00.000Z"),
        }),
      ).toMatchObject({
        status: "succeeded",
        outcome: { state: "output-available" },
      });
      expect(() =>
        store.decide("chat", "turn-1", [{ id: "approval-1", approved: false }]),
      ).toThrow("no longer pending");
    } finally {
      local.close();
    }
  });

  test("marks execution interrupted without guessing the remote outcome", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const store = new SqliteToolApprovalStore(local.db);
      store.recordPending({
        id: "approval-ambiguous",
        contextKind: "run",
        contextId: "run-1",
        toolCallId: "call-ambiguous",
        toolName: "send_message",
        input: { channel: "operations", text: "Hello" },
        riskEffect: "write",
      });
      store.decide("run", "run-1", [
        { id: "approval-ambiguous", approved: true },
      ]);
      store.markExecuting("approval-ambiguous");

      expect(store.recoverExecuting()).toBe(1);
      expect(store.get("approval-ambiguous")).toMatchObject({
        status: "interrupted",
        outcome: {
          state: "ambiguous",
          message: expect.stringContaining("verify remote state"),
        },
      });
      expect(store.recoverExecuting()).toBe(0);
    } finally {
      local.close();
    }
  });
});
