import { describe, expect, test } from "bun:test";
import { parseConnectorManifest } from "@springroll/kernel";
import {
  connectorRegistryMetadata,
  curatedConnectorManifests,
} from "../src/server/connector-registry.ts";

const nativeGoogleIds = new Set(["gmail", "google-calendar", "google-drive"]);
const accountIdentityIds = new Set([
  "gmail",
  "github",
  "google-calendar",
  "google-drive",
]);

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
      expect(parseConnectorManifest(structuredClone(manifest))).toEqual(
        manifest,
      );
      expect(
        nativeGoogleIds.has(manifest.id)
          ? manifest.transport.kind === "http-api"
          : manifest.transport.kind === "mcp-remote",
      ).toBe(true);
      expect(manifest.credential.kind).toBe("oauth");
      if (manifest.credential.kind === "oauth") {
        const identity = manifest.credential.accountIdentity;
        if (accountIdentityIds.has(manifest.id)) {
          expect(typeof identity?.endpoint).toBe("string");
          expect(identity?.endpoint.startsWith("https://")).toBe(true);
          expect(typeof identity?.field).toBe("string");
        } else {
          expect(identity).toBeUndefined();
        }
      }
      if (manifest.id === "gmail") {
        expect(manifest.probe).toEqual({ tool: "list_labels", input: {} });
      } else if (manifest.id === "google-calendar") {
        expect(manifest.probe).toEqual({ tool: "list_calendars", input: {} });
      } else if (manifest.id === "google-drive") {
        expect(manifest.probe).toEqual({
          tool: "search_files",
          input: { pageSize: 1 },
        });
      } else {
        expect(manifest.probe).toBeUndefined();
      }
      if (!nativeGoogleIds.has(manifest.id)) {
        expect(manifest.tools).toBeUndefined();
      }
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
      linear: "https://mcp.linear.app/mcp",
      gmail: "https://gmail.googleapis.com/gmail/v1",
      "google-calendar": "https://www.googleapis.com/calendar/v3",
      "google-drive": "https://www.googleapis.com/drive/v3",
      notion: "https://mcp.notion.com/mcp",
      stripe: "https://mcp.stripe.com",
    });
  });

  test("leaves MCP contracts to live discovery and pins native Google allowlists", () => {
    expect(
      curatedConnectorManifests
        .filter((manifest) => !nativeGoogleIds.has(manifest.id))
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

    const calendar = curatedConnectorManifests.find(
      (manifest) => manifest.id === "google-calendar",
    );
    expect(calendar?.transport.kind).toBe("http-api");
    expect(
      calendar?.transport.kind === "http-api"
        ? calendar.transport.operations.map((operation) => operation.name)
        : [],
    ).toEqual([
      "list_calendars",
      "list_events",
      "get_event",
      "create_event",
      "update_event",
      "delete_event",
    ]);
    expect(
      calendar?.credential.kind === "oauth"
        ? calendar.credential.permissionSets?.map((set) => set.id)
        : [],
    ).toEqual(["read", "write"]);

    const drive = curatedConnectorManifests.find(
      (manifest) => manifest.id === "google-drive",
    );
    expect(drive?.transport.kind).toBe("http-api");
    expect(
      drive?.transport.kind === "http-api"
        ? drive.transport.operations.map((operation) => operation.name)
        : [],
    ).toEqual([
      "search_files",
      "get_file",
      "export_file",
      "download_file",
      "create_file",
      "trash_file",
    ]);
    expect(
      drive?.credential.kind === "oauth"
        ? drive.credential.permissionSets?.map((set) => set.id)
        : [],
    ).toEqual(["read", "write"]);
  });
});
