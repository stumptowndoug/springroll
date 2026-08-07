import {
  type ConnectorManifest,
  type FetchApi,
  type JsonObject,
  type JsonSchema,
  normalizeOpenApiTools,
  parseConnectorManifest,
} from "@springroll/kernel";
import { z } from "zod";
import { resolveBrandLogoSvg } from "./brand-logos.ts";

const registryBaseUrl = "https://registry.modelcontextprotocol.io";
const githubRegistryBaseUrl = "https://api.mcp.github.com";
const githubRegistryWebBaseUrl = "https://github.com/mcp";

export interface IntegrationResearchSource {
  readonly title: string;
  readonly url: string;
}

export interface ResearchedIntegration {
  readonly manifest: ConnectorManifest;
  readonly operator: string;
  readonly trust?:
    | "registry-verified"
    | "package-verified"
    | "openapi-verified";
  readonly registryName?: string;
  readonly registryVersion?: string;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly guidance: {
    readonly summary: string;
    readonly steps: readonly string[];
    readonly docsUrl: string;
  };
  readonly sources: readonly IntegrationResearchSource[];
  readonly tools?: readonly {
    readonly name: string;
    readonly description: string;
    readonly effect: "read" | "write" | "destructive";
  }[];
  readonly api?: {
    readonly specUrl: string;
    readonly baseUrl: string;
    readonly operationCount: number;
    readonly verification?: {
      readonly tool: string;
      readonly note: string;
    };
    readonly notes?: readonly string[];
  };
}

export type IntegrationResearchOutcome =
  | { readonly status: "ready"; readonly integration: ResearchedIntegration }
  | {
      readonly status: "candidate";
      readonly title: string;
      readonly explanation: string;
      readonly candidate: LocalMcpRegistryCandidate;
      readonly instruction: string;
    }
  | {
      readonly status: "not_found" | "unavailable";
      readonly title: string;
      readonly explanation: string;
    };

export interface LocalMcpRegistryCandidate {
  readonly kind: "local-mcp";
  readonly name: string;
  readonly operator: string;
  readonly description: string;
  readonly packageName: string;
  readonly repositoryUrl: string;
  readonly registryUrl: string;
  readonly credentialRequired: boolean;
}

export interface IntegrationResearcher {
  research(sentence: string): Promise<IntegrationResearchOutcome>;
}

export interface LocalMcpResearchInput {
  readonly name: string;
  readonly operator: string;
  readonly description: string;
  readonly tags?: readonly string[] | undefined;
  readonly packageName: string;
  readonly packageArgs?: readonly string[] | undefined;
  readonly repositoryUrl: string;
  readonly credential:
    | {
        readonly kind: "api-key";
        readonly env: string;
        readonly placeholder: string;
        readonly keyCreationUrl?: string | undefined;
      }
    | { readonly kind: "none" };
  readonly guidance: {
    readonly summary: string;
    readonly steps: readonly string[];
    readonly docsUrl: string;
  };
  readonly sources: readonly IntegrationResearchSource[];
}

export interface LocalMcpIntegrationResearcher {
  researchLocalMcp(
    input: LocalMcpResearchInput,
  ): Promise<IntegrationResearchOutcome>;
}

export interface OpenApiResearchInput {
  readonly name: string;
  readonly operator: string;
  readonly description: string;
  readonly tags?: readonly string[] | undefined;
  readonly specUrl: string;
  readonly docsUrl: string;
  readonly keyCreationUrl?: string | undefined;
  readonly credentialPlaceholder?: string | undefined;
  readonly probe: {
    readonly tool: string;
    readonly input: JsonObject;
    readonly note: string;
  };
  readonly notes?: readonly string[] | undefined;
  readonly sources: readonly IntegrationResearchSource[];
}

export interface OpenApiIntegrationResearcher {
  inspect(input: OpenApiInspectionInput): Promise<OpenApiInspection>;
  researchOpenApi(
    input: OpenApiResearchInput,
  ): Promise<IntegrationResearchOutcome>;
}

export interface OpenApiInspectionInput {
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[] | undefined;
  readonly specUrl: string;
  readonly keyCreationUrl?: string | undefined;
  readonly credentialPlaceholder?: string | undefined;
  readonly probe?:
    | {
        readonly tool: string;
        readonly input: JsonObject;
      }
    | undefined;
}

export interface OpenApiInspection {
  readonly manifest: ConnectorManifest;
  readonly documentTitle: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly effect: "read" | "write" | "destructive";
    readonly inputSchema: JsonSchema;
  }[];
}

export class VerifiedOpenApiResearcher implements OpenApiIntegrationResearcher {
  readonly #fetch: FetchApi;

