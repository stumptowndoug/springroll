import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { eq } from "drizzle-orm";
import {
  type LocalDatabase,
  openLocalDatabase,
} from "../src/storage/database.ts";
import { runs, tasks } from "../src/storage/schema.ts";

const require = createRequire(import.meta.url);
const { getEnginePath } = require("@rivetkit/engine-cli") as {
  getEnginePath(): string;
};
const fixturePath = join(
  import.meta.dir,
  "fixtures",
  "rivet-local-task-host-process.ts",
);
const actorFailoverTimeoutMs = 35_000;

setDefaultTimeout(60_000);

let suiteDirectory = "";
let endpoint = "";
let enginePort = 0;
let engine: Subprocess<"ignore", "pipe", "pipe"> | undefined;
let engineOutput: Promise<string> | undefined;

beforeAll(async () => {
  suiteDirectory = await mkdtemp(join(tmpdir(), "springroll-rivet-engine-"));
  enginePort = await findAvailablePortBlock();
  endpoint = `http://127.0.0.1:${enginePort}`;
  await startEngine();
});

afterAll(async () => {
  await stopEngine("SIGTERM");
  if (suiteDirectory) {
    await rm(suiteDirectory, { recursive: true, force: true });
  }
});

async function startEngine(): Promise<void> {
  engine = Bun.spawn([getEnginePath(), "start"], {
    env: {
      ...process.env,
      RIVET__GUARD__HOST: "127.0.0.1",
      RIVET__GUARD__PORT: String(enginePort),
      RIVET__API_PEER__HOST: "127.0.0.1",
      RIVET__API_PEER__PORT: String(enginePort + 1),
      RIVET__METRICS__HOST: "127.0.0.1",
      RIVET__METRICS__PORT: String(enginePort + 10),
      RIVET__FILE_SYSTEM__PATH: join(suiteDirectory, "engine-db"),
      RIVET__TELEMETRY__ENABLED: "false",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  engineOutput = collectOutput(engine);
  try {
    await waitFor(async () => (await fetch(`${endpoint}/health`)).ok, 15_000);
  } catch (error) {
    engine.kill("SIGTERM");
    await engine.exited;
    throw new Error(
      `Rivet Engine did not become healthy: ${String(error)}\n${await engineOutput}`,
    );
  }
}

async function stopEngine(signal: "SIGKILL" | "SIGTERM"): Promise<void> {
  if (engine && engine.exitCode === null) {
    engine.kill(signal);
    await engine.exited;
  }
}

describe.serial("local Rivet task host recovery against a real engine", () => {
  test("reconciles a claimed run when the registry starts", async () => {
    const context = await createContext("restart-reconciliation");
    seedClaimedRun(context.database, "task-reconcile", "run-reconcile");

    const child = spawnHost(context);
    await waitForHostFile(context, child, "ready");
    await waitForRunStatus(context.database, "run-reconcile", "succeeded");
    await stopHostGracefully(context, child);

    expect(child.process.exitCode).toBe(0);
    expect(existsSync(join(context.controlDirectory, "drained"))).toBe(true);
  });

  test("replays a queue message consumed by a killed registry", async () => {
    const context = await createContext("queue-replay");
    seedClaimedRun(context.database, "task-queue", "run-queue");

    const blocked = spawnHost(context, { executor: "block" });
    await waitForHostFile(context, blocked, "attempt-run-queue");
    blocked.process.kill("SIGKILL");
    await blocked.process.exited;

    await resetControlDirectory(context.controlDirectory);
    const recovered = spawnHost(context);
    await waitForHostFile(context, recovered, "ready");
    await waitForRunStatus(context.database, "run-queue", "succeeded");
    await stopHostGracefully(context, recovered);

    expect(recovered.process.exitCode).toBe(0);
  });

  test("recovers pending work after the engine and registry are killed", async () => {
    const context = await createContext("engine-restart");
    seedClaimedRun(context.database, "task-engine", "run-engine");

    const blocked = spawnHost(context, { executor: "block" });
    await waitForHostFile(context, blocked, "ready");
    await waitForHostFile(context, blocked, "attempt-run-engine");
    await stopEngine("SIGKILL");
    if (blocked.process.exitCode === null) {
      blocked.process.kill("SIGKILL");
      await blocked.process.exited;
    }

    await startEngine();
    await resetControlDirectory(context.controlDirectory);
    const recovered = spawnHost(context);
    await waitForHostFile(context, recovered, "ready");
    await waitForRunStatus(context.database, "run-engine", "succeeded");
    await stopHostGracefully(context, recovered);

    expect(recovered.process.exitCode).toBe(0);
  });

  test("fires an alarm missed while the registry is offline", async () => {
    const context = await createContext("missed-alarm");
    const dueAt = new Date(Date.now() + 5_000);
    context.database.db
      .insert(tasks)
      .values({
        id: "task-alarm",
        prompt: "Run after restart",
        schedule: "* * * * *",
        scheduleTimezone: "UTC",
        catchUpPolicy: "catch_up",
        nextRunAt: dueAt,
      })
      .run();

    const beforeDowntime = spawnHost(context);
    await waitForHostFile(context, beforeDowntime, "ready");
    beforeDowntime.process.kill("SIGKILL");
    await beforeDowntime.process.exited;
    await Bun.sleep(Math.max(0, dueAt.getTime() - Date.now() + 300));

    await resetControlDirectory(context.controlDirectory);
    const afterDowntime = spawnHost(context);
    await waitForHostFile(context, afterDowntime, "ready");
    await waitFor(
      () =>
        context.database.db
          .select()
          .from(runs)
          .all()
          .some((run) => {
            return run.taskId === "task-alarm" && run.status === "succeeded";
          }),
      15_000,
    );
    await stopHostGracefully(context, afterDowntime);

    expect(
      context.database.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, "task-alarm"))
        .get()
        ?.nextRunAt.getTime(),
    ).toBeGreaterThan(dueAt.getTime());
  }, 25_000);

  test("waits for active actor work during graceful drain", async () => {
    const context = await createContext("graceful-drain");
    seedClaimedRun(context.database, "task-drain", "run-drain");

    const child = spawnHost(context, { executor: "release" });
    await waitForHostFile(context, child, "attempt-run-drain");
    await writeFile(join(context.controlDirectory, "shutdown-request"), "");
    await Bun.sleep(200);
    expect(child.process.exitCode).toBeNull();
    expect(existsSync(join(context.controlDirectory, "drained"))).toBe(false);

    await writeFile(join(context.controlDirectory, "release"), "");
    await waitForRunStatus(context.database, "run-drain", "succeeded");
    await waitForChild(child);

    expect(child.process.exitCode).toBe(0);
    expect(existsSync(join(context.controlDirectory, "drained"))).toBe(true);
  });

  test("migrates pre-versioned actor state before reconciling work", async () => {
    const context = await createContext("state-migration");
    seedClaimedRun(context.database, "task-migrate", "run-migrate");

    const legacy = spawnHost(context, {
      hostMode: "legacy",
      taskId: "task-migrate",
    });
    await waitForHostFile(context, legacy, "ready");
    await stopHostGracefully(context, legacy);

    await resetControlDirectory(context.controlDirectory);
    const current = spawnHost(context);
    await waitForHostFile(context, current, "ready");
    await waitForRunStatus(context.database, "run-migrate", "succeeded");
    await stopHostGracefully(context, current);

    expect(current.process.exitCode).toBe(0);
  });

  test("migrates an actor database without losing existing rows", async () => {
    const context = await createContext("database-migration");
    const taskId = "task-database-migration";
    const legacy = spawnHost(context, {
      hostMode: "database-legacy",
      taskId,
    });
    await waitForHostFile(context, legacy, "ready");
    await stopHostGracefully(context, legacy);

    await resetControlDirectory(context.controlDirectory);
    const current = spawnHost(context, {
      hostMode: "database-current",
      taskId,
    });
    await waitForHostFile(context, current, "database-result.json");
    expect(
      JSON.parse(
        await readFile(
          join(context.controlDirectory, "database-result.json"),
          "utf8",
        ),
      ),
    ).toEqual({ id: "record", value: "preserved", note: "migrated" });
    await stopHostGracefully(context, current);

    expect(current.process.exitCode).toBe(0);
  });
});

interface TestContext {
  database: LocalDatabase;
  databasePath: string;
  controlDirectory: string;
}

interface ChildHost {
  process: Subprocess<"ignore", "pipe", "pipe">;
  output: Promise<string>;
}

async function createContext(name: string): Promise<TestContext> {
  const directory = join(suiteDirectory, name);
  const controlDirectory = join(directory, "control");
  await mkdir(controlDirectory, { recursive: true });
  const databasePath = join(directory, "springroll.sqlite");
  return {
    database: openLocalDatabase({ filename: databasePath }),
    databasePath,
    controlDirectory,
  };
}

function seedClaimedRun(
  database: LocalDatabase,
  taskId: string,
  runId: string,
): void {
  const scheduledTime = new Date();
  database.db
    .insert(tasks)
    .values({
      id: taskId,
      prompt: "Execute through the recovery fixture",
      schedule: "* * * * *",
      enabled: false,
      nextRunAt: new Date(scheduledTime.getTime() + 60_000),
    })
    .run();
  database.db
    .insert(runs)
    .values({
      id: runId,
      taskId,
      scheduledTime,
      status: "claimed",
      executionLocation: "local",
    })
    .run();
}

function spawnHost(
  context: TestContext,
  options: {
    executor?: "succeed" | "block" | "release";
    hostMode?: "production" | "legacy" | "database-legacy" | "database-current";
    taskId?: string;
  } = {},
): ChildHost {
  const child = Bun.spawn([process.execPath, fixturePath], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      RIVET_ENDPOINT: endpoint,
      RIVET_LOG_LEVEL: process.env.SPRINGROLL_RIVET_TEST_LOG_LEVEL ?? "error",
      SPRINGROLL_RIVET_TEST_DB: context.databasePath,
      SPRINGROLL_RIVET_TEST_CONTROL: context.controlDirectory,
      SPRINGROLL_RIVET_TEST_EXECUTOR: options.executor ?? "succeed",
      SPRINGROLL_RIVET_TEST_HOST_MODE: options.hostMode ?? "production",
      ...(options.taskId
        ? { SPRINGROLL_RIVET_TEST_TASK_ID: options.taskId }
        : undefined),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { process: child, output: collectOutput(child) };
}

async function stopHostGracefully(
  context: TestContext,
  child: ChildHost,
): Promise<void> {
  await writeFile(join(context.controlDirectory, "shutdown-request"), "");
  await waitForChild(child);
}

async function waitForChild(child: ChildHost): Promise<void> {
  await Promise.race([
    child.process.exited,
    Bun.sleep(10_000).then(() => {
      throw new Error("Timed out waiting for registry process to exit");
    }),
  ]);
  if (child.process.exitCode !== 0) {
    throw new Error(`Registry process failed:\n${await child.output}`);
  }
}

async function waitForRunStatus(
  database: LocalDatabase,
  runId: string,
  status: "succeeded" | "failed",
): Promise<void> {
  await waitFor(
    () =>
      database.db.select().from(runs).where(eq(runs.id, runId)).get()
        ?.status === status,
    15_000,
  );
}

async function resetControlDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

async function waitForHostFile(
  context: TestContext,
  child: ChildHost,
  name: string,
): Promise<void> {
  const path = join(context.controlDirectory, name);
  const deadline = Date.now() + actorFailoverTimeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (child.process.exitCode !== null) {
      throw new Error(`Registry process failed:\n${await child.output}`);
    }
    await Bun.sleep(25);
  }
  child.process.kill("SIGKILL");
  await child.process.exited;
  throw new Error(`Timed out waiting for ${name}:\n${await child.output}`);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(25);
  }
  throw new Error(
    `Timed out waiting for condition${lastError ? `: ${String(lastError)}` : ""}`,
  );
}

async function collectOutput(
  process: Subprocess<"ignore", "pipe", "pipe">,
): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return `${stdout}${stderr}`;
}

async function findAvailablePortBlock(): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 30_000);
    if (
      (await canListen(port)) &&
      (await canListen(port + 1)) &&
      (await canListen(port + 10))
    ) {
      return port;
    }
  }
  throw new Error("Could not find an available Rivet Engine port block");
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
