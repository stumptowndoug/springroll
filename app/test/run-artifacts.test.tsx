import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunArtifacts } from "../src/client/run-artifacts.tsx";

describe("RunArtifacts", () => {
  test("renders image artifact references without embedding bytes", () => {
    const html = renderToStaticMarkup(
      <RunArtifacts
        artifacts={[
          {
            id: "image/id",
            kind: "image",
            title: "A spring garden",
            mediaType: "image/png",
            payload: {
              alt: "Tulips in a spring garden",
              width: 1024,
              height: 1024,
              byteSize: 1_820_000,
              sha256: "abc",
              providerId: "openrouter",
              modelId: "openai/gpt-image-2",
            },
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Generated images"');
    expect(html).toContain("/api/artifacts/image%2Fid");
    expect(html).toContain('alt="Tulips in a spring garden"');
    expect(html).toContain('width="1024"');
    expect(html).toContain("1,024 × 1,024 · PNG · 1.8 MB · Stored on this Mac");
    expect(html).toContain("openrouter · openai/gpt-image-2");
    expect(html).toContain("Expand");
    expect(html).toContain("Download");
    expect(html).toContain("?download=1");
    expect(html).not.toContain("data:image");
  });

  test("ignores non-image artifacts", () => {
    expect(
      renderToStaticMarkup(
        <RunArtifacts
          artifacts={[{ id: "table-1", kind: "table", title: "Rows" }]}
        />,
      ),
    ).toBe("");
  });
});