  constructor(options: { readonly fetch?: FetchApi } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async inspect(input: OpenApiInspectionInput): Promise<OpenApiInspection> {
    return inspectOpenApiConnector(input, this.#fetch);
  }

  async researchOpenApi(
    input: OpenApiResearchInput,
  ): Promise<IntegrationResearchOutcome> {
    if (!isSafePublicHttps(input.docsUrl)) {
      throw new TypeError("API documentation must use public HTTPS");
    }
    if (
      input.sources.length < 2 ||
      input.sources.length > 6 ||
      input.sources.some(
        (source) =>
          !source.title.trim() ||
          source.title.length > 200 ||
          !isSafePublicHttps(source.url),
      )
    ) {
      throw new TypeError(
        "Provide two to six official public HTTPS sources, including the API documentation and OpenAPI document",
      );
    }
    if (!input.sources.some((source) => sameUrl(source.url, input.specUrl))) {
      throw new TypeError("Official sources must include the OpenAPI document");
    }
    if (!input.sources.some((source) => sameUrl(source.url, input.docsUrl))) {
      throw new TypeError(
        "Official sources must include the API documentation",
      );
    }
    if (!sameProvider(input.specUrl, input.docsUrl)) {
      throw new TypeError(
        "The OpenAPI document and provider documentation must belong to the same provider",
      );
    }
    if (
      input.keyCreationUrl &&
      (!isSafePublicHttps(input.keyCreationUrl) ||
        !sameProvider(input.specUrl, input.keyCreationUrl))
    ) {
      throw new TypeError(
        "The API-key setup URL must belong to the documented provider",
      );
    }

    const inspection = await this.inspect(input);
    const logoSvg = resolveBrandLogoSvg(input.name, input.operator);
    const manifest = parseConnectorManifest({
      ...inspection.manifest,
      ...(logoSvg ? { logoSvg } : {}),
    });
    return {
      status: "ready",
      integration: {
        manifest,
        operator: plainText(input.operator),
        trust: "openapi-verified",
        guidance: {
          summary:
            manifest.credential.kind === "api-key"
              ? `Use a ${manifest.name} API key. Springroll stores it in Keychain and injects it only when calling ${new URL(manifest.transport.kind === "openapi" ? manifest.transport.baseUrl : input.specUrl).hostname}.`
              : `${manifest.name} does not require a credential for its documented operations.`,
          steps:
            manifest.credential.kind === "api-key"
              ? [
                  "Review the discovered operations and verification request.",
                  `Create a key in ${input.operator}'s official account controls.`,
                  "Enter the key in Springroll's secure field, never in chat.",
                ]
              : [
                  "Review the discovered operations.",
                  "Connect while Springroll verifies the documented API.",
                ],
          docsUrl: input.docsUrl,
        },
        sources: input.sources,
        tools: inspection.tools.map(({ name, description, effect }) => ({
          name,
          description,
          effect,
        })),
        api: {
          specUrl: input.specUrl,
          baseUrl:
            manifest.transport.kind === "openapi"
              ? manifest.transport.baseUrl
              : input.specUrl,
          operationCount: inspection.tools.length,
          verification: {
            tool: input.probe.tool,
            note: plainText(input.probe.note),
          },
          ...(input.notes?.length
            ? { notes: input.notes.map(plainText).filter(Boolean).slice(0, 6) }
            : {}),
        },
      },
    };
  }
}

interface NpmPackageMetadata {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly repositoryUrl: string;
}

const npmPackageMetadataSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().default("Local MCP server"),
    repository: z.union([
      z.string().min(1),
      z.object({ url: z.string().min(1) }).passthrough(),
    ]),
  })
  .passthrough();

export interface OfficialNpmRegistryClientOptions {
  readonly fetch?: FetchApi;
}

export class OfficialNpmRegistryClient {
  readonly #fetch: FetchApi;

  constructor(options: OfficialNpmRegistryClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async latest(packageName: string): Promise<NpmPackageMetadata> {
    const response = await this.#fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) {
      throw new TypeError(
        `npm could not verify ${packageName} (${response.status})`,
      );
    }
    const metadata = npmPackageMetadataSchema.parse(await response.json());
    if (metadata.name !== packageName) {
      throw new TypeError("npm returned a different package identity");
    }
    const repositoryValue =
      typeof metadata.repository === "string"
        ? metadata.repository
        : metadata.repository.url;
    const repositoryUrl = normalizedRepositoryUrl(repositoryValue);
    if (!repositoryUrl) {
      throw new TypeError(
        `${packageName} does not publish an HTTPS repository`,
      );
    }
    return {
      name: metadata.name,
      version: metadata.version,
      description: plainText(metadata.description),
      repositoryUrl,
    };
  }
}

export interface VerifiedLocalMcpResearcherOptions {
  readonly npm?: Pick<OfficialNpmRegistryClient, "latest">;
}

/**
 * Turns agent-researched install evidence into a reviewable local connector.
 * npm remains authoritative for package identity, exact version, and source
 * repository; the live MCP process remains authoritative for its tools.
 */
