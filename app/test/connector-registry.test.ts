import { describe, expect, test } from "bun:test";
import { parseConnectorManifest } from "@springroll/kernel";
import {
  connectorRegistryMetadata,
  curatedConnectorManifests,
} from "../src/server/connector-registry.ts";

describe("curated connector registry", () => {
  test("ships the verified provider manifests", () => {
    expect(curatedConnectorManifests.map((manifest) => manifest.id)).toEqual([
      "github",
      "jira",
      "slack",
      "linear",
    ]);

    for (const manifest of curatedConnectorManifests) {
      expect(parseConnectorManifest(manifest)).toEqual(manifest);
      expect(manifest.transport.kind).toBe("mcp-remote");
      expect(manifest.credential.kind).toBe(
        manifest.id === "github" ? "api-key" : "oauth",
      );
      expect(manifest.probe).toBeUndefined();
      expect(manifest.tools).toBeUndefined();
      expect(manifest.tags).toHaveLength(1);
      expect(connectorRegistryMetadata.get(manifest.id)?.operator).toBeTruthy();
    }
  });

  test("uses the providers' official hosted endpoints", () => {
    expect(
      Object.fromEntries(
        curatedConnectorManifests.map((manifest) => [
          manifest.id,
          manifest.transport.kind === "mcp-remote"
            ? manifest.transport.endpoint
            : "",
        ]),
      ),
    ).toEqual({
      github: "https://api.githubcopilot.com/mcp/readonly",
      jira: "https://mcp.atlassian.com/v1/mcp/authv2",
      slack: "https://mcp.slack.com/mcp",
      linear: "https://mcp.linear.app/mcp/readonly",
    });
  });

  test("leaves tool contracts to live MCP discovery", () => {
    expect(
      curatedConnectorManifests.every(
        (manifest) =>
          manifest.probe === undefined && manifest.tools === undefined,
      ),
    ).toBe(true);
  });
});
