import { describe, expect, test } from "bun:test";

const styles = await Bun.file(
  new URL("../src/client/styles.css", import.meta.url),
).text();

describe("standalone chat layout", () => {
  test("uses the run page width instead of a legacy narrow column", () => {
    expect(styles).toMatch(/\.chat-shell\s*{[^}]*width:\s*100%;[^}]*}/s);
    expect(styles).not.toContain("width: min(800px, 100%);");
  });

  test("inherits the shared run-letter prose scale", () => {
    expect(styles).not.toMatch(/\.chat-message-content \.letter-body\s*{/);
  });
});
