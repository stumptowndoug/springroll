import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpringrollModelCatalog } from "../src/server/model-catalog.ts";
import { providerLogoSeeds } from "../src/server/provider-logos.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Springroll model catalog", () => {
  test("normalizes compatible language models and reuses the local cache", async () => {
    const directory = mkdtempSync(join(tmpdir(), "springroll-models-"));
    directories.push(directory);
    let requests = 0;
    const catalog = new SpringrollModelCatalog(
      join(directory, "catalog.sqlite"),
      {
        fetch: async (input) => {
          requests += 1;
          if (String(input).includes("/api/v1/images/models")) {
            return Response.json(
              {
                data: [
                  {
                    id: "black-forest-labs/flux.2-pro",
                    name: "FLUX.2 Pro",
                    description: "A dedicated image model",
                    architecture: {
                      input_modalities: ["text", "image"],
                      output_modalities: ["image"],
                    },
                    supported_parameters: { aspect_ratio: { type: "enum" } },
                  },
                  {
                    id: "unsupported/image",
                    name: "No portable orientation",
                    architecture: {
                      input_modalities: ["text"],
                      output_modalities: ["image"],
                    },
                    supported_parameters: { seed: { type: "boolean" } },
                  },
                  {
                    id: "recraft/vector-only",
                    name: "Vector only",
                    architecture: {
                      input_modalities: ["text"],
                      output_modalities: ["image"],
                    },
                    supported_parameters: {
                      aspect_ratio: { type: "enum" },
                      output_format: { type: "enum", values: ["svg"] },
                    },
                  },
                ],
              },
              { headers: { etag: '"images-v1"' } },
            );
          }
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
              xai: {
                models: {
                  "grok-imagine-image-2.0": {
                    id: "grok-imagine-image-2.0",
                    name: "Grok Imagine Image 2.0",
                    tool_call: false,
                    modalities: { input: ["text"], output: ["image"] },
                  },
                },
              },
            },
            { headers: { etag: '"catalog-v1"' } },
          );
        },
      },
    );

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
      expect(first.imageModels).toEqual([
        {
          providerId: "openrouter",
          modelId: "black-forest-labs/flux.2-pro",
          name: "FLUX.2 Pro",
          description: "A dedicated image model",
          reasoning: false,
          toolCall: false,
          inputModalities: ["text", "image"],
        },
        {
          providerId: "xai",
          modelId: "grok-imagine-image-2.0",
          name: "Grok Imagine Image 2.0",
          reasoning: false,
          toolCall: false,
          inputModalities: ["text"],
        },
      ]);
      expect(second.models).toEqual(first.models);
      expect(second.imageModels).toEqual(first.imageModels);
      expect(requests).toBe(2);
    } finally {
      catalog.close();
    }
  });

  test("force refresh bypasses the local TTL", async () => {
    const directory = mkdtempSync(join(tmpdir(), "springroll-models-"));
    directories.push(directory);
    let modelRequests = 0;
    let imageRequests = 0;
    const catalog = new SpringrollModelCatalog(
      join(directory, "catalog.sqlite"),
      {
        fetch: async (input) => {
          if (String(input).includes("/api/v1/images/models")) {
            imageRequests += 1;
            return Response.json(
              { data: [] },
              { headers: { etag: `"images-v${imageRequests}"` } },
            );
          }
          modelRequests += 1;
          const id =
            modelRequests === 1
              ? "google/gemini-3.6-flash"
              : "google/gemini-3.7-flash";
          return Response.json(
            {
              openrouter: {
                models: {
                  [id]: {
                    id,
                    name:
                      modelRequests === 1
                        ? "Gemini 3.6 Flash"
                        : "Gemini 3.7 Flash",
                    tool_call: true,
                    modalities: { input: ["text"], output: ["text"] },
                  },
                },
              },
            },
            { headers: { etag: `"catalog-v${modelRequests}"` } },
          );
        },
      },
    );

    try {
      const first = await catalog.read();
      const cached = await catalog.read();
      const forced = await catalog.read({ force: true });

      expect(first.models.map((model) => model.modelId)).toEqual([
        "google/gemini-3.6-flash",
      ]);
      expect(cached.models).toEqual(first.models);
      expect(forced.models.map((model) => model.modelId)).toEqual([
        "google/gemini-3.7-flash",
      ]);
      expect(modelRequests).toBe(2);
      expect(imageRequests).toBe(2);
    } finally {
      catalog.close();
    }
  });

  test("falls back to models.dev images when OpenRouter discovery is unavailable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "springroll-models-"));
    directories.push(directory);
    const catalog = new SpringrollModelCatalog(
      join(directory, "catalog.sqlite"),
      {
        fetch: async (input) => {
          if (String(input).includes("/api/v1/images/models")) {
            return new Response(null, { status: 503 });
          }
          return Response.json({
            openrouter: {
              models: {
                "google/gemini-image": {
                  id: "google/gemini-image",
                  name: "Gemini Image",
                  modalities: { input: ["text"], output: ["image"] },
                },
              },
            },
          });
        },
      },
    );

    try {
      const snapshot = await catalog.read();

      expect(snapshot.imageModels.map((model) => model.modelId)).toEqual([
        "google/gemini-image",
      ]);
      expect(snapshot.stale).toBe(true);
    } finally {
      catalog.close();
    }
  });

  test("caches provider logos and rejects active content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "springroll-logos-"));
    directories.push(directory);
    let requests = 0;
    const catalog = new SpringrollModelCatalog(
      join(directory, "catalog.sqlite"),
      {
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
      },
    );

    try {
      const first = await catalog.logos();
      const requestsAfterFirst = requests;
      const second = await catalog.logos();

      expect(first.openrouter).toContain('fill="#94A3B8"');
      expect(first.openrouter).not.toContain("currentColor");
      expect(first.openai).toBe(providerLogoSeeds.openai);
      expect(first.xai).toBe(providerLogoSeeds.xai);
      expect(first.openai).toContain('fill="#10A37F"');
      expect(first.xai).toContain('fill="currentColor"');
      expect(second.openrouter).toBe(first.openrouter);
      expect(requestsAfterFirst).toBe(3);
      // the good logo is cached; the rejected and offline ones retry
      expect(requests).toBe(5);
    } finally {
      catalog.close();
    }
  });
});
