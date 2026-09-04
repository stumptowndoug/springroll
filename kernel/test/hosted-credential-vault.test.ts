import { describe, expect, test } from "bun:test";
import {
  type HostedCredentialVault,
  type HostedCredentialVaultKey,
  ScopedHostedCredentialStore,
} from "../src/hosted-credential-vault.ts";

class MemoryHostedCredentialVault implements HostedCredentialVault {
  readonly values = new Map<string, string>();

  async get(key: HostedCredentialVaultKey): Promise<string | undefined> {
    return this.values.get(this.key(key));
  }

  async put(key: HostedCredentialVaultKey, secret: string): Promise<void> {
    this.values.set(this.key(key), secret);
  }

  async delete(key: HostedCredentialVaultKey): Promise<void> {
    this.values.delete(this.key(key));
  }

  private key(key: HostedCredentialVaultKey): string {
    return `${key.accountId}:${key.credentialRef}`;
  }
}

describe("ScopedHostedCredentialStore", () => {
  test("isolates the same credential reference between accounts", async () => {
    const vault = new MemoryHostedCredentialVault();
    const doug = new ScopedHostedCredentialStore(vault, "account-doug");
    const alex = new ScopedHostedCredentialStore(vault, "account-alex");

    await doug.put("gmail-primary", "doug-token");
    await alex.put("gmail-primary", "alex-token");

    expect(await doug.get("gmail-primary")).toBe("doug-token");
    expect(await alex.get("gmail-primary")).toBe("alex-token");

    await doug.delete("gmail-primary");
    expect(await doug.get("gmail-primary")).toBeUndefined();
    expect(await alex.get("gmail-primary")).toBe("alex-token");
  });

  test("rejects an empty account scope or credential reference", () => {
    const vault = new MemoryHostedCredentialVault();
    expect(() => new ScopedHostedCredentialStore(vault, " ")).toThrow(
      "Hosted credential account ID is required",
    );
    const store = new ScopedHostedCredentialStore(vault, "account-doug");
    expect(() => store.get(" ")).toThrow(
      "Hosted credential reference is required",
    );
  });
});
