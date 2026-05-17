import { app, BrowserWindow, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// In dev mode the running Electron.app's CFBundleName is "Electron", which
// makes the macOS menu bar show "Electron" instead of our productName. Set it
// early so the first menu build (and About panel) read the right name. The
// real fix for the menu bar itself is `pnpm patch-electron`, which rewrites
// node_modules' Electron.app/Contents/Info.plist.
app.setName('GhostPilot');

// Open a CDP endpoint on a fixed port so Lighthouse (and other external CDP
// clients) can attach. Defaults to 9224 — pick a different one with
// AI_BROWSER_DEBUG_PORT if it conflicts with another tool.
const debugPort = Number(process.env.AI_BROWSER_DEBUG_PORT ?? 9224);
app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));

import {
  attachBoundsPersistence,
  loadSavedBounds,
  type SavedBounds,
} from './window-bounds.js';
import { TabManager } from './tab-manager.js';
import { HistoryStore } from './storage/history.js';
import { BookmarksStore } from './storage/bookmarks.js';
import { SkillsStore } from './storage/skills.js';
import { DownloadManager } from './downloads.js';
import { startMcpServer } from './mcp/server.js';
import { buildMenu } from './menu.js';
import { getActiveProfile, partitionFor } from './profile.js';
import {
  openAboutWindow,
  openLicensesWindow,
  readNotices,
} from './legal-windows.js';
import { Recorder } from './recorder.js';
import { MediaDetector } from './media-detector.js';
import { UpdateChecker } from './update-checker.js';
import { findChromeProfiles, importBookmarks, importHistory } from './chrome-import.js';
import { YtdlpManager, detectYtdlp } from './ytdlp.js';
import {
  attachAutoUpdater,
  checkForUpdates as checkAutoUpdates,
  getUpdateState,
  openReleaseNotes,
  quitAndInstall,
} from './auto-updater.js';

interface AppContext {
  window: BrowserWindow;
  tabManager: TabManager;
  history: HistoryStore;
  bookmarks: BookmarksStore;
  skills: SkillsStore;
  downloads: DownloadManager;
  recorder: Recorder;
  mediaDetector: MediaDetector;
  partitionSession: Electron.Session;
  ytdlp: YtdlpManager;
  updateChecker: UpdateChecker;
  profile: string;
}

let ctx: AppContext | null = null;

