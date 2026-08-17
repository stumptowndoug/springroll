import type {
  ToolSource,
  ToolSourceOpenOptions,
  ToolSourceSession,
} from "./tools.ts";

/** OpenClaw uses 10 minutes for MCP; Hermes browser idles at 2. Chrome attach is privileged, so stay in the middle. */
export const DEFAULT_MCP_SESSION_IDLE_MS = 5 * 60 * 1000;

export interface IdleHandle {
  unref?(): void;
}

export interface McpSessionPoolOptions {
  readonly idleTimeoutMs?: number;
  readonly fingerprint?: (
    options: ToolSourceOpenOptions,
  ) => Promise<string> | string;
  readonly scheduleIdle?: (callback: () => void, ms: number) => IdleHandle;
  readonly cancelIdle?: (handle: IdleHandle) => void;
}

interface PooledEntry {
  fingerprint: string;
  session: ToolSourceSession;
  leases: number;
  queue: Promise<void>;
  idle: IdleHandle | undefined;
}

/**
 * Reuse one ToolSource session per connection until the last borrower
 * releases it and the idle window elapses. Chat hops and recipe runs share
 * the same live stdio/HTTP client instead of connecting per call.
 */
export function poolToolSourceSessions(
  source: ToolSource,
  options: McpSessionPoolOptions = {},
): ToolSource {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_MCP_SESSION_IDLE_MS;
  const fingerprintOf =
    options.fingerprint ??
    ((openOptions: ToolSourceOpenOptions) => openOptions.connection.id);
  const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle;
  const cancelIdle = options.cancelIdle ?? defaultCancelIdle;
  const pool = new Map<string, PooledEntry>();
  const locks = new Map<string, Promise<void>>();

  const pooled: ToolSource = {
    id: source.id,
    kind: source.kind,
    async open(openOptions) {
      const key = poolKey(openOptions);
      const fingerprint = await fingerprintOf(openOptions);
      return withKeyLock(key, async () => {
        const existing = pool.get(key);
        if (existing && existing.fingerprint !== fingerprint) {
          pool.delete(key);
          await disposeEntry(existing);
        }

        let entry = pool.get(key);
        if (!entry || entry.fingerprint !== fingerprint) {
          entry = {
            fingerprint,
            session: await source.open(openOptions),
            leases: 0,
            queue: Promise.resolve(),
            idle: undefined,
          };
          pool.set(key, entry);
        }
        entry.leases += 1;
        if (entry.idle) {
          cancelIdle(entry.idle);
          entry.idle = undefined;
        }
        return leaseSession(entry, key);
      });
    },
    async dispose(connectionId) {
      const keys = [...pool.keys()].filter((key) =>
        connectionId ? key.endsWith(`:${connectionId}`) : true,
      );
      await Promise.all(
        keys.map((key) =>
          withKeyLock(key, async () => {
            const entry = pool.get(key);
            if (!entry) return;
            pool.delete(key);
            await disposeEntry(entry);
          }),
        ),
      );
      await source.dispose?.(connectionId);
    },
  };

  function withKeyLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  function leaseSession(entry: PooledEntry, key: string): ToolSourceSession {
    let closed = false;
    return {
      listTools: () => enqueue(entry, () => entry.session.listTools()),
      callTool: (name, input, context) =>
        enqueue(entry, () => entry.session.callTool(name, input, context)),
      async close() {
        if (closed) return;
        closed = true;
        entry.leases = Math.max(0, entry.leases - 1);
        if (entry.leases > 0 || pool.get(key) !== entry) return;
        if (idleTimeoutMs <= 0) {
          pool.delete(key);
          await disposeEntry(entry);
          return;
        }
        entry.idle = scheduleIdle(() => {
          if (pool.get(key) !== entry || entry.leases > 0) return;
          pool.delete(key);
          void disposeEntry(entry);
        }, idleTimeoutMs);
      },
    };
  }

  async function disposeEntry(entry: PooledEntry): Promise<void> {
    if (entry.idle) {
      cancelIdle(entry.idle);
      entry.idle = undefined;
    }
    entry.leases = 0;
    await entry.session.close().catch(() => undefined);
  }

  return pooled;
}

function poolKey(options: ToolSourceOpenOptions): string {
  return `${options.location}:${options.connection.id}`;
}

function enqueue<T>(entry: PooledEntry, work: () => Promise<T>): Promise<T> {
  const run = entry.queue.then(work, work);
  entry.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function defaultScheduleIdle(callback: () => void, ms: number): IdleHandle {
  const timer = setTimeout(callback, ms);
  timer.unref?.();
  return timer;
}

function defaultCancelIdle(handle: IdleHandle): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
