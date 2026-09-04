import { describe, expect, test } from "bun:test";
import {
  type IdleHandle,
  poolToolSourceSessions,
} from "../src/mcp-session-pool.ts";
import type {
  ToolSource,
  ToolSourceOpenOptions,
  ToolSourceSession,
} from "../src/tools.ts";

describe("MCP session pool", () => {
  test("reuses one live session across overlapping leases", async () => {
    const inner = countingSource();
    const source = poolToolSourceSessions(inner.source, { idleTimeoutMs: 0 });

    const first = await source.open(localOpen());
    const second = await source.open(localOpen());
    expect(inner.opens).toBe(1);
    await first.listTools();
    await second.callTool(
      "ping",
      {},
      {
        taskId: "task",
        runId: "run",
      },
    );
    await first.close();
    expect(inner.closes).toBe(0);
    await second.close();
    expect(inner.closes).toBe(1);
  });

  test("dedupes concurrent first opens for the same connection", async () => {
    const inner = countingSource();
    const source = poolToolSourceSessions(inner.source, { idleTimeoutMs: 0 });

    const [first, second] = await Promise.all([
      source.open(localOpen()),
      source.open(localOpen()),
    ]);
    expect(inner.opens).toBe(1);
    await first.close();
    await second.close();
    expect(inner.closes).toBe(1);
  });

  test("keeps the session warm until idle elapses", async () => {
    const inner = countingSource();
    const idle = fakeIdle();
    const source = poolToolSourceSessions(inner.source, {
      idleTimeoutMs: 1_000,
      scheduleIdle: idle.scheduleIdle,
      cancelIdle: idle.cancelIdle,
    });

    const first = await source.open(localOpen());
    await first.close();
    expect(inner.closes).toBe(0);

    const second = await source.open(localOpen());
    expect(inner.opens).toBe(1);
    await second.close();
    expect(inner.closes).toBe(0);

    idle.fireAll();
    await Promise.resolve();
    expect(inner.closes).toBe(1);

    const third = await source.open(localOpen());
    expect(inner.opens).toBe(2);
    await third.close();
  });

  test("replaces the session when the fingerprint changes", async () => {
    const inner = countingSource();
    let fingerprint = "a";
    const source = poolToolSourceSessions(inner.source, {
      idleTimeoutMs: 0,
      fingerprint: () => fingerprint,
    });

    const first = await source.open(localOpen());
    await first.close();
    fingerprint = "b";
    const second = await source.open(localOpen());
    expect(inner.opens).toBe(2);
    expect(inner.closes).toBe(1);
    await second.close();
  });

  test("dispose drops a warm session immediately", async () => {
    const inner = countingSource();
    const source = poolToolSourceSessions(inner.source, {
      idleTimeoutMs: 60_000,
      scheduleIdle: () => ({ unref() {} }),
      cancelIdle() {},
    });

    const session = await source.open(localOpen());
    await session.close();
    await source.dispose?.("connection-1");
    expect(inner.closes).toBe(1);
  });
});

function localOpen(): ToolSourceOpenOptions {
  return {
    connection: {
      id: "connection-1",
      sourceId: "mcp-local",
      credentialRef: "none",
      availableIn: ["local"],
    },
    location: "local",
  };
}

function countingSource() {
  let opens = 0;
  let closes = 0;
  const source: ToolSource = {
    id: "mcp-local",
    kind: "mcp",
    async open() {
      opens += 1;
      const session: ToolSourceSession = {
        async listTools() {
          return [
            {
              name: "ping",
              description: "Ping",
              inputSchema: {},
            },
          ];
        },
        async callTool() {
          return { content: ["ok"] };
        },
        async close() {
          closes += 1;
        },
      };
      return session;
    },
  };
  return {
    source,
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
  };
}

function fakeIdle() {
  const timers: IdleHandle[] = [];
  return {
    scheduleIdle(callback: () => void): IdleHandle {
      const handle: IdleHandle & { readonly fire: () => void } = {
        fire: callback,
      };
      timers.push(handle);
      return handle;
    },
    cancelIdle(handle: IdleHandle) {
      const index = timers.indexOf(handle);
      if (index >= 0) timers.splice(index, 1);
    },
    fireAll() {
      for (const handle of timers.splice(0)) {
        (handle as IdleHandle & { fire(): void }).fire();
      }
    },
  };
}
