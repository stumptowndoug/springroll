// The model a run actually used (what agentd recorded for its thread, not what the job asked for), by its
// agent's own name for it ("Opus 5.5"). A command job is a script: no model, unless its job.json names one
// it calls itself (mail-triage). Names come from the agent's options, fetched once per agent.
import { api, state } from './api.js';

const opts = new Map(); // agent id -> options | Promise
export function modelLabel(t, onLoad) {
  if (!t) return '';
  if (!t.agent || t.agent === 'shell') {
    const job = t.origin?.startsWith('job:') && state.jobs.find((j) => j.name === t.origin.slice(4));
    return job?.model ? `Script · ${job.model}` : 'Script';
  }
  if (!t.model) return '';
  const id = String(t.model), plain = id.replace(/\[.*\]$/, ''); // cursor: grok-4.7[context=…]
  let o = opts.get(t.agent);
  if (!o) opts.set(t.agent, o = api.get(`api/agent/agents/${t.agent}/options`).catch(() => ({ models: [] })).then((r) => { opts.set(t.agent, r); onLoad?.(); }));
  const list = o instanceof Promise ? null : o.models;
  return list?.find((m) => m.id === id || m.id === plain)?.name || plain;
}
