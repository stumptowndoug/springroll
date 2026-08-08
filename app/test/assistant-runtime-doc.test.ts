import { describe, expect, test } from "bun:test";

describe("assistant runtime documentation", () => {
  test("does not restore stale connector-research counters", async () => {
    const document = await Bun.file(
      new URL("../../docs/assistant-runtime.md", import.meta.url),
    ).text();

    expect(document).not.toContain("one registry lookup");
    expect(document).not.toContain("four unique source calls");
    expect(document).not.toContain("24,000 cumulative");
  });
});
