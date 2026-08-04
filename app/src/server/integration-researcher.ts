import {
  type ConnectorManifest,
  connectorManifestSchema,
  type FetchApi,
  parseConnectorManifest,
} from "@springroll/kernel";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

const registryBaseUrl = "https://registry.modelcontextprotocol.io";

export interface IntegrationResearchSource {
  readonly title: string;
  readonly url: string;
}

export interface ResearchedIntegration {
  readonly manifest: ConnectorManifest;
  readonly operator: string;
  readonly registryName: string;
  readonly registryVersion: string;
  readonly guidance: {
    readonly summary: string;
    readonly steps: readonly string[];
    readonly docsUrl: string;
  };
  readonly sources: readonly IntegrationResearchSource[];
}

export type IntegrationResearchOutcome =
  | { readonly status: "ready"; readonly integration: ResearchedIntegration }
  | {
      readonly status: "not_found" | "unavailable";
      readonly title: string;
      readonly explanation: string;
    };

export interface IntegrationResearcher {
  research(sentence: string): Promise<IntegrationResearchOutcome>;
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

const registryRemoteSchema = z
  .object({
    type: z.string(),
    url: z.url(),
  })
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
                publishedAt: z.string().optional(),
                updatedAt: z.string().optional(),
              }),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const generatedResearchSchema = z.object({
  manifest: connectorManifestSchema,
  guidance: z.object({
    summary: z.string().min(10).max(500),
    steps: z.array(z.string().min(3).max(300)).min(2).max(6),
    docsUrl: z.url(),
  }),
  sources: z
    .array(
      z.object({
        title: z.string().min(2).max(120),
        url: z.url(),
      }),
    )
    .min(1)
    .max(8),
});

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
      const candidates = await this.#search(term);
      const ranked = candidates
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
        if (!oauth) continue;
        return { ...item.candidate, ...oauth };
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
      const registryMetadata =
        _meta["io.modelcontextprotocol.registry/official"];
      if (registryMetadata.status !== "active" || !registryMetadata.isLatest) {
        return [];
      }
      const remote = server.remotes?.find(
        (candidate) =>
          candidate.type === "streamable-http" &&
          isSafePublicHttps(candidate.url),
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
          operator: operatorName(server, providerDomain),
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

export interface AiIntegrationResearcherOptions {
  readonly loadModel: () => Promise<LanguageModel>;
  readonly searchWeb: (query: string) => Promise<string>;
  readonly fetchWeb: (url: string) => Promise<string>;
  readonly registry?: OfficialMcpRegistryClient;
}

export class AiIntegrationResearcher implements IntegrationResearcher {
  readonly #loadModel: () => Promise<LanguageModel>;
  readonly #searchWeb: (query: string) => Promise<string>;
  readonly #fetchWeb: (url: string) => Promise<string>;
  readonly #registry: OfficialMcpRegistryClient;

  constructor(options: AiIntegrationResearcherOptions) {
    this.#loadModel = options.loadModel;
    this.#searchWeb = options.searchWeb;
    this.#fetchWeb = options.fetchWeb;
    this.#registry = options.registry ?? new OfficialMcpRegistryClient();
  }

  async research(sentence: string): Promise<IntegrationResearchOutcome> {
    const candidate = await this.#registry.discover(sentence);
    if (!candidate) {
      return {
        status: "not_found",
        title: "I couldn't verify a compatible hosted connector",
        explanation:
          "I found no provider-operated remote server with compatible OAuth in the official MCP Registry. The provider may offer a local package or API-key API, but those research fallbacks are not enabled yet. Springroll won't recommend a third-party server just because its name matches.",
      };
    }

    const webResearch = await this.#searchWeb(
      `site:${candidate.providerDomain} ${candidate.operator} official MCP server tools OAuth documentation`,
    );
    const model = await this.#loadModel();
    const suggestedId = manifestId(candidate.operator);
    const result = await generateObject({
      model,
      schema: generatedResearchSchema,
      system: [
        "Draft a conservative Springroll ConnectorManifest from supplied evidence only.",
        "The MCP Registry candidate, endpoint, OAuth rail, connector id, and operator are fixed facts and must not be changed.",
        "Use only exact MCP tool names and inputs supported by official provider sources in the research packet.",
        "Choose a cheap, non-mutating identity, account, list, or search operation as the required probe.",
        "Allowlist only 3 to 10 useful tools, include the probe, and assign an explicit risk override to every allowed tool.",
        "When the user only asks to connect the service and names no action, propose read-only tools; do not include mutation or money-moving tools by default.",
        "GET/list/retrieve/search operations are read; creation and updates are write; delete/refund/cancel operations are destructive when they can irreversibly affect user data or money.",
        "The probe risk must be read. Never invent a tool merely to satisfy the schema.",
        "The blurb must use the form <b>Short category</b> — plain description.",
        "Cite only official provider pages, the provider repository, or the official MCP Registry candidate supplied in the packet.",
        "Credentials are OAuth and must never appear in guidance, tool input, or the manifest.",
      ].join(" "),
      prompt: JSON.stringify({
        userRequest: sentence,
        fixed: {
          id: suggestedId,
          operator: candidate.operator,
          transport: { kind: "mcp-remote", endpoint: candidate.endpoint },
          credential: { kind: "oauth" },
          registryName: candidate.name,
          registryVersion: candidate.version,
        },
        registryEvidence: {
          description: candidate.description,
          registryUrl: candidate.registryUrl,
          repositoryUrl: candidate.repositoryUrl,
          authorizationServer: candidate.authorizationServer,
          registrationEndpoint: candidate.registrationEndpoint,
        },
        officialWebResearch: webResearch.slice(0, 30_000),
      }),
      maxRetries: 1,
    });

    try {
      const generated = generatedResearchSchema.parse(result.object);
      const sources = validateSources(
        generated.sources,
        candidate,
        webResearch,
      );
      const docsUrl = validateSourceUrl(
        generated.guidance.docsUrl,
        candidate,
        webResearch,
      );
      const officialDocumentation = await this.#fetchWeb(docsUrl);
      const manifest = validateGeneratedManifest(
        generated.manifest,
        candidate,
        suggestedId,
        sentence,
        officialDocumentation,
      );
      return {
        status: "ready",
        integration: {
          manifest,
          operator: candidate.operator,
          registryName: candidate.name,
          registryVersion: candidate.version,
          guidance: {
            summary: `Sign in to ${candidate.operator}, review the requested access, and return while Springroll verifies a read-only connection probe.`,
            steps: [
              `Choose Sign in with ${candidate.operator}.`,
              "Review the account and permissions shown by the provider.",
              `Return to Springroll while it verifies ${manifest.probe.tool}.`,
            ],
            docsUrl,
          },
          sources,
        },
      };
    } catch (error) {
      return {
        status: "unavailable",
        title: `${candidate.operator} needs more verification`,
        explanation: `I found the provider-operated MCP server, but could not produce a source-grounded manifest that passes Springroll's safety rules: ${errorMessage(error)}`,
      };
    }
  }
}

