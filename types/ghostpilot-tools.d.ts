// AUTO-GENERATED — do not edit by hand. Regenerate with `pnpm gen:types`.
// Source: src/main/mcp/tools.ts + src/main/mcp/locator-tools.ts
// GhostPilot version: 0.7.0
// Tools captured: 76

/** Return a simplified accessibility tree for the page (role, name, value, focusable). Equivalent to chrome-devtools take_snapshot — useful for letting an LLM navigate by semantic role instead of CSS selectors. */
export interface A11ySnapshotInput { interestingOnly?: boolean; tabId?: string }
export type A11ySnapshotOutput = unknown;

/** Bring a tab to the foreground. */
export interface ActivateTabInput { tabId: string }
export type ActivateTabOutput = unknown;

/** Bookmark a URL with title and optional folder. */
export interface BookmarksAddInput { url: string; title: string; folder?: string }
export type BookmarksAddOutput = unknown;

/** List bookmarks. Optional case-insensitive substring match. */
export interface BookmarksListInput { query?: string }
export type BookmarksListOutput = unknown;

/** Remove a bookmark by id. */
export interface BookmarksRemoveInput { id: string }
export type BookmarksRemoveOutput = unknown;

/** Forward a raw Chrome DevTools Protocol command to the tab. Anything chrome-devtools MCP can do (Network.*, DOM.*, Page.*, Performance.*, Accessibility.*, Emulation.*, …) is accessible here. See https://chromedevtools.github.io/devtools-protocol/. */
export interface CdpSendInput { method: string; params?: Record<string, unknown>; tabId?: string }
export type CdpSendOutput = unknown;

/** Check whether a newer GhostPilot release is available. Returns current version, latest version, and the upgrade URL. */
export interface CheckForUpdatesInput { force?: boolean }
export type CheckForUpdatesOutput = unknown;

/** Clear the captured console buffer for the tab. */
export interface ClearConsoleMessagesInput { tabId?: string }
export type ClearConsoleMessagesOutput = unknown;

/** Clear all emulation overrides (metrics, user-agent, network conditions). */
export interface ClearEmulationInput { tabId?: string }
export type ClearEmulationOutput = unknown;

/** Clear the media-detection list for the active tab. */
export interface ClearMediaInput { tabId?: string }
export type ClearMediaOutput = unknown;

/** Clear the captured network buffer for the tab. */
export interface ClearNetworkRequestsInput { tabId?: string }
export type ClearNetworkRequestsOutput = unknown;

/** Click the first element matching the CSS selector. Auto-waits for the element to be visible + stable (bounding box unchanged for wait_stable_ms) and retries on transient DOM errors (node detached, target closed, etc.). */
export interface ClickInput { selector: string; tabId?: string; retries?: number; retry_delay_ms?: number[]; wait_stable_ms?: number; wait_timeout_ms?: number }
export type ClickOutput = unknown;

/** Close a tab by id. */
export interface CloseTabInput { tabId: string }
export type CloseTabOutput = unknown;

/** Create a new GhostPilot profile (idempotent — returns created:false if it already existed). Profile name must match [a-zA-Z0-9_-]{1,32}. The new profile starts empty; storage is populated on first use after a switch. */
export interface CreateGhostpilotProfileInput { name: string }
export type CreateGhostpilotProfileOutput = unknown;

/** Return the name of the GhostPilot profile this process is running as, plus its session partition string and per-profile userData directory. */
export type CurrentGhostpilotProfileInput = Record<string, never>;
export type CurrentGhostpilotProfileOutput = unknown;

/** Delete a GhostPilot profile directory from disk. Refuses when the name equals the active profile. Refuses to delete the literal "default" profile unless force:true (default is the implicit fallback). Returns {ok:false, error} on refusal. */
export interface DeleteGhostpilotProfileInput { name: string; force?: boolean }
export type DeleteGhostpilotProfileOutput = unknown;

/** Remove a skill by id. Use only when the skill is broken or obsolete. */
export interface DeleteSkillInput { id: string }
export type DeleteSkillOutput = unknown;

/** Capture the Mac desktop (all displays, or a specific one) to a PNG file using /usr/sbin/screencapture. Requires GhostPilot.app to hold Screen Recording TCC permission. Returns { path, size_bytes, width, height }. */
export interface DesktopScreenshotInput { path?: string; display?: number }
export type DesktopScreenshotOutput = unknown;

/** Download a media URL detected by list_media. Replays the request via the tab's session so cookies/headers match. The file shows up in Downloads. */
export interface DownloadMediaInput { url: string }
export type DownloadMediaOutput = unknown;

/** Download a video/audio with yt-dlp. URL can be a direct media file, an HLS .m3u8, a DASH .mpd, OR a page URL (YouTube/Twitter/Vimeo/...). Returns immediately; progress is reported via the GhostPilot UI. Saves to ~/Downloads by default. */
export interface DownloadWithYtdlpInput { url: string; audioOnly?: boolean; format?: string }
export type DownloadWithYtdlpOutput = unknown;

