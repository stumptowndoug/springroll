import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { openLocalDatabase } from "../src/storage/database.ts";
import { chatSessions, chatTurns, runs, tasks } from "../src/storage/schema.ts";
import {
  ArtifactCaptureConflictError,
  SqliteRunArtifactRepository,
  toRunResultImageArtifact,
} from "../src/storage/sqlite-run-artifact-repository.ts";

const sha256 = "a".repeat(64);

describe("SqliteRunArtifactRepository", () => {
  test("persists idempotent run-owned image references", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      insertRun(local.db, "run-image");
      const artifacts = new SqliteRunArtifactRepository(local.db);
      const input = {
        id: "artifact-image",
        owner: { kind: "run" as const, id: "run-image" },
        captureKey: "tool-call-1:0",
        sha256,
        mediaType: "image/png" as const,
        byteSize: 1_024,
        width: 512,
        height: 512,
        title: "Sunrise",
        alt: "A sunrise over a quiet lake",
        providerId: "openai",
        modelId: "gpt-image-1",
      };

      const created = artifacts.create(
        input,
        new Date("2026-08-19T12:00:00.000Z"),
      );
      const repeated = artifacts.create({ ...input, id: "ignored-id" });

      expect(repeated).toEqual(created);
      expect(artifacts.listForRun("run-image")).toEqual([created]);
      expect(artifacts.referenceCount(sha256)).toBe(1);
      expect(toRunResultImageArtifact(created)).toEqual({
        id: "artifact-image",
        kind: "image",
        title: "Sunrise",
        mediaType: "image/png",
        payload: {
          sha256,
          byteSize: 1_024,
          origin: "generated",
          width: 512,
          height: 512,
          alt: "A sunrise over a quiet lake",
          providerId: "openai",
          modelId: "gpt-image-1",
        },
      });
    } finally {
      local.close();
    }
  });

  test("rejects a capture key reused for different bytes", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      insertRun(local.db, "run-conflict");
      const artifacts = new SqliteRunArtifactRepository(local.db);
      artifacts.create({
        owner: { kind: "run", id: "run-conflict" },
        captureKey: "tool-call-1:0",
        sha256,
        mediaType: "image/png",
        byteSize: 10,
      });

      expect(() =>
        artifacts.create({
          owner: { kind: "run", id: "run-conflict" },
          captureKey: "tool-call-1:0",
          sha256: "b".repeat(64),
          mediaType: "image/png",
          byteSize: 11,
        }),
      ).toThrow(ArtifactCaptureConflictError);
    } finally {
      local.close();
    }
  });

  test("allows one blob to be referenced by multiple runs and cascades rows", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      insertRun(local.db, "run-first");
      insertRun(local.db, "run-second");
      const artifacts = new SqliteRunArtifactRepository(local.db);
      for (const runId of ["run-first", "run-second"]) {
        artifacts.create({
          owner: { kind: "run", id: runId },
          captureKey: "tool-call-1:0",
          sha256,
          mediaType: "image/webp",
          byteSize: 10,
        });
      }
      expect(artifacts.referenceCount(sha256)).toBe(2);

      local.db.delete(runs).where(eq(runs.id, "run-first")).run();

      expect(artifacts.referenceCount(sha256)).toBe(1);
      expect(artifacts.listForRun("run-first")).toEqual([]);
    } finally {
      local.close();
    }
  });

  test("stores chat-owned artifacts and cascades them with the session", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      local.db.insert(chatSessions).values({ id: "chat-1" }).run();
      local.db
        .insert(chatTurns)
        .values({ id: "turn-1", sessionId: "chat-1" })
        .run();
      local.db
        .insert(chatTurns)
        .values({ id: "turn-2", sessionId: "chat-1" })
        .run();
      local.db.insert(chatSessions).values({ id: "chat-2" }).run();
      local.db
        .insert(chatTurns)
        .values({ id: "turn-other", sessionId: "chat-2" })
        .run();
      const artifacts = new SqliteRunArtifactRepository(local.db);
      const created = artifacts.create({
        owner: { kind: "chat_turn", id: "turn-1" },
        captureKey: "tool-call-1:0",
        sha256,
        mediaType: "image/png",
        byteSize: 10,
      });

      expect(artifacts.listForChatTurn("turn-1")).toEqual([created]);
      expect(artifacts.listForChatSession("chat-1")).toEqual([created]);
      expect(
        artifacts.getInScope(created.id, {
          kind: "chat_turn",
          id: "turn-2",
        }),
      ).toEqual(created);
      expect(
        artifacts.getInScope(created.id, {
          kind: "chat_turn",
          id: "turn-other",
        }),
      ).toBeUndefined();

      local.db.delete(chatSessions).where(eq(chatSessions.id, "chat-1")).run();

      expect(artifacts.referenceCount(sha256)).toBe(0);
      expect(artifacts.get(created.id)).toBeUndefined();
    } finally {
      local.close();
    }
  });
});

function insertRun(
  db: ReturnType<typeof openLocalDatabase>["db"],
  runId: string,
): void {
  const taskId = `task-${runId}`;
  db.insert(tasks)
    .values({
      id: taskId,
      prompt: "Generate an image",
      schedule: "0 9 * * *",
      nextRunAt: new Date("2026-08-20T16:00:00.000Z"),
    })
    .run();
  db.insert(runs)
    .values({
      id: runId,
      taskId,
      scheduledTime: new Date("2026-08-19T16:00:00.000Z"),
      executionLocation: "local",
    })
    .run();
}
