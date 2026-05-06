import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../');

export async function launchApp(profile = 'test'): Promise<{ app: ElectronApplication; chrome: Page }> {
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AI_BROWSER_PROFILE: profile,
      AI_BROWSER_MCP_PORT: '19223', // avoid colliding with real instance
    },
  });

  // First window is the main chrome BrowserWindow.
  const chrome = await app.firstWindow();
  await chrome.waitForLoadState('domcontentloaded');
  return { app, chrome };
}
