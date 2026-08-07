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
  logoUrl: "https://raw.githubusercontent.com/example/widgets/main/icon.png",
  logoSource: "github-repository",
  tags: ["Analytics", "Data"],
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
    const localMcp = parseConnectorManifest({
      id: "clarity",
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
    });

    expect(openApi.transport.kind).toBe("openapi");
    expect(openApi.tags).toEqual(["analytics", "data"]);
    expect(openApi.logoSource).toBe("github-repository");
    expect(remoteMcp.credential.kind).toBe("oauth");
    expect(publicApi.credential.kind).toBe("none");
    expect(connectorAvailableIn(openApi)).toEqual(["local", "hosted"]);
    expect(connectorAvailableIn(remoteMcp)).toEqual(["local", "hosted"]);
    expect(connectorAvailableIn(localMcp)).toEqual(["local"]);
  });

  test.each([
    ["authored availableIn", { ...openApiManifest, availableIn: ["local"] }],
    [
      "unpinned local MCP package",
      {
        ...openApiManifest,
        transport: {
          kind: "mcp-local",
          package: { registry: "npm", name: "connector", version: "latest" },
        },
        credential: { kind: "none" },
      },
    ],
    [
      "local API key without environment injection",
      {
        ...openApiManifest,
        transport: {
          kind: "mcp-local",
          package: { registry: "npm", name: "connector", version: "1.0.0" },
        },
      },
    ],
    [
      "unsupported credential rail",
      { ...openApiManifest, credential: { kind: "password" } },
    ],
    [
      "duplicate normalized tags",
      { ...openApiManifest, tags: ["Analytics", "analytics"] },
    ],
    ["logo without provenance", { ...openApiManifest, logoSource: undefined }],
    ["provenance without logo", { ...openApiManifest, logoUrl: undefined }],
    [
      "insecure logo URL",
      { ...openApiManifest, logoUrl: "http://example.com/icon.png" },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseConnectorManifest(value)).toThrow();
  });
});
