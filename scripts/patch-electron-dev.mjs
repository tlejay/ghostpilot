#!/usr/bin/env node
// Re-brand the dev-time Electron.app inside node_modules so macOS shows
// "GhostPilot" in the menu bar / dock tooltip instead of "Electron".
//
// macOS draws the menu-bar app name and dock tooltip from the running bundle's
// Info.plist (CFBundleName / CFBundleDisplayName) — `app.setName()` cannot
// override that. The only fix in dev mode is to patch the bundle.
//
// Safety: pnpm uses APFS clones (or hardlinks) for files in node_modules. To
// avoid poisoning the global store we read the file, unlink, then write a
// fresh copy. plutil is invoked AFTER that so any in-place rewrite is local.
//
// Idempotent — re-running is safe.

import { existsSync, readFileSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BRAND_NAME = 'GhostPilot';
const BRAND_BUNDLE_ID = 'com.madebytle.ghostpilot';

const ELECTRON_APP = join(ROOT, 'node_modules/electron/dist/Electron.app');
const PLIST = join(ELECTRON_APP, 'Contents/Info.plist');
const ICON_DEST = join(ELECTRON_APP, 'Contents/Resources/electron.icns');
const ICON_SRC = join(ROOT, 'assets/icon.icns');

function isDarwin() {
  return process.platform === 'darwin';
}

function ensureExists(path, what) {
  if (!existsSync(path)) {
    console.log(`[patch-electron] ${what} not found at ${path} — skipping`);
    return false;
  }
  return true;
}

function plutilRead(key) {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', PLIST], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function plutilWrite(key, value) {
  execFileSync('plutil', ['-replace', key, '-string', value, PLIST], {
    stdio: 'pipe',
  });
}

// Break any hardlink/clone tying this file to pnpm's content-addressable store.
function isolate(path) {
  const buf = readFileSync(path);
  unlinkSync(path);
  writeFileSync(path, buf);
}

function main() {
  if (!isDarwin()) {
    console.log('[patch-electron] not macOS — skipping');
    return;
  }
  if (!ensureExists(ELECTRON_APP, 'Electron.app')) return;

  const currentName = plutilRead('CFBundleName');
  if (currentName === BRAND_NAME) {
    console.log(`[patch-electron] already branded "${BRAND_NAME}" — nothing to do`);
    return;
  }

  isolate(PLIST);
  plutilWrite('CFBundleName', BRAND_NAME);
  plutilWrite('CFBundleDisplayName', BRAND_NAME);
  plutilWrite('CFBundleIdentifier', BRAND_BUNDLE_ID);
  plutilWrite('CFBundleExecutable', 'Electron'); // keep executable name unchanged

  if (existsSync(ICON_SRC)) {
    if (existsSync(ICON_DEST)) isolate(ICON_DEST);
    copyFileSync(ICON_SRC, ICON_DEST);
    console.log(`[patch-electron] replaced bundle icon with ${ICON_SRC}`);
  } else {
    console.log('[patch-electron] assets/icon.icns missing — run `pnpm assets:icon` to generate it');
  }

  console.log(`[patch-electron] re-branded Electron.app → ${BRAND_NAME}`);
  console.log('   Restart any running Electron instance to see the new name in the menu bar.');
}

main();
