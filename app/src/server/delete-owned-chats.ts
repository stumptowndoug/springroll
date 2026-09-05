import {
  type AppDatabase,
  type ChatSubjectReference,
  chatSessions,
  chatTurns,
  modelCalls,
  toolApprovals,
} from "@springroll/kernel";
import { and, eq, inArray } from "drizzle-orm";

/** Called inside the same transaction that deletes the owning task/run. */
export function deleteOwnedChats(
  tx: Pick<AppDatabase, "select" | "delete">,
  subjects: readonly ChatSubjectReference[],
  beforeDelete: (sessionId: string) => void,
): boolean {
  const owned = new Set(
    subjects.map((subject) => `${subject.kind}:${subject.id}`),
  );
  const sessions = tx
    .select()
    .from(chatSessions)
    .all()
    .filter((session) =>
      session.context?.subjects.some((subject) =>
        owned.has(`${subject.kind}:${subject.id}`),
      ),
    );
  // Never remove the persistence target of an in-flight assistant. The user
  // can stop it and retry; no conversation is altered on this conflict.
  if (sessions.some((session) => session.activeTurnId)) return false;
  for (const session of sessions) {
    beforeDelete(session.id);
    const turnIds = tx
      .select({ id: chatTurns.id })
      .from(chatTurns)
      .where(eq(chatTurns.sessionId, session.id))
      .all()
      .map((turn) => turn.id);
    if (turnIds.length) {
      tx.delete(modelCalls)
        .where(
          and(
            eq(modelCalls.contextKind, "chat"),
            inArray(modelCalls.contextId, turnIds),
          ),
        )
        .run();
      tx.delete(toolApprovals)
        .where(
          and(
            eq(toolApprovals.contextKind, "chat"),
            inArray(toolApprovals.contextId, turnIds),
          ),
        )
        .run();
    }
    tx.delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
  }
  return true;
}
