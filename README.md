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
- **Embedded MCP server** with optional bearer-token *or* full OAuth 2.1 + PKCE auth, **57 tools** (see [Tool surface](#tool-surface)) — including a raw `cdp_send` escape hatch giving full Chrome DevTools Protocol access
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

### Tool surface (57)

| Group | Tools |
|-------|-------|
| Tabs (10) | `list_tabs`, `new_tab`, `close_tab`, `activate_tab`, `navigate`, `go_back`, `go_forward`, `reload`, `stop`, `toggle_devtools` |
| Page (7) | `get_page_text`, `get_page_html`, `screenshot`, `evaluate`, `click`, `fill`, `wait_for_selector` |
| Input (3) | `press_key`, `type_text`, `hover` |
| Console (2) | `list_console_messages`, `clear_console_messages` |
| Network (2) | `list_network_requests`, `clear_network_requests` |
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

The MCP server binds to `127.0.0.1` only — no external access.

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

#### Stable tunnel (so the connector URL doesn't break on every restart)

The `cloudflared tunnel --url ...` quick-start above generates a fresh `*.trycloudflare.com` hostname every run, so the Claude.ai connector goes ✗ Failed to connect the moment you restart it. For a permanent setup, point Claude.ai at a hostname **you** own.

**Option A — Cloudflare named tunnel (free, recommended)**

Requires a domain on Cloudflare DNS.

```bash
cloudflared tunnel login                              # one-time browser auth
cloudflared tunnel create ghostpilot                  # creates ~/.cloudflared/<uuid>.json
cloudflared tunnel route dns ghostpilot ghostpilot.example.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: ghostpilot
credentials-file: /Users/<you>/.cloudflared/<uuid>.json
ingress:
  - hostname: ghostpilot.example.com
    service: http://127.0.0.1:9223
  - service: http_status:404
```

Run it (and add a LaunchAgent if you want it to come up on login):

```bash
cloudflared tunnel run ghostpilot
```

The connector URL becomes `https://ghostpilot.example.com/mcp` — stable across every reboot. Add **Cloudflare Access** in front of the hostname for an extra IdP-gated layer beyond the OAuth password.

**Option B — ngrok with a reserved domain (paid)**

```bash
ngrok config add-authtoken <token>
ngrok http --domain=ghostpilot.<your-subdomain>.ngrok-free.app 9223
```

Connector URL: `https://ghostpilot.<your-subdomain>.ngrok-free.app/mcp`.

**If you stick with the throwaway `trycloudflare.com` URL**, you'll need to update the connector every time it rotates: Claude.ai → Settings → Connectors → GhostPilot → **Edit** → paste the new `https://<random>.trycloudflare.com/mcp` URL. Existing OAuth tokens stay valid as long as `GHOSTPILOT_OAUTH_PASSWORD` is unchanged.

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
