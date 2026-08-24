import { describe, expect, test } from "bun:test";
import {
  ConnectorOAuthCredentialProvider,
  type CredentialStore,
  completeRegisteredOAuthAuthorization,
  registeredOAuthAccessToken,
  revokeRegisteredOAuthAuthorization,
  startRegisteredOAuthAuthorization,
} from "../src/index.ts";

class MemoryCredentials implements CredentialStore {
  readonly values = new Map<string, string>();

  async get(reference: string): Promise<string | undefined> {
    return this.values.get(reference);
  }

  async put(reference: string, secret: string): Promise<void> {
    this.values.set(reference, secret);
  }

  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

const configuration = {
  clientInformation: {
    client_id: "springroll-google-client",
    client_secret: "springroll-google-secret",
  },
  authorizationEndpoint: "https://accounts.google.test/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.google.test/token",
  revocationEndpoint: "https://oauth2.google.test/revoke",
  authorizationParameters: {
    access_type: "offline",
    prompt: "select_account consent",
  },
} as const;

describe("registered OAuth", () => {
  test("uses PKCE and keeps the provider client secret out of account credentials", async () => {
    const credentials = new MemoryCredentials();
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "gmail-work",
      connectorName: "Gmail",
      serverUrl: "https://gmail.googleapis.com/gmail/v1",
      redirectUrl: "http://127.0.0.1:4117/api/connectors/gmail/oauth/callback",
      credentials,
      clientInformation: configuration.clientInformation,
    });
    const authorizationUrl = await startRegisteredOAuthAuthorization(
      provider,
      configuration,
      "https://www.googleapis.com/auth/gmail.readonly",
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://accounts.google.test/o/oauth2/v2/auth",
    );
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "springroll-google-client",
    );
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe(
      "select_account consent",
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    if (!state) throw new Error("Expected OAuth state");

    let tokenBody: URLSearchParams | undefined;
    await completeRegisteredOAuthAuthorization(
      provider,
      configuration,
      { code: "google-code", state },
      async (_input, init) => {
        tokenBody = new URLSearchParams(String(init?.body));
        return Response.json({
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      },
    );

    expect(tokenBody?.get("client_secret")).toBe("springroll-google-secret");
    expect(tokenBody?.get("code_verifier")).toBeTruthy();
    expect(await provider.tokens()).toMatchObject({
      access_token: "google-access-token",
      refresh_token: "google-refresh-token",
    });
    const stored = credentials.values.get("gmail-work");
    expect(stored).toContain("google-access-token");
    expect(stored).not.toContain("springroll-google-secret");
    expect(stored).not.toContain("springroll-google-client");
  });

  test("refreshes expired access and revokes the refresh token", async () => {
    const credentials = new MemoryCredentials();
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "gmail-personal",
      connectorName: "Gmail",
      serverUrl: "https://gmail.googleapis.com/gmail/v1",
      redirectUrl: "http://127.0.0.1:4117/api/connectors/gmail/oauth/callback",
      credentials,
      clientInformation: configuration.clientInformation,
    });
    await provider.saveTokens({
      access_token: "expired-access-token",
      refresh_token: "durable-refresh-token",
      expires_in: 1,
      token_type: "Bearer",
    });
    const encoded = credentials.values.get("gmail-personal");
    if (!encoded) throw new Error("Expected stored OAuth credential");
    const stored = JSON.parse(encoded) as Record<string, unknown>;
    stored.tokenExpiresAt = Date.now() - 1;
    credentials.values.set("gmail-personal", JSON.stringify(stored));

    const requests: Array<{ url: string; body: URLSearchParams }> = [];
    const request = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({
        url: String(input),
        body: new URLSearchParams(String(init?.body)),
      });
      if (String(input).endsWith("/revoke")) {
        return new Response(null, { status: 200 });
      }
      return Response.json({
        access_token: "refreshed-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    };

    expect(
      await registeredOAuthAccessToken(provider, configuration, request),
    ).toBe("refreshed-access-token");
    expect(requests[0]?.body.get("grant_type")).toBe("refresh_token");
    expect(requests[0]?.body.get("refresh_token")).toBe(
      "durable-refresh-token",
    );
    expect(await provider.tokens()).toMatchObject({
      access_token: "refreshed-access-token",
      refresh_token: "durable-refresh-token",
    });

    await revokeRegisteredOAuthAuthorization(provider, configuration, request);
    expect(requests[1]?.url).toBe("https://oauth2.google.test/revoke");
    expect(requests[1]?.body.get("token")).toBe("durable-refresh-token");
  });
});
