import { describe, expect, test } from "bun:test";
import {
  markdownPlainText,
  markdownSummaryDuplicatesBody,
} from "../src/shared.ts";

describe("markdownPlainText", () => {
  test("keeps the words and drops emphasis markers", () => {
    expect(
      markdownPlainText(
        "During the trailing 7-day window (**August 11–17, 2026 PDT**), the API processed **3,590** requests.",
      ),
    ).toBe(
      "During the trailing 7-day window (August 11–17, 2026 PDT), the API processed 3,590 requests.",
    );
  });
});

describe("markdownSummaryDuplicatesBody", () => {
  test("hides a dek that is just the truncated first paragraph", () => {
    const body = [
      "During the trailing 7-day window (**August 11–17, 2026 PDT**), the AssessorSearch API processed **3,590 total requests** across 7 active accounts.",
      "",
      "Credit consumption stayed flat week over week.",
    ].join("\n");
    expect(
      markdownSummaryDuplicatesBody(
        "During the trailing 7-day window (**August 11–17, 2026 PDT**), the AssessorSearch API processed **3,590 total request...",
        body,
      ),
    ).toBe(true);
  });

  test("keeps a dek that says something the body does not", () => {
    expect(
      markdownSummaryDuplicatesBody(
        "Three accounts need a closer look this week.",
        "During the trailing 7-day window the API processed 3,590 requests.",
      ),
    ).toBe(false);
  });
});
