import { describe, expect, test } from "bun:test";
import type { ConnectorManifest } from "../src/connector-manifest.ts";
import type { CredentialStore } from "../src/credentials.ts";
import { MissingCredentialError } from "../src/credentials.ts";
import { createDocumentedApiToolSource } from "../src/documented-api-tool-source.ts";

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
  id: "documented.widgets",
  name: "Widgets",
  blurb: "A small API adapter.",
  transport: {
    kind: "http-api",
    baseUrl: "https://api.example.com/v1",
    operations: [
      {
        name: "get_widget",
        description: "Read one widget from the documented API.",
        method: "GET",
        path: "/widgets/{widgetId}",
        inputSchema: {
          type: "object",
          properties: {
            widgetId: { type: "string" },
            include: { type: "array", items: { type: "string" } },
          },
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
          {
            input: "include",
            name: "include",
            location: "query",
            required: false,
          },
        ],
        effect: "read",
      },
    ],
  },
  credential: {
    kind: "api-key",
    placeholder: "Widget API key",
    header: "X-API-Key",
  },
};

describe("documented API tool source", () => {
  test("uses saved operations without rereading documentation", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.value = "secret-widget-key";
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly key: string | null;
    }> = [];
    const source = createDocumentedApiToolSource({
      manifest,
      credentials,
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          key: new Headers(init?.headers).get("x-api-key"),
        });
        return Response.json({ id: "widget-1", echoed: "secret-widget-key" });
      },
    });
    const session = await source.open({
      connection: {
        id: "widgets",
        sourceId: "http-api",
        manifestId: manifest.id,
        credentialRef: "widgets-key",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });

    expect(await session.listTools()).toEqual([
      expect.objectContaining({
        name: "get_widget",
        declaredRisk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
      }),
    ]);
    const result = await session.callTool(
      "get_widget",
      { widgetId: "widget 1", include: ["owner", "status"] },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(requests).toEqual([
      {
        url: "https://api.example.com/v1/widgets/widget%201?include=owner&include=status",
        method: "GET",
        key: "secret-widget-key",
      },
    ]);
    expect(result).toEqual({
      content: [{ id: "widget-1", echoed: "[REDACTED]" }],
      structuredContent: { id: "widget-1", echoed: "[REDACTED]" },
    });
  });

  test("does not start a request without the host credential", async () => {
    const source = createDocumentedApiToolSource({
      manifest,
      credentials: new MemoryCredentialStore(),
      fetch: async () => {
        throw new Error("request must not start");
      },
    });
    const session = await source.open({
      connection: {
        id: "widgets",
        sourceId: "http-api",
        manifestId: manifest.id,
        credentialRef: "widgets-key",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });

    await expect(
      session.callTool(
        "get_widget",
        { widgetId: "widget-1" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

  test("injects a host-resolved OAuth bearer token", async () => {
    const oauthManifest: ConnectorManifest = {
      ...manifest,
      id: "documented.oauth-widgets",
      credential: {
        kind: "oauth",
        scopes: ["widgets.read"],
      },
    };
    const authorizations: Array<string | null> = [];
    const source = createDocumentedApiToolSource({
      manifest: oauthManifest,
      credentials: new MemoryCredentialStore(),
      oauthAccessToken: async (connection) => {
        expect(connection.credentialRef).toBe("widgets-oauth");
        return "oauth-access-token";
      },
      fetch: async (_input, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ id: "widget-1" });
      },
    });
    const session = await source.open({
      connection: {
        id: "oauth-widgets",
        sourceId: "http-api",
        manifestId: oauthManifest.id,
        credentialRef: "widgets-oauth",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });

    await session.callTool(
      "get_widget",
      { widgetId: "widget-1" },
      { taskId: "task-1", runId: "run-1" },
    );
    expect(authorizations).toEqual(["Bearer oauth-access-token"]);
  });

  test("injects a documented query API key outside model-visible input", async () => {
    const queryManifest: ConnectorManifest = {
      ...manifest,
      id: "documented.query-key",
      credential: {
        kind: "api-key",
        placeholder: "NASA API key",
        query: "api_key",
      },
    };
    const credentials = new MemoryCredentialStore();
    credentials.value = "secret-query-key";
    const requests: Array<{
      readonly url: string;
      readonly authorization: string | null;
    }> = [];
    const source = createDocumentedApiToolSource({
      manifest: queryManifest,
      credentials,
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({ echoed: "secret-query-key" });
      },
    });
    const session = await source.open({
      connection: {
        id: "query-key",
        sourceId: "http-api",
        manifestId: queryManifest.id,
        credentialRef: "query-key-secret",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });

    const result = await session.callTool(
      "get_widget",
      { widgetId: "widget-1" },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(requests).toEqual([
      {
        url: "https://api.example.com/v1/widgets/widget-1?api_key=secret-query-key",
        authorization: null,
      },
    ]);
    expect(result).toMatchObject({
      content: [{ echoed: "[REDACTED]" }],
    });
  });

  test("maps a documented request body and refuses redirects", async () => {
    const writeManifest: ConnectorManifest = {
      id: "documented.writer",
      name: "Widget Writer",
      blurb: "A small write adapter.",
      transport: {
        kind: "http-api",
        baseUrl: "https://api.example.com/v1",
        operations: [
          {
            name: "create_widget",
            description: "Create one widget.",
            method: "POST",
            path: "/widgets",
            inputSchema: {
              type: "object",
              properties: {
                body: {
                  type: "object",
                  properties: { name: { type: "string" } },
                  required: ["name"],
                  additionalProperties: false,
                },
              },
              required: ["body"],
              additionalProperties: false,
            },
            bodyInput: "body",
            effect: "write",
          },
        ],
      },
      credential: { kind: "none" },
    };
    const requests: Array<{
      readonly url: string;
      readonly body: string | undefined;
      readonly redirect: RequestRedirect | undefined;
    }> = [];
    const source = createDocumentedApiToolSource({
      manifest: writeManifest,
      credentials: new MemoryCredentialStore(),
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: typeof init?.body === "string" ? init.body : undefined,
          redirect: init?.redirect,
        });
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example.test/widgets" },
        });
      },
    });
    const session = await source.open({
      connection: {
        id: "writer",
        sourceId: "http-api",
        manifestId: writeManifest.id,
        credentialRef: "none",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });

    expect((await session.listTools())[0]?.declaredRisk?.effect).toBe("write");
    await expect(
      session.callTool(
        "create_widget",
        { body: { name: "New widget" } },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).rejects.toThrow("redirected unexpectedly");
    expect(requests).toEqual([
      {
        url: "https://api.example.com/v1/widgets",
        body: '{"name":"New widget"}',
        redirect: "manual",
      },
    ]);
  });

  test("exchanges a Google service-account key for a bearer token", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      client_email: "springroll@project.iam.gserviceaccount.com",
      private_key: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      token_uri: "https://oauth2.googleapis.com/token",
    });
    const exchangeManifest: ConnectorManifest = {
      id: "documented.search-console",
      name: "Google Search Console",
      blurb: "Search analytics over the documented API.",
      transport: {
        kind: "http-api",
        baseUrl: "https://searchconsole.googleapis.com/webmasters/v3",
        operations: [
          {
            name: "list_sites",
            description: "List Search Console properties.",
            method: "GET",
            path: "/sites",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            effect: "read",
          },
        ],
      },
      credential: {
        kind: "api-key",
        placeholder: "Paste your service account JSON key",
        exchange: {
          kind: "google-service-account",
          scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        },
      },
    };
    const credentials = new MemoryCredentialStore();
    credentials.value = serviceAccountJson;
    const apiAuthorizations: Array<string | null> = [];
    let tokenRequests = 0;
    const source = createDocumentedApiToolSource({
      manifest: exchangeManifest,
      credentials,
      fetch: async (input, init) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          tokenRequests += 1;
          return Response.json({
            access_token: "ya29.exchanged",
            expires_in: 3599,
          });
        }
        expect(url).toBe(
          "https://searchconsole.googleapis.com/webmasters/v3/sites",
        );
        apiAuthorizations.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ siteEntry: [] });
      },
    });
    const session = await source.open({
      connection: {
        id: "search-console",
        sourceId: "http-api",
        manifestId: exchangeManifest.id,
        credentialRef: "connector-search-console",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });

    await session.callTool("list_sites", {}, { taskId: "t", runId: "r" });
    await session.callTool("list_sites", {}, { taskId: "t", runId: "r" });
    expect(apiAuthorizations).toEqual([
      "Bearer ya29.exchanged",
      "Bearer ya29.exchanged",
    ]);
    expect(tokenRequests).toBe(1);
  });
});