function validateGeneratedManifest(
  value: ConnectorManifest,
  candidate: RegistryCandidate,
  expectedId: string,
  sentence: string,
  research: string,
): ConnectorManifest {
  const manifest = parseConnectorManifest(value);
  if (manifest.id !== expectedId) {
    throw new TypeError(`manifest id must be ${expectedId}`);
  }
  if (
    manifest.transport.kind !== "mcp-remote" ||
    manifest.transport.endpoint !== candidate.endpoint
  ) {
    throw new TypeError(
      "manifest endpoint must match the verified Registry server",
    );
  }
  if (manifest.credential.kind !== "oauth") {
    throw new TypeError("manifest credential rail must match verified OAuth");
  }
  if (!manifest.tools || manifest.tools.allow.length < 1) {
    throw new TypeError("manifest must define a reviewed tool allowlist");
  }
  if (!looksReadOnly(manifest.probe.tool)) {
    throw new TypeError(
      `probe tool does not look read-only: ${manifest.probe.tool}`,
    );
  }
  const evidencedTools = evidencedConnectorTools(manifest, research);
  const allRisk = Object.fromEntries(
    evidencedTools.map((tool) => {
      const proposed = manifest.tools?.risk?.[tool];
      const effect = minimumToolEffect(
        tool,
        tool === manifest.probe.tool ? "read" : proposed?.effect,
      );
      return [
        tool,
        {
          ...proposed,
          effect,
          openWorld: proposed?.openWorld ?? true,
          idempotent: proposed?.idempotent ?? effect === "read",
        },
      ];
    }),
  );
  const allow = requestedMutation(sentence)
    ? evidencedTools
    : evidencedTools.filter((tool) => allRisk[tool]?.effect === "read");
  if (!allow.includes(manifest.probe.tool)) {
    throw new TypeError("read-only default allowlist omitted the probe tool");
  }
  const risk = Object.fromEntries(allow.map((tool) => [tool, allRisk[tool]]));
  return parseConnectorManifest({
    ...manifest,
    tools: { allow, risk },
  });
}

