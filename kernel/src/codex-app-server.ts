import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { JsonObject } from "./tools.ts";

type RpcId = number;
type RpcMessage = {
  readonly id?: RpcId;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
};

export interface CodexAppServerProcess {
  readonly stdin: Pick<NodeJS.WritableStream, "write" | "end">;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  once(event: "error" | "exit", listener: (...args: unknown[]) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnCodexAppServer = () => CodexAppServerProcess;

export interface CodexAccount {
  readonly type: "chatgpt" | "apiKey" | "amazonBedrock";
  readonly email?: string;
  readonly planType?: string;
}

export interface CodexAccountState {
  readonly account: CodexAccount | null;
  readonly requiresOpenaiAuth: boolean;
}

export interface CodexLoginStart {
  readonly type: "chatgpt" | "chatgptDeviceCode";
  readonly loginId: string;
  readonly authUrl?: string;
  readonly verificationUrl?: string;
  readonly userCode?: string;
}

export interface CodexModel {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly hidden: boolean;
  readonly isDefault: boolean;
  readonly inputModalities: readonly string[];
}

/** Minimal JSON-RPC client for the official Codex app-server protocol. */
export class CodexAppServerClient {
  readonly #spawn: SpawnCodexAppServer;
  readonly #pending = new Map<
    RpcId,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (reason: Error) => void;
    }
  >();
  readonly #notificationListeners = new Set<
    (method: string, params: unknown) => void
  >();
  #requestHandler:
    | ((method: string, params: unknown) => Promise<unknown>)
    | undefined;
  #process: CodexAppServerProcess | undefined;
  #started: Promise<void> | undefined;
  #nextId = 1;
  #stderr = "";

  constructor(options: { readonly spawn?: SpawnCodexAppServer } = {}) {
    this.#spawn = options.spawn ?? spawnBundledCodexAppServer;
  }

  async start(): Promise<void> {
    this.#started ??= this.#start();
    return this.#started;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.start();
    return this.#sendRequest<T>(method, params);
  }

  notify(method: string, params?: unknown): void {
    if (!this.#process) throw new Error("Codex app server is not running");
    this.#write({ method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(
    listener: (method: string, params: unknown) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  handleRequests(
    handler: (method: string, params: unknown) => Promise<unknown>,
  ): () => void {
    this.#requestHandler = handler;
    return () => {
      if (this.#requestHandler === handler) this.#requestHandler = undefined;
    };
  }

  close(): void {
    this.#process?.stdin.end();
    this.#process?.kill("SIGTERM");
    this.#process = undefined;
    this.#started = undefined;
  }

  async #start(): Promise<void> {
    const process = this.#spawn();
    this.#process = process;
    createInterface({ input: process.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.#receive(JSON.parse(line) as RpcMessage);
      } catch (error) {
        this.#failAll(
          new Error(`Codex app server returned invalid JSON: ${String(error)}`),
        );
      }
    });
    process.stderr.on("data", (chunk) => {
      this.#stderr = `${this.#stderr}${String(chunk)}`.slice(-4_000);
    });
    process.once("error", (error) => this.#failAll(asError(error)));
    process.once("exit", (code) => {
      if (code !== 0) {
        this.#failAll(
          new Error(
            `Codex app server exited with ${String(code)}${this.#stderr ? `: ${this.#stderr.trim()}` : ""}`,
          ),
        );
      }
    });
    await this.#sendRequest("initialize", {
      clientInfo: {
        name: "springroll",
        title: "Springroll",
        version: "0.0.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }

  #sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (!this.#process) throw new Error("Codex app server is not running");
    const id = this.#nextId++;
    const response = new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
    this.#write({ id, method, ...(params === undefined ? {} : { params }) });
    return response;
  }

  #write(message: RpcMessage): void {
    this.#process?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #receive(message: RpcMessage): void {
    if (message.id !== undefined && !message.method) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(
            message.error.message ??
              `Codex app server request failed (${String(message.error.code)})`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && message.method) {
      void this.#handleServerRequest(message);
      return;
    }
    if (message.method) {
      for (const listener of this.#notificationListeners) {
        listener(message.method, message.params);
      }
    }
  }

  async #handleServerRequest(message: RpcMessage): Promise<void> {
    const id = message.id;
    if (id === undefined) return;
    try {
      if (!this.#requestHandler || !message.method) {
        throw new Error(`Unsupported Codex request: ${String(message.method)}`);
      }
      this.#write({
        id,
        result: await this.#requestHandler(message.method, message.params),
      });
    } catch (error) {
      this.#write({
        id,
        error: { code: -32_001, message: asError(error).message },
      });
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

/** Account and model discovery shared by the UI and the Codex runner. */
export class CodexSubscriptionConnection {
  constructor(private readonly client: CodexAppServerClient) {}

  async account(refreshToken = false): Promise<CodexAccountState> {
    return this.client.request("account/read", { refreshToken });
  }

  async startLogin(): Promise<CodexLoginStart> {
    return this.client.request("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt",
    });
  }

  async logout(): Promise<void> {
    await this.client.request("account/logout");
  }

  async models(): Promise<readonly CodexModel[]> {
    const response = await this.client.request<{ data: CodexModel[] }>(
      "model/list",
      { limit: 100 },
    );
    return response.data.filter((model) => !model.hidden);
  }

  runtimeClient(): CodexAppServerClient {
    return this.client;
  }

  close(): void {
    this.client.close();
  }
}

export function bundledCodexPath(): string {
  const sdkEntry = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
  const requireFromSdk = createRequire(sdkEntry);
  const codexPackageJson = requireFromSdk.resolve("@openai/codex/package.json");
  const requireFromCodex = createRequire(codexPackageJson);
  const platformPackage = `@openai/codex-${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
  const packageJson = requireFromCodex.resolve(
    `${platformPackage}/package.json`,
  );
  const vendor = join(dirname(packageJson), "vendor");
  for (const target of readdirSync(vendor)) {
    const binary = join(
      vendor,
      target,
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    if (existsSync(binary)) return binary;
  }
  throw new Error("The bundled Codex executable is unavailable");
}

function spawnBundledCodexAppServer(): ChildProcessWithoutNullStreams {
  return spawn(bundledCodexPath(), ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function createCodexAppServerSpawn(options: {
  readonly codexHome: string;
}): SpawnCodexAppServer {
  return () => {
    mkdirSync(options.codexHome, { recursive: true });
    return spawn(bundledCodexPath(), ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: options.codexHome },
    });
  };
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a JSON object");
  }
  return value as JsonObject;
}
