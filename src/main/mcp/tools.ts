import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TabManager } from '../tab-manager.js';
import type { HistoryStore } from '../storage/history.js';
import type { BookmarksStore } from '../storage/bookmarks.js';
import type { SkillsStore } from '../storage/skills.js';
import type { DownloadManager } from '../downloads.js';
import type { Recorder } from '../recorder.js';
import type { MediaDetector } from '../media-detector.js';
import type { YtdlpManager } from '../ytdlp.js';
import { detectYtdlp } from '../ytdlp.js';
import type { UpdateChecker } from '../update-checker.js';
import { importBookmarks, importHistory, findChromeProfiles } from '../chrome-import.js';
import type { Session } from 'electron';

export interface ToolDeps {
  tabManager: TabManager;
  history: HistoryStore;
  bookmarks: BookmarksStore;
  skills: SkillsStore;
  downloads: DownloadManager;
  recorder: Recorder;
  mediaDetector: MediaDetector;
  partitionSession: Session;
  ytdlp: YtdlpManager;
  updateChecker: UpdateChecker;
}

const text = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const {
    tabManager,
    history,
    bookmarks,
    skills,
    downloads,
    recorder,
    mediaDetector,
    partitionSession,
    ytdlp,
    updateChecker,
  } = deps;

  const requireTab = (tabId: string) => {
    const tab = tabManager.getTab(tabId);
    if (!tab) throw new Error(`Tab not found: ${tabId}`);
    return tab;
  };

  const resolveTabId = (tabId?: string): string => {
    if (tabId) return tabId;
    const active = tabManager.getActiveId();
    if (!active) throw new Error('No active tab');
    return active;
  };

  // ── Tabs ──────────────────────────────────────────────────────────
  server.registerTool(
    'list_tabs',
    {
      description: 'List every open browser tab with id, url, title, loading state, and active flag.',
      inputSchema: {},
    },
    async () => text(tabManager.listTabs()),
  );

  server.registerTool(
    'new_tab',
    {
      description: 'Open a new tab. URL accepts schemes, bare hostnames, or search queries (Google).',
      inputSchema: { url: z.string().optional() },
    },
    async ({ url }) => text(tabManager.newTab(url)),
  );

  server.registerTool(
    'close_tab',
    { description: 'Close a tab by id.', inputSchema: { tabId: z.string() } },
    async ({ tabId }) => {
      tabManager.closeTab(tabId);
      return text({ ok: true });
    },
  );

  server.registerTool(
    'activate_tab',
    { description: 'Bring a tab to the foreground.', inputSchema: { tabId: z.string() } },
    async ({ tabId }) => {
      tabManager.activateTab(tabId);
      return text({ ok: true });
    },
  );

  server.registerTool(
    'navigate',
    {
      description: 'Navigate the given tab (or active tab) to a URL.',
      inputSchema: { url: z.string(), tabId: z.string().optional() },
    },
    async ({ url, tabId }) => {
      const id = resolveTabId(tabId);
      tabManager.navigate(id, url);
      return text({ ok: true, tabId: id });
    },
  );

  server.registerTool(
    'go_back',
    { description: 'Navigate back.', inputSchema: { tabId: z.string().optional() } },
    async ({ tabId }) => {
      tabManager.goBack(resolveTabId(tabId));
      return text({ ok: true });
    },
  );

  server.registerTool(
    'go_forward',
    { description: 'Navigate forward.', inputSchema: { tabId: z.string().optional() } },
    async ({ tabId }) => {
      tabManager.goForward(resolveTabId(tabId));
      return text({ ok: true });
    },
  );

  server.registerTool(
    'reload',
    { description: 'Reload the page.', inputSchema: { tabId: z.string().optional() } },
    async ({ tabId }) => {
      tabManager.reload(resolveTabId(tabId));
      return text({ ok: true });
    },
  );

  server.registerTool(
    'stop',
    { description: 'Stop loading.', inputSchema: { tabId: z.string().optional() } },
    async ({ tabId }) => {
      tabManager.stop(resolveTabId(tabId));
      return text({ ok: true });
    },
  );

  server.registerTool(
    'toggle_devtools',
    {
      description: 'Open or close DevTools for the given tab.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      tabManager.toggleDevTools(resolveTabId(tabId));
      return text({ ok: true });
    },
  );

  // ── Page content ──────────────────────────────────────────────────
  server.registerTool(
    'get_page_text',
    {
      description: 'Return rendered innerText of the page body.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      return text((await tabManager.getPageText(id)) ?? '');
    },
  );

  server.registerTool(
    'get_page_html',
    {
      description: 'Return outerHTML of the document.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      return text((await tabManager.getPageHtml(id)) ?? '');
    },
  );

  server.registerTool(
    'screenshot',
    {
      description: 'PNG screenshot of the tab as base64.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      const buf = await tabManager.screenshot(id);
      if (!buf) throw new Error('Failed to capture screenshot');
      return {
        content: [
          { type: 'image' as const, data: buf.toString('base64'), mimeType: 'image/png' },
        ],
      };
    },
  );

  server.registerTool(
    'evaluate',
    {
      description:
        'Run JavaScript in the page context and return the result. Use a single expression or IIFE returning a JSON-serializable value.',
      inputSchema: { script: z.string(), tabId: z.string().optional() },
    },
    async ({ script, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      return text((await tabManager.evaluate(id, script)) ?? null);
    },
  );

  server.registerTool(
    'click',
    {
      description: 'Click the first element matching the CSS selector.',
      inputSchema: { selector: z.string(), tabId: z.string().optional() },
    },
    async ({ selector, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      const sel = JSON.stringify(selector);
      const out = await tabManager.evaluate(
        id,
        `(() => { const el = document.querySelector(${sel}); if (!el) return { ok:false, error:'not found' }; el.click(); return { ok:true }; })()`,
      );
      return text(out);
    },
  );

  server.registerTool(
    'fill',
    {
      description: 'Set value on input/textarea matching selector and dispatch input + change events.',
      inputSchema: {
        selector: z.string(),
        value: z.string(),
        tabId: z.string().optional(),
      },
    },
    async ({ selector, value, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      const sel = JSON.stringify(selector);
      const val = JSON.stringify(value);
      const out = await tabManager.evaluate(
        id,
        `(() => {
          const el = document.querySelector(${sel});
          if (!el) return { ok:false, error:'not found' };
          el.focus();
          if ('value' in el) el.value = ${val};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok:true };
        })()`,
      );
      return text(out);
    },
  );

  server.registerTool(
    'wait_for_selector',
    {
      description: 'Wait until selector exists in the DOM (default timeout 10000ms).',
      inputSchema: {
        selector: z.string(),
        timeoutMs: z.number().int().positive().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ selector, timeoutMs, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      const sel = JSON.stringify(selector);
      const t = timeoutMs ?? 10000;
      const out = await tabManager.evaluate(
        id,
        `new Promise((resolve) => {
          const start = Date.now();
          const tick = () => {
            if (document.querySelector(${sel})) return resolve({ ok:true, waitedMs: Date.now()-start });
            if (Date.now()-start > ${t}) return resolve({ ok:false, error:'timeout' });
            setTimeout(tick, 100);
          };
          tick();
        })`,
      );
      return text(out);
    },
  );

  // ── History ───────────────────────────────────────────────────────
  server.registerTool(
    'history_list',
    {
      description: 'Return browser history. Optional case-insensitive substring match against url/title.',
      inputSchema: {
        limit: z.number().int().positive().max(1000).optional(),
        query: z.string().optional(),
      },
    },
    async ({ limit, query }) => text(await history.list(limit ?? 100, query)),
  );

  server.registerTool(
    'history_clear',
    { description: 'Clear all browser history for this profile.', inputSchema: {} },
    async () => {
      await history.clear();
      return text({ ok: true });
    },
  );

  // ── Bookmarks ─────────────────────────────────────────────────────
  server.registerTool(
    'bookmarks_list',
    {
      description: 'List bookmarks. Optional case-insensitive substring match.',
      inputSchema: { query: z.string().optional() },
    },
    async ({ query }) => text(await bookmarks.list(query)),
  );

  server.registerTool(
    'bookmarks_add',
    {
      description: 'Bookmark a URL with title and optional folder.',
      inputSchema: {
        url: z.string(),
        title: z.string(),
        folder: z.string().optional(),
      },
    },
    async ({ url, title, folder }) => text(await bookmarks.add({ url, title, folder })),
  );

  server.registerTool(
    'bookmarks_remove',
    {
      description: 'Remove a bookmark by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      await bookmarks.remove(id);
      return text({ ok: true });
    },
  );

  // ── Downloads ─────────────────────────────────────────────────────
  server.registerTool(
    'downloads_list',
    {
      description: 'List downloads, newest first.',
      inputSchema: { limit: z.number().int().positive().max(500).optional() },
    },
    async ({ limit }) => text(await downloads.list(limit ?? 100)),
  );

  server.registerTool(
    'downloads_cancel',
    {
      description: 'Cancel an in-progress download by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => text({ ok: await downloads.cancel(id) }),
  );

  server.registerTool(
    'downloads_reveal',
    {
      description: 'Reveal a completed download in Finder.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => text({ ok: await downloads.revealInFinder(id) }),
  );

  server.registerTool(
    'downloads_clear',
    {
      description: 'Clear finished downloads from the list (in-flight downloads are kept).',
      inputSchema: {},
    },
    async () => {
      await downloads.clear();
      return text({ ok: true });
    },
  );

  // ── Input (low-level) ─────────────────────────────────────────────
  server.registerTool(
    'press_key',
    {
      description:
        'Press a single key (e.g. "Enter", "Tab", "Escape", "ArrowDown", or "a"). Optional modifiers: shift/control/alt/meta.',
      inputSchema: {
        key: z.string(),
        modifiers: z.array(z.enum(['shift', 'control', 'alt', 'meta'])).optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ key, modifiers, tabId }) => {
      const id = resolveTabId(tabId);
      const ok = tabManager.pressKey(id, key, modifiers);
      return text({ ok });
    },
  );

  server.registerTool(
    'type_text',
    {
      description:
        'Type a literal string into whichever element currently has focus (call `click` or `fill` first to focus an input).',
      inputSchema: { text: z.string(), tabId: z.string().optional() },
    },
    async ({ text: input, tabId }) => {
      const id = resolveTabId(tabId);
      const ok = tabManager.typeText(id, input);
      return text({ ok });
    },
  );

  server.registerTool(
    'hover',
    {
      description: 'Move the mouse pointer to the centre of the element matching the selector.',
      inputSchema: { selector: z.string(), tabId: z.string().optional() },
    },
    async ({ selector, tabId }) => {
      const id = resolveTabId(tabId);
      const ok = await tabManager.hover(id, selector);
      return text({ ok });
    },
  );

  // ── Console ───────────────────────────────────────────────────────
  server.registerTool(
    'list_console_messages',
    {
      description:
        'Return console messages captured for the tab (rolling buffer of 200). Optional level filter: info, warning, error, debug.',
      inputSchema: {
        level: z.enum(['info', 'warning', 'error', 'debug']).optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ level, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      return text(recorder.getConsole(id, level));
    },
  );

  server.registerTool(
    'clear_console_messages',
    {
      description: 'Clear the captured console buffer for the tab.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      recorder.clearConsole(id);
      return text({ ok: true });
    },
  );

  // ── Network ───────────────────────────────────────────────────────
  server.registerTool(
    'list_network_requests',
    {
      description:
        'Return network requests captured for the tab (rolling buffer of 500). Optional filters: method (GET/POST/...), status, urlIncludes (substring match).',
      inputSchema: {
        method: z.string().optional(),
        status: z.number().int().optional(),
        urlIncludes: z.string().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ method, status, urlIncludes, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      return text(recorder.getNetwork(id, { method, status, urlIncludes }));
    },
  );

  server.registerTool(
    'clear_network_requests',
    {
      description: 'Clear the captured network buffer for the tab.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      recorder.clearNetwork(id);
      return text({ ok: true });
    },
  );

  // ── Raw CDP escape hatch ──────────────────────────────────────────
  server.registerTool(
    'cdp_send',
    {
      description:
        'Forward a raw Chrome DevTools Protocol command to the tab. Anything chrome-devtools MCP can do (Network.*, DOM.*, Page.*, Performance.*, Accessibility.*, Emulation.*, …) is accessible here. See https://chromedevtools.github.io/devtools-protocol/.',
      inputSchema: {
        method: z.string(),
        params: z.record(z.unknown()).optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ method, params, tabId }) => {
      const id = resolveTabId(tabId);
      const result = await tabManager.cdpSend(id, method, params);
      return text(result ?? null);
    },
  );

  // ── Chrome import ─────────────────────────────────────────────────
  server.registerTool(
    'list_chrome_profiles',
    {
      description: 'List available Google Chrome profile directories on this Mac (Default, Profile 1, …).',
      inputSchema: {},
    },
    async () => text(await findChromeProfiles()),
  );

  server.registerTool(
    'import_chrome_bookmarks',
    {
      description:
        'Import bookmarks from Google Chrome. Default profile is "Default". URLs already bookmarked in GhostPilot are skipped.',
      inputSchema: { profile: z.string().optional() },
    },
    async ({ profile }) => text(await importBookmarks(bookmarks, profile)),
  );

  server.registerTool(
    'import_chrome_history',
    {
      description:
        'Import history from Google Chrome. Chrome should be closed (we copy the locked DB to /tmp first either way). Default limit 5000 most-recent visits.',
      inputSchema: {
        profile: z.string().optional(),
        limit: z.number().int().positive().max(50000).optional(),
      },
    },
    async ({ profile, limit }) => text(await importHistory(history, { profile, limit })),
  );

  // ── chrome-devtools parity wrappers ───────────────────────────────
  server.registerTool(
    'a11y_snapshot',
    {
      description:
        'Return a simplified accessibility tree for the page (role, name, value, focusable). Equivalent to chrome-devtools take_snapshot — useful for letting an LLM navigate by semantic role instead of CSS selectors.',
      inputSchema: {
        interestingOnly: z.boolean().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ interestingOnly, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      const tree = (await tabManager.cdpSend(id, 'Accessibility.getFullAXTree', {})) as {
        nodes: Array<{
          nodeId: string;
          role?: { value: string };
          name?: { value: string };
          value?: { value: unknown };
          ignored?: boolean;
          childIds?: string[];
          parentId?: string;
        }>;
      };
      const useInteresting = interestingOnly !== false;
      const slim = tree.nodes
        .filter((n) => !useInteresting || (!n.ignored && (n.role?.value ?? 'none') !== 'none'))
        .map((n) => ({
          nodeId: n.nodeId,
          role: n.role?.value,
          name: n.name?.value,
          value: n.value?.value,
          parentId: n.parentId,
          childIds: n.childIds,
        }));
      return text({ count: slim.length, nodes: slim });
    },
  );

  server.registerTool(
    'emulate',
    {
      description:
        'Apply device / network emulation overrides to the tab. Pass any subset: width+height (with optional deviceScaleFactor and mobile), userAgent, offline, downloadKbps + uploadKbps + latencyMs.',
      inputSchema: {
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        deviceScaleFactor: z.number().positive().optional(),
        mobile: z.boolean().optional(),
        userAgent: z.string().optional(),
        offline: z.boolean().optional(),
        downloadKbps: z.number().nonnegative().optional(),
        uploadKbps: z.number().nonnegative().optional(),
        latencyMs: z.number().nonnegative().optional(),
        tabId: z.string().optional(),
      },
    },
    async (args) => {
      const id = resolveTabId(args.tabId);
      requireTab(id);
      const out: Record<string, unknown> = {};
      if (args.width != null && args.height != null) {
        await tabManager.cdpSend(id, 'Emulation.setDeviceMetricsOverride', {
          width: args.width,
          height: args.height,
          deviceScaleFactor: args.deviceScaleFactor ?? 1,
          mobile: args.mobile ?? false,
        });
        out.metrics = { width: args.width, height: args.height };
      }
      if (args.userAgent != null) {
        await tabManager.cdpSend(id, 'Emulation.setUserAgentOverride', {
          userAgent: args.userAgent,
        });
        out.userAgent = args.userAgent;
      }
      if (
        args.offline != null ||
        args.downloadKbps != null ||
        args.uploadKbps != null ||
        args.latencyMs != null
      ) {
        await tabManager.cdpSend(id, 'Network.enable', {});
        await tabManager.cdpSend(id, 'Network.emulateNetworkConditions', {
          offline: args.offline ?? false,
          downloadThroughput: args.downloadKbps != null ? (args.downloadKbps * 1024) / 8 : -1,
          uploadThroughput: args.uploadKbps != null ? (args.uploadKbps * 1024) / 8 : -1,
          latency: args.latencyMs ?? 0,
        });
        out.network = {
          offline: args.offline ?? false,
          downloadKbps: args.downloadKbps,
          uploadKbps: args.uploadKbps,
          latencyMs: args.latencyMs,
        };
      }
      return text({ ok: true, applied: out });
    },
  );

  server.registerTool(
    'clear_emulation',
    {
      description: 'Clear all emulation overrides (metrics, user-agent, network conditions).',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      await Promise.all([
        tabManager.cdpSend(id, 'Emulation.clearDeviceMetricsOverride', {}).catch(() => {}),
        tabManager.cdpSend(id, 'Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {}),
        tabManager
          .cdpSend(id, 'Network.emulateNetworkConditions', {
            offline: false,
            downloadThroughput: -1,
            uploadThroughput: -1,
            latency: 0,
          })
          .catch(() => {}),
      ]);
      return text({ ok: true });
    },
  );

  server.registerTool(
    'wait_for_text',
    {
      description:
        'Wait until the given text appears anywhere in document.body.innerText (default timeout 10000ms).',
      inputSchema: {
        text: z.string(),
        timeoutMs: z.number().int().positive().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ text: needle, timeoutMs, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      const t = timeoutMs ?? 10000;
      const escaped = JSON.stringify(needle);
      const out = await tabManager.evaluate(
        id,
        `new Promise((resolve) => {
          const start = Date.now();
          const tick = () => {
            const body = document.body && document.body.innerText;
            if (body && body.includes(${escaped})) return resolve({ ok:true, waitedMs: Date.now()-start });
            if (Date.now()-start > ${t}) return resolve({ ok:false, error:'timeout' });
            setTimeout(tick, 100);
          };
          tick();
        })`,
      );
      return text(out);
    },
  );

  server.registerTool(
    'upload_file',
    {
      description:
        'Attach file(s) to the page. Pass absolute filesystem paths in `files`.\n' +
        '• `selector` — set the files directly on an existing `<input type="file">` that matches it (DOM.setFileInputFiles).\n' +
        '• `clickSelector` — for buttons that open the OS file picker (e.g. a "Choose file" link, or Facebook\'s 📷 ' +
        '"แนบรูปภาพหรือวิดีโอ" / "Attach a photo or video" comment button): GhostPilot arms a CDP file-chooser ' +
        'interception, clicks that element (with a user gesture), and feeds the files when the picker opens — no ' +
        'native dialog ever appears. Use this when a plain `selector` upload triggers the wrong composer or hits a ' +
        'native dialog GhostPilot cannot fill.\n' +
        'Provide exactly one of `selector` / `clickSelector`.',
      inputSchema: {
        files: z.array(z.string()).min(1),
        selector: z.string().optional(),
        clickSelector: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ selector, clickSelector, files, timeoutMs, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);

      // ── file-chooser interception path (Playwright-style) ──────────────
      // Some pages (Facebook comment photo button, many "Choose file" labels) call
      // `input.click()` which opens the OS picker — GhostPilot can't fill that.
      // Solution: turn on Page.setInterceptFileChooserDialog, click the trigger,
      // catch Page.fileChooserOpened (gives the input's backendNodeId), then feed
      // the files via DOM.setFileInputFiles({backendNodeId}). That both sets the
      // files and cancels the native dialog.
      if (clickSelector) {
        await tabManager.cdpSend(id, 'Page.enable', {});
        await tabManager.cdpSend(id, 'DOM.enable', {});
        await tabManager.cdpSend(id, 'Page.setInterceptFileChooserDialog', { enabled: true });
        try {
          // Subscribe BEFORE the click to avoid the race.
          const eventP = tabManager.waitForCdpEvent<{
            backendNodeId?: number;
            mode?: string;
            frameId?: string;
          }>(id, 'Page.fileChooserOpened', timeoutMs ?? 15000);
          // Click the trigger element. evaluate() runs with userGesture=true, so the
          // page's `input.click()` is allowed to open a chooser.
          const clickRes = (await tabManager.evaluate(
            id,
            `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)});
              if (!el) return { ok:false, error:'clickSelector not found' };
              el.scrollIntoView({ block:'center' });
              el.click();
              return { ok:true }; })()`,
          )) as { ok: boolean; error?: string } | null;
          if (!clickRes || !clickRes.ok) {
            return text({ ok: false, error: clickRes?.error ?? 'clickSelector not found' });
          }
          const ev = await eventP;
          if (ev?.backendNodeId == null) {
            return text({ ok: false, error: 'fileChooserOpened fired without a backendNodeId' });
          }
          await tabManager.cdpSend(id, 'DOM.setFileInputFiles', {
            files,
            backendNodeId: ev.backendNodeId,
          });
          return text({ ok: true, files, via: 'fileChooser', mode: ev.mode });
        } catch (err) {
          return text({ ok: false, error: `fileChooser path failed: ${(err as Error).message}` });
        } finally {
          try {
            await tabManager.cdpSend(id, 'Page.setInterceptFileChooserDialog', { enabled: false });
          } catch {
            /* noop */
          }
        }
      }

      // ── direct-input path (original behaviour) ────────────────────────
      if (!selector) {
        return text({ ok: false, error: 'provide either `selector` or `clickSelector`' });
      }
      const doc = (await tabManager.cdpSend(id, 'DOM.getDocument', {})) as {
        root: { nodeId: number };
      };
      const found = (await tabManager.cdpSend(id, 'DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector,
      })) as { nodeId: number };
      if (!found.nodeId) {
        return text({ ok: false, error: 'selector did not match any element' });
      }
      await tabManager.cdpSend(id, 'DOM.setFileInputFiles', {
        files,
        nodeId: found.nodeId,
      });
      return text({ ok: true, files, via: 'directInput' });
    },
  );

  server.registerTool(
    'handle_next_dialog',
    {
      description:
        'Auto-respond to the next native JavaScript dialog (alert / confirm / prompt / beforeunload). Default behaviour is "accept". Use "dismiss" to cancel. promptText is sent to prompt() dialogs.',
      inputSchema: {
        accept: z.boolean().optional(),
        promptText: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ accept, promptText, timeoutMs, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      await tabManager.cdpSend(id, 'Page.enable', {});
      const opening = await tabManager.waitForCdpEvent<{ type: string; message: string }>(
        id,
        'Page.javascriptDialogOpening',
        timeoutMs ?? 30000,
      );
      await tabManager.cdpSend(id, 'Page.handleJavaScriptDialog', {
        accept: accept ?? true,
        promptText: promptText ?? '',
      });
      return text({ ok: true, type: opening.type, message: opening.message });
    },
  );

  // ── Performance trace + Lighthouse ────────────────────────────────
  server.registerTool(
    'performance_start_trace',
    {
      description:
        'Start a Chrome DevTools performance trace on the tab. Pair with performance_stop_trace to receive the trace JSON path.',
      inputSchema: {
        categories: z.string().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ categories, tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      await tabManager.cdpSend(id, 'Tracing.start', {
        categories: categories ?? 'devtools.timeline,disabled-by-default-devtools.timeline',
        transferMode: 'ReturnAsStream',
      });
      return text({ ok: true });
    },
  );

  server.registerTool(
    'performance_stop_trace',
    {
      description:
        'Stop a tracing session started by performance_start_trace. Reads the resulting trace stream and writes it to a JSON file in /tmp; returns the file path you can open in chrome://tracing or DevTools → Performance.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      const completePromise = tabManager.waitForCdpEvent<{ stream: string }>(
        id,
        'Tracing.tracingComplete',
        60000,
      );
      await tabManager.cdpSend(id, 'Tracing.end', {});
      const { stream } = await completePromise;
      let chunks = '';
      let eof = false;
      while (!eof) {
        const part = (await tabManager.cdpSend(id, 'IO.read', {
          handle: stream,
          size: 1024 * 1024,
        })) as { data: string; eof: boolean; base64Encoded?: boolean };
        chunks += part.base64Encoded ? Buffer.from(part.data, 'base64').toString('utf8') : part.data;
        eof = part.eof;
      }
      await tabManager.cdpSend(id, 'IO.close', { handle: stream });
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { promises: fs } = await import('node:fs');
      const path = join(tmpdir(), `ghostpilot-trace-${Date.now()}.json`);
      await fs.writeFile(path, chunks);
      return text({ ok: true, path, sizeBytes: Buffer.byteLength(chunks) });
    },
  );

  server.registerTool(
    'lighthouse_audit',
    {
      description:
        'Run a Lighthouse audit against the given URL (or the active tab\'s URL). Spawns a private headless Chrome via chrome-launcher — Google Chrome must be installed. Returns category scores plus the path to the full HTML report.',
      inputSchema: {
        url: z.string().optional(),
        formFactor: z.enum(['mobile', 'desktop']).optional(),
        categories: z
          .array(z.enum(['performance', 'accessibility', 'best-practices', 'seo', 'pwa']))
          .optional(),
      },
    },
    async ({ url, formFactor, categories }) => {
      const targetUrl =
        url ??
        (() => {
          const id = tabManager.getActiveId();
          if (!id) throw new Error('No active tab and no url provided');
          const tab = tabManager.getTab(id);
          return tab?.view.webContents.getURL();
        })();
      if (!targetUrl) throw new Error('No URL to audit');

      const lighthouseModule = (await import('lighthouse')) as unknown as {
        default: (
          url: string,
          flags?: Record<string, unknown>,
          config?: Record<string, unknown>,
        ) => Promise<{ lhr: Record<string, unknown>; report: string | string[] }>;
      };
      const chromeLauncher = (await import('chrome-launcher')) as unknown as {
        launch: (opts: {
          chromeFlags?: string[];
          chromePath?: string;
        }) => Promise<{ port: number; kill: () => Promise<void> }>;
      };

      // Spawn a private headless Chrome instance so Lighthouse has full CDP
      // access (Electron's debugger is restricted and Lighthouse needs
      // Target.createTarget). Chrome must be installed on the user's Mac.
      const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox'],
      });

      try {
        const lighthouse = lighthouseModule.default;
        const result = await lighthouse(
          targetUrl,
          {
            port: chrome.port,
            output: 'html',
            logLevel: 'error',
            onlyCategories: categories,
            formFactor: formFactor ?? 'desktop',
            screenEmulation:
              formFactor === 'mobile' ? undefined : { disabled: true },
          },
          undefined,
        );
        const lhr = result.lhr as {
          categories?: Record<string, { id: string; score: number; title: string }>;
        };
        const scores: Record<string, number | null> = {};
        for (const [key, cat] of Object.entries(lhr.categories ?? {})) {
          scores[key] = typeof cat.score === 'number' ? Math.round(cat.score * 100) : null;
        }
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const { promises: fs } = await import('node:fs');
        const reportPath = join(tmpdir(), `ghostpilot-lighthouse-${Date.now()}.html`);
        const reportData = Array.isArray(result.report)
          ? result.report.join('')
          : result.report;
        await fs.writeFile(reportPath, reportData);
        return text({ ok: true, url: targetUrl, scores, reportPath });
      } finally {
        await chrome.kill().catch(() => {});
      }
    },
  );

  // ── Media (downloadable videos / audios on the page) ──────────────
  server.registerTool(
    'list_media',
    {
      description:
        'List downloadable media (video/audio/HLS playlist/DASH manifest) detected on the active tab — populated by network sniffing every response of the partition\'s session. HLS .m3u8 / DASH .mpd are playlists; segments need ffmpeg or yt-dlp to merge.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      return text(mediaDetector.list(id));
    },
  );

  server.registerTool(
    'download_media',
    {
      description:
        "Download a media URL detected by list_media. Replays the request via the tab's session so cookies/headers match. The file shows up in Downloads.",
      inputSchema: { url: z.string() },
    },
    async ({ url }) => {
      mediaDetector.download(partitionSession, url);
      return text({ ok: true, url });
    },
  );

  server.registerTool(
    'clear_media',
    {
      description: 'Clear the media-detection list for the active tab.',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = resolveTabId(tabId);
      requireTab(id);
      mediaDetector.clear(id);
      return text({ ok: true });
    },
  );

  // ── yt-dlp (HLS, DASH, YouTube, ~1500 sites) ──────────────────────
  server.registerTool(
    'ytdlp_status',
    {
      description:
        "Report whether yt-dlp is installed on this Mac and its version. yt-dlp handles HLS playlists, DASH manifests, and embedded videos from sites with anti-bot or DRM (YouTube, Twitter/X, Vimeo, ~1500 sites). Install with `brew install yt-dlp`.",
      inputSchema: { force: z.boolean().optional() },
    },
    async ({ force }) => text(await detectYtdlp(force ?? false)),
  );

  server.registerTool(
    'download_with_ytdlp',
    {
      description:
        'Download a video/audio with yt-dlp. URL can be a direct media file, an HLS .m3u8, a DASH .mpd, OR a page URL (YouTube/Twitter/Vimeo/...). Returns immediately; progress is reported via the GhostPilot UI. Saves to ~/Downloads by default.',
      inputSchema: {
        url: z.string(),
        audioOnly: z.boolean().optional(),
        format: z.string().optional(),
      },
    },
    async ({ url, audioOnly, format }) => {
      const status = await detectYtdlp();
      if (!status.installed) {
        throw new Error(
          'yt-dlp is not installed. Run `brew install yt-dlp` and try again.',
        );
      }
      // Fire-and-forget — progress goes to the renderer via IPC.
      ytdlp.download(url, { audioOnly, format }).catch((err) => {
        console.error('[ytdlp] download failed', err);
      });
      return text({ ok: true, message: 'Download started — see the Media panel for progress.' });
    },
  );

  server.registerTool(
    'list_ytdlp_jobs',
    {
      description: 'List in-progress and recent yt-dlp downloads.',
      inputSchema: {},
    },
    async () => text(ytdlp.list()),
  );

  // ── Skills (reusable browser automation playbooks) ────────────────
  // Skills are saved markdown bodies — steps, selectors, pitfalls — that any
  // MCP client can fetch to repeat a task quickly. The intended workflow:
  //   1. Before a browser task, call list_skills to see if one already covers
  //      the target site/action.
  //   2. If a skill matches, get_skill and follow it.
  //   3. After a successful task without a matching skill, save_skill so the
  //      next run is fast.
  server.registerTool(
    'list_skills',
    {
      description:
        'List saved browser-automation skills (no body). **Call this first when starting any non-trivial browser task** — if a skill matches the target site/action, fetch it with get_skill and follow its steps instead of improvising. Filter by domain (e.g. "facebook.com") or free-text query.',
      inputSchema: {
        domain: z.string().optional(),
        query: z.string().optional(),
      },
    },
    async ({ domain, query }) => text(await skills.list({ domain, query })),
  );

  server.registerTool(
    'get_skill',
    {
      description:
        'Fetch the full markdown body of a skill (steps, selectors, pitfalls). Records that the skill was used so most-used skills float to the top of list_skills.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const skill = await skills.get(id);
      if (!skill) return text({ error: `Skill not found: ${id}` });
      await skills.recordUse(id);
      return text(skill);
    },
  );

  server.registerTool(
    'save_skill',
    {
      description:
        'Save (or update) a reusable skill. **After completing any non-trivial browser task without a matching skill, call this** with what you did — exact selectors, key steps, pitfalls — so future runs short-circuit. id is a slug like "facebook-search-friend"; if omitted, derived from name. body is markdown.',
      inputSchema: {
        id: z.string().optional(),
        name: z.string(),
        description: z.string(),
        domain: z.string().optional(),
        triggers: z.array(z.string()).optional(),
        body: z.string(),
      },
    },
    async (input) => text(await skills.save(input)),
  );

  server.registerTool(
    'delete_skill',
    {
      description: 'Remove a skill by id. Use only when the skill is broken or obsolete.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => text({ ok: await skills.delete(id) }),
  );

  // ── Updates ───────────────────────────────────────────────────────
  server.registerTool(
    'check_for_updates',
    {
      description:
        'Check whether a newer GhostPilot release is available. Returns current version, latest version, and the upgrade URL.',
      inputSchema: { force: z.boolean().optional() },
    },
    async ({ force }) => {
      await updateChecker.checkNow(force ?? false);
      return text(updateChecker.status());
    },
  );
}
