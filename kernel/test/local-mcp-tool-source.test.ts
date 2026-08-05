import { describe, expect, test } from "bun:test";
import type { ConnectorManifest } from "../src/connector-manifest.ts";
import { localMcpProcessConfig } from "../src/local-mcp-tool-source.ts";

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
});
