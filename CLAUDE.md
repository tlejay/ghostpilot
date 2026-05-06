# CLAUDE.md — GhostPilot

## What this is

Mac app เบราว์เซอร์แบบ Chrome ที่ Tle ใช้เป็น daily-driver และ **Claude (หรือ MCP client อื่น) ควบคุมได้เต็มรูปแบบผ่าน MCP server ที่ฝังในตัว**

แนวคิดหลัก:
- ใช้ **Electron 33** (Chromium engine จริง) — เปิดเว็บได้เหมือน Chrome
- หลายแท็บผ่าน `WebContentsView` (Electron 30+)
- ฝัง **MCP HTTP server** ใน main process — Claude CLI ต่อเข้ามาแล้วเรียก tool ได้ตรงๆ
- Persisted: history, bookmarks, downloads (ไฟล์ JSON ใน `app.getPath('userData')/profiles/<profile>/`)
- **Multi-profile**: ตั้ง `AI_BROWSER_PROFILE=work` หรือ `personal` ก่อนเปิด → cookies/storage แยกขาดกัน
- **Auth optional**: ตั้ง `AI_BROWSER_MCP_TOKEN=...` เพื่อบังคับ bearer token ที่ MCP endpoint
- **Remote Auth (OAuth 2.1 + PKCE)**: ตั้ง `GHOSTPILOT_OAUTH_PASSWORD=...` เพื่อเปิด OAuth flow สำหรับ Claude.ai custom connector — รองรับ Dynamic Client Registration (RFC 7591), PKCE S256, refresh token rotation; ใช้คู่กับ tunnel (cloudflared/ngrok) เพื่อให้ Claude.ai บน iPhone/Web เชื่อมเข้ามาควบคุมได้อย่างปลอดภัย
- **About + Open Source Licenses windows** เปิดจาก GhostPilot menu — โชว์ลิขสิทธิ์ของ deps ทุกตัวที่ bundle ไป (compliance MIT/ISC/BSD-3 ฯลฯ)

## Tech Stack

| Layer | Tech |
|-------|------|
| App shell | Electron 33 |
| UI | React 18 + TypeScript |
| Bundler | electron-vite (Vite 5, multi-entry renderer) |
| MCP | `@modelcontextprotocol/sdk` v1 (Streamable HTTP transport) |
| HTTP | Express |
| Validation | Zod |
| SQLite (Chrome history import) | `sql.js` (pure-JS WASM, no native build) |
| Icon pipeline | `sharp` SVG→PNG → macOS `iconutil` → `.icns` |
| License gather | `pnpm licenses list --prod --json` → `assets/notices.json` |
| Packaging | electron-builder (DMG, arm64 + x64) |
| Package mgr | pnpm |

## Project Structure

