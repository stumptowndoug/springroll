import { describe, expect, test } from "bun:test";

describe("assistant runtime documentation", () => {
  test("describes size bounds and emergency fuses without stale research rationing", async () => {
    const document = await Bun.file(
      new URL("../../docs/assistant-runtime.md", import.meta.url),
    ).text();

    expect(document).toContain(
      "there are no per-turn registry or source-call counters",
    );
    expect(document).toMatch(
      /Springroll does\s+not ration searches, fetches, SQL calls, connector calls/,
    );
    expect(document).toMatch(/Shared per-result size\s+bounds still apply/);
    expect(document).toContain("Two deliberately generous emergency fuses");
    expect(document).not.toContain("one registry lookup");
    expect(document).not.toContain("four unique source calls");
    expect(document).not.toContain("24,000 cumulative");
  });

  test("does not claim that current usage accounting is already unified", async () => {
    const document = await Bun.file(
      new URL("../../docs/assistant-runtime.md", import.meta.url),
    ).text();

    expect(document).toMatch(
      /Scheduled-run usage is stored in `run_events` and projected\s+onto `runs`/,
    );
    expect(document).toMatch(/These accounting paths are not\s+yet unified/);
    expect(document).not.toContain(
      "usage ledger shared by chat, proposals, and scheduled runs",
    );
  });
});
