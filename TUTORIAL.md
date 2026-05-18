# Tutorial — Capture a HAR of a Google search and find every failing request

This walks one realistic end-to-end task using the GhostPilot MCP API.

Goal: open Google, run a search, capture every request the page made, filter to the HTTP failures (`status >= 400`), and dump them to a HAR file you can open in Chrome DevTools / Charles / Postman / k6.

## Prerequisites

- GhostPilot running (`pnpm dev` or the installed `.app`).
- MCP endpoint reachable at `http://127.0.0.1:9223/mcp`.
- A way to make MCP calls. The examples below use raw `curl` for portability; in practice you'd usually do this through the Claude CLI (`claude mcp add ...`) or any MCP SDK.

For brevity each `curl` is abbreviated as:

```
mcp <tool> <json-args>
```

— which means:

```bash
curl -s -X POST http://127.0.0.1:9223/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":<json-args>}}'
```

## Step 1 — Navigate to Google

```
mcp navigate {"url":"https://www.google.com"}
```

Response shape:

```json
{ "ok": true, "url": "https://www.google.com/", "title": "Google" }
```

`navigate` waits for DOM-ready before returning. If a redirect happened, `url` reflects the final URL.

## Step 2 — Clear any prior captures

```
mcp clear_network_requests {}
```

Response: `{ "ok": true, "cleared": <n> }`. This zeroes the in-memory ring buffer so the upcoming search is the only traffic in the capture.

## Step 3 — Find the search box (stable locator)

```
mcp get_by_role {"role":"combobox","name":"Search","timeoutMs":3000}
```

Response:

```json
{
  "ok": true,
  "count": 1,
  "selector": "textarea[aria-label='Search']",
  "role": "combobox",
  "name": "Search",
  "matches": [{ "tag": "textarea", "ariaLabel": "Search" }],
  "waitedMs": 36
}
```

`get_by_role` is the v0.4.0 Playwright-style locator. It resolves by ARIA role + accessible name and returns a uniqueness-verified CSS selector. Hand that selector to the next steps — it survives DOM re-renders (Google's homepage swaps the search field type periodically).

## Step 4 — Fill the search field and submit

```
mcp fill {"selector":"textarea[aria-label='Search']","text":"electron mcp ghostpilot"}
mcp press_key {"key":"Enter"}
```

Both wrapped in auto-retry + auto-wait. `fill` waits for the box to be visible + stable (200ms bounding-box still), retries on transient DOM errors up to `retries:3` with backoff `[100, 300, 800]ms`. `press_key` retries on transient errors too.

Response (each): `{ "ok": true }`.

## Step 5 — Wait for results

```
mcp wait_for_text {"text":"results","timeoutMs":10000}
```

Response: `{ "ok": true, "waitedMs": 412 }`. The results page renders "About X results" near the top; waiting on that text proves the search round-trip completed and the page is settled.

If you'd rather watch a specific selector instead of text, `wait_for_selector { selector, timeoutMs }` does the same.

## Step 6 — Inspect failures inline

Before exporting, get a quick look:

```
mcp list_network_requests {"failedOnly":true}
```

Response (shape):

```json
{
  "ok": true,
  "count": 4,
  "entries": [
    {
      "url": "https://www.google.com/sorry/index?...",
      "method": "GET",
      "status": 429,
      "mimeType": "text/html",
      "startTime": 1747512345678,
      "durationMs": 187,
      "requestHeaders": { "...": "..." },
      "responseHeaders": { "...": "..." },
      "statusLine": "HTTP/1.1 429 Too Many Requests"
    }
  ]
}
```

`failedOnly: true` is a shortcut for `status >= 400 || error != null`. You can also be explicit with `status: [400, 401, 403, 404, 429, 500, 502, 503, 504]`.

Other axes (AND semantics):

| Field | Notes |
|---|---|
| `method` | `"POST"` or `["GET","POST"]` |
| `urlPattern` | substring, or `/regex/flags` |
| `mimeType` | substring of response `Content-Type` |
| `since` | ISO timestamp or epoch ms |

## Step 7 — Export the failures to a HAR

```
mcp export_har {"failedOnly":true,"path":"/tmp/google-failures.har","pretty":true}
```

Response:

```json
{
  "ok": true,
  "path": "/tmp/google-failures.har",
  "entryCount": 4,
  "bytesWritten": 8132
}
```

Defaults: if `path` is omitted, `export_har` writes to `/tmp/ghostpilot-har-<ISO>.har`. The same filter shape as `list_network_requests` applies — pass any of `method`/`status`/`urlPattern`/`mimeType`/`since`/`failedOnly`.

**v1 caveat:** response bodies are not captured (`content.size = -1`, no `content.text`). All major HAR readers accept this shape.

## Step 8 — Open in Chrome DevTools

1. Open Chrome (your everyday one, not GhostPilot — though it works there too).
2. Open DevTools → **Network** tab.
3. Right-click an empty row → **Import HAR file…** → pick `/tmp/google-failures.har`.

You now have the full request list, status codes, headers, and timing waterfall — same as if you'd recorded it in Chrome itself. Send it to a teammate, archive it for a bug report, or feed it to k6 / Postman to replay the requests.

## Variations

- **Status-specific list:** `export_har {"status":[400,403,404,500,502,503,504],"path":"/tmp/4xx-5xx.har"}` — explicit set instead of `failedOnly`.
- **Filter to one endpoint family:** `export_har {"urlPattern":"/api/","path":"/tmp/api.har"}` (substring) or `{"urlPattern":"/\\.(png|jpg|webp)$/i"}` (regex).
- **Time-bounded:** `export_har {"since":"2026-05-18T13:00:00+07:00","path":"/tmp/since-1pm.har"}` — drop everything before the timestamp.
- **Headless capture:** start GhostPilot with `--headless` (or `GHOSTPILOT_HEADLESS=1`) and the entire flow above works without a visible window — useful for CI HAR captures.

## What you just used

- `navigate` — drive the active tab.
- `clear_network_requests` / `list_network_requests` / `export_har` — the Network capture pipeline (Plan #6).
- `get_by_role` — Playwright-style stable selector (Plan #2).
- `fill` / `press_key` — wrapped in auto-retry + auto-wait (Plan #3).
- `wait_for_text` — wait for the results page to settle.

That's eight tools to capture, filter, and ship a portable HAR — and the same flow runs identically in default and headless mode. From here, browse the [full tool surface](./README.md#tool-surface-71) or pair locators with `cdp_send` for raw DevTools-Protocol escape hatches.
