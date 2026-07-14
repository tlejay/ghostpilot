// Drift detection for Plan #14 — every tool registered in tools.ts +
// locator-tools.ts MUST appear in types/ghostpilot-tools.d.ts as an
// Input interface AND in the GhostPilotToolName union.
//
// Static parse only — does NOT re-run the generator (which would need
// Electron). A full re-gen-and-diff is deferred to CI (Plan #12).
//
// Run: node --experimental-strip-types --test tests/unit/dts-drift.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const DTS_PATH = join(REPO_ROOT, 'types', 'ghostpilot-tools.d.ts');
const SRC_FILES = ['src/main/mcp/tools.ts', 'src/main/mcp/locator-tools.ts'];

function readSrc(): string {
  return SRC_FILES.map((f) => readFileSync(join(REPO_ROOT, f), 'utf8')).join('\n');
}

function readDts(): string {
  return readFileSync(DTS_PATH, 'utf8');
}

function extractToolNames(src: string): Set<string> {
  // Match the second-string arg of `server.registerTool('name', …)`.
  const names = new Set<string>();
  const re = /registerTool\(\s*'([a-z0-9_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1]!);
  return names;
}

function toPascalCase(snake: string): string {
  return snake
    .split(/[_-]/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join('');
}

test('types/ghostpilot-tools.d.ts exists (drift check requires it)', () => {
  assert.ok(
    existsSync(DTS_PATH),
    'types/ghostpilot-tools.d.ts is missing — run `pnpm gen:types`',
  );
});

test('every tool registered in source has an Input interface in the .d.ts', () => {
  const sourceNames = extractToolNames(readSrc());
  const dts = readDts();
  const missing: string[] = [];
  for (const name of sourceNames) {
    const pascal = toPascalCase(name);
    const inputRe = new RegExp(
      `export\\s+(?:interface|type)\\s+${pascal}Input\\b`,
    );
    if (!inputRe.test(dts)) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `tools missing Input type in .d.ts (run \`pnpm gen:types\`): ${missing.join(', ')}`,
  );
});

test('every tool registered in source appears in GhostPilotToolName', () => {
  const sourceNames = extractToolNames(readSrc());
  const dts = readDts();
  const missing: string[] = [];
  for (const name of sourceNames) {
    if (!dts.includes(`'${name}'`)) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `tools missing from GhostPilotToolName (run \`pnpm gen:types\`): ${missing.join(', ')}`,
  );
});

test('tool count in .d.ts banner matches source-parsed count', () => {
  const sourceCount = extractToolNames(readSrc()).size;
  const dts = readDts();
  const m = /Tools captured: (\d+)/.exec(dts);
  assert.ok(m, "expected banner '// Tools captured: N' in .d.ts");
  assert.equal(
    Number(m![1]),
    sourceCount,
    `.d.ts banner says ${m![1]} tools, source has ${sourceCount} — run \`pnpm gen:types\``,
  );
});
