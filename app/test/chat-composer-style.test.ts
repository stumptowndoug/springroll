import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("floating composer masks its gutters while retaining document scrolling", () => {
  const css = readFileSync(
    new URL("../src/client/styles.css", import.meta.url),
    "utf8",
  );
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };
  expect(rule(".chat-composer-dock")).toContain("position: sticky");
  expect(rule(".chat-composer")).toContain("overflow: visible");
  expect(rule(".combo-panel.open-up")).toContain("bottom:");
  expect(rule(".chat-composer-dock::before")).toContain(
    "background: var(--bg)",
  );
  expect(rule(".chat-composer-dock::before")).toContain(
    "clip-path: inset(0 -100vmax)",
  );
  expect(rule(".chat-composer-dock::before")).toContain("pointer-events: none");
  expect(rule(".chat-detail-page")).not.toMatch(/\n\s*height:/);
  expect(rule(".chat-transcript")).not.toContain("overflow-y: auto");
  const source = readFileSync(
    new URL("../src/client/chat-page.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain('className="chat-composer-dock"');
  expect(source).toContain("scrollIntoView");
  expect(source).not.toContain("chat-input-footer");
});

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
