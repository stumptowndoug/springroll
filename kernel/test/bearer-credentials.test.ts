import { expect, test } from "bun:test";
import type { ConnectorManifest } from "../src/connector-manifest.ts";
import { createDocumentedApiToolSource } from "../src/documented-api-tool-source.ts";
import { createOpenApiToolSource } from "../src/openapi-tool-source.ts";

for (const kind of ["http-api", "openapi"] as const) {
  for (const authentication of ["bearer", "raw", "default"] as const) {
    test(`${kind} sends ${authentication} Authorization credentials as configured`, async () => {
      const credential: ConnectorManifest["credential"] = {
        kind: "api-key",
        placeholder: "API key",
        ...(authentication === "default" ? {} : { header: "Authorization" }),
        ...(authentication === "bearer" ? { format: "bearer" as const } : {}),
      };
      const baseUrl = "https://api.example.test/v1";
      const manifest: ConnectorManifest = {
        id: "analytics",
        name: "Analytics",
        blurb: "Read websites",
        credential,
        transport:
          kind === "http-api"
            ? {
                kind,
                baseUrl,
                operations: [
                  {
                    name: "getWebsites",
                    method: "GET",
                    path: "/websites",
                    description: "List websites",
                    inputSchema: {
                      type: "object",
                      properties: {},
                      additionalProperties: false,
                    },
                    effect: "read",
                  },
                ],
              }
            : { kind, baseUrl, specUrl: "https://example.test/openapi.json" },
      };
      const requests: { url: string; authorization: string | null }[] = [];
      const options = {
        manifest,
        credentials: {
          get: async () => "secret-key",
          put: async () => {},
          delete: async () => {},
        },
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).endsWith("openapi.json"))
            return Response.json({
              openapi: "3.1.0",
              info: { title: "Analytics", version: "1" },
              paths: {
                "/websites": {
                  get: {
                    operationId: "getWebsites",
                    responses: { "200": { description: "Websites" } },
                  },
                },
              },
            });
          requests.push({
            url: String(input),
            authorization: new Headers(init?.headers).get("authorization"),
          });
          return Response.json({ data: [] });
        },
      };
      const source =
        kind === "http-api"
          ? createDocumentedApiToolSource(options)
          : createOpenApiToolSource(options);
      const session = await source.open({
        connection: {
          id: "analytics",
          sourceId: kind,
          manifestId: manifest.id,
          credentialRef: "analytics-key",
          availableIn: ["local"],
        },
        location: "local",
      });
      try {
        await session.callTool(
          "getWebsites",
          {},
          { taskId: "test", runId: "test" },
        );
        expect(requests).toEqual([
          {
            url: `${baseUrl}/websites`,
            authorization:
              authentication === "raw" ? "secret-key" : "Bearer secret-key",
          },
        ]);
      } finally {
        await session.close();
      }
    });
  }
}