/** Cancel an in-progress download by id. */
export interface DownloadsCancelInput { id: string }
export type DownloadsCancelOutput = unknown;

/** Clear finished downloads from the list (in-flight downloads are kept). */
export type DownloadsClearInput = Record<string, never>;
export type DownloadsClearOutput = unknown;

/** List downloads, newest first. */
export interface DownloadsListInput { limit?: number }
export type DownloadsListOutput = unknown;

/** Reveal a completed download in Finder. */
export interface DownloadsRevealInput { id: string }
export type DownloadsRevealOutput = unknown;

/** Apply device / network emulation overrides to the tab. Pass any subset: width+height (with optional deviceScaleFactor and mobile), userAgent, offline, downloadKbps + uploadKbps + latencyMs. */
export interface EmulateInput { width?: number; height?: number; deviceScaleFactor?: number; mobile?: boolean; userAgent?: string; offline?: boolean; downloadKbps?: number; uploadKbps?: number; latencyMs?: number; tabId?: string }
export type EmulateOutput = unknown;

/** Run JavaScript in the page context and return the result. Use a single expression or IIFE returning a JSON-serializable value. */
export interface EvaluateInput { script: string; tabId?: string }
export type EvaluateOutput = unknown;

/** Write the captured network buffer (optionally filtered) to a HAR 1.2 file on disk. Same filter fields as list_network_requests. Default path is /tmp/ghostpilot-har-<ISO>.har. Output is openable in Chrome DevTools (Network tab → Import HAR…), Charles, Postman, k6, etc. NOTE v1: response BODY is not captured (HAR `content.text` is omitted; `content.size` is -1). All major HAR readers accept this shape. */
export interface ExportHarInput { method?: string | string[]; status?: number | number[]; urlPattern?: string; urlIncludes?: string; mimeType?: string; since?: string | number; failedOnly?: boolean; path?: string; pretty?: boolean; tabId?: string }
export type ExportHarOutput = unknown;

/** Return a simplified accessibility tree (role, name, value, parentId, childIds) of the external Chrome target. Equivalent of a11y_snapshot but for the external session. Defaults interestingOnly=true (drops ignored/role-less nodes). */
export interface ExtA11ySnapshotInput { interestingOnly?: boolean; cdp_url?: string; target_id?: string }
export type ExtA11ySnapshotOutput = unknown;

/** Click the first element matching the CSS selector inside an external Chrome target. Implementation = querySelector + element.click() via Runtime.evaluate (NOT a CDP-level trusted-event click; for trusted events use ext_evaluate with a custom dispatch). */
export interface ExtClickInput { selector: string; cdp_url?: string; target_id?: string }
export type ExtClickOutput = unknown;

/** Run JavaScript in the page context of an external Chrome target and return the value. Use a single expression or IIFE returning a JSON-serializable value. */
export interface ExtEvaluateInput { script: string; cdp_url?: string; target_id?: string }
export type ExtEvaluateOutput = unknown;

/** List tabs (pages, iframes, service workers, extension popups) of an EXTERNAL Chrome instance reachable via Chrome DevTools Protocol. Default cdp_url = http://127.0.0.1:9222. */
export interface ExtListTabsInput { cdp_url?: string }
export type ExtListTabsOutput = unknown;

/** Navigate the target page of an external Chrome to a URL. If `target_id` is omitted, defaults to the first page-type tab (matches ext_list_tabs[0] of type=page). */
export interface ExtNavigateInput { url: string; cdp_url?: string; target_id?: string }
export type ExtNavigateOutput = unknown;

/** PNG screenshot of an external Chrome target (default = first page). Returned as base64 image content. Uses CDP Page.captureScreenshot. */
export interface ExtScreenshotInput { cdp_url?: string; target_id?: string; full_page?: boolean }
export type ExtScreenshotOutput = unknown;

/** Set value on input/textarea matching selector and dispatch input + change events. Auto-waits for the element to be visible + stable and retries on transient DOM errors (node detached, frame detached, target closed, etc.). */
export interface FillInput { selector: string; value: string; tabId?: string; retries?: number; retry_delay_ms?: number[]; wait_stable_ms?: number; wait_timeout_ms?: number }
export type FillOutput = unknown;

/** Resolve a form control (input/textarea/select or [role=textbox|combobox|searchbox]) by its associated label text. Walks <label for=…>, aria-label, aria-labelledby. Returns selector pointing at the CONTROL (not the label). */
export interface GetByLabelInput { tabId?: string; timeoutMs?: number; pollIntervalMs?: number; exact?: boolean; includeHidden?: boolean; label?: string; labelRegex?: string }
export type GetByLabelOutput = unknown;

/** Resolve an element by its accessibility role + (optional) accessible name. Playwright-style: returns the first match's CSS selector + role/name + total count. Waits up to `timeoutMs` (default 3000) for the first match to appear. Pass the returned `selector` to `click`/`fill`/`wait_for_selector`. */
export interface GetByRoleInput { tabId?: string; timeoutMs?: number; pollIntervalMs?: number; exact?: boolean; includeHidden?: boolean; role: string; name?: string; nameRegex?: string }
export type GetByRoleOutput = unknown;

