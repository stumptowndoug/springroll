import { and, desc, eq, ne } from "drizzle-orm";
import {
  parseRecipeKnowledgeDocument,
  type RecipeKnowledgeDocument,
  recipeKnowledgeDocumentSchema,
} from "../recipe-knowledge.ts";
import type { AppDatabase } from "./database.ts";
import { type TaskRecipeKnowledgeRow, taskRecipeKnowledge } from "./schema.ts";

export interface CreateRecipeKnowledgeRevisionInput {
  readonly taskId: string;
  readonly knowledge: RecipeKnowledgeDocument;
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

  getBySourceRun(runId: string): TaskRecipeKnowledgeRow | undefined {
    const row = this.db
      .select()
      .from(taskRecipeKnowledge)
      .where(eq(taskRecipeKnowledge.sourceRunId, runId))
      .get();
    return row ? parseRow(row) : undefined;
  }

  /**
   * Save a new revision of the recipe's living notes document. The revision
   * activates immediately; the previously active revision is kept as
   * superseded history.
   */
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
      tx.update(taskRecipeKnowledge)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(taskRecipeKnowledge.taskId, input.taskId),
            eq(taskRecipeKnowledge.status, "ready"),
          ),
        )
        .run();
      tx.insert(taskRecipeKnowledge)
        .values({
          taskId: input.taskId,
          revision,
          status: "ready",
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
}

function parseRow(row: TaskRecipeKnowledgeRow): TaskRecipeKnowledgeRow {
  return { ...row, knowledge: parseRecipeKnowledgeDocument(row.knowledge) };
}

function validateIdentifier(value: string, label: string): void {
  if (!value.trim() || value.length > 200) {
    throw new TypeError(`${label} must be between 1 and 200 characters`);
  }
}
