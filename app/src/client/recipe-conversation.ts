import type {
  AssistantMessageDto,
  RecipeConversationRunDto,
} from "../shared.ts";

export type RecipeConversationItem =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly message: AssistantMessageDto;
    }
  | {
      readonly kind: "run";
      readonly id: string;
      readonly run: RecipeConversationRunDto;
    };

export function recipeConversationTimeline(
  messages: readonly AssistantMessageDto[],
  runs: readonly RecipeConversationRunDto[],
): readonly RecipeConversationItem[] {
  const items = [
    ...messages.map((message, order) => ({
      kind: "message" as const,
      id: message.id,
      message,
      order,
      occurredAt: timestamp(message.metadata?.createdAt, order),
    })),
    ...runs.map((run, index) => ({
      kind: "run" as const,
      id: run.id,
      run,
      order: messages.length + index,
      occurredAt: timestamp(run.scheduledTime, messages.length + index),
    })),
  ];
  items.sort(
    (left, right) =>
      left.occurredAt - right.occurredAt || left.order - right.order,
  );
  return items.map(({ order: _, occurredAt: __, ...item }) => item);
}

function timestamp(value: string | undefined, order: number): number {
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 8_640_000_000_000_000 + order;
}
