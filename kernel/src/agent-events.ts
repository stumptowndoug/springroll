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

const eventIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    occurredAt: z.iso.datetime(),
  })
  .strict();

const lifecycleEventSchema = z
  .object({
    type: z.literal("lifecycle"),
    phase: z.enum(["started", "completed", "failed", "cancelled"]),
    message: z.string().min(1).optional(),
  })
  .strict();

const messagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z.object({ type: z.literal("reasoning"), text: z.string() }).strict(),
  z.object({ type: z.literal("json"), value: jsonValueSchema }).strict(),
]);

const messageEventSchema = z
  .object({
    type: z.literal("message"),
    messageId: z.string().min(1),
    role: z.enum(["system", "user", "assistant", "tool"]),
    parts: z.array(messagePartSchema),
  })
  .strict();

const sourceEventSchema = z
  .object({
    type: z.literal("source"),
    sourceId: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    toolCallId: z.string().min(1).optional(),
    providerMetadata: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

const toolCallEventSchema = z
  .object({
    type: z.literal("tool_call"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    sourceId: z.string().min(1),
    input: z.record(z.string(), jsonValueSchema),
    effect: z.enum(["read", "write", "destructive"]),
    openWorld: z.boolean(),
    approval: z.enum(["never", "before_call"]),
  })
  .strict();

const toolResultEventSchema = z
  .object({
    type: z.literal("tool_result"),
    toolCallId: z.string().min(1),
    status: z.enum(["succeeded", "failed"]),
    output: jsonValueSchema.optional(),
    outputSummary: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();

const policyDecisionEventSchema = z
  .object({
    type: z.literal("policy_decision"),
    decision: z.enum(["allowed", "approval_required", "denied"]),
    reason: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
    ruleId: z.string().min(1).optional(),
  })
  .strict();

const usageEventSchema = z
  .object({
    type: z.literal("usage"),
    modelCallId: z.string().min(1),
    provider: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    billing: z.enum(["metered", "subscription", "unknown"]),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    costUsdMicros: z.number().int().nonnegative().optional(),
    providerMetadata: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

const eventPayloadSchema = z.discriminatedUnion("type", [
  lifecycleEventSchema,
  messageEventSchema,
  sourceEventSchema,
  toolCallEventSchema,
  toolResultEventSchema,
  policyDecisionEventSchema,
  usageEventSchema,
]);

export type AgentEventPayloadV1 = JsonObject &
  z.infer<typeof eventPayloadSchema>;

export const agentEventV1Schema = z.intersection(
  eventIdentitySchema,
  eventPayloadSchema,
);

export type AgentEventV1 = JsonObject & z.infer<typeof agentEventV1Schema>;

export interface AgentEventSink {
  append(event: AgentEventPayloadV1, occurredAt: Date): Promise<AgentEventV1>;
}

export function parseAgentEventV1(value: unknown): AgentEventV1 {
  return agentEventV1Schema.parse(value) as AgentEventV1;
}