export class VerifiedLocalMcpResearcher
  implements LocalMcpIntegrationResearcher
{
  readonly #npm: Pick<OfficialNpmRegistryClient, "latest">;

  constructor(options: VerifiedLocalMcpResearcherOptions = {}) {
    this.#npm = options.npm ?? new OfficialNpmRegistryClient();
  }

  async researchLocalMcp(
    input: LocalMcpResearchInput,
  ): Promise<IntegrationResearchOutcome> {
    const expectedRepository = normalizedRepositoryUrl(input.repositoryUrl);
    if (!expectedRepository) {
      throw new TypeError("The researched package repository must use HTTPS");
    }
    if (
      input.sources.length < 2 ||
      input.sources.length > 6 ||
      input.sources.some(
        (source) =>
          !source.title.trim() ||
          source.title.length > 200 ||
          !isSafePublicHttps(source.url),
      )
    ) {
      throw new TypeError(
        "Provide two to six public HTTPS sources, including official documentation and the package repository",
      );
    }
    if (
      !input.sources.some(
        (source) => normalizedRepositoryUrl(source.url) === expectedRepository,
      )
    ) {
      throw new TypeError("The sources must include the package repository");
    }
    if (!isSafePublicHttps(input.guidance.docsUrl)) {
      throw new TypeError("Setup documentation must use public HTTPS");
    }
    if (
      input.credential.kind === "api-key" &&
      input.credential.keyCreationUrl &&
      !isSafePublicHttps(input.credential.keyCreationUrl)
    ) {
      throw new TypeError("The credential setup URL must use public HTTPS");
    }
    if (input.packageArgs?.some(isCredentialArgument)) {
      throw new TypeError(
        "Local MCP launch arguments must not contain credential flags or values",
      );
    }

    const metadata = await this.#npm.latest(input.packageName);
    if (metadata.repositoryUrl !== expectedRepository) {
      throw new TypeError(
        `npm says ${metadata.name} comes from ${metadata.repositoryUrl}, not the researched repository`,
      );
    }
    const logoSvg = resolveBrandLogoSvg(input.name, input.operator);
    const tags = connectorCapabilityTags(
      input.tags,
      input.name,
      input.description || metadata.description,
    );
    const manifest = parseConnectorManifest({
      id: manifestId(input.name),
      name: plainText(input.name),
      blurb: `<b>Local</b> — ${plainText(input.description || metadata.description)}`,
      ...(logoSvg ? { logoSvg } : {}),
      ...(tags.length ? { tags } : {}),
      transport: {
        kind: "mcp-local",
        package: {
          registry: "npm",
          name: metadata.name,
          version: metadata.version,
        },
        ...(input.packageArgs?.length ? { args: input.packageArgs } : {}),
      },
      credential:
        input.credential.kind === "api-key"
          ? {
              kind: "api-key",
              placeholder: plainText(input.credential.placeholder),
              env: input.credential.env,
              ...(input.credential.keyCreationUrl
                ? { keyCreationUrl: input.credential.keyCreationUrl }
                : {}),
            }
          : { kind: "none" },
    });
    const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(metadata.name)}/v/${metadata.version}`;
    const sources = dedupeSources([
      ...input.sources,
      {
        title: `npm · ${metadata.name} ${metadata.version}`,
        url: npmUrl,
      },
    ]);
    return {
      status: "ready",
      integration: {
        manifest,
        operator: plainText(input.operator),
        trust: "package-verified",
        packageName: metadata.name,
        packageVersion: metadata.version,
        guidance: {
          summary: plainText(input.guidance.summary),
          steps: input.guidance.steps
            .map(plainText)
            .filter(Boolean)
            .slice(0, 8),
          docsUrl: input.guidance.docsUrl,
        },
        sources,
      },
    };
  }
}

interface RegistryCandidate {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly version: string;
  readonly endpoint: string;
  readonly repositoryUrl?: string;
  readonly providerDomain: string;
  readonly operator: string;
  readonly registryUrl: string;
}

interface VerifiedRegistryCandidate extends RegistryCandidate {
  readonly authorizationServer: string;
  readonly registrationEndpoint: string;
}

interface RegistryCacheEntry {
  readonly expiresAt: number;
  readonly candidates: readonly RegistryCandidate[];
}

export interface GithubRegistryCandidate extends LocalMcpRegistryCandidate {
  readonly registryName: string;
}

interface GithubRegistryCacheEntry {
  readonly expiresAt: number;
  readonly candidates: readonly GithubRegistryCandidate[];
}

const registryRemoteSchema = z
  .object({ type: z.string(), url: z.url() })
  .passthrough();

const registryServerSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().default("Remote MCP server"),
    version: z.string().min(1),
    repository: z.object({ url: z.url() }).passthrough().optional(),
    remotes: z.array(registryRemoteSchema).optional(),
  })
  .passthrough();

const registryResponseSchema = z
  .object({
    servers: z.array(
      z
        .object({
          server: registryServerSchema,
          _meta: z
            .object({
              "io.modelcontextprotocol.registry/official": z.object({
                status: z.string(),
                isLatest: z.boolean(),
              }),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const githubRegistryPackageArgumentSchema = z
  .object({
    isSecret: z.boolean().optional(),
    variables: z
      .record(
        z.string(),
        z.object({ isSecret: z.boolean().optional() }).passthrough(),
      )
      .optional(),
  })
  .passthrough();

const githubRegistryPackageSchema = z
  .object({
    identifier: z.string().min(1),
    registryType: z.string(),
    runtimeHint: z.string().optional(),
    transport: z.object({ type: z.string() }).passthrough().optional(),
    packageArguments: z.array(githubRegistryPackageArgumentSchema).optional(),
  })
  .passthrough();

const githubRegistryResponseSchema = z
  .object({
    servers: z.array(
      z
        .object({
          server: z
            .object({
              name: z.string().min(1),
              description: z.string().default("Local MCP server"),
              repository: z
                .object({ source: z.string(), url: z.url() })
                .optional(),
              packages: z.array(githubRegistryPackageSchema).optional(),
              _meta: z
                .object({
                  "io.modelcontextprotocol.registry/publisher-provided": z
                    .object({
                      github: z
                        .object({ displayName: z.string().min(1).optional() })
                        .passthrough(),
                    })
                    .passthrough(),
                })
                .passthrough()
                .optional(),
            })
            .passthrough(),
          _meta: z
            .object({
              "io.modelcontextprotocol.registry/official": z.object({
                status: z.string(),
                isLatest: z.boolean(),
              }),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export interface OfficialMcpRegistryClientOptions {
  readonly fetch?: FetchApi;
  readonly now?: () => number;
  readonly cacheTtlMs?: number;
}

export class OfficialMcpRegistryClient {
  readonly #fetch: FetchApi;
  readonly #now: () => number;
  readonly #cacheTtlMs: number;
  readonly #cache = new Map<string, RegistryCacheEntry>();

  constructor(options: OfficialMcpRegistryClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#cacheTtlMs = options.cacheTtlMs ?? 15 * 60_000;
  }

  async discover(
    sentence: string,
  ): Promise<VerifiedRegistryCandidate | undefined> {
    const terms = providerSearchTerms(sentence);
    const fullTerm = terms[0];
    if (!fullTerm) return undefined;
    for (const term of terms) {
      const ranked = (await this.#search(term))
        .filter(
          (candidate) =>
            isProviderOperated(candidate) &&
            candidateMatchesRequest(candidate, fullTerm),
        )
        .map((candidate) => ({
          candidate,
          score: candidateScore(candidate, fullTerm),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);

      for (const item of ranked.slice(0, 3)) {
        const oauth = await inspectOAuthRemote(
          item.candidate.endpoint,
          this.#fetch,
        ).catch(() => undefined);
        if (oauth) return { ...item.candidate, ...oauth };
      }
    }
    return undefined;
  }

  async #search(term: string): Promise<readonly RegistryCandidate[]> {
    const key = term.toLowerCase();
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > this.#now()) return cached.candidates;

    const url = new URL("/v0.1/servers", registryBaseUrl);
    url.searchParams.set("search", term);
    url.searchParams.set("limit", "30");
    const response = await this.#fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Official MCP Registry search failed (${response.status})`,
      );
    }
    const body = registryResponseSchema.parse(await response.json());
    const candidates = body.servers.flatMap(({ server, _meta }) => {
      const official = _meta["io.modelcontextprotocol.registry/official"];
      if (official.status !== "active" || !official.isLatest) return [];
      const remote = server.remotes?.find(
        (item) =>
          item.type === "streamable-http" && isSafePublicHttps(item.url),
      );
      if (!remote) return [];
      const providerDomain = providerDomainForNamespace(server.name);
      if (!providerDomain) return [];
      return [
        {
          name: server.name,
          ...(server.title ? { title: server.title } : {}),
          description: server.description,
          version: server.version,
          endpoint: new URL(remote.url).toString(),
          ...(server.repository?.url
            ? { repositoryUrl: server.repository.url }
            : {}),
          providerDomain,
          operator: operatorName(providerDomain),
          registryUrl: `${registryBaseUrl}/?q=${encodeURIComponent(server.name)}`,
        },
      ];
    });
    this.#cache.set(key, {
      expiresAt: this.#now() + this.#cacheTtlMs,
      candidates,
    });
    return candidates;
  }
}

