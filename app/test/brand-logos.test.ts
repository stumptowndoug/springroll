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

  test("keeps black-and-white brands adaptive across themes", () => {
    const notion = resolveBrandLogoSvg("Notion MCP", "Notion");
    expect(notion).toContain("<title>Notion</title>");
    expect(notion).toContain('fill="currentColor"');
    expect(notion).not.toContain('fill="#000000"');
  });

  test("resolves Gmail instead of Google when an account label is attached", () => {
    const gmail = resolveBrandLogoSvg("Gmail · work@example.com", "Google");
    expect(gmail).toContain("<title>Gmail</title>");
    expect(gmail).not.toContain("<title>Google</title>");
    expect(resolveBrandLogoSvg("Gmail", "Google")).toContain(
      "<title>Gmail</title>",
    );
  });
});
