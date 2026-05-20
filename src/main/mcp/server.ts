import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools, type RegistrationStats, type ToolDeps } from './tools.js';
import { parseEnabledCategories } from './tool-groups.js';
import { OAuthState } from './oauth.js';
import pkg from '../../../package.json';

interface StartOptions extends ToolDeps {
  port: number;
  token?: string; // legacy bearer — `Authorization: Bearer <token>` on /mcp
  oauthPassword?: string; // when set, /mcp also accepts OAuth tokens
  profile: string;
}

// Wrap every tool response with the update-checker banner so CLI users see the
// notice the next time Claude calls any tool. Safe for image content too —
// banner is added as a leading text block, image content blocks stay intact.
function withBannerInjection(server: McpServer, deps: ToolDeps): McpServer {
  const orig = server.registerTool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, def: unknown, cb: (...args: unknown[]) => unknown) => {
    const wrapped = async (...args: unknown[]) => {
      const out = await cb(...args);
      const banner = deps.updateChecker.banner();
      if (banner && out && typeof out === 'object' && 'content' in (out as { content: unknown[] })) {
        const o = out as { content: Array<{ type: string; text?: string }> };
        return {
          ...o,
          content: [{ type: 'text' as const, text: banner }, ...o.content],
        };
      }
      return out;
    };
    return orig(name, def as never, wrapped as never);
  };
  return server;
}

function buildServer(
  deps: ToolDeps,
  enabled: Set<import('./tool-groups.js').ToolCategory>,
): { server: McpServer; stats: RegistrationStats } {
  const server = new McpServer({ name: 'ghostpilot', version: pkg.version });
  const stats = registerTools(withBannerInjection(server, deps), deps, enabled);
  return { server, stats };
}

function publicBase(req: Request): string {
  // cloudflared/ngrok set X-Forwarded-Proto + X-Forwarded-Host. Express'
  // `trust proxy` makes req.protocol/req.hostname follow them.
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? '127.0.0.1';
  const proto = req.get('x-forwarded-proto') ?? req.protocol ?? 'http';
  return `${proto}://${host}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function loginPage(opts: {
  authorizeId: string;
  clientName?: string;
  error?: string;
}): string {
  const err = opts.error
    ? `<p class="err">${escapeHtml(opts.error)}</p>`
    : '';
  const who = opts.clientName ? escapeHtml(opts.clientName) : 'a client';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>GhostPilot · Authorize</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 420px; margin: 8vh auto; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p { color: #888; margin: 0 0 20px; line-height: 1.5; }
  .err { color: #c33; background: #fdd; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; }
  label { display: block; font-size: 13px; margin: 0 0 6px; color: #666; }
  input { width: 100%; padding: 12px; border: 1px solid #888; border-radius: 8px; font-size: 16px; box-sizing: border-box; background: transparent; color: inherit; }
  button { margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 8px; background: #111; color: #fff; font-size: 15px; cursor: pointer; }
  @media (prefers-color-scheme: dark) { button { background: #fff; color: #111; } }
  small { display: block; margin-top: 24px; color: #888; font-size: 12px; line-height: 1.5; }
</style>
</head>
<body>
<h1>Authorize GhostPilot</h1>
<p>${who} is requesting access to control this browser.</p>
${err}
<form method="POST" action="/authorize">
  <input type="hidden" name="authorize_id" value="${escapeHtml(opts.authorizeId)}" />
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
  <button type="submit">Allow</button>
</form>
<small>Approving grants full control of every tab in this browser, including any logged-in sessions. Only authorize clients you trust.</small>
</body>
</html>`;
}

