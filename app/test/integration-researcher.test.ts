import { describe, expect, test } from "bun:test";
import type { FetchApi } from "@springroll/kernel";
import {
  evidencedConnectorTools,
  OfficialMcpRegistryClient,
} from "../src/server/integration-researcher.ts";

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString();
}

describe("official MCP Registry discovery", () => {
  test("ranks a provider-operated remote and verifies its OAuth registration", async () => {
    let registryRequests = 0;
    const request: FetchApi = async (input) => {
      const url = requestUrl(input);
      if (
        url.startsWith("https://registry.modelcontextprotocol.io/v0.1/servers")
      ) {
        registryRequests += 1;
        return Response.json({
          servers: [
            {
              _meta: {
                "io.modelcontextprotocol.registry/official": {
                  status: "active",
                  isLatest: false,
                },
              },
              server: {
                name: "com.stripe/mcp",
                description: "Stale official Stripe MCP server",
                version: "0.1.0",
                remotes: [
                  { type: "streamable-http", url: "https://old.stripe.com" },
                ],
              },
            },
            {
              _meta: activeRegistryMetadata,
              server: {
                name: "io.github.example/stripe-helper",
                description: "Third-party Stripe helper",
                version: "1.0.0",
                remotes: [
                  {
                    type: "streamable-http",
                    url: "https://stripe.example.test/mcp",
                  },
                ],
              },
            },
            {
              _meta: activeRegistryMetadata,
              server: {
                name: "com.stripe/mcp",
                description: "Official Stripe MCP server",
                version: "0.2.4",
                repository: {
                  url: "https://github.com/stripe/agent-toolkit",
                },
                remotes: [
                  { type: "streamable-http", url: "https://mcp.stripe.com" },
                ],
              },
            },
          ],
        });
      }
      if (url === "https://mcp.stripe.com/") {
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://mcp.stripe.com/.well-known/oauth-protected-resource"',
          },
        });
      }
      if (
        url === "https://mcp.stripe.com/.well-known/oauth-protected-resource"
      ) {
        return Response.json({
          resource: "https://mcp.stripe.com",
          authorization_servers: ["https://access.stripe.com/mcp"],
        });
      }
      if (
        url ===
        "https://access.stripe.com/.well-known/oauth-authorization-server/mcp"
      ) {
        return Response.json({
          issuer: "https://access.stripe.com/mcp",
          authorization_endpoint:
            "https://access.stripe.com/mcp/oauth2/authorize",
          token_endpoint: "https://access.stripe.com/mcp/oauth2/token",
          registration_endpoint:
            "https://access.stripe.com/mcp/oauth2/register",
        });
      }
      return new Response(null, { status: 404 });
    };
    const registry = new OfficialMcpRegistryClient({ fetch: request });

    const candidate = await registry.discover("Create a Stripe integration");
    expect(candidate).toMatchObject({
      name: "com.stripe/mcp",
      endpoint: "https://mcp.stripe.com/",
      operator: "Stripe",
      providerDomain: "stripe.com",
      authorizationServer: "https://access.stripe.com/mcp",
      registrationEndpoint: "https://access.stripe.com/mcp/oauth2/register",
    });

    await registry.discover("Create a Stripe integration");
    expect(registryRequests).toBe(1);
  });

  test("drops plausible tool names that are absent from official evidence", () => {
    const tools = evidencedConnectorTools(
      {
        id: "stripe",
        name: "Stripe",
        blurb: "<b>Payments</b> — inspect a Stripe account.",
        transport: {
          kind: "mcp-remote",
          endpoint: "https://mcp.stripe.com/",
        },
        credential: { kind: "oauth" },
        probe: { tool: "get_stripe_account_info", input: {} },
        tools: {
          allow: [
            "get_stripe_account_info",
            "stripe_api_read",
            "fetch_stripe_resources",
          ],
          risk: {
            get_stripe_account_info: { effect: "read" },
            stripe_api_read: { effect: "read" },
            fetch_stripe_resources: { effect: "read" },
          },
        },
      },
      "Official tools: get_stripe_account_info and stripe_api_read.",
    );

    expect(tools).toEqual(["get_stripe_account_info", "stripe_api_read"]);
  });

  test("does not inspect a third-party lookalike as an official provider", async () => {
    let nonRegistryRequests = 0;
    const request: FetchApi = async (input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://registry.modelcontextprotocol.io/")) {
        return Response.json({
          servers: [
            {
              _meta: activeRegistryMetadata,
              server: {
                name: "dev.vendor/stripe",
                description: "Stripe-compatible tools",
                version: "1.0.0",
                remotes: [
                  {
                    type: "streamable-http",
                    url: "https://vendor.dev/stripe/mcp",
                  },
                ],
              },
            },
          ],
        });
      }
      nonRegistryRequests += 1;
      return new Response(null, { status: 401 });
    };

    const candidate = await new OfficialMcpRegistryClient({
      fetch: request,
    }).discover("Stripe");
    expect(candidate).toBeUndefined();
    expect(nonRegistryRequests).toBe(0);
  });

  test("does not confuse a product name with another provider's brand", async () => {
    let endpointRequests = 0;
    const request: FetchApi = async (input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://registry.modelcontextprotocol.io/")) {
        return Response.json({
          servers: [
            {
              _meta: activeRegistryMetadata,
              server: {
                name: "com.claritybriefs/mcp",
                description: "Clarity Briefs MCP server",
                version: "1.0.0",
                remotes: [
                  {
                    type: "streamable-http",
                    url: "https://claritybriefs.com/api/mcp",
                  },
                ],
              },
            },
          ],
        });
      }
      endpointRequests += 1;
      return new Response(null, { status: 401 });
    };

    const candidate = await new OfficialMcpRegistryClient({
      fetch: request,
    }).discover("Create a Microsoft Clarity MCP connection");
    expect(candidate).toBeUndefined();
    expect(endpointRequests).toBe(0);
  });

  test("treats incomplete OAuth metadata as an incompatible candidate", async () => {
    const request: FetchApi = async (input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://registry.modelcontextprotocol.io/")) {
        return Response.json({
          servers: [
            {
              _meta: activeRegistryMetadata,
              server: {
                name: "com.stripe/mcp",
                description: "Official Stripe MCP server",
                version: "0.2.4",
                remotes: [
                  { type: "streamable-http", url: "https://mcp.stripe.com" },
                ],
              },
            },
          ],
        });
      }
      if (url === "https://mcp.stripe.com/") {
        return new Response(null, { status: 401 });
      }
      return Response.json({ resource: "https://mcp.stripe.com" });
    };

    const candidate = await new OfficialMcpRegistryClient({
      fetch: request,
    }).discover("Stripe");
    expect(candidate).toBeUndefined();
  });
});

const activeRegistryMetadata = {
  "io.modelcontextprotocol.registry/official": {
    status: "active",
    isLatest: true,
  },
} as const;
