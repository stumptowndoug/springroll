import { describe, expect, test } from "bun:test";
import {
  ConnectorOAuthCredentialProvider,
  type CredentialStore,
  InvalidConnectorOAuthCredentialError,
  MissingCredentialError,
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

describe("ConnectorOAuthCredentialProvider", () => {
  test("keeps OAuth client state and tokens together in the credential store", async () => {
    const credentials = new MemoryCredentials();
    const redirects: string[] = [];
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "notion-oauth",
      connectorName: "Notion",
      serverUrl: "https://mcp.notion.com/mcp",
      redirectUrl: "http://127.0.0.1:3000/api/connectors/notion/oauth/callback",
      credentials,
      onRedirect(url) {
        redirects.push(url.toString());
      },
    });

    await provider.saveClientInformation({ client_id: "springroll-client" });
    await provider.saveAuthorizationServerInformation({
      authorizationServerUrl: "https://mcp.notion.com/",
      tokenEndpoint: "https://mcp.notion.com/token",
    });
    await provider.saveState("csrf-state");
    await provider.saveCodeVerifier("pkce-verifier");
    await provider.saveReturnTo("/chat/chat-1?workflow=workflow-1");
    expect(await provider.storedState()).toBe("csrf-state");
    expect(await provider.codeVerifier()).toBe("pkce-verifier");
    await provider.saveTokens({
      access_token: "access-secret",
      token_type: "bearer",
      refresh_token: "refresh-secret",
    });
    await provider.redirectToAuthorization(
      new URL("https://mcp.notion.com/authorize"),
    );

    expect(await provider.clientInformation()).toMatchObject({
      client_id: "springroll-client",
    });
    expect(await provider.tokens()).toMatchObject({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
    });
    expect(await provider.storedState()).toBeUndefined();
    expect(await provider.returnTo()).toBe("/chat/chat-1?workflow=workflow-1");
    await expect(provider.codeVerifier()).rejects.toThrow("sign-in expired");
    expect(redirects).toEqual(["https://mcp.notion.com/authorize"]);
    expect(credentials.values.get("notion-oauth")).toContain("access-secret");

    await provider.invalidateCredentials("tokens");
    expect(await provider.tokens()).toBeUndefined();
    expect(await provider.clientInformation()).toMatchObject({
      client_id: "springroll-client",
    });
    expect(await provider.returnTo()).toBe("/chat/chat-1?workflow=workflow-1");
    await provider.clearReturnTo();
    expect(await provider.returnTo()).toBeUndefined();
  });

  test("rejects insecure discovered authorization servers", async () => {
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "linear-oauth",
      connectorName: "Linear",
      serverUrl: "https://mcp.linear.app/mcp",
      redirectUrl: "http://127.0.0.1:3000/callback",
      credentials: new MemoryCredentials(),
    });

    await expect(
      provider.validateAuthorizationServerURL(
        "https://mcp.linear.app/mcp",
        "http://auth.example.test",
      ),
    ).rejects.toThrow("must use HTTPS");
    await expect(
      provider.redirectToAuthorization(
        new URL("https://auth.example.test/authorize"),
      ),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

  test("uses a configured OAuth client without copying its secret into account credentials", async () => {
    const credentials = new MemoryCredentials();
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "gmail-work",
      connectorName: "Gmail",
      serverUrl: "https://gmail.googleapis.com/gmail/v1",
      redirectUrl: "http://127.0.0.1:4117/api/connectors/gmail/oauth/callback",
      credentials,
      clientInformation: {
        client_id: "google-client-id",
        client_secret: "google-client-secret",
      },
    });

    expect(await provider.clientInformation()).toEqual({
      client_id: "google-client-id",
      client_secret: "google-client-secret",
    });
    await provider.saveState("gmail-state");
    await provider.saveCodeVerifier("gmail-verifier");
    await provider.saveTokens({
      access_token: "gmail-access-token",
      token_type: "bearer",
    });

    const stored = credentials.values.get("gmail-work");
    expect(stored).toContain("gmail-access-token");
    expect(stored).not.toContain("google-client-secret");
    expect(stored).not.toContain("google-client-id");
    expect(await provider.clientInformation()).toMatchObject({
      client_id: "google-client-id",
    });
  });

  test("classifies a non-OAuth value so an explicit reconnect can replace it", async () => {
    const credentials = new MemoryCredentials();
    await credentials.put("neon-oauth", "legacy-neon-api-key");
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "neon-oauth",
      connectorName: "Neon",
      serverUrl: "https://mcp.neon.tech/mcp",
      redirectUrl: "http://127.0.0.1:3000/callback",
      credentials,
    });

    await expect(provider.tokens()).rejects.toBeInstanceOf(
      InvalidConnectorOAuthCredentialError,
    );
  });

  test("rejects OAuth registration cached for another callback", async () => {
    const credentials = new MemoryCredentials();
    await credentials.put(
      "neon-oauth",
      JSON.stringify({
        serverUrl: "https://mcp.neon.tech/mcp",
        redirectUrl: "http://localhost:3000/callback",
        clientInformation: { client_id: "stale-client" },
      }),
    );
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "neon-oauth",
      connectorName: "Neon",
      serverUrl: "https://mcp.neon.tech/mcp",
      redirectUrl: "http://127.0.0.1:4117/callback",
      credentials,
    });

    await expect(provider.clientInformation()).rejects.toBeInstanceOf(
      InvalidConnectorOAuthCredentialError,
    );
  });
});
