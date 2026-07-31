import { describe, expect, test } from "bun:test";
import {
  agentRuntimeCatalog,
  checkAgentRuntimeCompatibility,
  getAgentRuntime,
} from "../src/agent-runtime-catalog.ts";

describe("agent runtime catalog", () => {
  test("distinguishes available stable providers from planned experimental harnesses", () => {
    expect(
      agentRuntimeCatalog
        .filter((runtime) => runtime.availability === "available")
        .map((runtime) => runtime.id),
    ).toEqual(["openai", "xai", "openrouter"]);

    expect(getAgentRuntime("pi-harness")).toMatchObject({
      kind: "ai-sdk-harness",
      stability: "experimental",
      availability: "planned",
      authentication: ["api-key", "existing-cli-session"],
    });
  });

  test("accepts stable hosted providers for ShrimpRoll host tools", () => {
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

  test("does not imply subscription auth or full built-in control for the Codex harness", () => {
    const result = checkAgentRuntimeCompatibility("codex-harness", {
      authentication: "existing-cli-session",
      hostTools: true,
      requireAvailable: true,
      requireFullBuiltInToolControl: true,
    });

    expect(result.compatible).toBe(false);
    expect(result.issues).toEqual([
      "Codex harness does not support existing-cli-session authentication",
      "Codex harness does not provide full control over built-in tools",
      "Codex harness is not implemented in ShrimpRoll yet",
    ]);
  });

  test("identifies Pi as the planned local subscription bridge", () => {
    const result = checkAgentRuntimeCompatibility("pi-harness", {
      executionLocation: "local",
      authentication: "existing-cli-session",
      hostTools: true,
      nativeResumeState: true,
      requireFullBuiltInToolControl: true,
    });

    expect(result).toMatchObject({
      compatible: true,
      issues: [],
    });
  });
});
