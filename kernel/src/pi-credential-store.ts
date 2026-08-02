import type {
  Credential as PiCredential,
  CredentialInfo as PiCredentialInfo,
  CredentialStore as PiCredentialStore,
} from "@earendil-works/pi-ai";
import type { CredentialStore } from "./credentials.ts";

// Serialization prefix predates the Springroll rename; stored credentials
// carry it, so it stays until a v2 format migrates them.
const serializedCredentialPrefix = "shrimp-roll:pi-credential:v1:";

export interface PiCredentialBinding {
  readonly providerId: string;
  readonly credentialRef: string;
}

export class SpringrollPiCredentialStore implements PiCredentialStore {
  readonly #bindings: ReadonlyMap<string, string>;
  readonly #chains = new Map<string, Promise<void>>();

  constructor(
    private readonly credentials: CredentialStore,
    bindings: readonly PiCredentialBinding[],
  ) {
    this.#bindings = new Map(
      bindings.map((binding) => [binding.providerId, binding.credentialRef]),
    );
  }

  async read(providerId: string): Promise<PiCredential | undefined> {
    const reference = this.#bindings.get(providerId);
    if (!reference) {
      return undefined;
    }

    const stored = await this.credentials.get(reference);
    if (!stored) {
      return undefined;
    }

    if (stored.startsWith(serializedCredentialPrefix)) {
      const parsed = JSON.parse(
        stored.slice(serializedCredentialPrefix.length),
      ) as PiCredential;
      return parsed;
    }

    return { type: "api_key", key: stored };
  }

  async list(): Promise<readonly PiCredentialInfo[]> {
    const entries = await Promise.all(
      Array.from(this.#bindings.keys(), async (providerId) => {
        const credential = await this.read(providerId);
        return credential
          ? {
              providerId,
              type: credential.type,
            }
          : undefined;
      }),
    );

    return entries.filter(
      (entry): entry is PiCredentialInfo => entry !== undefined,
    );
  }

  modify(
    providerId: string,
    update: (
      current: PiCredential | undefined,
    ) => Promise<PiCredential | undefined>,
  ): Promise<PiCredential | undefined> {
    const operation = this.#enqueue(providerId, async () => {
      const current = await this.read(providerId);
      const next = await update(current);
      if (next === undefined) {
        return current;
      }

      const reference = this.#bindings.get(providerId);
      if (!reference) {
        throw new Error(`No Springroll credential binding for ${providerId}`);
      }
      await this.credentials.put(reference, serializeCredential(next));
      return next;
    });

    return operation;
  }

  async delete(providerId: string): Promise<void> {
    await this.#enqueue(providerId, async () => {
      const reference = this.#bindings.get(providerId);
      if (reference) {
        await this.credentials.delete(reference);
      }
    });
  }

  #enqueue<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(providerId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.#chains.set(
      providerId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }
}

function serializeCredential(credential: PiCredential): string {
  if (
    credential.type === "api_key" &&
    credential.key &&
    credential.env === undefined
  ) {
    return credential.key;
  }

  return `${serializedCredentialPrefix}${JSON.stringify(credential)}`;
}
