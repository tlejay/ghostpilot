import { app } from 'electron';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { JsonStore } from '../storage/json-store.js';

// Minimal OAuth 2.1 (PKCE-only) provider for Claude.ai's MCP custom-connector
// flow. Single-user: one shared password gates the authorize step. Tokens are
// opaque random strings — no JWT, no introspection endpoint.

interface Client {
  client_id: string;
  client_secret: string | null;
  redirect_uris: string[];
  client_name?: string;
  created_at: number;
}

interface RefreshTokenRecord {
  token: string;
  client_id: string;
  expires_at: number;
}

interface PendingAuthCode {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256' | 'plain';
  scope?: string;
  expires_at: number;
}

interface AccessTokenRecord {
  client_id: string;
  expires_at: number;
}

export interface PendingAuthorize {
  id: string;
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: 'S256' | 'plain';
  state?: string;
  scope?: string;
  expires_at: number;
}

interface Persistent {
  clients: Client[];
  refreshTokens: RefreshTokenRecord[];
}

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256b64url(input: string): string {
  return b64url(createHash('sha256').update(input).digest());
}

function newToken(): string {
  return b64url(randomBytes(32));
}

function constantTimeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export class OAuthState {
  private store: JsonStore<Persistent>;
  private codes = new Map<string, PendingAuthCode & { code: string }>();
  private accessTokens = new Map<string, AccessTokenRecord>();
  private pending = new Map<string, PendingAuthorize>();
  private password: string;

  constructor(profile: string, password: string) {
    const path = join(app.getPath('userData'), 'profiles', profile, 'oauth.json');
    this.store = new JsonStore<Persistent>(path, { clients: [], refreshTokens: [] });
    this.password = password;
  }

  async findClient(client_id: string): Promise<Client | undefined> {
    const cur = await this.store.read();
    return cur.clients.find((c) => c.client_id === client_id);
  }

  async registerClient(input: {
    redirect_uris: string[];
    client_name?: string;
    token_endpoint_auth_method?: string;
  }): Promise<Client> {
    const isPublic = input.token_endpoint_auth_method === 'none';
    const client: Client = {
      client_id: randomUUID(),
      client_secret: isPublic ? null : newToken(),
      redirect_uris: input.redirect_uris,
      client_name: input.client_name,
      created_at: Date.now(),
    };
    await this.store.update((cur) => ({ ...cur, clients: [...cur.clients, client] }));
    return client;
  }

  async ensureRedirectAllowed(client_id: string, redirect_uri: string): Promise<boolean> {
    const c = await this.findClient(client_id);
    if (!c) return false;
    return c.redirect_uris.includes(redirect_uri);
  }

  beginAuthorize(input: Omit<PendingAuthorize, 'id' | 'expires_at'>): PendingAuthorize {
    const p: PendingAuthorize = {
      ...input,
      id: randomUUID(),
      expires_at: Date.now() + PENDING_TTL_MS,
    };
    this.pending.set(p.id, p);
    return p;
  }

  consumePending(id: string): PendingAuthorize | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    this.pending.delete(id);
    if (p.expires_at < Date.now()) return undefined;
    return p;
  }

  verifyPassword(password: string): boolean {
    return constantTimeEqualString(password, this.password);
  }

  issueCode(p: PendingAuthorize): string {
    const code = newToken();
    this.codes.set(code, {
      code,
      client_id: p.client_id,
      redirect_uri: p.redirect_uri,
      code_challenge: p.code_challenge,
      code_challenge_method: p.code_challenge_method,
      scope: p.scope,
      expires_at: Date.now() + CODE_TTL_MS,
    });
    return code;
  }

  async exchangeCode(input: {
    code: string;
    code_verifier: string;
    redirect_uri: string;
    client_id: string;
    client_secret?: string;
  }): Promise<
    | { access_token: string; refresh_token: string; expires_in: number; scope?: string }
    | { error: string }
  > {
    const c = this.codes.get(input.code);
    if (!c) return { error: 'invalid_grant' };
    this.codes.delete(input.code);
    if (c.expires_at < Date.now()) return { error: 'invalid_grant' };
    if (!constantTimeEqualString(c.redirect_uri, input.redirect_uri)) return { error: 'invalid_grant' };
    if (!constantTimeEqualString(c.client_id, input.client_id)) return { error: 'invalid_grant' };

    const client = await this.findClient(input.client_id);
    if (!client) return { error: 'invalid_client' };
    if (client.client_secret && !constantTimeEqualString(client.client_secret, input.client_secret ?? '')) {
      return { error: 'invalid_client' };
    }

    const computed =
      c.code_challenge_method === 'S256' ? sha256b64url(input.code_verifier) : input.code_verifier;
    if (!constantTimeEqualString(computed, c.code_challenge)) return { error: 'invalid_grant' };

    return this.mintTokens(input.client_id, c.scope);
  }

  async exchangeRefresh(input: {
    refresh_token: string;
    client_id: string;
    client_secret?: string;
  }): Promise<
    | { access_token: string; refresh_token: string; expires_in: number; scope?: string }
    | { error: string }
  > {
    const cur = await this.store.read();
    const r = cur.refreshTokens.find((t) => t.token === input.refresh_token);
    if (!r) return { error: 'invalid_grant' };
    if (!constantTimeEqualString(r.client_id, input.client_id)) return { error: 'invalid_grant' };
    if (r.expires_at < Date.now()) return { error: 'invalid_grant' };

    const client = await this.findClient(input.client_id);
    if (!client) return { error: 'invalid_client' };
    if (client.client_secret && !constantTimeEqualString(client.client_secret, input.client_secret ?? '')) {
      return { error: 'invalid_client' };
    }

    // Rotate: revoke old refresh.
    await this.store.update((c) => ({
      ...c,
      refreshTokens: c.refreshTokens.filter(
        (t) => t.token !== input.refresh_token && t.expires_at > Date.now(),
      ),
    }));
    return this.mintTokens(input.client_id);
  }

  validateAccessToken(token: string): boolean {
    const t = this.accessTokens.get(token);
    if (!t) return false;
    if (t.expires_at < Date.now()) {
      this.accessTokens.delete(token);
      return false;
    }
    return true;
  }

  private async mintTokens(client_id: string, scope?: string) {
    const access_token = newToken();
    const refresh_token = newToken();
    this.accessTokens.set(access_token, {
      client_id,
      expires_at: Date.now() + ACCESS_TTL_MS,
    });
    await this.store.update((cur) => ({
      ...cur,
      refreshTokens: [
        ...cur.refreshTokens.filter((t) => t.expires_at > Date.now()),
        { token: refresh_token, client_id, expires_at: Date.now() + REFRESH_TTL_MS },
      ],
    }));
    return {
      access_token,
      refresh_token,
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      scope,
    };
  }
}
