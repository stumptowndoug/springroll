import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelsDevCatalog } from "../src/server/model-catalog.ts";

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
});
