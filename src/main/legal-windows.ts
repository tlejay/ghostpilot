import { app, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

let aboutWindow: BrowserWindow | null = null;
let licensesWindow: BrowserWindow | null = null;

function rendererUrl(page: 'about.html' | 'licenses.html'): {
  loadUrl?: string;
  loadFile?: string;
} {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) return { loadUrl: `${devUrl}/${page}` };
  return { loadFile: join(__dirname, '../renderer', page) };
}

export function openAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#1a0f3d',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    aboutWindow = null;
  });
  const { loadUrl, loadFile } = rendererUrl('about.html');
  if (loadUrl) win.loadURL(loadUrl);
  else if (loadFile) win.loadFile(loadFile);
  aboutWindow = win;
}

export function openLicensesWindow(): void {
  if (licensesWindow && !licensesWindow.isDestroyed()) {
    licensesWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: '#181028',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    licensesWindow = null;
  });
  const { loadUrl, loadFile } = rendererUrl('licenses.html');
  if (loadUrl) win.loadURL(loadUrl);
  else if (loadFile) win.loadFile(loadFile);
  licensesWindow = win;
}

export async function readNotices(): Promise<unknown> {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'notices.json'));
  } else {
    candidates.push(join(__dirname, '../../assets/notices.json'));
    candidates.push(join(app.getAppPath(), 'assets/notices.json'));
  }
  for (const path of candidates) {
    try {
      const raw = await fs.readFile(path, 'utf8');
      return JSON.parse(raw);
    } catch {
      /* try next */
    }
  }
  return [];
}
