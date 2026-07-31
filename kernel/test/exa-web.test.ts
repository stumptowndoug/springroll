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
          numResults: 8,
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
          query: "ShrimpRoll connection check",
          type: "fast",
          numResults: 1,
          contents: { text: false },
        },
      },
    ]);
  });
});
