/** Minimal glob: `*` matches any run of characters, case-insensitive. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchesAny(name: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(name));
}

/**
 * Irreversible actions (PRD rule 4). The chaos proxy never injects faults on these, marks them
 * destructiveHint, and `monk setup` expands them to exact names for TrueForge's
 * requireApprovalForTools (which has no globs).
 */
export const DESTRUCTIVE_TOOL_GLOBS = [
  '*delete*',
  '*remove*',
  '*force*',
  '*merge*',
  '*publish*',
  // Creating or editing a release; reading one (list_releases, get_latest_release) is harmless.
  '*create_release*',
  '*update_release*',
  '*uninstall*',
  '*factory_reset*',
  '*clear_app_data*',
  '*close_issue*',
  '*send*',
  '*pay*',
] as const;

export function destructiveToolNames(all: readonly string[], extra: readonly string[] = []): string[] {
  const globs = [...DESTRUCTIVE_TOOL_GLOBS, ...extra];
  return all.filter((n) => matchesAny(n, globs));
}

/** Upstream MCP servers behind the chaos proxy. Tool names are re-exposed unchanged. */
export const CHAOS_PROXY_SERVER_NAME = 'monk-chaos';

/** Normalizes an error message to a stable class (http_429, rate_limit, not_found, …). */
export function errorClass(message: string): string {
  const m = message.toLowerCase();
  const code = /\b([45]\d\d)\b/.exec(m);
  if (code) return `http_${code[1]}`;
  const keywords: [RegExp, string][] = [
    [/rate.?limit|too many requests/, 'rate_limit'],
    [/time(d)?.?out/, 'timeout'],
    [/not found|no such|does not exist/, 'not_found'],
    [/permission|forbidden|unauthori[sz]ed|access denied/, 'permission'],
    [/required|missing/, 'missing_param'],
    [/invalid|validation|unprocessable|malformed|must be/, 'invalid_input'],
    [/conflict|already exists/, 'conflict'],
  ];
  for (const [re, cls] of keywords) if (re.test(m)) return cls;
  return m.replace(/"[^"]*"|'[^']*'/g, 'x').replace(/\d+/g, '#').replace(/[^a-z#x ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join('_') || 'error';
}
