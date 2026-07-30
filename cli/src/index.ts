import type { Task } from "@shrimp-roll/kernel";

const exampleTask: Task = {
  id: "example-hn-digest",
  prompt: "Summarize Hacker News every morning",
  enabled: false,
  nextRunAt: new Date(),
  catchUpPolicy: "skip_to_next",
  tools: [],
};

console.log(`Development shell ready for task proposal: ${exampleTask.prompt}`);