export interface GithubMcpRegistryClientOptions {
  readonly fetch?: FetchApi;
  readonly now?: () => number;
  readonly cacheTtlMs?: number;
}

/**
 * GitHub's curated MCP Registry is a downstream registry with useful local
 * package metadata that is not always present in the official metaregistry.
 * Its entries are discovery leads only; package and repository facts are
 * independently verified before Springroll creates a proposal.
 */
export class GithubMcpRegistryClient {
  readonly #fetch: FetchApi;
  readonly #now: () => number;
  readonly #cacheTtlMs: number;
  readonly #cache = new Map<string, GithubRegistryCacheEntry>();

  constructor(options: GithubMcpRegistryClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#cacheTtlMs = options.cacheTtlMs ?? 15 * 60_000;
  }

  async discover(
    sentence: string,
  ): Promise<GithubRegistryCandidate | undefined> {
    const terms = providerSearchTerms(sentence);
    const fullTerm = terms[0];
    if (!fullTerm) return undefined;
    for (const term of terms) {
      const candidate = (await this.#search(term))
        .filter((item) => githubCandidateMatchesRequest(item, fullTerm))
        .map((item) => ({
          candidate: item,
          score: githubCandidateScore(item, fullTerm),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)[0]?.candidate;
      if (candidate) return candidate;
    }
    return undefined;
  }

  async #search(term: string): Promise<readonly GithubRegistryCandidate[]> {
    const key = term.toLowerCase();
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > this.#now()) return cached.candidates;

    const url = new URL("/v0.1/servers", githubRegistryBaseUrl);
    url.searchParams.set("search", term);
    url.searchParams.set("limit", "30");
    const response = await this.#fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`GitHub MCP Registry search failed (${response.status})`);
    }
    const body = githubRegistryResponseSchema.parse(await response.json());
    const candidates = body.servers.flatMap(({ server, _meta }) => {
      const official = _meta["io.modelcontextprotocol.registry/official"];
      if (official.status !== "active" || !official.isLatest) return [];
      if (!server.repository) return [];
      const repositoryUrl = githubRepositoryUrl(server.repository);
      if (!repositoryUrl) return [];
      const repository = new URL(repositoryUrl);
      const repositoryName = repository.pathname.replace(/^\//, "");
      if (
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(server.name) ||
        server.name.toLowerCase() !== repositoryName.toLowerCase()
      ) {
        return [];
      }
      const packageEntry = server.packages?.find(
        (item) =>
          item.registryType === "npm" &&
          item.transport?.type === "stdio" &&
          isNpmPackageName(item.identifier),
      );
      if (!packageEntry) return [];
      const owner = repositoryName.split("/")[0];
      if (!owner) return [];
      return [
        {
          kind: "local-mcp" as const,
          name:
            server._meta?.[
              "io.modelcontextprotocol.registry/publisher-provided"
            ].github.displayName ?? githubRegistryDisplayName(server.name),
          operator: githubOwnerName(owner),
          description: plainText(server.description),
          packageName: packageEntry.identifier,
          repositoryUrl,
          registryUrl: new URL(
            `/mcp/${server.name}`,
            githubRegistryWebBaseUrl,
          ).toString(),
          credentialRequired: packageRequiresCredential(packageEntry),
          registryName: server.name,
        },
      ];
    });
    this.#cache.set(key, {
      expiresAt: this.#now() + this.#cacheTtlMs,
      candidates,
    });
    return candidates;
  }
}

export interface AiIntegrationResearcherOptions {
  readonly registry?: Pick<OfficialMcpRegistryClient, "discover">;
  readonly githubRegistry?: Pick<GithubMcpRegistryClient, "discover">;
}

