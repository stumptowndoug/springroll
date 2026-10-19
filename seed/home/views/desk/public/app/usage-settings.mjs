// Shared by Settings, the settings API and the sidebar.
export const USAGE_OPTIONS = [
  { key: 'claude', label: 'Claude', detail: 'Your Claude plan', agent: 'claude', enabled: true },
  { key: 'codex', label: 'Codex', detail: 'Your ChatGPT plan', agent: 'codex', enabled: true },
  { key: 'antigravityGemini', label: 'Antigravity', detail: 'Gemini quotas', agent: 'antigravity', enabled: true },
  { key: 'antigravityThirdParty', label: 'Antigravity · Claude/GPT', detail: 'Additional model quotas', agent: 'antigravity', enabled: false },
  { key: 'cursor', label: 'Cursor', detail: 'Your Cursor plan', agent: 'cursor', enabled: true },
  { key: 'cursorPools', label: 'Cursor · Auto/API', detail: 'Auto and API shares of the plan', agent: 'cursor', enabled: false },
];

export function usageSettings(value) {
  return Object.fromEntries(USAGE_OPTIONS.map(o => [o.key, typeof value?.[o.key] === 'boolean' ? value[o.key] : o.enabled]));
}

export function patchUsageSettings(current, patch) {
  const result = usageSettings(current);
  for (const { key } of USAGE_OPTIONS) if (typeof patch?.[key] === 'boolean') result[key] = patch[key];
  return result;
}

export function visibleUsage(providers, preferences) {
  const settings = usageSettings(preferences);
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
