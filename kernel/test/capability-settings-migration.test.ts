import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

describe("capability settings migration", () => {
  test("defaults legacy pins to Allow and removes obsolete workflows", async () => {
    const database = new Database(":memory:");
    try {
      database.run(`
        CREATE TABLE task_tools (
          task_id TEXT NOT NULL,
          name TEXT NOT NULL,
          approval TEXT NOT NULL
        )
      `);
      database.run(`
        CREATE TABLE assistant_workflows (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL
        )
      `);
      database.run(
        "INSERT INTO task_tools (task_id, name, approval) VALUES (?, ?, ?)",
        ["task-1", "delete_record", "before_call"],
      );
      database.run(
        "INSERT INTO assistant_workflows (id, kind) VALUES (?, ?), (?, ?)",
        [
          "workflow-task",
          "task_proposal",
          "workflow-connection",
          "connection_setup",
        ],
      );

      const migration = await Bun.file(
        new URL("../../drizzle/0020_capability_settings.sql", import.meta.url),
      ).text();
      for (const statement of migration.split("--> statement-breakpoint")) {
        database.run(statement);
      }

      expect(database.query("SELECT approval FROM task_tools").get()).toEqual({
        approval: "never",
      });
      expect(
        database.query("SELECT id, kind FROM assistant_workflows").all(),
      ).toEqual([{ id: "workflow-connection", kind: "connection_setup" }]);
    } finally {
      database.close();
    }
  });
});
