import { describe, expect, test } from "bun:test";
import type { FetchApi } from "@springroll/kernel";
import {
  AiIntegrationResearcher,
  connectorCapabilityTags,
  GithubMcpRegistryClient,
  OfficialMcpRegistryClient,
  OfficialNpmRegistryClient,
  VerifiedLocalMcpResearcher,
  VerifiedOpenApiResearcher,
} from "../src/server/integration-researcher.ts";

test("capability tags prefer exact provider identity over incidental prose", () => {
  expect(
    connectorCapabilityTags(
      undefined,
      "Firebase MCP",
      "Manage Firebase projects and tools.",
    ),
  ).toEqual(["database"]);
  expect(
    connectorCapabilityTags(
      undefined,
      "Stripe",
      "Inspect payments and API documentation.",
    ),
  ).toEqual(["payments"]);
});

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
    let githubCalls = 0;
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
      githubRegistry: {
        async discover() {
          githubCalls += 1;
          return undefined;
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
    expect(githubCalls).toBe(1);
  });

  test("treats a remote Registry miss as a recoverable research step", async () => {
    const outcome = await new AiIntegrationResearcher({
      registry: {
        async discover() {
          return undefined;
        },
      },
      githubRegistry: {
        async discover() {
          return undefined;
        },
      },
    }).research("Connect Microsoft Clarity");

    expect(outcome).toMatchObject({
      status: "not_found",
      explanation: expect.stringContaining("two structured registries"),
    });
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

describe("GitHub MCP Registry discovery", () => {
  test("finds and caches a curated local npm package candidate", async () => {
    let registryRequests = 0;
    let repositoryRequests = 0;
    const request: FetchApi = async (input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://api.mcp.github.com/v0.1/servers")) {
        registryRequests += 1;
        return Response.json(githubClarityRegistryResponse());
      }
      if (
        url.startsWith(
          "https://api.github.com/repos/microsoft/clarity-mcp-server/contents",
        )
      ) {
        repositoryRequests += 1;
        return Response.json([
          {
            type: "file",
            name: "icon.png",
            size: 313_214,
            download_url:
              "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/icon.png",
          },
        ]);
      }
      return new Response(null, { status: 404 });
    };
    const registry = new GithubMcpRegistryClient({ fetch: request });

    await expect(
      registry.discover("Create a Microsoft Clarity connector"),
    ).resolves.toMatchObject({
      kind: "local-mcp",
      name: "Clarity",
      operator: "Microsoft",
      packageName: "@microsoft/clarity-mcp-server",
      repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
      registryUrl: "https://github.com/mcp/microsoft/clarity-mcp-server",
      credentialRequired: true,
      logo: {
        url: "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/icon.png",
        source: "github-repository",
        kind: "asset",
        format: "raster",
      },
    });

    await registry.discover("Create a Microsoft Clarity connector");
    expect(registryRequests).toBe(1);
    expect(repositoryRequests).toBe(1);
  });

  test("uses a GitHub local candidate after the official remote lookup misses", async () => {
    const calls: string[] = [];
    const outcome = await new AiIntegrationResearcher({
      registry: {
        async discover() {
          calls.push("official");
          return undefined;
        },
      },
      githubRegistry: {
        async discover() {
          calls.push("github");
          return {
            kind: "local-mcp",
            name: "Clarity",
            operator: "Microsoft",
            description: "Fetch Clarity analytics via MCP clients.",
            packageName: "@microsoft/clarity-mcp-server",
            repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
            registryUrl: "https://github.com/mcp/microsoft/clarity-mcp-server",
            credentialRequired: true,
            registryName: "microsoft/clarity-mcp-server",
            logo: {
              url: "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/icon.png",
              source: "github-repository",
              kind: "asset",
              format: "raster",
            },
          };
        },
      },
    }).research("Connect Microsoft Clarity");

    expect(calls).toEqual(["official", "github"]);
    expect(outcome).toMatchObject({
      status: "candidate",
      candidate: {
        kind: "local-mcp",
        packageName: "@microsoft/clarity-mcp-server",
        repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
        logo: {
          source: "github-repository",
          kind: "asset",
        },
      },
      instruction: expect.stringContaining(
        "springroll_inspect_connector_source",
      ),
    });
    expect(JSON.stringify(outcome)).not.toContain("registryName");
  });

  test("keeps discovery usable with the registry image when repository icon lookup is unavailable", async () => {
    let repositoryRequests = 0;
    const registry = new GithubMcpRegistryClient({
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.startsWith("https://api.mcp.github.com/v0.1/servers")) {
          return Response.json(githubClarityRegistryResponse());
        }
        repositoryRequests += 1;
        return new Response(null, { status: 403 });
      },
    });

    await expect(registry.discover("Microsoft Clarity")).resolves.toMatchObject(
      {
        packageName: "@microsoft/clarity-mcp-server",
        logo: {
          url: "https://avatars.githubusercontent.com/u/6154722?s=200&v=4",
          source: "github-registry",
          kind: "owner-avatar",
          format: "raster",
        },
      },
    );
    await registry.discover("Microsoft Clarity");
    expect(repositoryRequests).toBe(1);
  });

  test("rejects a registry entry whose repository identity does not match", async () => {
    const response = githubClarityRegistryResponse();
    const [entry] = response.servers;
    if (!entry) throw new Error("Expected registry fixture entry");
    entry.server.repository.url =
      "https://github.com/unrelated/clarity-mcp-server";
    const registry = new GithubMcpRegistryClient({
      fetch: async () => Response.json(response),
    });

    await expect(
      registry.discover("Microsoft Clarity"),
    ).resolves.toBeUndefined();
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
      logo: {
        url: "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/icon.png",
        source: "github-repository",
        kind: "asset",
        format: "raster",
      },
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
          logoUrl:
            "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/icon.png",
          logoSource: "github-repository",
          tags: ["analytics"],
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
          tags: ["database"],
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

describe("official OpenAPI research", () => {
  test("derives Assessor Search server, API-key header, tools, and safe probe from the official spec", async () => {
    const specUrl = "https://assessorsearch.com/property-data-api/openapi.json";
    const researcher = new VerifiedOpenApiResearcher({
      fetch: async (input) => {
        expect(requestUrl(input)).toBe(specUrl);
        return Response.json(assessorSearchSpec());
      },
    });

    const outcome = await researcher.researchOpenApi({
      name: "Assessor Search",
      operator: "AssessorSearch",
      description: "Read nationwide public property records.",
      tags: ["property-data"],
      specUrl,
      docsUrl: "https://assessorsearch.com/property-data-api/docs",
      keyCreationUrl: "https://assessorsearch.com/dashboard",
      credentialPlaceholder: "pda_live_…",
      probe: {
        tool: "lookup_property_v1_properties_get",
        input: { address: "Springroll connector verification invalid address" },
        note: "Runs a deliberately non-matching lookup, documented as zero credits when no record is returned.",
      },
      notes: [
        "Matched core records use 1 credit; populated detail endpoints use 3 credits.",
      ],
      sources: [
        {
          title: "AssessorSearch API docs",
          url: "https://assessorsearch.com/property-data-api/docs",
        },
        { title: "Official OpenAPI", url: specUrl },
      ],
    });

    expect(outcome).toMatchObject({
      status: "ready",
      integration: {
        trust: "openapi-verified",
        manifest: {
          id: "assessor-search",
          tags: ["property-data"],
          transport: {
            kind: "openapi",
            specUrl,
            baseUrl: "https://api.assessorsearch.com/",
          },
          credential: {
            kind: "api-key",
            header: "X-API-Key",
            keyCreationUrl: "https://assessorsearch.com/dashboard",
          },
          probe: { tool: "lookup_property_v1_properties_get" },
        },
        api: {
          operationCount: 2,
          verification: {
            tool: "lookup_property_v1_properties_get",
          },
        },
        tools: [
          {
            name: "lookup_property_v1_properties_get",
            effect: "read",
          },
          {
            name: "get_property_v1_properties__property_id__get",
            effect: "read",
          },
        ],
      },
    });
  });

  test("rejects cross-provider servers and credential-bearing probes", async () => {
    const specUrl = "https://provider.example/openapi.json";
    const crossProvider = new VerifiedOpenApiResearcher({
      fetch: async () =>
        Response.json({
          ...assessorSearchSpec(),
          servers: [{ url: "https://unrelated.example.net" }],
        }),
    });
    await expect(
      crossProvider.inspect({
        name: "Provider",
        description: "Provider API",
        specUrl,
      }),
    ).rejects.toThrow("belong to the documented provider");

    const unsafeProbe = new VerifiedOpenApiResearcher({
      fetch: async () =>
        Response.json({
          ...assessorSearchSpec(),
          servers: [{ url: "https://api.provider.example" }],
        }),
    });
    await expect(
      unsafeProbe.inspect({
        name: "Provider",
        description: "Provider API",
        specUrl,
        probe: {
          tool: "lookup_property_v1_properties_get",
          input: { apiKey: "must-never-be-here" },
        },
      }),
    ).rejects.toThrow("must not contain credentials");

    await expect(
      unsafeProbe.inspect({
        name: "Provider",
        description: "Provider API",
        specUrl,
        probe: {
          tool: "lookup_property_v1_properties_get",
          input: {},
        },
      }),
    ).rejects.toThrow("explicit documented test input");
  });
});

function assessorSearchSpec() {
  return {
    openapi: "3.1.0",
    info: { title: "AssessorSearch Property Data API", version: "1.0.0" },
    servers: [{ url: "https://api.assessorsearch.com" }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas: {
        Property: {
          type: "object",
          properties: { property_id: { type: "string" } },
        },
      },
    },
    paths: {
      "/v1/properties": {
        get: {
          operationId: "lookup_property_v1_properties_get",
          summary: "Look up a property",
          parameters: [
            {
              name: "address",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Property lookup",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Property" },
                },
              },
            },
          },
        },
      },
      "/v1/properties/{property_id}": {
        get: {
          operationId: "get_property_v1_properties__property_id__get",
          summary: "Get a property record by ID",
          parameters: [
            {
              name: "property_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Property" } },
        },
      },
    },
  };
}

