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
  // A just-sent ask has no createdAt until the server echoes it back. It
  // carries the previous message's time so it stays where it was typed
  // instead of sorting past the reply it is still waiting for.
  let carried = 0;
  const items = [
    ...messages.map((message, order) => {
      carried = timestamp(message.metadata?.createdAt) ?? carried;
      return {
        kind: "message" as const,
        id: message.id,
        message,
        order,
        occurredAt: carried,
      };
    }),
    ...runs.map((run, index) => ({
      kind: "run" as const,
      id: run.id,
      run,
      order: messages.length + index,
      occurredAt:
        timestamp(run.scheduledTime) ?? Number.MAX_SAFE_INTEGER - index,
    })),
  ];
  items.sort(
    (left, right) =>
      left.occurredAt - right.occurredAt || left.order - right.order,
  );
  return items.map(({ order: _, occurredAt: __, ...item }) => item);
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