/** Resolve an element by exact `data-testid` attribute match. Returns selector `[data-testid="…"]`. Always exact. */
export interface GetByTestIdInput { tabId?: string; timeoutMs?: number; pollIntervalMs?: number; testId: string }
export type GetByTestIdOutput = unknown;

/** Resolve an element by its visible text content. Matches innermost element containing the text (Playwright semantics). `exact:false` (default) does case-insensitive substring; `exact:true` requires equality. Returns first match's selector + role/name + count. */
export interface GetByTextInput { tabId?: string; timeoutMs?: number; pollIntervalMs?: number; exact?: boolean; includeHidden?: boolean; text?: string; textRegex?: string }
export type GetByTextOutput = unknown;

/** Return outerHTML of the document. */
export interface GetPageHtmlInput { tabId?: string }
export type GetPageHtmlOutput = unknown;

/** Return rendered innerText of the page body. */
export interface GetPageTextInput { tabId?: string }
export type GetPageTextOutput = unknown;

/** Fetch the full markdown body of a skill (steps, selectors, pitfalls). Records that the skill was used so most-used skills float to the top of list_skills. */
export interface GetSkillInput { id: string }
export type GetSkillOutput = unknown;

/** Navigate back. */
export interface GoBackInput { tabId?: string }
export type GoBackOutput = unknown;

/** Navigate forward. */
export interface GoForwardInput { tabId?: string }
export type GoForwardOutput = unknown;

/** Auto-respond to the next native JavaScript dialog (alert / confirm / prompt / beforeunload). Default behaviour is "accept". Use "dismiss" to cancel. promptText is sent to prompt() dialogs. */
export interface HandleNextDialogInput { accept?: boolean; promptText?: string; timeoutMs?: number; tabId?: string }
export type HandleNextDialogOutput = unknown;

/** Clear all browser history for this profile. */
export type HistoryClearInput = Record<string, never>;
export type HistoryClearOutput = unknown;

/** Return browser history. Optional case-insensitive substring match against url/title. */
export interface HistoryListInput { limit?: number; query?: string }
export type HistoryListOutput = unknown;

/** Move the mouse pointer to the centre of the element matching the selector. Auto-waits for the element to be visible + stable and retries on transient DOM errors. */
export interface HoverInput { selector: string; tabId?: string; retries?: number; retry_delay_ms?: number[]; wait_stable_ms?: number; wait_timeout_ms?: number }
export type HoverOutput = unknown;

/** Import bookmarks from Google Chrome. Default profile is "Default". URLs already bookmarked in GhostPilot are skipped. */
export interface ImportChromeBookmarksInput { profile?: string }
export type ImportChromeBookmarksOutput = unknown;

/** Import history from Google Chrome. Chrome should be closed (we copy the locked DB to /tmp first either way). Default limit 5000 most-recent visits. */
export interface ImportChromeHistoryInput { profile?: string; limit?: number }
export type ImportChromeHistoryOutput = unknown;

/** Run a Lighthouse audit against the given URL (or the active tab's URL). Spawns a private headless Chrome via chrome-launcher — Google Chrome must be installed. Returns category scores plus the path to the full HTML report. */
export interface LighthouseAuditInput { url?: string; formFactor?: "mobile" | "desktop"; categories?: ("performance" | "accessibility" | "best-practices" | "seo" | "pwa")[] }
export type LighthouseAuditOutput = unknown;

/** List available Google Chrome profile directories on this Mac (Default, Profile 1, …). */
export type ListChromeProfilesInput = Record<string, never>;
export type ListChromeProfilesOutput = unknown;

/** Return console messages captured for the tab (rolling buffer of 200). Optional level filter: info, warning, error, debug. */
export interface ListConsoleMessagesInput { level?: "info" | "warning" | "error" | "debug"; tabId?: string }
export type ListConsoleMessagesOutput = unknown;

/** List GhostPilot browser profiles on disk (cookies/storage/history isolated per profile). The active profile is sorted first and flagged. Each entry includes sizeBytes + lastModified. */
export type ListGhostpilotProfilesInput = Record<string, never>;
export type ListGhostpilotProfilesOutput = unknown;

/** List downloadable media (video/audio/HLS playlist/DASH manifest) detected on the active tab — populated by network sniffing every response of the partition's session. HLS .m3u8 / DASH .mpd are playlists; segments need ffmpeg or yt-dlp to merge. */
export interface ListMediaInput { tabId?: string }
export type ListMediaOutput = unknown;

