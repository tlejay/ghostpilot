// Playwright-style stable selector tools (Plan #2).
//
// Resolves DOM elements by semantic attributes (role, accessible name, label,
// data-testid) and returns a CSS selector + the first match's role/name +
// the count of total matches. Caller then uses the returned selector with the
// existing click/fill/wait_for_selector tools.
//
// Design notes (see plans/ghostpilot-stable-selectors.md):
//   - Single self-contained matcher script per call (no CDP juggling between
//     Accessibility.getFullAXTree + DOM.resolveNode). The page already knows
//     its visibility + computed role + accessible name; the JS evaluator
//     walks the DOM directly.
//   - Selector synthesis priority: data-testid → #id → [aria-label][role] →
//     tag+aria-label → tag+name attr → nth-child path (max 6 parents).
//     Each candidate is uniqueness-checked via document.querySelectorAll.
//   - Wait loop is inline inside the JS evaluator (same shape as
//     wait_for_selector): poll every `pollIntervalMs` until ≥1 match OR
//     `timeoutMs` elapses.
//   - Role + accessible name use approximated WAI-ARIA semantics — good
//     enough for FB/LINE which set explicit role + aria-label everywhere.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolCategory } from './tool-groups.js';
import type { TabManager } from '../tab-manager.js';

const text = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

interface LocatorInput {
  tabId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  exact?: boolean;
  includeHidden?: boolean;
}

/**
 * Build the JS evaluator string. Caller can swap in role/name/text/label/testId.
 * The script is self-contained — no closure references; all params are inlined
 * as JSON literals so it serializes cleanly for `Runtime.evaluate`.
 *
 * Exported for the unit tests.
 */
