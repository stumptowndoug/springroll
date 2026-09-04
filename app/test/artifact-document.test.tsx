import { describe, expect, test } from "bun:test";
import type { RunResultArtifact } from "@springroll/kernel";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtifactDocument,
  referencedArtifactIds,
} from "../src/client/artifact-document.tsx";

const artifacts: readonly RunResultArtifact[] = [
  {
    id: "image-one",
    kind: "image",
    title: "First image",
    mediaType: "image/png",
    payload: { sha256: "a".repeat(64), byteSize: 100 },
  },
  {
    id: "image-two",
    kind: "image",
    title: "Second image",
    mediaType: "image/png",
    payload: { sha256: "b".repeat(64), byteSize: 100 },
  },
];

describe("ArtifactDocument", () => {
  test("places referenced artifacts inline and leaves the rest in a gallery", () => {
    const html = renderToStaticMarkup(
      <ArtifactDocument
        artifacts={artifacts}
        content={
          "Before the image.\n\n{{artifact:image-two}}\n\nAfter the image."
        }
        pending
      />,
    );

    expect(html.indexOf("Before the image.")).toBeLessThan(
      html.indexOf("/api/artifacts/image-two"),
    );
    expect(html.indexOf("/api/artifacts/image-two")).toBeLessThan(
      html.indexOf("After the image."),
    );
    expect(html.match(/\/api\/artifacts\/image-two/g)).toHaveLength(2);
    expect(html).toContain("/api/artifacts/image-one");
    expect(html).not.toContain("{{artifact:");
  });

  test("finds artifact references without leaking regular markdown", () => {
    expect([
      ...referencedArtifactIds(
        "Hello\n{{artifact:first}}\nworld\n{{artifact:second}}",
      ),
    ]).toEqual(["first", "second"]);
  });

  test("keeps an unknown artifact reference visible", () => {
    const html = renderToStaticMarkup(
      <ArtifactDocument
        artifacts={artifacts}
        content="{{artifact:not-created}}"
        pending
        showUnreferenced={false}
      />,
    );

    expect(html).toContain("{{artifact:not-created}}");
  });
});
