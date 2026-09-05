import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandLogo } from "../src/client/brand-logo.tsx";

test("shared app logo preserves the official SVG artwork", async () => {
  const official = await Bun.file(
    new URL("../../logo.svg", import.meta.url),
  ).text();
  const path = official.match(/\bd="([^"]+)"/)?.[1];
  expect(path).toBeDefined();
  for (const className of ["brand-logo", "chat-brand-mark"]) {
    const rendered = renderToStaticMarkup(<BrandLogo className={className} />);
    expect(rendered).toContain(`d="${path}"`);
    expect(rendered).toContain('viewBox="0 0 512 512"');
    expect(rendered).toContain(`class="${className}"`);
    expect(rendered).toContain('aria-hidden="true"');
  }
});
