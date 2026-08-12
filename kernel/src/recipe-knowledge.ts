import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const maxKnowledgeCharacters = 32_000;

export const inspectRecipeHistoryToolName = "inspect_recipe_history";
export const updateTaskNotesToolName = "update_task_notes";

export const inspectRecipeHistoryInputSchema = z
  .object({
    runId: identifierSchema.optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const updateTaskNotesInputSchema = z
  .object({
    markdown: z.string().trim().min(1).max(maxKnowledgeCharacters),
  })
  .strict();

export const recipeKnowledgeStatusSchema = z.enum(["ready", "superseded"]);

/**
 * A recipe's living notes document: bounded context that runs revise as they
 * learn. The latest revision is active; older revisions are kept as
 * superseded history. This document may describe operations but never grants
 * permission to execute them.
 */
export const recipeKnowledgeDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    markdown: z.string().trim().min(1).max(maxKnowledgeCharacters),
  })
  .strict();

export type RecipeKnowledgeStatus = z.infer<typeof recipeKnowledgeStatusSchema>;
export type RecipeKnowledgeDocument = z.infer<
  typeof recipeKnowledgeDocumentSchema
>;

export function parseRecipeKnowledgeDocument(
  value: unknown,
): RecipeKnowledgeDocument {
  const current = recipeKnowledgeDocumentSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyProfileMarkdown(value);
  if (legacy) {
    return { schemaVersion: 1, markdown: legacy };
  }
  return recipeKnowledgeDocumentSchema.parse(value);
}

/**
 * Run-sourced proposals receive a stricter admission check than manually
 * authored knowledge. These checks stop common credential and raw-PII shapes
 * from being persisted if a model disregards the tool contract.
 */
export function parseProposedRecipeKnowledgeDocument(
  value: unknown,
): RecipeKnowledgeDocument {
  const document = recipeKnowledgeDocumentSchema.parse(value);
  const blocked = blockedProposalContent(document.markdown);
  if (blocked) {
    throw new Error(`Recipe knowledge proposal contains ${blocked}`);
  }
  if (document.markdown.split("\n").some((line) => line.length > 4_000)) {
    throw new Error("Recipe knowledge proposal contains unbounded raw output");
  }
  return document;
}

function blockedProposalContent(markdown: string): string | undefined {
  const patterns: readonly [RegExp, string][] = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, "a private key"],
    [
      /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i,
      "an authorization credential",
    ],
    [/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/i, "a bearer credential"],
    [
      /\b(?:sk|xai|ghp|github_pat|AKIA)[-_A-Za-z0-9]{12,}\b/,
      "an API credential",
    ],
    [
      /\b(?:api[_ -]?key|access[_ -]?token|secret|password)\s*[:=]\s*[^\s`]{8,}/i,
      "an assigned secret",
    ],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "an email address"],
    [/\b\d{3}-\d{2}-\d{4}\b/, "a government identifier"],
    [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/, "a phone number"],
  ];
  return patterns.find(([pattern]) => pattern.test(markdown))?.[1];
}

function legacyProfileMarkdown(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.summary !== "string" ||
    !Array.isArray(record.bindings) ||
    !Array.isArray(record.operations)
  ) {
    return undefined;
  }

  const serialized = JSON.stringify(value, null, 2);
  const bounded =
    serialized.length <= 27_000
      ? serialized
      : `${serialized.slice(0, 26_999)}…`;
  return [
    "# Imported learned setup",
    "",
    record.summary.trim(),
    "",
    "> This setup was converted from Springroll's earlier structured format. Review and replace it with concise recipe knowledge when it next changes.",
    "",
    "## Legacy reference",
    "",
    "```json",
    bounded,
    "```",
  ].join("\n");
}
