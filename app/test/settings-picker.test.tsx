import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPicker } from "../src/client/settings-picker.tsx";

test("web defaults use the shared custom trigger and preserve the selected label", () => {
  const html = renderToStaticMarkup(
    <SettingsPicker
      label="Page reader"
      value="direct"
      disabled={false}
      options={[
        { value: "direct", label: "Direct page reading" },
        {
          value: "firecrawl",
          label: "Firecrawl — connect first",
          disabled: true,
        },
      ]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Page reader"');
  expect(html).toContain('aria-haspopup="listbox"');
  expect(html).toContain('class="combo-trigger"');
  expect(html).toContain(">Direct page reading</span>");
  expect(html).not.toContain("<select");
});
