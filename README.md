# 👻 GhostPilot

<p align="center">
  <img src="assets/icon.png" alt="GhostPilot icon" width="160" />
</p>

A Chrome-like Mac browser you actually use day-to-day, with an MCP server baked in so **Claude (or any MCP client) can pilot your everyday browsing**.

Built with Electron 33 + React + TypeScript, Vite, and `@modelcontextprotocol/sdk`. From [madebytle.com](https://madebytle.com).

> **Status:** v0.2 — daily-driver-ready. Tabs, history, bookmarks, downloads, multi-profile, DevTools, raw CDP access, Chrome import, OAuth-secured remote control from Claude on iPhone/web, a self-learning skill registry, and a **57-tool MCP surface**.

## Why

Most "AI browsers" are sandboxed CDP shells aimed at headless automation. GhostPilot is the inverse: a real browser you keep open all day, with one extra superpower — Claude can see your tabs, navigate them, fill forms, take screenshots, query history, manage bookmarks, and watch downloads, through a typed MCP API.

## Features

- **Full Chromium** via Electron 33 — every site that runs in Chrome runs here
- **Persistent sessions** — log in once (Facebook, Gmail, anything), close the app, reopen — still logged in. Cookies / localStorage / IndexedDB are kept under `Partitions/profile-<name>/`.
- **Tabs** with `WebContentsView` (modern Electron API)
- **Persistent history** (5,000 entries, per-profile JSON)
- **Bookmarks** (deduped by URL, searchable)
- **Downloads** with progress, cancel, reveal-in-Finder
- **Multi-profile** — `AI_BROWSER_PROFILE=work` and `AI_BROWSER_PROFILE=personal` get separate cookies/storage
- **DevTools** for the active page (`Cmd+Opt+I`)
- **Import from Chrome** — bookmarks (JSON) and history (SQLite via sql.js), one click in the side panel or via MCP
- **Update notifications** — checks GitHub releases (or your own manifest URL) on startup and nags through the MCP CLI banner until you upgrade
- **Embedded MCP server** with optional bearer-token *or* full OAuth 2.1 + PKCE auth, **70 tools** (see [Tool surface](#tool-surface)) — including a raw `cdp_send` escape hatch giving full Chrome DevTools Protocol access, an **External Chrome** tool group (`ext_*`) that drives a separate Chrome instance over CDP (so one MCP server can pilot both the embedded tabs and an external Chrome profile, e.g. LINE Web in `~/.chrome-agent`), Playwright-style **stable selectors** (`get_by_role` / `get_by_text` / `get_by_label` / `get_by_test_id`) that resolve elements by semantic attributes — survives DOM refactors — and **HAR export** (`export_har`) for portable network captures openable in Chrome DevTools / Charles / Postman
- **Mobile-ready connector** — pair with a tunnel (cloudflared / ngrok) and Claude on iPhone, iPad, or web can pilot this browser. No other Mac browser supports this today.
- **Self-learning skill registry** — Claude can save proven step-by-step playbooks (`save_skill`) and replay them on the next run (`list_skills` / `get_skill`). Works across Claude Code CLI, Claude.ai web, and the Claude mobile app.
- **Standard Chrome shortcuts** — `Cmd+T/W/L/R`, `Cmd+[/]`, `Cmd+B` for the side panel
- **About + Open Source Licenses** windows accessible from the GhostPilot menu
- **`ghost` Claude Code agent** — a project-level agent (`.claude/agents/ghost.md`) that ships with the repo. When you use Claude Code inside GhostPilot, `ghost` checks a skill index first, follows proven step-by-step playbooks for known tasks (e.g. navigating to a Facebook friend's profile), and writes a new skill automatically after completing an unfamiliar task — so every browser workflow gets faster over time. Clone the repo and you get it for free.

## Quick start

```bash
pnpm install
pnpm assets          # generate icon.icns + notices.json (only needed before pnpm dist)
pnpm patch-electron  # one-time: rebrand node_modules' Electron.app to GhostPilot
pnpm dev
```

> `pnpm dev` automatically runs `patch-electron` first, but the standalone command is handy after `pnpm install --force` resets the bundle.

The app opens with one tab on Google. The MCP server starts on `http://127.0.0.1:9223/mcp`.

## Hook it up to Claude CLI

```bash
claude mcp add --transport http ghostpilot http://127.0.0.1:9223/mcp
```

Then in any project, run `claude` and try:

> "Open three tabs about EV adoption in Thailand and summarise each."
> "Bookmark the current page under the folder 'reading'."
> "Show me my history from the last hour."
> "Go to events.madebytle.com, screenshot it, and tell me what's on the homepage."

### Tool surface (70)

| Group | Tools |
|-------|-------|
| Tabs (10) | `list_tabs`, `new_tab`, `close_tab`, `activate_tab`, `navigate`, `go_back`, `go_forward`, `reload`, `stop`, `toggle_devtools` |
| Page (7) | `get_page_text`, `get_page_html`, `screenshot`, `evaluate`, `click`, `fill`, `wait_for_selector` |
| Input (3) | `press_key`, `type_text`, `hover` |
| Console (2) | `list_console_messages`, `clear_console_messages` |
| Network (3) | `list_network_requests` — captured requests with rich filters (`method` scalar/array, `status` scalar/array, `urlPattern` substring or `/regex/flags`, `mimeType` substring, `since` ISO/epoch, `failedOnly` shortcut); `clear_network_requests`; `export_har` — dump the filtered capture to a HAR 1.2 file openable in Chrome DevTools / Charles / Postman (v1: no response body) |
| Emulation (3) | `emulate` (device + UA + network), `clear_emulation`, `wait_for_text` |
| Accessibility (1) | `a11y_snapshot` — semantic-tree dump for AI navigation |
| Files / dialogs (2) | `upload_file`, `handle_next_dialog` |
| Performance (3) | `performance_start_trace`, `performance_stop_trace`, `lighthouse_audit` |
| CDP (1) | `cdp_send` — raw Chrome DevTools Protocol forwarder |
| History (2) | `history_list`, `history_clear` |
| Bookmarks (3) | `bookmarks_list`, `bookmarks_add`, `bookmarks_remove` |
| Downloads (4) | `downloads_list`, `downloads_cancel`, `downloads_reveal`, `downloads_clear` |
| Media (3) | `list_media`, `download_media`, `clear_media` — sniffs video/audio/HLS/DASH on the active tab |
| Video downloader (3) | `ytdlp_status`, `download_with_ytdlp`, `list_ytdlp_jobs` — downloads anything that plays in a browser tab |
| Chrome import (3) | `list_chrome_profiles`, `import_chrome_bookmarks`, `import_chrome_history` |
| Skills (4) | `list_skills`, `get_skill`, `save_skill`, `delete_skill` — reusable browser-automation playbooks shared across every MCP client |
| Desktop (2) | `desktop_screenshot` — capture the Mac desktop (system-level, outside the browser tab; needs Screen Recording TCC); `set_window_bounds` — resize/move the GhostPilot window (persists to `<userData>/window-bounds.json`) |
| External Chrome (6) | `ext_list_tabs`, `ext_navigate`, `ext_evaluate`, `ext_click`, `ext_a11y_snapshot`, `ext_screenshot` — drive a SEPARATE Chrome process over CDP (raw WebSocket, via the `ws` package). All accept an optional `cdp_url` (default `http://127.0.0.1:9222`) and `target_id` (default = first page-type tab). Useful when a workflow needs a real Google profile / extension that GhostPilot's embedded session can't host (e.g. LINE Web in `~/.chrome-agent`). |
| Locators (4) | `get_by_role`, `get_by_text`, `get_by_label`, `get_by_test_id` — Playwright-style stable selectors: resolve an element by semantic attributes (role + accessible name, visible text, form-control label, `data-testid`) and return a CSS selector you can pass to `click` / `fill` / `wait_for_selector`. Each tool waits up to `timeoutMs` (default 3000) for ≥1 match. Pairs with auto-retry (Plan #3): the returned selector stays usable across re-renders. Embedded only in v1 — `ext_get_by_*` deferred. |
| Updates (1) | `check_for_updates` |

Every tool that takes `tabId` falls back to the active tab when omitted.

#### How does this compare to chrome-devtools MCP?

GhostPilot is at full parity for the surfaces an LLM agent actually uses:

1. **High-level wrappers** for the things you do daily: `click`, `fill`, `type_text`, `press_key`, `hover`, `screenshot`, `evaluate`, `wait_for_selector`, `wait_for_text`.
2. **Capture buffers** matching chrome-devtools' `list_console_messages` and `list_network_requests` — backed by `webContents.on('console-message')` and `session.webRequest`, so they coexist with DevTools.
3. **Friendly wrappers** for everything chrome-devtools ships separately:
   - `a11y_snapshot` ← `Accessibility.getFullAXTree`
   - `emulate` ← `Emulation.setDeviceMetricsOverride` + `setUserAgentOverride` + `Network.emulateNetworkConditions`
   - `upload_file` ← `DOM.setFileInputFiles`
   - `handle_next_dialog` ← `Page.javascriptDialogOpening` / `handleJavaScriptDialog`
   - `performance_start_trace` / `performance_stop_trace` ← `Tracing.start`/`Tracing.end` + IO stream
   - `lighthouse_audit` ← `lighthouse` package against the always-on remote-debugging port (default 9224)
4. **Raw CDP escape hatch** via `cdp_send`. Anything chrome-devtools ever did is one tool call away — try `cdp_send method="Browser.getVersion"` to confirm.

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `AI_BROWSER_MCP_PORT` | `9223` | Port for the embedded MCP server |
| `AI_BROWSER_MCP_TOKEN` | _unset_ | If set, `/mcp` requires `Authorization: Bearer <token>` |
| `GHOSTPILOT_OAUTH_PASSWORD` | _unset_ | If set, the MCP server enables OAuth 2.1 + PKCE with this password gating the authorize step. Required for connecting Claude.ai web / iPhone over a tunnel. |
| `AI_BROWSER_PROFILE` | `default` | Profile name (alphanumeric + `_-`, ≤32 chars). Each profile has isolated cookies, storage, history, bookmarks, and downloads. |
| `AI_BROWSER_UPDATE_URL` | GitHub releases | Manifest URL for update checks. JSON shape: `{ "version": "0.3.0", "url": "...", "notes": "..." }`. Default uses the GitHub releases API. |
| `AI_BROWSER_UPDATE_NAG` | `on` | Set to `off` to silence the update banner injected into MCP responses. |
| `AI_BROWSER_DEBUG_PORT` | `9224` | Remote debugging port exposed to Lighthouse and any external CDP client. |
| `GHOSTPILOT_TOOLS` | _unset_ (= `all`) | Comma-separated list of tool categories to expose. Trims the MCP `tools/list` payload so clients with smaller context windows aren't billed for tools they'll never call. See [Trimming the tool inventory](#trimming-the-tool-inventory) below. |

The MCP server binds to `127.0.0.1` only — no external access.

### Trimming the tool inventory

GhostPilot exposes ~57 MCP tools by default. Clients that only need a slice (a scraping bot, a download-only helper, a screenshot harness) can opt into specific categories via `GHOSTPILOT_TOOLS`:

```bash
# Mint's default profile — page navigation + interaction + inspection (= 22 tools).
GHOSTPILOT_TOOLS=core pnpm dev

# Explicit category list (case-insensitive, whitespace tolerant).
GHOSTPILOT_TOOLS=nav,interact,inspect,network pnpm dev

# All except yt-dlp and lighthouse.
GHOSTPILOT_TOOLS=all,-ytdlp,-performance pnpm dev
```

Tokens recognised in the env value:

- bare category name → enable that category
- `-name` → subtract that category
- `all` → every category (the default when the var is unset)
- `core` → shorthand for `nav,tabs,interact,inspect`
- unknown name → logged as a `WARN`, ignored

The `lifecycle` group (`stop`, `check_for_updates`, `tool_categories`) is always on regardless of the env var, so the operator can introspect or shut down the server.

| Category | Tools |
|---|---|
| `nav` | `navigate`, `go_back`, `go_forward`, `reload` |
| `tabs` | `list_tabs`, `new_tab`, `close_tab`, `activate_tab` |
| `interact` | `click`, `fill`, `type_text`, `press_key`, `hover`, `upload_file`, `handle_next_dialog` |
| `inspect` | `screenshot`, `get_page_text`, `get_page_html`, `a11y_snapshot`, `evaluate`, `wait_for_selector`, `wait_for_text` |
| `network` | `list_network_requests`, `clear_network_requests` |
| `console` | `list_console_messages`, `clear_console_messages` |
| `performance` | `performance_start_trace`, `performance_stop_trace`, `lighthouse_audit` |
| `media` | `list_media`, `download_media`, `clear_media` |
| `ytdlp` | `download_with_ytdlp`, `list_ytdlp_jobs`, `ytdlp_status` |
| `downloads` | `downloads_list`, `downloads_cancel`, `downloads_clear`, `downloads_reveal` |
| `history` | `history_list`, `history_clear`, `import_chrome_history` |
| `bookmarks` | `bookmarks_list`, `bookmarks_add`, `bookmarks_remove`, `import_chrome_bookmarks` |
| `emulate` | `emulate`, `clear_emulation`, `toggle_devtools` |
| `profiles` | `list_chrome_profiles` |
| `skills` | `list_skills`, `save_skill`, `get_skill`, `delete_skill` |
| `cdp` | `cdp_send` (raw Chrome DevTools Protocol passthrough) |
| `lifecycle` | `stop`, `check_for_updates`, `tool_categories` (always on) |

Call `tool_categories` at any time to see what's enabled in the current process and how many tools that translates to. Selection is resolved once at startup — restart the MCP server to apply a new env value.

### Switching profiles

```bash
AI_BROWSER_PROFILE=work pnpm dev
# or, after building:
AI_BROWSER_PROFILE=personal open -a "GhostPilot"
```

### Auth-protected MCP (Claude Code CLI)

```bash
export AI_BROWSER_MCP_TOKEN=$(openssl rand -hex 24)
pnpm dev
```

```bash
claude mcp add --transport http ghostpilot http://127.0.0.1:9223/mcp \
  --header "Authorization: Bearer $AI_BROWSER_MCP_TOKEN"
```

### Connect from Claude.ai (web / iPhone / iPad)

GhostPilot ships an OAuth 2.1 + PKCE provider so any MCP client that speaks OAuth — including Claude on every surface — can authorize and pilot the browser through a public tunnel.

```bash
# 1. Pick a strong password — it's the only thing gating remote control.
export GHOSTPILOT_OAUTH_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)

# 2. Boot GhostPilot.
pnpm dev      # or open the installed app

# 3. In another terminal, expose port 9223 over HTTPS.
brew install cloudflared      # one-time
cloudflared tunnel --url http://127.0.0.1:9223
# → prints "https://<random>.trycloudflare.com"
```

In Claude.ai → Settings → Connectors → **Add custom connector**:

- **Remote MCP server URL**: `https://<your-tunnel>.trycloudflare.com/mcp`
- Leave Client ID / Secret blank — GhostPilot supports RFC 7591 dynamic client registration.

On the next call, Claude opens a login page from your tunnel; type the password to authorize. Tokens persist across restarts (per-profile). The connector then syncs to the Claude mobile app, so iPhone can drive the browser too.

> **Threat model.** Anyone who has both the tunnel URL **and** the password gets full control of every tab in this browser, including any logged-in sessions. Use a strong password, keep the tunnel down when not in use, and prefer named Cloudflare tunnels with Cloudflare Access on top for production setups.

## Build a DMG

```bash
pnpm dist
```

This regenerates the icon + license notices, builds the renderer, then runs electron-builder. Outputs `release/GhostPilot-<version>-arm64.dmg` and `-x64.dmg`.

## About + Open Source Licenses

GhostPilot ships with two legal-compliance windows reachable from the **GhostPilot** menu and the **Help** menu:

- **About GhostPilot** — version, runtime info, link to madebytle.com, button to open the Licenses window.
- **Open Source Licenses…** — a searchable list of every production package bundled in the app, with its license, author, homepage, and full license text. The list is generated at build time from `pnpm licenses list --prod --json` and shipped as `notices.json`.

Generate the notices manually anytime with:

```bash
pnpm assets:licenses
```

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  Electron main process                                 │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐   │
│  │ TabManager   │  │ Storage     │  │ MCP server   │   │
│  │  · Web-      │  │  · history  │  │  · Express   │   │
│  │    Contents  │  │  · book-    │  │  · Stream-   │   │
│  │    View      │  │    marks    │  │    ableHTTP  │   │
│  │  · partition │  │  · downloads│  │  · OAuth 2.1 │   │
│  │              │  │  · skills   │  │  · 57 tools  │   │
│  └─────┬────────┘  └─────┬───────┘  └──────┬───────┘   │
│        │                 │                 │           │
│        └─────────────────┼─────────────────┘           │
│                    IPC   │                             │
└──────────────────────────┼─────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │   Renderer (Vite)       │
              │   index · about ·       │
              │   licenses · newtab     │
              └─────────────────────────┘
```

- **Main process** (`src/main/`) owns the window, tab manager, storage stores, downloads, MCP server, and About/Licenses windows.
- **Preload** (`src/preload/`) exposes a typed `window.api` via `contextBridge`. No `nodeIntegration`. Tools, history, bookmarks, downloads, profile, and app metadata are namespaced.
- **Renderer** (`src/renderer/`) has three Vite entry points: the main UI, About, and Licenses pages — each a standalone React app.
- **MCP server** uses `StreamableHTTPServerTransport`, builds a fresh `McpServer` per request (stateless), and resolves all tools against singleton stores. Optional bearer-token middleware.
- **Persistence**: per-profile JSON files at `~/Library/Application Support/GhostPilot/profiles/<profile>/`, written atomically through a serialized write queue.

## Project structure

```
src/main/        # Electron main: tabs, storage, downloads, mcp/, legal windows
src/preload/     # contextBridge → window.api (typed)
src/renderer/    # 3 Vite entries: index.html, about.html, licenses.html
assets/          # icon.svg, generated icon.icns + icon.png + notices.json
scripts/         # make-icon.mjs, gather-licenses.mjs
electron.vite.config.ts
tsconfig.{json,node.json,web.json}
```

See `CLAUDE.md` for the full per-file map and contribution conventions.

## Contributing

PRs welcome. Three rules:

1. No `nodeIntegration: true` anywhere. All renderer ↔ main traffic goes through `contextBridge`.
2. New MCP tools live in `src/main/mcp/tools.ts` with a Zod `inputSchema` and update both `README.md` and `CLAUDE.md`.
3. New runtime dependencies must show up in the Licenses window — that's automatic if `pnpm assets:licenses` is run before shipping.

## License

MIT — see [LICENSE](./LICENSE).

Built by [Tle](https://madebytle.com) — from madebytle.com 👻
