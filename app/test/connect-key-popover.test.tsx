import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectKeyPopover } from "../src/client/springroll-app.tsx";

const defaults = {
  open: true,
  label: "OpenRouter API key",
  placeholder: "Paste your key",
  value: "",
  busy: false,
  submitDisabled: true,
  submitLabel: "Save key",
  onClose: () => {},
  onKeyChange: () => {},
  onSubmit: () => {},
};

describe("API key entry", () => {
  test("offers an optional workspace only when the provider supports it", () => {
    const html = renderToStaticMarkup(
      <ConnectKeyPopover
        {...defaults}
        label="Anthropic API key"
        workspaceId="wrkspc_test123"
        onWorkspaceChange={() => {}}
      />,
    );
    expect(html).toContain(
      "Workspace ID (if your key works across workspaces)",
    );
    expect(html).toContain('value="wrkspc_test123"');
    expect(html).toContain("Leave blank for a workspace-scoped key.");
    expect(
      renderToStaticMarkup(<ConnectKeyPopover {...defaults} />),
    ).not.toContain("Workspace ID");
  });
  test("keeps the form above its dismiss layer so pointer submission works", () => {
    const css = readFileSync(
      new URL("../src/client/styles.css", import.meta.url),
      "utf8",
    );
    const zIndex = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      const rule = css.slice(start, css.indexOf("}", start));
      return Number(rule.match(/z-index:\s*(\d+)/)?.[1]);
    };
    expect(zIndex(".connect-panel")).toBeGreaterThan(
      zIndex(".enable-backdrop"),
    );
  });

  test("shows validation failure in the form and preserves the retry action", () => {
    const html = renderToStaticMarkup(
      <ConnectKeyPopover
        {...defaults}
        error="OpenRouter connection test failed with HTTP 401"
        submitDisabled={false}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("HTTP 401");
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Show API key"');
    expect(html).toContain("Save key</button>");
    expect(html).toContain("Cancel</button>");
    expect(html).not.toContain('disabled=""');
  });

  test("locks entry and submission while verifying", () => {
    const html = renderToStaticMarkup(
      <ConnectKeyPopover {...defaults} busy submitDisabled={false} />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled="" type="submit">Verifying…');
    expect(html).toContain('disabled="" spellCheck="false"');
  });

  test("does not render a closed credential form", () => {
    expect(
      renderToStaticMarkup(<ConnectKeyPopover {...defaults} open={false} />),
    ).toBe("");
  });
});
