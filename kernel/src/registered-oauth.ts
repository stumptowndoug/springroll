import type { OAuthClientInformation, OAuthTokens } from "@ai-sdk/mcp";
import {
  type ConnectorOAuthCredentialProvider,
  InvalidConnectorOAuthCredentialError,
} from "./connector-oauth.ts";
import { MissingCredentialError } from "./credentials.ts";
import { ToolPolicyError } from "./tools.ts";

export type RegisteredOAuthFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RegisteredOAuthConfiguration {
  readonly clientInformation: OAuthClientInformation;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint?: string;
  readonly authorizationParameters?: Readonly<Record<string, string>>;
  readonly accountIdentity?: {
    readonly endpoint: string;
    readonly field: string;
  };
}

const reservedAuthorizationParameters = new Set([
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
]);

export function validateRegisteredOAuthConfiguration(
  configuration: RegisteredOAuthConfiguration,
): RegisteredOAuthConfiguration {
  if (!configuration.clientInformation.client_id.trim()) {
    throw new TypeError("Registered OAuth client ID is required");
  }
  assertHttpsUrl(configuration.authorizationEndpoint, "authorization");
  assertHttpsUrl(configuration.tokenEndpoint, "token");
  if (configuration.revocationEndpoint) {
    assertHttpsUrl(configuration.revocationEndpoint, "revocation");
  }
  if (configuration.accountIdentity) {
    assertHttpsUrl(configuration.accountIdentity.endpoint, "account identity");
    if (!configuration.accountIdentity.field.trim()) {
      throw new TypeError(
        "Registered OAuth account identity field is required",
      );
    }
  }
  for (const [name, value] of Object.entries(
    configuration.authorizationParameters ?? {},
  )) {
    if (!name.trim() || reservedAuthorizationParameters.has(name)) {
      throw new TypeError(`OAuth authorization parameter ${name} is reserved`);
    }
    if (!value.trim()) {
      throw new TypeError(`OAuth authorization parameter ${name} is empty`);
    }
  }
  return configuration;
}

export async function startRegisteredOAuthAuthorization(
  provider: ConnectorOAuthCredentialProvider,
  configurationValue: RegisteredOAuthConfiguration,
  scope: string,
): Promise<URL> {
  const configuration =
    validateRegisteredOAuthConfiguration(configurationValue);
  if (!scope.trim())
    throw new TypeError("Registered OAuth scopes are required");
  const state = crypto.randomUUID();
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  await provider.saveState(state);
  await provider.saveCodeVerifier(codeVerifier);

  const authorizationUrl = new URL(configuration.authorizationEndpoint);
  authorizationUrl.search = "";
  authorizationUrl.searchParams.set(
    "client_id",
    configuration.clientInformation.client_id,
  );
  authorizationUrl.searchParams.set("redirect_uri", provider.redirectUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", scope);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  for (const [name, value] of Object.entries(
    configuration.authorizationParameters ?? {},
  )) {
    authorizationUrl.searchParams.set(name, value);
  }
  return authorizationUrl;
}

export async function completeRegisteredOAuthAuthorization(
  provider: ConnectorOAuthCredentialProvider,
  configurationValue: RegisteredOAuthConfiguration,
  input: {
    readonly code: string;
    readonly state?: string;
  },
  request: RegisteredOAuthFetch = globalThis.fetch,
): Promise<OAuthTokens> {
  const configuration =
    validateRegisteredOAuthConfiguration(configurationValue);
  const storedState = await provider.storedState();
  if (!storedState || !input.state || storedState !== input.state) {
    throw new ToolPolicyError("OAuth sign-in state is invalid. Start again.");
  }
  const codeVerifier = await provider.codeVerifier();
  const body = new URLSearchParams({
    client_id: configuration.clientInformation.client_id,
    code: input.code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: provider.redirectUrl,
  });
  if (configuration.clientInformation.client_secret) {
    body.set("client_secret", configuration.clientInformation.client_secret);
  }
  const tokens = await requestTokens(
    configuration.tokenEndpoint,
    body,
    request,
    "OAuth sign-in",
  );
  await provider.saveTokens(tokens);
  return tokens;
}

export async function registeredOAuthAccessToken(
  provider: ConnectorOAuthCredentialProvider,
  configurationValue: RegisteredOAuthConfiguration,
  request: RegisteredOAuthFetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<string> {
  const configuration =
    validateRegisteredOAuthConfiguration(configurationValue);
  const tokens = await provider.tokens();
  if (!tokens?.access_token) {
    throw new MissingCredentialError("OAuth connection needs signing in again");
  }
  const expiresAt = await provider.tokenExpiresAt();
  if (expiresAt === undefined || expiresAt > Date.now() + 60_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new MissingCredentialError("OAuth connection needs signing in again");
  }
  const body = new URLSearchParams({
    client_id: configuration.clientInformation.client_id,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  if (configuration.clientInformation.client_secret) {
    body.set("client_secret", configuration.clientInformation.client_secret);
  }
  const refreshed = await requestTokens(
    configuration.tokenEndpoint,
    body,
    request,
    "OAuth token refresh",
    signal,
  );
  const next = {
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
  };
  await provider.saveTokens(next);
  return next.access_token;
}

export async function revokeRegisteredOAuthAuthorization(
  provider: ConnectorOAuthCredentialProvider,
  configurationValue: RegisteredOAuthConfiguration,
  request: RegisteredOAuthFetch = globalThis.fetch,
): Promise<void> {
  const configuration =
    validateRegisteredOAuthConfiguration(configurationValue);
  if (!configuration.revocationEndpoint) return;
  let tokens: OAuthTokens | undefined;
  try {
    tokens = await provider.tokens();
  } catch (error) {
    if (error instanceof InvalidConnectorOAuthCredentialError) return;
    throw error;
  }
  const token = tokens?.refresh_token ?? tokens?.access_token;
  if (!token) return;
  const response = await request(configuration.revocationEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }),
    redirect: "manual",
  });
  if (!response.ok && response.status !== 400) {
    throw new ToolPolicyError(
      `OAuth revocation failed (${response.status}). Try again.`,
    );
  }
}

async function requestTokens(
  tokenEndpoint: string,
  body: URLSearchParams,
  request: RegisteredOAuthFetch,
  action: string,
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  const response = await request(tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
    ...(signal ? { signal } : undefined),
  });
  if (!response.ok) {
    throw new MissingCredentialError(
      `${action} failed (${response.status}). Sign in again.`,
    );
  }
  const value: unknown = await response.json().catch(() => undefined);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolPolicyError(`${action} returned an invalid token response`);
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.access_token !== "string" ||
    !record.access_token ||
    typeof record.token_type !== "string" ||
    !record.token_type
  ) {
    throw new ToolPolicyError(`${action} returned an invalid token response`);
  }
  return {
    access_token: record.access_token,
    token_type: record.token_type,
    ...(typeof record.refresh_token === "string"
      ? { refresh_token: record.refresh_token }
      : undefined),
    ...(typeof record.expires_in === "number" &&
    Number.isFinite(record.expires_in) &&
    record.expires_in > 0
      ? { expires_in: record.expires_in }
      : undefined),
    ...(typeof record.scope === "string" ? { scope: record.scope } : undefined),
    ...(typeof record.id_token === "string"
      ? { id_token: record.id_token }
      : undefined),
  };
}

function assertHttpsUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new TypeError(`Registered OAuth ${label} endpoint must use HTTPS`);
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Buffer.from(bytes).toString("base64url");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("base64url");
}
