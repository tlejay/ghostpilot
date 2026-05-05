import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools, type ToolDeps } from './tools.js';

interface StartOptions extends ToolDeps {
  port: number;
  token?: string; // when set, /mcp requires Authorization: Bearer <token>
  profile: string;
}

// Wrap every tool response with the update-checker banner so CLI users see the
// notice the next time Claude calls any tool. Safe for image content too —
// banner is added as a leading text block, image content blocks stay intact.
function withBannerInjection(server: McpServer, deps: ToolDeps): McpServer {
  // McpServer exposes `server.server` — the lower-level Server. We hook the
  // request handler for tools/call by wrapping registerTool's outputs. Easier:
  // patch the connect step. Instead we just monkey-patch each tool's callback
  // at registration time by intercepting registerTool calls.
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

function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'ghostpilot', version: '0.2.0' });
  registerTools(withBannerInjection(server, deps), deps);
  return server;
}

export async function startMcpServer(opts: StartOptions): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'ghostpilot',
      version: '0.2.0',
      profile: opts.profile,
      authRequired: Boolean(opts.token),
    });
  });

  // Optional bearer-token auth — only enforced when AI_BROWSER_MCP_TOKEN is set.
  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!opts.token) {
      next();
      return;
    }
    const header = req.header('authorization') ?? '';
    const expected = `Bearer ${opts.token}`;
    if (header !== expected) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
      return;
    }
    next();
  };

  // Stateless streamable HTTP: fresh server + transport per request.
  app.post('/mcp', requireAuth, async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = buildServer(opts);

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

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  });

  await new Promise<void>((resolve) => {
    app.listen(opts.port, '127.0.0.1', () => resolve());
  });
}
