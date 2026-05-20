// Plan #14 — Zod schema → TypeScript .d.ts generator for the MCP tool registry.
//
// Pure functions only (no Electron / no filesystem at the entry point). The
// caller (`src/main/index.ts --gen-types`) feeds in an array of captured tool
// registrations and writes the returned string to disk.
//
// Self-contained (zero cross-file runtime imports) so the
// `--experimental-strip-types` Node test runner can load it without resolving
// sibling `.js` paths.

// We use `unknown` + structural duck-typing on Zod's `_def.typeName` strings.
// Avoids importing zod values at module-init time (the test runner already
// pulls the real Zod transitively, but the walker tolerates schema-shaped
// plain objects for unit tests too).
type ZodLike = {
  _def?: { typeName?: string; [k: string]: unknown };
  shape?: Record<string, ZodLike> | (() => Record<string, ZodLike>);
};

export type ZodRawShape = Record<string, ZodLike>;

export interface CapturedTool {
  name: string;
  description: string;
  inputSchema: ZodRawShape; // tools.ts always passes a raw shape object
  category?: string;
}

export interface GenerateOpts {
  /** Package version baked into the banner. */
  version: string;
  /** Total tool count baked into the banner (sanity check for readers). */
  toolCount: number;
}

interface FieldShape {
  ts: string;
  optional: boolean;
  doc?: string;
}

// ── Zod walker ────────────────────────────────────────────────────────

function defOf(z: ZodLike): { typeName?: string; [k: string]: unknown } {
  return (z?._def ?? {}) as { typeName?: string };
}

function jsonLiteral(value: unknown): string {
  // Inline a JS literal as a TS type. Strings get quoted; primitives stay
  // bare; everything else stringifies safely.
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value);
}

export function zodToTs(schema: ZodLike): FieldShape {
  const def = defOf(schema);
  const typeName = def.typeName as string | undefined;

  switch (typeName) {
    case 'ZodString':
      return { ts: 'string', optional: false };
    case 'ZodNumber':
      return { ts: 'number', optional: false };
    case 'ZodBoolean':
      return { ts: 'boolean', optional: false };
    case 'ZodUnknown':
    case 'ZodAny':
      return { ts: 'unknown', optional: false };
    case 'ZodNull':
      return { ts: 'null', optional: false };
    case 'ZodUndefined':
      return { ts: 'undefined', optional: false };
    case 'ZodLiteral': {
      const value = (def as { value: unknown }).value;
      return { ts: jsonLiteral(value), optional: false };
    }
    case 'ZodEnum': {
      const values = (def as { values: string[] }).values;
      const ts = values.map((v) => jsonLiteral(v)).join(' | ');
      return { ts: ts || 'never', optional: false };
    }
    case 'ZodArray': {
      const inner = (def as { type: ZodLike }).type;
      const innerShape = zodToTs(inner);
      // Wrap unions/intersections in parens before [] to keep precedence right.
      const needsParens = /[|&]/.test(innerShape.ts);
      const innerTs = needsParens ? `(${innerShape.ts})` : innerShape.ts;
      return { ts: `${innerTs}[]`, optional: false };
    }
    case 'ZodRecord': {
      const valueDef = (def as { valueType: ZodLike }).valueType;
      const valueShape = zodToTs(valueDef);
      const keyDef = (def as { keyType?: ZodLike }).keyType;
      const keyShape = keyDef ? zodToTs(keyDef) : { ts: 'string', optional: false };
      return {
        ts: `Record<${keyShape.ts}, ${valueShape.ts}>`,
        optional: false,
      };
    }
    case 'ZodUnion': {
      const options = (def as { options: ZodLike[] }).options;
      const ts = options.map((o) => zodToTs(o).ts).join(' | ');
      return { ts: ts || 'unknown', optional: false };
    }
    case 'ZodObject': {
      const shape = resolveShape(schema);
      return { ts: shapeToInline(shape), optional: false };
    }
    case 'ZodOptional': {
      const inner = (def as { innerType: ZodLike }).innerType;
      const innerShape = zodToTs(inner);
      return { ts: innerShape.ts, optional: true };
    }
    case 'ZodNullable': {
      const inner = (def as { innerType: ZodLike }).innerType;
      const innerShape = zodToTs(inner);
      return { ts: `${innerShape.ts} | null`, optional: innerShape.optional };
    }
    case 'ZodDefault':
    case 'ZodCatch': {
      const inner = (def as { innerType: ZodLike }).innerType;
      const innerShape = zodToTs(inner);
      return { ts: innerShape.ts, optional: true };
    }
    case undefined: {
      // Bare plain-object inputSchema (raw shape) — caller passed a shape, not
      // a z.object(). Treat as inline object.
      if (schema && typeof schema === 'object' && !('_def' in schema)) {
        return { ts: shapeToInline(schema as unknown as ZodRawShape), optional: false };
      }
      return { ts: 'unknown', optional: false };
    }
    default:
      // Unknown Zod kind — emit `unknown` and warn (caller can log).
      console.warn(`[dts-generator] unknown Zod type: "${typeName}" → emitting 'unknown'`);
      return { ts: 'unknown', optional: false };
  }
}

