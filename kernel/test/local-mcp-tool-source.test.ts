import { describe, expect, test } from "bun:test";
import type { MCPClient } from "@ai-sdk/mcp";
import type { ConnectorManifest } from "../src/connector-manifest.ts";
import type { CredentialStore } from "../src/credentials.ts";
import { MissingCredentialError } from "../src/credentials.ts";
import {
  createLocalMcpToolSource,
  LocalMcpProcessError,
  localMcpProcessConfig,
} from "../src/local-mcp-tool-source.ts";
import { ToolPolicyError } from "../src/tools.ts";

const manifest: ConnectorManifest = {
  id: "microsoft-clarity",
  name: "Microsoft Clarity",
  blurb: "<b>Analytics</b> — inspect Clarity projects.",
  transport: {
    kind: "mcp-local",
    package: {
      registry: "npm",
      name: "@microsoft/clarity-mcp-server",
      version: "2.0.1",
    },
  },
  credential: {
    kind: "api-key",
    placeholder: "Clarity API token",
    keyCreationUrl: "https://clarity.microsoft.com/",
    env: "CLARITY_API_TOKEN",
  },
};

describe("local MCP package launch", () => {
  test("derives a shell-free pinned command and injects the key only through the host environment", () => {
    const config = localMcpProcessConfig(manifest, "secret-value");

    expect(config.command).toMatch(/^npx(?:\.cmd)?$/);
    expect(config.args).toEqual([
      "--yes",
      "@microsoft/clarity-mcp-server@2.0.1",
    ]);
    expect(config.env).toEqual({ CLARITY_API_TOKEN: "secret-value" });
    expect(JSON.stringify(config.args)).not.toContain("secret-value");
  });

  test("refuses to open on a hosted run", async () => {
    const source = createLocalMcpToolSource({
      manifest,
      credentials: memoryCredentials("token"),
      createClient: async () => {
        throw new Error("hosted runs must not spawn local MCP");
      },
    });

    await expect(
      source.open({
        connection: localConnection(),
        location: "hosted",
      }),
    ).rejects.toBeInstanceOf(ToolPolicyError);
    await expect(
      source.open({
        connection: localConnection(),
        location: "hosted",
      }),
    ).rejects.toThrow("cannot run hosted");
  });

  test("preserves reviewed non-secret package subcommands", () => {
    const config = localMcpProcessConfig({
      id: "firebase-mcp",
      name: "Firebase MCP",
      blurb: "Official Firebase MCP server.",
      transport: {
        kind: "mcp-local",
        package: {
          registry: "npm",
          name: "firebase-tools",
          version: "15.25.1",
        },
        args: ["mcp"],
      },
      credential: { kind: "none" },
    });

    expect(config.args).toEqual(["--yes", "firebase-tools@15.25.1", "mcp"]);
    expect(config.env).toEqual({});
  });

  test("classifies a missing key before starting the package", async () => {
    let starts = 0;
    const source = createLocalMcpToolSource({
      manifest,
      credentials: memoryCredentials(undefined),
      createClient: async () => {
        starts += 1;
        return {} as MCPClient;
      },
    });

    await expect(
      source.open({
        connection: localConnection(),
        location: "local",
      }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(starts).toBe(0);
  });

  test("normalizes package startup failures and redacts the injected key", async () => {
    const credential = "local-process-secret";
    const source = createLocalMcpToolSource({
      manifest,
      credentials: memoryCredentials(credential),
      createClient: async () => {
        throw new Error(`process closed after receiving ${credential}`);
      },
    });

    try {
      await source.open({
        connection: localConnection(),
        location: "local",
      });
      throw new Error("Expected local MCP startup to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalMcpProcessError);
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("could not start"),
      );
      expect(String(error)).toContain("[REDACTED]");
      expect(String(error)).not.toContain(credential);
    }
  });

  test("reuses one package process across overlapping opens", async () => {
    let starts = 0;
    let closes = 0;
    const source = createLocalMcpToolSource({
      manifest,
      credentials: memoryCredentials("token"),
      idleTimeoutMs: 0,
      createClient: async () => {
        starts += 1;
        return {
          async listTools() {
            return { tools: [] };
          },
          async callTool() {
            return { content: [] };
          },
          async close() {
            closes += 1;
          },
        } as unknown as MCPClient;
      },
    });

    const first = await source.open({
      connection: localConnection(),
      location: "local",
    });
    const second = await source.open({
      connection: localConnection(),
      location: "local",
    });
    expect(starts).toBe(1);
    await first.close();
    expect(closes).toBe(0);
    await second.close();
    expect(closes).toBe(1);
  });

  test("redacts a credential when the package exits after startup", async () => {
    const credential = "local-runtime-secret";
    const source = createLocalMcpToolSource({
      manifest,
      credentials: memoryCredentials(credential),
      createClient: async () =>
        ({
          async listTools() {
            throw new Error(`stdio closed and echoed ${credential}`);
          },
          async close() {},
        }) as unknown as MCPClient,
    });
    const session = await source.open({
      connection: localConnection(),
      location: "local",
    });

    try {
      await session.listTools();
      throw new Error("Expected local MCP process exit to fail discovery");
    } catch (error) {
      expect(String(error)).toContain("stdio closed and echoed [REDACTED]");
      expect(String(error)).not.toContain(credential);
    }
  });
});

function memoryCredentials(value: string | undefined): CredentialStore {
  return {
    async get() {
      return value;
    },
    async put() {},
    async delete() {},
  };
}

function localConnection() {
  return {
    id: "microsoft-clarity-default",
    sourceId: "mcp-local",
    manifestId: manifest.id,
    credentialRef: "connector-microsoft-clarity-default",
    availableIn: ["local"] as const,
  };
}