function githubClarityRegistryResponse() {
  return {
    servers: [
      {
        server: {
          name: "microsoft/clarity-mcp-server",
          description: "Fetch Clarity analytics via MCP clients.",
          repository: {
            source: "github",
            url: "https://github.com/microsoft/clarity-mcp-server",
          },
          packages: [
            {
              identifier: "@microsoft/clarity-mcp-server",
              registryType: "npm",
              runtimeHint: "npx",
              transport: { type: "stdio" },
              packageArguments: [
                {
                  isSecret: true,
                  variables: {
                    clarity_api_token: { isSecret: true },
                  },
                },
              ],
            },
          ],
          _meta: {
            "io.modelcontextprotocol.registry/publisher-provided": {
              github: {
                displayName: "Clarity",
                defaultBranch: "main",
                preferredImage:
                  "https://avatars.githubusercontent.com/u/6154722?s=200&v=4",
                ownerAvatarUrl:
                  "https://avatars.githubusercontent.com/u/6154722?s=200&v=4",
                opengraphImageUrl:
                  "https://opengraph.githubassets.com/example/microsoft/clarity-mcp-server",
              },
            },
          },
        },
        _meta: activeRegistryMetadata,
      },
    ],
  };
}

const activeRegistryMetadata = {
  "io.modelcontextprotocol.registry/official": {
    status: "active",
    isLatest: true,
  },
} as const;
