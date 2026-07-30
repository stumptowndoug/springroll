import { createDevelopmentCliActions } from "./live-actions.ts";
import { runCli } from "./run-cli.ts";

process.exitCode = await runCli(process.argv.slice(2), {
  actions: createDevelopmentCliActions(),
  environment: process.env,
  output: {
    write: (message) => console.log(message),
    writeError: (message) => console.error(message),
  },
});
