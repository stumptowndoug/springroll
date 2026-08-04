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
export const chatTurnStatusSchema = z.enum([
  "queued",
  "streaming",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
]);
export const chatMessageRoleSchema = z.enum(["system", "user", "assistant"]);
export const modelCallContextKindSchema = z.enum(["proposal", "run", "chat"]);
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
export type ChatTurnStatus = z.infer<typeof chatTurnStatusSchema>;
export type ChatMessageRole = z.infer<typeof chatMessageRoleSchema>;
export type ModelCallContextKind = z.infer<typeof modelCallContextKindSchema>;
export type ModelCallStatus = z.infer<typeof modelCallStatusSchema>;
export type DurableChatContent = {
  readonly parts: readonly JsonObject[];
  readonly metadata: JsonObject;
};

export function parseDurableChatContent(value: unknown): DurableChatContent {
  return durableChatContentSchema.parse(value) as DurableChatContent;
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
