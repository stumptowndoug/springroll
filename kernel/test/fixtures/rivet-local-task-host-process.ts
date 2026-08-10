import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { actor, setup } from "rivetkit";
import { createClient } from "rivetkit/client";
import {
  integer,
  db as rivetDrizzle,
  sqliteTable,
  text,
} from "rivetkit/db/drizzle";
import { createLocalRivetTaskHost } from "../../src/host/rivet-local-task-host.ts";
import type { LocalRunApprovalDecision } from "../../src/local-task-run-host.ts";
import { openLocalDatabase } from "../../src/storage/database.ts";
import { runs } from "../../src/storage/schema.ts";
import { StubRunExecutor } from "../../src/storage/stub-run-executor.ts";

const databasePath = requiredEnvironment("SPRINGROLL_RIVET_TEST_DB");
const controlDirectory = requiredEnvironment("SPRINGROLL_RIVET_TEST_CONTROL");
const endpoint = requiredEnvironment("RIVET_ENDPOINT");
const hostMode = process.env.SPRINGROLL_RIVET_TEST_HOST_MODE ?? "production";

async function runProductionHost(): Promise<void> {
  const database = openLocalDatabase({ filename: databasePath });
  const stub = new StubRunExecutor(database.db);
  const executorMode = process.env.SPRINGROLL_RIVET_TEST_EXECUTOR ?? "succeed";
  const executor = {
    async execute(runId: string, taskId: string, scheduledTime: Date) {
      await writeFile(join(controlDirectory, `attempt-${runId}`), "");
      if (executorMode === "block") {
        await new Promise<never>(() => {});
      }
      if (executorMode === "release") {
        await waitForFile(join(controlDirectory, "release"));
      }
      const status = database.db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .get()?.status;
      if (status !== "claimed") return;
      await stub.execute(runId, taskId, scheduledTime);
    },
    approveResume(
      _runId: string,
      _decisions: readonly LocalRunApprovalDecision[],
    ) {},
    async resumeApproved() {
      throw new Error("Approval resume is outside this recovery fixture");
    },
  };
  const host = await createLocalRivetTaskHost({
    db: database.db,
    executor,
    endpoint,
  });
  await writeFile(join(controlDirectory, "ready"), "");
  await waitForFile(join(controlDirectory, "shutdown-request"));
  await host.shutdown();
  database.close();
  await writeFile(join(controlDirectory, "drained"), "");
}

async function runLegacyHost(): Promise<void> {
  const taskId = requiredEnvironment("SPRINGROLL_RIVET_TEST_TASK_ID");
  const localTaskActor = actor({
    state: {
      scheduleEventId: null as string | null,
      nextRunAt: null as string | null,
    },
    actions: {
      seed: async (c) => {
        await c.saveState({ immediate: true });
      },
    },
  });
  const registry = setup({ use: { localTaskActor } });
  await registry.startAndWait();
  const client = createClient<typeof registry>(endpoint);
  await client.localTaskActor.getOrCreate([taskId]).seed();
  await writeFile(join(controlDirectory, "ready"), "");
  await waitForFile(join(controlDirectory, "shutdown-request"));
  await client.dispose();
  await registry.shutdown();
  await writeFile(join(controlDirectory, "drained"), "");
}

const actorSchemaMigrations = sqliteTable("actor_schema_migrations", {
  version: integer("version").primaryKey(),
});
const legacyMigrationRecords = sqliteTable("migration_records", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
});
const currentMigrationRecords = sqliteTable("migration_records", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  note: text("note").notNull().default("migrated"),
});

async function runLegacyDatabaseHost(): Promise<void> {
  const taskId = requiredEnvironment("SPRINGROLL_RIVET_TEST_TASK_ID");
  const provider = rivetDrizzle({
    schema: { actorSchemaMigrations, legacyMigrationRecords },
    onMigrate: async (database) => {
      await database.execute(
        "CREATE TABLE IF NOT EXISTS actor_schema_migrations (version INTEGER PRIMARY KEY)",
      );
      await database.execute(
        "CREATE TABLE IF NOT EXISTS migration_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      await database
        .insert(actorSchemaMigrations)
        .values({ version: 1 })
        .onConflictDoNothing();
    },
  });
  const migrationActor = actor({
    state: {},
    db: provider,
    actions: {
      seed: async (c) => {
        await c.db
          .insert(legacyMigrationRecords)
          .values({ id: "record", value: "preserved" })
          .onConflictDoNothing();
      },
    },
  });
  const registry = setup({ use: { migrationActor } });
  await registry.startAndWait();
  const client = createClient<typeof registry>(endpoint);
  await client.migrationActor.getOrCreate([taskId]).seed();
  await waitForShutdown(client, registry);
}

async function runCurrentDatabaseHost(): Promise<void> {
  const taskId = requiredEnvironment("SPRINGROLL_RIVET_TEST_TASK_ID");
  const provider = rivetDrizzle({
    schema: { actorSchemaMigrations, currentMigrationRecords },
    onMigrate: async (database) => {
      await database.execute(
        "CREATE TABLE IF NOT EXISTS actor_schema_migrations (version INTEGER PRIMARY KEY)",
      );
      await database.execute(
        "CREATE TABLE IF NOT EXISTS migration_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      const applied = await database.select().from(actorSchemaMigrations);
      if (!applied.some(({ version }) => version === 2)) {
        await database.execute(
          "ALTER TABLE migration_records ADD COLUMN note TEXT NOT NULL DEFAULT 'migrated'",
        );
        await database
          .insert(actorSchemaMigrations)
          .values({ version: 2 })
          .onConflictDoNothing();
      }
    },
  });
  const migrationActor = actor({
    state: {},
    db: provider,
    actions: {
      read: async (c) =>
        (
          await c.db
            .select()
            .from(currentMigrationRecords)
            .where(eq(currentMigrationRecords.id, "record"))
        )[0],
    },
  });
  const registry = setup({ use: { migrationActor } });
  await registry.startAndWait();
  const client = createClient<typeof registry>(endpoint);
  const record = await client.migrationActor.getOrCreate([taskId]).read();
  await writeFile(
    join(controlDirectory, "database-result.json"),
    JSON.stringify(record),
  );
  await waitForShutdown(client, registry);
}

async function waitForShutdown(
  client: { dispose(): Promise<void> },
  registry: { shutdown(): Promise<void> },
): Promise<void> {
  await writeFile(join(controlDirectory, "ready"), "");
  await waitForFile(join(controlDirectory, "shutdown-request"));
  await client.dispose();
  await registry.shutdown();
  await writeFile(join(controlDirectory, "drained"), "");
}

async function waitForFile(path: string): Promise<void> {
  while (!existsSync(path)) {
    await Bun.sleep(20);
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

try {
  if (hostMode === "legacy") {
    await runLegacyHost();
  } else if (hostMode === "database-legacy") {
    await runLegacyDatabaseHost();
  } else if (hostMode === "database-current") {
    await runCurrentDatabaseHost();
  } else {
    await runProductionHost();
  }
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
