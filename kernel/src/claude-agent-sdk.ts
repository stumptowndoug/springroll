import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export interface ClaudeAccount {
  readonly email?: string;
  readonly subscriptionType?: string;
}

export interface ClaudeAccountState {
  readonly account: ClaudeAccount | null;
}

export interface ClaudeModel {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly inputModalities: readonly string[];
}

export interface ClaudeCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type RunClaudeCommand = (
  args: readonly string[],
  options: {
    readonly executable: string;
    readonly env: NodeJS.ProcessEnv;
  },
) => Promise<ClaudeCommandResult>;

interface ClaudeAuthStatus {
  readonly loggedIn?: boolean;
  readonly authMethod?: string;
  readonly email?: string;
  readonly subscriptionType?: string;
  readonly account?: {
    readonly email?: string;
    readonly subscriptionType?: string;
  };
}

const claudeModels: readonly ClaudeModel[] = [
  {
    id: "sonnet",
    displayName: "Claude Sonnet",
    description: "Claude Code's balanced default model.",
    isDefault: true,
    inputModalities: ["text", "image"],
  },
  {
    id: "opus",
    displayName: "Claude Opus",
    description: "Claude Code's most capable model.",
    isDefault: false,
    inputModalities: ["text", "image"],
  },
  {
    id: "haiku",
    displayName: "Claude Haiku",
    description: "Claude Code's fastest model.",
    isDefault: false,
    inputModalities: ["text", "image"],
  },
];

/** Account management for the Claude executable bundled with Agent SDK. */
export class ClaudeSubscriptionConnection {
  readonly #executable: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #run: RunClaudeCommand;

  constructor(options: {
    readonly claudeHome: string;
    readonly executable?: string;
    readonly run?: RunClaudeCommand;
    readonly env?: NodeJS.ProcessEnv;
  }) {
    mkdirSync(options.claudeHome, { recursive: true, mode: 0o700 });
    this.#executable = options.executable ?? bundledClaudePath();
    this.#env = {
      ...(options.env ?? process.env),
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      ANTHROPIC_BASE_URL: undefined,
      CLAUDE_CODE_USE_BEDROCK: undefined,
      CLAUDE_CODE_USE_FOUNDRY: undefined,
      CLAUDE_CODE_USE_VERTEX: undefined,
      CLAUDE_CONFIG_DIR: options.claudeHome,
      CLAUDE_AGENT_SDK_CLIENT_APP: "springroll/0.0.0",
    };
    this.#run = options.run ?? runClaudeCommand;
  }

  async account(): Promise<ClaudeAccountState> {
    const result = await this.#run(["auth", "status", "--json"], {
      executable: this.#executable,
      env: this.#env,
    });
    const status = parseAuthStatus(result.stdout);
    if (
      !status.loggedIn ||
      (status.authMethod !== "claude.ai" && !status.subscriptionType)
    ) {
      return { account: null };
    }
    const email = status.email ?? status.account?.email;
    const subscriptionType =
      status.subscriptionType ?? status.account?.subscriptionType;
    return {
      account: {
        ...(email ? { email } : undefined),
        ...(subscriptionType ? { subscriptionType } : undefined),
      },
    };
  }

  async login(): Promise<void> {
    const result = await this.#run(["auth", "login", "--claudeai"], {
      executable: this.#executable,
      env: this.#env,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || "Claude subscription sign-in was not completed",
      );
    }
  }

  async logout(): Promise<void> {
    const result = await this.#run(["auth", "logout"], {
      executable: this.#executable,
      env: this.#env,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "Claude sign-out failed");
    }
  }

  models(): readonly ClaudeModel[] {
    return claudeModels;
  }

  runtime(): { readonly executable: string; readonly env: NodeJS.ProcessEnv } {
    return { executable: this.#executable, env: this.#env };
  }

  close(): void {}
}

export function bundledClaudePath(): string {
  const sdkEntry = fileURLToPath(
    import.meta.resolve("@anthropic-ai/claude-agent-sdk"),
  );
  const requireFromSdk = createRequire(sdkEntry);
  const suffix = process.platform === "win32" ? ".exe" : "";
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const candidates =
    platform === "linux"
      ? [
          `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude`,
          `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl/claude`,
        ]
      : [
          `@anthropic-ai/claude-agent-sdk-${platform}-${process.arch}/claude${suffix}`,
        ];
  for (const candidate of candidates) {
    try {
      const executable = requireFromSdk.resolve(candidate);
      if (existsSync(executable)) return executable;
    } catch {
      // Try the next platform package.
    }
  }
  throw new Error(
    "The Claude executable bundled with Agent SDK is unavailable",
  );
}

function parseAuthStatus(stdout: string): ClaudeAuthStatus {
  try {
    return JSON.parse(stdout) as ClaudeAuthStatus;
  } catch {
    return {};
  }
}

function runClaudeCommand(
  args: readonly string[],
  options: {
    readonly executable: string;
    readonly env: NodeJS.ProcessEnv;
  },
): Promise<ClaudeCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, [...args], {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`;
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
