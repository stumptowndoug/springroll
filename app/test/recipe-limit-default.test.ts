import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { executionSettings, openLocalDatabase } from "@springroll/kernel";

test("a new execution settings row defaults to no turn limit", () => {
  const database = openLocalDatabase({ filename: ":memory:" });
  try {
    database.db.insert(executionSettings).values({ id: "default" }).run();
    expect(database.db.select().from(executionSettings).get()?.maxSteps).toBe(
      0,
    );
  } finally {
    database.close();
  }
});

test("the default migration preserves existing turn and cost limits", async () => {
  const database = new Database(":memory:");
  try {
    database.exec(`CREATE TABLE execution_settings (
      id TEXT PRIMARY KEY NOT NULL, max_steps INTEGER DEFAULT 20 NOT NULL,
      max_cost_usd_micros INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); INSERT INTO execution_settings VALUES ('default', 20, 50000, 1, 2);`);
    database.exec(
      await Bun.file(
        new URL(
          "../../drizzle/0033_recipe-turn-limit-off.sql",
          import.meta.url,
        ),
      ).text(),
    );
    expect(database.query("SELECT * FROM execution_settings").get()).toEqual({
      id: "default",
      max_steps: 20,
      max_cost_usd_micros: 50000,
      created_at: 1,
      updated_at: 2,
    });
    database.exec("INSERT INTO execution_settings (id) VALUES ('new')");
    expect(
      database
        .query("SELECT max_steps FROM execution_settings WHERE id = 'new'")
        .get(),
    ).toEqual({ max_steps: 0 });
  } finally {
    database.close();
  }
});
