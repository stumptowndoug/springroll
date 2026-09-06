import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OpenRouterModelConnection,
  openLocalDatabase,
  runs,
  tasks,
  taskTools,
} from "@springroll/kernel";
import { LocalApplication } from "../src/server/application.ts";
import {
  prepareStarterRecipe,
  seedStarterRecipe,
} from "../src/server/starter-recipe.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture(fresh: boolean) {
  const directory = mkdtempSync(join(tmpdir(), "springroll-starter-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "springroll.sqlite");
  if (fresh) prepareStarterRecipe(filename);
  const local = openLocalDatabase({ filename });
  cleanup.push(() => local.close());
  const credentials = {
    async get() {
      return undefined;
    },
    async put() {},
    async delete() {},
  };
  const application = new LocalApplication(local.db, {
    credentials,
    models: new OpenRouterModelConnection(credentials),
    agent: {
      async run() {
        throw new Error("Seeding must not run the agent");
      },
    },
    fetch: async () => {
      throw new Error("Seeding must not make network requests");
    },
  });
  application.ensureBuiltinConnections();
  return { filename, local, application };
}

test("fresh install gets a paused, editable web recipe without model credentials or a run", async () => {
  const { filename, local, application } = fixture(true);
  await seedStarterRecipe(application, filename, "America/Los_Angeles");
  expect(local.db.select().from(tasks).all()).toMatchObject([
    {
      name: "Morning Brief",
      enabled: false,
      schedule: "0 8 * * *",
      scheduleTimezone: "America/Los_Angeles",
      modelId: null,
      modelProviderId: null,
      catchUpPolicy: "skip_to_next",
    },
  ]);
  expect(
    local.db
      .select()
      .from(taskTools)
      .all()
      .map((t) => t.name)
      .sort(),
  ).toEqual(["fetch_public_url", "search_web"]);
  expect(local.db.select().from(runs).all()).toHaveLength(0);
  prepareStarterRecipe(filename);
  await seedStarterRecipe(application, filename);
  expect(local.db.select().from(tasks).all()).toHaveLength(1);
  await application.updateTask("example-morning-brief-v1", {
    name: "My Brief",
  });
  await seedStarterRecipe(application, filename);
  expect(local.db.select().from(tasks).get()?.name).toBe("My Brief");
  await application.deleteTask("example-morning-brief-v1");
  prepareStarterRecipe(filename);
  await seedStarterRecipe(application, filename);
  expect(local.db.select().from(tasks).all()).toHaveLength(0);
});

test("an existing empty installation does not receive the example", async () => {
  const { filename, local, application } = fixture(false);
  prepareStarterRecipe(filename);
  await seedStarterRecipe(application, filename);
  expect(local.db.select().from(tasks).all()).toHaveLength(0);
});

test("interrupted initialization retries without duplicating the recipe", async () => {
  const { filename, local, application } = fixture(true);
  await expect(
    seedStarterRecipe(
      {
        createTask: async (...args) => {
          await application.createTask(...args);
          throw new Error("interrupted");
        },
      },
      filename,
    ),
  ).rejects.toThrow("interrupted");
  expect(existsSync(`${filename}.starter-pending`)).toBe(true);
  prepareStarterRecipe(filename);
  await seedStarterRecipe(application, filename);
  expect(local.db.select().from(tasks).all()).toHaveLength(1);
  expect(existsSync(`${filename}.starter-pending`)).toBe(false);
});
