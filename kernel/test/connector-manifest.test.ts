import { describe, expect, test } from "bun:test";
import {
  connectorAvailableIn,
  parseConnectorManifest,
} from "../src/connector-manifest.ts";

const openApiManifest = {
  id: "widgets",
  name: "Widgets",
  blurb: "<b>Widgets</b> — inspect and manage widgets.",
  logoSvg: '<svg viewBox="0 0 16 16"></svg>',
  transport: {
    kind: "openapi",
    specUrl: "https://api.example.com/openapi.json",
    baseUrl: "https://api.example.com/v1",
  },
  credential: {
    kind: "api-key",
    placeholder: "Widget key",
    keyCreationUrl: "https://example.com/settings/keys",
    header: "X-API-Key",
  },
  probe: { tool: "get_widget", input: { widgetId: "probe" } },
  tools: {
    allow: ["get_widget", "create_widget"],
    risk: {
      get_widget: { effect: "read", idempotent: true },
      create_widget: { effect: "write" },
    },
  },
} as const;

describe("ConnectorManifest validation", () => {
  test("accepts the supported transports and credential rails", () => {
    const openApi = parseConnectorManifest(openApiManifest);
    const remoteMcp = parseConnectorManifest({
      id: "notes",
      name: "Notes",
      blurb: "<b>Notes</b> — read notes.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.example.com/mcp",
      },
      credential: { kind: "oauth" },
      probe: { tool: "list_notes", input: {} },
    });
    const publicApi = parseConnectorManifest({
      ...openApiManifest,
      id: "public-widgets",
      credential: { kind: "none" },
    });

    expect(openApi.transport.kind).toBe("openapi");
    expect(remoteMcp.credential.kind).toBe("oauth");
    expect(publicApi.credential.kind).toBe("none");
    expect(connectorAvailableIn(openApi)).toEqual(["local", "hosted"]);
    expect(connectorAvailableIn(remoteMcp)).toEqual(["local", "hosted"]);
  });

  test.each([
    ["authored availableIn", { ...openApiManifest, availableIn: ["local"] }],
    [
      "unsupported local MCP transport",
      {
        ...openApiManifest,
        transport: { kind: "mcp-local", command: ["connector"] },
      },
    ],
    ["missing probe", { ...openApiManifest, probe: undefined }],
    [
      "unsupported credential rail",
      { ...openApiManifest, credential: { kind: "password" } },
    ],
    [
      "probe omitted from allowlist",
      {
        ...openApiManifest,
        tools: { allow: ["create_widget"] },
      },
    ],
    [
      "mutating probe override",
      {
        ...openApiManifest,
        tools: {
          allow: ["get_widget"],
          risk: { get_widget: { effect: "write" } },
        },
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseConnectorManifest(value)).toThrow();
  });
});
