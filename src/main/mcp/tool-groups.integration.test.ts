// Static-analysis smoke test for plan §7.2.
//
// The "real" integration test would boot the electron app with various
// GHOSTPILOT_TOOLS values and call tools/list — but doing that requires
// killing the live GhostPilot instance, which we explicitly can't do. So
// instead we parse tools.ts source, build a per-category histogram of the
// `tool('cat', () => ...)` call sites, and verify that parseEnabledCategories
// + the registration loop together produce the same counts the plan promises.
//
// If this test fails after a real run, the discrepancy is most likely a
// new tool added without a category — fix the source, not this test.
//
// Run: node --experimental-strip-types --test src/main/mcp/tool-groups.integration.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ALL_CATEGORIES,
  parseEnabledCategories,
  type ToolCategory,
} from './tool-groups.ts';

const here = dirname(fileURLToPath(import.meta.url));
const toolsSrc = readFileSync(join(here, 'tools.ts'), 'utf8');

// Match every `tool('cat', () =>` opener and tally per category.
function buildHistogram(): Record<string, number> {
  const re = /^\s*tool\('([a-z]+)', \(\) =>/gm;
  const histo: Record<string, number> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(toolsSrc)) !== null) {
    const cat = m[1];
    histo[cat] = (histo[cat] ?? 0) + 1;
  }
  return histo;
}

function expectedEnabled(env: string | undefined): number {
  const enabled = parseEnabledCategories(env, () => {});
  const histo = buildHistogram();
  let n = 0;
  for (const cat of enabled) n += histo[cat] ?? 0;
  return n;
}

test('histogram covers every category the source uses', () => {
  const histo = buildHistogram();
  const seen = new Set(Object.keys(histo));
  for (const cat of seen) {
    assert.ok(
      (ALL_CATEGORIES as readonly string[]).includes(cat),
      `tools.ts uses category '${cat}' which isn't in ALL_CATEGORIES`,
    );
  }
});

test('total tool count matches plan §3 (~57 + 1 introspection + 1 desktop)', () => {
  const histo = buildHistogram();
  const total = Object.values(histo).reduce((a, b) => a + b, 0);
  // 57 pre-existing tools + tool_categories (lifecycle) + desktop_screenshot = 59.
  assert.equal(total, 59, `expected 59 total tool registrations, got ${total}`);
});

test('per-category counts match plan §3', () => {
  const histo = buildHistogram();
  const expected: Record<ToolCategory, number> = {
    nav: 4,
    tabs: 4,
    interact: 7,
    inspect: 7, // 6 + a11y_snapshot
    network: 2,
    console: 2,
    performance: 3,
    media: 3,
    ytdlp: 3,
    downloads: 4,
    history: 3,
    bookmarks: 4,
    emulate: 3,
    profiles: 1,
    skills: 4,
    cdp: 1,
    desktop: 1, // desktop_screenshot — added 2026-05-17
    lifecycle: 3, // stop + check_for_updates + tool_categories
  };
  for (const [cat, want] of Object.entries(expected)) {
    assert.equal(
      histo[cat] ?? 0,
      want,
      `category '${cat}' has ${histo[cat] ?? 0} tools, plan §3 says ${want}`,
    );
  }
});

// §7.2 expected-count matrix.
test('§7.2 row 1: unset → all 59 tools', () => {
  assert.equal(expectedEnabled(undefined), 59);
});

test("§7.2 row 2: 'all' → all 59 tools", () => {
  assert.equal(expectedEnabled('all'), 59);
});

test("§7.2 row 3: 'core' → 22 (nav+tabs+interact+inspect) + 3 lifecycle = 25", () => {
  // Plan §3 says core = 22 tools. With lifecycle always on (+3), that's 25.
  assert.equal(expectedEnabled('core'), 25);
});

test("§7.2 row 4: 'nav,interact' → 4 + 7 + 3 lifecycle = 14", () => {
  // Plan §7.2 said 11; that figure was estimated assuming lifecycle wasn't
  // double-counted. With our 3-tool lifecycle (incl. new tool_categories) it's
  // 4 + 7 + 3 = 14.
  assert.equal(expectedEnabled('nav,interact'), 14);
});

test("§7.2 row 5: 'nav,interact,network,-network' → 4 + 7 + 3 lifecycle = 14", () => {
  assert.equal(expectedEnabled('nav,interact,network,-network'), 14);
});

test("§7.2 row 6: 'nonsense' → lifecycle only (3)", () => {
  assert.equal(expectedEnabled('nonsense'), 3);
});
