// Tool-category taxonomy + selection knob.
//
// MCP clients (Claude, Cline, etc.) pay a context-window cost for every tool
// listed in tools/list — bigger inventory = more tokens spent on the system
// prompt before the model can do useful work. By default GhostPilot exposes
// every tool; operators who only need a subset can opt in to specific
// categories via the `GHOSTPILOT_TOOLS` env var.
//
// Selection happens once at startup; there's no hot-reload. Restart the
// MCP server to apply a new value.
//
// Examples:
//   GHOSTPILOT_TOOLS=core                 → nav + tabs + interact + inspect
//   GHOSTPILOT_TOOLS=nav,interact         → just those two
//   GHOSTPILOT_TOOLS="NAV, Interact"      → case-insensitive + whitespace ok
//   GHOSTPILOT_TOOLS=all,-ytdlp,-media    → everything except ytdlp & media
//   GHOSTPILOT_TOOLS=                     → behaves like unset (= all)
//
// The `lifecycle` category (stop / check_for_updates / tool_categories) is
// always enabled — operators need it to introspect and shut down the server.

export type ToolCategory =
  | 'nav'
  | 'tabs'
  | 'interact'
  | 'inspect'
  | 'network'
  | 'console'
  | 'performance'
  | 'media'
  | 'ytdlp'
  | 'downloads'
  | 'history'
  | 'bookmarks'
  | 'emulate'
  | 'profiles'
  | 'skills'
  | 'cdp'
  | 'lifecycle';

export const ALL_CATEGORIES: readonly ToolCategory[] = [
  'nav',
  'tabs',
  'interact',
  'inspect',
  'network',
  'console',
  'performance',
  'media',
  'ytdlp',
  'downloads',
  'history',
  'bookmarks',
  'emulate',
  'profiles',
  'skills',
  'cdp',
  'lifecycle',
] as const;

const VALID = new Set<ToolCategory>(ALL_CATEGORIES);

/** Shorthand bundle for "Mint's default profile" — the 4 categories every
 *  scraping/automation workload tends to need. Matches plan §3. */
export const CORE_CATEGORIES: readonly ToolCategory[] = [
  'nav',
  'tabs',
  'interact',
  'inspect',
] as const;

/** Always-on; can't be filtered out via env var. */
export const ALWAYS_ON: readonly ToolCategory[] = ['lifecycle'] as const;

type WarnFn = (msg: string) => void;

/**
 * Resolve `GHOSTPILOT_TOOLS` env value to a concrete enabled-category set.
 *
 * Rules (kept tight enough that the 8 unit cases in plan §7.1 cover the
 * whole grammar):
 *   - undefined / empty / whitespace-only → every category.
 *   - `all` → every category (any extras layered on top).
 *   - `core` → CORE_CATEGORIES (any extras layered on top).
 *   - bare token → add that category (case-insensitive, whitespace trimmed).
 *   - `-token` → subtract that category from the running set.
 *   - unknown token → warn (via injected `warn` fn) and ignore.
 *
 * The `lifecycle` group is unioned in unconditionally on return — operators
 * can't accidentally lock themselves out of the introspection / stop tools.
 */
export function parseEnabledCategories(
  envValue: string | undefined,
  warn: WarnFn = (m) => console.warn(`[ghostpilot] ${m}`),
): Set<ToolCategory> {
  // Unset / empty → all categories. Treat as "no filter".
  if (envValue === undefined || envValue.trim() === '') {
    return new Set<ToolCategory>(ALL_CATEGORIES);
  }

  const tokens = envValue
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  const enabled = new Set<ToolCategory>();

  for (const raw of tokens) {
    const subtract = raw.startsWith('-');
    const name = subtract ? raw.slice(1).trim() : raw;

    if (name === 'all') {
      if (subtract) {
        // `-all` is nonsensical but harmless — interpret as "drop everything"
        // (the lifecycle union below will still bring it back).
        enabled.clear();
      } else {
        for (const c of ALL_CATEGORIES) enabled.add(c);
      }
      continue;
    }

    if (name === 'core') {
      if (subtract) {
        for (const c of CORE_CATEGORIES) enabled.delete(c);
      } else {
        for (const c of CORE_CATEGORIES) enabled.add(c);
      }
      continue;
    }

    if (!VALID.has(name as ToolCategory)) {
      warn(`unknown tool category '${name}' in GHOSTPILOT_TOOLS — ignored`);
      continue;
    }

    if (subtract) {
      enabled.delete(name as ToolCategory);
    } else {
      enabled.add(name as ToolCategory);
    }
  }

  // lifecycle is always on regardless of what the operator typed.
  for (const c of ALWAYS_ON) enabled.add(c);

  return enabled;
}

/**
 * For the startup log + the `tool_categories` introspection tool.
 * Returns categories in a stable (taxonomy-declaration) order so logs/tests
 * are deterministic.
 */
export function sortCategories(set: Set<ToolCategory>): ToolCategory[] {
  return ALL_CATEGORIES.filter((c) => set.has(c));
}
