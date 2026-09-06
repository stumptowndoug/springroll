import { describe, expect, test } from "bun:test";
import { parseConnectorManifest } from "@springroll/kernel";
import {
  connectorRegistryTemplates,
  matchConnectorTemplate,
} from "../src/server/connector-templates.ts";

describe("connector registry templates", () => {
  test("does not turn capability categories or other named services into catalog providers", () => {
    for (const intent of [
      "Snowflake database SQL queries and data warehouse integration",
      "Connect my Postgres database",
      "Connect PostgreSQL",
      "Connect a database",
      "GitLab repository pull requests",
      "Asana issues and project tracking",
      "PayPal payments invoices subscriptions",
      "Dropbox drive files",
      "Connect email",
      "Connect a knowledge base",
      "Connect calendar events",
    ]) {
      expect(matchConnectorTemplate(intent), intent).toBeUndefined();
    }
    expect(matchConnectorTemplate("Connect Outlook email")?.id).toBe("outlook");
    expect(matchConnectorTemplate("Connect Neon")?.id).toBe("neon");
    expect(matchConnectorTemplate("Connect my NEON database")?.id).toBe("neon");
    expect(matchConnectorTemplate("Connect https://neon.tech")?.id).toBe(
      "neon",
    );
    expect(matchConnectorTemplate("Connect neontology")).toBeUndefined();
    expect(matchConnectorTemplate("Connect Neon and GitHub")).toBeUndefined();
  });

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

  test("matches the curated official catalog and exposes only ready OAuth", () => {
    expect(
      matchConnectorTemplate("Connect my Neon Postgres database")?.id,
    ).toBe("neon");
    expect(matchConnectorTemplate("Read pull requests from GitHub")?.id).toBe(
      "github",
    );
    expect(
      matchConnectorTemplate("Read pull requests from GitHub")?.variants[0],
    ).toMatchObject({
      id: "oauth",
      actionable: false,
      manifest: {
        credential: { kind: "oauth" },
        transport: { endpoint: "https://api.githubcopilot.com/mcp/" },
      },
    });
    expect(matchConnectorTemplate("Connect my Jira projects")?.id).toBe("jira");
    expect(matchConnectorTemplate("Search my Gmail")?.id).toBe("gmail");
    expect(matchConnectorTemplate("Connect Outlook")?.id).toBe("outlook");
    expect(matchConnectorTemplate("Search SharePoint")?.id).toBe("sharepoint");
    expect(matchConnectorTemplate("Connect Notion")?.id).toBe("notion");
    expect(matchConnectorTemplate("Connect Stripe")?.id).toBe("stripe");
    expect(
      matchConnectorTemplate("Search Slack")?.variants.every(
        (variant) => variant.actionable,
      ),
    ).toBe(false);
    expect(
      matchConnectorTemplate("Search my Gmail")?.variants.every(
        (variant) => variant.actionable,
      ),
    ).toBe(false);
    expect(matchConnectorTemplate("Connect Salesforce")).toBeUndefined();
  });

  test("features the main starter set and distinguishes registration blockers", () => {
    expect(
      connectorRegistryTemplates
        .filter((template) => template.featured)
        .map((template) => template.id),
    ).toEqual([
      "neon",
      "outlook",
      "onedrive",
      "microsoft-teams",
      "sharepoint",
      "github",
      "jira",
      "slack",
      "linear",
      "gmail",
      "google-calendar",
      "google-drive",
      "notion",
      "stripe",
    ]);
    expect(
      connectorRegistryTemplates
        .filter(
          (template) =>
            template.featured &&
            template.variants.some((variant) => variant.actionable),
        )
        .map((template) => template.id),
    ).toEqual(["neon", "jira", "linear", "notion", "stripe"]);
  });
});