/** Return network requests captured for the tab (rolling buffer of 500). All filters optional, AND semantics: method (string or [strings]), status (number or [numbers]), urlPattern (substring OR `/regex/flags`), urlIncludes (legacy substring alias), mimeType (substring of response Content-Type), since (ISO timestamp or epoch ms), failedOnly (status≥400 || error≠null). Each entry now also carries requestHeaders / responseHeaders / statusLine / mimeType when available — use export_har for a portable .har file. */
export interface ListNetworkRequestsInput { method?: string | string[]; status?: number | number[]; urlPattern?: string; urlIncludes?: string; mimeType?: string; since?: string | number; failedOnly?: boolean; tabId?: string }
export type ListNetworkRequestsOutput = unknown;

/** List saved browser-automation skills (no body). **Call this first when starting any non-trivial browser task** — if a skill matches the target site/action, fetch it with get_skill and follow its steps instead of improvising. Filter by domain (e.g. "facebook.com") or free-text query. */
export interface ListSkillsInput { domain?: string; query?: string }
export type ListSkillsOutput = unknown;

/** List every open browser tab with id, url, title, loading state, and active flag. */
export type ListTabsInput = Record<string, never>;
export type ListTabsOutput = unknown;

/** List in-progress and recent yt-dlp downloads. */
export type ListYtdlpJobsInput = Record<string, never>;
export type ListYtdlpJobsOutput = unknown;

/** Navigate the given tab (or active tab) to a URL. */
export interface NavigateInput { url: string; tabId?: string }
export type NavigateOutput = unknown;

/** Open a new tab. URL accepts schemes, bare hostnames, or search queries (Google). */
export interface NewTabInput { url?: string }
export type NewTabOutput = unknown;

/** Start a Chrome DevTools performance trace on the tab. Pair with performance_stop_trace to receive the trace JSON path. */
export interface PerformanceStartTraceInput { categories?: string; tabId?: string }
export type PerformanceStartTraceOutput = unknown;

/** Stop a tracing session started by performance_start_trace. Reads the resulting trace stream and writes it to a JSON file in /tmp; returns the file path you can open in chrome://tracing or DevTools → Performance. */
export interface PerformanceStopTraceInput { tabId?: string }
export type PerformanceStopTraceOutput = unknown;

/** Press a single key (e.g. "Enter", "Tab", "Escape", "ArrowDown", or "a"). Optional modifiers: shift/control/alt/meta. Retries on transient errors (target closed, WebContents destroyed) — key events go to whatever has focus, so no selector / waitStable needed. */
export interface PressKeyInput { key: string; modifiers?: ("shift" | "control" | "alt" | "meta")[]; tabId?: string; retries?: number; retry_delay_ms?: number[] }
export type PressKeyOutput = unknown;

/** Reload the page. */
export interface ReloadInput { tabId?: string }
export type ReloadOutput = unknown;

/** Save (or update) a reusable skill. **After completing any non-trivial browser task without a matching skill, call this** with what you did — exact selectors, key steps, pitfalls — so future runs short-circuit. id is a slug like "facebook-search-friend"; if omitted, derived from name. body is markdown. */
export interface SaveSkillInput { id?: string; name: string; description: string; domain?: string; triggers?: string[]; body: string }
export type SaveSkillOutput = unknown;

/** PNG screenshot of the tab as base64. */
export interface ScreenshotInput { tabId?: string }
export type ScreenshotOutput = unknown;

/** Resize and/or move the GhostPilot main window. Omitted axes keep their current value; set center:true to center on the active display (ignores x/y). New bounds are persisted to <userData>/window-bounds.json so they survive a relaunch. Returns the bounds as set plus the display the window ended up on. */
export interface SetWindowBoundsInput { x?: number; y?: number; width?: number; height?: number; center?: boolean }
export type SetWindowBoundsOutput = unknown;

/** Stop loading. */
export interface StopInput { tabId?: string }
export type StopOutput = unknown;

/** Switch the GhostPilot profile. RELAUNCHES the process — the MCP connection will drop, reconnect after ~3s. If `name` equals the active profile, returns immediately without relaunching. Profile name must match [a-zA-Z0-9_-]{1,32}. */
export interface SwitchGhostpilotProfileInput { name: string }
export type SwitchGhostpilotProfileOutput = unknown;

/** Open or close DevTools for the given tab. */
export interface ToggleDevtoolsInput { tabId?: string }
export type ToggleDevtoolsOutput = unknown;

/** Report which tool categories are enabled in this GhostPilot session and how many tools that translates to. Useful for debugging an unexpectedly-small tool inventory caused by the GHOSTPILOT_TOOLS env var. */
export type ToolCategoriesInput = Record<string, never>;
export type ToolCategoriesOutput = unknown;

/** Type a literal string into whichever element currently has focus (call `click` or `fill` first to focus an input). Retries on transient errors. */
export interface TypeTextInput { text: string; tabId?: string; retries?: number; retry_delay_ms?: number[] }
export type TypeTextOutput = unknown;

