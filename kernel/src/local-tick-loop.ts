export interface LocalTickLoopOptions {
  readonly tick: () => Promise<void>;
  readonly intervalMs?: number;
  readonly runImmediately?: boolean;
  readonly onError?: (error: unknown) => void;
}

export interface LocalTickLoop {
  stop(): void;
}

export function startLocalTickLoop(
  options: LocalTickLoopOptions,
): LocalTickLoop {
  let running = false;
  let stopped = false;

  const run = async () => {
    if (running || stopped) {
      return;
    }

    running = true;
    try {
      await options.tick();
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, options.intervalMs ?? 30_000);
  timer.unref();

  if (options.runImmediately ?? true) {
    void run();
  }

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
