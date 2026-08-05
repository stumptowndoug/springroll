import { describe, expect, test } from "bun:test";
import { resolveBrandLogoSvg } from "../src/server/brand-logos.ts";

describe("connector brand logos", () => {
  test("resolves exact service names to sanitized theme-aware SVG", () => {
    const firebase = resolveBrandLogoSvg("Firebase MCP", "Google Firebase");
    expect(firebase).toContain("<title>Firebase</title>");
    expect(firebase).toContain('fill="currentColor"');
    expect(firebase).not.toMatch(/<script|javascript:|\son\w+=/i);
  });

  test("does not guess an unrelated icon when the catalog has no exact match", () => {
    expect(
      resolveBrandLogoSvg("Microsoft Clarity", "Microsoft"),
    ).toBeUndefined();
  });
});
