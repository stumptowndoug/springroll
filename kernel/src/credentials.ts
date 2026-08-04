import { Entry } from "@napi-rs/keyring";

export interface CredentialStore {
  get(reference: string): Promise<string | undefined>;
  put(reference: string, secret: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export interface CommandRequest {
  readonly args: readonly string[];
  readonly stdin?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deleteCredential(): boolean;
}

export type KeyringEntryFactory = (
  service: string,
  reference: string,
) => KeyringEntry;

export interface MacOsKeychainCredentialStoreOptions {
  readonly service?: string;
  readonly legacyService?: string | false;
  readonly securityPath?: string;
  readonly entryFactory?: KeyringEntryFactory;
  readonly runCommand?: CommandRunner;
}

export class MacOsKeychainCredentialStore implements CredentialStore {
  readonly #service: string;
  readonly #legacyService: string | undefined;
  readonly #securityPath: string;
  readonly #entryFactory: KeyringEntryFactory;
  readonly #runCommand: CommandRunner;

  constructor(options: MacOsKeychainCredentialStoreOptions = {}) {
    this.#service = options.service ?? "dev.springroll.credentials";
    this.#legacyService =
      options.legacyService === false
        ? undefined
        : (options.legacyService ??
          (options.service === undefined
            ? "dev.shrimp-roll.model-api-keys"
            : undefined));
    this.#securityPath = options.securityPath ?? "/usr/bin/security";
    this.#entryFactory =
      options.entryFactory ??
      ((service, reference) => new Entry(service, reference));
    this.#runCommand = options.runCommand ?? runCommand;
  }

  async get(reference: string): Promise<string | undefined> {
    validateReference(reference);
    const current = await this.#read(reference, this.#service);
    if (current !== undefined || !this.#legacyService) return current;
    const legacy = await this.#readLegacy(reference, this.#legacyService);
    if (legacy === undefined) return undefined;
    await this.put(reference, legacy);
    await this.#deleteLegacy(reference, this.#legacyService);
    return legacy;
  }

  async #read(reference: string, service: string): Promise<string | undefined> {
    return this.#entryFactory(service, reference).getPassword() ?? undefined;
  }

  async #readLegacy(
    reference: string,
    service: string,
  ): Promise<string | undefined> {
    const result = await this.#runCommand({
      args: [
        this.#securityPath,
        "find-generic-password",
        "-a",
        reference,
        "-s",
        service,
        "-w",
      ],
    });
    if (result.exitCode === 44) return undefined;
    assertSuccess(result, "read legacy credential from macOS Keychain");
    return result.stdout.replace(/\r?\n$/, "");
  }

  async put(reference: string, secret: string): Promise<void> {
    validateReference(reference);
    validateSecret(secret);
    this.#entryFactory(this.#service, reference).setPassword(secret);
  }

  async delete(reference: string): Promise<void> {
    validateReference(reference);
    await this.#delete(reference, this.#service);
    if (this.#legacyService) {
      await this.#deleteLegacy(reference, this.#legacyService);
    }
  }

  async #delete(reference: string, service: string): Promise<void> {
    this.#entryFactory(service, reference).deleteCredential();
  }

  async #deleteLegacy(reference: string, service: string): Promise<void> {
    const result = await this.#runCommand({
      args: [
        this.#securityPath,
        "delete-generic-password",
        "-a",
        reference,
        "-s",
        service,
      ],
    });

    if (result.exitCode !== 44) {
      assertSuccess(result, "delete legacy credential from macOS Keychain");
    }
  }
}

async function runCommand(request: CommandRequest): Promise<CommandResult> {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is only available on macOS");
  }

  const subprocess = Bun.spawn([...request.args], {
    ...(request.environment === undefined
      ? undefined
      : { env: { ...process.env, ...request.environment } }),
    stdin: request.stdin === undefined ? undefined : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (request.stdin !== undefined && subprocess.stdin) {
    subprocess.stdin.write(request.stdin);
    await subprocess.stdin.flush();
    subprocess.stdin.end();
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}

function validateReference(reference: string): void {
  if (reference.trim() === "" || reference.includes("\n")) {
    throw new TypeError("credential reference must be a non-empty single line");
  }
}

function validateSecret(secret: string): void {
  if (secret.trim() === "" || secret.includes("\n")) {
    throw new TypeError("credential secret must be a non-empty single line");
  }
}

function assertSuccess(result: CommandResult, action: string): void {
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      detail === ""
        ? `Could not ${action} (exit ${result.exitCode})`
        : `Could not ${action}: ${detail}`,
    );
  }
}
