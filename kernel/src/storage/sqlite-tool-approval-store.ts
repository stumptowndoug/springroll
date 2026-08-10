import { and, asc, eq, inArray } from "drizzle-orm";
import type { JsonObject } from "../tools.ts";
import type { AppDatabase } from "./database.ts";
import { type ToolApprovalRow, toolApprovals } from "./schema.ts";

export type ToolApprovalContextKind = "chat" | "run";
export type ToolApprovalRiskEffect = "read" | "write" | "destructive";
export type ToolApprovalDecision = {
  readonly id: string;
  readonly approved: boolean;
  readonly reason?: string;
};

export interface RecordPendingToolApprovalInput {
  readonly id: string;
  readonly contextKind: ToolApprovalContextKind;
  readonly contextId: string;
  readonly messageId?: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: JsonObject;
  readonly riskEffect: ToolApprovalRiskEffect;
  readonly now?: Date;
}

export class SqliteToolApprovalStore {
  constructor(private readonly db: AppDatabase) {}

  get(id: string): ToolApprovalRow | undefined {
    return this.db
      .select()
      .from(toolApprovals)
      .where(eq(toolApprovals.id, id))
      .get();
  }

  list(
    contextKind: ToolApprovalContextKind,
    contextId: string,
  ): readonly ToolApprovalRow[] {
    return this.db
      .select()
      .from(toolApprovals)
      .where(
        and(
          eq(toolApprovals.contextKind, contextKind),
          eq(toolApprovals.contextId, contextId),
        ),
      )
      .orderBy(asc(toolApprovals.createdAt))
      .all();
  }

  recordPending(input: RecordPendingToolApprovalInput): ToolApprovalRow {
    validateText(input.id, "Tool approval ID", 200);
    validateText(input.contextId, "Tool approval context", 200);
    validateText(input.toolCallId, "Tool call ID", 200);
    validateText(input.toolName, "Tool name", 200);
    if (JSON.stringify(input.input).length > 64_000) {
      throw new TypeError("Tool approval input must be 64 KB or smaller");
    }
    const now = input.now ?? new Date();
    const existing = this.get(input.id);
    if (existing) {
      if (
        existing.contextKind !== input.contextKind ||
        existing.contextId !== input.contextId ||
        existing.toolCallId !== input.toolCallId ||
        existing.toolName !== input.toolName ||
        existing.riskEffect !== input.riskEffect ||
        JSON.stringify(existing.input) !== JSON.stringify(input.input)
      ) {
        throw new Error(`Tool approval ID collision: ${input.id}`);
      }
      return existing;
    }
    this.db
      .insert(toolApprovals)
      .values({
        id: input.id,
        contextKind: input.contextKind,
        contextId: input.contextId,
        ...(input.messageId ? { messageId: input.messageId } : undefined),
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input,
        riskEffect: input.riskEffect,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.require(input.id);
  }

  decide(
    contextKind: ToolApprovalContextKind,
    contextId: string,
    decisions: readonly ToolApprovalDecision[],
    now = new Date(),
  ): readonly ToolApprovalRow[] {
    if (decisions.length === 0) {
      throw new TypeError("At least one tool approval decision is required");
    }
    return this.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(toolApprovals)
        .where(
          inArray(
            toolApprovals.id,
            decisions.map(({ id }) => id),
          ),
        )
        .all();
      if (rows.length !== decisions.length) {
        throw new Error("One or more tool approvals are no longer pending");
      }
      for (const decision of decisions) {
        const row = rows.find(({ id }) => id === decision.id);
        const nextStatus = decision.approved ? "approved" : "denied";
        if (
          !row ||
          row.contextKind !== contextKind ||
          row.contextId !== contextId ||
          (row.status !== "pending" && row.status !== nextStatus) ||
          (row.status === nextStatus &&
            (row.reason ?? undefined) !== decision.reason)
        ) {
          throw new Error(`Tool approval is no longer pending: ${decision.id}`);
        }
      }
      for (const decision of decisions) {
        tx.update(toolApprovals)
          .set({
            status: decision.approved ? "approved" : "denied",
            reason: decision.reason ?? null,
            decidedAt: now,
            ...(decision.approved ? undefined : { completedAt: now }),
            updatedAt: now,
          })
          .where(eq(toolApprovals.id, decision.id))
          .run();
      }
      return decisions.map(({ id }) => {
        const row = tx
          .select()
          .from(toolApprovals)
          .where(eq(toolApprovals.id, id))
          .get();
        if (!row) throw new Error(`Tool approval was not persisted: ${id}`);
        return row;
      });
    });
  }

  complete(
    id: string,
    input: {
      readonly status: "succeeded" | "failed";
      readonly outcome?: JsonObject;
      readonly now?: Date;
    },
  ): ToolApprovalRow {
    const current = this.require(id);
    if (
      current.status !== "approved" &&
      current.status !== "executing" &&
      current.status !== input.status
    ) {
      throw new Error(
        `Invalid tool approval transition: ${current.status} -> ${input.status}`,
      );
    }
    const now = input.now ?? new Date();
    this.db
      .update(toolApprovals)
      .set({
        status: input.status,
        outcome: input.outcome ?? null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(toolApprovals.id, id))
      .run();
    return this.require(id);
  }

  markExecuting(id: string, now = new Date()): ToolApprovalRow {
    const current = this.require(id);
    if (current.status !== "approved" && current.status !== "executing") {
      throw new Error(
        `Invalid tool approval transition: ${current.status} -> executing`,
      );
    }
    this.db
      .update(toolApprovals)
      .set({ status: "executing", executionStartedAt: now, updatedAt: now })
      .where(eq(toolApprovals.id, id))
      .run();
    return this.require(id);
  }

  recoverExecuting(now = new Date()): number {
    return this.db
      .update(toolApprovals)
      .set({
        status: "interrupted",
        outcome: {
          state: "ambiguous",
          message:
            "Springroll restarted after execution began; verify remote state before retrying.",
        },
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(toolApprovals.status, "executing"))
      .returning({ id: toolApprovals.id })
      .all().length;
  }

  private require(id: string): ToolApprovalRow {
    const row = this.get(id);
    if (!row) throw new Error(`Unknown tool approval: ${id}`);
    return row;
  }
}

function validateText(value: string, label: string, max: number): void {
  if (!value.trim()) throw new TypeError(`${label} is required`);
  if (value.length > max) {
    throw new TypeError(`${label} must be ${max} characters or fewer`);
  }
}
