# GhostPilot Plan #4 — Headless mode

> Status: 🟡 **plan ready** · 2026-05-18 by Techoe (delegated by Mint, task `fbaccd7d`)
> Roadmap parent: `GhostPilot-Plan.md` §Mid-term → #4
> Repo target: `tlejay/ghostpilot` (working branch: `main` — additive surface)
> Prior plans: `plans/ghostpilot-tool-groups.md` (#1) · `plans/ghostpilot-stable-selectors.md` (#2) · `plans/ghostpilot-auto-retry.md` (#3) · `plans/ghostpilot-har-network.md` (#6)

## 1. Goal

Let GhostPilot run with **no visible window, no dock icon**, so CI runners + cron jobs + background scripts can drive the browser through MCP without:

- A visible Electron window stealing focus on the dev machine,
- A dock icon showing up every time `mint-scheduler` fires,
- Failing on headless CI runners that have no display server attached.

Opt-in mode — default behavior unchanged (visible window, dock icon as today).

## 2. Why — concrete pain points

- **Mint scheduler workloads**: every `com.mint.sellpost` / `com.mint.morningbrief` tick that calls a GhostPilot tool currently surfaces an Electron window if GhostPilot wasn't already running. พี่เติ้ลโดน "window pops up" interrupt บนเครื่อง daily-driver
- **CI/CD path**: no current way to run GhostPilot end-to-end smoke tests on GitHub Actions / Cloud Build / etc. — those runners are GUI-less by design. Plan #4 unblocks "ghostpilot smoke test on PR" pattern
- **Long-running background jobs** (mbt-store-bot's `monitor.py` mainloop) that already call MCP `:9223` would prefer not to surface a window when GhostPilot bootstraps

## 3. Non-goals (v1 — ship today)

- ❌ **ไม่** make every tool work in headless. `desktop_screenshot` (captures the macOS screen) + `set_window_bounds` (moves the visible Electron window) intrinsically need a GUI session — they return a typed error in headless. All **other** tools work.
- ❌ **ไม่** support `xvfb` / virtual framebuffer auto-spawn — that's a CI-runner concern, doc'd in §10
- ❌ **ไม่** rebrand: same `GhostPilot` app, same MCP port, same data dir. The flag is purely a runtime toggle.
- ❌ **ไม่** add a new tool category. Headless is a runtime mode, not a tool group. `tool-groups.integration.test.ts` totals stay at **71** (no surface change).
- ❌ **ไม่** ship a separate "headless build" / binary. Same `.app`; flip the flag at launch.

## 4. Design / API surface

### 4.1 Two equivalent toggles

| Toggle | Where read | Notes |
|---|---|---|
| `--headless` | `process.argv` | Wins if both set |
| `GHOSTPILOT_HEADLESS=1` | `process.env` | Useful for LaunchAgent / cron / docker |

Resolution helper in `src/main/headless.ts`:

```ts
export function isHeadless(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes('--headless')) return true;
  return env.GHOSTPILOT_HEADLESS === '1';
}
```

Pure function — easy to unit-test across permutations.

### 4.2 What changes when `headless=true`

| Surface | Default behavior | Headless behavior |
|---|---|---|
| `createMainWindow()` | `show: false` → `ready-to-show` → `win.show()` | `show: false`, **skip** `win.show()` listener |
| `app.dock.setIcon()` (dev mode) | applied | skipped + **`app.dock?.hide()`** called (macOS only) |
| `tabManager.newTab()` | renders into visible WCV | renders into hidden WCV (same code path; just no on-screen output) |
| MCP server boot | unchanged | unchanged |
| `set_window_bounds` tool | resizes the window | returns `{ ok:false, error:"headless mode" }` (does **not** crash) |
| `desktop_screenshot` tool | captures macOS screen | returns `{ ok:false, error:"headless mode" }` (does **not** crash; skips the `screencapture`/TCC dance) |

Critically: `screenshot` (the in-tab screenshot via `webContents.capturePage()`), `get_page_text`, `evaluate`, `a11y_snapshot`, `click`, `fill`, `wait_for_selector`, all `locator_*`, all `ext_*`, the entire `network` / `console` / `performance` / `cdp_send` surface — **all keep working in headless**. `webContents` rendering does not require a visible window.

### 4.3 Startup log

When headless:

```
[headless] enabled — main window hidden, dock icon hidden (darwin)
[GhostPilot] profile="default" — MCP on http://127.0.0.1:9223/mcp (auth: open)
```

So `tail -f /tmp/ghostpilot-dev.log` / journald immediately reveals which mode the process booted in.

### 4.4 Module-level flag

`src/main/index.ts` resolves `isHeadless(process.argv, process.env)` once, at the top of the module (before `whenReady`), and stores it as `const HEADLESS`. Two consumers:

1. `createMainWindow(saved, headless)` — new arg; gates `ready-to-show.show()`
2. `applyDockIcon()` — when headless, replace the setIcon call with `app.dock?.hide()`

`ToolDeps` already carries `mainWindow`; add a `headless: boolean` field so the two affected tool handlers can read it without re-parsing argv/env.

## 5. Impl outline

| File | Change |
|---|---|
| `src/main/headless.ts` (new) | pure `isHeadless(argv, env): boolean` |
| `src/main/index.ts` | resolve `HEADLESS` once · pass into `createMainWindow` · skip `.show()` listener · hide dock on macOS · log `[headless] enabled` · add `headless` to `ToolDeps` payload |
| `src/main/mcp/server.ts` | `MCPDeps` gains `headless?: boolean` (forwarded to `ToolDeps`) |
| `src/main/mcp/tools.ts` | `ToolDeps` interface gains `headless?: boolean` · `set_window_bounds` handler early-returns headless error · `desktop_screenshot` handler early-returns headless error |
| `src/main/__tests__/headless.test.ts` (new) | unit tests for `isHeadless` permutations + the two error early-returns (handlers exercised in isolation via a fake `mainWindow`) |
| `README.md` | new "Headless mode" subsection + CI snippet |
| `CHANGELOG.md` | one block |

`tool-groups.integration.test.ts` is **untouched** — no count change.

## 6. Backward compatibility

- Default (no flag, no env var) → identical behavior to v0.4.0.
- Existing callers of `set_window_bounds` / `desktop_screenshot` running outside headless → identical behavior.
- Existing `ToolDeps` consumers ignore the new `headless?` field (optional, default `false`).
- `mint-scheduler` LaunchAgents can stay on the default launch flow OR opt-in by adding `--headless` to their `ProgramArguments` — Plan #4 doesn't force the migration.

## 7. Test plan

### 7.1 Unit (`src/main/__tests__/headless.test.ts`)

`isHeadless(argv, env)` permutations:
1. `[]`, `{}` → `false`
2. `['--headless']`, `{}` → `true`
3. `[]`, `{ GHOSTPILOT_HEADLESS: '1' }` → `true`
4. `[]`, `{ GHOSTPILOT_HEADLESS: '0' }` → `false`
5. `[]`, `{ GHOSTPILOT_HEADLESS: 'true' }` → `false` (only `'1'` counts — keeps the semantics tight)
6. `['--headless']`, `{ GHOSTPILOT_HEADLESS: '0' }` → `true` (CLI flag wins)
7. Other argv values do not trigger (`['--something-else']` → `false`)

Error early-returns:
8. `set_window_bounds` handler invoked with `headless=true` → result is `{ ok:false, error: <"headless"-containing string> }`; `mainWindow.setBounds` is **not** called.
9. `desktop_screenshot` handler invoked with `headless=true` → result is `{ ok:false, error: <"headless"-containing string> }`; `screencapture` is **not** invoked.

### 7.2 Integration (live process)

Phase 3 smoke (not in static test file):
- Launch `/Applications/GhostPilot.app/Contents/MacOS/GhostPilot --headless` in background.
- Wait ~12 s; assert `curl http://127.0.0.1:9223/health` → 200.
- `tools/list` count = **71** (unchanged surface).
- `list_tabs` returns the auto-spawned welcome tab (proves WCV rendering ok without visible window).
- `set_window_bounds {center:true}` → returns the structured "headless mode" error (verifies guard).
- `desktop_screenshot {}` → returns the structured "headless mode" error (verifies guard).
- macOS `osascript -e 'tell app "System Events" to get name of every window of process "GhostPilot"'` → empty list (verifies no visible window).
- Kill process; re-launch via `open -a` → visible mode restored.

### 7.3 UAT (Mint-side, post-deploy)

- Add `--headless` to `com.mint.sellpost.plist`'s `ProgramArguments` for one tick → window should not surface; sell-post completes normally.
- Roll back if any captured tool call fails — current ETA unchanged.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Some tool implicitly assumes the window is visible (e.g. `screenshot` via `capturePage`) and breaks in headless | `webContents.capturePage()` doesn't require visibility (Chromium renders off-screen). Smoke covers `screenshot` if exercised. |
| `app.dock?.hide()` not available on older Electron | Optional chaining + `process.platform === 'darwin'` guard; no-op if API missing. |
| Headless + `BrowserWindow({show:false})` still leaks a window in dock briefly on macOS during boot | Pre-`whenReady`, call `app.dock?.hide()` (we do — guarded by HEADLESS). |
| LaunchAgent runs as a different user → `GHOSTPILOT_HEADLESS=1` not inherited | Doc'd in §10: set via `EnvironmentVariables` dict in the plist. |
| User toggles `--headless` and then tries `set_window_bounds` and is surprised it errors | Error string explicitly mentions "headless mode" + "this tool requires a visible window" — actionable. |

## 9. Acceptance criteria

- [ ] §5 files changed
- [ ] unit tests pass (9/9 new, plus existing 50/50)
- [ ] tool-groups integration unchanged (71 total)
- [ ] live smoke: headless boot + `/health` + `tools/list` + guarded errors + no visible window
- [ ] README + CHANGELOG updated
- [ ] commit pushed to `tlejay/ghostpilot:main`
- [ ] prod `/Applications/GhostPilot.app` rebuilt + ad-hoc re-signed + smoke-verified default mode AND headless mode; then re-launched in default mode so Mint workload continues

## 10. Deploy / CI snippet

Same pipeline as Plan #6:
1. Plan doc committed first
2. Impl + tests committed on `main`
3. `pnpm dist` → backup current prod (`.bak-2026-05-18-plan4`) → swap → `codesign --identifier com.madebytle.ghostpilot`
4. Smoke default mode (open -a, verify health, /tools/list).
5. Smoke headless mode (kill, re-launch with `--headless` env, verify health + no visible window + the two guards).
6. Restore default mode (kill headless, `open -a`).

### Sample GitHub Actions workflow

```yaml
# .github/workflows/ghostpilot-smoke.yml
name: GhostPilot headless smoke
on: [push, pull_request]
jobs:
  smoke:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm assets
      - run: pnpm dist
      - name: Launch GhostPilot headless
        run: |
          ./release/mac-arm64/GhostPilot.app/Contents/MacOS/GhostPilot \
            --headless \
            > /tmp/ghostpilot.log 2>&1 &
          for i in {1..20}; do
            curl -fsS http://127.0.0.1:9223/health && break || sleep 1
          done
      - name: MCP smoke
        run: |
          curl -fsS http://127.0.0.1:9223/health
          # Add an MCP tools/list call here once a CI-friendly MCP client is wired in.
      - name: Tail log on failure
        if: failure()
        run: tail -200 /tmp/ghostpilot.log
```

(Snippet illustrative — full CI wiring is its own follow-up.)

### LaunchAgent (local) opt-in

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>GHOSTPILOT_HEADLESS</key>
  <string>1</string>
</dict>
```

## 11. Rollout

Default mode unchanged. Headless is opt-in. No migration risk — `--headless` is purely additive.

## 12. Open questions (deferred)

- **Q1**: Should `desktop_screenshot` in headless try to capture via a virtual framebuffer if available? — **Deferred**; behavior today is an explicit typed error.
- **Q2**: Auto-detect display-less environments (no `$DISPLAY`, no Aqua session) and force headless? — **Deferred**; we keep the toggle explicit so the dev machine never gets a surprise headless mode.
- **Q3**: Expose `headless: boolean` over MCP introspection (`tool_categories` or a sibling `runtime_info` tool)? — **Deferred** until a workload asks.

---
