import { z } from "zod";
import type { JsonObject, JsonValue } from "./tools.ts";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const chatSessionStatusSchema = z.enum(["active", "archived"]);
export const chatSessionIntentSchema = z.enum([
  "general",
  "connection.create",
  "connection.manage",
  "task.create",
  "task.manage",
  "run.diagnose",
]);
export const chatSessionOriginSchema = z.enum([
  "chat",
  "integrations",
  "connections",
  "recipes",
  "tasks",
  "runs",
]);
export const chatSubjectKindSchema = z.enum(["connection", "task", "run"]);
export const chatSubjectReferenceSchema = z
  .object({
    kind: chatSubjectKindSchema,
    id: z.string().trim().min(1).max(200),
  })
  .strict();
export const chatSessionContextSchema = z
  .object({
    version: z.literal(1),
    intent: chatSessionIntentSchema,
    origin: chatSessionOriginSchema,
    subjects: z.array(chatSubjectReferenceSchema).max(8).default([]),
    suggestedPrompt: z
      .string()
      .max(8_000)
      .refine((value) => value.trim().length > 0, {
        message: "Suggested prompt must not be blank",
      })
      .optional(),
  })
  .strict()
  .superRefine((context, refinement) => {
    const keys = new Set<string>();
    for (const [index, subject] of context.subjects.entries()) {
      const key = `${subject.kind}:${subject.id}`;
      if (keys.has(key)) {
        refinement.addIssue({
          code: "custom",
          path: ["subjects", index],
          message: "Conversation subjects must be unique",
        });
      }
      keys.add(key);
    }
  });
export const chatSessionEntryModeSchema = z.enum(["new", "resume"]);
export const chatTurnStatusSchema = z.enum([
  "queued",
  "streaming",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
]);
export const chatMessageRoleSchema = z.enum(["system", "user", "assistant"]);
export const assistantWorkflowKindSchema = z.literal("connection_setup");
export const assistantWorkflowStatusSchema = z.enum([
  "proposed",
  "in_progress",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
]);
export const modelCallContextKindSchema = z.enum([
  "proposal",
  "run",
  "chat",
  "distill",
]);
export const modelCallStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "cancelled",
]);

const durableChatPartSchema = z
  .object({ type: z.string().min(1) })
  .catchall(jsonValueSchema)
  .superRefine((part, context) => {
    if (part.type === "reasoning" || part.type === "reasoning-file") {
      context.addIssue({
        code: "custom",
        message: "Raw reasoning parts are not durable chat content",
      });
    }
  });

export const durableChatContentSchema = z
  .object({
    parts: z.array(durableChatPartSchema),
    metadata: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((content, context) => {
    if (JSON.stringify(content.parts).length > 256_000) {
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: "Durable chat content must be 256 KB or smaller",
      });
    }
    if (JSON.stringify(content.metadata).length > 32_000) {
      context.addIssue({
        code: "custom",
        path: ["metadata"],
        message: "Durable chat metadata must be 32 KB or smaller",
      });
    }
  });

export type ChatSessionStatus = z.infer<typeof chatSessionStatusSchema>;
export type ChatSessionIntent = z.infer<typeof chatSessionIntentSchema>;
export type ChatSessionOrigin = z.infer<typeof chatSessionOriginSchema>;
export type ChatSubjectKind = z.infer<typeof chatSubjectKindSchema>;
export type ChatSubjectReference = z.infer<typeof chatSubjectReferenceSchema>;
export type ChatSessionContext = z.infer<typeof chatSessionContextSchema>;
export type ChatSessionEntryMode = z.infer<typeof chatSessionEntryModeSchema>;
export type ChatTurnStatus = z.infer<typeof chatTurnStatusSchema>;
export type ChatMessageRole = z.infer<typeof chatMessageRoleSchema>;
export type AssistantWorkflowKind = z.infer<typeof assistantWorkflowKindSchema>;
export type AssistantWorkflowStatus = z.infer<
  typeof assistantWorkflowStatusSchema
>;
export type ModelCallContextKind = z.infer<typeof modelCallContextKindSchema>;
export type ModelCallStatus = z.infer<typeof modelCallStatusSchema>;
export type DurableChatContent = {
  readonly parts: readonly JsonObject[];
  readonly metadata: JsonObject;
};

export function parseDurableChatContent(value: unknown): DurableChatContent {
  return durableChatContentSchema.parse(value) as DurableChatContent;
}

export function parseChatSessionContext(value: unknown): ChatSessionContext {
  return chatSessionContextSchema.parse(value);
}

export function chatSessionContextKey(contextValue: unknown): string {
  const context = parseChatSessionContext(contextValue);
  const subjects = [...context.subjects]
    .map((subject) => `${subject.kind}:${subject.id}`)
    .sort();
  return JSON.stringify([context.intent, subjects]);
}

export function isTerminalChatTurnStatus(status: ChatTurnStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function isValidChatTurnTransition(
  current: ChatTurnStatus,
  next: ChatTurnStatus,
): boolean {
  if (current === next) return true;
  if (isTerminalChatTurnStatus(current)) return false;
  if (current === "queued") {
    return next === "streaming" || isTerminalChatTurnStatus(next);
  }
  return (
    next === "streaming" ||
    next === "waiting_for_user" ||
    isTerminalChatTurnStatus(next)
  );
}

export function isTerminalAssistantWorkflowStatus(
  status: AssistantWorkflowStatus,
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function isValidAssistantWorkflowTransition(
  current: AssistantWorkflowStatus,
  next: AssistantWorkflowStatus,
): boolean {
  if (current === next) return true;
  if (isTerminalAssistantWorkflowStatus(current)) return false;
  return (
    next === "in_progress" ||
    next === "waiting_for_user" ||
    isTerminalAssistantWorkflowStatus(next)
  );
}
