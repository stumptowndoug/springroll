import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { starterRecipeId } from "../shared.ts";
import type { LocalApplication } from "./application.ts";
import { webConnectionId } from "./sources.ts";

const markerPath = (databasePath: string) => `${databasePath}.starter-pending`;

/** Call after legacy database adoption, but before opening a new database. */
export function prepareStarterRecipe(databasePath: string): void {
  if (databasePath === ":memory:" || existsSync(databasePath)) return;
  // A durable pending marker lets startup retry if initialization is interrupted.
  try {
    writeFileSync(markerPath(databasePath), "morning-brief-v1\n", {
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function seedStarterRecipe(
  application: Pick<LocalApplication, "createTask">,
  databasePath: string,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): Promise<void> {
  if (databasePath === ":memory:" || !existsSync(markerPath(databasePath)))
    return;
  await application.createTask(
    {
      title: "Morning Brief",
      prompt: [
        "Find three noteworthy technology and science stories published in the past 24 hours.",
        "Search the web and read the original sources. Prefer credible reporting and primary sources, avoid duplicate coverage, and check publication dates.",
        "For each story, provide a headline, a two- or three-sentence summary in plain language, one sentence explaining why it matters, and a link to the source.",
        "Start with the report date. If fewer than three relevant stories can be verified, include only those you can verify and explain the limitation. Never invent stories or citations.",
      ].join("\n\n"),
      schedule: "0 8 * * *",
      scheduleLabel: "Daily at 8:00 AM",
      timezone,
      connectionId: webConnectionId,
      connectionName: "Web",
      toolNames: ["search_web", "fetch_public_url"],
      tools: [],
      contract:
        "A concise daily brief with up to three verified technology/science stories, why each matters, and clickable source links.",
      executionMode: "local",
      catchUpPolicy: "skip_to_next",
    },
    false,
    { id: starterRecipeId },
  );
  // Deleting or editing the example after startup must never cause reseeding.
  unlinkSync(markerPath(databasePath));
}