function resolveShape(schema: ZodLike): ZodRawShape {
  const s = schema.shape;
  if (typeof s === 'function') return s();
  if (s && typeof s === 'object') return s;
  return {};
}

function shapeToInline(shape: ZodRawShape): string {
  const fields = Object.entries(shape);
  if (fields.length === 0) return '{}';
  const parts = fields.map(([k, v]) => {
    const f = zodToTs(v);
    return `${escapeKey(k)}${f.optional ? '?' : ''}: ${f.ts}`;
  });
  return `{ ${parts.join('; ')} }`;
}

function escapeKey(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
}

// ── Naming helpers ───────────────────────────────────────────────────

export function toPascalCase(snake: string): string {
  return snake
    .split(/[_-]/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join('');
}

// ── JSDoc emission ───────────────────────────────────────────────────

function jsdoc(description: string, indent = ''): string {
  if (!description) return '';
  // Sanitize `*/` inside descriptions (would close the JSDoc block early).
  const safe = description.replace(/\*\//g, '* /');
  const lines = safe.split('\n');
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  const inner = lines.map((l) => `${indent} * ${l}`).join('\n');
  return `${indent}/**\n${inner}\n${indent} */\n`;
}

// ── Top-level emitter ────────────────────────────────────────────────

export interface GenerateResult {
  text: string;
  warnings: string[];
}

export function generateDts(
  rawTools: CapturedTool[],
  opts: GenerateOpts,
): GenerateResult {
  // Sort by tool name for deterministic output.
  const tools = [...rawTools].sort((a, b) => a.name.localeCompare(b.name));
  const warnings: string[] = [];
  const lines: string[] = [];

  // Banner
  lines.push('// AUTO-GENERATED — do not edit by hand. Regenerate with `pnpm gen:types`.');
  lines.push('// Source: src/main/mcp/tools.ts + src/main/mcp/locator-tools.ts');
  lines.push(`// GhostPilot version: ${opts.version}`);
  lines.push(`// Tools captured: ${opts.toolCount}`);
  lines.push('');

  // Per-tool Input + Output interfaces
  for (const t of tools) {
    const pascal = toPascalCase(t.name);
    const inputShape: ZodRawShape = t.inputSchema ?? {};
    const inline = shapeToInline(inputShape);
    lines.push(jsdoc(t.description).trimEnd());
    if (inline === '{}') {
      lines.push(`export type ${pascal}Input = Record<string, never>;`);
    } else {
      // Render as `export interface` only when shape is a flat object (no
      // wrapping types). Always-object since inputSchema is a ZodRawShape.
      lines.push(`export interface ${pascal}Input ${inline.replace(/; /g, '; ')}`);
    }
    lines.push(`export type ${pascal}Output = unknown;`);
    lines.push('');
  }

  // Name literal union
  lines.push('/** Every MCP tool name GhostPilot exposes. Sorted. */');
  const names = tools.map((t) => `'${t.name}'`);
  if (names.length === 0) {
    lines.push('export type GhostPilotToolName = never;');
  } else {
    lines.push('export type GhostPilotToolName =');
    names.forEach((n, i) => {
      const sep = i === names.length - 1 ? ';' : '';
      lines.push(`  | ${n}${sep}`);
    });
  }
  lines.push('');

  // Category map (Q3 — yes, include category)
  const withCat = tools.filter((t) => t.category);
  if (withCat.length > 0) {
    const cats = Array.from(new Set(withCat.map((t) => t.category!))).sort();
    lines.push('/** Tool category taxonomy. */');
    lines.push('export type GhostPilotToolCategory =');
    cats.forEach((c, i) => {
      const sep = i === cats.length - 1 ? ';' : '';
      lines.push(`  | '${c}'${sep}`);
    });
    lines.push('');
    lines.push('/** Map of tool name → category. */');
    lines.push('export const TOOL_CATEGORY: { readonly [K in GhostPilotToolName]: GhostPilotToolCategory } = {');
    for (const t of tools) {
      lines.push(`  ${t.name}: '${t.category ?? 'unknown'}',`);
    }
    lines.push('} as const;');
    lines.push('');
  }

  // Discriminated union of tool calls
  lines.push('/** Discriminated union of every MCP `tools/call` payload. */');
  lines.push('export type GhostPilotToolCall =');
  tools.forEach((t, i) => {
    const pascal = toPascalCase(t.name);
    const sep = i === tools.length - 1 ? ';' : '';
    lines.push(`  | { name: '${t.name}'; arguments: ${pascal}Input }${sep}`);
  });
  lines.push('');

  // Per-name input/output map
  lines.push('/** Lookup map: tool name → { input, output } types. */');
  lines.push('export interface GhostPilotToolMap {');
  for (const t of tools) {
    const pascal = toPascalCase(t.name);
    lines.push(`  ${t.name}: { input: ${pascal}Input; output: ${pascal}Output };`);
  }
  lines.push('}');

  // Final newline
  lines.push('');

  return { text: lines.join('\n'), warnings };
}
