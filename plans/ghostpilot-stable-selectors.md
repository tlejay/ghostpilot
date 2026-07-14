# GhostPilot Plan #2 — Playwright-style stable selectors

> Status: 🟡 **plan ready** · 2026-05-18 by Techoe (delegated by Mint, task `7a5d429c`)
> Roadmap parent: `GhostPilot-Plan.md` §Quick wins → #2
> Repo target: `tlejay/ghostpilot` (working branch: `main` — small enough surface, no PR)
> Prior plans: `plans/ghostpilot-tool-groups.md` (Plan #1) · `plans/ghostpilot-auto-retry.md` (Plan #3)

## 1. Goal

แอด 4 locator tools เลียน Playwright API ที่ resolve element โดยอิง **semantic attributes** (role, accessible name, label, data-testid) แทน CSS path:

| Tool | Equivalent Playwright | Returns |
|---|---|---|
| `get_by_role` | `page.getByRole('button', { name: 'Post' })` | first match's CSS selector + AX role/name + total count |
| `get_by_text` | `page.getByText('โพสต์')` | same shape |
| `get_by_label` | `page.getByLabel('Email')` | same shape |
| `get_by_test_id` | `page.getByTestId('login-btn')` | same shape |

target: เมื่อ FB/LINE redesign DOM แต่ accessibility attributes (role, aria-label) อยู่ — script เดิมไม่พัง เพราะแก locator แล้ว resolve เป็น selector ใหม่ทุก run

## 2. Why — pain points (real, จาก log/memory)

- mbt-store-bot composer regression 2026-05-17 (task `49a10ee7`): FB rolled out a redesigned composer + a new "+N" overflow chip → `COMPOSER_STATE_JS` ที่ count DOM thumbnails พังทันที. ถ้ามี locator semantics, code อ้าง "role=button name=Post" จะคงอยู่
- Post-button fix 2026-05-17 (task `5f344901`): selector ปัจจุบัน `div[aria-label="โพสต์"][role="button"]` ทำได้ แต่เปราะ — locale shift (`Post` vs `โพสต์`) หรือ FB ย้าย container ทำให้ break
- LINE skill: `agent-browser snapshot` ออก `@e5` refs แต่ caller บางตัวยัง map ผ่าน CSS เอง → fragility ซ้ำ
- Plan #3 (auto-retry) แก้ปัญหา **timing**; Plan #2 แก้ปัญหา **identity** — สอง axis ของความ flaky ใน FB/LINE workload

## 3. Non-goals (v1 — ship today)

- ❌ **ไม่** มี chaining / locator composition (e.g. `getByRole('button').filter().nth(2)`); Mint ใช้ existing tools (click/fill) on returned selector → composition เกิดที่ caller
- ❌ **ไม่** ครอบ ext_* (external Chrome) — embedded-only ใน v1; equivalent ext_get_by_* deferred
- ❌ **ไม่** เพิ่ม `getByPlaceholder`, `getByAltText`, `getByTitle` ใน v1 — เพิ่มได้ง่ายภายหลัง
- ❌ **ไม่** auto-execute action (click/fill) จาก locator — แค่ resolve เป็น selector แล้วคืน. กัน hidden state มาก่อกวน
- ❌ **ไม่** auto-snapshot AX tree เป็น state global — query-on-demand เท่านั้น

## 4. Design / API surface

### 4.1 Tool surface (4 tools, category `locator`)

Common input fields (all 4 share):
| Field | Default | Behavior |
|---|---|---|
| `tabId` | active tab | which embedded tab to query |
| `timeoutMs` | `3000` | wait up to N ms for ≥ 1 match before returning |
| `pollIntervalMs` | `100` | poll cadence inside the wait loop |

Per-tool extras:
| Tool | Required | Optional |
|---|---|---|
| `get_by_role` | `role: string` | `name?: string`, `nameRegex?: string` (mutually exclusive with name), `exact?: boolean = false`, `includeHidden?: boolean = false` |
| `get_by_text` | `text: string` | `textRegex?: string` (mutually exclusive), `exact?: boolean = false`, `includeHidden?: boolean = false` |
| `get_by_label` | `label: string` | `labelRegex?: string`, `exact?: boolean = false` |
| `get_by_test_id` | `testId: string` | — (always exact `[data-testid=...]` match) |

Output (common shape):
```json
{
  "ok": true,
  "count": 1,
  "selector": "div[aria-label=\"โพสต์\"][role=\"button\"]",
  "role": "button",
  "name": "โพสต์",
  "matches": [
    { "selector": "...", "role": "button", "name": "โพสต์", "text": "โพสต์", "visible": true }
  ]
}
```
`count` is the total matches; `selector` + `role` + `name` are the **first** match (Playwright's first-match semantic). `matches` lists up to 5 candidates so the caller can pick if too many.

Failure shapes:
- `{ ok: false, error: "no match", count: 0, waitedMs: 3000 }` — timeout, no element appeared
- `{ ok: false, error: "ambiguous (count=12)", count: 12, matches: [...] }` — caller should refine

### 4.2 Selector synthesis

For each AX node we want a CSS selector that uniquely identifies the underlying DOM element across re-renders. Priority order (first hit wins):

1. `[data-testid="${test_id}"]` — if element has a unique testId
2. `#${id}` — if element has a unique id (escape special chars)
3. `[aria-label="${label}"][role="${role}"]` — if both present and unique together
4. `${tag}[aria-label="${label}"]` — if tag+label unique
5. `${tag}[name="${attr_name}"]` — for form controls (input, textarea)
6. nth-child path of last resort — walks up max 6 parents

Uniqueness check: run `document.querySelectorAll(candidate).length === 1`. Stop at the first unique-and-stable form.

### 4.3 Backbone — JS-side matcher

Rather than juggle `Accessibility.getFullAXTree` + `DOM.resolveNode` round-trips, we run **one** `tabManager.evaluate` per poll with a self-contained matcher script. Same approach as the existing `a11y_snapshot` (which calls CDP from the main process) but inverted — we walk DOM directly inside the page, because the page already knows its visibility / computed role / accessible name without needing the AX tree.

Computed-role + accessible-name approximation (good enough for FB/LINE):
- Role: explicit `role=""` attr → implicit role mapping (`button` for `<button>`, `link` for `<a href>`, `textbox` for inputs without type/with type=text/email/etc, `img` for `<img>`, `heading` for h1–h6)
- Name: `aria-labelledby` (resolve refs) → `aria-label` → for inputs: `<label for>` → text content (trimmed, max 200 chars) → `title` attr → alt

Visibility: `getBoundingClientRect()` non-zero AND `getComputedStyle().display !== 'none'` AND `visibility !== 'hidden'` AND `opacity !== '0'` (cheap check, skipped if `includeHidden`).

This is approximate (true Playwright uses the full WAI-ARIA spec). For v1 it's sufficient — FB / LINE / 99% of public sites set explicit `role` + `aria-label` on interactive elements.

### 4.4 Wait loop

Plan #3's `withRetry` is for action retry; locator wait is a different shape (it's a poll-until-match-appears, not retry-action-on-error). Implemented inline inside the JS evaluator using the same `setTimeout` polling pattern as `wait_for_selector`:

```js
new Promise((resolve) => {
  const start = Date.now();
  const tick = () => {
    const matches = MATCHER();         // §4.3
    if (matches.length >= 1) return resolve({ ok: true, ...matches[0], count: matches.length });
    if (Date.now() - start > timeoutMs) return resolve({ ok: false, error: 'no match', count: 0 });
    setTimeout(tick, pollIntervalMs);
  };
  tick();
})
```

### 4.5 Ambiguity handling

If first poll returns `count > 1`:
- caller wants the first → done (`selector` is the first)
- caller wants disambiguation → `matches: [...first 5]` is enough info to refine (`get_by_role('button', {name: 'Post (สาธารณะ)'})`)

We do NOT block ambiguity — Playwright's `getByRole` actually throws when `count > 1` and caller didn't say `.first()`. We're permissive: callers can use `count` to decide.

## 5. Impl outline

| File | Change |
|---|---|
| `src/main/mcp/locator-tools.ts` (new) | matcher script string + selector-synth helper + 4 tool registrations |
| `src/main/mcp/tool-groups.ts` | add `'locator'` to `ToolCategory` + `ALL_CATEGORIES` |
| `src/main/mcp/tools.ts` | import + call `registerLocatorTools(...)` from `registerTools()` (or inline if smaller) |
| `src/main/mcp/tool-groups.integration.test.ts` | total `66 → 70`; `locator: 4`; §7.2 row 1+2 expected counts updated |
| `src/main/mcp/locator-tools.test.ts` (new) | unit tests against a fake `evaluate` fn — verify matcher script shape + selector heuristic |
| `README.md` | add "Locators (4)" row + bump tool count `65 → 69` |
| `CHANGELOG.md` | one line |

## 6. Backward compatibility

- All 4 tools are **additive** — no existing tool's schema changes
- `a11y_snapshot` keeps its current shape (already in production use)
- `GHOSTPILOT_TOOLS=core` (which is `nav,tabs,interact,inspect`) does NOT include `locator` → existing core-only deploys keep their tool count; opt in with `GHOSTPILOT_TOOLS=core,locator` or `all`

## 7. Test plan

### 7.1 Unit (`src/main/mcp/locator-tools.test.ts`)

1. matcher script — `buildMatcherScript({role:'button', name:'Post'})` returns a string containing the role + JSON-quoted name
2. selector-synth — given a fake node with `data-testid='login'` → returns `[data-testid="login"]`
3. selector-synth — given `#id` unique → returns `#id`
4. selector-synth — given role+aria-label unique → returns `div[aria-label="x"][role="button"]`
5. selector-synth — fallback to nth-child when nothing unique
6. role normalization — `BUTTON` lowercases to `button` for matching

### 7.2 Integration (live Electron browser)

1. **Static page** — open about:blank, inject a known HTML via `evaluate`, call `get_by_role('button', {name:'OK'})` → returns selector that querySelector resolves to that button
2. **Late-render** — page that inserts a `<button>` after 1.5s; `get_by_role` with `timeoutMs=3000` → resolves within 1.5–1.8s with `count:1`
3. **No match** — `get_by_role('button', {name:'NotThere'})` → resolves at `timeoutMs` with `{ok:false, error:'no match'}`
4. **Ambiguity** — 3 identical buttons → first match returned + `count:3` + 3 entries in `matches`
5. **Test ID** — `get_by_test_id('foo')` against `<button data-testid="foo">` → returns `[data-testid="foo"]` literal

### 7.3 UAT (post-deploy, Mint-side)

- Re-write the FB Post-button selector in mbt-store-bot to use `get_by_role('button', {name: 'โพสต์'})` then `_gp('click', {selector})` — should keep working through FB redesigns (validate next time FB ramps a UI change)
- LINE: `get_by_role('button', {name: 'Friend'})` after agent-browser navigates to LINE → returns the nav button selector

## 8. Risks

| Risk | Mitigation |
|---|---|
| Computed-role mismatch with real Playwright (we use heuristics, they use full WAI-ARIA mapping) | document the gap; for now name+role catches 95% of real pages; if a site fails, caller falls back to existing `evaluate` + custom selector |
| Selector synthesized via nth-child is volatile (DOM shift breaks it) | uniqueness check stays inside the poll loop — re-resolve every call rather than caching globally |
| `evaluate` evaluator runs in page context, observable to anti-bot scripts | matcher script is short, idempotent, no global side effects; doesn't touch fetch/XHR. Equivalent to existing a11y_snapshot which has not been flagged on FB |
| Tool count creep — `tool_categories` introspection becomes the truth, README drifts | integration test asserts both totals (66 → 70 + 1 row updated) — CI catches drift |
| Plan #1 `core` selector doesn't include `locator` → ext deploys lose the new tools | document in README + plan that the `core` shorthand is intentionally narrow; opt in with explicit category |

## 9. Acceptance criteria

- [ ] §5 files changed + tests pass
- [ ] unit: 6/6 ผ่าน (new test file)
- [ ] integration: 5/5 ผ่าน (new test file) — defer integration to v1.1 if any flakiness; static-analysis test in `tool-groups.integration.test.ts` MUST pass
- [ ] `tools/list` shows 4 new tools (`get_by_role`, `get_by_text`, `get_by_label`, `get_by_test_id`)
- [ ] zero regression in existing 66 tools
- [ ] README updated (count `65 → 69`, row added)
- [ ] CHANGELOG entry
- [ ] commit pushed to `tlejay/ghostpilot:main`
- [ ] prod `/Applications/GhostPilot.app` rebuilt + ad-hoc re-signed + smoke-verified

## 10. Deploy

Same pipeline as Plan #3:
1. Techoe implements on `main` (small surface, no separate branch)
2. Self-review: typecheck + unit + integration
3. `pnpm dist` → backup current prod (`.bak-2026-05-18-plan2`) → swap → `codesign --identifier com.madebytle.ghostpilot`
4. Launch + verify `tools/list` shows the 4 new entries
5. Smoke: `get_by_role` against the newtab page (zero matches by design → must return `ok:false` cleanly at `timeoutMs`)

## 11. Open questions (deferred)

- **Q1**: ext_* equivalents (`ext_get_by_*`) — useful for LINE workflows; deferred to v1.1 once embedded version is battle-tested in prod
- **Q2**: getByPlaceholder / getByAltText / getByTitle — defer until a real workload asks for them
- **Q3**: Locator composition (chaining `.filter()`, `.nth()`, `.locator()`) — defer; Playwright power-users want it but FB/LINE workloads rarely need it
- **Q4**: Cache the matcher script in main-process to reduce per-call overhead — measure first, optimize only if it shows up in a flamegraph

---

*Plan written by Techoe 2026-05-18 — proceeding directly to implementation, no UAT gate (small additive surface, follows established Plan #1/#3 pattern).*
