// Auto-retry + auto-wait wrapper for GhostPilot's mutating browser tools.
//
// The mcp tools `click` / `fill` / `type_text` / `hover` / `press_key` /
// `upload_file` mutate the page, and the DOM they touch is constantly racing
// against frameworks like React (FB, LINE) that unmount + remount nodes mid-
// snapshot. The pattern that callers (Mint, mbt-store-bot) end up writing is
// "wait_for_selector → maybe scroll → click → if it didn't work, do it again";
// this module folds that into a single retry + stability check so the call
// sites can stay one-liners.
//
// API surface intentionally kept tiny:
//
//   withRetry(fn, opts)        — run `fn` until it succeeds, retry on transient
//                                errors only. Caller may pass `validate` to
//                                inspect a "soft" failure result and convert it
//                                to a transient error.
//
//   waitStable(getBox, opts)   — poll `getBox()` until its bounding-box hasn't
//                                changed for `wait_stable_ms`, bounded by
//                                `wait_timeout_ms`. Returns the final box.
//
//   isTransientError(msg, …)   — pure classifier (used by withRetry, exported
//                                for tests + manual call sites).
//
// Logging: each retry emits one line through `opts.log` (defaults to
// `console.warn`). Successful first-try calls emit nothing.

/** Patterns from plan §4.4 — "transient" means "worth retrying". */
export const DEFAULT_TRANSIENT_PATTERNS: readonly RegExp[] = Object.freeze([
  /node is detached/i,
  /element is not attached/i,
  /target closed/i,
  /execution context was destroyed/i,
  /Object has been destroyed/i,
  /Cannot find context with specified id/i,
  /Element is not visible/i,
  /Navigation interrupted/i,
  /frame got detached/i,
  // Stability-check failures from waitStable() — surfaced by the wrapped tool
  // when the element keeps moving past wait_timeout_ms.
  /element is not stable/i,
] as const);

/** Default exponential-ish backoff. Index N is the wait *after* attempt N+1. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = Object.freeze([100, 300, 800]);

export interface AutoRetryOptions {
  /** Maximum attempts (including the first). Plan §4.2: default 3, minimum 1.
   *  Values < 1 are clamped to 1 (retries=0 is invalid per plan Q3). */
  retries?: number;
  /** Per-retry delay in ms; index = attempt-1 (capped at the last entry). */
  retry_delay_ms?: number[];
  /** Patterns considered "transient" (retry-worthy). Defaults to the built-in
   *  list — pass a custom array to extend or narrow. */
  transient_errors?: readonly RegExp[];
  /** Inspect a successful return value for a "soft" failure (e.g. a tool that
   *  returns `{ok:false, error:'…'}` instead of throwing). Return the error
   *  string to treat the call as failed, or null/undefined to accept it. */
  validate?: (result: unknown) => string | null | undefined;
  /** Log sink. Receives one line per retry attempt. */
  log?: (line: string) => void;
  /** Human-readable label for logs ("click('div.x')"). */
  label?: string;
  /** Injectable sleeper — overridable for tests so retries don't burn wall time. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** True if `msg` matches any of the transient patterns. */
export function isTransientError(
  msg: string | null | undefined,
  patterns: readonly RegExp[] = DEFAULT_TRANSIENT_PATTERNS,
): boolean {
  if (!msg) return false;
  for (const re of patterns) {
    if (re.test(msg)) return true;
  }
  return false;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Run `fn` with auto-retry on transient errors.
 *
 * Returns the last successful result (so callers can keep their normal
 * happy path). Throws the last error if all attempts exhaust, or
 * immediately if the first error is classified as non-transient.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: AutoRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.retries ?? 3);
  const delays = opts.retry_delay_ms ?? DEFAULT_RETRY_DELAYS_MS;
  const patterns = opts.transient_errors ?? DEFAULT_TRANSIENT_PATTERNS;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? ((line: string) => console.warn(line));
  const label = opts.label ?? 'action';

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result: T | undefined;
    let errorMsg: string | null = null;
    let thrownError: unknown = null;

    try {
      result = await fn();
      const issue = opts.validate?.(result);
      if (issue) errorMsg = issue;
    } catch (err) {
      thrownError = err;
      errorMsg = messageOf(err);
    }

    if (!errorMsg) {
      // Success — `result` is set because we didn't throw and validate said OK.
      return result as T;
    }

    const transient = isTransientError(errorMsg, patterns);
    lastError = thrownError instanceof Error ? thrownError : new Error(errorMsg);

    if (!transient) {
      // Non-transient → abort immediately (plan §4.4: no retry on server
      // timeout, permission denied, invalid selector, user JS exceptions).
      throw lastError;
    }

    if (attempt >= attempts) break;

    // Pick delay for this attempt's *post-failure* wait. `delays` is indexed
    // by attempt-1 capped at length-1 so e.g. [100,300,800] handles 5 retries.
    const delay = delays.length === 0 ? 0 : delays[Math.min(attempt - 1, delays.length - 1)] ?? 0;
    log(
      `[auto-retry] ${label} attempt ${attempt}/${attempts} failed: "${errorMsg}"; wait ${delay}ms`,
    );
    if (delay > 0) await sleep(delay);
  }

  // All attempts exhausted on a transient error.
  throw lastError ?? new Error(`[auto-retry] ${label} exhausted ${attempts} attempts`);
}

// ─── waitStable ──────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WaitStableOptions {
  /** How long the box must stay identical (default 200ms per plan §4.2). */
  wait_stable_ms?: number;
  /** Max total wait before giving up (default 5000ms per plan §4.2). */
  wait_timeout_ms?: number;
  /** Poll interval (default 50ms — fast enough to detect a 60fps animation). */
  poll_interval_ms?: number;
  /** Injectable clock + sleep for fake-time tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function boxesEqual(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Poll `getBox` until two consecutive readings stay identical for `wait_stable_ms`.
 * Returns the stable box. Throws "element is not stable" if the timeout fires
 * first — that message is in the default transient patterns so `withRetry`
 * will treat a stability-timeout itself as retry-worthy.
 *
 * Treats a null/missing element as "not stable yet" (we keep polling — it
 * might appear/become visible). If the timeout fires without ever seeing an
 * element, the thrown error message includes "not visible" for clarity.
 */
export async function waitStable(
  getBox: () => Promise<Box | null>,
  opts: WaitStableOptions = {},
): Promise<Box> {
  const stableMs = opts.wait_stable_ms ?? 200;
  const timeoutMs = opts.wait_timeout_ms ?? 5000;
  const pollMs = opts.poll_interval_ms ?? 50;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;

  const start = now();
  let previousBox: Box | null = null;
  let stableSince: number | null = null;
  let everSeen = false;

  while (true) {
    const current = await getBox();

    if (current) {
      everSeen = true;
      if (boxesEqual(current, previousBox)) {
        if (stableSince === null) stableSince = now();
        if (now() - stableSince >= stableMs) return current;
      } else {
        // Box moved (or first reading) — reset.
        previousBox = current;
        stableSince = now();
      }
    } else {
      // Element gone / not yet present — reset stability accumulator.
      previousBox = null;
      stableSince = null;
    }

    if (now() - start >= timeoutMs) {
      const reason = everSeen ? 'element is not stable' : 'element is not visible';
      throw new Error(`${reason} after ${timeoutMs}ms`);
    }
    await sleep(pollMs);
  }
}
