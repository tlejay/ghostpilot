import { app, BrowserWindow, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { isHeadless } from './headless.js';
import { registerTools } from './mcp/tools.js';
import {
  generateDts,
  type CapturedTool,
  type ZodRawShape,
} from './mcp/dts-generator.js';

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

// Plan #4 headless mode — resolved once at module load (before whenReady)
// so we can hide the dock icon before the app fully boots.
const HEADLESS = isHeadless(process.argv, process.env);
if (HEADLESS) {
  // eslint-disable-next-line no-console
  console.log(
    `[headless] enabled — main window hidden${process.platform === 'darwin' ? ', dock icon hidden (darwin)' : ''}`,
  );
  if (process.platform === 'darwin') app.dock?.hide();
}

// Plan #14 — `--gen-types <path>` early-exit branch. Boots Electron just far
// enough to load tools.ts + registerTools, captures every server.registerTool
// call against a stub server, walks the Zod schemas, writes a .d.ts file,
// and exits. No window / no MCP port / no IPC.
function parseGenTypesArg(argv: string[]): string | null {
  const flagIdx = argv.indexOf('--gen-types');
  if (flagIdx < 0) return null;
  const next = argv[flagIdx + 1];
  if (!next || next.startsWith('--')) {
    console.error('[gen-types] --gen-types requires a path argument');
    return null;
  }
  return next;
}
const GEN_TYPES_PATH = parseGenTypesArg(process.argv);
if (GEN_TYPES_PATH) {
  if (process.platform === 'darwin') app.dock?.hide();
}

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

function createMainWindow(saved: SavedBounds | null, headless = false): BrowserWindow {
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
  if (!headless) {
    win.once('ready-to-show', () => win.show());
  }

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
  // Headless: we already called app.dock?.hide() at module load; do not set
  // the icon (which would re-surface the dock entry).
  if (HEADLESS) return;
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

function runGenTypes(outPath: string): void {
  const fs = require('node:fs') as typeof import('node:fs');

  // Capture every server.registerTool() call against a fake McpServer.
  const captured: CapturedTool[] = [];

  const fakeServer = {
    registerTool: (
      name: string,
      def: { description?: string; inputSchema?: ZodRawShape },
      _handler: unknown,
    ) => {
      captured.push({
        name,
        description: def?.description ?? '',
        inputSchema: def?.inputSchema ?? {},
      });
      return { name };
    },
    close: async () => {},
  };

  // Stub deps — only need to satisfy structural typing; handlers never run
  // (registration captures schemas only, no behavior is invoked).
  const stubDeps = {
    tabManager: {},
    history: {},
    bookmarks: {},
    skills: {},
    downloads: {},
    recorder: {},
    mediaDetector: {},
    partitionSession: {},
    ytdlp: {},
    updateChecker: { banner: () => '' },
    mainWindow: {},
    headless: false,
    profile: 'default',
  } as unknown as Parameters<typeof registerTools>[1];

  registerTools(fakeServer as never, stubDeps);

  // Post-fill category from source (cheap regex; the tool() thunk's category
  // arg is not exposed to fakeServer, but the source files are committed
  // alongside the built bundle in dev). In a packaged .app this will resolve
  // through `app.getAppPath()/src/main/mcp/*.ts` if present, otherwise leave
  // category undefined — the generator gracefully omits the category map.
  const candidateRoots = [
    join(__dirname, 'mcp'), // dev (out/main/mcp doesn't exist for source, but…)
    join(app.getAppPath(), 'src', 'main', 'mcp'), // dev pnpm-run path
    join(__dirname, '..', '..', 'src', 'main', 'mcp'), // legacy packaged path
    join(process.resourcesPath ?? '', 'src', 'main', 'mcp'), // packaged .app: Contents/Resources/src/main/mcp/
  ];
  let sources = '';
  for (const root of candidateRoots) {
    for (const f of ['tools.ts', 'locator-tools.ts']) {
      try {
        sources += fs.readFileSync(join(root, f), 'utf8') + '\n';
      } catch {
        /* not present at this root — try next */
      }
    }
    if (sources) break;
  }
  if (sources) {
    const re = /tool\('([a-z]+)',\s*\(\)\s*=>\s*[\s\S]*?registerTool\(\s*'([a-z0-9_]+)'/g;
    const nameToCat: Record<string, string> = {};
    let m: RegExpExecArray | null;
    while ((m = re.exec(sources)) !== null) nameToCat[m[2]] = m[1];
    for (const t of captured) {
      if (!t.category && nameToCat[t.name]) t.category = nameToCat[t.name];
    }
  }

  // Read version from package.json so the banner reflects the build.
  // Walk up from __dirname looking for the first package.json; covers both
  // dev (out/main → ../.. = repo root) and packaged .app (Contents/Resources/app
  // → app/package.json) layouts.
  let version = '0.0.0';
  const versionCandidates = [
    join(__dirname, '..', '..', 'package.json'),
    join(app.getAppPath(), 'package.json'),
  ];
  for (const p of versionCandidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as { version?: string };
      if (pkg.version) {
        version = pkg.version;
        break;
      }
    } catch {
      /* try next */
    }
  }

  const { text, warnings } = generateDts(captured, {
    version,
    toolCount: captured.length,
  });
  for (const w of warnings) console.warn(`[gen-types] ${w}`);

  try {
    mkdirSync(dirname(outPath), { recursive: true });
  } catch {
    /* already exists */
  }
  writeFileSync(outPath, text, 'utf8');
  console.log(
    `[gen-types] wrote ${captured.length} tools → ${outPath} (${text.length} bytes)`,
  );
}

if (GEN_TYPES_PATH) {
  app.whenReady().then(() => {
    try {
      runGenTypes(GEN_TYPES_PATH);
      app.exit(0);
    } catch (err) {
      console.error('[gen-types] fatal:', err);
      app.exit(1);
    }
  });
}

app.whenReady().then(async () => {
  if (GEN_TYPES_PATH) return; // gen-types branch handled the lifecycle
  registerIpc();
  configureAboutPanel();
  applyDockIcon();

  const profile = getActiveProfile();
  const partition = partitionFor(profile);

  const savedBounds = await loadSavedBounds();
  const window = createMainWindow(savedBounds, HEADLESS);
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
    headless: HEADLESS,
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
      const win = createMainWindow(reopenedBounds, HEADLESS);
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
