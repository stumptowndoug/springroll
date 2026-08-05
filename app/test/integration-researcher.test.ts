import { describe, expect, test } from "bun:test";
import type { FetchApi } from "@springroll/kernel";
import {
  AiIntegrationResearcher,
  OfficialMcpRegistryClient,
  OfficialNpmRegistryClient,
  VerifiedLocalMcpResearcher,
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

  test("builds install metadata without inventing a tool contract", async () => {
    const outcome = await new AiIntegrationResearcher({
      registry: {
        async discover() {
          return {
            name: "com.stripe/mcp",
            title: "Stripe",
            description: "Official Stripe MCP server",
            version: "0.2.4",
            endpoint: "https://mcp.stripe.com/",
            repositoryUrl: "https://github.com/stripe/agent-toolkit",
            providerDomain: "stripe.com",
            operator: "Stripe",
            registryUrl:
              "https://registry.modelcontextprotocol.io/?q=com.stripe%2Fmcp",
            authorizationServer: "https://access.stripe.com/mcp",
            registrationEndpoint:
              "https://access.stripe.com/mcp/oauth2/register",
          };
        },
      },
    }).research("Create a Stripe integration");

    expect(outcome).toMatchObject({
      status: "ready",
      integration: {
        manifest: {
          id: "stripe",
          transport: {
            kind: "mcp-remote",
            endpoint: "https://mcp.stripe.com/",
          },
          credential: { kind: "oauth" },
        },
      },
    });
    if (outcome.status !== "ready") throw new Error("Expected ready outcome");
    expect(outcome.integration.manifest.probe).toBeUndefined();
    expect(outcome.integration.manifest.tools).toBeUndefined();
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

describe("reviewed local MCP package research", () => {
  test("pins npm metadata and builds the Clarity proposal from official evidence", async () => {
    const requests: string[] = [];
    const request: FetchApi = async (input) => {
      requests.push(requestUrl(input));
      return Response.json({
        name: "@microsoft/clarity-mcp-server",
        version: "2.0.1",
        description: "Microsoft Clarity MCP Server",
        repository: {
          type: "git",
          url: "git+https://github.com/microsoft/clarity-mcp-server.git",
        },
      });
    };
    const researcher = new VerifiedLocalMcpResearcher({
      npm: new OfficialNpmRegistryClient({ fetch: request }),
    });

    const outcome = await researcher.researchLocalMcp({
      name: "Microsoft Clarity",
      operator: "Microsoft",
      description: "Read Microsoft Clarity analytics from this Mac.",
      packageName: "@microsoft/clarity-mcp-server",
      repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
      credential: {
        kind: "api-key",
        env: "CLARITY_API_TOKEN",
        placeholder: "Clarity Data Export API token",
        keyCreationUrl: "https://clarity.microsoft.com/projects/",
      },
      guidance: {
        summary: "Generate a Data Export API token in Microsoft Clarity.",
        steps: [
          "Open the Clarity project.",
          "Choose Settings, Data Export, then Generate new API token.",
        ],
        docsUrl:
          "https://learn.microsoft.com/en-us/clarity/third-party-integrations/clarity-mcp-server",
      },
      sources: [
        {
          title: "Microsoft Learn · Clarity MCP Server",
          url: "https://learn.microsoft.com/en-us/clarity/third-party-integrations/clarity-mcp-server",
        },
        {
          title: "Microsoft · Clarity MCP source",
          url: "https://github.com/microsoft/clarity-mcp-server",
        },
      ],
    });

    expect(requests).toEqual([
      "https://registry.npmjs.org/%40microsoft%2Fclarity-mcp-server/latest",
    ]);
    expect(outcome).toMatchObject({
      status: "ready",
      integration: {
        trust: "package-verified",
        packageName: "@microsoft/clarity-mcp-server",
        packageVersion: "2.0.1",
        manifest: {
          id: "microsoft-clarity",
          transport: {
            kind: "mcp-local",
            package: {
              registry: "npm",
              name: "@microsoft/clarity-mcp-server",
              version: "2.0.1",
            },
          },
          credential: {
            kind: "api-key",
            env: "CLARITY_API_TOKEN",
          },
        },
      },
    });
  });

  test("rejects a package whose npm repository does not match the evidence", async () => {
    const researcher = new VerifiedLocalMcpResearcher({
      npm: {
        async latest() {
          return {
            name: "@vendor/clarity-helper",
            version: "1.0.0",
            description: "Unrelated helper",
            repositoryUrl: "https://github.com/vendor/clarity-helper",
          };
        },
      },
    });

    await expect(
      researcher.researchLocalMcp({
        name: "Microsoft Clarity",
        operator: "Microsoft",
        description: "Clarity analytics",
        packageName: "@vendor/clarity-helper",
        repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
        credential: { kind: "none" },
        guidance: {
          summary: "Install it.",
          steps: ["Review the package."],
          docsUrl: "https://learn.microsoft.com/clarity",
        },
        sources: [
          {
            title: "Microsoft documentation",
            url: "https://learn.microsoft.com/clarity",
          },
          {
            title: "Claimed repository",
            url: "https://github.com/microsoft/clarity-mcp-server",
          },
        ],
      }),
    ).rejects.toThrow("not the researched repository");
  });

  test("preserves Firebase's documented MCP subcommand without inventing a token rail", async () => {
    const researcher = new VerifiedLocalMcpResearcher({
      npm: {
        async latest() {
          return {
            name: "firebase-tools",
            version: "15.25.1",
            description: "Firebase CLI and MCP Server",
            repositoryUrl: "https://github.com/firebase/firebase-tools",
          };
        },
      },
    });

    const outcome = await researcher.researchLocalMcp({
      name: "Firebase MCP",
      operator: "Google Firebase",
      description: "Official Firebase MCP server.",
      packageName: "firebase-tools",
      packageArgs: ["mcp"],
      repositoryUrl: "https://github.com/firebase/firebase-tools",
      credential: { kind: "none" },
      guidance: {
        summary: "Use the Firebase MCP server's login tool when requested.",
        steps: ["Connect the package, then follow the Firebase login prompt."],
        docsUrl: "https://firebase.google.com/docs/ai-assistance/mcp-server",
      },
      sources: [
        {
          title: "Firebase MCP server documentation",
          url: "https://firebase.google.com/docs/ai-assistance/mcp-server",
        },
        {
          title: "Firebase Tools repository",
          url: "https://github.com/firebase/firebase-tools",
        },
      ],
    });

    expect(outcome).toMatchObject({
      status: "ready",
      integration: {
        manifest: {
          logoSvg: expect.stringContaining('fill="currentColor"'),
          transport: { kind: "mcp-local", args: ["mcp"] },
          credential: { kind: "none" },
        },
      },
    });
    await expect(
      researcher.researchLocalMcp({
        name: "Unsafe Firebase",
        operator: "Google Firebase",
        description: "Unsafe launch argument.",
        packageName: "firebase-tools",
        packageArgs: ["mcp", "--token=do-not-put-secrets-here"],
        repositoryUrl: "https://github.com/firebase/firebase-tools",
        credential: { kind: "none" },
        guidance: {
          summary: "Unsafe.",
          steps: ["Do not do this."],
          docsUrl: "https://firebase.google.com/docs/ai-assistance/mcp-server",
        },
        sources: [
          {
            title: "Firebase MCP server documentation",
            url: "https://firebase.google.com/docs/ai-assistance/mcp-server",
          },
          {
            title: "Firebase Tools repository",
            url: "https://github.com/firebase/firebase-tools",
          },
        ],
      }),
    ).rejects.toThrow("must not contain credential");
  });
});

const activeRegistryMetadata = {
  "io.modelcontextprotocol.registry/official": {
    status: "active",
    isLatest: true,
  },
} as const;