/**
 * Attach file(s) to the page. Pass absolute filesystem paths in `files`.
 * • `selector` — set the files directly on an existing `<input type="file">` that matches it (DOM.setFileInputFiles).
 * • `clickSelector` — for buttons that open the OS file picker (e.g. a "Choose file" link, or Facebook's 📷 "แนบรูปภาพหรือวิดีโอ" / "Attach a photo or video" comment button): GhostPilot arms a CDP file-chooser interception, clicks that element (with a user gesture), and feeds the files when the picker opens — no native dialog ever appears. Use this when a plain `selector` upload triggers the wrong composer or hits a native dialog GhostPilot cannot fill.
 * Provide exactly one of `selector` / `clickSelector`.
 */
export interface UploadFileInput { files: string[]; selector?: string; clickSelector?: string; timeoutMs?: number; tabId?: string; retries?: number; retry_delay_ms?: number[]; wait_stable_ms?: number; wait_timeout_ms?: number }
export type UploadFileOutput = unknown;

/** Wait until selector exists in the DOM (default timeout 10000ms). */
export interface WaitForSelectorInput { selector: string; timeoutMs?: number; tabId?: string }
export type WaitForSelectorOutput = unknown;

/** Wait until the given text appears anywhere in document.body.innerText (default timeout 10000ms). */
export interface WaitForTextInput { text: string; timeoutMs?: number; tabId?: string }
export type WaitForTextOutput = unknown;

/** Report whether yt-dlp is installed on this Mac and its version. yt-dlp handles HLS playlists, DASH manifests, and embedded videos from sites with anti-bot or DRM (YouTube, Twitter/X, Vimeo, ~1500 sites). Install with `brew install yt-dlp`. */
export interface YtdlpStatusInput { force?: boolean }
export type YtdlpStatusOutput = unknown;

/** Every MCP tool name GhostPilot exposes. Sorted. */
export type GhostPilotToolName =
  | 'a11y_snapshot'
  | 'activate_tab'
  | 'bookmarks_add'
  | 'bookmarks_list'
  | 'bookmarks_remove'
  | 'cdp_send'
  | 'check_for_updates'
  | 'clear_console_messages'
  | 'clear_emulation'
  | 'clear_media'
  | 'clear_network_requests'
  | 'click'
  | 'close_tab'
  | 'create_ghostpilot_profile'
  | 'current_ghostpilot_profile'
  | 'delete_ghostpilot_profile'
  | 'delete_skill'
  | 'desktop_screenshot'
  | 'download_media'
  | 'download_with_ytdlp'
  | 'downloads_cancel'
  | 'downloads_clear'
  | 'downloads_list'
  | 'downloads_reveal'
  | 'emulate'
  | 'evaluate'
  | 'export_har'
  | 'ext_a11y_snapshot'
  | 'ext_click'
  | 'ext_evaluate'
  | 'ext_list_tabs'
  | 'ext_navigate'
  | 'ext_screenshot'
  | 'fill'
  | 'get_by_label'
  | 'get_by_role'
  | 'get_by_test_id'
  | 'get_by_text'
  | 'get_page_html'
  | 'get_page_text'
  | 'get_skill'
  | 'go_back'
  | 'go_forward'
  | 'handle_next_dialog'
  | 'history_clear'
  | 'history_list'
  | 'hover'
  | 'import_chrome_bookmarks'
  | 'import_chrome_history'
  | 'lighthouse_audit'
  | 'list_chrome_profiles'
  | 'list_console_messages'
  | 'list_ghostpilot_profiles'
  | 'list_media'
  | 'list_network_requests'
  | 'list_skills'
  | 'list_tabs'
  | 'list_ytdlp_jobs'
  | 'navigate'
  | 'new_tab'
  | 'performance_start_trace'
  | 'performance_stop_trace'
  | 'press_key'
  | 'reload'
  | 'save_skill'
  | 'screenshot'
  | 'set_window_bounds'
  | 'stop'
  | 'switch_ghostpilot_profile'
  | 'toggle_devtools'
  | 'tool_categories'
  | 'type_text'
  | 'upload_file'
  | 'wait_for_selector'
  | 'wait_for_text'
  | 'ytdlp_status';

/** Tool category taxonomy. */
export type GhostPilotToolCategory =
  | 'bookmarks'
  | 'cdp'
  | 'console'
  | 'desktop'
  | 'downloads'
  | 'emulate'
  | 'ext'
  | 'history'
  | 'inspect'
  | 'interact'
  | 'lifecycle'
  | 'locator'
  | 'media'
  | 'nav'
  | 'network'
  | 'performance'
  | 'profiles'
  | 'skills'
  | 'tabs'
  | 'ytdlp';

