// Plan #5 — profile lifecycle operations exposed to MCP.
//
// All filesystem work happens under `<userDataDir>/profiles/<name>/`. The
// functions here are intentionally `userDataDir`-parameterized so the unit
// tests can point them at a tmp dir without needing Electron's `app`.
//
// This module is self-contained (no cross-file runtime imports) so the
// `--experimental-strip-types` Node test runner can load it without needing
// to resolve `./profile.js`. The duplicated PROFILE_REGEX + partitionFor
// helpers are tiny (one line each) and mirror their canonical homes in
// `src/main/profile.ts` — if you change one, change the other.

import {
  promises as fsp,
  statSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';

const PROFILE_REGEX = /^[a-zA-Z0-9_-]{1,32}$/;

function partitionFor(profile: string): string {
  return `persist:profile-${profile}`;
}

// Plan #5 — shared validator used by MCP profile-management tools. Returns
// `{ ok:true, name }` on accept (with the name trimmed) or `{ ok:false, error }`
// on reject. The error string is caller-facing.
export type ValidatedProfile =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function validateProfileName(raw: unknown): ValidatedProfile {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'profile name must be a string' };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, error: 'profile name must not be empty' };
  }
  if (name.length > 32) {
    return { ok: false, error: 'profile name must be 32 chars or fewer' };
  }
  if (!PROFILE_REGEX.test(name)) {
    return {
      ok: false,
      error:
        'profile name must match [a-zA-Z0-9_-]{1,32} (no spaces, slashes, or special chars)',
    };
  }
  return { ok: true, name };
}

export interface ProfileEntry {
  name: string;
  path: string;
  sizeBytes: number;
  lastModified: string; // ISO
  active: boolean;
}

export interface ListProfilesResult {
  active: string;
  profiles: ProfileEntry[];
}

export interface CurrentProfileResult {
  name: string;
  partition: string;
  userDataDir: string;
}

export interface CreateProfileResult {
  ok: true;
  name: string;
  created: boolean; // false when it already existed (idempotent)
  path: string;
}

export interface DeleteProfileResult {
  ok: boolean;
  name: string;
  deleted?: boolean;
  error?: string;
}

export interface SwitchProfileRequest {
  ok: boolean;
  name?: string;
  relaunching?: boolean;
  error?: string;
}

function profilesRoot(userDataDir: string): string {
  return join(userDataDir, 'profiles');
}

function profilePath(userDataDir: string, name: string): string {
  return join(profilesRoot(userDataDir), name);
}

function dirSizeSync(path: string): number {
  let total = 0;
  try {
    const stack: string[] = [path];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const ent of readdirSync(cur, { withFileTypes: true })) {
        const child = join(cur, ent.name);
        if (ent.isDirectory()) {
          stack.push(child);
        } else if (ent.isFile()) {
          try {
            total += statSync(child).size;
          } catch {
            // file may have vanished between readdir and stat; ignore
          }
        }
      }
    }
  } catch {
    // dir may not exist
  }
  return total;
}

export function listProfiles(
  userDataDir: string,
  activeName: string,
): ListProfilesResult {
  const root = profilesRoot(userDataDir);
  let names: string[] = [];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    names = [];
  }
  const entries: ProfileEntry[] = names.map((name) => {
    const p = join(root, name);
    let lastModified = '';
    try {
      lastModified = statSync(p).mtime.toISOString();
    } catch {
      lastModified = '';
    }
    return {
      name,
      path: p,
      sizeBytes: dirSizeSync(p),
      lastModified,
      active: name === activeName,
    };
  });
  // Active first, then alphabetical
  entries.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { active: activeName, profiles: entries };
}

export function currentProfile(
  userDataDir: string,
  activeName: string,
): CurrentProfileResult {
  return {
    name: activeName,
    partition: partitionFor(activeName),
    userDataDir: profilePath(userDataDir, activeName),
  };
}

export async function createProfile(
  userDataDir: string,
  rawName: unknown,
): Promise<CreateProfileResult | { ok: false; error: string }> {
  const v = validateProfileName(rawName);
  if (!v.ok) return { ok: false, error: v.error };
  const path = profilePath(userDataDir, v.name);
  const existed = existsSync(path);
  if (!existed) {
    await fsp.mkdir(path, { recursive: true });
  }
  return { ok: true, name: v.name, created: !existed, path };
}

export interface DeleteProfileOptions {
  activeName: string;
  force?: boolean; // required to delete the literal "default" profile
}

export async function deleteProfile(
  userDataDir: string,
  rawName: unknown,
  opts: DeleteProfileOptions,
): Promise<DeleteProfileResult> {
  const v = validateProfileName(rawName);
  if (!v.ok) return { ok: false, name: String(rawName), error: v.error };
  const { name } = v;
  if (name === opts.activeName) {
    return {
      ok: false,
      name,
      error: `refusing to delete the active profile "${name}"; switch first`,
    };
  }
  if (name === 'default' && !opts.force) {
    return {
      ok: false,
      name,
      error:
        'refusing to delete the "default" profile without force:true (this profile is the implicit fallback)',
    };
  }
  const path = profilePath(userDataDir, name);
  if (!existsSync(path)) {
    return { ok: false, name, error: 'profile not found' };
  }
  await fsp.rm(path, { recursive: true, force: true });
  return { ok: true, name, deleted: true };
}

// `switchProfile` is intentionally split into "validate + announce" (pure) and
// "execute the relaunch" (impure, Electron). The MCP handler in tools.ts calls
// validate first, sends the HTTP response, then calls the executor on a small
// setTimeout so the response actually flushes before the process exits.
export function validateSwitchRequest(
  rawName: unknown,
  activeName: string,
): SwitchProfileRequest {
  const v = validateProfileName(rawName);
  if (!v.ok) return { ok: false, error: v.error };
  if (v.name === activeName) {
    return {
      ok: true,
      name: v.name,
      relaunching: false,
      // no-op; caller wanted the profile that's already active
    };
  }
  return { ok: true, name: v.name, relaunching: true };
}