export async function startMcpServer(opts: StartOptions): Promise<void> {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Resolve the enabled tool categories from the GHOSTPILOT_TOOLS env var once
  // at boot — buildServer is called per /mcp request, but the filter set is
  // constant for the process lifetime. Building a throwaway server here gives
  // us accurate counts for the log without leaking it (the per-request
  // McpServer instances will reuse the same enabled set).
  const enabledCategories = parseEnabledCategories(process.env.GHOSTPILOT_TOOLS);
  {
    const probe = buildServer(opts, enabledCategories);
    const { stats } = probe;
    console.log(
      `[ghostpilot] tools enabled: ${stats.enabledToolsCount}/${stats.totalToolsCount} ` +
        `(categories: ${stats.enabledCategories.join(', ')})`,
    );
    // Throw the probe server away — we won't reuse a single McpServer across
    // requests, and the SDK doesn't expose a side-effect-free count probe.
    probe.server.close().catch(() => {});
  }

  const oauth = opts.oauthPassword
    ? new OAuthState(opts.profile, opts.oauthPassword)
    : null;

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'ghostpilot',
      version: pkg.version,
      profile: opts.profile,
      authRequired: Boolean(opts.token) || Boolean(oauth),
      oauth: Boolean(oauth),
    });
  });

  // ── Auth on /mcp ─────────────────────────────────────────────────────────
  // Three modes (in priority): static bearer (AI_BROWSER_MCP_TOKEN), OAuth
  // access token (when oauth enabled), or open (neither configured).
  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!opts.token && !oauth) {
      next();
      return;
    }

    if (opts.token && presented === opts.token) {
      next();
      return;
    }

    if (oauth && presented && oauth.validateAccessToken(presented)) {
      next();
      return;
    }

    if (oauth) {
      const base = publicBase(req);
      res.set(
        'WWW-Authenticate',
        `Bearer realm="ghostpilot", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      );
    }
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
  };

  // ── Discovery (RFC 9728 + RFC 8414) ───────────────────────────────────────
  if (oauth) {
    app.get('/.well-known/oauth-protected-resource', (req, res) => {
      const base = publicBase(req);
      res.json({
        resource: `${base}/mcp`,
        authorization_servers: [base],
        bearer_methods_supported: ['header'],
      });
    });

    app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
      const base = publicBase(req);
      res.json({
        resource: `${base}/mcp`,
        authorization_servers: [base],
        bearer_methods_supported: ['header'],
      });
    });

    app.get('/.well-known/oauth-authorization-server', (req, res) => {
      const base = publicBase(req);
      res.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
        scopes_supported: ['mcp'],
      });
    });

    // RFC 7591 — Dynamic Client Registration. Claude.ai uses this when the
    // user leaves Client ID/Secret blank in the dialog.
    app.post('/register', async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const redirect_uris = Array.isArray(body.redirect_uris)
        ? (body.redirect_uris.filter((u) => typeof u === 'string') as string[])
        : [];
      if (redirect_uris.length === 0) {
        res.status(400).json({ error: 'invalid_redirect_uri' });
        return;
      }
      const client = await oauth.registerClient({
        redirect_uris,
        client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
        token_endpoint_auth_method:
          typeof body.token_endpoint_auth_method === 'string'
            ? body.token_endpoint_auth_method
            : undefined,
      });
      res.status(201).json({
        client_id: client.client_id,
        client_secret: client.client_secret ?? undefined,
        client_id_issued_at: Math.floor(client.created_at / 1000),
        client_secret_expires_at: 0,
        redirect_uris: client.redirect_uris,
        client_name: client.client_name,
        token_endpoint_auth_method: client.client_secret ? 'client_secret_post' : 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    });

    // ── /authorize ───────────────────────────────────────────────────────
    app.get('/authorize', async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const client_id = q.client_id ?? '';
      const redirect_uri = q.redirect_uri ?? '';
      const response_type = q.response_type ?? '';
      const code_challenge = q.code_challenge ?? '';
      const code_challenge_method = (q.code_challenge_method ?? 'S256') as 'S256' | 'plain';
      const state = q.state;
      const scope = q.scope;

      if (response_type !== 'code') {
        res.status(400).send('Only response_type=code is supported.');
        return;
      }
      if (!code_challenge || (code_challenge_method !== 'S256' && code_challenge_method !== 'plain')) {
        res.status(400).send('PKCE code_challenge required (S256 preferred).');
        return;
      }
      const client = await oauth.findClient(client_id);
      if (!client) {
        res.status(400).send('Unknown client_id. Try registering first.');
        return;
      }
      if (!client.redirect_uris.includes(redirect_uri)) {
        res.status(400).send('redirect_uri not registered for this client.');
        return;
      }

      const pending = oauth.beginAuthorize({
        client_id,
        redirect_uri,
        response_type,
        code_challenge,
        code_challenge_method,
        state,
        scope,
      });
      res.set('Cache-Control', 'no-store').type('html').send(
        loginPage({ authorizeId: pending.id, clientName: client.client_name }),
      );
    });

    app.post('/authorize', async (req, res) => {
      const body = (req.body ?? {}) as Record<string, string>;
      const id = body.authorize_id ?? '';
      const password = body.password ?? '';
      const pending = oauth.consumePending(id);
      if (!pending) {
        res.status(400).type('html').send(
          loginPage({ authorizeId: '', error: 'Authorization request expired. Please retry.' }),
        );
        return;
      }
      if (!oauth.verifyPassword(password)) {
        // Issue a fresh pending so the user can retry without going back.
        const fresh = oauth.beginAuthorize({
          client_id: pending.client_id,
          redirect_uri: pending.redirect_uri,
          response_type: pending.response_type,
          code_challenge: pending.code_challenge,
          code_challenge_method: pending.code_challenge_method,
          state: pending.state,
          scope: pending.scope,
        });
        const client = await oauth.findClient(pending.client_id);
        res.status(401).type('html').send(
          loginPage({
            authorizeId: fresh.id,
            clientName: client?.client_name,
            error: 'Wrong password.',
          }),
        );
        return;
      }
      const code = oauth.issueCode(pending);
      const url = new URL(pending.redirect_uri);
      url.searchParams.set('code', code);
      if (pending.state) url.searchParams.set('state', pending.state);
      res.redirect(302, url.toString());
    });

    // ── /token ───────────────────────────────────────────────────────────
    app.post('/token', async (req, res) => {
      const body = (req.body ?? {}) as Record<string, string>;
      let { client_id, client_secret } = body;

      // client_secret_basic
      const auth = req.header('authorization') ?? '';
      if (auth.startsWith('Basic ')) {
        try {
          const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
          const idx = decoded.indexOf(':');
          if (idx > 0) {
            client_id = client_id || decodeURIComponent(decoded.slice(0, idx));
            client_secret = client_secret || decodeURIComponent(decoded.slice(idx + 1));
          }
        } catch {
          /* ignore — fall through to error below */
        }
      }

      const grant = body.grant_type;
      res.set('Cache-Control', 'no-store');

      if (grant === 'authorization_code') {
        const result = await oauth.exchangeCode({
          code: body.code ?? '',
          code_verifier: body.code_verifier ?? '',
          redirect_uri: body.redirect_uri ?? '',
          client_id: client_id ?? '',
          client_secret,
        });
        if ('error' in result) {
          res.status(400).json({ error: result.error });
          return;
        }
        res.json({
          access_token: result.access_token,
          token_type: 'Bearer',
          expires_in: result.expires_in,
          refresh_token: result.refresh_token,
          scope: result.scope,
        });
        return;
      }

      if (grant === 'refresh_token') {
        const result = await oauth.exchangeRefresh({
          refresh_token: body.refresh_token ?? '',
          client_id: client_id ?? '',
          client_secret,
        });
        if ('error' in result) {
          res.status(400).json({ error: result.error });
          return;
        }
        res.json({
          access_token: result.access_token,
          token_type: 'Bearer',
          expires_in: result.expires_in,
          refresh_token: result.refresh_token,
          scope: result.scope,
        });
        return;
      }

      res.status(400).json({ error: 'unsupported_grant_type' });
    });
  }

  // ── /mcp ─────────────────────────────────────────────────────────────────
  // Stateless streamable HTTP: fresh server + transport per request.
  app.post('/mcp', requireAuth, async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const { server } = buildServer(opts, enabledCategories);

      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request error', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', requireAuth, (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  });

  await new Promise<void>((resolve) => {
    // Listen on all interfaces so a tunnel agent (cloudflared, ngrok) on the
    // same machine can reach us. Not exposed to the LAN unless the OS firewall
    // allows it — Tle's macOS default blocks inbound by default.
    app.listen(opts.port, '127.0.0.1', () => resolve());
  });
}
