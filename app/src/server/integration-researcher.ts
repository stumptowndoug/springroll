import {
  type ConnectorManifest,
  type FetchApi,
  parseConnectorManifest,
} from "@springroll/kernel";
import { z } from "zod";

const registryBaseUrl = "https://registry.modelcontextprotocol.io";

export interface IntegrationResearchSource {
  readonly title: string;
  readonly url: string;
}

export interface ResearchedIntegration {
  readonly manifest: ConnectorManifest;
  readonly operator: string;
  readonly trust?: "registry-verified" | "package-verified";
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

export interface LocalMcpResearchInput {
  readonly name: string;
  readonly operator: string;
  readonly description: string;
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
    const manifest = parseConnectorManifest({
      id: manifestId(input.name),
      name: plainText(input.name),
      blurb: `<b>Local</b> — ${plainText(input.description || metadata.description)}`,
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

export interface AiIntegrationResearcherOptions {
  readonly registry?: Pick<OfficialMcpRegistryClient, "discover">;
}

/**
 * The agent chooses what to look for, but does not author the MCP contract.
 * Registry metadata supplies installation facts and the live server supplies
 * tool names and schemas after authentication.
 */
export class AiIntegrationResearcher implements IntegrationResearcher {
  readonly #registry: Pick<OfficialMcpRegistryClient, "discover">;

  constructor(options: AiIntegrationResearcherOptions = {}) {
    this.#registry = options.registry ?? new OfficialMcpRegistryClient();
  }

  async research(sentence: string): Promise<IntegrationResearchOutcome> {
    const candidate = await this.#registry.discover(sentence);
    if (!candidate) {
      return {
        status: "not_found",
        title: "I couldn't verify an official remote connector",
        explanation:
          "No provider-operated remote MCP server with compatible sign-in was found in the official MCP Registry. You can still add a known MCP URL manually; reviewed local packages and official API fallbacks are separate setup paths.",
      };
    }

    const name = candidate.title?.trim() || candidate.operator;
    const manifest = parseConnectorManifest({
      id: manifestId(candidate.operator),
      name,
      blurb: `<b>MCP</b> — ${plainText(candidate.description)}`,
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