/**
 * The agent chooses what to look for, but does not author the MCP contract.
 * Registry metadata supplies installation facts and the live server supplies
 * tool names and schemas after authentication.
 */
export class AiIntegrationResearcher implements IntegrationResearcher {
  readonly #registry: Pick<OfficialMcpRegistryClient, "discover">;
  readonly #githubRegistry: Pick<GithubMcpRegistryClient, "discover">;

  constructor(options: AiIntegrationResearcherOptions = {}) {
    this.#registry = options.registry ?? new OfficialMcpRegistryClient();
    this.#githubRegistry =
      options.githubRegistry ?? new GithubMcpRegistryClient();
  }

  async research(sentence: string): Promise<IntegrationResearchOutcome> {
    let officialRegistryUnavailable = false;
    const candidate = await this.#registry.discover(sentence).catch(() => {
      officialRegistryUnavailable = true;
      return undefined;
    });
    if (!candidate) {
      let githubRegistryUnavailable = false;
      const localCandidate = await this.#githubRegistry
        .discover(sentence)
        .catch(() => {
          githubRegistryUnavailable = true;
          return undefined;
        });
      if (localCandidate) {
        const { registryName: _, ...publicCandidate } = localCandidate;
        return {
          status: "candidate",
          title: `${localCandidate.name} was found in GitHub's MCP Registry`,
          explanation: `${localCandidate.operator} publishes a local npm MCP candidate at ${localCandidate.repositoryUrl}. Springroll has not installed, authenticated, or tested it yet.`,
          candidate: publicCandidate,
          instruction:
            "Inspect candidate.repositoryUrl with springroll_inspect_connector_source, verify the exact npm package and a host-side credential rail from official evidence, then submit springroll_propose_local_mcp. Do not place a credential in package arguments, tool inputs, or chat.",
        };
      }
      if (officialRegistryUnavailable || githubRegistryUnavailable) {
        const unavailable = [
          ...(officialRegistryUnavailable ? ["official"] : []),
          ...(githubRegistryUnavailable ? ["GitHub"] : []),
        ].join(" and ");
        return {
          status: "unavailable",
          title: `${unavailable} MCP Registry check is unavailable`,
          explanation:
            "Springroll could not complete every structured registry search. Continue with official provider documentation, OpenAPI discovery, or reviewed package research instead of treating this as a final connection failure.",
        };
      }
      return {
        status: "not_found",
        title: "I couldn't verify an official remote connector",
        explanation:
          "No provider-operated remote MCP server with compatible sign-in or matching GitHub-curated local MCP package was found in the two structured registries. Continue with the provider's official documentation, OpenAPI description, or reviewed package research; if automatic research is exhausted, ask the user for an official setup URL.",
      };
    }

    const name = candidate.title?.trim() || candidate.operator;
    const logoSvg = resolveBrandLogoSvg(name, candidate.operator);
    const tags = connectorCapabilityTags(
      undefined,
      name,
      candidate.description,
    );
    const manifest = parseConnectorManifest({
      id: manifestId(candidate.operator),
      name,
      blurb: `<b>MCP</b> — ${plainText(candidate.description)}`,
      ...(logoSvg ? { logoSvg } : {}),
      ...(tags.length ? { tags } : {}),
      transport: { kind: "mcp-remote", endpoint: candidate.endpoint },
      credential: { kind: "oauth" },
    });
    const docsUrl = candidate.repositoryUrl ?? candidate.registryUrl;
    const sources: IntegrationResearchSource[] = [
      {
        title: `Official MCP Registry · ${candidate.name} ${candidate.version}`,
        url: candidate.registryUrl,
      },
      ...(candidate.repositoryUrl
        ? [
            {
              title: `${candidate.operator} connector source`,
              url: candidate.repositoryUrl,
            },
          ]
        : []),
    ];

    return {
      status: "ready",
      integration: {
        manifest,
        operator: candidate.operator,
        registryName: candidate.name,
        registryVersion: candidate.version,
        guidance: {
          summary: `Sign in to ${candidate.operator}; Springroll will then discover the tools the server actually exposes.`,
          steps: [
            `Choose Sign in with ${candidate.operator}.`,
            "Review the account and permissions shown by the provider.",
            "Return to Springroll while it reads the server's current tool catalog.",
          ],
          docsUrl,
        },
        sources,
      },
    };
  }
}

