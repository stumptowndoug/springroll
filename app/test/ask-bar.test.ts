import { describe, expect, test } from "bun:test";
import { askBarComposerAction } from "../src/client/ask-bar.tsx";

describe("ask bar composer keys", () => {
  test("Enter sends and Shift+Enter stays in the field", () => {
    expect(askBarComposerAction("Enter", false)).toBe("submit");
    expect(askBarComposerAction("Enter", true)).toBeUndefined();
    expect(askBarComposerAction("Escape", false)).toBe("blur");
    expect(askBarComposerAction("a", false)).toBeUndefined();
  });
});
