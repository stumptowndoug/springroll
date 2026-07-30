export interface CredentialStore {
  get(reference: string): Promise<string | undefined>;
  put(reference: string, secret: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export interface CommandRequest {
  readonly args: readonly string[];
  readonly stdin?: string;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export interface MacOsKeychainCredentialStoreOptions {
  readonly service?: string;
  readonly securityPath?: string;
  readonly runCommand?: CommandRunner;
}

export class MacOsKeychainCredentialStore implements CredentialStore {
  readonly #service: string;
  readonly #securityPath: string;
  readonly #runCommand: CommandRunner;

  constructor(options: MacOsKeychainCredentialStoreOptions = {}) {
    this.#service = options.service ?? "dev.shrimp-roll.model-api-keys";
    this.#securityPath = options.securityPath ?? "/usr/bin/security";
    this.#runCommand = options.runCommand ?? runCommand;
  }

  async get(reference: string): Promise<string | undefined> {
    validateReference(reference);
    const result = await this.#runCommand({
      args: [
        this.#securityPath,
        "find-generic-password",
        "-a",
        reference,
        "-s",
        this.#service,
        "-w",
      ],
    });

    if (result.exitCode === 44) {
      return undefined;
    }
    assertSuccess(result, "read credential from macOS Keychain");

    return result.stdout.replace(/\r?\n$/, "");
  }

  async put(reference: string, secret: string): Promise<void> {
    validateReference(reference);
    validateSecret(secret);
    const result = await this.#runCommand({
      args: [
        this.#securityPath,
        "add-generic-password",
        "-a",
        reference,
        "-s",
        this.#service,
        "-U",
        "-w",
      ],
      stdin: `${secret}\n`,
    });

    assertSuccess(result, "store credential in macOS Keychain");
  }

  async delete(reference: string): Promise<void> {
    validateReference(reference);
    const result = await this.#runCommand({
      args: [
        this.#securityPath,
        "delete-generic-password",
        "-a",
        reference,
        "-s",
        this.#service,
      ],
    });

    if (result.exitCode !== 44) {
      assertSuccess(result, "delete credential from macOS Keychain");
    }
  }
}

async function runCommand(request: CommandRequest): Promise<CommandResult> {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is only available on macOS");
  }

  const subprocess = Bun.spawn([...request.args], {
    stdin: request.stdin === undefined ? undefined : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (request.stdin !== undefined && subprocess.stdin) {
    subprocess.stdin.write(request.stdin);
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
