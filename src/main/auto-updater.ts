// Wraps electron-updater with sensible defaults and forwards events to the
// renderer so the UI can show a Chrome-style "update available / restart to
// install" banner. Only runs in packaged builds — in dev there's nothing to
// auto-update against. The MCP `UpdateChecker` (separate file) handles the
// CLI nag for both dev and prod.

import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  stage: UpdateStage;
  version?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  progressPercent?: number;
  errorMessage?: string;
}

let state: UpdateState = { stage: 'idle' };
let mainWindowRef: BrowserWindow | null = null;
let configured = false;

function broadcast() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updates:state', state);
  }
}

function setState(next: Partial<UpdateState>) {
  state = { ...state, ...next };
  broadcast();
}

export function getUpdateState(): UpdateState {
  return state;
}

function configure(): void {
  if (configured) return;
  configured = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => setState({ stage: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    setState({
      stage: 'available',
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : (info.releaseNotes ?? []).map((r) => r.note).join('\n\n'),
    }),
  );
  autoUpdater.on('update-not-available', () =>
    setState({ stage: 'not-available' }),
  );
  autoUpdater.on('download-progress', (progress) =>
    setState({ stage: 'downloading', progressPercent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    setState({
      stage: 'downloaded',
      version: info.version,
    }),
  );
  autoUpdater.on('error', (err) => {
    const raw = err?.message ?? String(err);
    // 404 → repo or release not found yet. That's not an error from the
    // user's perspective; treat it as "no update available" (no banner).
    if (/\b404\b|HttpError: 404|releases\.atom/i.test(raw)) {
      setState({ stage: 'not-available' });
      return;
    }
    // Compact the message — electron-updater sometimes dumps the entire
    // HTTP response (headers + cookies). Take only the first short line.
    const message = raw.split(/\r?\n/)[0]!.slice(0, 140);
    setState({ stage: 'error', errorMessage: message });
  });
}

export function attachAutoUpdater(window: BrowserWindow): void {
  mainWindowRef = window;
  if (!app.isPackaged) {
    setState({ stage: 'idle' });
    return; // dev mode: nothing to update
  }
  configure();
  // Fire-and-forget initial check 5s after launch so the UI is up first.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      setState({ stage: 'error', errorMessage: (err as Error).message });
    });
  }, 5000);
}

export async function checkForUpdates(silent = false): Promise<UpdateState> {
  if (!app.isPackaged) {
    if (!silent) {
      await dialog.showMessageBox({
        type: 'info',
        message: 'Auto-update is unavailable in dev mode.',
        detail: 'Build a packaged release with `pnpm dist` to enable Chrome-style auto-updates.',
      });
    }
    return state;
  }
  configure();
  setState({ stage: 'checking' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({ stage: 'error', errorMessage: (err as Error).message });
  }

  if (silent) return state;

  // Show a friendly summary dialog when the user invoked this from the menu.
  switch (state.stage) {
    case 'available':
    case 'downloading':
      await dialog.showMessageBox({
        type: 'info',
        message: `GhostPilot ${state.version ?? ''} is available.`,
        detail: 'Download is in progress. You will be prompted to restart when it finishes.',
      });
      break;
    case 'downloaded':
      await dialog.showMessageBox({
        type: 'info',
        message: `GhostPilot ${state.version} is ready to install.`,
        detail: 'Click "Restart to update" in the banner at the top of the window.',
      });
      break;
    case 'not-available':
      await dialog.showMessageBox({
        type: 'info',
        message: "You're on the latest version.",
        detail: `GhostPilot ${app.getVersion()}`,
      });
      break;
    case 'error':
      await dialog.showMessageBox({
        type: 'warning',
        message: "Couldn't check for updates.",
        detail: state.errorMessage ?? 'Unknown error',
      });
      break;
  }
  return state;
}

// Quit and install. The user clicks the "Restart to update" button.
export function quitAndInstall(): void {
  if (state.stage !== 'downloaded') return;
  autoUpdater.quitAndInstall(false, true);
}

export function openReleaseNotes(version?: string): void {
  const v = version ?? state.version;
  if (!v) return;
  shell.openExternal(`https://github.com/madebytle/ghostpilot/releases/tag/v${v}`);
}