/** Map of tool name → category. */
export const TOOL_CATEGORY: { readonly [K in GhostPilotToolName]: GhostPilotToolCategory } = {
  a11y_snapshot: 'inspect',
  activate_tab: 'tabs',
  bookmarks_add: 'bookmarks',
  bookmarks_list: 'bookmarks',
  bookmarks_remove: 'bookmarks',
  cdp_send: 'cdp',
  check_for_updates: 'lifecycle',
  clear_console_messages: 'console',
  clear_emulation: 'emulate',
  clear_media: 'media',
  clear_network_requests: 'network',
  click: 'interact',
  close_tab: 'tabs',
  create_ghostpilot_profile: 'profiles',
  current_ghostpilot_profile: 'profiles',
  delete_ghostpilot_profile: 'profiles',
  delete_skill: 'skills',
  desktop_screenshot: 'desktop',
  download_media: 'media',
  download_with_ytdlp: 'ytdlp',
  downloads_cancel: 'downloads',
  downloads_clear: 'downloads',
  downloads_list: 'downloads',
  downloads_reveal: 'downloads',
  emulate: 'emulate',
  evaluate: 'inspect',
  export_har: 'network',
  ext_a11y_snapshot: 'ext',
  ext_click: 'ext',
  ext_evaluate: 'ext',
  ext_list_tabs: 'ext',
  ext_navigate: 'ext',
  ext_screenshot: 'ext',
  fill: 'interact',
  get_by_label: 'locator',
  get_by_role: 'locator',
  get_by_test_id: 'locator',
  get_by_text: 'locator',
  get_page_html: 'inspect',
  get_page_text: 'inspect',
  get_skill: 'skills',
  go_back: 'nav',
  go_forward: 'nav',
  handle_next_dialog: 'interact',
  history_clear: 'history',
  history_list: 'history',
  hover: 'interact',
  import_chrome_bookmarks: 'bookmarks',
  import_chrome_history: 'history',
  lighthouse_audit: 'performance',
  list_chrome_profiles: 'profiles',
  list_console_messages: 'console',
  list_ghostpilot_profiles: 'profiles',
  list_media: 'media',
  list_network_requests: 'network',
  list_skills: 'skills',
  list_tabs: 'tabs',
  list_ytdlp_jobs: 'ytdlp',
  navigate: 'nav',
  new_tab: 'tabs',
  performance_start_trace: 'performance',
  performance_stop_trace: 'performance',
  press_key: 'interact',
  reload: 'nav',
  save_skill: 'skills',
  screenshot: 'inspect',
  set_window_bounds: 'desktop',
  stop: 'lifecycle',
  switch_ghostpilot_profile: 'profiles',
  toggle_devtools: 'emulate',
  tool_categories: 'lifecycle',
  type_text: 'interact',
  upload_file: 'interact',
  wait_for_selector: 'inspect',
  wait_for_text: 'inspect',
  ytdlp_status: 'ytdlp',
} as const;

