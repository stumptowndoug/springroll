import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

describe("connector tool policy migration", () => {
  test("moves legacy recipe grants to the connection and normalizes read-only Neon", async () => {
    const database = new Database(":memory:");
    try {
      database.run(`
        CREATE TABLE connections (
          id TEXT PRIMARY KEY,
          manifest_id TEXT,
          config TEXT NOT NULL
        )
      `);
      database.run(`
        CREATE TABLE task_tools (
          task_id TEXT NOT NULL,
          connection_id TEXT NOT NULL,
          name TEXT NOT NULL,
          approval TEXT NOT NULL,
          risk_effect TEXT NOT NULL,
          risk_idempotent INTEGER NOT NULL
        )
      `);
      const readOnlyNotice =
        "The server is currently configured with read-only permissions. All remaining tools are limited to read-only operations.";
      database
        .query(
          "INSERT INTO connections (id, manifest_id, config) VALUES (?, ?, ?)",
        )
        .run(
          "neon-default",
          "neon",
          JSON.stringify({
            discoveredTools: [
              {
                name: "run_sql",
                description: readOnlyNotice,
                effect: "destructive",
              },
            ],
          }),
        );
      database.run(`
        INSERT INTO task_tools
          (task_id, connection_id, name, approval, risk_effect, risk_idempotent)
        VALUES
          ('task-1', 'neon-default', 'run_sql', 'never', 'destructive', 0),
          ('task-2', 'neon-default', 'run_sql', 'before_call', 'destructive', 0),
          ('task-1', 'neon-default', 'unused_tool', 'off', 'write', 0)
      `);

      const migration = await Bun.file(
        new URL(
          "../../drizzle/0021_connector_tool_policies.sql",
          import.meta.url,
        ),
      ).text();
      for (const statement of migration.split("--> statement-breakpoint")) {
        database.run(statement);
      }

      const config = JSON.parse(
        (
          database
            .query("SELECT config FROM connections WHERE id = 'neon-default'")
            .get() as { config: string }
        ).config,
      );
      expect(config).toMatchObject({
        accessMode: "read_only",
        toolPolicies: { run_sql: "allow", unused_tool: "off" },
      });
      expect(
        database
          .query(
            "SELECT DISTINCT risk_effect, risk_idempotent FROM task_tools WHERE connection_id = 'neon-default'",
          )
          .all(),
      ).toEqual([{ risk_effect: "read", risk_idempotent: 1 }]);
    } finally {
      database.close();
    }
  });

  test("activates the newest pending recipe memory revision", async () => {
    const database = new Database(":memory:");
    try {
      database.run(`
        CREATE TABLE task_execution_profiles (
          task_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          status TEXT NOT NULL,
          approved_at INTEGER,
          validated_at INTEGER,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (task_id, revision)
        )
      `);
      database.run(`
        INSERT INTO task_execution_profiles
          (task_id, revision, status, updated_at)
        VALUES
          ('task-1', 1, 'ready', 1),
          ('task-1', 2, 'needs_review', 2),
          ('task-1', 3, 'needs_review', 3),
          ('task-2', 1, 'ready', 1)
      `);

      const migration = await Bun.file(
        new URL(
          "../../drizzle/0022_activate_recipe_knowledge.sql",
          import.meta.url,
        ),
      ).text();
      for (const statement of migration.split("--> statement-breakpoint")) {
        database.run(statement);
      }

      expect(
        database
          .query(
            "SELECT task_id, revision, status FROM task_execution_profiles ORDER BY task_id, revision",
          )
          .all(),
      ).toEqual([
        { task_id: "task-1", revision: 1, status: "superseded" },
        { task_id: "task-1", revision: 2, status: "superseded" },
        { task_id: "task-1", revision: 3, status: "ready" },
        { task_id: "task-2", revision: 1, status: "ready" },
      ]);
    } finally {
      database.close();
    }
  });
});
