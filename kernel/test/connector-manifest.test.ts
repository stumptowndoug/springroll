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
    const documentedApi = parseConnectorManifest({
      id: "documented-widgets",
      name: "Documented Widgets",
      blurb: "A small adapter summarized from provider documentation.",
      transport: {
        kind: "http-api",
        baseUrl: "https://api.example.com/v1",
        operations: [
          {
            name: "get_widget",
            description: "Read one widget.",
            method: "GET",
            path: "/widgets/{widgetId}",
            inputSchema: {
              type: "object",
              properties: { widgetId: { type: "string" } },
              required: ["widgetId"],
              additionalProperties: false,
            },
            parameters: [
              {
                input: "widgetId",
                name: "widgetId",
                location: "path",
                required: true,
              },
            ],
            effect: "read",
          },
        ],
      },
      credential: { kind: "none" },
    });

    expect(openApi.transport.kind).toBe("openapi");
    expect(openApi.tags).toEqual(["analytics", "data"]);
    expect(openApi.logoSource).toBe("github-repository");
    expect(remoteMcp.credential.kind).toBe("oauth");
    expect(publicApi.credential.kind).toBe("none");
    expect(connectorAvailableIn(openApi)).toEqual(["local", "hosted"]);
    expect(connectorAvailableIn(remoteMcp)).toEqual(["local", "hosted"]);
    expect(connectorAvailableIn(localMcp)).toEqual(["local"]);
    expect(connectorAvailableIn(documentedApi)).toEqual(["local", "hosted"]);
    expect(
      parseConnectorManifest({
        ...documentedApi,
        credential: {
          kind: "api-key",
          placeholder: "Documented API key",
          query: "api_key",
        },
      }).credential,
    ).toMatchObject({ kind: "api-key", query: "api_key" });
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
      "query API key on a non-documented transport",
      {
        ...openApiManifest,
        credential: {
          kind: "api-key",
          placeholder: "Widget key",
          query: "api_key",
        },
      },
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
    [
      "documented API path without parameter mapping",
      {
        ...openApiManifest,
        transport: {
          kind: "http-api",
          baseUrl: "https://api.example.com",
          operations: [
            {
              name: "get_widget",
              description: "Read one widget.",
              method: "GET",
              path: "/widgets/{widgetId}",
              inputSchema: { type: "object" },
              effect: "read",
            },
          ],
        },
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseConnectorManifest(value)).toThrow();
  });
});