/** Discriminated union of every MCP `tools/call` payload. */
export type GhostPilotToolCall =
  | { name: 'a11y_snapshot'; arguments: A11ySnapshotInput }
  | { name: 'activate_tab'; arguments: ActivateTabInput }
  | { name: 'bookmarks_add'; arguments: BookmarksAddInput }
  | { name: 'bookmarks_list'; arguments: BookmarksListInput }
  | { name: 'bookmarks_remove'; arguments: BookmarksRemoveInput }
  | { name: 'cdp_send'; arguments: CdpSendInput }
  | { name: 'check_for_updates'; arguments: CheckForUpdatesInput }
  | { name: 'clear_console_messages'; arguments: ClearConsoleMessagesInput }
  | { name: 'clear_emulation'; arguments: ClearEmulationInput }
  | { name: 'clear_media'; arguments: ClearMediaInput }
  | { name: 'clear_network_requests'; arguments: ClearNetworkRequestsInput }
  | { name: 'click'; arguments: ClickInput }
  | { name: 'close_tab'; arguments: CloseTabInput }
  | { name: 'create_ghostpilot_profile'; arguments: CreateGhostpilotProfileInput }
  | { name: 'current_ghostpilot_profile'; arguments: CurrentGhostpilotProfileInput }
  | { name: 'delete_ghostpilot_profile'; arguments: DeleteGhostpilotProfileInput }
  | { name: 'delete_skill'; arguments: DeleteSkillInput }
  | { name: 'desktop_screenshot'; arguments: DesktopScreenshotInput }
  | { name: 'download_media'; arguments: DownloadMediaInput }
  | { name: 'download_with_ytdlp'; arguments: DownloadWithYtdlpInput }
  | { name: 'downloads_cancel'; arguments: DownloadsCancelInput }
  | { name: 'downloads_clear'; arguments: DownloadsClearInput }
  | { name: 'downloads_list'; arguments: DownloadsListInput }
  | { name: 'downloads_reveal'; arguments: DownloadsRevealInput }
  | { name: 'emulate'; arguments: EmulateInput }
  | { name: 'evaluate'; arguments: EvaluateInput }
  | { name: 'export_har'; arguments: ExportHarInput }
  | { name: 'ext_a11y_snapshot'; arguments: ExtA11ySnapshotInput }
  | { name: 'ext_click'; arguments: ExtClickInput }
  | { name: 'ext_evaluate'; arguments: ExtEvaluateInput }
  | { name: 'ext_list_tabs'; arguments: ExtListTabsInput }
  | { name: 'ext_navigate'; arguments: ExtNavigateInput }
  | { name: 'ext_screenshot'; arguments: ExtScreenshotInput }
  | { name: 'fill'; arguments: FillInput }
  | { name: 'get_by_label'; arguments: GetByLabelInput }
  | { name: 'get_by_role'; arguments: GetByRoleInput }
  | { name: 'get_by_test_id'; arguments: GetByTestIdInput }
  | { name: 'get_by_text'; arguments: GetByTextInput }
  | { name: 'get_page_html'; arguments: GetPageHtmlInput }
  | { name: 'get_page_text'; arguments: GetPageTextInput }
  | { name: 'get_skill'; arguments: GetSkillInput }
  | { name: 'go_back'; arguments: GoBackInput }
  | { name: 'go_forward'; arguments: GoForwardInput }
  | { name: 'handle_next_dialog'; arguments: HandleNextDialogInput }
  | { name: 'history_clear'; arguments: HistoryClearInput }
  | { name: 'history_list'; arguments: HistoryListInput }
  | { name: 'hover'; arguments: HoverInput }
  | { name: 'import_chrome_bookmarks'; arguments: ImportChromeBookmarksInput }
  | { name: 'import_chrome_history'; arguments: ImportChromeHistoryInput }
  | { name: 'lighthouse_audit'; arguments: LighthouseAuditInput }
  | { name: 'list_chrome_profiles'; arguments: ListChromeProfilesInput }
  | { name: 'list_console_messages'; arguments: ListConsoleMessagesInput }
  | { name: 'list_ghostpilot_profiles'; arguments: ListGhostpilotProfilesInput }
  | { name: 'list_media'; arguments: ListMediaInput }
  | { name: 'list_network_requests'; arguments: ListNetworkRequestsInput }
  | { name: 'list_skills'; arguments: ListSkillsInput }
  | { name: 'list_tabs'; arguments: ListTabsInput }
  | { name: 'list_ytdlp_jobs'; arguments: ListYtdlpJobsInput }
  | { name: 'navigate'; arguments: NavigateInput }
  | { name: 'new_tab'; arguments: NewTabInput }
  | { name: 'performance_start_trace'; arguments: PerformanceStartTraceInput }
  | { name: 'performance_stop_trace'; arguments: PerformanceStopTraceInput }
  | { name: 'press_key'; arguments: PressKeyInput }
  | { name: 'reload'; arguments: ReloadInput }
  | { name: 'save_skill'; arguments: SaveSkillInput }
  | { name: 'screenshot'; arguments: ScreenshotInput }
  | { name: 'set_window_bounds'; arguments: SetWindowBoundsInput }
  | { name: 'stop'; arguments: StopInput }
  | { name: 'switch_ghostpilot_profile'; arguments: SwitchGhostpilotProfileInput }
  | { name: 'toggle_devtools'; arguments: ToggleDevtoolsInput }
  | { name: 'tool_categories'; arguments: ToolCategoriesInput }
  | { name: 'type_text'; arguments: TypeTextInput }
  | { name: 'upload_file'; arguments: UploadFileInput }
  | { name: 'wait_for_selector'; arguments: WaitForSelectorInput }
  | { name: 'wait_for_text'; arguments: WaitForTextInput }
  | { name: 'ytdlp_status'; arguments: YtdlpStatusInput };