```
src/
├── main/                          # Electron main process (Node.js)
│   ├── index.ts                   # Entrypoint: window + ctx + IPC + boot MCP + dock icon
│   ├── menu.ts                    # App menu (Cmd+T/W/L/R/B, devtools, About, Licenses)
│   ├── legal-windows.ts           # About + Licenses BrowserWindows + readNotices()
│   ├── profile.ts                 # AI_BROWSER_PROFILE → session partition
│   ├── tab-manager.ts             # Tabs as WebContentsView, history hook, devtools toggle, input + cdp_send
│   ├── recorder.ts                # console + network capture (per tab, ring buffer)
│   ├── update-checker.ts          # Polls release manifest; emits CLI banner
│   ├── chrome-import.ts           # Read Chrome's Bookmarks JSON + History SQLite
│   ├── downloads.ts               # session.will-download → JSON + IPC events
│   ├── storage/
│   │   ├── json-store.ts          # Atomic write + per-key write queue
│   │   ├── history.ts             # 5000-entry rolling history
│   │   └── bookmarks.ts           # de-duped by URL
│   └── mcp/
│       ├── server.ts              # Express + StreamableHTTP transport + bearer auth
│       └── tools.ts               # All MCP tool registrations (Zod schemas)
├── preload/
│   ├── index.ts                   # contextBridge → window.api (typed, namespaced)
│   └── index.d.ts                 # Window.api types for renderer
└── renderer/                      # React UI (3 Vite entry points)
    ├── index.html                 # Main browser UI
    ├── about.html                 # About window
    ├── licenses.html              # Open Source Licenses window
    └── src/
        ├── main.tsx               # Mounts <App />
        ├── about.tsx              # About page (icon + madebytle.com + version)
        ├── licenses.tsx           # Licenses page (notices.json viewer)
        ├── App.tsx                # Container + side-panel state
        ├── types.ts               # Mirrors preload types
        ├── components/
        │   ├── GhostIcon.tsx      # Inline SVG icon (used by About)
        │   ├── TabBar.tsx
        │   ├── AddressBar.tsx     # Star + side-panel toggle + profile + MCP badges
        │   └── SidePanel.tsx
        ├── panels/
        │   ├── HistoryPanel.tsx
        │   ├── BookmarksPanel.tsx
        │   └── DownloadsPanel.tsx
        └── styles/
            ├── index.css          # Main UI
            └── legal.css          # About + Licenses windows
assets/                            # Build artefacts (committed)
├── icon.svg                       # Source design
├── icon.icns                      # Generated (Mac app icon)
├── icon.png                       # Generated (1024×1024 fallback / dev dock)
├── icon.iconset/                  # Generated (PNG sizes for iconutil)
└── notices.json                   # Generated (every prod dep + license + text)
scripts/
├── make-icon.mjs                  # SVG → PNGs via sharp → iconutil
├── gather-licenses.mjs            # pnpm licenses list → notices.json
└── patch-electron-dev.mjs         # Rebrand node_modules' Electron.app to GhostPilot (dev mode)
```

## How to develop

```bash
pnpm install
pnpm assets       # regenerate icon + notices (only needed before pnpm dist)
pnpm dev          # Electron with HMR
pnpm typecheck    # tsc on main + renderer
pnpm build        # bundle to out/
pnpm dist         # full release build → release/*.dmg
```

## How Claude CLI controls the browser

App เปิด → MCP server ขึ้นที่ `http://127.0.0.1:9223/mcp` (เปลี่ยนได้ผ่าน `AI_BROWSER_MCP_PORT`)

```bash
claude mcp add --transport http ghostpilot http://127.0.0.1:9223/mcp
```

### Tool surface (51 ตัว)

| Group | Tools |
|-------|-------|
| Tabs (10) | `list_tabs`, `new_tab`, `close_tab`, `activate_tab`, `navigate`, `go_back`, `go_forward`, `reload`, `stop`, `toggle_devtools` |
| Page (7) | `get_page_text`, `get_page_html`, `screenshot`, `evaluate`, `click`, `fill`, `wait_for_selector` |
| Input (3) | `press_key`, `type_text`, `hover` |
| Console (2) | `list_console_messages`, `clear_console_messages` |
| Network (2) | `list_network_requests`, `clear_network_requests` |
| Emulation (3) | `emulate`, `clear_emulation`, `wait_for_text` |
| Accessibility (1) | `a11y_snapshot` |
| Files / dialogs (2) | `upload_file`, `handle_next_dialog` |
| Performance (3) | `performance_start_trace`, `performance_stop_trace`, `lighthouse_audit` |
| CDP (1) | `cdp_send` — raw Chrome DevTools Protocol forwarder |
| History (2) | `history_list`, `history_clear` |
| Bookmarks (3) | `bookmarks_list`, `bookmarks_add`, `bookmarks_remove` |
| Downloads (4) | `downloads_list`, `downloads_cancel`, `downloads_reveal`, `downloads_clear` |
| Chrome import (3) | `list_chrome_profiles`, `import_chrome_bookmarks`, `import_chrome_history` |
| Skills (4) | `list_skills`, `get_skill`, `save_skill`, `delete_skill` — self-teaching playbook registry; works across CLI/web/mobile clients |
| Updates (1) | `check_for_updates` |

