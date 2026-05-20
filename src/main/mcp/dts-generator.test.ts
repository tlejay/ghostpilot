// Unit tests for Plan #14 — Zod → TS walker + .d.ts generator.
//
// Run: node --experimental-strip-types --test src/main/mcp/dts-generator.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  generateDts,
  toPascalCase,
  zodToTs,
  type CapturedTool,
} from './dts-generator.ts';

// ── Walker ────────────────────────────────────────────────────────────

test('zodToTs: z.string() → string', () => {
  assert.equal(zodToTs(z.string() as never).ts, 'string');
});

test('zodToTs: z.string().optional() → string, optional bubbles up', () => {
  const f = zodToTs(z.string().optional() as never);
  assert.equal(f.ts, 'string');
  assert.equal(f.optional, true);
});

test('zodToTs: z.number() → number', () => {
  assert.equal(zodToTs(z.number() as never).ts, 'number');
});

test('zodToTs: z.boolean() → boolean', () => {
  assert.equal(zodToTs(z.boolean() as never).ts, 'boolean');
});

test('zodToTs: z.array(z.string()) → string[]', () => {
  assert.equal(zodToTs(z.array(z.string()) as never).ts, 'string[]');
});

test('zodToTs: z.enum(["a","b"]) → "a" | "b"', () => {
  assert.equal(zodToTs(z.enum(['a', 'b']) as never).ts, '"a" | "b"');
});

test('zodToTs: z.union([z.string(), z.number()]) → string | number', () => {
  const f = zodToTs(z.union([z.string(), z.number()]) as never);
  assert.equal(f.ts, 'string | number');
});

test('zodToTs: z.record(z.string()) → Record<string, string>', () => {
  assert.equal(zodToTs(z.record(z.string()) as never).ts, 'Record<string, string>');
});

test('zodToTs: z.unknown() → unknown', () => {
  assert.equal(zodToTs(z.unknown() as never).ts, 'unknown');
});

test('zodToTs: z.array(z.union([z.string(), z.number()])) → (string | number)[] (parens added)', () => {
  const f = zodToTs(z.array(z.union([z.string(), z.number()])) as never);
  assert.equal(f.ts, '(string | number)[]');
});

// ── Generator ─────────────────────────────────────────────────────────

test('generateDts: empty shape → Record<string, never>', () => {
  const tools: CapturedTool[] = [
    { name: 'noop', description: 'Does nothing.', inputSchema: {}, category: 'lifecycle' },
  ];
  const { text } = generateDts(tools, { version: '0.7.0', toolCount: 1 });
  assert.match(text, /export type NoopInput = Record<string, never>;/);
});

test('generateDts: mixed required + optional → correct ?: placement', () => {
  const tools: CapturedTool[] = [
    {
      name: 'navigate',
      description: 'Open a URL.',
      inputSchema: { url: z.string() as never, tabId: z.string().optional() as never },
      category: 'nav',
    },
  ];
  const { text } = generateDts(tools, { version: '0.7.0', toolCount: 1 });
  // `url: string` (no ?), `tabId?: string` (with ?)
  assert.match(text, /url: string/);
  assert.match(text, /tabId\?: string/);
});

test('generateDts: JSDoc carries the tool description (and escapes */)', () => {
  const tools: CapturedTool[] = [
    {
      name: 'tricky',
      description: 'Body has a */ inside a comment — should be sanitized.',
      inputSchema: {},
      category: 'cdp',
    },
  ];
  const { text } = generateDts(tools, { version: '0.7.0', toolCount: 1 });
  assert.ok(!text.includes('*/ inside'), 'unescaped */ would close the JSDoc block early');
  assert.match(text, /\* \/ inside/);
});

test('generateDts: PascalCase conversion (list_chrome_profiles → ListChromeProfilesInput)', () => {
  assert.equal(toPascalCase('list_chrome_profiles'), 'ListChromeProfiles');
  assert.equal(toPascalCase('a'), 'A');
  assert.equal(toPascalCase('snake_case-mix_things'), 'SnakeCaseMixThings');
});

test('generateDts: GhostPilotToolName + ToolCall + ToolMap include every tool, sorted', () => {
  const tools: CapturedTool[] = [
    { name: 'zeta', description: 'Z.', inputSchema: {}, category: 'cdp' },
    { name: 'alpha', description: 'A.', inputSchema: {}, category: 'cdp' },
    { name: 'mid', description: 'M.', inputSchema: {}, category: 'nav' },
  ];
  const { text } = generateDts(tools, { version: '0.7.0', toolCount: 3 });

  // Sort order: alpha < mid < zeta
  const nameUnion = text.match(/export type GhostPilotToolName =\n([\s\S]+?);/);
  assert.ok(nameUnion);
  const block = nameUnion![1];
  const idxAlpha = block.indexOf("'alpha'");
  const idxMid = block.indexOf("'mid'");
  const idxZeta = block.indexOf("'zeta'");
  assert.ok(idxAlpha < idxMid && idxMid < idxZeta, 'names must be sorted');

  // GhostPilotToolCall has one arm per tool
  assert.match(text, /\{ name: 'alpha'; arguments: AlphaInput \}/);
  assert.match(text, /\{ name: 'mid'; arguments: MidInput \}/);
  assert.match(text, /\{ name: 'zeta'; arguments: ZetaInput \}/);

  // ToolMap has every name
  assert.match(text, /alpha: \{ input: AlphaInput; output: AlphaOutput \};/);
  assert.match(text, /mid: \{ input: MidInput; output: MidOutput \};/);
  assert.match(text, /zeta: \{ input: ZetaInput; output: ZetaOutput \};/);

  // Category map (Q3)
  assert.match(text, /export type GhostPilotToolCategory =/);
  assert.match(text, /alpha: 'cdp',/);
  assert.match(text, /mid: 'nav',/);
});
