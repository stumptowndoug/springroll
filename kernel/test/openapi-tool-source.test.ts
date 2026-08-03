import { describe, expect, test } from "bun:test";
import type { ConnectorManifest } from "../src/connector-manifest.ts";
import type { CredentialStore } from "../src/credentials.ts";
import {
  createOpenApiToolSource,
  normalizeOpenApiTools,
  toolRiskForOpenApiMethod,
} from "../src/openapi-tool-source.ts";

class MemoryCredentialStore implements CredentialStore {
  value: string | undefined;

  async get(): Promise<string | undefined> {
    return this.value;
  }

  async put(_reference: string, secret: string): Promise<void> {
    this.value = secret;
  }

  async delete(): Promise<void> {
    this.value = undefined;
  }
}

const manifest: ConnectorManifest = {
  id: "openapi.widgets",
  name: "Widgets",
  blurb: "<b>Widgets</b> — inspect and manage widgets.",
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
  probe: { tool: "getWidget", input: { widgetId: "probe" } },
  tools: {
    allow: ["getWidget", "createWidget", "deleteWidget"],
    risk: { createWidget: { idempotent: true } },
  },
};

async function fixture(): Promise<unknown> {
  return Bun.file(
    new URL("./fixtures/widgets-openapi.json", import.meta.url),
  ).json();
}

describe("OpenAPI tool normalization", () => {
  test("normalizes fixture operations into descriptors and strips the credential header", async () => {
    const descriptors = normalizeOpenApiTools(await fixture(), manifest);

    expect(descriptors.map((descriptor) => descriptor.name)).toEqual([
      "getWidget",
      "deleteWidget",
      "createWidget",
    ]);
    expect(descriptors[0]).toEqual({
      name: "getWidget",
      description: "Read one widget",
      inputSchema: {
        type: "object",
        properties: {
          widgetId: {
            type: "string",
            description: "Widget identifier",
          },
          verbose: { type: "boolean" },
        },
        required: ["widgetId"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
        required: ["id", "name"],
        additionalProperties: false,
      },
      declaredRisk: {
        effect: "read",
        openWorld: true,
        idempotent: true,
      },
    });
    expect(descriptors[2]?.inputSchema).toMatchObject({
      properties: {
        body: {
          type: "object",
          required: ["name"],
        },
      },
      required: ["body"],
    });
    expect(descriptors[2]?.declaredRisk).toEqual({
      effect: "write",
      openWorld: true,
      idempotent: true,
    });
    expect(JSON.stringify(descriptors)).not.toContain("X-API-Key");
  });

  test("maps HTTP methods to semantic tool risk", () => {
    expect(toolRiskForOpenApiMethod("GET").effect).toBe("read");
    expect(toolRiskForOpenApiMethod("POST").effect).toBe("write");
    expect(toolRiskForOpenApiMethod("PUT").effect).toBe("write");
    expect(toolRiskForOpenApiMethod("PATCH").effect).toBe("write");
    expect(toolRiskForOpenApiMethod("DELETE").effect).toBe("destructive");
  });
});

describe("OpenAPI tool execution", () => {
  test("caches the spec and injects then redacts the API key host-side", async () => {
    if (manifest.transport.kind !== "openapi") {
      throw new Error("Expected the OpenAPI test manifest");
    }
    const specUrl = manifest.transport.specUrl;
    const credentials = new MemoryCredentialStore();
    const spec = await fixture();
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly apiKey: string | null;
    }> = [];
    let specFetches = 0;
    const source = createOpenApiToolSource({
      manifest,
      credentials,
      fetch: async (input, init) => {
        const url = String(input);
        if (url === specUrl) {
          specFetches += 1;
          return Response.json(spec);
        }
        requests.push({
          url,
          method: init?.method ?? "GET",
          apiKey: new Headers(init?.headers).get("x-api-key"),
        });
        return Response.json({
          id: "widget-1",
          name: "safe",
          echoed: "secret-value",
        });
      },
    });
    const connection = {
      id: "widgets-connection",
      sourceId: manifest.id,
      credentialRef: "widgets-key",
      availableIn: ["local", "hosted"] as const,
    };
    const first = await source.open({ connection, location: "local" });
    const second = await source.open({ connection, location: "hosted" });

    await first.listTools();
    await second.listTools();
    expect(specFetches).toBe(1);

    credentials.value = "secret-value";
    const result = await first.callTool(
      "getWidget",
      { widgetId: "widget-1", verbose: true },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(requests).toEqual([
      {
        url: "https://api.example.com/v1/widgets/widget-1?verbose=true",
        method: "GET",
        apiKey: "secret-value",
      },
    ]);
    expect(result).toEqual({
      content: [{ id: "widget-1", name: "safe", echoed: "[REDACTED]" }],
      structuredContent: {
        id: "widget-1",
        name: "safe",
        echoed: "[REDACTED]",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    await first.close();
    await second.close();
  });
});
