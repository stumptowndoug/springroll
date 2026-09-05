import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the current swatch picker no longer ships the retired theme rails", () => {
  const styles = readFileSync(
    new URL("../src/client/styles.css", import.meta.url),
    "utf8",
  );
  const design = readFileSync(
    new URL("../src/client/design-system.css", import.meta.url),
    "utf8",
  );
  for (const selector of [".theme-rail", ".theme-option", ".theme-preview"]) {
    expect(styles).not.toContain(selector);
    expect(design).not.toContain(selector);
  }
  expect(styles).toContain(".theme-swatch-option");
  expect(styles).toContain(".theme-category-filters");
  expect(design).toContain(
    ':root[data-glass="true"][data-theme="springroll-dark-glass"] body',
  );
});