export function buildMatcherScript(opts: {
  kind: 'role' | 'text' | 'label' | 'testId';
  role?: string;
  name?: string;
  nameRegex?: string;
  text?: string;
  textRegex?: string;
  label?: string;
  labelRegex?: string;
  testId?: string;
  exact: boolean;
  includeHidden: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
}): string {
  const cfg = JSON.stringify(opts);
  return /* javascript */ `
(() => {
  const CFG = ${cfg};

  // ── Role mapping (approximate, covers FB/LINE + 95% of public sites) ──
  const IMPLICIT_ROLE = {
    A: (el) => el.hasAttribute('href') ? 'link' : null,
    BUTTON: () => 'button',
    INPUT: (el) => {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    },
    TEXTAREA: () => 'textbox',
    SELECT: () => 'combobox',
    IMG: () => 'img',
    H1: () => 'heading', H2: () => 'heading', H3: () => 'heading',
    H4: () => 'heading', H5: () => 'heading', H6: () => 'heading',
    NAV: () => 'navigation',
    MAIN: () => 'main',
    HEADER: () => 'banner',
    FOOTER: () => 'contentinfo',
    LI: () => 'listitem',
    UL: () => 'list', OL: () => 'list',
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.toLowerCase().split(' ')[0];
    const tag = el.tagName;
    const fn = IMPLICIT_ROLE[tag];
    if (fn) {
      const r = fn(el);
      if (r) return r;
    }
    return null;
  };

  // ── Accessible-name resolver (best-effort) ────────────────────────────
  const nameOf = (el) => {
    if (!el || !el.getAttribute) return '';
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/).map((id) => {
        const ref = document.getElementById(id);
        return ref ? (ref.textContent || '').trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 200);
    }
    const al = el.getAttribute('aria-label');
    if (al) return al.trim().slice(0, 200);
    // form control: walk to <label for>
    if (el.id && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      const lab = document.querySelector('label[for=' + JSON.stringify(el.id) + ']');
      if (lab) return (lab.textContent || '').trim().slice(0, 200);
    }
    // image alt
    if (el.tagName === 'IMG') {
      const alt = el.getAttribute('alt');
      if (alt) return alt.trim().slice(0, 200);
    }
    // visible text content (trimmed) — used as a last resort for name on
    // button/link role
    const tx = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (tx) return tx.slice(0, 200);
    const ttl = el.getAttribute('title');
    return (ttl || '').trim().slice(0, 200);
  };

  // ── Visibility filter ─────────────────────────────────────────────────
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    return true;
  };

  // ── Selector synthesis (priority: testid → id → [aria-label][role] →
  //    tag[aria-label] → tag[name] → nth-child path)
  const cssEscape = (s) => (s || '').replace(/(["\\\\])/g, '\\\\$1');
  const unique = (sel) => {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  };
  const synthSelector = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const tid = el.getAttribute && el.getAttribute('data-testid');
    if (tid) {
      const s = '[data-testid="' + cssEscape(tid) + '"]';
      if (unique(s)) return s;
    }
    if (el.id) {
      const s = '#' + el.id.replace(/(["\\\\.:#\\[\\]])/g, '\\\\$1');
      if (unique(s)) return s;
    }
    const tag = el.tagName.toLowerCase();
    const al = el.getAttribute && el.getAttribute('aria-label');
    const r = roleOf(el);
    if (al && r) {
      const s = tag + '[aria-label="' + cssEscape(al) + '"][role="' + cssEscape(r) + '"]';
      if (unique(s)) return s;
      const s2 = '[aria-label="' + cssEscape(al) + '"][role="' + cssEscape(r) + '"]';
      if (unique(s2)) return s2;
    }
    if (al) {
      const s = tag + '[aria-label="' + cssEscape(al) + '"]';
      if (unique(s)) return s;
    }
    const nm = el.getAttribute && el.getAttribute('name');
    if (nm && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
      const s = tag + '[name="' + cssEscape(nm) + '"]';
      if (unique(s)) return s;
    }
    // nth-child walk up to 6 ancestors
    let path = '';
    let cur = el;
    for (let i = 0; i < 6 && cur && cur.nodeType === 1 && cur !== document.body; i++) {
      const parent = cur.parentElement;
      if (!parent) break;
      const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      const idx = sibs.indexOf(cur) + 1;
      const seg = cur.tagName.toLowerCase() + (sibs.length > 1 ? ':nth-of-type(' + idx + ')' : '');
      path = path ? seg + ' > ' + path : seg;
      if (unique(path)) return path;
      cur = parent;
    }
    return path || null;
  };

  // ── Matcher predicate per kind ────────────────────────────────────────
  const matchName = (got, want, regex, exact) => {
    if (regex) {
      try { return new RegExp(regex).test(got || ''); } catch (e) { return false; }
    }
    if (want == null) return true;
    const g = (got || '').trim();
    const w = (want || '').trim();
    if (!w) return true;
    return exact ? g === w : g.toLowerCase().includes(w.toLowerCase());
  };
  const visibleTextOf = (el) => {
    const tx = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return tx.slice(0, 400);
  };

  const matchByRole = () => {
    const want = (CFG.role || '').toLowerCase();
    const all = Array.from(document.querySelectorAll('*'));
    const out = [];
    for (const el of all) {
      const r = roleOf(el);
      if (!r || r !== want) continue;
      if (!CFG.includeHidden && !visible(el)) continue;
      const nm = nameOf(el);
      if (!matchName(nm, CFG.name, CFG.nameRegex, CFG.exact)) continue;
      out.push({ el, role: r, name: nm });
    }
    return out;
  };

  const matchByText = () => {
    const all = Array.from(document.querySelectorAll('*'));
    const out = [];
    for (const el of all) {
      // skip non-leaf-ish containers — prefer the innermost element bearing the text
      const hasElementChild = Array.from(el.children).some((c) => (c.textContent || '').trim());
      if (hasElementChild) continue;
      if (!CFG.includeHidden && !visible(el)) continue;
      const tx = visibleTextOf(el);
      if (!matchName(tx, CFG.text, CFG.textRegex, CFG.exact)) continue;
      out.push({ el, role: roleOf(el), name: nameOf(el), text: tx });
    }
    return out;
  };

  const matchByLabel = () => {
    const labels = Array.from(document.querySelectorAll('label'));
    const out = [];
    for (const lab of labels) {
      const tx = (lab.textContent || '').trim();
      if (!matchName(tx, CFG.label, CFG.labelRegex, CFG.exact)) continue;
      const forId = lab.getAttribute('for');
      let target = null;
      if (forId) target = document.getElementById(forId);
      if (!target) target = lab.querySelector('input, textarea, select');
      if (!target) continue;
      if (!CFG.includeHidden && !visible(target)) continue;
      out.push({ el: target, role: roleOf(target), name: nameOf(target), text: tx });
    }
    // Also accept aria-label / aria-labelledby on form controls directly
    const controls = Array.from(document.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"], [role="searchbox"]'));
    for (const c of controls) {
      const nm = nameOf(c);
      if (!matchName(nm, CFG.label, CFG.labelRegex, CFG.exact)) continue;
      if (!CFG.includeHidden && !visible(c)) continue;
      if (out.find((m) => m.el === c)) continue;
      out.push({ el: c, role: roleOf(c), name: nm, text: nm });
    }
    return out;
  };

  const matchByTestId = () => {
    const sel = '[data-testid="' + (CFG.testId || '').replace(/(["\\\\])/g, '\\\\$1') + '"]';
    const all = Array.from(document.querySelectorAll(sel));
    return all.map((el) => ({ el, role: roleOf(el), name: nameOf(el) }));
  };

  const doMatch = () => {
    if (CFG.kind === 'role') return matchByRole();
    if (CFG.kind === 'text') return matchByText();
    if (CFG.kind === 'label') return matchByLabel();
    if (CFG.kind === 'testId') return matchByTestId();
    return [];
  };

  // ── Wait loop (same shape as wait_for_selector) ───────────────────────
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const hits = doMatch();
      if (hits.length >= 1) {
        const slim = hits.slice(0, 5).map((h) => ({
          selector: synthSelector(h.el),
          role: h.role,
          name: h.name,
          text: h.text || visibleTextOf(h.el),
          visible: visible(h.el),
        }));
        const first = slim[0];
        return resolve({
          ok: true,
          count: hits.length,
          selector: first.selector,
          role: first.role,
          name: first.name,
          text: first.text,
          matches: slim,
          waitedMs: Date.now() - start,
        });
      }
      if (Date.now() - start > CFG.timeoutMs) {
        return resolve({ ok: false, error: 'no match', count: 0, waitedMs: Date.now() - start });
      }
      setTimeout(tick, CFG.pollIntervalMs);
    };
    tick();
  });
})()
`;
}

