// Unit tests for Plan #5 — multi-profile MCP surface.
//
// Pure tests for the validator + filesystem tests for create/delete/list that
// use a per-test tmp dir so they never touch Electron's real userData.
//
// Run: node --experimental-strip-types --test tests/unit/profile-manager.test.ts

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateProfileName,
  listProfiles,
  currentProfile,
  createProfile,
  deleteProfile,
  validateSwitchRequest,
} from '../../src/main/profile-manager.ts';

let TMP = '';

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'gp-plan5-'));
});

afterEach(() => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ── validateProfileName ──────────────────────────────────────────────

test('validateProfileName: "default" → ok', () => {
  const v = validateProfileName('default');
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.name, 'default');
});

test('validateProfileName: "prapat" → ok', () => {
  const v = validateProfileName('prapat');
  assert.equal(v.ok, true);
});

test('validateProfileName: "a" (single char) → ok', () => {
  assert.equal(validateProfileName('a').ok, true);
});

test('validateProfileName: 32-char name → ok', () => {
  assert.equal(validateProfileName('a'.repeat(32)).ok, true);
});

test('validateProfileName: 33-char name → fail', () => {
  const v = validateProfileName('a'.repeat(33));
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.error, /32/);
});

test('validateProfileName: "has space" → fail', () => {
  const v = validateProfileName('has space');
  assert.equal(v.ok, false);
});

test('validateProfileName: "../escape" → fail (path traversal)', () => {
  const v = validateProfileName('../escape');
  assert.equal(v.ok, false);
});

test('validateProfileName: "" → fail (empty)', () => {
  const v = validateProfileName('');
  assert.equal(v.ok, false);
});

test('validateProfileName: "with/slash" → fail', () => {
  const v = validateProfileName('with/slash');
  assert.equal(v.ok, false);
});

test('validateProfileName: non-string → fail', () => {
  const v = validateProfileName(42 as unknown);
  assert.equal(v.ok, false);
});

// ── listProfiles ──────────────────────────────────────────────────────

test('listProfiles: empty profiles/ dir → empty entries, active set', () => {
  const result = listProfiles(TMP, 'default');
  assert.equal(result.active, 'default');
  assert.deepEqual(result.profiles, []);
});

test('listProfiles: with default + plan5-smoke → both listed, active sorted first', () => {
  mkdirSync(join(TMP, 'profiles', 'plan5-smoke'), { recursive: true });
  mkdirSync(join(TMP, 'profiles', 'default'), { recursive: true });
  const result = listProfiles(TMP, 'default');
  assert.equal(result.profiles.length, 2);
  assert.equal(result.profiles[0]!.name, 'default');
  assert.equal(result.profiles[0]!.active, true);
  assert.equal(result.profiles[1]!.name, 'plan5-smoke');
  assert.equal(result.profiles[1]!.active, false);
});

test('listProfiles: sizeBytes counts files in profile dir', () => {
  const p = join(TMP, 'profiles', 'sized');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'history.json'), 'x'.repeat(123));
  const result = listProfiles(TMP, 'default');
  const entry = result.profiles.find((e) => e.name === 'sized');
  assert.ok(entry);
  assert.equal(entry!.sizeBytes, 123);
});

// ── currentProfile ────────────────────────────────────────────────────

test('currentProfile: returns name + partition + per-profile userDataDir', () => {
  const r = currentProfile(TMP, 'plan5-smoke');
  assert.equal(r.name, 'plan5-smoke');
  assert.equal(r.partition, 'persist:profile-plan5-smoke');
  assert.equal(r.userDataDir, join(TMP, 'profiles', 'plan5-smoke'));
});

// ── createProfile ─────────────────────────────────────────────────────

test('createProfile: new name → creates dir, returns created:true', async () => {
  const r = await createProfile(TMP, 'fresh');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.created, true);
    assert.equal(r.name, 'fresh');
    assert.ok(existsSync(r.path));
  }
});

test('createProfile: existing name → idempotent, returns created:false', async () => {
  await createProfile(TMP, 'dup');
  const r = await createProfile(TMP, 'dup');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.created, false);
  }
});

test('createProfile: invalid name → ok:false with error', async () => {
  const r = await createProfile(TMP, '../bad');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.error);
});

// ── deleteProfile ─────────────────────────────────────────────────────

test('deleteProfile: refuses when name === active', async () => {
  mkdirSync(join(TMP, 'profiles', 'active-one'), { recursive: true });
  const r = await deleteProfile(TMP, 'active-one', { activeName: 'active-one' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /active profile/);
  assert.ok(existsSync(join(TMP, 'profiles', 'active-one')));
});

test('deleteProfile: non-existent → ok:false with profile-not-found', async () => {
  const r = await deleteProfile(TMP, 'ghost', { activeName: 'default' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /not found/);
});

test('deleteProfile: "default" without force → refused', async () => {
  mkdirSync(join(TMP, 'profiles', 'default'), { recursive: true });
  const r = await deleteProfile(TMP, 'default', { activeName: 'other' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /default/);
  assert.ok(existsSync(join(TMP, 'profiles', 'default')));
});

test('deleteProfile: "default" with force:true → deleted', async () => {
  mkdirSync(join(TMP, 'profiles', 'default'), { recursive: true });
  writeFileSync(join(TMP, 'profiles', 'default', 'history.json'), '[]');
  const r = await deleteProfile(TMP, 'default', { activeName: 'other', force: true });
  assert.equal(r.ok, true);
  assert.equal(r.deleted, true);
  assert.equal(existsSync(join(TMP, 'profiles', 'default')), false);
});

test('deleteProfile: normal non-active profile → deleted', async () => {
  mkdirSync(join(TMP, 'profiles', 'doomed'), { recursive: true });
  writeFileSync(join(TMP, 'profiles', 'doomed', 'bookmarks.json'), '[]');
  const r = await deleteProfile(TMP, 'doomed', { activeName: 'default' });
  assert.equal(r.ok, true);
  assert.equal(r.deleted, true);
  assert.equal(existsSync(join(TMP, 'profiles', 'doomed')), false);
});

// ── validateSwitchRequest ─────────────────────────────────────────────

test('validateSwitchRequest: same name as active → no-op (relaunching:false)', () => {
  const r = validateSwitchRequest('default', 'default');
  assert.equal(r.ok, true);
  assert.equal(r.relaunching, false);
});

test('validateSwitchRequest: different valid name → relaunching:true', () => {
  const r = validateSwitchRequest('new-one', 'default');
  assert.equal(r.ok, true);
  assert.equal(r.relaunching, true);
  assert.equal(r.name, 'new-one');
});

test('validateSwitchRequest: invalid name → ok:false', () => {
  const r = validateSwitchRequest('../escape', 'default');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
