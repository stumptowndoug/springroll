import type {
  RunDisposition,
  RunResultArtifact,
  RunResultNotice,
  RunResultProposal,
  RunResultSource,
  RunResultV1,
} from "./contracts.ts";

export interface CreateMarkdownRunResultOptions {
  readonly body: string;
  readonly fallbackSummary: string;
  readonly summary?: string;
  readonly disposition?: RunDisposition;
  readonly sources?: readonly RunResultSource[];
  readonly artifacts?: readonly RunResultArtifact[];
  readonly proposals?: readonly RunResultProposal[];
  readonly notices?: readonly RunResultNotice[];
}

export function createMarkdownRunResult(
  options: CreateMarkdownRunResultOptions,
): RunResultV1 {
  return {
    schemaVersion: 1,
    disposition: options.disposition ?? "informational",
    summary:
      options.summary ?? summarize(options.body, options.fallbackSummary),
    body: {
      format: "markdown",
      content: options.body,
    },
    sources: options.sources ?? [],
    artifacts: options.artifacts ?? [],
    proposals: options.proposals ?? [],
    notices: options.notices ?? [],
  };
}

function summarize(body: string, fallback: string): string {
  const firstLine =
    body
      .split("\n")
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? fallback;

  return firstLine.length > 120
    ? `${firstLine.slice(0, 117).trimEnd()}...`
    : firstLine;
}
