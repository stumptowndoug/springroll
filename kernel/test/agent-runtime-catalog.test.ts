import { describe, expect, test } from "bun:test";
import {
  agentRuntimeCatalog,
  checkAgentRuntimeCompatibility,
  getAgentRuntime,
} from "../src/agent-runtime-catalog.ts";

describe("agent runtime catalog", () => {
  test("contains the available API and subscription runtimes", () => {
    expect(
      agentRuntimeCatalog
        .filter((runtime) => runtime.availability === "available")
        .map((runtime) => runtime.id),
    ).toEqual([
      "openai",
      "xai",
      "openrouter",
      "anthropic",
      "google",
      "mistral",
      "groq",
      "deepseek",
      "cohere",
      "codex",
    ]);

    expect(
      agentRuntimeCatalog
        .filter((runtime) => runtime.authentication.includes("api-key"))
        .every((runtime) => runtime.kind === "ai-sdk-provider"),
    ).toBe(true);
    expect(
      checkAgentRuntimeCompatibility("codex", {
        executionLocation: "local",
        authentication: "chatgpt",
        hostTools: true,
        requireAvailable: true,
      }),
    ).toMatchObject({
      compatible: true,
      issues: [],
      runtime: {
        kind: "codex-app-server",
        stability: "experimental",
        capabilities: { costAccounting: ["subscription"] },
      },
    });
    expect(
      checkAgentRuntimeCompatibility("codex", {
        executionLocation: "hosted",
      }),
    ).toMatchObject({ compatible: false });
  });

  test("accepts stable hosted providers for Springroll host tools", () => {
    expect(
      checkAgentRuntimeCompatibility("xai", {
        executionLocation: "hosted",
        authentication: "api-key",
        hostTools: true,
        requireAvailable: true,
      }),
    ).toMatchObject({
      compatible: true,
      issues: [],
    });
  });

  test("keeps CLI integrations outside the agent runtime catalog", () => {
    expect(agentRuntimeCatalog.map((runtime) => runtime.id)).not.toContain(
      "codex-cli",
    );
    expect(getAgentRuntime("openai").notes.join(" ")).toContain(
      "separately permissioned AI SDK tools",
    );
  });
});
