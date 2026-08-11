import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rollmarkSystemPrompt } from "../src/rollmark-prompt.ts";

describe("Rollmark report prompt", () => {
  test("matches the packaged prompt snippet verbatim", () => {
    const promptKit = readFileSync(
      new URL(
        "../../app/node_modules/@stumptowndoug/rollmark/prompt-kit/system-prompt.md",
        import.meta.url,
      ),
      "utf8",
    );
    const format = promptKit
      .split("---BEGIN FORMAT---\n")[1]
      ?.split("\n---END FORMAT---")[0];

    expect(format).toBe(rollmarkSystemPrompt);
  });
});
