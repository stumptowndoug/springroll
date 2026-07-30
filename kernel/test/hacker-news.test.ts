import { describe, expect, test } from "bun:test";
import {
  createHackerNewsToolSource,
  type FetchJson,
} from "../src/connectors/hacker-news.ts";

describe("Hacker News connector", () => {
  test("fetches only official API endpoints and returns structured stories", async () => {
    const requests: string[] = [];
    const fetchImplementation: FetchJson = async (input) => {
      const url = String(input);
      requests.push(url);

      if (url.endsWith("/topstories.json")) {
        return Response.json([101, 202, 303]);
      }

      if (url.endsWith("/item/101.json")) {
        return Response.json({
          id: 101,
          type: "story",
          title: "Local-first software",
          url: "https://example.com/local-first",
          by: "reader",
          score: 120,
          time: 1_786_000_000,
          descendants: 42,
        });
      }

      if (url.endsWith("/item/202.json")) {
        return Response.json({
          id: 202,
          type: "story",
          title: "A tiny database",
          by: "builder",
          score: 80,
        });
      }

      return new Response(null, { status: 404 });
    };
    const source = createHackerNewsToolSource({
      fetch: fetchImplementation,
    });
    const session = await source.open({
      connection: {
        id: "connection-hn",
        sourceId: source.id,
        credentialRef: "none",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });

    const [descriptor] = await session.listTools();
    const result = await session.callTool(
      "get_hacker_news_top_stories",
      { limit: 2 },
      { taskId: "task-hn", runId: "run-hn" },
    );

    expect(descriptor?.declaredRisk).toEqual({
      effect: "read",
      openWorld: true,
      idempotent: true,
    });
    expect(requests).toEqual([
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      "https://hacker-news.firebaseio.com/v0/item/101.json",
      "https://hacker-news.firebaseio.com/v0/item/202.json",
    ]);
    expect(result.structuredContent).toEqual({
      stories: [
        {
          id: 101,
          title: "Local-first software",
          url: "https://example.com/local-first",
          by: "reader",
          score: 120,
          time: 1_786_000_000,
          descendants: 42,
        },
        {
          id: 202,
          title: "A tiny database",
          by: "builder",
          score: 80,
        },
      ],
    });

    await session.close();
  });

  test("rejects limits outside the connector allowlist", async () => {
    const source = createHackerNewsToolSource({
      fetch: async () => {
        throw new Error("fetch should not run");
      },
    });
    const session = await source.open({
      connection: {
        id: "connection-hn",
        sourceId: source.id,
        credentialRef: "none",
        availableIn: ["local"],
      },
      location: "local",
    });

    await expect(
      session.callTool(
        "get_hacker_news_top_stories",
        { limit: 31 },
        { taskId: "task-hn", runId: "run-hn" },
      ),
    ).rejects.toThrow("limit must be between 1 and 30");
  });
});
