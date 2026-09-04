import { describe, expect, test } from "bun:test";
import {
  type CredentialStore,
  createExaWebToolSource,
  type FetchApi,
  verifyWebProviderCredential,
  webProviderDefinitions,
  webResearchSelection,
} from "../src/index.ts";

const credentials: CredentialStore = {
  async get(reference) {
    return reference === "exa-test" ? undefined : `${reference}-secret`;
  },
  async put() {},
  async delete() {},
};
const context = { taskId: "task", runId: "run" };
const open = (
  provider: "parallel" | "firecrawl",
  fetch: FetchApi,
  readerProvider: "parallel" | "firecrawl" | "direct" = provider,
) =>
  createExaWebToolSource({
    id: "native.web",
    credentialRef: "exa-test",
    credentials,
    searchProvider: provider,
    readerProvider,
    resolveHostname: async () => ["93.184.216.34"],
    fetch,
  }).open({
    connection: {
      id: "builtin-web",
      sourceId: "native.web",
      credentialRef: "exa-test",
      availableIn: ["local"],
    },
    location: "local",
  });

describe("built-in web providers", () => {
  test("existing web connections keep Exa defaults", () => {
    expect(webResearchSelection({})).toEqual({
      searchProvider: "exa",
      readerProvider: "exa",
    });
    expect(
      webResearchSelection({
        searchProvider: "parallel",
        readerProvider: "firecrawl",
      }),
    ).toEqual({ searchProvider: "parallel", readerProvider: "firecrawl" });
  });
  for (const provider of ["parallel", "firecrawl"] as const) {
    test(`${provider} uses the documented endpoints and preserves sources with bounded content`, async () => {
      const calls: { url: string; body: Record<string, unknown> }[] = [];
      const session = await open(provider, async (input, init) => {
        const url = String(input);
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        const headers = new Headers(init?.headers);
        const key = `${webProviderDefinitions[provider].credentialRef}-secret`;
        expect(
          headers.get(provider === "parallel" ? "x-api-key" : "authorization"),
        ).toBe(provider === "parallel" ? key : `Bearer ${key}`);
        expect(init?.signal).toBeDefined();
        if (url.endsWith("/search"))
          return Response.json(
            provider === "parallel"
              ? {
                  results: [
                    {
                      url: "https://example.com/news",
                      title: "News",
                      excerpts: ["Evidence"],
                      publish_date: "2026-09-04",
                    },
                  ],
                  usage: [{ count: 1 }],
                }
              : {
                  success: true,
                  data: {
                    web: [
                      {
                        url: "https://example.com/news",
                        title: "News",
                        description: "Evidence",
                      },
                    ],
                  },
                  creditsUsed: 2,
                },
          );
        return Response.json(
          provider === "parallel"
            ? {
                results: [
                  {
                    url: "https://example.com/news",
                    excerpts: ["Article ".repeat(1000)],
                  },
                ],
              }
            : { success: true, data: { markdown: "Article ".repeat(1000) } },
        );
      });
      const search = await session.callTool(
        "search_web",
        { query: "latest news" },
        context,
      );
      expect(search.structuredContent).toMatchObject({
        provider,
        results: [{ url: "https://example.com/news", summary: "Evidence" }],
      });
      const read = await session.callTool(
        "fetch_public_url",
        {
          url: "https://example.com/news",
          focus: "Article",
          maxCharacters: 500,
        },
        context,
      );
      expect(read.structuredContent).toMatchObject({
        provider,
        url: "https://example.com/news",
        truncated: true,
      });
      expect(JSON.stringify(read).length).toBeLessThan(1500);
      expect(calls.map((call) => call.url)).toEqual(
        provider === "parallel"
          ? [
              "https://api.parallel.ai/v1/search",
              "https://api.parallel.ai/v1/extract",
            ]
          : [
              "https://api.firecrawl.dev/v2/search",
              "https://api.firecrawl.dev/v2/scrape",
            ],
      );
      expect(calls[1]?.body).toMatchObject(
        provider === "parallel"
          ? {
              urls: ["https://example.com/news"],
              objective: "Article",
              max_chars_total: 500,
            }
          : {
              url: "https://example.com/news",
              formats: ["markdown"],
              maxAge: 0,
            },
      );
    });
    test(`${provider} rejects private URLs before sending them to the provider`, async () => {
      let requests = 0;
      const session = await open(provider, async () => {
        requests++;
        return Response.json({});
      });
      await expect(
        session.callTool(
          "fetch_public_url",
          { url: "http://127.0.0.1/secret" },
          context,
        ),
      ).rejects.toThrow("private or reserved");
      expect(requests).toBe(0);
    });
    test(`${provider} validates credentials and redacts transport failures`, async () => {
      await expect(
        verifyWebProviderCredential(
          provider,
          "secret-key",
          async () => new Response(null, { status: 401 }),
        ),
      ).rejects.toThrow("HTTP 401");
      await expect(
        verifyWebProviderCredential(provider, "secret-key", async () => {
          throw new Error("connection secret-key failed");
        }),
      ).rejects.toThrow("connection [REDACTED] failed");
    });
  }
  test("search and reading can use different providers", async () => {
    const urls: string[] = [];
    const session = await open(
      "parallel",
      async (input) => {
        urls.push(String(input));
        return Response.json(
          String(input).includes("parallel")
            ? { results: [] }
            : { success: true, data: { markdown: "Source" } },
        );
      },
      "firecrawl",
    );
    await session.callTool("search_web", { query: "test" }, context);
    await session.callTool(
      "fetch_public_url",
      { url: "https://example.com" },
      context,
    );
    expect(urls).toEqual([
      "https://api.parallel.ai/v1/search",
      "https://api.firecrawl.dev/v2/scrape",
    ]);
  });
  test("provider failures do not silently switch to another paid provider", async () => {
    let requests = 0;
    const session = await open("parallel", async () => {
      requests++;
      return new Response(null, { status: 429 });
    });
    await expect(
      session.callTool("search_web", { query: "test" }, context),
    ).rejects.toThrow("HTTP 429");
    expect(requests).toBe(1);
  });
});
