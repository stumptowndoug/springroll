import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { CatchUpPolicy } from "../shared.ts";

export interface ProposalConnectionOption {
  readonly id: string;
  readonly name: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
  }[];
}

export interface GeneratedTaskProposal {
  readonly title: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly scheduleLabel: string;
  readonly timezone: string;
  readonly connectionId: string;
  readonly toolNames: readonly string[];
  readonly contract: string;
  readonly catchUpPolicy: CatchUpPolicy;
}

export type GeneratedTaskProposalOutcome =
  | {
      readonly status: "ready";
      readonly proposal: GeneratedTaskProposal;
    }
  | {
      readonly status: "needs_integration";
      readonly title: string;
      readonly explanation: string;
      readonly missingCapability: string;
      readonly suggestedIntegration?: string | undefined;
      readonly supportedAlternative?: string | undefined;
    }
  | {
      readonly status: "unsupported";
      readonly title: string;
      readonly explanation: string;
      readonly supportedAlternative?: string | undefined;
    };

export interface TaskProposalGenerator {
  propose(input: {
    readonly sentence: string;
    readonly timezone: string;
    readonly connections: readonly ProposalConnectionOption[];
  }): Promise<GeneratedTaskProposalOutcome>;
}

const readyProposalSchema = z.object({
  title: z.string().min(2).max(80),
  prompt: z.string().min(3).max(2_000),
  schedule: z.string().min(5).max(100).describe("A five-field cron expression"),
  scheduleLabel: z.string().min(3).max(80),
  timezone: z.string().min(1).max(100),
  connectionId: z.string().min(1),
  toolNames: z.array(z.string().min(1)).min(1),
  contract: z.string().min(10).max(600),
  catchUpPolicy: z.enum(["catch_up", "skip_to_next"]),
});

const proposalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    proposal: readyProposalSchema,
  }),
  z.object({
    status: z.literal("needs_integration"),
    title: z.string().min(2).max(80),
    explanation: z.string().min(10).max(600),
    missingCapability: z.string().min(2).max(120),
    suggestedIntegration: z.string().min(2).max(80).optional(),
    supportedAlternative: z.string().min(10).max(600).optional(),
  }),
  z.object({
    status: z.literal("unsupported"),
    title: z.string().min(2).max(80),
    explanation: z.string().min(10).max(600),
    supportedAlternative: z.string().min(10).max(600).optional(),
  }),
]);

export class AiTaskProposalGenerator implements TaskProposalGenerator {
  constructor(private readonly loadModel: () => Promise<LanguageModel>) {}

  async propose(input: {
    readonly sentence: string;
    readonly timezone: string;
    readonly connections: readonly ProposalConnectionOption[];
  }): Promise<GeneratedTaskProposalOutcome> {
    const model = await this.loadModel();
    const result = await generateObject({
      model,
      schema: proposalOutcomeSchema,
      system: [
        "Turn a recurring task request into a conservative local scheduled-task proposal.",
        "Return ready only when the listed tools directly support the entire requested outcome.",
        "For ready tasks, choose exactly one available connection and only the tools needed.",
        "Public read-only research may use a general web search connection when available.",
        "Return needs_integration when private data, an account, or an external action requires a connection that is not available.",
        "Return unsupported when Springroll lacks the interaction, output type, or multi-service execution needed to complete the request.",
        "Never choose an unrelated connection merely because the schema requires a tool.",
        "Do not silently remove unsupported parts of a request; offer a supportedAlternative instead.",
        "Use a five-field cron expression and the supplied IANA timezone.",
        "The contract must plainly say what the task can and cannot do.",
        "Prefer skip_to_next unless catching up late is important.",
      ].join(" "),
      prompt: JSON.stringify({
        request: input.sentence,
        timezone: input.timezone,
        availableConnections: input.connections,
      }),
      maxRetries: 1,
    });

    return result.object;
  }
}