export async function inspectOpenApiConnector(
  input: OpenApiInspectionInput,
  request: FetchApi = globalThis.fetch,
): Promise<OpenApiInspection> {
  if (!isSafePublicHttps(input.specUrl)) {
    throw new TypeError("OpenAPI documents must use public HTTPS");
  }
  if (
    input.keyCreationUrl &&
    (!isSafePublicHttps(input.keyCreationUrl) ||
      !sameProvider(input.specUrl, input.keyCreationUrl))
  ) {
    throw new TypeError(
      "The API-key setup URL must belong to the OpenAPI provider",
    );
  }
  const document = await fetchOpenApiDocument(input.specUrl, request);
  const root = objectValue(document, "OpenAPI document");
  if (typeof root.openapi !== "string" || !root.openapi.startsWith("3.")) {
    throw new TypeError("OpenAPI document must use version 3.x");
  }
  const info = objectValue(root.info, "OpenAPI info");
  const documentTitle =
    typeof info.title === "string" && info.title.trim()
      ? plainText(info.title)
      : plainText(input.name);
  const baseUrl = openApiBaseUrl(root, input.specUrl);
  if (!isSafePublicHttps(baseUrl) || !sameProvider(input.specUrl, baseUrl)) {
    throw new TypeError(
      "The OpenAPI server must use public HTTPS and belong to the documented provider",
    );
  }
  const credential = openApiCredential(root, input);
  const tags = connectorCapabilityTags(
    input.tags,
    input.name,
    input.description,
  );
  const manifest = parseConnectorManifest({
    id: manifestId(input.name),
    name: plainText(input.name),
    blurb: `<b>API</b> — ${plainText(input.description)}`,
    ...(tags.length ? { tags } : {}),
    transport: { kind: "openapi", specUrl: input.specUrl, baseUrl },
    credential,
    ...(input.probe
      ? {
          probe: {
            tool: input.probe.tool,
            input: input.probe.input,
          },
        }
      : {}),
  });
  const descriptors = normalizeOpenApiTools(document, manifest);
  if (descriptors.length === 0) {
    throw new TypeError("The OpenAPI document does not expose any operations");
  }
  if (descriptors.length > 200) {
    throw new TypeError(
      "The OpenAPI document exposes more than 200 operations; add a reviewed operation allowlist before connecting it",
    );
  }
  if (input.probe) {
    const descriptor = descriptors.find(
      (candidate) => candidate.name === input.probe?.tool,
    );
    if (!descriptor) {
      throw new TypeError(
        `Verification operation is not in the OpenAPI document: ${input.probe.tool}`,
      );
    }
    if (descriptor.declaredRisk?.effect !== "read") {
      throw new TypeError("OpenAPI verification must use a GET operation");
    }
    const properties = objectValue(
      descriptor.inputSchema.properties ?? {},
      "OpenAPI verification input properties",
    );
    if (
      Object.keys(properties).length > 0 &&
      Object.keys(input.probe.input).length === 0
    ) {
      throw new TypeError(
        "OpenAPI verification must provide an explicit documented test input",
      );
    }
    const encodedProbe = JSON.stringify(input.probe.input);
    if (
      encodedProbe.length > 16_000 ||
      containsCredentialField(input.probe.input)
    ) {
      throw new TypeError(
        "OpenAPI verification input must be small and must not contain credentials",
      );
    }
  }
  return {
    manifest,
    documentTitle,
    tools: descriptors.map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      effect: descriptor.declaredRisk?.effect ?? "write",
      inputSchema: descriptor.inputSchema,
    })),
  };
}

async function fetchOpenApiDocument(
  initialUrl: string,
  request: FetchApi,
): Promise<unknown> {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await request(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new TypeError("OpenAPI redirect has no location");
      const next = new URL(location, url);
      if (
        !isSafePublicHttps(next.toString()) ||
        !sameProvider(initialUrl, next.toString())
      ) {
        throw new TypeError(
          "OpenAPI redirects must remain on the documented provider",
        );
      }
      url = next;
      continue;
    }
    if (!response.ok) {
      throw new TypeError(
        `Could not fetch the OpenAPI document (${response.status})`,
      );
    }
    const body = await response.text();
    if (body.length > 5_000_000) {
      throw new TypeError("OpenAPI document exceeds the 5 MB safety limit");
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new TypeError("OpenAPI document must be valid JSON");
    }
  }
  throw new TypeError("OpenAPI document redirected too many times");
}

function openApiBaseUrl(
  root: Readonly<Record<string, unknown>>,
  specUrl: string,
): string {
  if (!Array.isArray(root.servers) || root.servers.length === 0) {
    return new URL(specUrl).origin;
  }
  const first = objectValue(root.servers[0], "OpenAPI server");
  if (typeof first.url !== "string" || !first.url.trim()) {
    throw new TypeError("OpenAPI server URL is missing");
  }
  if (/\{[^}]+\}/.test(first.url)) {
    throw new TypeError("Templated OpenAPI server URLs are unsupported");
  }
  return new URL(first.url, specUrl).toString();
}

function openApiCredential(
  root: Readonly<Record<string, unknown>>,
  input: OpenApiInspectionInput,
): ConnectorManifest["credential"] {
  const securityNames = openApiSecurityNames(root);
  if (securityNames.length === 0) return { kind: "none" };
  if (securityNames.length > 1) {
    throw new TypeError(
      "OpenAPI connectors currently support one shared API-key or bearer authentication scheme",
    );
  }
  const components = objectValue(root.components, "OpenAPI components");
  const schemes = objectValue(
    components.securitySchemes,
    "OpenAPI security schemes",
  );
  const name = securityNames[0];
  const scheme = objectValue(
    name ? schemes[name] : undefined,
    "OpenAPI security scheme",
  );
  const placeholder =
    input.credentialPlaceholder?.trim() || `${plainText(input.name)} API key`;
  const common = {
    kind: "api-key" as const,
    placeholder,
    ...(input.keyCreationUrl ? { keyCreationUrl: input.keyCreationUrl } : {}),
  };
  if (scheme.type === "apiKey") {
    if (scheme.in !== "header" || typeof scheme.name !== "string") {
      throw new TypeError("Only header-based OpenAPI API keys are supported");
    }
    return { ...common, header: scheme.name };
  }
  if (
    scheme.type === "http" &&
    typeof scheme.scheme === "string" &&
    scheme.scheme.toLowerCase() === "bearer"
  ) {
    return common;
  }
  throw new TypeError(
    "OpenAPI authentication must use a header API key or HTTP bearer token",
  );
}

function openApiSecurityNames(
  root: Readonly<Record<string, unknown>>,
): readonly string[] {
  const requirements: unknown[] = [];
  if (Array.isArray(root.security)) requirements.push(...root.security);
  if (requirements.length === 0) {
    const paths = objectValue(root.paths, "OpenAPI paths");
    for (const pathItemValue of Object.values(paths)) {
      const pathItem = objectValue(pathItemValue, "OpenAPI path");
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const operation = pathItem[method];
        if (!operation || typeof operation !== "object") continue;
        const security = Reflect.get(operation, "security");
        if (Array.isArray(security)) requirements.push(...security);
      }
    }
  }
  const names = new Set<string>();
  for (const requirementValue of requirements) {
    const requirement = objectValue(
      requirementValue,
      "OpenAPI security requirement",
    );
    for (const name of Object.keys(requirement)) names.add(name);
  }
  return [...names];
}

