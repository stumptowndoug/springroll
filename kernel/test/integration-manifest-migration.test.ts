import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { parseConnectorManifest } from "../src/connector-manifest.ts";

describe("connector manifest migration", () => {
  test("moves a legacy Neon connection and its pins onto the manifest transport", async () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE connections (
          id text PRIMARY KEY NOT NULL,
          name text,
          source_id text NOT NULL,
          credential_ref text NOT NULL,
          config text DEFAULT '{}' NOT NULL,
          available_in text NOT NULL,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE INDEX connections_source_idx ON connections (source_id);
        CREATE TABLE task_tools (
          task_id text NOT NULL,
          connection_id text NOT NULL,
          source_id text NOT NULL,
          name text NOT NULL
        );
      `);
      sqlite
        .query(
          `INSERT INTO connections
            (id, name, source_id, credential_ref, config, available_in, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "neon-default",
          "Neon",
          "mcp.neon",
          "neon-secret-reference",
          JSON.stringify({ url: "https://mcp.example.test/mcp", toolCount: 4 }),
          JSON.stringify(["local"]),
          1,
          1,
        );
      sqlite
        .query(
          `INSERT INTO task_tools (task_id, connection_id, source_id, name)
           VALUES (?, ?, ?, ?)`,
        )
        .run("task-1", "neon-default", "mcp.neon", "list_projects");

      const migration = await Bun.file(
        new URL("../../drizzle/0009_connector-manifests.sql", import.meta.url),
      ).text();
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) sqlite.exec(statement);
      }

      const connection = sqlite
        .query(
          `SELECT source_id, manifest_id, available_in
           FROM connections WHERE id = ?`,
        )
        .get("neon-default") as {
        readonly source_id: string;
        readonly manifest_id: string;
        readonly available_in: string;
      };
      const manifestRow = sqlite
        .query("SELECT manifest FROM integration_manifests WHERE id = ?")
        .get("neon") as { readonly manifest: string };
      const pin = sqlite
        .query("SELECT source_id FROM task_tools WHERE task_id = ?")
        .get("task-1") as { readonly source_id: string };
      const manifest = parseConnectorManifest(JSON.parse(manifestRow.manifest));

      expect(connection).toEqual({
        source_id: "mcp-remote",
        manifest_id: "neon",
        available_in: '["local","hosted"]',
      });
      expect(pin.source_id).toBe("mcp-remote");
      expect(manifest).toMatchObject({
        id: "neon",
        transport: {
          kind: "mcp-remote",
          endpoint: "https://mcp.example.test/mcp",
        },
        credential: { kind: "api-key" },
        probe: { tool: "list_projects", input: {} },
      });
      expect(manifestRow.manifest).not.toContain("neon-secret-reference");
    } finally {
      sqlite.close();
    }
  });
});
