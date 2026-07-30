import type { OpenRouterModelConnection } from "@shrimp-roll/kernel";
import { generateObject } from "ai";
import { z } from "zod";
import type { CatchUpPolicy } from "../shared.ts";
import { openRouterCredentialRef } from "./sources.ts";

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

export interface TaskProposalGenerator {
  propose(input: {
    readonly sentence: string;
    readonly timezone: string;
    readonly connections: readonly ProposalConnectionOption[];
  }): Promise<GeneratedTaskProposal>;
}

const proposalSchema = z.object({
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

export class AiTaskProposalGenerator implements TaskProposalGenerator {
  constructor(private readonly models: OpenRouterModelConnection) {}

  async propose(input: {
    readonly sentence: string;
    readonly timezone: string;
    readonly connections: readonly ProposalConnectionOption[];
  }): Promise<GeneratedTaskProposal> {
    const model = await this.models.loadModel(openRouterCredentialRef);
    const result = await generateObject({
      model,
      schema: proposalSchema,
      system: [
        "Turn a recurring task request into a conservative local scheduled-task proposal.",
        "Choose exactly one available connection and only tools needed for the task.",
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
