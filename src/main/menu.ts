import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { TabManager } from './tab-manager.js';
import { openAboutWindow, openLicensesWindow } from './legal-windows.js';
import { checkForUpdates as checkAutoUpdates } from './auto-updater.js';

interface MenuOptions {
  window: BrowserWindow;
  tabManager: TabManager;
}

const isMac = process.platform === 'darwin';

function withActive<T>(tabManager: TabManager, fn: (id: string) => T): T | undefined {
  const id = tabManager.getActiveId();
  if (!id) return undefined;
  return fn(id);
}

export function buildMenu({ window, tabManager }: MenuOptions): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: `About ${app.name}`,
                click: () => openAboutWindow(),
              },
              {
                label: 'Open Source Licenses…',
                click: () => openLicensesWindow(),
              },
              { type: 'separator' as const },
              {
                label: 'Check for Updates…',
                click: () => checkAutoUpdates(false),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => tabManager.newTab(),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => withActive(tabManager, (id) => tabManager.closeTab(id)),
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => withActive(tabManager, (id) => tabManager.reload(id)),
        },
        {
          label: 'Hard Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () =>
            withActive(tabManager, (id) =>
              tabManager.getTab(id)?.view.webContents.reloadIgnoringCache(),
            ),
        },
        {
          label: 'Stop',
          accelerator: 'Esc',
          click: () => withActive(tabManager, (id) => tabManager.stop(id)),
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => withActive(tabManager, (id) => tabManager.toggleDevTools(id)),
        },
        {
          label: 'Toggle Chrome DevTools (UI)',
          accelerator: isMac ? 'Alt+Cmd+Shift+I' : 'Ctrl+Shift+Alt+I',
          click: () => window.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => withActive(tabManager, (id) => tabManager.goBack(id)),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => withActive(tabManager, (id) => tabManager.goForward(id)),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: () => window.webContents.send('focus:address-bar'),
        },
        {
          label: 'Toggle Side Panel',
          accelerator: 'CmdOrCtrl+B',
          click: () => window.webContents.send('toggle:side-panel'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `About ${app.name}`,
          click: () => openAboutWindow(),
        },
        {
          label: 'Open Source Licenses…',
          click: () => openLicensesWindow(),
        },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => checkAutoUpdates(false),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
