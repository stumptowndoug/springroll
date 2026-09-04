import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChartSpec, RollmarkBlock } from "@stumptowndoug/rollmark";
import { renderChartSVG, renderRollmark } from "@stumptowndoug/rollmark";

import {
  builtInThemes,
  resolveRollmarkChartColors,
} from "../src/client/themes.ts";

const weeklyAnalytics = readFileSync(
  new URL("./fixtures/weekly-analytics.md", import.meta.url),
  "utf8",
);

describe("Rollmark report rendering", () => {
  test("renders the reference line, bar, and pie charts in both themes", () => {
    const rendered = renderRollmark(weeklyAnalytics);
    const charts = rendered.blocks.filter(isValidChart);

    expect(rendered.blocks.map((block) => block.type)).toEqual([
      "chart",
      "chart",
      "chart",
      "mermaid",
    ]);
    expect(charts.map((block) => block.spec?.type)).toEqual([
      "line",
      "bar",
      "pie",
    ]);

    for (const chart of charts) {
      const light = renderChartSVG(chart.spec, { theme: "light" });
      const dark = renderChartSVG(chart.spec, { theme: "dark" });

      expect(light).toContain('class="rollmark-chart-svg"');
      expect(light).toContain('role="img"');
      expect(dark).toContain('class="rollmark-chart-svg"');
      expect(dark).toContain('role="img"');
      expect(dark).not.toBe(light);
    }
  });

  test("isolates a malformed chart in a fallback card", () => {
    const rendered = renderRollmark(
      weeklyAnalytics.replace("2026-08-06 | 1470", "2026-08-06 | nope"),
    );

    expect(rendered.blocks).toHaveLength(4);
    const [brokenLine, validBar, validPie, mermaid] = rendered.blocks;
    if (
      brokenLine?.type !== "chart" ||
      validBar?.type !== "chart" ||
      validPie?.type !== "chart"
    ) {
      throw new Error("Expected the three chart fixtures in document order");
    }
    expect(brokenLine.spec).toBeUndefined();
    expect(validBar.spec?.type).toBe("bar");
    expect(validPie.spec?.type).toBe("pie");
    expect(mermaid?.type).toBe("mermaid");
    expect(rendered.html).toContain('class="rollmark-fallback"');
    expect(rendered.html).toContain("Where visitors came from");
    expect(rendered.html).toContain(
      "Next week we will watch whether the weekend lift",
    );
  });

  test("renders with Springroll's series and neutral theme colors", () => {
    const rendered = renderRollmark(weeklyAnalytics);
    const chart = rendered.blocks.find(isValidChart);
    const theme = builtInThemes.find(
      (candidate) => candidate.id === "catppuccin-mocha",
    );
    if (!chart || !theme) throw new Error("Expected chart and theme fixtures");

    const colors = resolveRollmarkChartColors(theme.preview);
    const svg = renderChartSVG(chart.spec, { theme: "dark", colors });

    for (const color of [
      ...colors.series.slice(0, 1),
      colors.text,
      colors.muted,
      colors.grid,
      colors.axis,
    ]) {
      expect(svg).toContain(color);
    }
  });
});

type ValidChartBlock = Extract<RollmarkBlock, { type: "chart" }> & {
  readonly spec: ChartSpec;
};

function isValidChart(block: RollmarkBlock): block is ValidChartBlock {
  return block.type === "chart" && block.spec !== undefined;
}
