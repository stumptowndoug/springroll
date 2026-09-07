import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetSubscriptionSignIns } from "../src/server/reset-subscription-auth.ts";

test("subscription reset scopes logout to app-owned homes and does not download support", async () => {
  const data = await mkdtemp(join(tmpdir(), "springroll-auth-reset-"));
  try {
    for (const id of ["codex", "claude"]) {
      await mkdir(join(data, id));
      await writeFile(join(data, id, "config.json"), "{}");
    }
    const calls: string[][] = [];
    await resetSubscriptionSignIns(
      data,
      async (id) => `/test/${id}`,
      async (path, args, env) => {
        calls.push([path, ...args]);
        expect(env.CODEX_HOME).toBe(join(data, "codex"));
        expect(env.CLAUDE_CONFIG_DIR).toBe(join(data, "claude"));
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      },
    );
    expect(calls).toEqual([
      ["/test/codex", "logout"],
      ["/test/claude", "auth", "logout"],
    ]);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

test("reset skips unused or externally linked homes and fails closed if existing sign-in support is missing", async () => {
  const data = await mkdtemp(join(tmpdir(), "springroll-auth-reset-"));
  try {
    const outside = join(data, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "auth.json"), "keep");
    await symlink(outside, join(data, "codex"));
    await mkdir(join(data, "claude"));
    let resolutions = 0;
    const resolve = async () => {
      resolutions++;
      return undefined;
    };
    const run = async () => {
      throw new Error("Must not log out an unrelated home");
    };
    await resetSubscriptionSignIns(data, resolve, run);
    expect(resolutions).toBe(0);
    await writeFile(join(data, "claude", "config.json"), "{}");
    await expect(resetSubscriptionSignIns(data, resolve, run)).rejects.toThrow(
      "Restore Claude support",
    );
    expect(await Bun.file(join(outside, "auth.json")).text()).toBe("keep");
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
