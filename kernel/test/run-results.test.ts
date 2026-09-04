import { describe, expect, test } from "bun:test";
import {
  createMarkdownRunResult,
  isSubstantiveRunReport,
  runReportRejectionReason,
  selectResearchReport,
} from "../src/run-results.ts";

describe("run results", () => {
  test("summarizes the first body line instead of a section heading", () => {
    const result = createMarkdownRunResult({
      body: "## Result\n\nAssessorSearch holds 3 of 13 watchlist keywords in the top 10.",
      fallbackSummary: "Check AssessorSearch rankings",
    });

    expect(result.summary).toBe(
      "AssessorSearch holds 3 of 13 watchlist keywords in the top 10.",
    );
  });

  test("rejects heading-only, placeholder, and detached reports", () => {
    expect(isSubstantiveRunReport("## Result")).toBe(false);
    expect(isSubstantiveRunReport("## Result\n\n## Data\n")).toBe(false);
    expect(isSubstantiveRunReport("placeholder")).toBe(false);
    expect(
      isSubstantiveRunReport(
        "Done—the findings are summarized in the table above.",
      ),
    ).toBe(false);
    expect(
      isSubstantiveRunReport(
        "## Result\n\nAssessorSearch holds 3 of 13 watchlist keywords in the top 10.",
      ),
    ).toBe(true);
    expect(runReportRejectionReason("  ")).toBe("empty");
    expect(runReportRejectionReason("placeholder")).toBe("placeholder");
    expect(runReportRejectionReason("## Result")).toBe("heading-only");
    expect(
      runReportRejectionReason("The results are listed in the table above."),
    ).toBe("detached");
  });

  test("keeps the last substantive research answer", () => {
    expect(
      selectResearchReport([
        "## Result\n\nAssessorSearch holds 3 of 13 watchlist keywords in the top 10.",
        "## Result",
      ]),
    ).toBe(
      "## Result\n\nAssessorSearch holds 3 of 13 watchlist keywords in the top 10.",
    );
    expect(selectResearchReport(["## Result", "placeholder"])).toBeUndefined();
  });
});
