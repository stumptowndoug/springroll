import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionLimitPicker } from "../src/client/execution-limit-picker.tsx";

test("preset and Off choices do not need a second input; custom values do", () => {
  const render = (value: number) =>
    renderToStaticMarkup(
      <ExecutionLimitPicker
        label="Turn limit"
        value={value}
        presets={[10, 20, 50, 100]}
        defaultValue={20}
        min={2}
        max={100}
        unit="turns"
        disabled={false}
        onChange={() => {}}
      />,
    );
  for (const value of [0, 20]) {
    const html = render(value);
    expect(html).toContain(">Off</option>");
    expect(html).toContain(">Custom…</option>");
    expect(html).not.toContain("<input");
  }
  expect(render(37)).toContain('value="37"');
  expect(render(37)).toContain("<input");
});
