import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rollmarkSystemPrompt } from "../src/rollmark-prompt.ts";

describe("Rollmark report prompt", () => {
  test("matches the packaged prompt snippet verbatim", () => {
    const promptKit = readFileSync(
      new URL(
        "../../app/node_modules/rollmark/prompt-kit/system-prompt.md",
        import.meta.url,
      ),
      "utf8",
    );
    const snippet = promptKit
      .split("---BEGIN SNIPPET---\n\n")[1]
      ?.split("\n\n---END SNIPPET---")[0];

    expect(snippet).toBe(rollmarkSystemPrompt);
  });
});
