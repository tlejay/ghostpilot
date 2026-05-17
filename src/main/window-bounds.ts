// Persist BrowserWindow size + position across launches.
//
// File lives at `<userData>/window-bounds.json` (same root as profiles/).
// Bounds are validated against the currently-attached display set on read —
// if the saved position is off-screen (monitor unplugged, etc.) we drop the
// position and fall back to centering at the saved width/height, or to the
// caller's defaults when even that doesn't fit.
//
// Writes are debounced (~500 ms) and atomic via JsonStore. The 'resize' and
// 'move' events both fan into the same debounce so a drag-resize doesn't
// hammer disk.

import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { JsonStore } from './storage/json-store.js';

export interface SavedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FILE = (): string =>
  join(app.getPath('userData'), 'window-bounds.json');

// JsonStore is keyed by path; lazy-init so app.getPath() is safe (app must be ready).
let store: JsonStore<Partial<SavedBounds>> | null = null;
function getStore(): JsonStore<Partial<SavedBounds>> {
  if (!store) store = new JsonStore<Partial<SavedBounds>>(FILE(), {});
  return store;
}

const MIN_WIDTH = 800;
const MIN_HEIGHT = 500;

/** True if (x, y) sits inside any attached display's work area (with at
 *  least one display worth of overlap). Prevents restoring a window that
 *  was last placed on a monitor that's now unplugged. */
function isOnScreen(b: SavedBounds): boolean {
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const wa = d.workArea;
    // Require the window's top-left to be at least partially inside the work
    // area — generous so partial overlap still restores cleanly.
    const overlapsX = b.x + b.width > wa.x + 20 && b.x < wa.x + wa.width - 20;
    const overlapsY = b.y + b.height > wa.y + 20 && b.y < wa.y + wa.height - 20;
    if (overlapsX && overlapsY) return true;
  }
  return false;
}

/**
 * Read the saved bounds file, validate, return a usable Bounds or null.
 * Never throws — file missing / parse errors / invalid values → null.
 */
export async function loadSavedBounds(): Promise<SavedBounds | null> {
  let raw: Partial<SavedBounds>;
  try {
    raw = await getStore().read();
  } catch {
    return null;
  }
  const w = Number(raw.width);
  const h = Number(raw.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < MIN_WIDTH || h < MIN_HEIGHT) {
    return null;
  }
  // x/y are optional — if missing, caller should center on primary.
  const x = Number(raw.x);
  const y = Number(raw.y);
  const hasPos = Number.isFinite(x) && Number.isFinite(y);
  if (!hasPos) return null;
  const b: SavedBounds = { x, y, width: Math.round(w), height: Math.round(h) };
  if (!isOnScreen(b)) return null;
  return b;
}

/** Persist the given bounds. Used by both the auto-listener and the
 *  set_window_bounds MCP tool. Safe to call repeatedly. */
export async function saveBounds(b: SavedBounds): Promise<void> {
  await getStore().write({
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  });
}

/** Attach debounced auto-persistence to a window. Drag-resize fires many
 *  'resize' events per second; we coalesce them into one disk write 500ms
 *  after the last change. */
export function attachBoundsPersistence(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const flush = (): void => {
    timer = null;
    // Don't persist while maximized / fullscreen — the user expects the
    // pre-maximize bounds to come back on next launch.
    if (win.isDestroyed()) return;
    if (win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
    const b = win.getBounds();
    void saveBounds(b).catch((err) => {
      console.error('[window-bounds] failed to save:', err);
    });
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 500);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', () => {
    // Final synchronous-ish flush at quit: cancel pending debounce and
    // write one more time with the latest bounds so an unsaved resize
    // right before quit doesn't get lost.
    if (timer) clearTimeout(timer);
    timer = null;
    if (win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
    const b = win.getBounds();
    void saveBounds(b);
  });
}
