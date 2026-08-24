import { asc, eq } from "drizzle-orm";
import type { RunFailureCategory } from "../failures.ts";
import type { AppDatabase } from "./database.ts";
import {
  type CredentialAuditEventRow,
  credentialAuditEvents,
} from "./schema.ts";

export type CredentialAuditAction =
  | "test"
  | "oauth_start"
  | "oauth_complete"
  | "hosted_enable"
  | "hosted_disable"
  | "revoke"
  | "remove";

export interface RecordCredentialAuditEventInput {
  readonly connectorId: string;
  readonly credentialKind: "oauth" | "api-key" | "none";
  readonly action: CredentialAuditAction;
  readonly status: "succeeded" | "failed";
  readonly failureCategory?: RunFailureCategory;
  readonly now?: Date;
}

export class SqliteCredentialAuditStore {
  constructor(private readonly db: AppDatabase) {}

  list(connectorId: string): readonly CredentialAuditEventRow[] {
    return this.db
      .select()
      .from(credentialAuditEvents)
      .where(eq(credentialAuditEvents.connectorId, connectorId))
      .orderBy(asc(credentialAuditEvents.createdAt))
      .all();
  }

  record(input: RecordCredentialAuditEventInput): CredentialAuditEventRow {
    const connectorId = input.connectorId.trim();
    if (!connectorId)
      throw new TypeError("Credential audit connector ID is required");
    const id = crypto.randomUUID();
    this.db
      .insert(credentialAuditEvents)
      .values({
        id,
        connectorId,
        credentialKind: input.credentialKind,
        action: input.action,
        status: input.status,
        failureCategory: input.failureCategory,
        createdAt: input.now ?? new Date(),
      })
      .run();
    const event = this.db
      .select()
      .from(credentialAuditEvents)
      .where(eq(credentialAuditEvents.id, id))
      .get();
    if (!event)
      throw new Error(`Credential audit event was not persisted: ${id}`);
    return event;
  }
}