function objectValue(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function containsCredentialField(value: JsonObject): boolean {
  const visit = (current: unknown): boolean => {
    if (Array.isArray(current)) return current.some(visit);
    if (!current || typeof current !== "object") return false;
    return Object.entries(current).some(
      ([key, entry]) =>
        /(?:authorization|api.?key|token|secret|password|credential)/i.test(
          key,
        ) || visit(entry),
    );
  };
  return visit(value);
}

function sameUrl(left: string, right: string): boolean {
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}

function sameProvider(left: string, right: string): boolean {
  try {
    return (
      providerRoot(new URL(left).hostname) ===
      providerRoot(new URL(right).hostname)
    );
  } catch {
    return false;
  }
}

function providerRoot(hostname: string): string {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  const commonSecondLevel = new Set(["ac", "co", "com", "gov", "net", "org"]);
  const length =
    labels.length >= 3 &&
    labels.at(-1)?.length === 2 &&
    commonSecondLevel.has(labels.at(-2) ?? "")
      ? 3
      : 2;
  return labels.slice(-length).join(".");
}

export function connectorCapabilityTags(
  supplied: readonly string[] | undefined,
  name: string,
  description: string,
): readonly string[] {
  if (supplied?.length) return supplied.slice(0, 6);
  const normalizedName = name.toLowerCase();
  const nameRules: readonly [RegExp, string][] = [
    [/exa|firecrawl|tavily|parallel/, "search"],
    [/gmail|email|mail/, "email"],
    [/firebase|neon|postgres|database/, "database"],
    [/jira|linear/, "planning"],
    [/clarity|analytics/, "analytics"],
    [/stripe|payment/, "payments"],
    [/slack|messag/, "messaging"],
    [/github|gitlab|repository/, "code"],
    [/notion|workspace|wiki/, "workspace"],
  ];
  const nameTags = nameRules
    .filter(([pattern]) => pattern.test(normalizedName))
    .map(([, tag]) => tag);
  if (nameTags.length) return [...new Set(nameTags)].slice(0, 4);

  const text = description.toLowerCase();
  const rules: readonly [RegExp, string][] = [
    [/search|crawl|scrap|\bweb\b|browser/, "search"],
    [/email|\bmail\b|gmail/, "email"],
    [/database|postgres|\bsql\b|firebase|neon|storage/, "database"],
    [/planning|jira|linear/, "planning"],
    [/analytics|metric|clarity/, "analytics"],
    [/payment|stripe|billing|commerce/, "payments"],
    [/message|slack|chat|conversation/, "messaging"],
    [/\bcode\b|github|repository|developer/, "code"],
    [/notion|workspace|wiki/, "workspace"],
  ];
  return rules
    .filter(([pattern]) => pattern.test(text))
    .map(([, tag]) => tag)
    .slice(0, 4);
}

async function inspectOAuthRemote(
  endpoint: string,
  request: FetchApi,
): Promise<
  | {
      readonly authorizationServer: string;
      readonly registrationEndpoint: string;
    }
  | undefined
> {
  const endpointUrl = new URL(endpoint);
  const response = await request(endpointUrl, {
    method: "GET",
    headers: { accept: "application/json, text/event-stream" },
    redirect: "manual",
  });
  const metadataValue = readResourceMetadataUrl(
    response.headers.get("www-authenticate"),
  );
  const resourceMetadataUrl = metadataValue
    ? new URL(metadataValue, endpointUrl)
    : new URL("/.well-known/oauth-protected-resource", endpointUrl.origin);
  if (
    resourceMetadataUrl.protocol !== "https:" ||
    resourceMetadataUrl.origin !== endpointUrl.origin
  ) {
    return undefined;
  }
  const resourceResponse = await request(resourceMetadataUrl, {
    headers: { accept: "application/json" },
  });
  if (!resourceResponse.ok) return undefined;
  const resource = z
    .object({ authorization_servers: z.array(z.url()).min(1) })
    .passthrough()
    .safeParse(await resourceResponse.json());
  if (!resource.success) return undefined;

  for (const authorizationServer of resource.data.authorization_servers) {
    if (!isSafePublicHttps(authorizationServer)) continue;
    for (const metadataUrl of authorizationMetadataUrls(authorizationServer)) {
      const metadataResponse = await request(metadataUrl, {
        headers: { accept: "application/json" },
      });
      if (!metadataResponse.ok) continue;
      const metadata = z
        .object({
          issuer: z.url(),
          authorization_endpoint: z.url(),
          token_endpoint: z.url(),
          registration_endpoint: z.url(),
        })
        .passthrough()
        .safeParse(await metadataResponse.json());
      if (!metadata.success || metadata.data.issuer !== authorizationServer) {
        continue;
      }
      if (
        !isSafePublicHttps(metadata.data.authorization_endpoint) ||
        !isSafePublicHttps(metadata.data.token_endpoint) ||
        !isSafePublicHttps(metadata.data.registration_endpoint)
      ) {
        continue;
      }
      return {
        authorizationServer,
        registrationEndpoint: metadata.data.registration_endpoint,
      };
    }
  }
  return undefined;
}

function authorizationMetadataUrls(issuer: string): readonly URL[] {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return [
    new URL(`/.well-known/oauth-authorization-server${path}`, url.origin),
    new URL("/.well-known/oauth-authorization-server", url.origin),
  ];
}

function readResourceMetadataUrl(header: string | null): string | undefined {
  if (!header) return undefined;
  return /resource_metadata=(?:"([^"]+)"|([^,\s]+))/i
    .exec(header)
    ?.slice(1)
    .find(Boolean);
}