function createMainWindow(saved: SavedBounds | null): BrowserWindow {
  const win = new BrowserWindow({
    x: saved?.x,
    y: saved?.y,
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachBoundsPersistence(win);
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ctx) {
      ctx.tabManager.newTab(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function registerIpc(): void {
  const tm = () => ctx?.tabManager;

  ipcMain.handle('tabs:list', () => tm()?.listTabs() ?? []);
  ipcMain.handle('tabs:new', (_e, url?: string) => tm()?.newTab(url));
  ipcMain.handle('tabs:close', (_e, id: string) => tm()?.closeTab(id));
  ipcMain.handle('tabs:activate', (_e, id: string) => tm()?.activateTab(id));
  ipcMain.handle('tabs:navigate', (_e, id: string, url: string) =>
    tm()?.navigate(id, url),
  );
  ipcMain.handle('tabs:back', (_e, id: string) => tm()?.goBack(id));
  ipcMain.handle('tabs:forward', (_e, id: string) => tm()?.goForward(id));
  ipcMain.handle('tabs:reload', (_e, id: string) => tm()?.reload(id));
  ipcMain.handle('tabs:stop', (_e, id: string) => tm()?.stop(id));
  ipcMain.handle('tabs:devtools', (_e, id: string) => tm()?.toggleDevTools(id));
  ipcMain.handle('tabs:pin', (_e, id: string) => tm()?.pinTab(id));
  ipcMain.handle('tabs:unpin', (_e, id: string) => tm()?.unpinTab(id));
  ipcMain.handle('tabs:reorder', (_e, id: string, toIndex: number) =>
    tm()?.reorderTab(id, toIndex),
  );
  ipcMain.handle('tabs:find', (_e, id: string, text: string) => tm()?.findInPage(id, text));
  ipcMain.handle('tabs:find-stop', (_e, id: string) => tm()?.stopFindInPage(id));
  ipcMain.handle('chrome:set-toolbar-height', (_e, height: number) =>
    tm()?.setToolbarHeight(height),
  );
  ipcMain.handle('chrome:set-side-panel-width', (_e, width: number) =>
    tm()?.setSidePanelWidth(width),
  );

  ipcMain.handle('history:list', (_e, limit?: number, query?: string) =>
    ctx?.history.list(limit, query) ?? [],
  );
  ipcMain.handle('history:clear', () => ctx?.history.clear());

  ipcMain.handle('bookmarks:list', (_e, query?: string) =>
    ctx?.bookmarks.list(query) ?? [],
  );
  ipcMain.handle('bookmarks:add', (_e, url: string, title: string, folder?: string) =>
    ctx?.bookmarks.add({ url, title, folder }),
  );
  ipcMain.handle('bookmarks:remove', (_e, id: string) => ctx?.bookmarks.remove(id));
  ipcMain.handle('bookmarks:remove-by-url', (_e, url: string) =>
    ctx?.bookmarks.removeByUrl(url),
  );
  ipcMain.handle('bookmarks:has', (_e, url: string) =>
    ctx?.bookmarks.hasUrl(url) ?? false,
  );

  ipcMain.handle('downloads:list', (_e, limit?: number) =>
    ctx?.downloads.list(limit) ?? [],
  );
  ipcMain.handle('downloads:cancel', (_e, id: string) => ctx?.downloads.cancel(id));
  ipcMain.handle('downloads:reveal', (_e, id: string) =>
    ctx?.downloads.revealInFinder(id),
  );
  ipcMain.handle('downloads:clear', () => ctx?.downloads.clear());

  ipcMain.handle('media:list', (_e, tabId?: string) => {
    if (!ctx) return [];
    const id = tabId ?? ctx.tabManager.getActiveId();
    return id ? ctx.mediaDetector.list(id) : [];
  });
  ipcMain.handle('media:download', (_e, url: string) => {
    if (!ctx) return false;
    ctx.mediaDetector.download(ctx.partitionSession, url);
    return true;
  });
  ipcMain.handle('media:clear', (_e, tabId?: string) => {
    if (!ctx) return;
    const id = tabId ?? ctx.tabManager.getActiveId();
    if (id) ctx.mediaDetector.clear(id);
  });

  ipcMain.handle('ytdlp:status', (_e, force?: boolean) => detectYtdlp(force ?? false));
  ipcMain.handle(
    'ytdlp:download',
    (_e, url: string, opts?: { audioOnly?: boolean; format?: string }) => {
      if (!ctx) throw new Error('App not ready');
      // Don't await — return immediately, progress is broadcast via 'ytdlp:job'.
      ctx.ytdlp.download(url, opts ?? {}).catch((err) => {
        console.error('[ytdlp] download failed', err);
      });
      return { ok: true };
    },
  );
  ipcMain.handle('ytdlp:list', () => ctx?.ytdlp.list() ?? []);
  ipcMain.handle('ytdlp:cancel', (_e, id: string) => ctx?.ytdlp.cancel(id));
  ipcMain.handle('ytdlp:reveal', (_e, id: string) => ctx?.ytdlp.reveal(id));
  ipcMain.handle('ytdlp:clear', () => ctx?.ytdlp.clearFinished());

  ipcMain.handle('profile:current', () => ctx?.profile ?? 'default');
  ipcMain.handle('profile:list', () => {
    try {
      const profilesDir = join(app.getPath('userData'), 'profiles');
      return readdirSync(profilesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [ctx?.profile ?? 'default'];
    }
  });
  ipcMain.handle('profile:switch', (_e, name: string) => {
    if (!name || !/^[\w-]{1,32}$/.test(name)) return;
    process.env['AI_BROWSER_PROFILE'] = name;
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  });

  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
  }));
  ipcMain.handle('app:notices', () => readNotices());
  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:open-about', () => openAboutWindow());
  ipcMain.handle('app:open-licenses', () => openLicensesWindow());

  ipcMain.handle('chrome:profiles', () => findChromeProfiles());
  ipcMain.handle('chrome:import-bookmarks', (_e, profile?: string) => {
    if (!ctx) throw new Error('App not ready');
    return importBookmarks(ctx.bookmarks, profile);
  });
  ipcMain.handle(
    'chrome:import-history',
    (_e, profile?: string, limit?: number) => {
      if (!ctx) throw new Error('App not ready');
      return importHistory(ctx.history, { profile, limit });
    },
  );
  ipcMain.handle('updates:status', () => ctx?.updateChecker.status());
  ipcMain.handle('updates:check', async (_e, force?: boolean) => {
    await ctx?.updateChecker.checkNow(force ?? true);
    return ctx?.updateChecker.status();
  });

  ipcMain.handle('autoupdate:state', () => getUpdateState());
  ipcMain.handle('autoupdate:check', () => checkAutoUpdates(false));
  ipcMain.handle('autoupdate:install', () => quitAndInstall());
  ipcMain.handle('autoupdate:release-notes', (_e, version?: string) =>
    openReleaseNotes(version),
  );
}

function configureAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: 'GhostPilot',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Tle · MIT License · from madebytle.com',
    credits: 'Built with Electron, React, and the Model Context Protocol SDK.',
    website: 'https://madebytle.com',
    authors: ['Tle (Jakapong Tangtrongsakuldee)'],
  });
}

