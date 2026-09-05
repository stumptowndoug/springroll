import { configureLocalRivetEnvironment } from "./server/rivet-environment.ts";
import { resolveRuntimePaths } from "./server/runtime-paths.ts";

const { databasePath } = resolveRuntimePaths(process.env);

// RivetKit's native module snapshots its storage environment before any
// application module body can run. Start the server in a child process so the
// configured values are present in that process from its first import.
configureLocalRivetEnvironment(process.env, databasePath);

const forwardedArguments = Bun.argv.slice(2);
const watchServer = forwardedArguments[0] === "--watch-server";
if (watchServer) forwardedArguments.shift();

const command = [process.execPath];
command.push("--no-env-file");
if (watchServer) command.push("--watch");
command.push(fileURLToPath(new URL("./server.ts", import.meta.url)));
command.push(...forwardedArguments);

const server = Bun.spawn(command, {
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));

process.exit(await server.exited);

import { fileURLToPath } from "node:url";
