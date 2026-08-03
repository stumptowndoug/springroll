import { describe, expect, test } from "bun:test";
import { parseConnectorManifest } from "@springroll/kernel";
import {
  connectorRegistryMetadata,
  curatedConnectorManifests,
} from "../src/server/connector-registry.ts";

describe("curated connector registry", () => {
  test("ships the five verified provider manifests", () => {
    expect(curatedConnectorManifests.map((manifest) => manifest.id)).toEqual([
      "gmail",
      "github",
      "notion",
      "slack",
      "linear",
    ]);

    for (const manifest of curatedConnectorManifests) {
      expect(parseConnectorManifest(manifest)).toEqual(manifest);
      expect(manifest.transport.kind).toBe("mcp-remote");
      expect(manifest.credential.kind).toBe("oauth");
      expect(manifest.tools?.allow).toContain(manifest.probe.tool);
      expect(manifest.tools?.risk?.[manifest.probe.tool]?.effect).toBe("read");
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
      gmail: "https://gmailmcp.googleapis.com/mcp/v1",
      github: "https://api.githubcopilot.com/mcp/readonly",
      notion: "https://mcp.notion.com/mcp",
      slack: "https://mcp.slack.com/mcp",
      linear: "https://mcp.linear.app/mcp/readonly",
    });
    expect(
      Object.fromEntries(
        Array.from(connectorRegistryMetadata, ([id, value]) => [
          id,
          value.oauthReady,
        ]),
      ),
    ).toEqual({
      gmail: false,
      github: true,
      notion: true,
      slack: false,
      linear: true,
    });
  });
});
