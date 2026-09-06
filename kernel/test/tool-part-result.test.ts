import { expect, test } from "bun:test";
import { toolPartName, toolPartOutput } from "../src/tool-part-result.ts";

test("normalizes native and dynamic tool results without parsing ordinary prose", () => {
  const ready = { status: "ready", proposal: { name: "Clarity" } };
  expect(
    toolPartName({ type: "dynamic-tool", toolName: "propose_connection" }),
  ).toBe("propose_connection");
  expect(toolPartName({ type: "tool-propose_connection" })).toBe(
    "propose_connection",
  );
  expect(
    toolPartName({ type: "text", toolName: "propose_connection" }),
  ).toBeUndefined();
  for (const value of [
    ready,
    { structuredContent: ready },
    { content: [ready] },
    { content: [{ type: "text", text: JSON.stringify(ready) }] },
  ]) {
    expect(toolPartOutput(value)).toEqual(ready);
  }
  expect(
    toolPartOutput({ isError: true, structuredContent: ready }),
  ).toBeUndefined();
  expect(
    toolPartOutput({ content: [{ type: "text", text: "Review the card" }] }),
  ).toBeUndefined();
});
