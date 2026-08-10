import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import {
  createModelResearchDistiller,
  type ResearchDistiller,
  type ResearchDistillerRuntime,
  withResearchDistillation,
} from "../src/research-distiller.ts";
import type { RecordModelCallInput } from "../src/storage/sqlite-model-call-store.ts";
import {
  createNativeToolSource,
  type ToolResult,
  type ToolSource,
} from "../src/tools.ts";

const usage = {
  inputTokens: {
    total: 12,
    noCache: 10,
    cacheRead: 2,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 8,
    text: 6,
    reasoning: 2,
  },
};

const largeText = `https://one.test ${"detail ".repeat(1_000)}`;

function summaryModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    },
  });
}

function runtimeFor(model: MockLanguageModelV4): ResearchDistillerRuntime {
  return {
    model,
    provider: "openrouter",
    modelId: "cheap-model",
    pricing: {
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
    },
  };
}

function webSource(results: Record<string, ToolResult>): ToolSource {
  return createNativeToolSource(
    "native.web",
    Object.entries(results).map(([name, result]) => ({
      descriptor: {
        name,
        description: "test tool",
        inputSchema: { type: "object" },
      },
      execute: async () => result,
    })),
  );
}

async function callThroughDistiller(
  source: ToolSource,
  distiller: ResearchDistiller,
  toolName: string,
): Promise<ToolResult> {
  const wrapped = withResearchDistillation(source, distiller);
  const session = await wrapped.open({
    connection: {
      id: "web",
      sourceId: "native.web",
      credentialRef: "exa-test",
      availableIn: ["local"],
    },
    location: "local",
  });
  try {
    return await session.callTool(
      toolName,
      { query: "springroll pricing" },
      { taskId: "task-1", runId: "run-1" },
    );
  } finally {
    await session.close();
  }
}

test("distills an oversized web result into markdown and bills the call", async () => {
  const records: RecordModelCallInput[] = [];
  const distiller = createModelResearchDistiller({
    loadRuntime: async () =>
      runtimeFor(summaryModel("- Pricing is $10/mo (https://one.test)")),
    recordModelCall: (input) => void records.push(input),
  });

  const result = await callThroughDistiller(
    webSource({ search_web: { content: [largeText] } }),
    distiller,
    "search_web",
  );

  const encoded = JSON.stringify(result);
  expect(encoded).toContain("Pricing is $10/mo");
  expect(encoded).toContain("Distilled by Springroll");
  expect(encoded).toContain("call the tool again");
  expect(encoded.length).toBeLessThan(largeText.length);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    contextKind: "distill",
    contextId: "run-1",
    status: "succeeded",
    provider: "openrouter",
    modelId: "cheap-model",
    inputTokens: 12,
    outputTokens: 8,
  });
});

test("passes small results through untouched without loading a model", async () => {
  let loaded = 0;
  const distiller = createModelResearchDistiller({
    loadRuntime: async () => {
      loaded += 1;
      return runtimeFor(summaryModel("unused"));
    },
  });
  const original: ToolResult = { content: ["a short result"] };

  const result = await callThroughDistiller(
    webSource({ search_web: original }),
    distiller,
    "search_web",
  );

  expect(result).toEqual(original);
  expect(loaded).toBe(0);
});

test("passes results through when no distiller model is assigned", async () => {
  const distiller = createModelResearchDistiller({
    loadRuntime: async () => undefined,
  });
  const original: ToolResult = { content: [largeText] };

  const result = await callThroughDistiller(
    webSource({ fetch_public_url: original }),
    distiller,
    "fetch_public_url",
  );

  expect(result).toEqual(original);
});

test("falls back to the original result when the distiller call fails", async () => {
  const records: RecordModelCallInput[] = [];
  const distiller = createModelResearchDistiller({
    loadRuntime: async () =>
      runtimeFor(
        new MockLanguageModelV4({
          doGenerate: () => {
            throw new Error("provider unavailable");
          },
        }),
      ),
    recordModelCall: (input) => void records.push(input),
  });
  const original: ToolResult = { content: [largeText] };

  const result = await callThroughDistiller(
    webSource({ search_web: original }),
    distiller,
    "search_web",
  );

  expect(result).toEqual(original);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    contextKind: "distill",
    status: "failed",
  });
});

test("reuses the summary for a repeated identical result without a second model call", async () => {
  let loaded = 0;
  const model = summaryModel("- Pricing is $10/mo (https://one.test)");
  const distiller = createModelResearchDistiller({
    loadRuntime: async () => {
      loaded += 1;
      return runtimeFor(model);
    },
  });
  const source = webSource({ search_web: { content: [largeText] } });

  const first = await callThroughDistiller(source, distiller, "search_web");
  const second = await callThroughDistiller(source, distiller, "search_web");

  expect(second).toEqual(first);
  expect(loaded).toBe(1);
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("does not distill tools outside the research set", async () => {
  let loaded = 0;
  const distiller = createModelResearchDistiller({
    loadRuntime: async () => {
      loaded += 1;
      return runtimeFor(summaryModel("unused"));
    },
  });
  const original: ToolResult = { content: [largeText] };

  const result = await callThroughDistiller(
    webSource({ other_tool: original }),
    distiller,
    "other_tool",
  );

  expect(result).toEqual(original);
  expect(loaded).toBe(0);
});
