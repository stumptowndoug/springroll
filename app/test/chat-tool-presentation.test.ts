import { describe, expect, test } from "bun:test";
import {
  connectionResearchOutcomeFromToolPart,
  connectorProposalValidationIssuesFromToolPart,
  describeChatToolPart,
  toolApprovalRiskPresentation,
  visibleConnectionResearchOutcomeFromToolPart,
} from "../src/client/chat-tool-presentation.ts";

describe("describeChatToolPart", () => {
  test("distinguishes write approval from irreversible destructive consent", () => {
    expect(toolApprovalRiskPresentation("write")).toEqual({
      eyebrow: "Write approval required",
      title: "This action changes external data",
      description:
        "This connector call can create or modify external data. Review the exact call before allowing it to run.",
      approveLabel: "Approve and run",
      className: "write",
    });
    expect(toolApprovalRiskPresentation("destructive")).toEqual({
      eyebrow: "Destructive approval required",
      title: "This action may be irreversible",
      description:
        "This connector call may delete data or cause an irreversible external change. Review the exact call before allowing it to run.",
      approveLabel: "Approve destructive action",
      className: "destructive",
    });
  });

  test("shows the underlying connection tool and useful input", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_call_read_connection_tool",
        toolCallId: "call-1",
        state: "output-available",
        input: {
          connectionId: "web-search",
          toolName: "search_web",
          input: { query: "weather today in Redmond Oregon" },
        },
      }),
    ).toEqual({
      label: "Web search · Search web",
      detail: "weather today in Redmond Oregon",
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_call_connection_tool",
        state: "approval-requested",
        input: {
          connectionId: "stripe",
          toolName: "create_refund",
          input: { paymentIntent: "pi_123" },
        },
      }),
    ).toEqual({ label: "Stripe · Create refund" });
  });

  test("describes catalog discovery without exposing raw results", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_search_application_tools",
        toolCallId: "call-app-search",
        state: "output-available",
        input: { query: "diagnose failed run" },
      }),
    ).toEqual({
      label: "Search Springroll tools",
      detail: "diagnose failed run",
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_activate_application_tools",
        toolCallId: "call-app-activate",
        state: "output-available",
        input: { toolNames: ["springroll_get_run"] },
      }),
    ).toEqual({ label: "Activate Springroll tools" });
    expect(
      describeChatToolPart({
        type: "tool-springroll_search_connection_tools",
        toolCallId: "call-search",
        state: "output-available",
        input: { query: "property records" },
      }),
    ).toEqual({
      label: "Search connection tools",
      detail: "property records",
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_describe_connection_tools",
        toolCallId: "call-2",
        state: "output-available",
        input: { connectionId: "neon" },
      }),
    ).toEqual({ label: "Neon · Inspect tools" });
    expect(
      describeChatToolPart({
        type: "tool-springroll_activate_connection_tools",
        toolCallId: "call-activate",
        state: "output-available",
        input: {
          connectionId: "assessor-search",
          toolNames: ["get_property"],
        },
      }),
    ).toEqual({ label: "Assessor search · Activate tools" });
  });

  test("describes bounded operational inspection", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_list_approvals",
        state: "output-available",
        input: { status: "pending" },
      }),
    ).toEqual({ label: "Inspect approvals", detail: "pending" });
    expect(
      describeChatToolPart({
        type: "tool-springroll_get_usage",
        state: "output-available",
        input: { contextKind: "chat" },
      }),
    ).toEqual({ label: "Inspect usage", detail: "chat" });
    expect(
      describeChatToolPart({
        type: "tool-springroll_get_application_state",
        state: "output-available",
        input: {},
      }),
    ).toEqual({ label: "Inspect application state" });
  });

  test("describes connector research using the user's intent", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_research_connection",
        toolCallId: "call-3",
        state: "output-available",
        input: { intent: "Connect Microsoft Clarity" },
      }),
    ).toEqual({
      label: "Research connection",
      detail: "Connect Microsoft Clarity",
    });
  });

  test("accepts a GitHub Registry local-package candidate as research progress", () => {
    const part = {
      type: "tool-springroll_research_connection",
      state: "output-available",
      output: {
        status: "candidate",
        title: "Clarity was found in GitHub's MCP Registry",
        explanation: "Springroll has not verified or installed it yet.",
        instruction: "Inspect the official repository next.",
        candidate: {
          kind: "local-mcp",
          name: "Clarity",
          operator: "Microsoft",
          description: "Fetch Clarity analytics via MCP clients.",
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
        },
      },
    } as const;

    expect(connectionResearchOutcomeFromToolPart(part)).toEqual(part.output);
    expect(
      connectionResearchOutcomeFromToolPart({
        ...part,
        output: {
          ...part.output,
          candidate: {
            ...part.output.candidate,
            logo: {
              ...part.output.candidate.logo,
              url: "https://example.com/unverified-icon.png",
            },
          },
        },
      }),
    ).toBeUndefined();
  });

  test("surfaces actionable connector proposal validation", () => {
    const part = {
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      input: { packageName: "@microsoft/clarity-mcp-server" },
      output: {
        status: "invalid_input",
        issues: [{ path: "sourceUrls", message: "Expected at least two URLs" }],
      },
    };

    expect(describeChatToolPart(part)).toEqual({
      label: "Correct local MCP proposal",
      detail: "@microsoft/clarity-mcp-server",
    });
    expect(connectorProposalValidationIssuesFromToolPart(part)).toEqual([
      { path: "sourceUrls", message: "Expected at least two URLs" },
    ]);

    expect(
      describeChatToolPart({
        ...part,
        type: "tool-springroll_propose_connection",
        input: { name: "Microsoft Clarity" },
      }),
    ).toEqual({
      label: "Correct connection proposal",
      detail: "Microsoft Clarity",
    });
  });

  test("shows the official source URL being inspected", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_inspect_connector_source",
        state: "output-available",
        input: { url: "https://clarity.microsoft.com/blog/mcp" },
      }),
    ).toEqual({
      label: "Inspect official source",
      detail: "https://clarity.microsoft.com/blog/mcp",
    });
  });

  test("accepts a complete verified connection proposal for native rendering", () => {
    expect(
      connectionResearchOutcomeFromToolPart({
        type: "tool-springroll_research_connection",
        state: "output-available",
        output: {
          status: "ready",
          proposal: {
            templateId: "neon",
            name: "Neon",
            description: "Neon databases",
            operator: "Neon",
            trust: "curated",
            variants: [
              {
                id: "oauth",
                label: "Sign in with Neon",
                recommended: true,
                credentialKind: "oauth",
                guidance: {
                  summary: "Use your Neon account.",
                  steps: ["Review access", "Sign in"],
                  docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
                },
              },
            ],
          },
        },
      }),
    ).toEqual({
      status: "ready",
      proposal: {
        templateId: "neon",
        name: "Neon",
        description: "Neon databases",
        operator: "Neon",
        trust: "curated",
        variants: [
          {
            id: "oauth",
            label: "Sign in with Neon",
            recommended: true,
            credentialKind: "oauth",
            guidance: {
              summary: "Use your Neon account.",
              steps: ["Review access", "Sign in"],
              docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
            },
          },
        ],
      },
    });
  });

  test("renders a host-verified local package proposal without its manifest", () => {
    const outcome = connectionResearchOutcomeFromToolPart({
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      output: {
        status: "ready",
        proposal: {
          templateId: "research-clarity",
          name: "Microsoft Clarity",
          description: "Read Clarity analytics from this Mac.",
          operator: "Microsoft",
          trust: "package-verified",
          packageName: "@microsoft/clarity-mcp-server",
          packageVersion: "2.0.1",
          packageArgs: ["mcp"],
          manifest: {
            id: "microsoft-clarity",
            transport: { kind: "mcp-local" },
            credential: { kind: "api-key" },
          },
          sources: [
            {
              title: "Microsoft Learn",
              url: "https://learn.microsoft.com/clarity",
            },
          ],
          variants: [
            {
              id: "researched",
              label: "Connect Microsoft Clarity",
              recommended: true,
              credentialKind: "api-key",
              guidance: {
                summary: "Generate a Data Export API token.",
                steps: ["Open Settings, then Data Export."],
                docsUrl: "https://learn.microsoft.com/clarity",
              },
            },
          ],
        },
      },
    });

    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "package-verified",
        packageName: "@microsoft/clarity-mcp-server",
        packageVersion: "2.0.1",
        packageArgs: ["mcp"],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("mcp-local");
    expect(
      describeChatToolPart({
        type: "tool-springroll_propose_local_mcp",
        state: "output-available",
        input: { packageName: "@microsoft/clarity-mcp-server" },
      }),
    ).toEqual({
      label: "Verify local MCP package",
      detail: "@microsoft/clarity-mcp-server",
    });
  });

  test("renders a provider-verified generic remote MCP proposal", () => {
    const outcome = connectionResearchOutcomeFromToolPart({
      type: "tool-springroll_propose_connection",
      state: "output-available",
      output: {
        status: "ready",
        proposal: {
          templateId: "clerk",
          name: "Clerk",
          description: "Use Clerk's SDK documentation tools.",
          operator: "Clerk",
          trust: "provider-verified",
          tools: [
            {
              name: "clerk_sdk_snippet",
              description: "Find an SDK snippet.",
              effect: "read",
            },
          ],
          variants: [
            {
              id: "researched",
              label: "Connect Clerk",
              recommended: true,
              credentialKind: "none",
              guidance: {
                summary: "Connect Clerk's provider-operated MCP server.",
                steps: ["Review the endpoint and discovered tools."],
                docsUrl:
                  "https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server",
              },
            },
          ],
        },
      },
    });

    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        name: "Clerk",
        trust: "provider-verified",
        tools: [{ name: "clerk_sdk_snippet", effect: "read" }],
      },
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_propose_connection",
        state: "output-available",
        input: { name: "Clerk" },
      }),
    ).toEqual({ label: "Verify connection", detail: "Clerk" });
  });

  test("renders a host-verified OpenAPI proposal with operations and metering", () => {
    const outcome = connectionResearchOutcomeFromToolPart({
      type: "tool-springroll_propose_openapi_connection",
      state: "output-available",
      output: {
        status: "ready",
        proposal: {
          templateId: "research-assessor-search",
          name: "Assessor Search",
          description: "Read public property records.",
          operator: "AssessorSearch",
          trust: "openapi-verified",
          api: {
            specUrl:
              "https://assessorsearch.com/property-data-api/openapi.json",
            baseUrl: "https://api.assessorsearch.com/",
            operationCount: 2,
            verification: {
              tool: "lookup_property_v1_properties_get",
              note: "A non-match uses zero credits.",
            },
            notes: ["Matched records consume credits."],
          },
          tools: [
            {
              name: "lookup_property_v1_properties_get",
              description: "Look up a property",
              effect: "read",
            },
          ],
          variants: [
            {
              id: "researched",
              label: "Connect Assessor Search",
              recommended: true,
              credentialKind: "api-key",
              guidance: {
                summary: "Use an API key.",
                steps: ["Create a key."],
                docsUrl: "https://assessorsearch.com/property-data-api/docs",
              },
            },
          ],
        },
      },
    });

    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "openapi-verified",
        api: {
          operationCount: 2,
          verification: {
            tool: "lookup_property_v1_properties_get",
          },
        },
        tools: [
          {
            name: "lookup_property_v1_properties_get",
            description: "Look up a property",
            effect: "read",
          },
        ],
      },
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_propose_openapi_connection",
        input: {
          name: "Assessor Search",
          specUrl: "https://assessorsearch.com/property-data-api/openapi.json",
        },
      }),
    ).toEqual({ label: "Verify official API", detail: "Assessor Search" });
  });

  test("rejects malformed research output instead of rendering setup controls", () => {
    expect(
      connectionResearchOutcomeFromToolPart({
        type: "tool-springroll_research_connection",
        state: "output-available",
        output: {
          status: "ready",
          proposal: {
            templateId: "unsafe",
            name: "Unsafe",
            description: "Missing a credential rail",
            operator: "Unknown",
            variants: [{ id: "bad" }],
          },
        },
      }),
    ).toBeUndefined();
  });

  test("hides an intermediate registry miss when local research succeeds", () => {
    const miss = {
      type: "tool-springroll_research_connection",
      state: "output-available",
      output: {
        status: "not_found",
        title: "No official remote connector",
        explanation: "Checking reviewed local packages next.",
      },
    };
    const ready = {
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      output: {
        status: "ready",
        proposal: {
          templateId: "research-firebase",
          name: "Firebase MCP",
          description: "Local Firebase tools",
          operator: "Google Firebase",
          variants: [
            {
              id: "researched",
              label: "Connect Firebase MCP",
              recommended: true,
              credentialKind: "api-key",
              guidance: {
                summary: "Use a Firebase token.",
                steps: ["Generate the token."],
                docsUrl: "https://firebase.google.com/docs/cli/mcp-server",
              },
            },
          ],
        },
      },
    };

    expect(
      visibleConnectionResearchOutcomeFromToolPart(miss, [miss], true),
    ).toBeUndefined();
    expect(
      visibleConnectionResearchOutcomeFromToolPart(miss, [miss, ready], false),
    ).toBeUndefined();
    expect(
      visibleConnectionResearchOutcomeFromToolPart(miss, [miss], false),
    ).toMatchObject({ status: "not_found" });
    expect(
      visibleConnectionResearchOutcomeFromToolPart(ready, [miss, ready], false),
    ).toMatchObject({ status: "ready" });
  });

  test("shows only the last duplicate ready connector proposal", () => {
    const output = {
      status: "ready",
      proposal: {
        templateId: "research-clarity",
        name: "Microsoft Clarity",
        description: "Read Clarity analytics.",
        operator: "Microsoft",
        variants: [
          {
            id: "researched",
            label: "Connect Microsoft Clarity",
            recommended: true,
            credentialKind: "api-key",
            guidance: {
              summary: "Use a Clarity token.",
              steps: ["Create the token."],
              docsUrl: "https://learn.microsoft.com/clarity",
            },
          },
        ],
      },
    } as const;
    const first = {
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      output,
    } as const;
    const second = {
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      output,
    } as const;
    const parts = [first, second];

    expect(
      visibleConnectionResearchOutcomeFromToolPart(first, parts, false),
    ).toBeUndefined();
    expect(
      visibleConnectionResearchOutcomeFromToolPart(second, parts, false),
    ).toMatchObject({ status: "ready" });
  });

  test("shows only the latest recoverable miss", () => {
    const registryMiss = {
      type: "tool-springroll_research_connection",
      state: "output-available",
      output: {
        status: "not_found",
        title: "No remote MCP",
        explanation: "Check other official paths.",
      },
    };
    const packageMiss = {
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      output: {
        status: "not_found",
        title: "Package not verified",
        explanation: "Ask for an official URL.",
      },
    };

    expect(
      visibleConnectionResearchOutcomeFromToolPart(
        registryMiss,
        [registryMiss, packageMiss],
        false,
      ),
    ).toBeUndefined();
    expect(
      visibleConnectionResearchOutcomeFromToolPart(
        packageMiss,
        [registryMiss, packageMiss],
        false,
      ),
    ).toMatchObject({
      status: "not_found",
      title: "Package not verified",
    });
  });

  test("preserves an unavailable outcome that requires no user action", () => {
    const unavailable = {
      type: "tool-springroll_research_connection",
      state: "output-available",
      output: {
        status: "unavailable",
        title: "Gmail isn't ready to connect yet",
        explanation:
          "Springroll must finish its Google OAuth client registration.",
        userAction: "none",
      },
    } as const;

    expect(
      visibleConnectionResearchOutcomeFromToolPart(
        unavailable,
        [unavailable],
        false,
      ),
    ).toEqual(unavailable.output);
  });

  test("describes direct connection actions", () => {
    expect(
      describeChatToolPart({
        type: "tool-remove_connection",
        input: { connectionId: "neon" },
      }),
    ).toEqual({ label: "Remove connection", detail: "neon" });
    expect(
      describeChatToolPart({
        type: "tool-reconnect_connection",
        input: { connectionId: "github" },
      }),
    ).toEqual({ label: "Reconnect connection", detail: "github" });
  });
});