/** Lookup map: tool name → { input, output } types. */
export interface GhostPilotToolMap {
  a11y_snapshot: { input: A11ySnapshotInput; output: A11ySnapshotOutput };
  activate_tab: { input: ActivateTabInput; output: ActivateTabOutput };
  bookmarks_add: { input: BookmarksAddInput; output: BookmarksAddOutput };
  bookmarks_list: { input: BookmarksListInput; output: BookmarksListOutput };
  bookmarks_remove: { input: BookmarksRemoveInput; output: BookmarksRemoveOutput };
  cdp_send: { input: CdpSendInput; output: CdpSendOutput };
  check_for_updates: { input: CheckForUpdatesInput; output: CheckForUpdatesOutput };
  clear_console_messages: { input: ClearConsoleMessagesInput; output: ClearConsoleMessagesOutput };
  clear_emulation: { input: ClearEmulationInput; output: ClearEmulationOutput };
  clear_media: { input: ClearMediaInput; output: ClearMediaOutput };
  clear_network_requests: { input: ClearNetworkRequestsInput; output: ClearNetworkRequestsOutput };
  click: { input: ClickInput; output: ClickOutput };
  close_tab: { input: CloseTabInput; output: CloseTabOutput };
  create_ghostpilot_profile: { input: CreateGhostpilotProfileInput; output: CreateGhostpilotProfileOutput };
  current_ghostpilot_profile: { input: CurrentGhostpilotProfileInput; output: CurrentGhostpilotProfileOutput };
  delete_ghostpilot_profile: { input: DeleteGhostpilotProfileInput; output: DeleteGhostpilotProfileOutput };
  delete_skill: { input: DeleteSkillInput; output: DeleteSkillOutput };
  desktop_screenshot: { input: DesktopScreenshotInput; output: DesktopScreenshotOutput };
  download_media: { input: DownloadMediaInput; output: DownloadMediaOutput };
  download_with_ytdlp: { input: DownloadWithYtdlpInput; output: DownloadWithYtdlpOutput };
  downloads_cancel: { input: DownloadsCancelInput; output: DownloadsCancelOutput };
  downloads_clear: { input: DownloadsClearInput; output: DownloadsClearOutput };
  downloads_list: { input: DownloadsListInput; output: DownloadsListOutput };
  downloads_reveal: { input: DownloadsRevealInput; output: DownloadsRevealOutput };
  emulate: { input: EmulateInput; output: EmulateOutput };
  evaluate: { input: EvaluateInput; output: EvaluateOutput };
  export_har: { input: ExportHarInput; output: ExportHarOutput };
  ext_a11y_snapshot: { input: ExtA11ySnapshotInput; output: ExtA11ySnapshotOutput };
  ext_click: { input: ExtClickInput; output: ExtClickOutput };
  ext_evaluate: { input: ExtEvaluateInput; output: ExtEvaluateOutput };
  ext_list_tabs: { input: ExtListTabsInput; output: ExtListTabsOutput };
  ext_navigate: { input: ExtNavigateInput; output: ExtNavigateOutput };
  ext_screenshot: { input: ExtScreenshotInput; output: ExtScreenshotOutput };
  fill: { input: FillInput; output: FillOutput };
  get_by_label: { input: GetByLabelInput; output: GetByLabelOutput };
  get_by_role: { input: GetByRoleInput; output: GetByRoleOutput };
  get_by_test_id: { input: GetByTestIdInput; output: GetByTestIdOutput };
  get_by_text: { input: GetByTextInput; output: GetByTextOutput };
  get_page_html: { input: GetPageHtmlInput; output: GetPageHtmlOutput };
  get_page_text: { input: GetPageTextInput; output: GetPageTextOutput };
  get_skill: { input: GetSkillInput; output: GetSkillOutput };
  go_back: { input: GoBackInput; output: GoBackOutput };
  go_forward: { input: GoForwardInput; output: GoForwardOutput };
  handle_next_dialog: { input: HandleNextDialogInput; output: HandleNextDialogOutput };
  history_clear: { input: HistoryClearInput; output: HistoryClearOutput };
  history_list: { input: HistoryListInput; output: HistoryListOutput };
  hover: { input: HoverInput; output: HoverOutput };
  import_chrome_bookmarks: { input: ImportChromeBookmarksInput; output: ImportChromeBookmarksOutput };
  import_chrome_history: { input: ImportChromeHistoryInput; output: ImportChromeHistoryOutput };
  lighthouse_audit: { input: LighthouseAuditInput; output: LighthouseAuditOutput };
  list_chrome_profiles: { input: ListChromeProfilesInput; output: ListChromeProfilesOutput };
  list_console_messages: { input: ListConsoleMessagesInput; output: ListConsoleMessagesOutput };
  list_ghostpilot_profiles: { input: ListGhostpilotProfilesInput; output: ListGhostpilotProfilesOutput };
  list_media: { input: ListMediaInput; output: ListMediaOutput };
  list_network_requests: { input: ListNetworkRequestsInput; output: ListNetworkRequestsOutput };
  list_skills: { input: ListSkillsInput; output: ListSkillsOutput };
  list_tabs: { input: ListTabsInput; output: ListTabsOutput };
  list_ytdlp_jobs: { input: ListYtdlpJobsInput; output: ListYtdlpJobsOutput };
  navigate: { input: NavigateInput; output: NavigateOutput };
  new_tab: { input: NewTabInput; output: NewTabOutput };
  performance_start_trace: { input: PerformanceStartTraceInput; output: PerformanceStartTraceOutput };
  performance_stop_trace: { input: PerformanceStopTraceInput; output: PerformanceStopTraceOutput };
  press_key: { input: PressKeyInput; output: PressKeyOutput };
  reload: { input: ReloadInput; output: ReloadOutput };
  save_skill: { input: SaveSkillInput; output: SaveSkillOutput };
  screenshot: { input: ScreenshotInput; output: ScreenshotOutput };
  set_window_bounds: { input: SetWindowBoundsInput; output: SetWindowBoundsOutput };
  stop: { input: StopInput; output: StopOutput };
  switch_ghostpilot_profile: { input: SwitchGhostpilotProfileInput; output: SwitchGhostpilotProfileOutput };
  toggle_devtools: { input: ToggleDevtoolsInput; output: ToggleDevtoolsOutput };
  tool_categories: { input: ToolCategoriesInput; output: ToolCategoriesOutput };
  type_text: { input: TypeTextInput; output: TypeTextOutput };
  upload_file: { input: UploadFileInput; output: UploadFileOutput };
  wait_for_selector: { input: WaitForSelectorInput; output: WaitForSelectorOutput };
  wait_for_text: { input: WaitForTextInput; output: WaitForTextOutput };
  ytdlp_status: { input: YtdlpStatusInput; output: YtdlpStatusOutput };
}
