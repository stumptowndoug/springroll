import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StopTurnButton } from "../src/client/turn-meter.tsx";

describe("StopTurnButton", () => {
  test("renders a compact, accessible stop control", () => {
    const html = renderToStaticMarkup(
      <StopTurnButton onStop={() => undefined} />,
    );

    expect(html).toContain('aria-label="Stop current work"');
    expect(html).toContain('class="stop-turn"');
    expect(html).toContain('<i aria-hidden="true"></i>Stop');
  });
});