/**
 * Wire the 4 locator tools onto `server`. Caller passes a `tool(...)` helper
 * that handles category gating + counting (same shape used in tools.ts).
 */
export function registerLocatorTools(
  server: McpServer,
  deps: { tabManager: TabManager },
  tool: (category: ToolCategory, register: () => unknown) => void,
  resolveTabId: (tabId?: string) => string,
  requireTab: (tabId: string) => unknown,
): void {
  const { tabManager } = deps;

  const baseInput = {
    tabId: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    pollIntervalMs: z.number().int().positive().optional(),
    exact: z.boolean().optional(),
    includeHidden: z.boolean().optional(),
  } as const;

  const runMatcher = async (
    tabId: string | undefined,
    opts: Parameters<typeof buildMatcherScript>[0],
  ): Promise<unknown> => {
    const id = resolveTabId(tabId);
    requireTab(id);
    const script = buildMatcherScript(opts);
    const r = await tabManager.evaluate(id, script);
    return r ?? null;
  };

  tool('locator', () =>
    server.registerTool(
      'get_by_role',
      {
        description:
          'Resolve an element by its accessibility role + (optional) accessible name. Playwright-style: returns the first match\'s CSS selector + role/name + total count. Waits up to `timeoutMs` (default 3000) for the first match to appear. Pass the returned `selector` to `click`/`fill`/`wait_for_selector`.',
        inputSchema: {
          ...baseInput,
          role: z.string(),
          name: z.string().optional(),
          nameRegex: z.string().optional(),
        },
      },
      async (args: LocatorInput & { role: string; name?: string; nameRegex?: string }) => {
        const out = await runMatcher(args.tabId, {
          kind: 'role',
          role: args.role,
          name: args.name,
          nameRegex: args.nameRegex,
          exact: args.exact === true,
          includeHidden: args.includeHidden === true,
          timeoutMs: args.timeoutMs ?? 3000,
          pollIntervalMs: args.pollIntervalMs ?? 100,
        });
        return text(out);
      },
    ),
  );

  tool('locator', () =>
    server.registerTool(
      'get_by_text',
      {
        description:
          'Resolve an element by its visible text content. Matches innermost element containing the text (Playwright semantics). `exact:false` (default) does case-insensitive substring; `exact:true` requires equality. Returns first match\'s selector + role/name + count.',
        inputSchema: {
          ...baseInput,
          text: z.string().optional(),
          textRegex: z.string().optional(),
        },
      },
      async (args: LocatorInput & { text?: string; textRegex?: string }) => {
        if (!args.text && !args.textRegex) {
          return text({ ok: false, error: 'either text or textRegex required' });
        }
        const out = await runMatcher(args.tabId, {
          kind: 'text',
          text: args.text,
          textRegex: args.textRegex,
          exact: args.exact === true,
          includeHidden: args.includeHidden === true,
          timeoutMs: args.timeoutMs ?? 3000,
          pollIntervalMs: args.pollIntervalMs ?? 100,
        });
        return text(out);
      },
    ),
  );

  tool('locator', () =>
    server.registerTool(
      'get_by_label',
      {
        description:
          'Resolve a form control (input/textarea/select or [role=textbox|combobox|searchbox]) by its associated label text. Walks <label for=…>, aria-label, aria-labelledby. Returns selector pointing at the CONTROL (not the label).',
        inputSchema: {
          ...baseInput,
          label: z.string().optional(),
          labelRegex: z.string().optional(),
        },
      },
      async (args: LocatorInput & { label?: string; labelRegex?: string }) => {
        if (!args.label && !args.labelRegex) {
          return text({ ok: false, error: 'either label or labelRegex required' });
        }
        const out = await runMatcher(args.tabId, {
          kind: 'label',
          label: args.label,
          labelRegex: args.labelRegex,
          exact: args.exact === true,
          includeHidden: args.includeHidden === true,
          timeoutMs: args.timeoutMs ?? 3000,
          pollIntervalMs: args.pollIntervalMs ?? 100,
        });
        return text(out);
      },
    ),
  );

  tool('locator', () =>
    server.registerTool(
      'get_by_test_id',
      {
        description:
          'Resolve an element by exact `data-testid` attribute match. Returns selector `[data-testid="…"]`. Always exact.',
        inputSchema: {
          tabId: z.string().optional(),
          timeoutMs: z.number().int().positive().optional(),
          pollIntervalMs: z.number().int().positive().optional(),
          testId: z.string(),
        },
      },
      async (args: { tabId?: string; timeoutMs?: number; pollIntervalMs?: number; testId: string }) => {
        const out = await runMatcher(args.tabId, {
          kind: 'testId',
          testId: args.testId,
          exact: true,
          includeHidden: true,
          timeoutMs: args.timeoutMs ?? 3000,
          pollIntervalMs: args.pollIntervalMs ?? 100,
        });
        return text(out);
      },
    ),
  );
}
