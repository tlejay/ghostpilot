// Unit tests for Plan #4 — headless mode.
//
// Pure-function permutations of isHeadless() + a couple of source-shape
// assertions that the two GUI-bound tool handlers (desktop_screenshot,
// set_window_bounds) actually contain the headless guard. The live behavior
// (no visible window, 71 tools, guarded error responses) is covered by the
// Phase 3 smoke test against the running app.
//
// Run: node --experimental-strip-types --test tests/unit/headless.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isHeadless } from '../../src/main/headless.ts';

const SRC_ROOT = join(import.meta.dirname, '..', '..', 'src', 'main');

test('isHeadless: no flag, no env → false', () => {
  assert.equal(isHeadless([], {}), false);
});

test('isHeadless: --headless flag → true', () => {
  assert.equal(isHeadless(['--headless'], {}), true);
});

test('isHeadless: GHOSTPILOT_HEADLESS=1 env → true', () => {
  assert.equal(isHeadless([], { GHOSTPILOT_HEADLESS: '1' }), true);
});

test('isHeadless: GHOSTPILOT_HEADLESS=0 env → false', () => {
  assert.equal(isHeadless([], { GHOSTPILOT_HEADLESS: '0' }), false);
});

test('isHeadless: GHOSTPILOT_HEADLESS=true env → false (only "1" counts)', () => {
  assert.equal(isHeadless([], { GHOSTPILOT_HEADLESS: 'true' }), false);
});

test('isHeadless: --headless wins over GHOSTPILOT_HEADLESS=0', () => {
  assert.equal(isHeadless(['--headless'], { GHOSTPILOT_HEADLESS: '0' }), true);
});

test('isHeadless: unrelated argv flags → false', () => {
  assert.equal(isHeadless(['--something-else', '--verbose'], {}), false);
});

// ── Source-shape assertions on the two GUI-bound tool handlers ─────────────
// These guard against accidental removal of the headless early-return; they
// don't replace the Phase 3 live smoke but flag regressions quickly.

test('tools.ts: desktop_screenshot handler short-circuits on headless', () => {
  const src = readFileSync(join(SRC_ROOT, 'mcp', 'tools.ts'), 'utf8');
  // Locate the desktop_screenshot registration and its handler body.
  const start = src.indexOf("'desktop_screenshot'");
  assert.ok(start > 0, 'desktop_screenshot registration must be present');
  // Window the next ~80 lines — far enough to span the handler.
  const window = src.slice(start, start + 4000);
  assert.ok(
    /if\s*\(\s*headless\s*\)/.test(window),
    'desktop_screenshot handler must guard on `headless`',
  );
});

test('tools.ts: set_window_bounds handler short-circuits on headless', () => {
  const src = readFileSync(join(SRC_ROOT, 'mcp', 'tools.ts'), 'utf8');
  const start = src.indexOf("'set_window_bounds'");
  assert.ok(start > 0, 'set_window_bounds registration must be present');
  const window = src.slice(start, start + 4000);
  assert.ok(
    /if\s*\(\s*headless\s*\)/.test(window),
    'set_window_bounds handler must guard on `headless`',
  );
});
