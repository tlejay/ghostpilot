# GhostPilot — Changelog

All notable, user-facing changes to GhostPilot land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semver based on the `package.json` field.

## [Unreleased]

_(empty)_

## [0.6.0] — 2026-05-20

Release covers Plan #5 (multi-profile MCP surface) — five new tools under the
existing `profiles` category that wrap GhostPilot's per-profile session isolation
(cookies / localStorage / history / bookmarks / skills / downloads / oauth all
already partition by `AI_BROWSER_PROFILE` at boot).

### Added — Multi-profile MCP tools (plan #5)

GhostPilot supports per-profile isolation at boot via `AI_BROWSER_PROFILE`
since v0.1; v0.6.0 exposes the lifecycle so MCP clients can manage profiles
without leaving the session.

Five new tools under the existing `profiles` category:

- `list_ghostpilot_profiles` — return every profile on disk plus the active
  one (sorted first); each entry carries `sizeBytes` + `lastModified`.
- `current_ghostpilot_profile` — `{ name, partition, userDataDir }` for the
  process this MCP call is running in.
- `create_ghostpilot_profile { name }` — idempotent; returns
  `{ ok:true, created:false }` if the profile dir already existed.
- `delete_ghostpilot_profile { name, force? }` — refuses with a typed error
  when `name === active`; refuses the literal `default` profile unless
  `force:true`; returns `{ ok:false, error:"profile not found" }` for unknown
  names. No-op on the active session partition.
- `switch_ghostpilot_profile { name }` — **relaunches** GhostPilot with the
  new profile via `app.relaunch + app.exit(0)`. The MCP response flushes
  before the 200 ms exit timer fires, so callers get `{ ok:true, relaunching:true, name }`
  before the connection drops. Reconnect after ~3 s. Passing the active
  profile is a no-op (`relaunching:false`).

Name validation is shared across all five tools (and matches the existing
boot-time regex): `[a-zA-Z0-9_-]{1,32}`. Path traversal (`../escape`, slashes,
spaces) and oversized names are rejected with caller-facing errors.

Tool count is **71 → 76**; `profiles` category goes 1 → 6 (the existing
`list_chrome_profiles` stays unchanged). All other categories untouched.

Non-goals deferred to v2:
- UI dropdown in `AddressBar.tsx` / SidePanel (renderer-only follow-up)
- Per-tab profiles within one window (Electron sessions are bound at WCV
  creation; deeper TabManager change)
- `clone_profile` (`cp -R` works from the shell)
- Auto-detect orphan profiles at boot

Implementation: `src/main/profile-manager.ts` (pure-ish lifecycle helpers,
filesystem-only; `userDataDir`-parameterized so tests can use a tmp dir);
five new tool registrations in `src/main/mcp/tools.ts`; `ToolDeps` gains
optional `profile?: string`.
Tests: 25 unit (`tests/unit/profile-manager.test.ts` — validator + listProfiles +
currentProfile + createProfile + deleteProfile + validateSwitchRequest).

## [0.5.0] — 2026-05-19

Release covers Plan #4 (headless mode) and the Plan #11 docs rewrite
(README restructured around new-user flow; new `TUTORIAL.md` end-to-end
walkthrough).

### Added — Headless mode (plan #4)

GhostPilot can now run with no visible window and no dock icon — useful for
CI runners, scheduled jobs, and background scripts that drive the browser
through MCP without surfacing UI.

Two equivalent toggles (CLI flag wins if both are set):

- `--headless` on the command line
- `GHOSTPILOT_HEADLESS=1` in the environment

When enabled:

- The main `BrowserWindow` is created with `show:false` and the
  `ready-to-show` handler skips `win.show()`.
- On macOS, `app.dock?.hide()` runs before `whenReady`, so the dock icon
  never flickers in.
- All page-rendering tools work normally (`screenshot`, `evaluate`,
  `get_page_text`, `a11y_snapshot`, `click`, `fill`, the full `locator` /
  `network` / `ext_*` surface) — Chromium renders off-screen.
