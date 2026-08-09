import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/credentials.ts";
import {
  classifyWebFreshness,
  createExaWebToolSource,
  verifyExaCredential,
} from "../src/index.ts";

class MemoryCredentialStore implements CredentialStore {
  constructor(private readonly value: string | undefined) {}

  async get(): Promise<string | undefined> {
    return this.value;
  }

  async put(): Promise<void> {}

  async delete(): Promise<void> {}
}

describe("Exa portable web tools", () => {
  test("searches and reads URLs as normal host-executed tools", async () => {
    const requests: {
      readonly url: string;
      readonly method: string | undefined;
      readonly body?: unknown;
    }[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore("exa-key"),
      now: () => new Date("2026-08-04T18:30:00.000Z"),
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async (input, init) => {
        const url = String(input);
        const body = init?.body
          ? (JSON.parse(String(init.body)) as unknown)
          : undefined;
        requests.push({
          url,
          method: init?.method,
          ...(body === undefined ? undefined : { body }),
        });
        if (url.endsWith("/search")) {
          return Response.json({
            results: [
              {
                title: "Example",
                url: "https://example.com/article",
                highlights: ["Current information."],
              },
            ],
          });
        }
        return Response.json({
          current: { temperature_2m: 68, time: "2026-08-04T11:30" },
          current_units: { temperature_2m: "°F" },
        });
      },
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    expect(await session.listTools()).toMatchObject([
      {
        name: "search_web",
        providerTool: { capability: "web.search", fallback: "host" },
      },
      {
        name: "fetch_public_url",
        providerTool: { capability: "web.fetch", fallback: "host" },
      },
    ]);
    await expect(
      session.callTool(
        "search_web",
        { query: "latest movie releases" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        results: [{ title: "Example" }],
      },
    });
    await session.callTool(
      "search_web",
      { query: "current weather in Redmond" },
      { taskId: "task-1", runId: "run-2" },
    );
    await session.callTool(
      "search_web",
      { query: "how does OAuth PKCE work" },
      { taskId: "task-1", runId: "run-3" },
    );
    await expect(
      session.callTool(
        "fetch_public_url",
        { url: "https://example.com/article" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toMatchObject({
      content: [expect.stringContaining('"temperature_2m":68')],
      structuredContent: {
        url: "https://example.com/article",
        retrievedAt: "2026-08-04T18:30:00.000Z",
        status: 200,
        contentType: "application/json",
      },
    });

    expect(requests).toEqual([
      {
        url: "https://api.exa.ai/search",
        method: "POST",
        body: {
          query: "latest movie releases",
          type: "auto",
          numResults: 5,
          contents: {
            highlights: {
              query: "latest movie releases",
              maxCharacters: 800,
            },
            maxAgeHours: 24,
            livecrawlTimeout: 12_000,
          },
        },
      },
      {
        url: "https://api.exa.ai/search",
        method: "POST",
        body: {
          query: "current weather in Redmond 2026-08-04",
          type: "auto",
          numResults: 5,
          contents: {
            highlights: {
              query: "current weather in Redmond 2026-08-04",
              maxCharacters: 800,
            },
            maxAgeHours: 0,
            livecrawlTimeout: 12_000,
          },
        },
      },
      {
        url: "https://api.exa.ai/search",
        method: "POST",
        body: {
          query: "how does OAuth PKCE work",
          type: "auto",
          numResults: 5,
          contents: {
            highlights: {
              query: "how does OAuth PKCE work",
              maxCharacters: 800,
            },
            livecrawlTimeout: 12_000,
          },
        },
      },
      {
        url: "https://example.com/article",
        method: "GET",
      },
    ]);
    await session.close();
  });

  test("uses budgeted Exa Contents highlights for a focused page read", async () => {
    const requests: unknown[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore("exa-key"),
      now: () => new Date("2026-08-09T20:00:00.000Z"),
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({
          results: [
            {
              title: "NASA Open APIs",
              url: "https://api.nasa.gov/",
              highlights: [
                "GET https://api.nasa.gov/planetary/apod uses the api_key query parameter.",
              ],
            },
          ],
          statuses: [{ id: "https://api.nasa.gov/", status: "success" }],
        });
      },
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    await expect(
      session.callTool(
        "fetch_public_url",
        {
          url: "https://api.nasa.gov/",
          focus: "APOD endpoint and API key location",
          maxCharacters: 1_200,
        },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toMatchObject({
      content: [expect.stringContaining("/planetary/apod")],
      structuredContent: {
        url: "https://api.nasa.gov/",
        focused: true,
        reader: "exa-contents",
      },
    });
    expect(requests).toEqual([
      {
        url: "https://api.exa.ai/contents",
        body: {
          urls: ["https://api.nasa.gov/"],
          highlights: {
            query: "APOD endpoint and API key location",
            maxCharacters: 1_200,
          },
          maxAgeHours: 0,
          livecrawlTimeout: 12_000,
        },
      },
    ]);
    await session.close();
  });

  test("selects focused direct-page excerpts when Exa is not configured", async () => {
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      now: () => new Date("2026-08-09T20:00:00.000Z"),
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response(
          `<main><p>${"unrelated introduction ".repeat(300)}</p><h2>Authentication</h2><p>Send the NASA key in the api_key query parameter.</p></main>`,
          { headers: { "content-type": "text/html" } },
        ),
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    const result = await session.callTool(
      "fetch_public_url",
      {
        url: "https://api.nasa.gov/",
        focus: "NASA authentication api_key query parameter",
        maxCharacters: 800,
      },
      { taskId: "task-1", runId: "run-1" },
    );
    expect(JSON.stringify(result)).toContain("api_key query parameter");
    expect(JSON.stringify(result)).not.toContain(
      "unrelated introduction unrelated introduction unrelated introduction unrelated introduction",
    );
    expect(result.structuredContent).toMatchObject({
      focused: true,
      reader: "direct",
    });
    await session.close();
  });

  test("falls back to a focused direct read when Exa Contents is unavailable", async () => {
    const requests: string[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore("exa-key"),
      now: () => new Date("2026-08-09T20:00:00.000Z"),
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === "https://api.exa.ai/contents") {
          return new Response("reader unavailable", { status: 503 });
        }
        return new Response(
          "<main><p>Authentication uses an api_key query parameter.</p></main>",
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    const result = await session.callTool(
      "fetch_public_url",
      {
        url: "https://api.nasa.gov/",
        focus: "authentication API key",
      },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(requests).toEqual([
      "https://api.exa.ai/contents",
      "https://api.nasa.gov/",
    ]);
    expect(JSON.stringify(result)).toContain("api_key query parameter");
    expect(result.structuredContent).toMatchObject({
      focused: true,
      reader: "direct",
    });
    await session.close();
  });

  test("follows a same-origin markdown alternate when an HTML document is truncated", async () => {
    const requested: string[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      now: () => new Date("2026-08-08T12:00:00.000Z"),
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith(".md")) {
          return new Response(
            "Run `npx -y @provider/dev-mcp@latest`. No authentication is required.",
            { headers: { "content-type": "text/markdown" } },
          );
        }
        return new Response(
          '<link rel="alternate" type="text/markdown" href="/docs/mcp.md">' +
            "x".repeat(60_000),
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    const result = await session.callTool(
      "fetch_public_url",
      { url: "https://docs.example/docs/mcp" },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(requested).toEqual([
      "https://docs.example/docs/mcp",
      "https://docs.example/docs/mcp.md",
    ]);
    expect(result.content[0]).toContain("Content-Type: text/markdown");
    expect(result.content[0]).toContain("@provider/dev-mcp@latest");
    expect(result.structuredContent).toMatchObject({
      url: "https://docs.example/docs/mcp.md",
      truncated: false,
    });
    await session.close();
  });

  test("preserves resolved public links while converting HTML to text", async () => {
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      now: () => new Date("2026-08-04T18:30:00.000Z"),
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response(
          '<main>Run <code>npx @microsoft/clarity-mcp-server</code>. <a href="https://github.com/microsoft/clarity-mcp-server">Installation steps</a></main>',
          { headers: { "content-type": "text/html" } },
        ),
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    await expect(
      session.callTool(
        "fetch_public_url",
        { url: "https://clarity.microsoft.com/blog/mcp" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toMatchObject({
      content: [
        expect.stringContaining(
          "Installation steps (https://github.com/microsoft/clarity-mcp-server)",
        ),
      ],
    });
    await session.close();
  });

  test("verifies a key before saving it", async () => {
    const requests: unknown[] = [];
    await verifyExaCredential("exa-key", async (input, init) => {
      requests.push({
        url: String(input),
        apiKey: new Headers(init?.headers).get("x-api-key"),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({ results: [] });
    });

    expect(requests).toEqual([
      {
        url: "https://api.exa.ai/search",
        apiKey: "exa-key",
        body: {
          query: "Springroll connection check",
          type: "fast",
          numResults: 1,
          contents: { text: false },
        },
      },
    ]);
  });

  test("redacts a paid-search key from provider results and failures", async () => {
    const apiKey = "exa-credential-canary";
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(apiKey),
      fetch: async () =>
        Response.json({ echoed: apiKey, nested: { value: apiKey } }),
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    const result = await session.callTool(
      "search_web",
      { query: "stable background fact", freshness: "any" },
      { taskId: "task-1", runId: "run-1" },
    );
    expect(result).toMatchObject({
      structuredContent: {
        echoed: "[REDACTED]",
        nested: { value: "[REDACTED]" },
      },
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);

    await expect(
      verifyExaCredential(apiKey, async () =>
        Promise.resolve(new Response(`invalid ${apiKey}`, { status: 401 })),
      ),
    ).rejects.toThrow("invalid [REDACTED]");
    await expect(
      verifyExaCredential(apiKey, async () => {
        throw new Error(`transport included ${apiKey}`);
      }),
    ).rejects.toThrow("transport included [REDACTED]");
  });

  test("uses the free public MCP endpoint when no key is configured", async () => {
    const requests: unknown[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      now: () => new Date("2026-08-04T18:30:00.000Z"),
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async (input, init) => {
        if (String(input) !== "https://mcp.exa.ai/mcp") {
          return new Response(
            "<html><body><h1>Official status</h1><p>Observed 11:30 AM: 68°F</p><script>ignore me</script></body></html>",
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(
          `event: message\ndata: ${JSON.stringify({
            result: {
              content: [{ type: "text", text: "A current search result." }],
            },
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    await expect(
      session.callTool(
        "search_web",
        { query: "current GitHub trends", freshness: "any" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toEqual({
      content: [
        expect.stringContaining("Search freshness: live"),
        "A current search result.",
      ],
    });
    await session.callTool(
      "search_web",
      { query: "latest TypeScript release notes", freshness: "any" },
      { taskId: "task-1", runId: "run-2" },
    );
    await session.callTool(
      "search_web",
      { query: "how does OAuth PKCE work", freshness: "any" },
      { taskId: "task-1", runId: "run-3" },
    );
    await expect(
      session.callTool(
        "fetch_public_url",
        { url: "https://example.com/article" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toMatchObject({
      content: [expect.stringContaining("Observed 11:30 AM: 68°F")],
      structuredContent: {
        url: "https://example.com/article",
        retrievedAt: "2026-08-04T18:30:00.000Z",
      },
    });
    expect(requests).toEqual([
      {
        url: "https://mcp.exa.ai/mcp",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search_exa",
            arguments: {
              query: "current GitHub trends 2026-08-04",
              numResults: 5,
              livecrawl: "always",
            },
          },
        },
      },
      {
        url: "https://mcp.exa.ai/mcp",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search_exa",
            arguments: {
              query: "latest TypeScript release notes",
              numResults: 5,
              livecrawl: "preferred",
            },
          },
        },
      },
      {
        url: "https://mcp.exa.ai/mcp",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search_exa",
            arguments: {
              query: "how does OAuth PKCE work",
              numResults: 5,
              livecrawl: "fallback",
            },
          },
        },
      },
    ]);
    await session.close();
  });

  test("turns free MCP formatted search text into compact ranked leads", async () => {
    const longHighlight = "Detailed but superseded discovery text. ".repeat(80);
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      now: () => new Date("2026-08-09T20:00:00.000Z"),
      fetch: async () =>
        new Response(
          `event: message\ndata: ${JSON.stringify({
            result: {
              content: [
                {
                  type: "text",
                  text: `Title: Official API URL: https://api.example.test/docs Published: 2026-08-01 Author: Provider Highlights: ${longHighlight} --- Title: Endpoint reference URL: https://api.example.test/reference Published: N/A Author: N/A Highlights: Exact endpoint details.`,
                },
              ],
            },
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    const result = await session.callTool(
      "search_web",
      { query: "example official API" },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(result.structuredContent).toEqual({
      results: [
        {
          url: "https://api.example.test/docs",
          title: "Official API",
          publishedDate: "2026-08-01",
          author: "Provider",
          summary: longHighlight.trim().slice(0, 800),
        },
        {
          url: "https://api.example.test/reference",
          title: "Endpoint reference",
          summary: "Exact endpoint details.",
        },
      ],
    });
    expect(JSON.stringify(result).length).toBeLessThan(2_500);
    await session.close();
  });

  test("classifies time-sensitive search intent conservatively", () => {
    expect(classifyWebFreshness("weather today in Redmond Oregon")).toBe(
      "live",
    );
    expect(classifyWebFreshness("latest TypeScript release notes")).toBe(
      "recent",
    );
    expect(classifyWebFreshness("how does OAuth PKCE work")).toBe("any");
  });

  test("warns that stale current-weather snippets are not live evidence", async () => {
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      now: () => new Date("2026-08-04T18:30:00.000Z"),
      fetch: async () =>
        Response.json({
          result: {
            content: [
              {
                type: "text",
                text: "Undated cached snippet: Redmond is 43°F.",
              },
            ],
          },
        }),
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    const result = await session.callTool(
      "search_web",
      { query: "what is the current weather in Redmond Oregon" },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(result.content[0]).toContain("LIVE EVIDENCE POLICY");
    expect(result.content[0]).toContain(
      "Reject pages whose own date conflicts",
    );
    expect(result.content[1]).toContain("43°F");
    await session.close();
  });

  test("blocks private targets and revalidates redirects", async () => {
    const requested: string[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      resolveHostname: async (hostname) =>
        hostname === "safe.example" ? ["1.1.1.1"] : ["10.0.0.7"],
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://private.example/secrets" },
        });
      },
    });
    const session = await source.open({
      connection: {
        id: "web",
        sourceId: "native.web",
        credentialRef: "exa-test",
        availableIn: ["local"],
      },
      location: "local",
    });

    await expect(
      session.callTool(
        "fetch_public_url",
        { url: "http://127.0.0.1/admin" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).rejects.toThrow("private or reserved network");
    await expect(
      session.callTool(
        "fetch_public_url",
        { url: "https://safe.example/start" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).rejects.toThrow("private or reserved network");
    expect(requested).toEqual(["https://safe.example/start"]);
    await session.close();
  });
});
