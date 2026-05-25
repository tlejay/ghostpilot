# Connect GhostPilot to Claude.ai (web / iPhone / iPad)

This walkthrough covers the **remote** path — adding GhostPilot as a custom connector in Claude.ai so the web UI, iPhone, or iPad client can drive the browser running on your Mac.

For the **local** path (Claude CLI on the same machine), see the [Quick start](./README.md#quick-start) in README — it's two commands and nothing in this file applies.

---

## What you need

1. **GhostPilot** built and running on the machine you want to control (this guide assumes `pnpm dev`; for a packaged build, swap `pnpm dev` for launching the installed `GhostPilot.app`).
2. **Cloudflare tunnel** to expose `http://127.0.0.1:9223` to the public internet so Claude.ai can reach it.
   - **Named tunnel** (recommended): a stable hostname like `ghostpilot.example.com` that survives restarts and never silently dies.
   - **Quick tunnel** (`cloudflared tunnel --url ...`): fine for one-off experiments, but expect to re-paste the URL into Claude.ai every restart.
3. A **password** (`GHOSTPILOT_OAUTH_PASSWORD`) — Claude.ai gets sent here to log in before its first MCP call.

---

## Step 1 — set the OAuth password

`pnpm dev` does **not** auto-source `.env`. If you only define `GHOSTPILOT_OAUTH_PASSWORD` in a `.env` file, the main process never sees it, the OAuth routes never register, and Claude.ai gets an opaque "Couldn't reach the MCP server" with no useful log.

Two ways to make sure the variable actually reaches the Electron main process:

```bash
# Option A — inline on the same line as the command
GHOSTPILOT_OAUTH_PASSWORD='your-strong-password' pnpm dev

# Option B — source first, then launch
set -a; source .env; set +a
pnpm dev
```

To check it landed, look at the console output when GhostPilot starts. With a password set you should see lines mentioning `OAuth 2.1 + PKCE enabled`. Without it you'll only see the bearer-auth + bare-MCP path.

> **Pick a real password.** Anyone with both the tunnel URL and this password gets full control of every logged-in tab. Don't reuse a password you've used elsewhere.

---

## Step 2 — expose port 9223 with Cloudflare

### Option A — named tunnel (recommended, stable)

If you already have a `cloudflared` tunnel configured on the machine (via `cloudflared tunnel create` + DNS routes), just route a hostname at `http://127.0.0.1:9223` and use that hostname as your Server URL in Claude.ai.

```yaml
# example ~/.cloudflared/config.yml
tunnel: <your-tunnel-uuid>
credentials-file: /Users/you/.cloudflared/<your-tunnel-uuid>.json
ingress:
  - hostname: ghostpilot.example.com
    service: http://127.0.0.1:9223
  - service: http_status:404
```

```bash
cloudflared tunnel run <your-tunnel-uuid>
```

→ Server URL for Claude.ai: `https://ghostpilot.example.com/mcp`

This URL is permanent. You'll never paste it again.

### Option B — quick tunnel (fast, ephemeral)

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:9223
# → https://<random-words>.trycloudflare.com
```

Two warnings with quick tunnels:

1. The URL changes every restart. You'll edit the connector in Claude.ai each time.
2. Quick tunnels can silently die — the local `cloudflared` process keeps running, but Cloudflare's edge starts returning 404s. If Claude.ai stops working but `cloudflared` still shows "Registered tunnel connection", that's the symptom. Restart `cloudflared`.

---

## Step 3 — add the connector in Claude.ai

Settings → Connectors → **Add custom connector**.

| Field | Value |
| --- | --- |
| Server URL | `https://ghostpilot.example.com/mcp` (or your quick tunnel URL + `/mcp`) |
| Name | `GhostPilot` (whatever you like) |
| Client ID | leave blank (see below) |
| Client Secret | leave blank (see below) |

On the next message that uses this connector, Claude opens a login page from your tunnel hostname. Enter the password from Step 1. Tokens persist per-profile across GhostPilot restarts.

### A note on Client ID / Secret

GhostPilot currently supports **RFC 7591 dynamic client registration only** — so leaving Client ID/Secret blank is correct. Claude.ai registers a client on first call, GhostPilot stores it, and the tokens flow.

**Downside of dynamic-only**: if anything breaks mid-flow (tunnel flaps, GhostPilot restart, OAuth store gets cleared), Claude.ai will silently retry with a stale dynamic client that no longer exists. The error you see is the same opaque "Couldn't reach the MCP server" with no hint at root cause. Recovery means removing the connector in Claude.ai and re-adding it.

A future GhostPilot release will add `GHOSTPILOT_CLIENT_ID` / `GHOSTPILOT_CLIENT_SECRET` env vars that pre-seed a known static client at boot, so the same Client ID/Secret keep working across restarts. When that lands, this section will get a "Use static credentials" subsection.

---

## Troubleshooting

### "Couldn't reach the MCP server" in Claude.ai

In order of likelihood:

1. **`GHOSTPILOT_OAUTH_PASSWORD` wasn't set when you launched** → OAuth routes never registered. Quit GhostPilot, relaunch with the password in the same shell (Step 1).
2. **Cloudflare quick tunnel died silently** → run `curl https://<your-tunnel>/health` directly. If you get a Cloudflare 404 (not GhostPilot's response), restart `cloudflared`.
3. **Stale dynamic OAuth client** → remove the connector in Claude.ai, add it back.
4. **GhostPilot not running** → check the menu bar / dock; look for the address bar showing `MCP :9223 OK`.

### Verify the tunnel works without Claude.ai

```bash
curl https://<your-tunnel>/health
# expected: {"ok":true,"port":9223,"profile":"default", ...}

# list tabs through the tunnel (no auth needed for /health, but tools need a token)
curl -X POST https://<your-tunnel>/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

If `/health` returns 200 but Claude.ai can't connect, the issue is on the OAuth side (Step 1 or 3). If `/health` is unreachable, the issue is on the tunnel (Step 2).

### Verify env vars actually landed

```bash
# Once GhostPilot is running, ask the OAuth endpoint about itself:
curl https://<your-tunnel>/.well-known/oauth-authorization-server
# → should return a JSON document describing the authorization server.
# 404 means OAuth was never wired up — your password env var didn't make it through.
```

---

## Threat model

Anyone with both the tunnel URL **and** the password gets full control of every tab and any logged-in session in GhostPilot. To keep that surface tight:

- Use a strong, unique password.
- Bring the tunnel down (`Ctrl+C` on `cloudflared`) when you're not using it.
- For production-ish setups, layer Cloudflare Access on top of the named tunnel so you also need to be signed in to Cloudflare to reach the hostname.
- Don't share the tunnel URL anywhere it could be archived or logged.
