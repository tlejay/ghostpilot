// Run with:  node --experimental-strip-types --test src/main/mcp/tool-groups.test.ts
// (Node 22.6+; works without external deps. The repo's playwright test runner
//  drives the built electron app, which isn't what we want for pure parser logic.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_CATEGORIES,
  CORE_CATEGORIES,
  parseEnabledCategories,
  sortCategories,
  type ToolCategory,
} from './tool-groups.ts';

// silencer: tests assert on `warned` rather than letting console.warn leak.
function makeWarn(): { warned: string[]; fn: (m: string) => void } {
  const warned: string[] = [];
  return { warned, fn: (m) => warned.push(m) };
}

function asArray(set: Set<ToolCategory>): ToolCategory[] {
  return sortCategories(set);
}

test('parseEnabledCategories(undefined) → all categories', () => {
  const w = makeWarn();
  const got = parseEnabledCategories(undefined, w.fn);
  assert.deepEqual(asArray(got), [...ALL_CATEGORIES]);
  assert.deepEqual(w.warned, []);
});

test('parseEnabledCategories("") → all categories (treated as unset)', () => {
  const w = makeWarn();
  const got = parseEnabledCategories('', w.fn);
  assert.deepEqual(asArray(got), [...ALL_CATEGORIES]);
  assert.deepEqual(w.warned, []);
});

test('parseEnabledCategories("nav,interact") → {nav, interact, lifecycle}', () => {
  const w = makeWarn();
  const got = parseEnabledCategories('nav,interact', w.fn);
  assert.deepEqual(asArray(got), ['nav', 'interact', 'lifecycle']);
  assert.deepEqual(w.warned, []);
});

test('parseEnabledCategories("NAV, Interact") → case + whitespace tolerant', () => {
  const w = makeWarn();
  const got = parseEnabledCategories('NAV, Interact', w.fn);
  assert.deepEqual(asArray(got), ['nav', 'interact', 'lifecycle']);
  assert.deepEqual(w.warned, []);
});

test('parseEnabledCategories("nope,nav") → {nav, lifecycle} + warn for nope', () => {
  const w = makeWarn();
  const got = parseEnabledCategories('nope,nav', w.fn);
  assert.deepEqual(asArray(got), ['nav', 'lifecycle']);
  assert.equal(w.warned.length, 1);
  assert.match(w.warned[0], /unknown tool category 'nope'/);
});

test('parseEnabledCategories("core") → CORE_CATEGORIES + lifecycle', () => {
  const w = makeWarn();
  const got = parseEnabledCategories('core', w.fn);
  assert.deepEqual(asArray(got), [...CORE_CATEGORIES, 'lifecycle']);
  assert.deepEqual(w.warned, []);
});

test('parseEnabledCategories("all,-ytdlp") → all minus ytdlp', () => {
  const w = makeWarn();
  const got = parseEnabledCategories('all,-ytdlp', w.fn);
  const expected = ALL_CATEGORIES.filter((c) => c !== 'ytdlp');
  assert.deepEqual(asArray(got), expected);
  assert.deepEqual(w.warned, []);
});

test('parseEnabledCategories("all,-bogus") → all (warn on bogus)', () => {
  const w = makeWarn();
  const got = parseEnabledCategories('all,-bogus', w.fn);
  assert.deepEqual(asArray(got), [...ALL_CATEGORIES]);
  assert.equal(w.warned.length, 1);
  assert.match(w.warned[0], /unknown tool category 'bogus'/);
});

// Bonus: subtract semantics over plain set (covers the integration row
// "nav,interact,network,-network" → 3 cats × ~tool count from plan §7.2).
test('parseEnabledCategories("nav,interact,network,-network") → drops network', () => {
  const got = parseEnabledCategories('nav,interact,network,-network');
  assert.deepEqual(asArray(got), ['nav', 'interact', 'lifecycle']);
});

// Bonus: lifecycle cannot be filtered out — even if the operator tries.
test('parseEnabledCategories("nav,-lifecycle") still keeps lifecycle on', () => {
  const got = parseEnabledCategories('nav,-lifecycle');
  assert.deepEqual(asArray(got), ['nav', 'lifecycle']);
});
