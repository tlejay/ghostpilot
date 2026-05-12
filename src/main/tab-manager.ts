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

    wc.loadURL(url).catch((err) => console.error('[tab-manager] loadURL failed', err));

    this.activateTab(id);
    return this.toInfo(tab);
  }

  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const wcId = tab.view.webContents.id;
    try {
      this.window.contentView.removeChildView(tab.view);
    } catch {
      /* already detached */
    }
    try {
      tab.view.webContents.close();
    } catch {
      /* noop */
    }
    this.recorder.detach(id, wcId);
    this.mediaDetector.detach(id);
    this.wcToTab.delete(wcId);
    this.tabs.delete(id);
    this.favicons.delete(id);
    this.order = this.order.filter((x) => x !== id);

    if (this.activeId === id) {
      const next = this.order[this.order.length - 1] ?? null;
      this.activeId = null;
      if (next) this.activateTab(next);
      else this.broadcastTabs();
    } else {
      this.broadcastTabs();
    }
  }

  activateTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;

    for (const [otherId, other] of this.tabs) {
      if (otherId !== id) {
        try {
          this.window.contentView.removeChildView(other.view);
        } catch {
          /* already removed */
        }
      }
    }

    this.window.contentView.addChildView(tab.view);
    this.activeId = id;
    this.layoutActive();
    this.broadcastTabs();
  }

  navigate(id: string, rawUrl: string): void {
    this.tabs.get(id)?.view.webContents.loadURL(normalizeUrl(rawUrl));
  }

  goBack(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.tabs.get(id)?.view.webContents.reload();
  }

  stop(id: string): void {
    this.tabs.get(id)?.view.webContents.stop();
  }

  toggleDevTools(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  pressKey(id: string, key: string, modifiers: string[] = []): boolean {
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) return false;
    const mod = modifiers as Array<'shift' | 'control' | 'alt' | 'meta'>;
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mod });
    if (key.length === 1) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers: mod });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mod });
    return true;
  }

  typeText(id: string, text: string): boolean {
    const wc = this.tabs.get(id)?.view.webContents;
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
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) throw new Error(`Tab not found: ${id}`);
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
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) throw new Error(`Tab not found: ${id}`);
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
    const wc = this.tabs.get(id)?.view.webContents;
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
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc || !text) return;
    wc.findInPage(text, { findNext: false });
  }

  stopFindInPage(id: string): void {
    this.tabs.get(id)?.view.webContents.stopFindInPage('clearSelection');
  }

  listTabs(): TabInfo[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((t): t is InternalTab => Boolean(t))
      .map((t) => this.toInfo(t));
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getTab(id: string): InternalTab | undefined {
    return this.tabs.get(id);
  }

  getTabIdForWebContents(webContentsId: number): string | undefined {
    return this.wcToTab.get(webContentsId);
  }

  getTabUrl(id: string): string {
    const tab = this.tabs.get(id);
    return tab?.view.webContents.getURL() ?? '';
  }

  async screenshot(id: string): Promise<Buffer | null> {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    const wc = tab.view.webContents;

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
    const tab = this.tabs.get(id);
    if (!tab) return null;
    return tab.view.webContents.executeJavaScript(script, true);
  }

  async getPageText(id: string): Promise<string | null> {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    return tab.view.webContents.executeJavaScript(
      'document.body ? document.body.innerText : ""',
      true,
    );
  }

  async getPageHtml(id: string): Promise<string | null> {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    return tab.view.webContents.executeJavaScript(
      'document.documentElement ? document.documentElement.outerHTML : ""',
      true,
    );
  }

  private toInfo(tab: InternalTab): TabInfo {
    const wc = tab.view.webContents;
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
    if (!tab) return;
    const [width, height] = this.window.getContentSize();
    tab.view.setBounds({
      x: 0,
      y: this.toolbarHeight,
      width: Math.max(0, width - this.sidePanelWidth),
      height: Math.max(0, height - this.toolbarHeight),
    });
  }

  private broadcastTabs(): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.send('tabs:updated', this.listTabs());
  }
}
