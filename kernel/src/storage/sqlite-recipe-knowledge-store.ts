import { and, desc, eq, ne } from "drizzle-orm";
import {
  parseRecipeKnowledgeDocument,
  type RecipeKnowledgeDocument,
  type RecipeKnowledgeStatus,
  recipeKnowledgeDocumentSchema,
} from "../recipe-knowledge.ts";
import type { AppDatabase } from "./database.ts";
import { type TaskRecipeKnowledgeRow, taskRecipeKnowledge } from "./schema.ts";

export interface CreateRecipeKnowledgeRevisionInput {
  readonly taskId: string;
  readonly knowledge: RecipeKnowledgeDocument;
  readonly status?: Extract<RecipeKnowledgeStatus, "learning" | "needs_review">;
  readonly sourceRunId?: string;
  readonly now?: Date;
}

export class SqliteRecipeKnowledgeStore {
  constructor(private readonly db: AppDatabase) {}

  get(taskId: string, revision: number): TaskRecipeKnowledgeRow | undefined {
    const row = this.db
      .select()
      .from(taskRecipeKnowledge)
      .where(
        and(
          eq(taskRecipeKnowledge.taskId, taskId),
          eq(taskRecipeKnowledge.revision, revision),
        ),
      )
      .get();
    return row ? parseRow(row) : undefined;
  }

  getCurrent(taskId: string): TaskRecipeKnowledgeRow | undefined {
    const row = this.db
      .select()
      .from(taskRecipeKnowledge)
      .where(
        and(
          eq(taskRecipeKnowledge.taskId, taskId),
          ne(taskRecipeKnowledge.status, "superseded"),
        ),
      )
      .orderBy(desc(taskRecipeKnowledge.revision))
      .get();
    return row ? parseRow(row) : undefined;
  }

  getReady(taskId: string): TaskRecipeKnowledgeRow | undefined {
    const row = this.db
      .select()
      .from(taskRecipeKnowledge)
      .where(
        and(
          eq(taskRecipeKnowledge.taskId, taskId),
          eq(taskRecipeKnowledge.status, "ready"),
        ),
      )
      .orderBy(desc(taskRecipeKnowledge.revision))
      .get();
    return row ? parseRow(row) : undefined;
  }

  getBySourceRun(runId: string): TaskRecipeKnowledgeRow | undefined {
    const row = this.db
      .select()
      .from(taskRecipeKnowledge)
      .where(eq(taskRecipeKnowledge.sourceRunId, runId))
      .get();
    return row ? parseRow(row) : undefined;
  }

