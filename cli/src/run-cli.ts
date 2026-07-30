import {
  openAiApiKeyCreationUrl,
  type RunTaskResult,
} from "@shrimp-roll/kernel";

export interface CliActions {
  connectOpenAi(apiKey: string): Promise<{
    readonly provider: string;
    readonly modelId: string;
  }>;
  runHackerNewsDigest(): Promise<RunTaskResult>;
}

export interface CliOutput {
  write(message: string): void;
  writeError(message: string): void;
}

export interface RunCliOptions {
  readonly actions: CliActions;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly output: CliOutput;
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions,
): Promise<number> {
  const [command] = args;

  try {
    if (command === "openai:connect") {
      const apiKey = options.environment.OPENAI_API_KEY;
      if (!apiKey) {
        options.output.writeError(
          `OPENAI_API_KEY is not set. Create a key at ${openAiApiKeyCreationUrl}, then retry with it set for this command.`,
        );
        return 1;
      }

      const result = await options.actions.connectOpenAi(apiKey);
      options.output.write(
        `Connected ${result.provider}/${result.modelId}; the key is stored in macOS Keychain.`,
      );
      return 0;
    }

    if (command === "hn:once") {
      const result = await options.actions.runHackerNewsDigest();
      options.output.write(result.transcript.body);
      options.output.write(formatUsage(result));
      return 0;
    }

    options.output.write(helpText());
    return command === undefined || command === "help" ? 0 : 1;
  } catch (error) {
    options.output.writeError(
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}

function helpText(): string {
  return [
    "Shrimp Roll development CLI",
    "",
    "  openai:connect  Validate OPENAI_API_KEY and store it in macOS Keychain",
    "  hn:once         Run one live Hacker News digest with the stored key",
    "  help            Show this help",
    "",
    `Create an OpenAI API key: ${openAiApiKeyCreationUrl}`,
  ].join("\n");
}

function formatUsage(result: RunTaskResult): string {
  const parts = [
    result.usage.totalTokens === undefined
      ? undefined
      : `${result.usage.totalTokens} tokens`,
    result.usage.costUsdMicros === undefined
      ? undefined
      : `$${(result.usage.costUsdMicros / 1_000_000).toFixed(6)} estimated`,
    `${result.finishedAt.getTime() - result.startedAt.getTime()} ms`,
  ].filter((part): part is string => part !== undefined);

  return `\nRun metadata: ${parts.join(" · ")}`;
}
