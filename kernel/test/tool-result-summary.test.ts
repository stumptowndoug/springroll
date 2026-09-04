import { describe, expect, test } from "bun:test";
import {
  compactToolResultLabel,
  summarizeToolOutput,
} from "../src/tool-result-summary.ts";

describe("summarizeToolOutput", () => {
  test("reports size and distilled reads the way chat does", () => {
    expect(summarizeToolOutput({ content: ["x".repeat(12_240)] })).toBe(
      "12.2 kB",
    );
    expect(
      summarizeToolOutput({
        content: [{ type: "text", text: "y".repeat(400) }],
        structuredContent: { distilled: true },
      }),
    ).toBe("distilled · 400 characters");
    expect(summarizeToolOutput({ connections: [{ id: "neon" }] })).toBe(
      "1 connection",
    );
  });
});

describe("compactToolResultLabel", () => {
  test("keeps short labels and sizes leftover prose excerpts", () => {
    expect(compactToolResultLabel("342 characters")).toBe("342 characters");
    expect(compactToolResultLabel("x".repeat(234))).toBe("234 characters");
  });
});