ทุก tool ที่รับ `tabId?` → ถ้าไม่ส่ง ใช้ active tab อัตโนมัติ

### chrome-devtools parity

ครบทั้ง 4 ชั้น:

1. **High-level wrappers** — click/fill/type_text/press_key/hover/screenshot/evaluate/wait_for_selector/wait_for_text
2. **Capture buffers** ที่ไม่พึ่ง debugger — list_console_messages, list_network_requests (เปิด DevTools คู่กันได้)
3. **Friendly CDP wrappers** — `a11y_snapshot`, `emulate`, `upload_file`, `handle_next_dialog`, `performance_start_trace` / `performance_stop_trace`, `lighthouse_audit` (ใช้ remote-debugging-port 9224 ที่เปิดอัตโนมัติตอน boot)
4. **`cdp_send`** raw escape hatch — ส่ง CDP method ใดก็ได้ที่ DevTools Protocol รองรับ

## Asset pipeline

ทั้ง icon และ license notices เป็น generated artefacts แต่ commit เข้า repo เพราะ:
- เปิด repo มาแล้วต้องอ่าน license ของ deps ได้ทันทีจาก `assets/notices.json`
- ไอคอนอยู่ใน source ทำให้ README แสดงรูปได้

ถ้าเปลี่ยน deps → รัน `pnpm assets:licenses` ก่อน commit
ถ้าเปลี่ยน `icon.svg` → รัน `pnpm assets:icon` ก่อน commit

## Conventions

- โค้ด + comments เป็นภาษาอังกฤษ, สื่อสารกับ Tle เป็นภาษาไทย
- ห้าม `nodeIntegration: true` ใน BrowserWindow / WebContentsView — ใช้ preload + contextBridge เสมอ
- Tab UI uses `WebContentsView` (Electron 30+ API) — ห้ามกลับไปใช้ `BrowserView` (deprecated)
- New tools → register ใน `src/main/mcp/tools.ts` (Zod schema) แล้ว expose method ที่ `TabManager` หรือ store ที่เกี่ยวข้อง
- New IPC channels → register ใน `src/main/index.ts` แล้ว expose ผ่าน `src/preload/index.ts` (และอัปเดต `index.d.ts` + `renderer/src/types.ts` ถ้ามี type ใหม่)
- Atomic-writable persistence → ผ่าน `JsonStore` เท่านั้น (เพื่อกัน torn writes)
- Renderer pages ที่ต้องเปิดเป็น window แยก (เช่น about, licenses) → เพิ่มเป็น Vite entry ใน `electron.vite.config.ts` แล้วโหลดผ่าน `legal-windows.ts`

## Public-repo readiness

ก่อน push:
- ✅ `LICENSE` (MIT)
- ✅ `.gitignore` ครอบคลุม `node_modules`, `out`, `release`, `.env*`, `*.tsbuildinfo`, `assets/icon.iconset/`
- ✅ `.editorconfig`
- ✅ ไม่มี secret/token ใน source — ใช้ env vars ทั้งหมด
- ✅ `assets/notices.json` ครบทุก prod dep (102 packages, MIT/ISC/BSD-2/3)
- ✅ About window มี link ไป madebytle.com + ปุ่มเปิด Licenses
- ✅ README.md + CLAUDE.md ปัจจุบัน

## Keyboard shortcuts (built into menu)

| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New tab |
| `Cmd+W` | Close tab |
| `Cmd+L` | Focus address bar |
| `Cmd+R` / `Cmd+Shift+R` | Reload / hard reload |
| `Cmd+[` / `Cmd+]` | Back / forward |
| `Esc` | Stop loading |
| `Cmd+Opt+I` | Toggle DevTools (active page) |
| `Cmd+Opt+Shift+I` | Toggle DevTools (chrome UI) |
| `Cmd+B` | Toggle side panel |

## TODO / future

_(backlog เคลียร์แล้ว — ยังไม่มีรายการใหม่)_
