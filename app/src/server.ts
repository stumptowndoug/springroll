import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AgentRunner,
  AiSdkAgentRunner,
  CronScheduleEngine,
  defaultOpenRouterModelPricing,
  MacOsKeychainCredentialStore,
  OpenRouterModelConnection,
  openLocalDatabase,
  PiAgentRunner,
  SqliteTickStore,
  startLocalTickLoop,
  tick,
} from "@shrimp-roll/kernel";
import { LocalApplication } from "./server/application.ts";
import { createHttpApp, type HttpAppAssets } from "./server/http-app.ts";
import { AiTaskProposalGenerator } from "./server/proposal-generator.ts";
import { openRouterCredentialRef } from "./server/sources.ts";

const databasePath =
  process.env.SHRIMPROLL_DB_PATH ??
  new URL("../../.local/shrimproll.sqlite", import.meta.url).pathname;
mkdirSync(dirname(databasePath), { recursive: true });

const localDatabase = openLocalDatabase({ filename: databasePath });
const credentials = new MacOsKeychainCredentialStore();
const models = new OpenRouterModelConnection(credentials);
const agent: AgentRunner = {
  async run(request) {
    const requiresProviderTools = request.tools.some(
      (tool) => tool.descriptor.providerTool !== undefined,
    );
    if (!requiresProviderTools) {
      const runtime = await models.loadPiAgentRuntime(openRouterCredentialRef);
      return new PiAgentRunner(runtime).run(request);
    }

    const runtime = await models.loadAgentRuntime(openRouterCredentialRef);
    return new AiSdkAgentRunner(runtime.model, {
      pricing: defaultOpenRouterModelPricing,
      providerTools: runtime.providerTools,
    }).run(request);
  },
};
const application = new LocalApplication(localDatabase.db, {
  credentials,
  models,
  agent,
  proposalGenerator: new AiTaskProposalGenerator(models),
});
application.ensureBuiltinConnections();

const tickStore = new SqliteTickStore(localDatabase.db);
const schedule = new CronScheduleEngine(localDatabase.db);
const tickLoop = startLocalTickLoop({
  tick: () =>
    tick({
      store: tickStore,
      schedule,
      executor: application.executor,
    }).then(() => undefined),
  onError: (error) => {
    console.error(
      "Scheduled task check failed:",
      error instanceof Error ? error.message : String(error),
    );
  },
});

const assets = await loadAssets();
const httpApp = createHttpApp(application, assets);
const port = readPort(process.env.PORT);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: httpApp.fetch,
});

console.log(`ShrimpRoll is ready at ${server.url}`);

const shutdown = () => {
  tickLoop.stop();
  server.stop();
  localDatabase.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function loadAssets(): Promise<HttpAppAssets> {
  const indexUrl = new URL("./client/index.html", import.meta.url);
  const indexHtml = await Bun.file(indexUrl).text();
  const assetsRoot = new URL("../dist/", import.meta.url);

  return {
    indexHtml,
    async read(path) {
      if (!/^[a-zA-Z0-9._-]+$/.test(path)) {
        return undefined;
      }
      const file = Bun.file(new URL(path, assetsRoot));
      if (!(await file.exists())) {
        return undefined;
      }

      return new Response(file);
    },
  };
}

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return 4117;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("PORT must be an integer between 1 and 65535");
  }
  return port;
}