function githubRepositoryUrl(repository: {
  readonly source: string;
  readonly url: string;
}): string | undefined {
  if (repository.source.toLowerCase() !== "github") return undefined;
  const normalized = normalizedRepositoryUrl(repository.url);
  if (!normalized) return undefined;
  const url = new URL(normalized);
  return url.hostname.toLowerCase() === "github.com" ? normalized : undefined;
}

function isNpmPackageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/.test(
    value,
  );
}

function packageRequiresCredential(
  packageEntry: z.infer<typeof githubRegistryPackageSchema>,
): boolean {
  return (packageEntry.packageArguments ?? []).some(
    (argument) =>
      argument.isSecret === true ||
      Object.values(argument.variables ?? {}).some(
        (variable) => variable.isSecret === true,
      ),
  );
}

function githubRegistryDisplayName(name: string): string {
  const repository = name.split("/").at(-1) ?? name;
  return repository
    .replace(/(?:^|[-_])mcp(?:[-_]|$)/gi, " ")
    .replace(/(?:^|[-_])server(?:[-_]|$)/gi, " ")
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function githubOwnerName(owner: string): string {
  return owner
    .split(/[-_]/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function githubCandidateMatchesRequest(
  candidate: GithubRegistryCandidate,
  fullTerm: string,
): boolean {
  const terms = fullTerm.split(/\s+/);
  const haystack = [
    candidate.registryName,
    candidate.name,
    candidate.operator,
    candidate.packageName,
    candidate.description,
  ]
    .join(" ")
    .toLowerCase();
  if (!terms.every((term) => haystack.includes(term))) return false;
  if (terms.length < 2) return true;
  const operator = candidate.operator.toLowerCase();
  return terms.some((term) => operator.includes(term));
}

function githubCandidateScore(
  candidate: GithubRegistryCandidate,
  fullTerm: string,
): number {
  const terms = fullTerm.split(/\s+/);
  const identity = [
    candidate.registryName,
    candidate.name,
    candidate.operator,
    candidate.packageName,
  ]
    .join(" ")
    .toLowerCase();
  const description = candidate.description.toLowerCase();
  let score = terms.reduce(
    (total, term) =>
      total +
      (identity.includes(term) ? 20 : description.includes(term) ? 5 : -10),
    0,
  );
  if (candidate.registryName.toLowerCase().includes(fullTerm)) score += 30;
  if (candidate.credentialRequired) score += 1;
  return score;
}

function providerSearchTerms(sentence: string): readonly string[] {
  const stopWords = new Set([
    "a",
    "account",
    "add",
    "an",
    "connect",
    "connection",
    "connector",
    "create",
    "for",
    "i",
    "integration",
    "make",
    "mcp",
    "my",
    "please",
    "read",
    "retrieve",
    "search",
    "set",
    "the",
    "to",
    "up",
    "want",
    "with",
    "write",
  ]);
  const tokens = sentence
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
  if (tokens.length === 0) return [];
  return [...new Set([tokens.join(" "), ...tokens])];
}

function providerDomainForNamespace(name: string): string | undefined {
  const namespace = name.split("/")[0];
  if (!namespace) return undefined;
  const parts = namespace.split(".");
  if (parts.length < 2 || (parts[0] === "io" && parts[1] === "github")) {
    return undefined;
  }
  return [...parts].reverse().join(".");
}

function isProviderOperated(candidate: RegistryCandidate): boolean {
  const hostname = new URL(candidate.endpoint).hostname;
  return (
    hostname === candidate.providerDomain ||
    hostname.endsWith(`.${candidate.providerDomain}`)
  );
}

function candidateScore(candidate: RegistryCandidate, term: string): number {
  const terms = term.toLowerCase().split(/\s+/);
  const providerIdentity =
    `${candidate.providerDomain} ${candidate.operator}`.toLowerCase();
  if (!terms.some((token) => providerIdentity.includes(token))) {
    return Number.NEGATIVE_INFINITY;
  }
  const haystack = [candidate.name, candidate.title, candidate.description]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();
  let score = terms.reduce(
    (total, token) => total + (haystack.includes(token) ? 10 : -5),
    0,
  );
  if (candidate.name.toLowerCase().includes(term.toLowerCase())) score += 25;
  if (isProviderOperated(candidate)) score += 100;
  return score;
}

function candidateMatchesRequest(
  candidate: RegistryCandidate,
  fullTerm: string,
): boolean {
  const terms = fullTerm.split(/\s+/);
  const providerIdentity =
    `${candidate.providerDomain} ${candidate.operator}`.toLowerCase();
  const firstTerm = terms[0];
  if (!firstTerm || !providerIdentity.includes(firstTerm)) return false;
  const haystack = [candidate.name, candidate.title, candidate.description]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function operatorName(providerDomain: string): string {
  const label = providerDomain.split(".")[0] ?? providerDomain;
  return label
    .split(/[-_]/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function manifestId(operator: string): string {
  return operator
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedRepositoryUrl(value: string): string | undefined {
  try {
    const normalized = value
      .trim()
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^git@github\.com:/, "https://github.com/");
    const url = new URL(normalized);
    if (url.protocol !== "https:") return undefined;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function isCredentialArgument(value: string): boolean {
  return /(?:^|[-_])(token|api[-_]?key|secret|password)(?:=|$)/i.test(value);
}

function dedupeSources(
  sources: readonly IntegrationResearchSource[],
): readonly IntegrationResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const url = new URL(source.url).toString();
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function isSafePublicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return false;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
