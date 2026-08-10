import { describe, expect, test } from "bun:test";
import {
  parseProposedRecipeKnowledgeDocument,
  parseRecipeKnowledgeDocument,
  type RecipeKnowledgeDocument,
} from "../src/recipe-knowledge.ts";
import { openLocalDatabase } from "../src/storage/database.ts";
import { tasks } from "../src/storage/schema.ts";
import { SqliteRecipeKnowledgeStore } from "../src/storage/sqlite-recipe-knowledge-store.ts";

const knowledge: RecipeKnowledgeDocument = {
  schemaVersion: 1,
  markdown: `# AssessorSearch activity

## Sources

- Use \`property_data_api_usage_events\` for API activity.
- Join account owners to \`app_users\` for email.

## Business definitions

Match rate is a successful 2xx event with a non-null \`property_id\` divided by all API usage events.

## Time handling

Use the previous complete calendar day in America/Los_Angeles.`,
};

describe("SQLite recipe knowledge persistence", () => {
  test("activates, versions, supersedes, and invalidates recipe knowledge", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      insertTask(local.db);
      const store = new SqliteRecipeKnowledgeStore(local.db);
      const first = store.createRevision({
        taskId: "task-assessor-search",
        knowledge,
        now: new Date("2026-08-07T18:00:00.000Z"),
      });
      expect(first).toMatchObject({ revision: 1, status: "ready" });

      const second = store.createRevision({
        taskId: first.taskId,
        knowledge: {
          ...knowledge,
          markdown: `${knowledge.markdown}\n\nReviewed.`,
        },
      });
      expect(second.revision).toBe(2);
      expect(second.status).toBe("ready");
      expect(store.getCurrent(first.taskId)?.revision).toBe(2);
      expect(store.get(first.taskId, 1)?.status).toBe("superseded");

      const stale = store.markStale(first.taskId, "The source schema changed.");
      expect(stale).toMatchObject({
        revision: 2,
        status: "stale",
        staleReason: "The source schema changed.",
      });
    } finally {
      local.close();
    }
  });

  test("rejects an unbounded knowledge document", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      insertTask(local.db);
      const store = new SqliteRecipeKnowledgeStore(local.db);
      expect(() =>
        store.createRevision({
          taskId: "task-assessor-search",
          knowledge: { schemaVersion: 1, markdown: "x".repeat(32_001) },
        }),
      ).toThrow();
    } finally {
      local.close();
    }
  });

  test("rejects sensitive or raw run-sourced proposals", () => {
    expect(() =>
      parseProposedRecipeKnowledgeDocument({
        schemaVersion: 1,
        markdown: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow("authorization credential");
    expect(() =>
      parseProposedRecipeKnowledgeDocument({
        schemaVersion: 1,
        markdown: "Contact operator@example.com for the next run.",
      }),
    ).toThrow("email address");
    expect(() =>
      parseProposedRecipeKnowledgeDocument({
        schemaVersion: 1,
        markdown: `# Raw output\n\n${"x".repeat(4_001)}`,
      }),
    ).toThrow("unbounded raw output");
  });

  test("converts a legacy structured profile into bounded Markdown", () => {
    const converted = parseRecipeKnowledgeDocument({
      schemaVersion: 1,
      summary: "A reviewed query plan.",
      bindings: [{ id: "usage", resources: [{ name: "public.requests" }] }],
      metrics: [],
      operations: [],
    });
    expect(converted.markdown).toContain("# Imported learned setup");
    expect(converted.markdown).toContain("A reviewed query plan.");
    expect(converted.markdown.length).toBeLessThanOrEqual(32_000);
  });
});

function insertTask(db: ReturnType<typeof openLocalDatabase>["db"]): void {
  const now = new Date("2026-08-07T17:00:00.000Z");
  db.insert(tasks)
    .values({
      id: "task-assessor-search",
      prompt: "Report daily AssessorSearch activity.",
      schedule: "0 9 * * *",
      scheduleTimezone: "America/Los_Angeles",
      enabled: false,
      catchUpPolicy: "skip_to_next",
      nextRunAt: new Date("2026-08-08T16:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
