import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BuiltInCapabilitiesSettingsSection,
  ModelSettingsSection,
} from "../src/client/springroll-app.tsx";
import type { ModelSettingsDto } from "../src/shared.ts";

const value: ModelSettingsDto = {
  providers: [],
  models: [],
  recipeModels: [],
  imageModels: [],
  catalogStale: false,
};
const configuration = {
  value,
  loading: false,
  error: undefined,
  reload: async () => value,
  setError: () => {},
};

test("settings sections hide unrelated controls without unmounting their forms", () => {
  const providers = renderToStaticMarkup(
    <ModelSettingsSection configuration={configuration} view="providers" />,
  );
  expect(providers).toContain(
    'class="model-default-card models-limits-card settings-defaults-grid" hidden=""',
  );
  expect(providers).toContain("API keys");
  const models = renderToStaticMarkup(
    <ModelSettingsSection configuration={configuration} view="models" />,
  );
  expect(models).not.toContain(
    'class="model-default-card models-limits-card settings-defaults-grid" hidden=""',
  );
  expect(models).toContain('aria-label="Model defaults"');
  expect(models).toContain('aria-label="Recipe limits"');
  expect(models.match(/class="settings-control-column"/g)).toHaveLength(2);
  expect(models).toContain(
    '<details class="settings-about"><summary>About these settings</summary>',
  );
  expect(models).toContain('<div hidden=""><div class="section-heading"');
  const web = renderToStaticMarkup(
    <BuiltInCapabilitiesSettingsSection
      configuration={configuration}
      view="web"
    />,
  );
  expect(web).toContain('aria-labelledby="image-generation-heading" hidden=""');
  const images = renderToStaticMarkup(
    <BuiltInCapabilitiesSettingsSection
      configuration={configuration}
      view="images"
    />,
  );
  expect(images).toContain('id="web-research" hidden=""');
});

test("compact settings controls collapse to one column on smaller screens", async () => {
  const css = await Bun.file(
    new URL("../src/client/styles.css", import.meta.url),
  ).text();
  expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(css).toMatch(
    /@media \(max-width: 760px\)\s*{\s*\.settings-page \.model-default-card\s*{\s*grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("settings provider cards size to their container and allow actions to wrap", async () => {
  const css = await Bun.file(
    new URL("../src/client/styles.css", import.meta.url),
  ).text();
  expect(css).toMatch(
    /\.settings-page \.provider-grid\s*{[^}]*repeat\(auto-fill, minmax\(min\(100%, 300px\), 1fr\)\)/s,
  );
  expect(css).toMatch(
    /\.settings-page \.provider-card\s*{[^}]*min-width: 0;[^}]*padding: 18px;/s,
  );
  expect(css).toMatch(
    /\.settings-page \.provider-foot\s*{[^}]*flex-wrap: wrap;/s,
  );
  expect(css).toMatch(/\.settings-page \.provider-card\s*{[^}]*border: 0;/s);
  expect(css).toMatch(
    /\.run-group\s*{[^}]*border-radius: var\(--radius-surface\);[^}]*background: var\(--surface\);/s,
  );
  expect(css).toMatch(
    /\.run-row\s*{[^}]*border-top: 1px solid var\(--line\);/s,
  );
});

test("Settings dropdowns use borderless filled controls with visible keyboard focus", async () => {
  const css = await Bun.file(
    new URL("../src/client/styles.css", import.meta.url),
  ).text();
  expect(css).toMatch(
    /\.settings-page \.settings-defaults-grid \.combo-trigger\s*{[^}]*border: 0;[^}]*background: var\(--surface\);/s,
  );
  expect(css).toMatch(
    /\.settings-page \.settings-defaults-grid \.combo-trigger:focus-visible\s*{[^}]*outline: 2px solid var\(--accent\);/s,
  );
});

test("image defaults live under Image generation, not general model defaults", () => {
  const models = renderToStaticMarkup(
    <ModelSettingsSection configuration={configuration} />,
  );
  expect(models).toContain("Default model");
  expect(models).toContain("Recipe run turn limit");
  expect(models).toContain("Recipe run cost budget");
  expect(models).toContain("Applies to each recipe run, not chat.");
  expect(models).not.toContain("Cost budget per response or run");
  expect(models).not.toContain("Default image model");

  const capabilities = renderToStaticMarkup(
    <BuiltInCapabilitiesSettingsSection configuration={configuration} />,
  );
  const imageSection = capabilities.split(
    'aria-labelledby="image-generation-heading"',
  )[1];
  expect(capabilities).not.toContain("Built-in capabilities");
  expect(capabilities).toContain('id="image-generation-heading">Images</div>');
  expect(capabilities).toContain('class="section-label">Web researcher</div>');
  expect(capabilities).not.toContain(
    "Search and read sources for chats and recipes.",
  );
  expect(capabilities).not.toContain("Create images for chats and recipes.");
  expect(imageSection).toBeDefined();
  expect(imageSection).toContain("Default image model");
  expect(imageSection).toContain("Automatic");
  expect(imageSection).not.toContain("Manage providers");
  expect(imageSection).toContain("Needs an image provider");
  expect(imageSection).not.toContain("Choose model ↑");
  expect(
    capabilities.match(/class="provider-group capability-settings-group"/g),
  ).toHaveLength(2);
});
