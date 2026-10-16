// What a chat has going on besides its current answer, all from what its agent said over ACP: background
// tasks the adapter reported (Claude's and Codex's asyncTasks: a backgrounded command, from start to its
// end), timers it scheduled (Claude Code's CronCreate) and delegated agents still at work. Nothing is
// guessed from processes: an agent that doesn't report its background work (Cursor, OpenCode, Pi) is told
// to work in the foreground instead. The chat view shows these above the composer.

const toolName = (d) => d.tool || d.title || '';
const toolText = (d) => (d.content || []).map((c) => c.content?.text || '').join('\n');

// A Monitor (Claude Code's watcher) runs until its own deadline at most: timeout_ms, capped at 30 minutes.
const MONITOR_MS = 5 * 60 * 1000, MONITOR_MAX_MS = 30 * 60 * 1000;

export function background({ live, items }) {
  const out = [];
  for (const t of items) {
    if (t.kind !== 'task' || t.state !== 'running') continue;
    out.push({ kind: 'task', id: t.taskId, since: t.created, label: t.description || t.name || 'Background command',
      detail: (t.name || '').slice(0, 600), stoppable: t.canStop !== false });
  }
  // Timers live inside the agent's session: only the current session's, minus cancelled ones.
  if (live?.started) {
    const tools = items.filter((i) => i.kind === 'tool');
    const cancelled = new Set(tools.filter((t) => toolName(t) === 'CronDelete' && t.status === 'completed').map((t) => t.rawInput?.id));
    for (const t of tools) {
      if (toolName(t) !== 'CronCreate' || t.status !== 'completed' || (t.created || 0) < live.started) continue;
      const id = /job (\w+)/.exec(toolText(t))?.[1];
      if (!id || cancelled.has(id)) continue;
      const prompt = String(t.rawInput?.prompt || '').replace(/\s+/g, ' ').trim();
      out.push({ kind: 'timer', id, since: t.created, schedule: t.rawInput?.cron || '', once: t.rawInput?.recurring === false,
        label: prompt.slice(0, 120) || 'Scheduled check', detail: prompt.slice(0, 600), stoppable: false });
    }
  }
  for (const a of items) {
    if (a.kind === 'agent' && a.state === 'running') out.push({ kind: 'agent', id: a.sessionId, since: a.created, label: a.name || 'Subagent', detail: (a.task || '').slice(0, 600), stoppable: false });
  }
  return out.sort((a, b) => a.since - b.since);
}

// Whether a Monitor this session started may still be watching. Adapters don't report Monitors (their
// output goes to the model only), so it isn't shown; it only keeps a job run's agent alive until its deadline.
export function watching({ live, items, now = Date.now() }) {
  if (!live?.started) return false;
  return items.some((t) => t.kind === 'tool' && toolName(t) === 'Monitor' && t.status !== 'failed' && (t.created || 0) >= live.started
    && t.created + Math.min(Number(t.rawInput?.timeout_ms) || MONITOR_MS, MONITOR_MAX_MS) > now);
}
