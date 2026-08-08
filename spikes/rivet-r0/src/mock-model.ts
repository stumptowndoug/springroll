import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 40, text: 40, reasoning: 0 },
};

function toolCallTurn(toolCallId: string, toolName: string, input: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        {
          type: "tool-call" as const,
          toolCallId,
          toolName,
          input,
          dynamic: true,
        },
        {
          type: "finish" as const,
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
        },
      ],
    }),
  };
}

function textTurn(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "text-1" },
        { type: "text-delta" as const, id: "text-1", delta: text },
        { type: "text-end" as const, id: "text-1" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage,
        },
      ],
    }),
  };
}

/**
 * Fresh occurrence: fetch real Hacker News stories, then request the
 * destructive publish tool so the run pauses for approval.
 */
export function freshRunModel() {
  return new MockLanguageModelV4({
    doStream: [
      toolCallTurn("hn-1", "get_hacker_news_top_stories", '{"limit":3}'),
      toolCallTurn("publish-1", "publish_digest", '{"channel":"spike"}'),
    ],
  });
}

/**
 * Resumed continuation (potentially in a freshly restarted process): the
 * approved publish tool has executed; the model closes with the digest text.
 */
export function resumeRunModel() {
  return new MockLanguageModelV4({
    doStream: [
      textTurn(
        "# Rivet R0 digest\n\nFetched real Hacker News stories inside a Rivet actor, paused for approval at the destructive publish tool, survived a checkpoint, and completed after resume.",
      ),
    ],
  });
}
