# GhostPilot — Changelog

All notable, user-facing changes to GhostPilot land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semver based on the `package.json` field.

## [Unreleased]

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
