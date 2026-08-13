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
      return `/connections/${encodeURIComponent(id)}`;
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
    case "connections":
      return { to: "/connections", label: "Connections" };
    default:
      return { to: "/inbox", label: "Inbox" };
  }
}

export type AskBarScope = {
  readonly placeholder: string;
  readonly entry: ChatSessionEntryDto;
  readonly chip?: { readonly label: string };
  readonly continueSessionId?: string;
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
    const chipLabel = labels.run ?? labels.task ?? labels.connection;
    return {
      placeholder: "Reply, or ask anything",
      continueSessionId: chatMatch[1],
      entry: generalAskEntry("chat"),
      ...(chipLabel ? { chip: { label: chipLabel } } : undefined),
    };
  }

  const runMatch = /^\/(?:inbox|runs)\/([^/]+)$/.exec(pathname);
  if (runMatch?.[1]) {
    return {
      placeholder: "Reply to this letter, or ask anything",
      entry: runDiagnoseEntry({
        id: runMatch[1],
        taskName: labels.run ?? "this run",
      }),
      ...(labels.run ? { chip: { label: labels.run } } : undefined),
    };
  }

  const recipeMatch = /^\/(?:recipes|tasks)\/([^/]+)$/.exec(pathname);
  if (recipeMatch?.[1] && recipeMatch[1] !== "new") {
    return {
      placeholder: "Ask, or change anything — schedule, model, connections…",
      entry: {
        context: {
          version: 1,
          intent: "task.manage",
          origin: "recipes",
          subjects: [{ kind: "task", id: recipeMatch[1] }],
        },
      },
      ...(labels.task ? { chip: { label: labels.task } } : undefined),
    };
  }

  const connectionMatch = /^\/connections\/([^/]+)$/.exec(pathname);
  if (
    connectionMatch?.[1] &&
    connectionMatch[1] !== "new" &&
    connectionMatch[1] !== "manual"
  ) {
    return {
      placeholder:
        "Ask, or fix anything — reconnect, permissions, which recipes use it…",
      entry: {
        context: {
          version: 1,
          intent: "connection.manage",
          origin: "connections",
          subjects: [{ kind: "connection", id: connectionMatch[1] }],
        },
      },
      ...(labels.connection
        ? { chip: { label: labels.connection } }
        : undefined),
    };
  }

  if (pathname === "/recipes" || pathname === "/tasks") {
    return {
      placeholder: "Describe a new recipe, or ask about the ones you have",
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
    pathname === "/connections" ||
    pathname === "/connections/new" ||
    pathname === "/connections/manual"
  ) {
    return {
      placeholder: "Ask, or describe an integration you want",
      entry: {
        mode: "new",
        context: {
          version: 1,
          intent: "connection.create",
          origin: "connections",
          subjects: [],
        },
      },
    };
  }

  if (pathname === "/models") {
    return {
      placeholder: "Ask about models, providers, or which recipe uses what",
      entry: generalAskEntry("chat"),
    };
  }

  if (pathname === "/settings") {
    return {
      placeholder: "Ask Springroll",
      entry: generalAskEntry("chat"),
    };
  }

  return {
    placeholder: "Ask Springroll, or describe a recipe you want",
    entry: generalAskEntry("chat"),
  };
}

export function droppedChipScope(scope: AskBarScope): AskBarScope {
  return {
    placeholder: "Ask Springroll, or describe a recipe you want",
    entry: generalAskEntry(scope.entry.context.origin),
  };
}
