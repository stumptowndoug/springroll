import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type SubscriptionRuntimeId,
  SubscriptionRuntimeManager,
  subscriptionRuntimeEnvironment,
} from "@springroll/kernel";

export async function resetSubscriptionSignIns(
  data: string,
  resolveExecutable: (id: SubscriptionRuntimeId) => Promise<string | undefined>,
  run: (path: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>,
) {
  for (const id of ["codex", "claude"] as const) {
    const home = join(data, id);
    const info = await lstat(home).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    // A linked external CLI home is not Springroll-owned authentication.
    if (!info || info.isSymbolicLink()) continue;
    if ((await readdir(home)).length === 0) continue;
    for (const file of [
      "auth.json",
      "config.toml",
      ".credentials.json",
      ".claude.json",
    ]) {
      if (
        (await lstat(join(home, file)).catch(() => undefined))?.isSymbolicLink()
      )
        throw new Error(
          `Remove the linked ${id} configuration before resetting this workspace.`,
        );
    }
    const path = await resolveExecutable(id);
    if (!path)
      throw new Error(
        `Restore ${id === "codex" ? "Codex" : "Claude"} support in Settings before resetting its saved sign-in.`,
      );
    await run(path, id === "codex" ? ["logout"] : ["auth", "logout"], {
      ...subscriptionRuntimeEnvironment(),
      CODEX_HOME: join(data, "codex"),
      CLAUDE_CONFIG_DIR: join(data, "claude"),
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
      CLAUDE_CODE_USE_BEDROCK: undefined,
      CLAUDE_CODE_USE_FOUNDRY: undefined,
      CLAUDE_CODE_USE_VERTEX: undefined,
    });
  }
}

if (import.meta.main) {
  const data = process.env.SPRINGROLL_DATA_DIR;
  if (process.env.SPRINGROLL_RESET_AUTH !== "1" || !data?.startsWith("/"))
    throw new Error("Subscription reset must be started by the desktop app");
  const manager = new SubscriptionRuntimeManager({
    root: join(data, "subscription-runtimes"),
  });
  try {
    await resetSubscriptionSignIns(
      data,
      (id) => manager.find(id),
      async (path, args, env) => {
        const child = Bun.spawn([path, ...args], {
          env,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        });
        const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
        try {
          if ((await child.exited) !== 0)
            throw new Error(
              "Subscription sign-out failed. Reopen Springroll and retry reset.",
            );
        } finally {
          clearTimeout(timeout);
        }
      },
    );
  } finally {
    manager.close();
  }
}
