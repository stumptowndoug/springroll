import {
  type AppDatabase,
  defaultAgentLoopBounds,
  executionSettings,
} from "@springroll/kernel";
import { eq } from "drizzle-orm";

/** Chat safeguards are independent of user-configured recipe limits. */
export const chatExecutionLimits = {
  maxSteps: defaultAgentLoopBounds.maxSteps,
} as const;

/** Snapshot recipe limits at the beginning of a run. No per-recipe overrides yet. */
export function readRecipeExecutionLimits(db: AppDatabase) {
  const row = db
    .select()
    .from(executionSettings)
    .where(eq(executionSettings.id, "default"))
    .get();
  return {
    maxSteps: row?.maxSteps ?? defaultAgentLoopBounds.maxSteps,
    ...(row?.maxCostUsdMicros != null
      ? { maxCostUsdMicros: row.maxCostUsdMicros }
      : {}),
  };
}