function applyDockIcon(): void {
  if (process.platform !== 'darwin') return;
  // In dev mode, the bundled .icns isn't applied; set the dock icon manually.
  if (app.isPackaged) return;
  const iconPath = join(__dirname, '../../assets/icon.png');
  try {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) app.dock?.setIcon(image);
  } catch {
    /* icon.png may not be generated yet on first run */
  }
}

app.whenReady().then(async () => {
  registerIpc();
  configureAboutPanel();
  applyDockIcon();

  const profile = getActiveProfile();
  const partition = partitionFor(profile);

  const savedBounds = await loadSavedBounds();
  const window = createMainWindow(savedBounds);
  const history = new HistoryStore(profile);
  const bookmarks = new BookmarksStore(profile);
  const skills = new SkillsStore(profile);
  const recorder = new Recorder();
  const ses = session.fromPartition(partition);
  recorder.attachNetwork(ses);
  const downloads = new DownloadManager(window, profile);
  downloads.attach(ses);

  // Media detector needs to ask TabManager which tab a webContents belongs to,
  // so we use a forward-reference closure.
  let tabManagerRef: TabManager | null = null;
  const mediaDetector = new MediaDetector({
    window,
    resolveTabId: (wcId) => tabManagerRef?.getTabIdForWebContents(wcId),
    resolvePageUrl: (tabId) => tabManagerRef?.getTabUrl(tabId) ?? '',
  });
  mediaDetector.attach(ses);

  const tabManager = new TabManager({
    window,
    partition,
    history,
    recorder,
    mediaDetector,
  });
  tabManagerRef = tabManager;

  const updateChecker = new UpdateChecker();
  // Fire-and-forget initial check; the banner appears on the next tool call.
  updateChecker.checkNow().catch(() => {});

  const ytdlp = new YtdlpManager(window);

  ctx = {
    window,
    tabManager,
    history,
    bookmarks,
    skills,
    downloads,
    recorder,
    mediaDetector,
    partitionSession: ses,
    ytdlp,
    updateChecker,
    profile,
  };

  attachAutoUpdater(window);
  Menu.setApplicationMenu(buildMenu({ window, tabManager }));

  tabManager.newTab();

  const port = Number(process.env.AI_BROWSER_MCP_PORT ?? 9223);
  const token = process.env.AI_BROWSER_MCP_TOKEN?.trim() || undefined;
  const oauthPassword = process.env.GHOSTPILOT_OAUTH_PASSWORD?.trim() || undefined;
  await startMcpServer({
    port,
    token,
    oauthPassword,
    profile,
    tabManager,
    history,
    bookmarks,
    skills,
    downloads,
    recorder,
    mediaDetector,
    partitionSession: ses,
    ytdlp,
    updateChecker,
    mainWindow: window,
  });
  const authMode = oauthPassword
    ? token
      ? 'oauth + bearer'
      : 'oauth'
    : token
      ? 'bearer'
      : 'open';
  console.log(
    `[GhostPilot] profile="${profile}" — MCP on http://127.0.0.1:${port}/mcp (auth: ${authMode})`,
  );

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopenedBounds = await loadSavedBounds();
      const win = createMainWindow(reopenedBounds);
      const rec = new Recorder();
      const s = session.fromPartition(partition);
      rec.attachNetwork(s);
      const dl = new DownloadManager(win, profile);
      dl.attach(s);
      let tmRef: TabManager | null = null;
      const md = new MediaDetector({
        window: win,
        resolveTabId: (wcId) => tmRef?.getTabIdForWebContents(wcId),
        resolvePageUrl: (tabId) => tmRef?.getTabUrl(tabId) ?? '',
      });
      md.attach(s);
      const tm = new TabManager({
        window: win,
        partition,
        history,
        recorder: rec,
        mediaDetector: md,
      });
      tmRef = tm;
      const yt = new YtdlpManager(win);
      ctx = {
        window: win,
        tabManager: tm,
        history,
        bookmarks,
        skills,
        downloads: dl,
        recorder: rec,
        mediaDetector: md,
        partitionSession: s,
        ytdlp: yt,
        updateChecker,
        profile,
      };
      Menu.setApplicationMenu(buildMenu({ window: win, tabManager: tm }));
      tm.newTab();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