export function evidencedConnectorTools(
  manifestValue: ConnectorManifest,
  research: string,
): readonly string[] {
  const manifest = parseConnectorManifest(manifestValue);
  const evidenced =
    manifest.tools?.allow.filter((tool) => research.includes(tool)) ?? [];
  if (!evidenced.includes(manifest.probe.tool)) {
    throw new TypeError(
      `probe tool was not found in retrieved official evidence: ${manifest.probe.tool}`,
    );
  }
  return evidenced;
}

function minimumToolEffect(
  name: string,
  proposed: "read" | "write" | "destructive" | undefined,
): "read" | "write" | "destructive" {
  const normalized = name.toLowerCase();
  if (
    /(^|[_-])(delete|refund|cancel|remove|revoke|void|archive|write)([_-]|$)/.test(
      normalized,
    )
  ) {
    return "destructive";
  }
  if (
    /(^|[_-])(create|update|set|send|post|add|issue|capture|pay)([_-]|$)/.test(
      normalized,
    )
  ) {
    return proposed === "destructive" ? "destructive" : "write";
  }
  if (
    /(^|[_-])(get|list|retrieve|search|read|fetch|lookup|details|info|summary)([_-]|$)/.test(
      normalized,
    )
  ) {
    return proposed === "destructive" || proposed === "write"
      ? proposed
      : "read";
  }
  return proposed ?? "destructive";
}

function looksReadOnly(name: string): boolean {
  return /^(get|list|retrieve|search|read|fetch|lookup|whoami|health|ping)(_|-|$)/i.test(
    name,
  );
}

function requestedMutation(sentence: string): boolean {
  const normalized = sentence
    .toLowerCase()
    .replace(
      /\b(create|add|make|set up)\s+(a|an|my|the)?\s*(connection|connector|integration|mcp)\b/g,
      "",
    )
    .replace(/\b(connect|integrate)\b/g, "");
  return /\b(create|update|write|send|post|delete|remove|cancel|refund|charge|pay|modify|manage)\b/.test(
    normalized,
  );
}

function validateSources(
  sources: readonly IntegrationResearchSource[],
  candidate: RegistryCandidate,
  research: string,
): readonly IntegrationResearchSource[] {
  const registrySource: IntegrationResearchSource = {
    title: `Official MCP Registry · ${candidate.name} ${candidate.version}`,
    url: candidate.registryUrl,
  };
  const validated = sources.map((source) => ({
    ...source,
    url: validateSourceUrl(source.url, candidate, research),
  }));
  const unique = new Map(
    [registrySource, ...validated].map((source) => [source.url, source]),
  );
  return [...unique.values()];
}

function validateSourceUrl(
  value: string,
  candidate: RegistryCandidate,
  research: string,
): string {
  const url = new URL(value);
  if (!isSafePublicHttps(url.toString())) {
    throw new TypeError("research source must use public HTTPS");
  }
  const providerSource =
    url.hostname === candidate.providerDomain ||
    url.hostname.endsWith(`.${candidate.providerDomain}`);
  const providerRepository = isProviderRepositoryUrl(
    value,
    candidate.repositoryUrl,
  );
  const registrySource = url.hostname === "registry.modelcontextprotocol.io";
  if (!providerSource && !providerRepository && !registrySource) {
    throw new TypeError(
      `research source is not provider-operated: ${url.hostname}`,
    );
  }
  if (!registrySource && !providerRepository && !research.includes(value)) {
    throw new TypeError(
      `research source was not present in retrieved evidence: ${value}`,
    );
  }
  return url.toString();
}

function isProviderRepositoryUrl(
  value: string,
  repositoryUrl: string | undefined,
): boolean {
  if (!repositoryUrl) return false;
  const source = new URL(value);
  const repository = new URL(repositoryUrl);
  if (source.hostname !== repository.hostname) return false;
  if (source.hostname !== "github.com") {
    return value.startsWith(repositoryUrl.replace(/\/$/, ""));
  }
  const sourceOwner = source.pathname.split("/").filter(Boolean)[0];
  const repositoryOwner = repository.pathname.split("/").filter(Boolean)[0];
  return sourceOwner !== undefined && sourceOwner === repositoryOwner;
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

function operatorName(
  server: z.infer<typeof registryServerSchema>,
  providerDomain: string,
): string {
  if (server.title?.trim()) return server.title.trim();
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
