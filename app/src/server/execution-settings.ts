import { type AppDatabase, executionSettings } from "@springroll/kernel";
import { eq } from "drizzle-orm";

/** Chats have no step cap and are independent of recipe limits. */
export const chatExecutionLimits = {
  maxSteps: 0,
} as const;

/** Snapshot recipe limits at the beginning of a run. No per-recipe overrides yet. */
export function readRecipeExecutionLimits(db: AppDatabase) {
  const row = db
    .select()
    .from(executionSettings)
    .where(eq(executionSettings.id, "default"))
    .get();
  return {
    maxSteps: row?.maxSteps ?? 0,
    ...(row?.maxCostUsdMicros != null
      ? { maxCostUsdMicros: row.maxCostUsdMicros }
      : {}),
  };
}
