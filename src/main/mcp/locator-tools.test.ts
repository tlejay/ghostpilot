// Unit tests for the locator-tools matcher-script builder (Plan #2).
//
// We can't run the matcher script in a real DOM here — that's what the
// integration smoke covers post-deploy. What we CAN verify cheaply is:
//   - the builder always returns a valid JS Promise-returning expression
//   - per-kind params land in the inlined CFG blob
//   - regexp escapes don't break the script
//
// Run: node --experimental-strip-types --test src/main/mcp/locator-tools.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMatcherScript } from './locator-tools.ts';

function extractCfg(script: string): Record<string, unknown> {
  // The first `const CFG = {...};` is what we inlined.
  const m = script.match(/const CFG = (\{[\s\S]*?\});/);
  assert.ok(m, 'matcher script must contain a CFG literal');
  return JSON.parse(m![1]);
}

test('buildMatcherScript(role) inlines role + name + flags', () => {
  const s = buildMatcherScript({
    kind: 'role',
    role: 'button',
    name: 'Post',
    exact: false,
    includeHidden: false,
    timeoutMs: 3000,
    pollIntervalMs: 100,
  });
  const cfg = extractCfg(s);
  assert.equal(cfg.kind, 'role');
  assert.equal(cfg.role, 'button');
  assert.equal(cfg.name, 'Post');
  assert.equal(cfg.exact, false);
  assert.equal(cfg.timeoutMs, 3000);
  // Sanity: the script must wrap in a Promise so tabManager.evaluate awaits it.
  assert.ok(s.includes('return new Promise'), 'script must return a Promise');
  // Sanity: must include the matcher-by-kind dispatch.
  assert.ok(s.includes('matchByRole'), 'script must reference matchByRole()');
});

test('buildMatcherScript(text) inlines text + exact flag', () => {
  const s = buildMatcherScript({
    kind: 'text',
    text: 'โพสต์',
    exact: true,
    includeHidden: false,
    timeoutMs: 5000,
    pollIntervalMs: 200,
  });
  const cfg = extractCfg(s);
  assert.equal(cfg.kind, 'text');
  assert.equal(cfg.text, 'โพสต์');
  assert.equal(cfg.exact, true);
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(cfg.pollIntervalMs, 200);
});

test('buildMatcherScript(label) inlines label + carries through regex variant', () => {
  const sExact = buildMatcherScript({
    kind: 'label',
    label: 'Email',
    exact: false,
    includeHidden: false,
    timeoutMs: 3000,
    pollIntervalMs: 100,
  });
  assert.equal(extractCfg(sExact).label, 'Email');

  const sRegex = buildMatcherScript({
    kind: 'label',
    labelRegex: '^E?mail',
    exact: false,
    includeHidden: false,
    timeoutMs: 3000,
    pollIntervalMs: 100,
  });
  assert.equal(extractCfg(sRegex).labelRegex, '^E?mail');
});

test('buildMatcherScript(testId) inlines testId + uses exact match', () => {
  const s = buildMatcherScript({
    kind: 'testId',
    testId: 'login-btn',
    exact: true,
    includeHidden: true,
    timeoutMs: 3000,
    pollIntervalMs: 100,
  });
  const cfg = extractCfg(s);
  assert.equal(cfg.kind, 'testId');
  assert.equal(cfg.testId, 'login-btn');
  assert.equal(cfg.includeHidden, true);
});

test('buildMatcherScript escapes special chars in name (quote+backslash safe)', () => {
  const tricky = `weird "name" with \\ backslash`;
  const s = buildMatcherScript({
    kind: 'role',
    role: 'button',
    name: tricky,
    exact: false,
    includeHidden: false,
    timeoutMs: 1000,
    pollIntervalMs: 100,
  });
  // JSON.stringify handled the escaping for us — when re-parsed, equals original.
  const cfg = extractCfg(s);
  assert.equal(cfg.name, tricky);
});

test('buildMatcherScript produces a finite script with no obvious template holes', () => {
  const s = buildMatcherScript({
    kind: 'role',
    role: 'button',
    exact: false,
    includeHidden: false,
    timeoutMs: 3000,
    pollIntervalMs: 100,
  });
  // No unfilled ${...} placeholders should remain (the only ${...} we keep is
  // INSIDE the JS evaluator, embedded in string literals — those don't break
  // the script even if present; here we just check the script isn't malformed
  // by an outer-template typo).
  assert.ok(s.length > 1000, 'matcher script should be >1 KB');
  assert.ok(!s.includes('CFG.${'), 'no double-template artefacts');
});
