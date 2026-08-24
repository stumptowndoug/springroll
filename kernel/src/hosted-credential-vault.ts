import type { CredentialStore } from "./credentials.ts";

/**
 * A credential address in the hosted secret store. The account scope is part
 * of every operation so two Springroll users can never share a credential
 * namespace accidentally.
 */
export interface HostedCredentialVaultKey {
  readonly accountId: string;
  readonly credentialRef: string;
}

/**
 * Host-neutral boundary for a KMS-backed secret store. Implementations are
 * responsible for authenticating the account and encrypting values at rest.
 */
export interface HostedCredentialVault {
  get(key: HostedCredentialVaultKey): Promise<string | undefined>;
  put(key: HostedCredentialVaultKey, secret: string): Promise<void>;
  delete(key: HostedCredentialVaultKey): Promise<void>;
}

/** Exposes one authenticated account's hosted credentials to a task runner. */
export class ScopedHostedCredentialStore implements CredentialStore {
  constructor(
    private readonly vault: HostedCredentialVault,
    private readonly accountId: string,
  ) {
    if (!accountId.trim()) {
      throw new TypeError("Hosted credential account ID is required");
    }
  }

  get(credentialRef: string): Promise<string | undefined> {
    return this.vault.get(this.key(credentialRef));
  }

  put(credentialRef: string, secret: string): Promise<void> {
    return this.vault.put(this.key(credentialRef), secret);
  }

  delete(credentialRef: string): Promise<void> {
    return this.vault.delete(this.key(credentialRef));
  }

  private key(credentialRef: string): HostedCredentialVaultKey {
    if (!credentialRef.trim()) {
      throw new TypeError("Hosted credential reference is required");
    }
    return { accountId: this.accountId, credentialRef };
  }
}
