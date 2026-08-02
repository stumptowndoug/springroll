import { describe, expect, test } from "bun:test";
import {
  type CommandRequest,
  MacOsKeychainCredentialStore,
} from "../src/credentials.ts";

describe("MacOsKeychainCredentialStore", () => {
  test("passes secrets over stdin instead of command arguments", async () => {
    const requests: CommandRequest[] = [];
    const store = new MacOsKeychainCredentialStore({
      service: "test.springroll",
      securityPath: "/test/security",
      expectPath: "/test/expect",
      runCommand: async (request) => {
        requests.push(request);

        if (request.args.includes("find-generic-password")) {
          return {
            exitCode: 0,
            stdout: "sk-test-secret\n",
            stderr: "",
          };
        }

        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await store.put("openai-default", "sk-test-secret");
    expect(await store.get("openai-default")).toBe("sk-test-secret");
    await store.delete("openai-default");

    expect(requests[0]?.args.slice(0, 2)).toEqual(["/test/expect", "-c"]);
    expect(requests[0]?.stdin).toBe("sk-test-secret\n");
    expect(requests[0]?.environment).toEqual({
      SPRINGROLL_SECURITY_PATH: "/test/security",
      SPRINGROLL_KEYCHAIN_ACCOUNT: "openai-default",
      SPRINGROLL_KEYCHAIN_SERVICE: "test.springroll",
    });
    expect(
      JSON.stringify(
        requests.map(({ args, environment }) => ({ args, environment })),
      ),
    ).not.toContain("sk-test-secret");
  });

  test("returns undefined when Keychain does not contain the reference", async () => {
    const store = new MacOsKeychainCredentialStore({
      runCommand: async () => ({
        exitCode: 44,
        stdout: "",
        stderr: "The specified item could not be found.",
      }),
    });

    expect(await store.get("missing")).toBeUndefined();
  });
});
