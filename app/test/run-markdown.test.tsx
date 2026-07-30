import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunMarkdown } from "../src/client/run-markdown.tsx";

describe("RunMarkdown", () => {
  test("renders readable GFM while keeping the app's title hierarchy", () => {
    const html = renderToStaticMarkup(
      <RunMarkdown
        content={[
          "# Repeated title",
          "",
          "- **Useful** item",
          "",
          "| Topic | Change |",
          "| --- | ---: |",
          "| Search | 42% |",
          "",
          "[Source](https://example.com/report)",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h2>Repeated title</h2>");
    expect(html).toContain("<strong>Useful</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  test("drops raw HTML and unsafe embedded content", () => {
    const html = renderToStaticMarkup(
      <RunMarkdown
        content={[
          "<script>alert('no')</script>",
          '<iframe src="https://example.com"></iframe>',
          "[unsafe](javascript:alert('no'))",
          "![tracking](https://example.com/pixel.png)",
          "[mail](mailto:person@example.com)",
        ].join("\n\n")}
      />,
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("mailto:");
  });
});
