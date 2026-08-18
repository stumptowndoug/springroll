import { describe, expect, test } from "bun:test";
import { parseConnectorManifest } from "@springroll/kernel";
import {
  connectorRegistryTemplates,
  matchConnectorTemplate,
} from "../src/server/connector-templates.ts";

describe("connector registry templates", () => {
  test("recommends Neon OAuth while retaining a one-key fallback", () => {
    const neon = connectorRegistryTemplates.find(
      (template) => template.id === "neon",
    );

    expect(neon?.variants.map((variant) => variant.id)).toEqual([
      "oauth",
      "api-key",
    ]);
    expect(neon?.variants[0]).toMatchObject({
      recommended: true,
      actionable: true,
      manifest: { id: "neon", credential: { kind: "oauth" } },
    });
    expect(neon?.variants[1]).toMatchObject({
      recommended: false,
      actionable: true,
      manifest: { id: "neon", credential: { kind: "api-key" } },
    });
    for (const variant of neon?.variants ?? []) {
      expect(parseConnectorManifest(variant.manifest)).toEqual(
        variant.manifest,
      );
      expect(variant.guidance.steps.length).toBeGreaterThan(0);
      expect(variant.guidance.docsUrl).toStartWith("https://");
    }
  });

  test("leaves Gmail to research and treats Slack as connectable", () => {
    expect(matchConnectorTemplate("Connect my Postgres database")?.id).toBe(
      "neon",
    );
    expect(matchConnectorTemplate("Read pull requests from GitHub")?.id).toBe(
      "github",
    );
    expect(
      matchConnectorTemplate("Read pull requests from GitHub")?.variants[0],
    ).toMatchObject({
      id: "api-key",
      actionable: true,
      manifest: { credential: { kind: "api-key" } },
    });
    expect(matchConnectorTemplate("Connect my Jira projects")?.id).toBe("jira");
    expect(matchConnectorTemplate("Search my Gmail")).toBeUndefined();
    expect(matchConnectorTemplate("Connect Notion")).toBeUndefined();
    expect(
      matchConnectorTemplate("Search Slack")?.variants.every(
        (variant) => variant.actionable,
      ),
    ).toBe(true);
    expect(matchConnectorTemplate("Connect Salesforce")).toBeUndefined();
  });

  test("features a small actionable starter set", () => {
    expect(
      connectorRegistryTemplates
        .filter((template) => template.featured)
        .map((template) => template.id),
    ).toEqual(["neon", "jira"]);
    expect(
      connectorRegistryTemplates
        .filter((template) => template.featured)
        .every((template) =>
          template.variants.some((variant) => variant.actionable),
        ),
    ).toBe(true);
  });
});
