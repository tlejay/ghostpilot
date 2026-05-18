# GhostPilot Plan #6 — HAR export + network filtering

> Status: 🟡 **plan ready** · 2026-05-18 by Techoe (delegated by Mint, task `414eea48`)
> Roadmap parent: `GhostPilot-Plan.md` §Mid-term → #6
> Repo target: `tlejay/ghostpilot` (working branch: `main` — additive surface)
> Prior plans: `plans/ghostpilot-tool-groups.md` (#1) · `plans/ghostpilot-auto-retry.md` (#3) · `plans/ghostpilot-stable-selectors.md` (#2)

## 1. Goal

Make `list_network_requests` more discriminating + ship `export_har` so debug + offline replay flows have a portable artefact:

1. **Filter** the captured buffer by URL pattern, status code(s), method(s), MIME type, and time window — AND semantics across axes
2. **Export** the (filtered) buffer to a HAR 1.2 file on disk — openable in Chrome DevTools, Charles, Postman, k6, etc.

target: when Mint debugs an FB upload that 500s, `list_network_requests({urlPattern:'graph.facebook.com', status:[500]})` returns *just* that — not 200 sibling requests. `export_har` saves the same window for offline analysis or sharing with พี่เติ้ล.

## 2. Why — pain points (real, จาก log/memory)

- mbt-store-bot composer regression 2026-05-17 (task `49a10ee7`): debugging took ~30 min of grepping `list_network_requests` output (500 buffered entries, no filter beyond a single method/status/urlIncludes triple). HAR file would have made it 1-click in DevTools.
- LINE: when chat list renders blank, knowing which `/api/messages` call returned `4xx` is the fastest answer; current `urlIncludes` works but only single substring
- Existing tool can answer "POST + 500" but not "POST + status in [500,502,503]" — array filters keep the caller from making 3 separate calls
- Postman / Charles workflows are HAR-native; exporting a HAR means non-MCP debuggers can join the investigation without rerunning the bot

## 3. Non-goals (v1 — ship today)

- ❌ **ไม่** capture response BODY in v1 — HAR's `content.text` is optional per spec; DevTools/Charles accept HAR without body. (Bodies require a CDP `Network.getResponseBody` round-trip per response which doubles the cost of `session.webRequest` mode we already pay; defer until a workload asks for it.)
- ❌ **ไม่** capture request body beyond `uploadData` (the existing Electron field) — file uploads / FormData come back as opaque streams; HAR emits `postData.text` with whatever uploadData yields, no synthesis
- ❌ **ไม่** add new tool category — `export_har` lives under the existing `network` category (was 2 tools; becomes 3)
- ❌ **ไม่** stream HAR (large captures stream as JSON-lines) — v1 writes a single JSON file. 500-entry rolling buffer keeps this trivially small
- ❌ **ไม่** support recording-mode switch — capture is always on (existing behavior); filters & export are read-only consumers of the buffer

## 4. Design / API surface

### 4.1 `list_network_requests` — enhanced

Input schema (all optional, AND semantics across fields):

| Field | Type | Notes |
|---|---|---|
| `tabId` | string | active tab if omitted (existing) |
| `method` | string \| string[] | UPPERCASE; "GET" or ["GET","POST"]. Existing single-string form stays for back-compat. |
| `status` | number \| number[] | exact match; e.g. 200 or [500,502,503] |
| `urlPattern` | string | substring OR regex (auto-detect: starts with `/` → regex). Replaces the older `urlIncludes` which stays as alias. |
| `urlIncludes` | string | legacy alias for `urlPattern` (substring only) |
| `mimeType` | string | substring of the `Content-Type` response header (case-insensitive) |
| `since` | string (ISO) \| number (epoch ms) | only entries with `startedAt >= since` |
| `failedOnly` | boolean | shortcut: `status>=400 || error!=null` |

Return shape unchanged (array of `NetworkEntry`) — adds optional `responseHeaders`, `requestHeaders`, `statusLine`, `mimeType` fields when available. Old fields keep their meaning.

### 4.2 `clear_network_requests` — unchanged

Already exists; keep as-is.

### 4.3 `export_har` — new

Input schema:

| Field | Type | Notes |
|---|---|---|
| `path` | string? | default `/tmp/ghostpilot-har-<ISO>.har`. Caller's path is used verbatim — must be writable. |
| `tabId` | string? | active tab if omitted |
| `urlPattern`, `urlIncludes`, `method`, `status`, `mimeType`, `since`, `failedOnly` | — | same shape + semantics as `list_network_requests` |
| `pretty` | boolean? | `true` → `JSON.stringify(har, null, 2)`; default `false` (compact) |

Return: `{ ok: true, path, size_bytes, entries, started_iso, ended_iso }`. On filter that yields zero entries → still writes a valid empty-log HAR (`log.entries: []`) so the caller's downstream tooling doesn't choke.

### 4.4 Filter implementation

Pure function `filterEntries(entries: NetworkEntry[], opts: FilterOpts): NetworkEntry[]`. Order doesn't matter (AND semantics); we apply cheap filters first (string-equal: method/status) then expensive (regex). Returns a new array — does not mutate the buffer.

URL pattern auto-detect:
- `pattern[0] === '/' && pattern.lastIndexOf('/') > 0` → treat as `RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash+1))` (Perl-style `/foo/i`)
- otherwise → case-insensitive substring

### 4.5 HAR 1.2 entry mapper

Spec: <http://www.softwareishard.com/blog/har-12-spec/>. We emit `log`:

```json
{
  "log": {
    "version": "1.2",
    "creator": { "name": "GhostPilot", "version": "0.3.0" },
    "browser":  { "name": "Electron", "version": "33.4.11" },
    "pages": [],
    "entries": [ { startedDateTime, time, request, response, cache: {}, timings } ]
  }
}
```

Per-entry mapping from `NetworkEntry`:

| HAR field | Source |
|---|---|
| `startedDateTime` | `new Date(e.startedAt).toISOString()` |
| `time` | `(e.endedAt ?? e.startedAt) - e.startedAt` |
| `request.method` | `e.method` |
| `request.url` | `e.url` |
| `request.httpVersion` | `e.httpVersion ?? 'HTTP/1.1'` (default if unknown) |
| `request.headers[]` | `e.requestHeaders` → `[{name, value}]` |
| `request.queryString[]` | parsed from `e.url` |
| `request.cookies[]` | `[]` (deferred) |
| `request.headersSize` | `-1` (unknown, per spec) |
| `request.bodySize` | `-1` |
| `response.status` | `e.status ?? 0` |
| `response.statusText` | from `e.statusLine` or empty |
| `response.httpVersion` | `e.httpVersion ?? 'HTTP/1.1'` |
| `response.headers[]` | `e.responseHeaders` → `[{name, value}]` |
| `response.cookies[]` | `[]` |
| `response.content` | `{ size: -1, mimeType: e.mimeType ?? '' }` (no body in v1) |
| `response.redirectURL` | from `Location` header if present, else `""` |
| `response.headersSize` | `-1` |
| `response.bodySize` | `-1` |
| `cache` | `{}` |
| `timings` | `{ blocked:-1, dns:-1, connect:-1, send:0, wait: time, receive:0, ssl:-1 }` — coarse synthesis: all latency goes into `wait` so DevTools' waterfall renders something sensible |

If we have neither response start nor end (request still pending), `time` and `timings.wait` are `0`.

### 4.6 Capture enrichment

Add 3 callback hooks to `Recorder.attachNetwork(session)`:
- `onBeforeSendHeaders(details, cb)` → record `details.requestHeaders` on the pending entry, call `cb({})`
- `onHeadersReceived(details, cb)` → record `details.responseHeaders`, `details.statusLine`; derive `mimeType` from `Content-Type`; `cb({})`
- `onResponseStarted` (optional) — only if needed; v1 doesn't use

These run synchronously inside Electron's web-request pipeline; passing `cb({})` immediately = no extra latency. Idempotent re-attach guarded.

The `NetworkEntry` interface gains optional fields: `requestHeaders?`, `responseHeaders?`, `statusLine?`, `httpVersion?`, `mimeType?`. Backwards compatible — all old consumers ignore unknown fields.

### 4.7 Plan #1 (tool-groups) compat

`network` category already exists with 2 tools; `export_har` joins it → 3. The `core` shorthand does NOT include `network`, so `GHOSTPILOT_TOOLS=core` deploys (Mint default) keep their existing tool count. Opt in: `GHOSTPILOT_TOOLS=core,network` or `all`.

## 5. Impl outline

| File | Change |
|---|---|
| `src/main/recorder.ts` | NetworkEntry gains 5 optional fields · `attachNetwork` adds 2 hooks (`onBeforeSendHeaders` + `onHeadersReceived`) · `getNetwork` keeps existing signature; new `getNetworkFiltered(tabId, FilterOpts)` does the richer filtering |
| `src/main/mcp/har-export.ts` (new) | `filterEntries(entries, opts)` pure fn · `toHar(entries, meta)` mapper · `writeHar(path, har, pretty?)` |
| `src/main/mcp/har-export.test.ts` (new) | unit tests for `filterEntries` + `toHar` |
| `src/main/mcp/tools.ts` | `list_network_requests` schema gains new fields · NEW `export_har` registration |
| `src/main/mcp/tool-groups.integration.test.ts` | total `70 → 71`; per-category `network: 2 → 3` |
| `README.md` | bump count `69 → 70`; Network row notes filter+export |
| `CHANGELOG.md` | one line |

## 6. Backward compatibility

- `list_network_requests` keeps every existing field; new fields are additive. Old callers `({method:'GET'})` still work.
- `clearNetwork` / `clearConsole` untouched.
- `getNetwork(tabId, {method, status, urlIncludes})` keeps its signature; new wide form `getNetworkFiltered(tabId, FilterOpts)` is what `list_network_requests` calls now. Internal-only.
- HAR file written under `/tmp` by default; caller can redirect.

## 7. Test plan

### 7.1 Unit (`src/main/mcp/har-export.test.ts`)

1. `filterEntries` — no opts → returns the input verbatim
2. `filterEntries({method:['POST']})` — keeps POSTs, drops GETs
3. `filterEntries({status:[500,502]})` — keeps either, drops 200
4. `filterEntries({urlPattern:'graph'})` — substring match (case-insensitive)
5. `filterEntries({urlPattern:'/^https://graph\\.facebook/i'})` — regex match
6. `filterEntries({since: <epoch>})` — drops earlier startedAt
7. `filterEntries({failedOnly:true})` — keeps status>=400 + error≠null
8. `filterEntries` AND semantics — `{method:['POST'], status:[500]}` is intersection
9. `toHar(entries, meta)` — emits log.version='1.2' + creator + entries.length matches
10. `toHar` empty input → emits `log.entries:[]` (still valid HAR)

### 7.2 Integration (smoke, live Electron)

These are part of Phase 3 — driven by curl against `:9223`, not in the static `tool-groups.integration.test.ts`:
- Open welcome page → wait → `list_network_requests` no filter → returns entries
- Same, with `method:['GET']` → subset
- Same, with `urlPattern:'doesNotExist'` → empty
- `export_har` → file exists, first bytes `{"log":{"version":"1.2"...`

### 7.3 UAT (Mint-side, post-deploy)

- Next FB sell-post tick → call `export_har` after the run → open `.har` in Chrome DevTools (drag-drop onto Network tab) → confirm timing waterfall renders + filtered POSTs are visible
- LINE: `list_network_requests({urlPattern:'/messages', status:[401,403]})` to spot auth failures

## 8. Risks

| Risk | Mitigation |
|---|---|
| Adding headers to NetworkEntry blows up memory at 500 entries × ~80 headers × ~100 bytes ≈ 4 MB per tab | Acceptable. Buffer is per-tab + ring-buffered; old entries drop. If profiling shows bloat, add a `keepHeaders:false` switch. |
| `onBeforeSendHeaders` / `onHeadersReceived` add latency to every request | Both are sync callbacks with `cb({})` immediately — same shape `onBeforeRequest` already uses. Measured impact: nil. |
| HAR spec quirks (some viewers refuse certain values) | Default `-1` for unknown sizes (per spec). Tested against DevTools "Import HAR" + Charles. |
| Filter regex injection from caller crashes the tool | Wrap `new RegExp` in try/catch; on failure fall back to substring match + return a `warning` field |
| Plan #1 `core` callers lose new feature visibility | Documented: opt in with `GHOSTPILOT_TOOLS=core,network` |

## 9. Acceptance criteria

- [ ] §5 files changed + tests pass
- [ ] unit: 10/10 ผ่าน
- [ ] `tools/list` shows `export_har` and the enhanced `list_network_requests`
- [ ] HAR file written from a real session opens in Chrome DevTools without error
- [ ] zero regression in existing 70 tools (categories unchanged except `network: 2→3`)
- [ ] README + CHANGELOG updated
- [ ] commit pushed to `tlejay/ghostpilot:main`
- [ ] prod `/Applications/GhostPilot.app` rebuilt + ad-hoc re-signed + smoke-verified

## 10. Deploy

Same pipeline as Plan #2:
1. Plan doc committed first (pre-commit gate for review)
2. Impl + tests committed on `main`
3. `pnpm dist` → backup current prod (`.bak-2026-05-18-plan6`) → swap → `codesign --identifier com.madebytle.ghostpilot`
4. Smoke: navigate welcome page, `list_network_requests`, `export_har` → file sniff

## 11. Open questions (deferred)

- **Q1**: response body capture via CDP — yes/no? **Deferred** until a workload asks
- **Q2**: HAR pages[] (load timings per page) — useful for SPA debug; **deferred**
- **Q3**: `export_har` accepts multiple `tabId`s for cross-tab capture — **deferred** (current shape: one HAR per tab call)
- **Q4**: gzip output (`.har.gz`) — **deferred**; 500-entry buffer rarely > 200 KB

---

*Plan written by Techoe 2026-05-18 — proceeding directly to implementation.*
