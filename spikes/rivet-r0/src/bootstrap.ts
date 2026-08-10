import { join } from "node:path";
import { configureSpikeEnvironment } from "./environment-config.ts";

configureSpikeEnvironment(process.env, join(import.meta.dir, "..", ".data"));

const spike = Bun.spawn(
  [
    process.execPath,
    new URL("./main.ts", import.meta.url).pathname,
    ...Bun.argv.slice(2),
  ],
  {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.on("SIGINT", () => spike.kill("SIGINT"));
process.on("SIGTERM", () => spike.kill("SIGTERM"));

process.exit(await spike.exited);
