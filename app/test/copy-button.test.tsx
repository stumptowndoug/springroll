import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CopyMarkdownButton,
  EndingActions,
} from "../src/client/copy-button.tsx";

describe("CopyMarkdownButton", () => {
  test("renders copy button with accessible label and icon for valid content", () => {
    const html = renderToStaticMarkup(
      <CopyMarkdownButton content="# Hello World\n\nSome markdown text." />,
    );

    expect(html).toContain('class="ending-action"');
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

describe("EndingActions", () => {
  test("renders copy and delete together", () => {
    const html = renderToStaticMarkup(
      <EndingActions
        copy="# Note\n\nBody"
        deleteLabel="Delete this run"
        onDelete={() => undefined}
      />,
    );

    expect(html).toContain('class="ending-actions"');
    expect(html).toContain("Copy</span>");
    expect(html).toContain("Delete</span>");
    expect(html).toContain('aria-label="Delete this run"');
  });

  test("renders delete alone when there is nothing to copy", () => {
    const html = renderToStaticMarkup(
      <EndingActions
        deleteLabel="Delete conversation"
        onDelete={() => undefined}
      />,
    );

    expect(html).toContain("Delete</span>");
    expect(html).not.toContain("Copy</span>");
  });

  test("renders nothing without copy or delete", () => {
    expect(renderToStaticMarkup(<EndingActions />)).toBe("");
    expect(renderToStaticMarkup(<EndingActions copy="   " />)).toBe("");
  });
});
