import { describe, expect, test } from "bun:test";
import {
  agentRuntimeCatalog,
  checkAgentRuntimeCompatibility,
  getAgentRuntime,
} from "../src/agent-runtime-catalog.ts";

describe("agent runtime catalog", () => {
  test("contains only available AI SDK providers", () => {
    expect(
      agentRuntimeCatalog
        .filter((runtime) => runtime.availability === "available")
        .map((runtime) => runtime.id),
    ).toEqual(["openai", "xai", "openrouter"]);

    expect(
      agentRuntimeCatalog.every(
        (runtime) => runtime.kind === "ai-sdk-provider",
      ),
    ).toBe(true);
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
