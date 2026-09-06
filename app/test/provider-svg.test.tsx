import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderSvg } from "../src/client/provider-svg.tsx";

test("untrusted SVG stays inside an image resource, not the app DOM", () => {
  const svg =
    '<svg><style>body{display:none}</style><foreignObject><script>alert(1)</script></foreignObject><a xlink:href="https://example.com">link</a></svg>';
  const html = renderToStaticMarkup(<ProviderSvg svg={svg} />);
  expect(html).toContain("data:image/svg+xml,");
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("<style");
  expect(html).not.toContain("<script");
  expect(html).toContain(encodeURIComponent(svg));
});

test("monochrome marks inherit theme color through an isolated mask", () => {
  const html = renderToStaticMarkup(
    <ProviderSvg
      svg={'<svg><path fill="currentColor" d="M0 0h24v24H0z"/></svg>'}
    />,
  );
  expect(html).toContain("monochrome");
  expect(html).toContain("mask-image:");
  expect(html).toContain('<span aria-hidden="true"');
  expect(html).not.toContain("<img");
  expect(html).not.toContain("image/gif");
  expect(html).not.toContain("<path");
});
