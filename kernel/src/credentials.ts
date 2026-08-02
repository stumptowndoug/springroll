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

export interface MacOsKeychainCredentialStoreOptions {
  readonly service?: string;
  readonly securityPath?: string;
  readonly expectPath?: string;
  readonly runCommand?: CommandRunner;
}

export class MacOsKeychainCredentialStore implements CredentialStore {
  readonly #service: string;
  readonly #securityPath: string;
  readonly #expectPath: string;
  readonly #runCommand: CommandRunner;

  constructor(options: MacOsKeychainCredentialStoreOptions = {}) {
    // Keychain service name predates the Springroll rename; changing it
    // would orphan every stored API key, so it stays.
    this.#service = options.service ?? "dev.shrimp-roll.model-api-keys";
    this.#securityPath = options.securityPath ?? "/usr/bin/security";
    this.#expectPath = options.expectPath ?? "/usr/bin/expect";
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
      args: [this.#expectPath, "-c", keychainPasswordPromptScript],
      stdin: `${secret}\n`,
      environment: {
        SPRINGROLL_SECURITY_PATH: this.#securityPath,
        SPRINGROLL_KEYCHAIN_ACCOUNT: reference,
        SPRINGROLL_KEYCHAIN_SERVICE: this.#service,
      },
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

const keychainPasswordPromptScript = [
  "log_user 0",
  "set timeout 10",
  "set secret [gets stdin]",
  "spawn $env(SPRINGROLL_SECURITY_PATH) add-generic-password -a $env(SPRINGROLL_KEYCHAIN_ACCOUNT) -s $env(SPRINGROLL_KEYCHAIN_SERVICE) -U -w",
  "expect {",
  '  -re {(?i)password.*:} { send -- "$secret\\r"; exp_continue }',
  "  eof {}",
  "  timeout { exit 124 }",
  "}",
  "catch wait result",
  "exit [lindex $result 3]",
].join("\n");

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
