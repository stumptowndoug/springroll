import { describe, expect, test } from "bun:test";
import {
  ConnectorOAuthCredentialProvider,
  type CredentialStore,
  InvalidConnectorOAuthCredentialError,
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
    await expect(provider.codeVerifier()).rejects.toThrow("sign-in expired");
    expect(redirects).toEqual(["https://mcp.notion.com/authorize"]);
    expect(credentials.values.get("notion-oauth")).toContain("access-secret");

    await provider.invalidateCredentials("tokens");
    expect(await provider.tokens()).toBeUndefined();
    expect(await provider.clientInformation()).toMatchObject({
      client_id: "springroll-client",
    });
  });

  test("rejects insecure discovered authorization servers", async () => {
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "linear-oauth",
      connectorName: "Linear",
      redirectUrl: "http://127.0.0.1:3000/callback",
      credentials: new MemoryCredentials(),
    });

    await expect(
      provider.validateAuthorizationServerURL(
        "https://mcp.linear.app/mcp",
        "http://auth.example.test",
      ),
    ).rejects.toThrow("must use HTTPS");
  });

  test("classifies a non-OAuth value so an explicit reconnect can replace it", async () => {
    const credentials = new MemoryCredentials();
    await credentials.put("neon-oauth", "legacy-neon-api-key");
    const provider = new ConnectorOAuthCredentialProvider({
      credentialRef: "neon-oauth",
      connectorName: "Neon",
      redirectUrl: "http://127.0.0.1:3000/callback",
      credentials,
    });

    await expect(provider.tokens()).rejects.toBeInstanceOf(
      InvalidConnectorOAuthCredentialError,
    );
  });
});
