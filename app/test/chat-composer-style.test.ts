import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("glass chat composer has an opaque theme-colored backing", () => {
  const css = readFileSync(
    new URL("../src/client/styles.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(
    /:root\[data-glass="true"\] \.chat-composer \{([^}]+)\}/,
  )?.[1];
  expect(rule).toBeDefined();
  expect(rule).toContain(
    "background: color-mix(in srgb, var(--bg) 96%, var(--fg))",
  );
  expect(rule).not.toContain("transparent");
  expect(rule).not.toContain("var(--surface)");
  expect(rule).not.toContain("backdrop-filter");
});
