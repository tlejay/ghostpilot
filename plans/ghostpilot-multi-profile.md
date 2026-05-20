# GhostPilot Plan #5 — Multi-profile MCP surface

> Status: 🟡 **plan ready for sign-off** · 2026-05-20 by Techoe (delegated by Mint, task `ad83d3be` → next pickup from issue #4)
> Roadmap parent: `GhostPilot-Plan.md` §Mid-term → #5
> Repo target: `tlejay/ghostpilot` (working branch: `main` — additive surface)
> Prior plans: `plans/ghostpilot-tool-groups.md` (#1) · `plans/ghostpilot-stable-selectors.md` (#2) · `plans/ghostpilot-auto-retry.md` (#3) · `plans/ghostpilot-headless.md` (#4) · `plans/ghostpilot-har-network.md` (#6)

## 1. Goal

Make GhostPilot's existing per-profile isolation **scriptable from MCP** so Mint / Claude / any MCP client can:

1. **Discover** which GhostPilot profiles exist on disk and which one this process is running as
2. **Create** a new profile (cookies + storage + history + bookmarks + downloads + skills + oauth fully isolated)
3. **Delete** a non-active profile cleanly
4. **Switch** the active profile (process relaunches into the new profile)

target: when Mint wants to run a smoke test or a one-off workload (Plan #6 verified this pattern by passing `AI_BROWSER_PROFILE=plan4-smoke` to the binary), she can do it through a single MCP tool call instead of relaunching the .app with an env-var prefix.

Foundation that already exists (do **not** re-implement):
- `AI_BROWSER_PROFILE` env var (`src/main/profile.ts` — PROFILE_REGEX guard + `default` fallback)
- Per-profile `session.fromPartition('persist:profile-<name>')`
- Per-profile JSON stores: `userData/profiles/<name>/{history,bookmarks,skills,downloads,oauth}.json`
- IPC handlers `profile:current` / `profile:list` / `profile:switch` (used by the React UI; the relaunch path is already proven)

Plan #5 is essentially "expose the IPC surface as MCP tools + harden validation."

## 2. Why — concrete pain points

- Plan #4 smoke used `AI_BROWSER_PROFILE=plan4-smoke` to verify the binary in an isolated sandbox without polluting Mint's real session. That worked because Techoe could prefix the shell command. **An MCP-driven smoke run** (e.g. Mint scheduler → claude_p → "spin up an isolated GhostPilot to verify X") can't currently do that without a wrapper shell script.
- The FB "Prapat" workflow lives on `default`. If we want to add a second long-lived profile (e.g. for LINE business account, IG `@sportswave.in.th`, or the planned chat-commerce flow) the operator currently has to: stop GhostPilot, edit a LaunchAgent plist or `mint-up.sh`, restart. With MCP tools it's: `create_ghostpilot_profile { name:"ig-mint" }` + `switch_ghostpilot_profile { name:"ig-mint" }`.
- Cleanup is currently manual (`rm -rf ~/Library/Application Support/GhostPilot/profiles/<name>`) — error-prone (typos can nuke `default`). An MCP tool with the "refuse to delete active" guard makes this safe.

## 3. Non-goals (v1)

- ❌ **ไม่** ship the UI dropdown in v1. Renderer-side dropdown lives in `AddressBar.tsx` / a side-panel section — defer to a v2 follow-up. v1 is MCP-only.
- ❌ **ไม่** support per-tab profiles in one window. Electron sessions are bound to the partition at WCV creation; mixing partitions per tab would require deeper TabManager changes. The switch model stays "one process = one profile."
- ❌ **ไม่** auto-migrate existing data when a profile is created — `create_ghostpilot_profile` makes an empty profile.
- ❌ **ไม่** clone/copy profiles via MCP. (`cp -R` works fine from the shell; ship the bare CRUD first.)
- ❌ **ไม่** expose any tool that touches the active process's session partition directly (no MCP `clear_cookies` etc — out of scope).

## 4. Design / API surface

### 4.1 Four new MCP tools (under existing `profiles` category)

| Tool | Input | Output | Notes |
|---|---|---|---|
| `list_ghostpilot_profiles` | `{}` | `{ active: string, profiles: Array<{ name, path, sizeBytes, lastModified }> }` | Reads `userData/profiles/`. Sorts active first. |
| `current_ghostpilot_profile` | `{}` | `{ name: string, partition: string, userDataDir: string }` | Trivial getter — cheap discovery for clients that just need the name. |
| `create_ghostpilot_profile` | `{ name: string }` | `{ ok: bool, name, created, path }` `created=false` if it already existed | Idempotent. Validates via existing `PROFILE_REGEX`. Creates `userData/profiles/<name>/` (mkdir -p). No initial files — the per-store classes lazy-init on first write. |
| `delete_ghostpilot_profile` | `{ name: string, force?: boolean }` | `{ ok, name, deleted, error?: string }` | Refuses with `error:"refusing to delete the active profile …"` if `name === active`. Refuses with `error:"profile not found"` if dir missing. Refuses on `name === "default"` unless `force:true`. Uses `fs.rm(recursive:true)`. |

(`switch_ghostpilot_profile` covered in §4.2 — it's a special case because of the relaunch.)

### 4.2 `switch_ghostpilot_profile` — design choice

Switching profile requires relaunching the process (Electron's `session.fromPartition` is set at WCV-creation time; the existing IPC `profile:switch` already takes the relaunch path).

Three options:

| Option | Behavior | Pro | Con |
|---|---|---|---|
| **A. Hard relaunch via MCP** (selected) | Tool writes new env, calls `app.relaunch + app.exit(0)`. The HTTP response is flushed *before* the exit (200 ms grace). Client gets `{ ok:true, relaunching:true, newProfile }` and must reconnect. | Symmetric with the IPC path; matches caller expectation that "switch = restart." | Caller must handle MCP disconnect mid-call. |
| **B. Mark for next launch** | Write a `pending-profile` file; next manual launch picks it up. | No surprise restart. | Useless for the actual use case (MCP caller wants the switch *now*). |
| **C. Refuse via MCP** | Document that switch is shell-only. | Simplest. | Defeats the goal. |

**Choice: A.** Behavior is identical to the existing IPC handler; the only difference is the trigger. Tool documents the restart explicitly: `"This relaunches GhostPilot. The MCP connection will drop; reconnect after ~3 s."`

Implementation detail: write the response, call `res.end()`, then set a 200 ms `setTimeout` before `app.relaunch + app.exit(0)`. The MCP transport is `Streamable HTTP` — flushing is the standard `res.write + res.end` cycle, which we already use.

### 4.3 Validation tightening

The existing `PROFILE_REGEX = /^[a-zA-Z0-9_-]{1,32}$/` already prevents path traversal. We re-use it across all four tools, plus add a length cap of 32 chars (matches the regex). Add a single shared `validateProfileName(name): string | null` helper in `src/main/profile.ts` that returns a normalized name or an error string — used by both IPC handlers and new MCP tools.

### 4.4 Storage isolation audit

Current state (verified by grep — see §1):

| Surface | Per-profile? | Where |
|---|---|---|
| Session cookies / localStorage / IndexedDB | ✅ | `session.fromPartition('persist:profile-<name>')` |
| History | ✅ | `userData/profiles/<name>/history.json` |
| Bookmarks | ✅ | `userData/profiles/<name>/bookmarks.json` |
| Skills | ✅ | `userData/profiles/<name>/skills.json` |
| Downloads list | ✅ | `userData/profiles/<name>/downloads.json` |
| OAuth tokens | ✅ | `userData/profiles/<name>/oauth.json` |
| Window bounds | ❌ shared (`userData/window-bounds.json`) | by design — UX preference, not user data |
| `assets/notices.json` | ❌ shared | bundled resource, not user data |

No leaks. v1 ships the MCP surface; no migration needed.

### 4.5 Tool count

`profiles` category currently has 1 tool (`list_chrome_profiles`) → becomes **5**. Total tool count: **71 → 75**.

## 5. Impl outline

| File | Change |
|---|---|
| `src/main/profile.ts` | Add `validateProfileName(name): { ok:true, name } \| { ok:false, error }` shared helper. Re-use across MCP + IPC. |
| `src/main/profile-manager.ts` (new) | `listProfiles()`, `currentProfile()`, `createProfile(name)`, `deleteProfile(name, opts)`, `requestSwitch(name, reason)` — pure-ish functions (deleteProfile / createProfile do fs IO). |
| `src/main/profile-manager.test.ts` (new) | unit tests for all four (plus validation edge cases). |
| `src/main/mcp/tools.ts` | Register 4 new tools under the existing `profiles` category. `switch_ghostpilot_profile` handler delays the exit() by 200 ms. |
| `src/main/mcp/tool-groups.integration.test.ts` | total `71 → 75`; per-category `profiles: 1 → 5`. |
| `src/main/index.ts` | (no change to boot sequence — the IPC handler can route through `profile-manager` too, but that's an internal refactor; v1 keeps IPC handler intact, only the MCP tools call `profile-manager`) |
| `README.md` | bump count `71 → 75`; new "Profiles" subsection with the 5 tool names + a curl example for `list_ghostpilot_profiles`. |
| `CHANGELOG.md` | one `[Unreleased]` block. |

## 6. Backward compatibility

- Existing `AI_BROWSER_PROFILE` env var — unchanged. Boot path identical.
- Existing IPC handlers — unchanged.
- New MCP tools are additive; no breaking change to any existing schema or category.

## 7. Test plan

### 7.1 Unit (`src/main/profile-manager.test.ts`)

`validateProfileName`:
1. `"default"` → ok
2. `"prapat"` → ok
3. `"a"` → ok
4. `"a".repeat(32)` → ok
5. `"a".repeat(33)` → fail
6. `"has space"` → fail
7. `"../escape"` → fail
8. `""` → fail
9. `"with/slash"` → fail

`listProfiles`:
10. Empty `profiles/` dir → `{ active:"default", profiles:[] }` (default is implicit)
11. With `default/` + `plan4-smoke/` → both listed, active sorted first

`createProfile`:
12. New name → creates dir, returns `{ created:true }`
13. Existing name → idempotent, returns `{ created:false, ok:true }`
14. Invalid name → `{ ok:false, error }`

`deleteProfile`:
15. Active profile → refused with explicit error
16. Non-existent → `{ ok:false, error:"profile not found" }`
17. `"default"` without force → refused
18. `"default"` with `force:true` → deleted (dangerous; documented)
19. Normal delete → returns `{ ok:true, deleted:true }`

Total: 19 unit tests.

### 7.2 Integration (live process, alt port)

Same pattern as Plan #4 §7.2 — launch `release/mac-arm64/GhostPilot.app` on alt port + isolated profile:

- `list_ghostpilot_profiles` → returns active=plan5-smoke + at least one entry
- `current_ghostpilot_profile` → `{ name:"plan5-smoke", partition:"persist:profile-plan5-smoke" }`
- `create_ghostpilot_profile { name:"plan5-tmp" }` → ok, `created:true`, dir exists on disk
- `create_ghostpilot_profile { name:"plan5-tmp" }` again → ok, `created:false` (idempotent)
- `delete_ghostpilot_profile { name:"plan5-smoke" }` → refused (active)
- `delete_ghostpilot_profile { name:"plan5-tmp" }` → ok, dir gone on disk
- `delete_ghostpilot_profile { name:"plan5-nonexistent" }` → `{ ok:false, error:"profile not found" }`
- `delete_ghostpilot_profile { name:"default" }` → refused without force
- `switch_ghostpilot_profile { name:"plan5-target" }` → response includes `relaunching:true`; MCP connection drops within 1 s; new process boots with `profile="plan5-target"` (verified by /health JSON)

### 7.3 UAT (Mint-side, post-deploy)

- Run `list_ghostpilot_profiles` from Mint shell → see `default`, `plan4-prodverify`, `plan4-smoke` (leftover from #4 work).
- Create a `chat-commerce` profile for future use (the channel `1503751398968524820` workflow).
- Optionally `delete_ghostpilot_profile { name:"plan4-prodverify" }` to clean up Techoe's smoke leftovers.

## 8. Risks

| Risk | Mitigation |
|---|---|
| `switch_ghostpilot_profile` exits before HTTP response flushes → caller sees a connection-refused | 200 ms `setTimeout` after `res.end()` before `app.exit(0)`. The transport's `flush` is a TCP-level write; 200 ms is generous. |
| MCP caller deletes the active profile and locks themselves out | Active-profile guard refuses. |
| Path traversal via `name:"../something"` | `PROFILE_REGEX` already rejects `..`/`/`. Re-validated in `validateProfileName`. |
| `fs.rm` race with the Electron session that may still hold file handles on the profile being deleted | Active-profile guard prevents this. (Non-active profile is not being written to by the running process.) |
| `default` profile accidentally deleted | Two-step guard: regex allows it, but `deleteProfile` refuses unless `force:true`. |
| Mint scheduler workloads that hardcode the `default` partition expecting persistent state | Default never gets nuked without explicit `force`. Workloads keep working. |

## 9. Acceptance criteria

- [ ] §5 files changed + tests pass
- [ ] 19 unit tests added in `profile-manager.test.ts` — all green
- [ ] `tools/list` count goes 71 → 75
- [ ] `profiles` category goes 1 → 5
- [ ] live smoke: 9 integration checks in §7.2 pass against `release/mac-arm64/GhostPilot.app` on alt port
- [ ] README + CHANGELOG updated
- [ ] commit pushed to `tlejay/ghostpilot:main`
- [ ] prod `/Applications/GhostPilot.app` rebuilt to v0.6.0 + ad-hoc re-signed + smoke-verified (alt port)
- [ ] Mint's running dev `:9223` not interrupted (per Plan #4 deploy pattern)

## 10. Deploy

Same pipeline as Plan #4:
1. Plan doc committed first (this file) — review gate
2. Impl + tests committed on `main`
3. Bump `package.json` 0.5.0 → 0.6.0 + close `[Unreleased]` in CHANGELOG → commit
4. `pnpm dist` → backup current prod (`/Applications/GhostPilot.app.bak-2026-05-20-plan5`) → swap → `codesign --force --deep --sign - --identifier com.madebytle.ghostpilot`
5. Smoke default mode from `/Applications/` on alt port (29223), verify `current_ghostpilot_profile`.
6. Push to `origin/main`.
7. Inbox-reply to Mint with summary.

## 11. Open questions (asking for sign-off)

- **Q1 — UI dropdown.** Defer to v2 follow-up (renderer-only PR, no MCP surface change)? ➜ **Techoe recommends: defer.** Keeps v1 small.
- **Q2 — `clone_profile` tool.** Not in v1; users can `cp -R` from the shell. Add later if a workload asks? ➜ **Techoe recommends: defer.**
- **Q3 — Auto-detect orphan profiles.** Scan `userData/profiles/` at boot, log warning if any profile has zero session activity in >30 days? ➜ **Techoe recommends: defer; nice-to-have, not blocking.**
- **Q4 — `switch_ghostpilot_profile` with relaunch — keep or drop from v1?** Drop = simpler + no client-side reconnect logic needed. Keep = matches the user's mental model "I want to switch *now*." ➜ **Techoe recommends: keep**, with the 200 ms flush dance.

---

*Plan written by Techoe 2026-05-20 — awaiting Mint sign-off before implementation.*
