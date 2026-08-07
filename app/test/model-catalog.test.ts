import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelsDevCatalog } from "../src/server/model-catalog.ts";
import { providerLogoSeeds } from "../src/server/provider-logos.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("models.dev catalog", () => {
  test("normalizes compatible language models and reuses the local cache", async () => {
    const directory = mkdtempSync(join(tmpdir(), "springroll-models-"));
    directories.push(directory);
    let requests = 0;
    const catalog = new ModelsDevCatalog(join(directory, "catalog.sqlite"), {
      fetch: async () => {
        requests += 1;
        return Response.json(
          {
            openrouter: {
              models: {
                "openai/useful": {
                  id: "openai/useful",
                  name: "Useful",
                  description: "A useful model",
                  reasoning: true,
                  tool_call: true,
                  modalities: { input: ["text", "image"], output: ["text"] },
                  limit: { context: 200_000 },
                  cost: { input: 0.5, output: 2 },
                },
                "openai/image-only": {
                  id: "openai/image-only",
                  name: "Image only",
                  tool_call: false,
                  modalities: { input: ["text"], output: ["image"] },
                },
              },
            },
          },
          { headers: { etag: '"catalog-v1"' } },
        );
      },
    });

    try {
      const first = await catalog.read();
      const second = await catalog.read();

      expect(first.models).toEqual([
        {
          providerId: "openrouter",
          modelId: "openai/useful",
          name: "Useful",
          description: "A useful model",
          contextTokens: 200_000,
          inputUsdPerMillionTokens: 0.5,
          outputUsdPerMillionTokens: 2,
          reasoning: true,
          toolCall: true,
          inputModalities: ["text", "image"],
        },
      ]);
      expect(second.models).toEqual(first.models);
      expect(requests).toBe(1);
    } finally {
      catalog.close();
    }
  });

  test("caches provider logos and rejects active content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "springroll-logos-"));
    directories.push(directory);
    let requests = 0;
    const catalog = new ModelsDevCatalog(join(directory, "catalog.sqlite"), {
      fetch: async (input) => {
        requests += 1;
        const url = String(input);
        if (url.endsWith("/openrouter.svg")) {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M0 0"/></svg>',
            { headers: { "content-type": "image/svg+xml" } },
          );
        }
        if (url.endsWith("/openai.svg")) {
          return new Response(
            '<svg onload="alert(1)"><script>alert(1)</script></svg>',
            { headers: { "content-type": "image/svg+xml" } },
          );
        }
        throw new Error("offline");
      },
    });

    try {
      const first = await catalog.logos();
      const requestsAfterFirst = requests;
      const second = await catalog.logos();

      expect(first.openrouter).toContain('fill="#94A3B8"');
      expect(first.openrouter).not.toContain("currentColor");
      expect(first.openai).toBe(providerLogoSeeds.openai);
      expect(first.xai).toBe(providerLogoSeeds.xai);
      expect(first.openai).toContain('fill="#10A37F"');
      expect(first.xai).toContain('fill="#000000"');
      expect(second.openrouter).toBe(first.openrouter);
      expect(requestsAfterFirst).toBe(3);
      // the good logo is cached; the rejected and offline ones retry
      expect(requests).toBe(5);
    } finally {
      catalog.close();
    }
  });
});
