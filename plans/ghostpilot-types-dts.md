# GhostPilot Plan #14 — Auto-generated `.d.ts` for the MCP tool registry

> Status: 🟡 **plan ready for sign-off** · 2026-05-20 by Techoe (delegated by Mint, task `msg-8bd951` from issue #4)
> Roadmap parent: `GhostPilot-Plan.md` §Polish → #14
> Repo target: `tlejay/ghostpilot` (working branch: `main` — additive surface)
> Prior plans: #1, #2, #3, #4, #5, #6, #11 (all shipped)

## 1. Goal

Ship a committed, versioned `.d.ts` that declares every MCP tool GhostPilot
exposes — tool name, description, input shape, and a discriminated-union call
type — so:

1. **TypeScript callers** (Mint's own scripts, custom MCP SDK wrappers, future
   `ghostpilot-client` packages) get IDE autocomplete and compile-time
   checks on `tools/call` payloads.
2. **The type surface is locked in** as a tracked artifact. PRs that add /
   rename / change a tool's schema must regenerate the file, making schema
   drift visible in code review.
3. **Documentation site** (and the existing README `Featured tools` section)
   can excerpt directly from the generated types instead of hand-syncing.

The single deliverable: `dist/ghostpilot-tools.d.ts`, ~76 named types + a
discriminated-union `GhostPilotToolCall` + a `GhostPilotToolName` literal
union. Auto-rebuilt by `pnpm gen:types`. Plus a unit test that catches
drift (the committed file must match what the generator currently emits).

## 2. Why — concrete pain points

- After Plan #5 the tool surface jumped 71 → 76. Any consumer hand-writing
  TS types against `tools/call` has to track the delta manually. With a
  generated `.d.ts`, the delta is `git diff dist/ghostpilot-tools.d.ts`.
- Mint's `inbox-send` / `delegate.py` already speak MCP via raw JSON; if
  they grow a TS-first MCP wrapper, that wrapper wants types.
- Future consumers (the `mint-assistant` Next.js site, the Discord plugin,
  any third-party MCP client) benefit from a single source of truth.
- The existing `tool_categories` MCP tool already introspects categories;
  this plan does the schema-level equivalent at build time.

## 3. Non-goals (v1)

- ❌ **ไม่** generate output types for tool *responses*. Today's tools return
  `text(value)` where `value` is unconstrained — adding response schemas
  is a separate, bigger refactor. v1 emits `output: unknown` for every tool.
- ❌ **ไม่** publish a separate npm package (`@madebytle/ghostpilot-types`).
  The `.d.ts` lives in this repo at `dist/ghostpilot-tools.d.ts`; consumers
  copy or fetch it directly. npm publish is a follow-up.
- ❌ **ไม่** support multi-target output (CommonJS vs ESM `.d.ts` flavors).
  Single ESM-compatible file, ambient declarations.
- ❌ **ไม่** rewrite tools.ts to extract schemas into a separate module
  (would be a big diff). v1 uses Electron's own runtime to introspect.
- ❌ **ไม่** add a runtime "schema export" MCP tool. The generator is a
  build-time artifact, not a tool surface.
- ❌ **ไม่** wire up CI (drift check runs as a *local* unit test in v1;
  Plan #12 will add the matrix later).

## 4. Design

### 4.1 Generator entry point — `--gen-types` flag on the Electron binary

The MCP tool registrations live inside `src/main/mcp/tools.ts`, which imports
runtime values from `electron` (`app`, `desktopCapturer`, `screen`,
`systemPreferences`). Running the generator outside Electron would fail to
resolve those imports. Two clean options were considered:

| Option | Pro | Con | Chosen? |
|---|---|---|---|
| A. Refactor schemas into a side-effect-free `tool-schemas.ts` module | Generator is plain Node | Touches 76 call sites; high churn | ❌ |
| B. Add `--gen-types <out>` early-exit branch to `src/main/index.ts` | Reuses existing module graph; minimal diff | Requires Electron binary to generate (already true for `pnpm dist`) | ✅ |
| C. Mock the `electron` module via Node loader hooks | Avoids Electron entirely | Loader-hook plumbing is fragile across Node versions | ❌ |

When `--gen-types <path>` is in `process.argv`:

1. `src/main/index.ts` skips the whenReady → createMainWindow → tabManager
   path (same gate as Plan #4 headless, but more aggressive — no window at
   all, no IPC, no port binding).
2. Calls `registerTools(stubServer, stubDeps)` against a fake `McpServer`
   that captures `{ name, description, inputSchema }` for every
   `server.registerTool(...)` call.
3. Pipes the captured map into `src/main/mcp/dts-generator.ts` (new),
   which walks Zod shapes → emits `.d.ts` text → writes to `<path>`.
4. Calls `app.exit(0)`.

The `app.exit(0)` keeps the script CI-friendly — no hung Electron processes.

### 4.2 npm script

```jsonc
"gen:types": "pnpm build && electron out/main/index.js --gen-types dist/ghostpilot-tools.d.ts"
```

Build step (`pnpm build` → `electron-vite build`) produces `out/main/index.js`
from the TS source; the second step runs Electron pointing at that file with
the flag. Both steps are idempotent and ~5–10 s on a warm cache.

### 4.3 Output shape (`dist/ghostpilot-tools.d.ts`)

```ts
// AUTO-GENERATED — do not edit by hand. Regenerate with `pnpm gen:types`.
// Source: src/main/mcp/tools.ts + src/main/mcp/locator-tools.ts
// GhostPilot version: 0.7.0
// Tools captured: 76

/** Navigate the active (or `tabId`) tab to `url`. Returns `{ ok, tabId }`. */
export interface NavigateInput {
  url: string;
  tabId?: string;
}
export type NavigateOutput = unknown;

// … one block per tool …

export type GhostPilotToolName =
  | 'list_tabs'
  | 'new_tab'
  | 'navigate'
  // … 73 more …
  ;

export type GhostPilotToolCall =
  | { name: 'navigate'; arguments: NavigateInput }
  | { name: 'new_tab'; arguments: NewTabInput }
  // … one per tool …
  ;

export interface GhostPilotToolMap {
  navigate: { input: NavigateInput; output: NavigateOutput };
  new_tab: { input: NewTabInput; output: NewTabOutput };
  // … one per tool …
}
```

JSDoc on each interface comes from the tool's `description` field. Optional
fields use `?:` syntax; required fields use plain `:`. Tools with empty
input schemas emit `{}` (TypeScript's open-ended empty object).

### 4.4 Zod → TS walker

A small pure-function walker in `src/main/mcp/dts-generator.ts`:

| Zod | TS |
|---|---|
| `z.string()` | `string` |
| `z.number()` | `number` |
| `z.boolean()` | `boolean` |
| `z.unknown()` | `unknown` |
| `z.array(T)` | `T[]` |
| `z.enum([a, b])` | `'a' \| 'b'` |
| `z.union([T1, T2])` | `T1 \| T2` |
| `z.record(T)` | `Record<string, T>` |
| `z.literal(v)` | `'v'` / `42` / `true` |
| `z.object({ … })` | nested interface inlined |
| `z.optional(T)` | propagates to field `?:` |
| `z.nullable(T)` | `T \| null` |
| Anything else | `unknown` + warning |

We do **not** pull in `zod-to-ts` as a dev dependency — the walker is ~80
lines and lock-in on a small library surface is a feature, not a missing
bell-and-whistle. Tools.ts uses exactly the subset above (verified via
`grep -oE 'z\.[a-zA-Z]+\('` — see §10).

### 4.5 Drift detection (unit test)

`tests/unit/dts-drift.test.ts`:

1. Read `dist/ghostpilot-tools.d.ts` text.
2. Parse the source `tools.ts` + `locator-tools.ts` for the static set of
   `server.registerTool('NAME', …)` call sites — same regex the existing
   `tool-groups.integration.test.ts` uses.
3. For every tool name found in source, assert it appears in the .d.ts
   as `export interface <Pascal>Input` AND in `GhostPilotToolName`.
4. Assert tool count in the .d.ts matches source count.

This is a *fast* drift check — doesn't re-run the generator (which would
need Electron). A separate `pnpm gen:types` validates the generator itself.
The unit test catches the common case: "developer added a tool but forgot
to regenerate."

A future CI step (Plan #12, deferred) will also run the full generator and
diff its output against the committed file.

### 4.6 README + docs

Short subsection under "Tool surface":

> **TypeScript users:** every tool's input shape is declared in
> [`dist/ghostpilot-tools.d.ts`](./dist/ghostpilot-tools.d.ts), auto-generated
> from the MCP registry. Copy the file into your project, or import directly
> with `import type { NavigateInput, GhostPilotToolCall } from 'ghostpilot/dist/ghostpilot-tools.d.ts'`.
> Regenerate with `pnpm gen:types` after changing any tool schema.

## 5. Impl outline

| File | Change |
|---|---|
| `src/main/mcp/dts-generator.ts` (new) | Pure `generateDts(registrations, opts): string` + Zod walker. No electron deps. |
| `src/main/mcp/dts-generator.test.ts` (new) | Walker unit tests (every Zod kind in §4.4 + edge cases). |
| `src/main/index.ts` | `--gen-types <path>` branch resolved before `whenReady`. Skips `createMainWindow` + IPC + MCP boot. Boots a stub registry, calls `registerTools` against capture-server, emits .d.ts, `app.exit(0)`. |
| `src/main/mcp/tools.ts` | None. (The registration path stays identical; the capture-server is a stand-in for the real McpServer.) |
| `src/main/mcp/stub-deps.ts` (new) | Bag of stub `ToolDeps` objects sufficient for module-init (no handlers will be called — registration is metadata-only). |
| `tests/unit/dts-drift.test.ts` (new) | Drift detection (per §4.5). |
| `dist/ghostpilot-tools.d.ts` (new, committed) | First generated artifact. |
| `package.json` | New `gen:types` script. Add `dist/ghostpilot-tools.d.ts` to `files` (npm-publish hygiene; later). |
| `README.md` | "TypeScript users" subsection under Tool surface. |
| `CHANGELOG.md` | One `[Unreleased]` block. |

## 6. Backward compatibility

- New artifact under `dist/` — no existing path touched.
- New CLI flag is a no-op unless `--gen-types <path>` is passed.
- No MCP tool surface change. Tool count stays **76**.
- `tool-groups.integration.test.ts` total stays 76.

## 7. Test plan

### 7.1 Unit (`dts-generator.test.ts`)

1. `z.string()` → `string`
2. `z.string().optional()` → optional flag bubbles up to field
3. `z.number()` → `number`
4. `z.boolean()` → `boolean`
5. `z.array(z.string())` → `string[]`
6. `z.enum(['a','b'])` → `'a' \| 'b'`
7. `z.union([z.string(), z.number()])` → `string \| number`
8. `z.record(z.string())` → `Record<string, string>`
9. `z.unknown()` → `unknown`
10. Empty shape `{}` → `{}`
11. Mixed required + optional → correct `?:` placement
12. JSDoc carries the tool's description (no escaping bugs on `*/`)
13. PascalCase conversion: `list_chrome_profiles` → `ListChromeProfilesInput`
14. `GhostPilotToolName` is the sorted union of all names
15. `GhostPilotToolCall` discriminated union has one arm per tool

### 7.2 Drift test (`dts-drift.test.ts`)

1. Every tool registered in `tools.ts` + `locator-tools.ts` appears in
   `dist/ghostpilot-tools.d.ts` as an `Input` interface.
2. Every name appears in `GhostPilotToolName` union.
3. Tool count in .d.ts matches the buildHistogram count (76).
4. .d.ts file is well-formed TS (parsed via `ts.createSourceFile` if available;
   otherwise just a syntax-validity smoke via `tsc --noEmit --allowJs --target
   esnext` on the file).

### 7.3 Integration (live)

After `pnpm gen:types`:

- File exists at `dist/ghostpilot-tools.d.ts`.
- File starts with the auto-gen banner.
- `wc -l` is sane (~200-500 lines for 76 tools).
- `pnpm typecheck` continues to pass (the generated file is included via
  the existing `tsconfig.node.json` files glob if needed — verify).

### 7.4 UAT (Mint-side, post-deploy)

- Run `pnpm gen:types` on a fresh clone — confirm reproducible output (the
  generator must be deterministic; sort tool names alphabetically before
  emitting to avoid spurious diffs).
- Open the generated file in VS Code — confirm autocomplete works on a
  scratch file `import type { GhostPilotToolCall } from '…'`.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Electron's process startup is slow → `pnpm gen:types` takes ~10 s | Acceptable for a build-time tool. Plan #12 would parallelize CI matrix anyway. |
| The `--gen-types` branch crashes on a Zod shape the walker doesn't know | Walker logs `[warn] unknown ZodTypeName "X" for tool "Y"`; emits `unknown` to keep output valid. |
| Stub `ToolDeps` is incomplete and `registerTools` blows up trying to call a method during registration | Registration is *metadata-only* — handlers run inside the lambda, not at register time. We only need stub objects that don't throw on shape inspection. Verified in §10. |
| Committed `.d.ts` and generator drift apart | Drift test in §7.2 catches it on every `pnpm test:unit`. Plan #12 will also run the generator in CI. |
| Developer regenerates with stale build → wrong tool count | `gen:types` script chains `pnpm build && electron …`; no way to skip the build. |
| `dist/` is gitignored elsewhere in the tree | Check `.gitignore`. If yes, add `!dist/ghostpilot-tools.d.ts` exception, or move the artifact to `types/` (cleaner — § propose). |

## 9. Acceptance criteria

- [ ] §5 files changed + tests pass
- [ ] Walker unit tests: 15/15 green
- [ ] Drift test: 4/4 green
- [ ] `pnpm gen:types` succeeds + produces `dist/ghostpilot-tools.d.ts`
- [ ] Generated file passes `tsc --noEmit` standalone
- [ ] All 76 tools have `<Pascal>Input` interfaces
- [ ] `GhostPilotToolName` lists all 76 names
- [ ] `GhostPilotToolCall` discriminated union covers all 76
- [ ] Tool count in `tool-groups.integration.test.ts` unchanged (76)
- [ ] README + CHANGELOG updated
- [ ] commit pushed to `tlejay/ghostpilot:main`
- [ ] prod `/Applications/GhostPilot.app` rebuilt to v0.7.0 + ad-hoc re-signed
- [ ] Mint's running dev `:9223` not interrupted (alt-port pattern)

## 10. Deploy

Same pipeline as Plan #5:

1. Plan doc committed first — review gate.
2. Impl + walker + tests committed on `main`.
3. Run `pnpm gen:types` locally; commit the generated `dist/ghostpilot-tools.d.ts`.
4. Bump `package.json` 0.6.0 → 0.7.0 + close `[Unreleased]` in CHANGELOG → commit.
5. `pnpm dist` → backup current prod (`/Applications/GhostPilot.app.bak-2026-05-20-plan14`) → swap → `codesign --force --deep --sign - --identifier com.madebytle.ghostpilot`.
6. Smoke default mode from `/Applications/` on alt port 29223, verify `current_ghostpilot_profile` (proves the .app boots with the new generator branch dormant).
7. Verify the `--gen-types` flag in the new prod .app: `/Applications/GhostPilot.app/Contents/MacOS/GhostPilot --gen-types /tmp/test.d.ts` → file diff matches committed dist.
8. Push to `origin/main`.

## 11. Open questions (asking for sign-off)

- **Q1 — Output path: `dist/` vs `types/`.** Repo's `.gitignore` may filter
  `dist/`. ➜ **Techoe recommends: `types/ghostpilot-tools.d.ts`** to avoid
  the .gitignore dance and signal intent (typedefs, not build output).
- **Q2 — Drift-test mechanism.** Re-run generator in the test (needs Electron,
  slow) vs static name-comparison (fast, weaker). ➜ **Techoe recommends:
  static for v1** + plan to add the full diff to CI later (Plan #12 land).
- **Q3 — Include category in the generated types?** Could emit
  `GhostPilotToolCategory` + a `categoryOf(name)` discriminator. ➜ **Techoe
  recommends: yes** — cheap, useful for type-safe filtering. Adds ~5 lines.
- **Q4 — JSDoc descriptions: include verbatim or trim?** Some descriptions
  are 2-3 sentences. ➜ **Techoe recommends: verbatim** — IDE hover surfaces
  them; truncation loses info.
- **Q5 — Should the generator be invokable as an MCP tool (`emit_types`)?**
  ➜ **Techoe recommends: no** — build-time artifact, not a runtime concern.

---

*Plan written by Techoe 2026-05-20 — awaiting Mint sign-off before implementation.*

## 10b. Reality check / not-larger-than-plan

Plan #14 has slightly more design surface than #5 because of the
"how do we run the generator outside the running Electron app" question.
But once the `--gen-types` flag pattern is decided, the actual diff is
small: ~80-line walker + ~30-line --gen-types branch + ~50-line generator
+ ~40 lines of tests + the generated artifact itself. Comparable to Plan
#5's ~210-line plan + ~165-line impl footprint. Recommend proceeding;
flagging only the Q1–Q5 sign-off items above.