  createRevision(
    input: CreateRecipeKnowledgeRevisionInput,
  ): TaskRecipeKnowledgeRow {
    validateIdentifier(input.taskId, "Task ID");
    const knowledge = recipeKnowledgeDocumentSchema.parse(input.knowledge);
    const now = input.now ?? new Date();

    return this.db.transaction((tx) => {
      if (input.sourceRunId) {
        const existing = tx
          .select()
          .from(taskRecipeKnowledge)
          .where(eq(taskRecipeKnowledge.sourceRunId, input.sourceRunId))
          .get();
        if (existing) {
          const parsed = parseRow(existing);
          if (JSON.stringify(parsed.knowledge) !== JSON.stringify(knowledge)) {
            throw new Error(
              `Run ${input.sourceRunId} already proposed different recipe knowledge`,
            );
          }
          return parsed;
        }
      }
      const latest = tx
        .select({ revision: taskRecipeKnowledge.revision })
        .from(taskRecipeKnowledge)
        .where(eq(taskRecipeKnowledge.taskId, input.taskId))
        .orderBy(desc(taskRecipeKnowledge.revision))
        .get();
      const revision = (latest?.revision ?? 0) + 1;
      tx.insert(taskRecipeKnowledge)
        .values({
          taskId: input.taskId,
          revision,
          status: input.status ?? "needs_review",
          knowledge,
          sourceRunId: input.sourceRunId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const row = tx
        .select()
        .from(taskRecipeKnowledge)
        .where(
          and(
            eq(taskRecipeKnowledge.taskId, input.taskId),
            eq(taskRecipeKnowledge.revision, revision),
          ),
        )
        .get();
      if (!row) throw new Error("Recipe knowledge was not persisted");
      return parseRow(row);
    });
  }

  completeLearningForRun(
    runId: string,
    now = new Date(),
  ): TaskRecipeKnowledgeRow | undefined {
    const current = this.getBySourceRun(runId);
    if (!current) return undefined;
    if (current.status === "needs_review") return current;
    if (current.status !== "learning") {
      throw new Error(
        `Recipe knowledge cannot complete from ${current.status}`,
      );
    }
    this.db
      .update(taskRecipeKnowledge)
      .set({ status: "needs_review", updatedAt: now })
      .where(eq(taskRecipeKnowledge.sourceRunId, runId))
      .run();
    return this.getBySourceRun(runId);
  }

  discardLearningForRun(runId: string): void {
    this.db
      .delete(taskRecipeKnowledge)
      .where(
        and(
          eq(taskRecipeKnowledge.sourceRunId, runId),
          eq(taskRecipeKnowledge.status, "learning"),
        ),
      )
      .run();
  }

  approve(
    taskId: string,
    revision: number,
    now = new Date(),
  ): TaskRecipeKnowledgeRow {
    return this.db.transaction((tx) => {
      const target = tx
        .select()
        .from(taskRecipeKnowledge)
        .where(
          and(
            eq(taskRecipeKnowledge.taskId, taskId),
            eq(taskRecipeKnowledge.revision, revision),
          ),
        )
        .get();
      if (!target) throw new Error("Recipe knowledge was not found");
      if (target.status !== "needs_review" && target.status !== "ready") {
        throw new Error(
          `Recipe knowledge cannot be approved from ${target.status}`,
        );
      }
      if (target.status === "ready") return parseRow(target);

      tx.update(taskRecipeKnowledge)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(taskRecipeKnowledge.taskId, taskId),
            eq(taskRecipeKnowledge.status, "ready"),
          ),
        )
        .run();
      tx.update(taskRecipeKnowledge)
        .set({
          status: "ready",
          approvedAt: now,
          validatedAt: now,
          staleReason: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(taskRecipeKnowledge.taskId, taskId),
            eq(taskRecipeKnowledge.revision, revision),
          ),
        )
        .run();
      const approved = tx
        .select()
        .from(taskRecipeKnowledge)
        .where(
          and(
            eq(taskRecipeKnowledge.taskId, taskId),
            eq(taskRecipeKnowledge.revision, revision),
          ),
        )
        .get();
      if (!approved) throw new Error("Recipe knowledge was not approved");
      return parseRow(approved);
    });
  }

  markStale(
    taskId: string,
    reason: string,
    now = new Date(),
  ): TaskRecipeKnowledgeRow {
    const normalizedReason = reason.trim();
    if (!normalizedReason || normalizedReason.length > 2_000) {
      throw new TypeError("Stale reason must be between 1 and 2000 characters");
    }
    const current = this.getCurrent(taskId);
    if (
      !current ||
      (current.status !== "ready" && current.status !== "stale")
    ) {
      throw new Error("Task has no ready recipe knowledge to mark stale");
    }
    if (
      current.status === "stale" &&
      current.staleReason === normalizedReason
    ) {
      return current;
    }
    this.db
      .update(taskRecipeKnowledge)
      .set({
        status: "stale",
        staleReason: normalizedReason,
        updatedAt: now,
      })
      .where(
        and(
          eq(taskRecipeKnowledge.taskId, taskId),
          eq(taskRecipeKnowledge.revision, current.revision),
        ),
      )
      .run();
    const stale = this.get(taskId, current.revision);
    if (!stale) throw new Error("Recipe knowledge was not marked stale");
    return stale;
  }
}

function parseRow(row: TaskRecipeKnowledgeRow): TaskRecipeKnowledgeRow {
  return { ...row, knowledge: parseRecipeKnowledgeDocument(row.knowledge) };
}

function validateIdentifier(value: string, label: string): void {
  if (!value.trim() || value.length > 200) {
    throw new TypeError(`${label} must be between 1 and 200 characters`);
  }
}
