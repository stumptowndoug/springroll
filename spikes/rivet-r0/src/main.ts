import { createClient } from "rivetkit/client";
import { retryActorAction } from "./actor-action-retry.ts";
import { registry } from "./task-actor.ts";

const endpoint = process.env.RIVET_ENDPOINT ?? "http://localhost:6420";
const [command, ...args] = process.argv.slice(2);

function actorHandle() {
  const client = createClient<typeof registry>(endpoint);
  return client.taskActor.getOrCreate(["spike"]);
}

function callActorAction<T>(action: () => Promise<T>): Promise<T> {
  return retryActorAction(action, {
    onRetry: (_error, attempt, delayMs) => {
      console.warn(
        `Rivet actor was still waking; retrying action (attempt ${attempt}) in ${delayMs}ms`,
      );
    },
  });
}

async function main() {
  switch (command) {
    case "serve": {
      registry.start();
      return;
    }
    case "run": {
      console.log(await callActorAction(() => actorHandle().fireOccurrence()));
      return;
    }
    case "approve": {
      console.log(await callActorAction(() => actorHandle().approve(true)));
      return;
    }
    case "deny": {
      console.log(await callActorAction(() => actorHandle().approve(false)));
      return;
    }
    case "cron": {
      const expression = args[0];
      if (!expression) throw new Error("usage: cron <expression>");
      console.log(
        await callActorAction(() => actorHandle().setCron(expression)),
      );
      return;
    }
    case "clear-cron": {
      console.log(await callActorAction(() => actorHandle().clearCron()));
      return;
    }
    case "schedule-in": {
      const delayMs = Number(args[0]);
      if (!Number.isFinite(delayMs)) throw new Error("usage: schedule-in <ms>");
      console.log(
        await callActorAction(() => actorHandle().scheduleIn(delayMs)),
      );
      return;
    }
    case "configure": {
      const prompt = args.join(" ");
      if (!prompt) throw new Error("usage: configure <prompt>");
      console.log(await callActorAction(() => actorHandle().configure(prompt)));
      return;
    }
    case "runs": {
      console.log(
        JSON.stringify(
          await callActorAction(() => actorHandle().listRuns()),
          null,
          2,
        ),
      );
      return;
    }
    case "events": {
      const cursor = Number(args[0] ?? 0);
      const events = await callActorAction(() =>
        actorHandle().eventsSince(cursor),
      );
      for (const event of events) {
        console.log(`${event.cursor}\t${event.runId}\t${event.type}`);
      }
      console.log(`(${events.length} events past cursor ${cursor})`);
      return;
    }
    case "inspect": {
      console.log(
        JSON.stringify(
          await callActorAction(() => actorHandle().inspect()),
          null,
          2,
        ),
      );
      return;
    }
    case "watch": {
      const client = createClient<typeof registry>(endpoint);
      const connection = client.taskActor
        .getOrCreate(["spike"])
        .connect() as ReturnType<
        ReturnType<typeof client.taskActor.getOrCreate>["connect"]
      >;
      connection.on("runEvent", (event: { type?: string }) => {
        console.log(`event: ${event.type}`);
      });
      connection.on("runWaiting", (payload: unknown) => {
        console.log("waiting for approval:", payload);
      });
      connection.on("runFinished", (payload: unknown) => {
        console.log("finished:", payload);
      });
      console.log("watching (ctrl-c to stop)...");
      return;
    }
    default: {
      console.log(
        [
          "usage: bun src/main.ts <command>",
          "  serve             start the registry (keep running in its own terminal)",
          "  configure <text>  set the task prompt",
          "  run               fire an occurrence now",
          "  approve | deny    resolve a pending destructive-tool approval",
          "  cron <expr>       set the recurring schedule (5-field cron, UTC)",
          "  clear-cron        remove the recurring schedule",
          "  schedule-in <ms>  fire one occurrence after a delay",
          "  runs              list run rows from the actor's embedded SQLite",
          "  events [cursor]   catch-up read past a cursor (the mirror protocol)",
          "  inspect           dump actor state, cron jobs, and one-shot schedules",
          "  watch             stream live events over a realtime connection",
        ].join("\n"),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
