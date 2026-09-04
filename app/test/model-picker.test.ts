import { describe, expect, test } from "bun:test";
import { compactInheritedModelLabel } from "../src/client/model-picker.tsx";

describe("compact model label", () => {
  test("shows the resolved app default instead of an ambiguous Default label", () => {
    expect(compactInheritedModelLabel("App default · GPT-5.6")).toBe("GPT-5.6");
    expect(compactInheritedModelLabel("App default · Automatic")).toBe(
      "Automatic",
    );
  });
});
