import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const maxKnowledgeCharacters = 32_000;

export const inspectRecipeHistoryToolName = "inspect_recipe_history";

export const inspectRecipeHistoryInputSchema = z
  .object({
    runId: identifierSchema.optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const recipeKnowledgeStatusSchema = z.enum([
  "learning",
  "needs_review",
  "ready",
  "stale",
  "superseded",
]);

/**
 * Bounded, reviewed context for repeating one recipe. This document may
 * describe operations but never grants permission to execute them.
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