- Two GUI-bound tools return a structured
  `{ ok:false, error:"… headless mode …" }` instead of crashing:
  - `desktop_screenshot` — captures the macOS screen, requires a GUI
    session and Screen Recording TCC
  - `set_window_bounds` — moves/resizes the chrome, needs a visible window
- A single line `[headless] enabled — main window hidden, dock icon hidden
  (darwin)` is printed at boot.

Tool count is unchanged (still **71**); headless is a runtime mode, not a
new category. Default behavior is unchanged — headless is purely opt-in.

Implementation: pure `isHeadless(argv, env)` resolver in
`src/main/headless.ts`; `createMainWindow()` takes a `headless` arg;
`ToolDeps` gains an optional `headless?: boolean` that the two affected
handlers read.
Tests: 9 unit (`tests/unit/headless.test.ts`).

## [0.4.0] — 2026-05-18

Release covers Plans #2 (stable selectors), #3 (auto-retry + auto-wait), and
#6 (HAR export + richer network filters), plus four standalone tool additions
that landed in between: tool-category filtering, `desktop_screenshot`,
`set_window_bounds` + persisted window bounds, and the `ext_*` external-CDP
tool group.

### Added — HAR export + richer network filters (plan #6)

`list_network_requests` now accepts richer filters with AND semantics across
axes — useful when a page fires 200+ requests and you only want the failures
or one endpoint family:

| Field | Type | Notes |
|---|---|---|
| `method` | string \| string[] | UPPERCASE; scalar form back-compat |
| `status` | number \| number[] | exact match |
| `urlPattern` | string | substring OR Perl-style `/regex/flags` |
| `urlIncludes` | string | legacy alias of `urlPattern` (substring) |
| `mimeType` | string | case-insensitive substring of response `Content-Type` |
| `since` | string \| number | ISO timestamp or epoch ms — drop earlier entries |
| `failedOnly` | boolean | shortcut for `status >= 400 \|\| error != null` |

Per-entry shape gains optional `requestHeaders`, `responseHeaders`,
`statusLine`, `httpVersion`, `mimeType` fields, populated via Electron's
`onBeforeSendHeaders` + `onHeadersReceived` (synchronous; no added latency).

New `export_har` MCP tool writes the (filtered) capture to a HAR 1.2 file
on disk — openable in Chrome DevTools (Network tab → Import HAR…), Charles,
Postman, k6, etc. Same filter shape as `list_network_requests`, plus
`path` (defaults to `/tmp/ghostpilot-har-<ISO>.har`) and `pretty`.

v1 caveat: response BODY is not captured (HAR `content.size = -1`, no
`content.text`). All major HAR readers accept this shape; revisit if a
workload needs body bytes.

Implementation: `src/main/mcp/har-export.ts` (pure `filterEntries` +
`toHar` + `writeHar`).
Tests: 16 unit (`src/main/mcp/har-export.test.ts`); `tool-groups.integration`
expects 71 total tools / `network: 3`.

### Added — Playwright-style stable selectors (plan #2)

Four new MCP tools under the `locator` category that resolve elements by
semantic attributes and return a CSS selector you can hand to existing
mutating tools (`click`, `fill`, `wait_for_selector`):

- `get_by_role` — match by ARIA role (explicit or implicit) + optional
  accessible name (`name` substring or `nameRegex`)
- `get_by_text` — match by visible text content (innermost element)
- `get_by_label` — match a form control by its `<label for>`, `aria-label`,
  or `aria-labelledby`
- `get_by_test_id` — exact `data-testid` match

Each tool polls every `pollIntervalMs` (default 100) and waits up to
`timeoutMs` (default 3000) for at least one match. Returns `{ ok, count,
selector, role, name, text, matches[≤5], waitedMs }`. Selector synthesis
priority: `data-testid` → `#id` → `[aria-label][role]` → `tag[aria-label]`
→ `tag[name]` → nth-child path. Uniqueness is verified via
`document.querySelectorAll(...).length === 1` before returning.

