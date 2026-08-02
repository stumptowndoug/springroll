import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/credentials.ts";
import { SpringrollPiCredentialStore } from "../src/pi-credential-store.ts";

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();

  async get(reference: string): Promise<string | undefined> {
    return this.values.get(reference);
  }

  async put(reference: string, secret: string): Promise<void> {
    this.values.set(reference, secret);
  }

  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

describe("SpringrollPiCredentialStore", () => {
  test("adapts a Springroll credential reference without exposing other keys", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.values.set("openrouter-key", "sk-or-test");
    credentials.values.set("unrelated-key", "do-not-expose");
    const store = new SpringrollPiCredentialStore(credentials, [
      {
        providerId: "openrouter",
        credentialRef: "openrouter-key",
      },
    ]);

    expect(await store.read("openrouter")).toEqual({
      type: "api_key",
      key: "sk-or-test",
    });
    expect(await store.read("anthropic")).toBeUndefined();
    expect(await store.list()).toEqual([
      { providerId: "openrouter", type: "api_key" },
    ]);
  });

  test("persists OAuth refreshes through the injected store", async () => {
    const credentials = new MemoryCredentialStore();
    const store = new SpringrollPiCredentialStore(credentials, [
      {
        providerId: "openai-codex",
        credentialRef: "codex-subscription",
      },
    ]);
    const refreshed = {
      type: "oauth" as const,
      access: "new-access",
      refresh: "new-refresh",
      expires: 1_800_000_000_000,
    };

    await store.modify("openai-codex", async () => refreshed);

    expect(await store.read("openai-codex")).toEqual(refreshed);
    expect(credentials.values.get("codex-subscription")).toStartWith(
      "shrimp-roll:pi-credential:v1:",
    );
    await store.delete("openai-codex");
    expect(await store.read("openai-codex")).toBeUndefined();
  });
});
