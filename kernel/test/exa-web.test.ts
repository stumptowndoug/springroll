import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/credentials.ts";
import { createExaWebToolSource, verifyExaCredential } from "../src/index.ts";

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
    const requests: { readonly url: string; readonly body: unknown }[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore("exa-key"),
      fetch: async (input, init) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body));
        requests.push({ url, body });
        if (url.endsWith("/search")) {
          return Response.json({
            results: [
              {
                title: "Example",
                url: "https://example.com/article",
                text: "Current information.",
              },
            ],
          });
        }
        return Response.json({
          results: [
            {
              title: "Example",
              url: "https://example.com/article",
              text: "The full article.",
            },
          ],
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
    await expect(
      session.callTool(
        "fetch_public_url",
        { url: "https://example.com/article" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        results: [{ text: "The full article." }],
      },
    });

    expect(requests).toEqual([
      {
        url: "https://api.exa.ai/search",
        body: {
          query: "latest movie releases",
          type: "auto",
          numResults: 5,
          contents: {
            text: { maxCharacters: 3_000 },
            livecrawl: "fallback",
          },
        },
      },
      {
        url: "https://api.exa.ai/contents",
        body: {
          ids: ["https://example.com/article"],
          text: { maxCharacters: 12_000 },
          livecrawl: "fallback",
        },
      },
    ]);
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

  test("uses the free public MCP endpoint when no key is configured", async () => {
    const requests: unknown[] = [];
    const source = createExaWebToolSource({
      id: "native.web",
      credentialRef: "exa-test",
      credentials: new MemoryCredentialStore(undefined),
      fetch: async (input, init) => {
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
        { query: "current GitHub trends" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toEqual({
      content: ["A current search result."],
    });
    await expect(
      session.callTool(
        "fetch_public_url",
        { url: "https://example.com/article" },
        { taskId: "task-1", runId: "run-1" },
      ),
    ).resolves.toEqual({
      content: ["A current search result."],
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
              query: "current GitHub trends",
              numResults: 5,
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
            name: "web_fetch_exa",
            arguments: {
              urls: ["https://example.com/article"],
              maxCharacters: 12_000,
            },
          },
        },
      },
    ]);
    await session.close();
  });
});
