export interface ActorActionRetryOptions {
  readonly delaysMs?: readonly number[];
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const defaultDelaysMs = [100, 250, 500] as const;

/**
 * Retries only the transient generation-sync failure observed immediately
 * after a local engine restart. Other action failures are never replayed.
 */
export async function retryActorAction<T>(
  action: () => Promise<T>,
  options: ActorActionRetryOptions = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? defaultDelaysMs;
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const delayMs = delaysMs[attempt];
      if (delayMs === undefined || !isClosedCoordinatorError(error)) {
        throw error;
      }
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }
}

export function isClosedCoordinatorError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof Error &&
      /sqlite transaction coordinator is closed/i.test(current.message)
    ) {
      return true;
    }
    if (typeof current === "object" && "cause" in current) {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}
