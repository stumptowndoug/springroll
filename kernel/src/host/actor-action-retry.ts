export async function retryActorAction<T>(
  action: () => Promise<T>,
  onRetry?: (attempt: number, delayMs: number) => void,
): Promise<T> {
  const delaysMs = [100, 250, 500] as const;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const delayMs = delaysMs[attempt];
      if (delayMs === undefined || !isClosedCoordinatorError(error)) {
        throw error;
      }
      onRetry?.(attempt + 1, delayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isClosedCoordinatorError(error: unknown): boolean {
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
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}
