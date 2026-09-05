import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolveRuntimePaths } from "../src/server/runtime-paths.ts";

test("source-run paths remain anchored to the checkout, not working directory", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  expect(resolveRuntimePaths({})).toEqual({
    databasePath: `${root}.local/springroll.sqlite`,
    modelCatalogPath: `${root}.local/model-catalog.sqlite`,
    migrationsFolder: `${root}drizzle`,
    indexPath: `${root}app/src/client/index.html`,
    assetsDirectory: `${root}app/dist`,
  });
});

test("packaged resources and writable data are separate and preserve spaces", () => {
  const resources = "/Applications/Springroll.app/Contents/Resources";
  const data = "/Users/test/Library/Application Support/Springroll";
  expect(
    resolveRuntimePaths({
      SPRINGROLL_DATA_DIR: data,
      SPRINGROLL_RESOURCES_DIR: resources,
    }),
  ).toEqual({
    databasePath: `${data}/springroll.sqlite`,
    modelCatalogPath: `${data}/model-catalog.sqlite`,
    migrationsFolder: `${resources}/drizzle`,
    indexPath: `${resources}/app/src/client/index.html`,
    assetsDirectory: `${resources}/app/dist`,
  });
});

test("explicit database and catalog overrides take precedence", () => {
  expect(
    resolveRuntimePaths({
      SPRINGROLL_DATA_DIR: "/data",
      SPRINGROLL_DB_PATH: "/isolated/test.sqlite",
      SPRINGROLL_MODEL_CATALOG_PATH: "/cache/catalog.sqlite",
    }),
  ).toMatchObject({
    databasePath: "/isolated/test.sqlite",
    modelCatalogPath: "/cache/catalog.sqlite",
  });
  expect(
    resolveRuntimePaths({ SPRINGROLL_DB_PATH: "/isolated/test.sqlite" })
      .modelCatalogPath,
  ).toBe("/isolated/model-catalog.sqlite");
});

test("package directories cannot silently resolve against a launch directory", () => {
  expect(() =>
    resolveRuntimePaths({ SPRINGROLL_DATA_DIR: "relative" }),
  ).toThrow("absolute path");
  expect(() => resolveRuntimePaths({ SPRINGROLL_RESOURCES_DIR: "" })).toThrow(
    "absolute path",
  );
});
