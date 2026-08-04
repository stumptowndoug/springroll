import { describe, expect, test } from "bun:test";
import {
  type CommandRequest,
  type KeyringEntryFactory,
  MacOsKeychainCredentialStore,
} from "../src/credentials.ts";

describe("MacOsKeychainCredentialStore", () => {
  test("stores full credentials through the OS keyring", async () => {
    const keyring = createMemoryKeyring();
    const requests: CommandRequest[] = [];
    const store = new MacOsKeychainCredentialStore({
      service: "test.springroll",
      entryFactory: keyring.entryFactory,
      runCommand: async (request) => {
        requests.push(request);
        return { exitCode: 44, stdout: "", stderr: "not found" };
      },
    });
    const secret = `oauth-${"x".repeat(512)}`;

    await store.put("neon-default", secret);
    expect(await store.get("neon-default")).toBe(secret);
    expect(keyring.values.get("test.springroll:neon-default")).toBe(secret);

    await store.delete("neon-default");
    expect(await store.get("neon-default")).toBeUndefined();
    expect(JSON.stringify(requests.map(({ args }) => args))).not.toContain(
      secret,
    );
  });

  test("migrates the legacy service name without exposing the value", async () => {
    const keyring = createMemoryKeyring();
    const requests: CommandRequest[] = [];
    const store = new MacOsKeychainCredentialStore({
      securityPath: "/test/security",
      entryFactory: keyring.entryFactory,
      runCommand: async (request) => {
        requests.push(request);
        if (request.args.includes("find-generic-password")) {
          return { exitCode: 0, stdout: "legacy-secret\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(await store.get("neon-mcp-default")).toBe("legacy-secret");
    expect(
      keyring.values.get("dev.springroll.credentials:neon-mcp-default"),
    ).toBe("legacy-secret");
    expect(
      requests.some(
        (request) =>
          request.args[0] === "/test/security" &&
          request.args.includes("dev.shrimp-roll.model-api-keys") &&
          request.args.includes("delete-generic-password"),
      ),
    ).toBe(true);
    expect(JSON.stringify(requests.map(({ args }) => args))).not.toContain(
      "legacy-secret",
    );
  });

  test("returns undefined when neither credential service has the reference", async () => {
    const keyring = createMemoryKeyring();
    const store = new MacOsKeychainCredentialStore({
      entryFactory: keyring.entryFactory,
      runCommand: async () => ({
        exitCode: 44,
        stdout: "",
        stderr: "The specified item could not be found.",
      }),
    });

    expect(await store.get("missing")).toBeUndefined();
  });
});

function createMemoryKeyring(): {
  values: Map<string, string>;
  entryFactory: KeyringEntryFactory;
} {
  const values = new Map<string, string>();
  return {
    values,
    entryFactory: (service, reference) => {
      const key = `${service}:${reference}`;
      return {
        getPassword: () => values.get(key) ?? null,
        setPassword: (password) => {
          values.set(key, password);
        },
        deleteCredential: () => values.delete(key),
      };
    },
  };
}