Embedded-only in v1; `ext_get_by_*` equivalents deferred until the
embedded path proves out on Mint/mbt-store-bot workloads.

Implementation: `src/main/mcp/locator-tools.ts`.
Tests: 6 unit (`src/main/mcp/locator-tools.test.ts`) + integration counts
updated in `tool-groups.integration.test.ts` (70 total tools, `locator: 4`).

### Added — auto-retry + auto-wait wrapper (plan #3)

Six mutating MCP tools now auto-wait for the target element to be visible
and stable, and auto-retry on transient DOM errors (node detached, frame
detached, target closed, navigation interrupted, execution context destroyed,
etc.). Existing call sites need no changes — defaults are conservative and
the response shape is unchanged for non-transient soft failures.

Wrapped tools:

- `click` — wait stable then click; retries on transient
- `fill` — wait stable then fill; retries on transient
- `type_text` — retries on transient (no selector → no waitStable)
- `hover` — wait stable then hover; retries on transient
- `press_key` — retries on transient (no selector → no waitStable)
- `upload_file` — direct-input path retries; the `clickSelector` (file
  chooser) path is intentionally single-shot to avoid double-opening the
  OS picker

New optional input fields (all six tools where applicable):

| Field | Default | Effect |
|---|---|---|
| `retries` | `3` | Max attempts incl. first (min 1; `0` rejected by schema) |
| `retry_delay_ms` | `[100, 300, 800]` | Per-retry backoff (index capped) |
| `wait_stable_ms` | `200` | Bounding-box must stay still this many ms |
| `wait_timeout_ms` | `5000` | Max wait before "not stable" throws |

`wait_stable_ms` / `wait_timeout_ms` apply to `click`, `fill`, `hover`,
`upload_file`. `press_key` / `type_text` don't take a selector so only the
retry knobs apply.

Pass `{retries: 1, wait_stable_ms: 0}` for the opt-out fast path (same
behaviour as before plan #3).

Each retry emits one log line through the existing logger
(`[auto-retry] click('div.x') attempt 2/3 failed: …; wait 300ms`). No
log noise for first-try successes.

Implementation: `src/main/mcp/auto-retry.ts`.
Tests: 9 unit (`tests/unit/auto-retry.test.ts`) + 6 integration
(`tests/integration/auto-retry.test.ts`).
New scripts: `pnpm test:unit`, `pnpm test:integration`.

### Added — external-CDP tool group (`ext_*`)

Six new tools that drive an externally launched Chrome over CDP (port from
`GHOSTPILOT_EXT_CDP_PORT`, default `9222`) instead of GhostPilot's embedded
WebContentsViews — useful for sites that key on a real Chrome profile
(LINE Web, Facebook session) where the embedded Electron profile isn't
authenticated:

- `ext_list_tabs`, `ext_navigate`, `ext_evaluate`, `ext_click`,
  `ext_a11y_snapshot`, `ext_screenshot`

CDP-level click uses `Input.dispatchMouseEvent` to produce a trusted
`MouseEvent` (`event.isTrusted = true`) — needed for sites that gate
handlers on trust.

### Added — `desktop_screenshot`

Capture the full desktop (any monitor / external display) via Electron's
`desktopCapturer`. Replaced an earlier `screencapture(1)` shell-out
implementation to inherit GhostPilot's TCC Screen Recording grant rather
than requiring a separate grant for the shell binary.

### Added — `set_window_bounds` + persisted window bounds

GhostPilot now persists its main `BrowserWindow` size/position across
launches (per profile). New `set_window_bounds` MCP tool moves/resizes
the window programmatically.

### Added — tool-category filtering (`GHOSTPILOT_TOOLS`) + introspection

MCP tool registration now respects an opt-in/opt-out category allowlist
via the `GHOSTPILOT_TOOLS` env var (e.g. `tabs,page,network` /
`-emulation,-performance`). New `tool_categories` MCP tool returns the
taxonomy + which tools are currently registered. Lets thin clients trim
the tool surface to what they actually use.
