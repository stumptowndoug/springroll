import {
  type Connection,
  createHackerNewsToolSource,
  createNativeToolSource,
  hackerNewsTopStoriesInputSchema,
  hashToolSchema,
  type JsonSchema,
  type NativeTool,
  type Task,
  type ToolSource,
} from "@springroll/kernel";

export const publishDigestInputSchema = {
  type: "object",
  properties: {
    channel: {
      type: "string",
      description: "Channel to publish the digest to.",
    },
  },
  required: ["channel"],
  additionalProperties: false,
} as const satisfies JsonSchema;

export const publishedDigests: string[] = [];

const publishDigest: NativeTool = {
  descriptor: {
    name: "publish_digest",
    description:
      "Publish the finished digest. Destructive for spike purposes so it requires approval.",
    inputSchema: publishDigestInputSchema,
    declaredRisk: { effect: "destructive", openWorld: true, idempotent: false },
  },
  async execute(input) {
    const channel = String(input.channel ?? "unknown");
    publishedDigests.push(channel);
    return {
      content: [`Digest published to ${channel}.`],
      structuredContent: { channel, published: true },
    };
  },
};

const toolSources: readonly ToolSource[] = [
  createHackerNewsToolSource(),
  createNativeToolSource("native.publisher", [publishDigest]),
];

export function getToolSource(sourceId: string): ToolSource | undefined {
  return toolSources.find((source) => source.id === sourceId);
}

export const digestConnections: readonly Connection[] = [
  {
    id: "connection-hn",
    sourceId: "native.hacker-news",
    credentialRef: "none",
    availableIn: ["local", "hosted"],
  },
  {
    id: "connection-publisher",
    sourceId: "native.publisher",
    credentialRef: "none",
    availableIn: ["local", "hosted"],
  },
];

export async function buildDigestTask(
  prompt: string,
  occurrenceTime: Date,
): Promise<Task> {
  const [hackerNewsHash, publishHash] = await Promise.all([
    hashToolSchema(hackerNewsTopStoriesInputSchema as JsonSchema),
    hashToolSchema(publishDigestInputSchema),
  ]);
  return {
    id: "task-rivet-spike",
    prompt,
    enabled: true,
    nextRunAt: occurrenceTime,
    catchUpPolicy: "catch_up",
    scheduleTimezone: "UTC",
    tools: [
      {
        sourceId: "native.hacker-news",
        connectionId: "connection-hn",
        name: "get_hacker_news_top_stories",
        inputSchemaHash: hackerNewsHash,
        risk: { effect: "read", openWorld: true, idempotent: true },
        approval: "never",
      },
      {
        sourceId: "native.publisher",
        connectionId: "connection-publisher",
        name: "publish_digest",
        inputSchemaHash: publishHash,
        risk: { effect: "destructive", openWorld: true, idempotent: false },
        approval: "before_call",
      },
    ],
  };
}
