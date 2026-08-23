import type {
  ChatSessionContextDto,
  ChatSessionDto,
  ChatSessionEntryDto,
} from "../shared.ts";

export function runDiagnoseEntry(run: {
  readonly id: string;
  readonly taskName: string;
}): ChatSessionEntryDto {
  return {
    context: {
      version: 1,
      intent: "run.diagnose",
      origin: "runs",
      subjects: [{ kind: "run", id: run.id }],
      suggestedPrompt: `Help me understand the run for “${run.taskName}”. Inspect the real run details and explain the outcome, any failure, and the next useful action.`,
    },
  };
}

export function generalAskEntry(
  origin: ChatSessionContextDto["origin"] = "chat",
): ChatSessionEntryDto {
  return {
    mode: "new",
    context: {
      version: 1,
      intent: "general",
      origin,
      subjects: [],
    },
  };
}

export function chatSessionTitle(session: ChatSessionDto): string {
  if (session.title) return session.title;
  switch (session.context?.intent) {
    case "connection.create":
      return "New integration";
    case "connection.manage":
      return "Connection help";
    case "task.create":
      return "New recipe";
    case "task.manage":
      return "Recipe help";
    case "run.diagnose":
      return "Run diagnosis";
    default:
      return "New conversation";
  }
}

export function chatSessionForSubject(
  sessions: readonly ChatSessionDto[],
  kind: "run" | "task" | "connection",
  id: string,
): ChatSessionDto | undefined {
  return sessions.find((session) =>
    session.context?.subjects.some(
      (subject) => subject.kind === kind && subject.id === id,
    ),
  );
}

export function chatSubjectHref(
  kind: "task" | "connection" | "run",
  id: string,
): string {
  switch (kind) {
    case "task":
      return `/recipes/${encodeURIComponent(id)}`;
    case "connection":
      return `/integrations/${encodeURIComponent(id)}`;
    case "run":
      return `/inbox/${encodeURIComponent(id)}`;
  }
}

export function chatOriginBackLink(
  origin: ChatSessionContextDto["origin"] | undefined,
): { readonly to: string; readonly label: string } {
  switch (origin) {
    case "recipes":
    case "tasks":
      return { to: "/recipes", label: "Recipes" };
    case "integrations":
    case "connections":
      return { to: "/integrations", label: "Integrations" };
    default:
      return { to: "/inbox", label: "Inbox" };
  }
}

export const ASK_BAR_PLACEHOLDER = "Ask Springroll";

export type AskBarScope = {
  readonly entry: ChatSessionEntryDto;
  readonly continueSessionId?: string;
  /** Keep the newly-created conversation on the current entity surface. */
  readonly continueInPlace?: boolean;
};

export function askBarScopeForPath(
  pathname: string,
  labels: {
    readonly task?: string;
    readonly connection?: string;
    readonly run?: string;
  } = {},
): AskBarScope {
  const chatMatch = /^\/chat\/([^/]+)$/.exec(pathname);
  if (chatMatch?.[1]) {
    return {
      continueSessionId: chatMatch[1],
      entry: generalAskEntry("chat"),
    };
  }

  const runMatch = /^\/(?:inbox|runs)\/([^/]+)$/.exec(pathname);
  if (runMatch?.[1]) {
    return {
      continueInPlace: true,
      entry: runDiagnoseEntry({
        id: runMatch[1],
        taskName: labels.run ?? "this run",
      }),
    };
  }

  const recipeMatch = /^\/(?:recipes|tasks)\/([^/]+)$/.exec(pathname);
  if (recipeMatch?.[1] && recipeMatch[1] !== "new") {
    return {
      entry: {
        context: {
          version: 1,
          intent: "task.manage",
          origin: "recipes",
          subjects: [{ kind: "task", id: recipeMatch[1] }],
        },
      },
    };
  }

  const connectionMatch = /^\/(?:integrations|connections)\/([^/]+)$/.exec(
    pathname,
  );
  if (
    connectionMatch?.[1] &&
    connectionMatch[1] !== "new" &&
    connectionMatch[1] !== "manual"
  ) {
    return {
      entry: {
        context: {
          version: 1,
          intent: "connection.manage",
          origin: "integrations",
          subjects: [{ kind: "connection", id: connectionMatch[1] }],
        },
      },
    };
  }

  if (pathname === "/recipes" || pathname === "/tasks") {
    return {
      entry: {
        mode: "new",
        context: {
          version: 1,
          intent: "task.create",
          origin: "recipes",
          subjects: [],
        },
      },
    };
  }

  if (
    pathname === "/integrations" ||
    pathname === "/integrations/new" ||
    pathname === "/integrations/manual" ||
    pathname === "/connections" ||
    pathname === "/connections/new" ||
    pathname === "/connections/manual"
  ) {
    return {
      entry: {
        mode: "new",
        context: {
          version: 1,
          intent: "connection.create",
          origin: "integrations",
          subjects: [],
        },
      },
    };
  }

  return {
    entry: generalAskEntry("chat"),
  };
}

/**
 * Run-scoped conversations are part of the run's canonical surface. Other
 * conversations still use their standalone thread route.
 */
export function chatSessionHref(session: ChatSessionDto): string {
  const run = session.context?.subjects.find(
    (subject) => subject.kind === "run",
  );
  return run
    ? chatSubjectHref("run", run.id)
    : `/chat/${encodeURIComponent(session.id)}`;
}
