import {
  auth,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp";
import { type CredentialStore, MissingCredentialError } from "./credentials.ts";
import { ToolPolicyError } from "./tools.ts";

export { auth as authorizeRemoteMcp };
export type ConnectorOAuthClientProvider = OAuthClientProvider;

interface StoredConnectorOAuthCredential {
  readonly serverUrl?: string;
  readonly redirectUrl?: string;
  readonly tokens?: OAuthTokens;
  readonly clientInformation?: OAuthClientInformation;
  readonly authorizationServerInformation?: OAuthAuthorizationServerInformation;
  readonly codeVerifier?: string;
  readonly state?: string;
  readonly returnTo?: string | undefined;
}

export interface ConnectorOAuthProviderOptions {
  readonly credentialRef: string;
  readonly connectorName: string;
  readonly serverUrl: string;
  readonly redirectUrl: string;
  readonly credentials: CredentialStore;
  readonly onRedirect?: (authorizationUrl: URL) => void | Promise<void>;
}

export class InvalidConnectorOAuthCredentialError extends ToolPolicyError {}

export class ConnectorOAuthCredentialProvider implements OAuthClientProvider {
  readonly #credentialRef: string;
  readonly #connectorName: string;
  readonly #serverUrl: string;
  readonly #credentials: CredentialStore;
  readonly #onRedirect: ConnectorOAuthProviderOptions["onRedirect"];
  readonly redirectUrl: string;

  constructor(options: ConnectorOAuthProviderOptions) {
    this.#credentialRef = options.credentialRef;
    this.#connectorName = options.connectorName;
    this.#serverUrl = options.serverUrl;
    this.#credentials = options.credentials;
    this.#onRedirect = options.onRedirect;
    this.redirectUrl = options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Springroll",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.#read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const stored = await this.#read();
    await this.#write({
      ...(stored.clientInformation
        ? { clientInformation: stored.clientInformation }
        : {}),
      ...(stored.authorizationServerInformation
        ? {
            authorizationServerInformation:
              stored.authorizationServerInformation,
          }
        : {}),
      tokens,
      ...(stored.returnTo ? { returnTo: stored.returnTo } : {}),
    });
  }

  async returnTo(): Promise<string | undefined> {
    return (await this.#read()).returnTo;
  }

  async saveReturnTo(returnTo: string | undefined): Promise<void> {
    await this.#merge({ returnTo });
  }

  async clearReturnTo(): Promise<void> {
    await this.#merge({ returnTo: undefined });
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return (await this.#read()).clientInformation;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    await this.#merge({ clientInformation });
  }

  async authorizationServerInformation(): Promise<
    OAuthAuthorizationServerInformation | undefined
  > {
    return (await this.#read()).authorizationServerInformation;
  }

  async saveAuthorizationServerInformation(
    authorizationServerInformation: OAuthAuthorizationServerInformation,
  ): Promise<void> {
    await this.#merge({ authorizationServerInformation });
  }

  async state(): Promise<string> {
    return crypto.randomUUID();
  }

  async saveState(state: string): Promise<void> {
    await this.#merge({ state });
  }

  async storedState(): Promise<string | undefined> {
    return (await this.#read()).state;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.#merge({ codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.#read()).codeVerifier;
    if (!verifier) {
      throw new ToolPolicyError(
        `${this.#connectorName} sign-in expired. Start it again.`,
      );
    }
    return verifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.#onRedirect) {
      throw new MissingCredentialError(
        `${this.#connectorName} needs reconnecting before it can run`,
      );
    }
    await this.#onRedirect(authorizationUrl);
  }

  async validateAuthorizationServerURL(
    _serverUrl: string | URL,
    authorizationServerUrl: string | URL,
  ): Promise<void> {
    if (new URL(authorizationServerUrl).protocol !== "https:") {
      throw new ToolPolicyError("Connector OAuth must use HTTPS");
    }
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    if (scope === "all") {
      await this.#credentials.delete(this.#credentialRef);
      return;
    }
    const stored = await this.#read();
    const next: StoredConnectorOAuthCredential = {
      ...(scope === "client"
        ? {}
        : {
            ...(stored.clientInformation
              ? { clientInformation: stored.clientInformation }
              : {}),
            ...(stored.authorizationServerInformation
              ? {
                  authorizationServerInformation:
                    stored.authorizationServerInformation,
                }
              : {}),
          }),
      ...(scope === "tokens" || !stored.tokens
        ? {}
        : { tokens: stored.tokens }),
      ...(scope === "verifier" || !stored.codeVerifier
        ? {}
        : { codeVerifier: stored.codeVerifier }),
      ...(stored.state ? { state: stored.state } : {}),
      ...(stored.returnTo ? { returnTo: stored.returnTo } : {}),
    };
    await this.#write(next);
  }

  async #read(): Promise<StoredConnectorOAuthCredential> {
    const encoded = await this.#credentials.get(this.#credentialRef);
    if (!encoded) return {};
    try {
      const value: unknown = JSON.parse(encoded);
      if (!value || typeof value !== "object") return {};
      const stored = value as StoredConnectorOAuthCredential;
      if (
        stored.serverUrl !== this.#serverUrl ||
        stored.redirectUrl !== this.redirectUrl
      ) {
        throw new InvalidConnectorOAuthCredentialError(
          `${this.#connectorName} OAuth registration changed. Reconnect it.`,
        );
      }
      return stored;
    } catch (error) {
      if (error instanceof InvalidConnectorOAuthCredentialError) throw error;
      throw new InvalidConnectorOAuthCredentialError(
        `${this.#connectorName} OAuth credential is invalid. Reconnect it.`,
      );
    }
  }

  async #merge(update: StoredConnectorOAuthCredential): Promise<void> {
    await this.#write({ ...(await this.#read()), ...update });
  }

  async #write(value: StoredConnectorOAuthCredential): Promise<void> {
    await this.#credentials.put(
      this.#credentialRef,
      JSON.stringify({
        ...value,
        serverUrl: this.#serverUrl,
        redirectUrl: this.redirectUrl,
      }),
    );
  }
}
