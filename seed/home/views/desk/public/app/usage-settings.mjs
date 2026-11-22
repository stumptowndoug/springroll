// Shared by Settings, the settings API and the sidebar.
export const USAGE_OPTIONS = [
  { key: 'claude', label: 'Claude', detail: 'Your Claude plan', agent: 'claude', enabled: true },
  { key: 'codex', label: 'Codex', detail: 'Your ChatGPT plan', agent: 'codex', enabled: true },
  { key: 'antigravityGemini', label: 'Antigravity', detail: 'Gemini quotas', agent: 'antigravity', enabled: true },
  { key: 'antigravityThirdParty', label: 'Antigravity · Claude/GPT', detail: 'Additional model quotas', agent: 'antigravity', enabled: false },
  { key: 'cursor', label: 'Cursor', detail: 'Your Cursor plan', agent: 'cursor', enabled: true },
  { key: 'cursorPools', label: 'Cursor · Auto/API', detail: 'Auto and API shares of the plan', agent: 'cursor', enabled: false },
];

export const USAGE_SHOW_VALUES = ['all', 'tightest', 'warn', 'off'];
export const USAGE_SYSTEM_VALUES = ['always', 'warn', 'off'];

export function usageSettings(value) {
  const out = Object.fromEntries(USAGE_OPTIONS.map(o => [o.key, typeof value?.[o.key] === 'boolean' ? value[o.key] : o.enabled]));
  out.show = USAGE_SHOW_VALUES.includes(value?.show) ? value.show : 'all';
  out.system = USAGE_SYSTEM_VALUES.includes(value?.system) ? value.system : 'always';
  return out;
}

export function patchUsageSettings(current, patch) {
  const result = usageSettings(current);
  for (const { key } of USAGE_OPTIONS) if (typeof patch?.[key] === 'boolean') result[key] = patch[key];
  if (USAGE_SHOW_VALUES.includes(patch?.show)) result.show = patch.show;
  if (USAGE_SYSTEM_VALUES.includes(patch?.system)) result.system = patch.system;
  return result;
}

export function visibleUsage(providers, preferences) {
  const settings = usageSettings(preferences);
  if (settings.show === 'off') return [];
  return providers.flatMap(a => {
    if (a.id === 'claude' || a.id === 'codex') return settings[a.id] ? [a] : [];
    if (a.id === 'cursor') {
      if (!settings.cursor && !settings.cursorPools) return [];
      if (!a.windows.length) return [a];
      const windows = a.windows.filter(w => w.key === 'billing' ? settings.cursor : settings.cursorPools);
      return windows.length ? [{ ...a, windows }] : [];
    }
    if (a.id !== 'antigravity' || (!settings.antigravityGemini && !settings.antigravityThirdParty)) return [];
    if (!a.windows.length) return [a]; // Keep an unavailable status for a selected provider.
    const windows = a.windows.filter(w =>
      (settings.antigravityGemini && ['gemini-weekly', 'gemini-5h'].includes(w.key))
      || (settings.antigravityThirdParty && ['3p-weekly', '3p-5h'].includes(w.key)));
    return windows.length ? [{ ...a, windows }] : [];
  });
}
