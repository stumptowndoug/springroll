import { describe, expect, test } from "bun:test";
import { recipeHostedBlockCopy, recipeIsLocalOnly } from "../src/shared.ts";

describe("recipe hosting copy", () => {
  test("treats missing hosted as this-Mac-only", () => {
    expect(recipeIsLocalOnly(["local"])).toBe(true);
    expect(recipeIsLocalOnly(["local", "hosted"])).toBe(false);
  });

  test("names the integrations that block cloud", () => {
    expect(recipeHostedBlockCopy([])).toBe("Hosted cloud runs coming soon");
    expect(recipeHostedBlockCopy(["Microsoft Clarity"])).toBe(
      "Uses Microsoft Clarity, which only runs on this Mac.",
    );
    expect(recipeHostedBlockCopy(["Microsoft Clarity", "Chrome"])).toBe(
      "Uses Microsoft Clarity and Chrome, which only run on this Mac.",
    );
  });
});
