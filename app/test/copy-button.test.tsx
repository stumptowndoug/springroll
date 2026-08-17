import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyMarkdownButton } from "../src/client/copy-button.tsx";

describe("CopyMarkdownButton", () => {
  test("renders copy button with accessible label and icon for valid content", () => {
    const html = renderToStaticMarkup(
      <CopyMarkdownButton content="# Hello World\n\nSome markdown text." />,
    );

    expect(html).toContain('class="chat-copy-button"');
    expect(html).toContain('aria-label="Copy markdown"');
    expect(html).toContain('title="Copy markdown"');
    expect(html).toContain("Copy</span>");
    expect(html).toContain("<svg");
  });

  test("does not render when content is empty or whitespace only", () => {
    const emptyHtml = renderToStaticMarkup(<CopyMarkdownButton content="" />);
    expect(emptyHtml).toBe("");

    const whitespaceHtml = renderToStaticMarkup(
      <CopyMarkdownButton content={"   \n\t  "} />,
    );
    expect(whitespaceHtml).toBe("");

    const undefinedHtml = renderToStaticMarkup(
      <CopyMarkdownButton content={undefined} />,
    );
    expect(undefinedHtml).toBe("");
  });
});
