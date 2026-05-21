import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HistoryStore } from './storage/history.js';
import type { Recorder } from './recorder.js';
import type { MediaDetector } from './media-detector.js';

export const DEFAULT_TOOLBAR_HEIGHT = 88; // 40 (tabs row) + 48 (address row)
export const TOOLBAR_HEIGHT = DEFAULT_TOOLBAR_HEIGHT;

// Welcome page replaces Google as the default new-tab landing — explains what
// GhostPilot can do and offers sample Claude prompts.
export function welcomeUrl(): string {
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (dev) return `${dev}/newtab.html`;
  return pathToFileURL(join(__dirname, '../renderer/newtab.html')).toString();
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  active: boolean;
  pinned: boolean;
}

interface InternalTab {
  id: string;
  view: WebContentsView;
  pinned: boolean;
}

interface TabManagerOptions {
  window: BrowserWindow;
  partition: string;
  history: HistoryStore;
  recorder: Recorder;
  mediaDetector: MediaDetector;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('about:')) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export class TabManager {
  private tabs = new Map<string, InternalTab>();
  private order: string[] = [];
  private activeId: string | null = null;
  private favicons = new Map<string, string>();
  private window: BrowserWindow;
  private partition: string;
  private history: HistoryStore;
  private recorder: Recorder;
  private mediaDetector: MediaDetector;
  private wcToTab = new Map<number, string>();
  private toolbarHeight: number = DEFAULT_TOOLBAR_HEIGHT;
  private sidePanelWidth: number = 0;
  // Callbacks registered by tools that need to re-run after navigation.
  // Keyed by tab id; each entry is a Set so the same tab can have multiple hooks.
  private navHooks = new Map<string, Set<() => void>>();

  constructor(opts: TabManagerOptions) {
    this.window = opts.window;
    this.partition = opts.partition;
    this.history = opts.history;
    this.recorder = opts.recorder;
    this.mediaDetector = opts.mediaDetector;
    this.window.on('resize', () => this.layoutActive());
    this.window.on('enter-full-screen', () => this.layoutActive());
    this.window.on('leave-full-screen', () => this.layoutActive());
  }

  // ── liveness guards ───────────────────────────────────────────────
  // A tab can outlive its WebContents (crash / render-process-gone / external close)
  // — `tab.view.webContents` then becomes undefined or destroyed. Touching `.getURL()`
  // on it throws and (because listTabs/broadcastTabs run on every MCP call + every nav
  // event) takes the whole TabManager down. So: everything that reaches a WebContents
  // goes through `liveWc()`, and dead tabs are pruned out of the maps.
  private isLive(tab?: InternalTab | null | undefined): tab is InternalTab {
    const wc = tab?.view?.webContents;
    return !!wc && !wc.isDestroyed();
  }

  private liveWc(id: string): WebContents | null {
    const wc = this.tabs.get(id)?.view?.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  // Drop a tab whose WebContents is gone (does NOT touch the dead webContents).
  private dropTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const wcId = tab.view?.webContents?.id;
    if (typeof wcId === 'number') {
      this.recorder.detach(id, wcId);
      this.wcToTab.delete(wcId);
    }
    this.mediaDetector.detach(id);
    try {
      if (tab.view) this.window.contentView.removeChildView(tab.view);
    } catch {
      /* already detached */
    }
    this.tabs.delete(id);
    this.favicons.delete(id);
    this.navHooks.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.activeId === id) {
      this.activeId = null;
      const next = [...this.order].reverse().find((x) => this.isLive(this.tabs.get(x))) ?? null;
      if (next) this.activateTab(next);
      else this.broadcastTabs();
    } else {
      this.broadcastTabs();
    }
  }

  // Sweep out any dead tabs (lazy GC, called before listing).
  private pruneDead(): void {
    let removed = false;
    for (const [id, tab] of [...this.tabs]) {
      // read the wc id BEFORE the isLive() narrowing (which would make `tab` `never` in the dead branch)
      const wcId = tab.view?.webContents?.id;
      if (this.isLive(tab)) continue;
      this.tabs.delete(id);
      this.favicons.delete(id);
      this.order = this.order.filter((x) => x !== id);
      if (typeof wcId === 'number') this.wcToTab.delete(wcId);
      removed = true;
    }
    if (removed && (this.activeId === null || !this.isLive(this.tabs.get(this.activeId ?? '')))) {
      this.activeId = [...this.order].reverse().find((x) => this.isLive(this.tabs.get(x))) ?? null;
    }
  }

  newTab(rawUrl?: string): TabInfo {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        partition: this.partition,
        // Keep the compositor producing frames while the tab is backgrounded
        // (inactive tab / minimized window) so screenshots stay available.
        backgroundThrottling: false,
      },
    });
    const id = randomUUID();
    const tab: InternalTab = { id, view, pinned: false };
    this.tabs.set(id, tab);
    this.order.push(id);

    const url = rawUrl ? normalizeUrl(rawUrl) : welcomeUrl();
    const wc = view.webContents;
    this.wcToTab.set(wc.id, id);
    this.recorder.attachConsole(id, wc);

    wc.on('did-navigate', (_event, navUrl) => {
      this.mediaDetector.clearForNavigation(id, navUrl);
    });

    const emit = () => this.broadcastTabs();
    wc.on('page-title-updated', emit);
    wc.on('did-navigate', emit);
    wc.on('did-navigate-in-page', emit);

    // Fire registered nav hooks after full-page loads and SPA navigations.
    // did-finish-load covers hard navigations (new document); did-navigate-in-page
    // covers History API / hash changes inside a live document.
    const fireNavHooks = () => {
      for (const hook of this.navHooks.get(id) ?? []) {
        try { hook(); } catch { /* don't let a broken hook kill the event loop */ }
      }
    };
    wc.on('did-finish-load', fireNavHooks);
    wc.on('did-navigate-in-page', fireNavHooks);
    wc.on('did-start-loading', emit);
    wc.on('did-stop-loading', emit);
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (favicons[0]) this.favicons.set(id, favicons[0]);
      emit();
    });

    // Record history on full navigation finish
    wc.on('did-finish-load', () => {
      const visited = wc.getURL();
      const title = wc.getTitle() || visited;
      if (visited && !visited.startsWith('about:')) {
        this.history
          .record({ url: visited, title, visitedAt: Date.now() })
          .catch((err) => console.error('[history] record failed', err));
      }
      emit();
    });

    wc.setWindowOpenHandler(({ url: openUrl }) => {
      this.newTab(openUrl);
      return { action: 'deny' };
    });

    // Self-clean if the renderer crashes or the WebContents is destroyed out from under us,
    // so a dead tab never lingers in the maps and poisons listTabs/broadcastTabs.
    wc.on('render-process-gone', () => this.dropTab(id));
    wc.on('destroyed', () => this.dropTab(id));

    wc.loadURL(url).catch((err) => console.error('[tab-manager] loadURL failed', err));

    this.activateTab(id);
    return (
      this.toInfo(tab) ?? {
        id,
        url,
        title: '',
        favicon: undefined,
        loading: true,
        canGoBack: false,
        canGoForward: false,
        active: this.activeId === id,
        pinned: tab.pinned,
      }
    );
  }

  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const wcId = tab.view?.webContents?.id;
    try {
      if (tab.view) this.window.contentView.removeChildView(tab.view);
    } catch {
      /* already detached */
    }
    try {
      const wc = tab.view?.webContents;
      if (wc && !wc.isDestroyed()) wc.close();
    } catch {
      /* noop */
    }
    if (typeof wcId === 'number') {
      this.recorder.detach(id, wcId);
      this.wcToTab.delete(wcId);
    }
    this.mediaDetector.detach(id);
    this.tabs.delete(id);
    this.favicons.delete(id);
    this.navHooks.delete(id);
    this.order = this.order.filter((x) => x !== id);

    if (this.activeId === id) {
      this.activeId = null;
      const next = [...this.order].reverse().find((x) => this.isLive(this.tabs.get(x))) ?? this.order[this.order.length - 1] ?? null;
      if (next) this.activateTab(next);
      else this.broadcastTabs();
    } else {
      this.broadcastTabs();
    }
  }

  /** Register a callback that fires after every full-page load and every
   *  in-page navigation for `tabId`. Returns an unsubscribe function.
   *  Safe to call before or after the tab is created — hooks are stored
   *  in a plain Map and read lazily by the listeners in newTab(). */
  registerNavHook(tabId: string, cb: () => void): () => void {
    let bucket = this.navHooks.get(tabId);
    if (!bucket) { bucket = new Set(); this.navHooks.set(tabId, bucket); }
    bucket.add(cb);
    return () => {
      const b = this.navHooks.get(tabId);
      if (!b) return;
      b.delete(cb);
      if (b.size === 0) this.navHooks.delete(tabId);
    };
  }

  activateTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!this.isLive(tab)) {
      // requested tab is dead/missing — clean up and surface whatever's left instead of throwing
      this.pruneDead();
      this.broadcastTabs();
      return;
    }

    for (const [otherId, other] of this.tabs) {
      if (otherId !== id && other.view) {
        try {
          this.window.contentView.removeChildView(other.view);
        } catch {
          /* already removed */
        }
      }
    }

    try {
      this.window.contentView.addChildView(tab.view);
    } catch (err) {
      console.error('[tab-manager] addChildView failed', err);
      this.dropTab(id);
      return;
    }
    this.activeId = id;
    this.layoutActive();
    this.broadcastTabs();
  }

  navigate(id: string, rawUrl: string): void {
    this.liveWc(id)?.loadURL(normalizeUrl(rawUrl));
  }

  goBack(id: string): void {
    const wc = this.liveWc(id);
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(id: string): void {
    const wc = this.liveWc(id);
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.liveWc(id)?.reload();
  }

  stop(id: string): void {
    this.liveWc(id)?.stop();
  }

  toggleDevTools(id: string): void {
    const wc = this.liveWc(id);
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  pressKey(id: string, key: string, modifiers: string[] = []): boolean {
    const wc = this.liveWc(id);
    if (!wc) return false;
    const mod = modifiers as Array<'shift' | 'control' | 'alt' | 'meta'>;
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mod });
    if (key.length === 1) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers: mod });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mod });
    return true;
  }

  typeText(id: string, text: string): boolean {
    const wc = this.liveWc(id);
    if (!wc) return false;
    for (const ch of text) {
      wc.sendInputEvent({ type: 'char', keyCode: ch });
    }
    return true;
  }

  // Raw Chrome DevTools Protocol escape hatch. Attaches a debugger to the tab
  // and forwards an arbitrary CDP method call. Equivalent to chrome-devtools'
  // direct CDP access — anything chrome-devtools MCP can do, this can do.
  async cdpSend(id: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const wc = this.liveWc(id);
    if (!wc) throw new Error(`Tab not found or destroyed: ${id}`);
    if (!wc.debugger.isAttached()) {
      try {
        wc.debugger.attach('1.3');
      } catch (err) {
        throw new Error(`Failed to attach debugger: ${(err as Error).message}`);
      }
    }
    return wc.debugger.sendCommand(method, params ?? {});
  }

  // Wait for a CDP event to fire (one-shot) and return its params. Used by
  // tracing: subscribe BEFORE the trigger is sent to avoid the race.
  async waitForCdpEvent<T = unknown>(id: string, eventName: string, timeoutMs = 30000): Promise<T> {
    const wc = this.liveWc(id);
    if (!wc) throw new Error(`Tab not found or destroyed: ${id}`);
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wc.debugger.removeListener('message', onMessage);
        reject(new Error(`Timeout waiting for ${eventName}`));
      }, timeoutMs);
      const onMessage = (_e: unknown, method: string, params: unknown) => {
        if (method !== eventName) return;
        clearTimeout(timer);
        wc.debugger.removeListener('message', onMessage);
        resolve(params as T);
      };
      wc.debugger.on('message', onMessage);
    });
  }

  async hover(id: string, selector: string): Promise<boolean> {
    const wc = this.liveWc(id);
    if (!wc) return false;
    const sel = JSON.stringify(selector);
    const rect = (await wc.executeJavaScript(
      `(() => {
        const el = document.querySelector(${sel});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      })()`,
      true,
    )) as { x: number; y: number } | null;
    if (!rect) return false;
    wc.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
    return true;
  }

  pinTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.pinned = true;
    // Move pinned tab to the front of the pinned group
    this.order = [id, ...this.order.filter((x) => x !== id)];
    this.broadcastTabs();
  }

  unpinTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.pinned = false;
    this.broadcastTabs();
  }

  reorderTab(id: string, toIndex: number): void {
    const from = this.order.indexOf(id);
    if (from === -1) return;
    const tab = this.tabs.get(id);
    // Pinned tabs cannot be dragged past unpinned ones and vice versa
    const pinned = tab?.pinned ?? false;
    const newOrder = [...this.order];
    newOrder.splice(from, 1);
    const clampedIndex = Math.max(0, Math.min(toIndex, newOrder.length));
    newOrder.splice(clampedIndex, 0, id);
    // Validate: pinned tabs must all precede unpinned tabs
    const pinnedCount = newOrder.filter((i) => this.tabs.get(i)?.pinned).length;
    const pinnedSection = newOrder.slice(0, pinnedCount).every((i) => this.tabs.get(i)?.pinned);
    if (!pinnedSection && pinned) return; // would break ordering
    this.order = newOrder;
    this.broadcastTabs();
  }

  findInPage(id: string, text: string): void {
    const wc = this.liveWc(id);
    if (!wc || !text) return;
    wc.findInPage(text, { findNext: false });
  }

  stopFindInPage(id: string): void {
    this.liveWc(id)?.stopFindInPage('clearSelection');
  }

  listTabs(): TabInfo[] {
    this.pruneDead();
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((t): t is InternalTab => this.isLive(t))
      .map((t) => this.toInfo(t))
      .filter((info): info is TabInfo => info !== null);
  }

  getActiveId(): string | null {
    if (this.activeId && this.isLive(this.tabs.get(this.activeId))) return this.activeId;
    // active tab died (or none was set) — fall back to the most recent live tab
    this.activeId = [...this.order].reverse().find((x) => this.isLive(this.tabs.get(x))) ?? null;
    return this.activeId;
  }

  getTab(id: string): InternalTab | undefined {
    return this.tabs.get(id);
  }

  getTabIdForWebContents(webContentsId: number): string | undefined {
    return this.wcToTab.get(webContentsId);
  }

  getTabUrl(id: string): string {
    return this.liveWc(id)?.getURL() ?? '';
  }

  async screenshot(id: string): Promise<Buffer | null> {
    const wc = this.liveWc(id);
    if (!wc) return null;

    // Fast path — works when this tab is active and the window is on screen.
    try {
      const image = await wc.capturePage();
      if (!image.isEmpty()) return image.toPNG();
    } catch {
      /* "Current display surface not available" — fall through */
    }

    // CDP path — `Page.captureScreenshot` with `fromSurface: false` renders the
    // page from the view rather than the OS compositor surface, so it works for
    // hidden/minimized windows and for inactive (detached) tabs.
    try {
      const png = await this.captureViaCdp(wc);
      if (png && png.length > 0) return png;
    } catch (err) {
      console.error('[tab-manager] CDP screenshot fallback failed', err);
    }

    // Last resort — briefly surface the window (and this tab), capture, restore.
    return this.captureBySurfacing(id, wc);
  }

  private async captureViaCdp(wc: WebContents): Promise<Buffer | null> {
    const dbg = wc.debugger;
    let attachedHere = false;
    if (!dbg.isAttached()) {
      dbg.attach('1.3');
      attachedHere = true;
    }
    try {
      await dbg.sendCommand('Page.enable');
      const { data } = (await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: false,
        captureBeyondViewport: false,
      })) as { data?: string };
      return data ? Buffer.from(data, 'base64') : null;
    } finally {
      if (attachedHere) {
        try {
          dbg.detach();
        } catch {
          /* noop */
        }
      }
    }
  }

  private async captureBySurfacing(id: string, wc: WebContents): Promise<Buffer | null> {
    const win = this.window;
    const wasMinimized = win.isMinimized();
    const wasVisible = win.isVisible();
    const prevActive = this.activeId;
    try {
      if (wasMinimized) win.restore();
      else if (!wasVisible) win.showInactive();
      if (prevActive !== id) this.activateTab(id);
      await new Promise((r) => setTimeout(r, 300));
      const image = await wc.capturePage();
      return image.isEmpty() ? null : image.toPNG();
    } catch (err) {
      console.error('[tab-manager] surfacing screenshot fallback failed', err);
      return null;
    } finally {
      if (prevActive && prevActive !== id) {
        try {
          this.activateTab(prevActive);
        } catch {
          /* noop */
        }
      }
      if (wasMinimized) win.minimize();
      else if (!wasVisible) win.hide();
    }
  }

  async evaluate(id: string, script: string): Promise<unknown> {
    const wc = this.liveWc(id);
    if (!wc) return null;
    return wc.executeJavaScript(script, true);
  }

  async getPageText(id: string): Promise<string | null> {
    const wc = this.liveWc(id);
    if (!wc) return null;
    return wc.executeJavaScript('document.body ? document.body.innerText : ""', true);
  }

  async getPageHtml(id: string): Promise<string | null> {
    const wc = this.liveWc(id);
    if (!wc) return null;
    return wc.executeJavaScript(
      'document.documentElement ? document.documentElement.outerHTML : ""',
      true,
    );
  }

  private toInfo(tab: InternalTab): TabInfo | null {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;   // dead tab — caller filters this out
    try {
      return {
        id: tab.id,
        url: wc.getURL(),
        title: wc.getTitle(),
        favicon: this.favicons.get(tab.id),
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        active: this.activeId === tab.id,
        pinned: tab.pinned,
      };
    } catch {
      return null;
    }
  }

  setToolbarHeight(height: number): void {
    if (!Number.isFinite(height) || height < 0) return;
    // Never shrink below the default — ResizeObserver can fire transient
    // smaller values during initial render. If the toolbar ever climbed into
    // the chrome region the WebContentsView would overlap the address bar
    // and eat clicks on the nav buttons.
    const safe = Math.max(height, DEFAULT_TOOLBAR_HEIGHT);
    if (this.toolbarHeight === safe) return;
    this.toolbarHeight = safe;
    this.layoutActive();
  }

  setSidePanelWidth(width: number): void {
    if (!Number.isFinite(width) || width < 0) return;
    if (this.sidePanelWidth === width) return;
    this.sidePanelWidth = width;
    this.layoutActive();
  }

  private layoutActive(): void {
    if (!this.activeId) return;
    const tab = this.tabs.get(this.activeId);
    if (!this.isLive(tab)) {
      this.pruneDead();
      return;
    }
    const [width, height] = this.window.getContentSize();
    try {
      tab.view.setBounds({
        x: 0,
        y: this.toolbarHeight,
        width: Math.max(0, width - this.sidePanelWidth),
        height: Math.max(0, height - this.toolbarHeight),
      });
    } catch (err) {
      console.error('[tab-manager] setBounds failed', err);
    }
  }

  private broadcastTabs(): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.send('tabs:updated', this.listTabs());
  }
}
