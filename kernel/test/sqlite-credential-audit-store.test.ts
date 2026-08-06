import { describe, expect, test } from "bun:test";
import { openLocalDatabase } from "../src/storage/database.ts";
import { SqliteCredentialAuditStore } from "../src/storage/sqlite-credential-audit-store.ts";

describe("SQLite credential audit persistence", () => {
  test("records only connector identity, ceremony state, and a normalized failure", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const store = new SqliteCredentialAuditStore(local.db);
      const now = new Date("2026-08-06T12:00:00.000Z");
      store.record({
        connectorId: "assessor-search",
        credentialKind: "api-key",
        action: "test",
        status: "failed",
        failureCategory: "authentication",
        now,
      });

      expect(store.list("assessor-search")).toMatchObject([
        {
          connectorId: "assessor-search",
          credentialKind: "api-key",
          action: "test",
          status: "failed",
          failureCategory: "authentication",
          createdAt: now,
        },
      ]);
      expect(JSON.stringify(store.list("assessor-search"))).not.toContain(
        "apiKey",
      );
      expect(() =>
        store.record({
          connectorId: " ",
          credentialKind: "none",
          action: "revoke",
          status: "succeeded",
        }),
      ).toThrow("Credential audit connector ID is required");
    } finally {
      local.close();
    }
  });
});
