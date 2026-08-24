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
      "gmail",
      "google-calendar",
      "google-drive",
      "notion",
      "stripe",
    ]);

    for (const manifest of curatedConnectorManifests) {
      expect(parseConnectorManifest(manifest)).toEqual(manifest);
      expect(
        manifest.id === "gmail"
          ? manifest.transport.kind === "http-api"
          : manifest.transport.kind === "mcp-remote",
      ).toBe(true);
      expect(manifest.credential.kind).toBe("oauth");
      if (manifest.id === "gmail") {
        expect(manifest.probe).toEqual({ tool: "list_labels", input: {} });
      } else {
        expect(manifest.probe).toBeUndefined();
      }
      if (manifest.id !== "gmail") expect(manifest.tools).toBeUndefined();
      expect(manifest.tags?.length).toBeGreaterThan(0);
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
            : manifest.transport.kind === "http-api"
              ? manifest.transport.baseUrl
              : "",
        ]),
      ),
    ).toEqual({
      github: "https://api.githubcopilot.com/mcp/",
      jira: "https://mcp.atlassian.com/v1/mcp/authv2",
      slack: "https://mcp.slack.com/mcp",
      linear: "https://mcp.linear.app/mcp/readonly",
      gmail: "https://gmail.googleapis.com/gmail/v1",
      "google-calendar": "https://calendarmcp.googleapis.com/mcp/v1",
      "google-drive": "https://drivemcp.googleapis.com/mcp/v1",
      notion: "https://mcp.notion.com/mcp",
      stripe: "https://mcp.stripe.com",
    });
  });

  test("leaves contracts to live discovery except Gmail's launch allowlist", () => {
    expect(
      curatedConnectorManifests
        .filter((manifest) => manifest.id !== "gmail")
        .every(
          (manifest) =>
            manifest.probe === undefined && manifest.tools === undefined,
        ),
    ).toBe(true);

    const gmail = curatedConnectorManifests.find(
      (manifest) => manifest.id === "gmail",
    );
    expect(gmail?.tools?.allow).toEqual([
      "create_draft",
      "get_message",
      "get_thread",
      "list_drafts",
      "list_labels",
      "search_threads",
      "send_message",
      "trash_message",
    ]);
    expect(gmail?.transport.kind).toBe("http-api");
    expect(
      gmail?.transport.kind === "http-api"
        ? gmail.transport.operations.map((operation) => operation.name)
        : [],
    ).toEqual([
      "search_threads",
      "get_thread",
      "get_message",
      "list_drafts",
      "list_labels",
      "create_draft",
      "trash_message",
      "send_message",
    ]);
    expect(
      gmail?.credential.kind === "oauth"
        ? gmail.credential.permissionSets?.map((set) => set.id)
        : [],
    ).toEqual(["read", "organize", "send"]);
    expect(gmail?.tools?.risk?.send_message).toMatchObject({
      effect: "write",
      openWorld: true,
    });
  });
});
