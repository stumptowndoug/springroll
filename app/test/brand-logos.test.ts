import { describe, expect, test } from "bun:test";
import { resolveBrandLogoSvg } from "../src/server/brand-logos.ts";

describe("connector brand logos", () => {
  test("resolves exact service names to sanitized brand-color SVG", () => {
    const firebase = resolveBrandLogoSvg("Firebase MCP", "Google Firebase");
    expect(firebase).toContain("<title>Firebase</title>");
    expect(firebase).toContain('fill="#DD2C00"');
    expect(firebase).not.toContain("currentColor");
    expect(firebase).not.toMatch(/<script|javascript:|\son\w+=/i);
  });

  test("does not guess an unrelated icon when the catalog has no exact match", () => {
    expect(
      resolveBrandLogoSvg("Microsoft Clarity", "Microsoft"),
    ).toBeUndefined();
  });
});
