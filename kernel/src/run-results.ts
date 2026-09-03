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

const detachedReportReference =
  /(?:\b(?:table|chart|list|results?|response|summary)\s+(?:shown\s+)?(?:above|earlier)\b|\b(?:see|shown|listed|summarized|provided|reported|included|described|noted|mentioned)\b.{0,60}\b(?:above|earlier|previous\s+(?:message|response))\b)/i;
const placeholderReport =
  /^(?:placeholder|todo|tbd|done|complete|completed|n\/?a|none|null|test)(?:[.!])?$/i;
const markdownHeading = /^#{1,6}\s+\S/;

export type RunReportRejectionReason =
  | "empty"
  | "placeholder"
  | "detached"
  | "heading-only";

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

export function isSubstantiveRunReport(report: string): boolean {
  return runReportRejectionReason(report) === undefined;
}

export function runReportRejectionReason(
  report: string,
): RunReportRejectionReason | undefined {
  const trimmed = report.trim();
  if (!trimmed) {
    return "empty";
  }
  if (placeholderReport.test(trimmed)) {
    return "placeholder";
  }
  if (detachedReportReference.test(trimmed)) {
    return "detached";
  }
  return reportBodyLines(trimmed).length > 0 ? undefined : "heading-only";
}

export function selectResearchReport(
  candidates: readonly string[],
): string | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]?.trim();
    if (candidate && isSubstantiveRunReport(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function reportBodyLines(report: string): string[] {
  return report
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !markdownHeading.test(line));
}

function summarize(body: string, fallback: string): string {
  const firstBodyLine = reportBodyLines(body)[0];
  const firstHeading =
    body
      .split("\n")
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? fallback;
  const firstLine = firstBodyLine ?? firstHeading;

  return firstLine.length > 120
    ? `${firstLine.slice(0, 117).trimEnd()}...`
    : firstLine;
}
