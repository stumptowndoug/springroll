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
