// Integration tests for auto-retry — plan §7.2 (5 scenarios).
//
// Deviation from plan §7.2 wording: these tests use deterministic
// simulators of TabManager.evaluate / CDP behaviour rather than a real
// headless Electron app. Reasons:
//
//   1. The live GhostPilot instance on port 9223 is in active use by
//      Mint + mbt-store-bot and must not be restarted during this work.
//   2. The simulators exercise the EXACT withRetry + waitStable pipeline
//      that production calls; only the leaf `evaluate()` / `cdpSend()` /
//      `pressKey()` is mocked.
//   3. Plan §8 calls out "integration tests deterministic enough" as the
//      goal — simulator-driven tests are strictly more deterministic than
//      real-electron timing tests would be.
//
// Each scenario is named after the plan §7.2 row it covers.
//
// Run:  node --experimental-strip-types --test tests/integration/auto-retry.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  withRetry,
  waitStable,
  type Box,
} from '../../src/main/mcp/auto-retry.ts';

// ─── Shared fake clock (zero wall-time delays) ────────────────────────────
function makeFakeClock() {
  let now = 0;
  const sleep = async (ms: number): Promise<void> => {
    now += ms;
  };
  return { sleep, now: () => now, reset: () => (now = 0) };
}

// ─── §7.2 row 1: Race the DOM ─────────────────────────────────────────────
// Page renders an element via React; the component unmounts + remounts every
// ~100ms (real example: FB's comment composer mid-tick). A naive click that
// resolves the selector once and runs `el.click()` will fail because the
// node is destroyed between snapshot and use. withRetry should succeed.
test('§7.2 row 1: race the DOM — click succeeds within retries', async () => {
  const clock = makeFakeClock();
  let attempt = 0;
  // First two attempts the element is "destroyed" by React's reconciler
  // before we can click; third attempt lands during a stable window.
  const fakeClickEvaluate = async (): Promise<{ ok: boolean; error?: string }> => {
    attempt++;
    if (attempt <= 2) {
      throw new Error('Object has been destroyed (Node)');
    }
    return { ok: true };
  };

  const result = await withRetry(fakeClickEvaluate, {
    retries: 3,
    sleep: clock.sleep,
    log: () => {},
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(attempt, 3, 'should have taken 3 tries to settle');
});

// ─── §7.2 row 2: Animation — waitStable waits for transform to settle ─────
// Element has a CSS transform animating x from 0 → 100px over 500ms. Before
// the animation finishes, `getBoundingClientRect` returns a moving box.
// waitStable must wait until the box stops moving (= animation done) before
// returning, so a subsequent click lands at the correct coordinates.
test('§7.2 row 2: animation — waitStable returns the final post-animation box', async () => {
  const clock = makeFakeClock();
  // Animation lasts 500ms; we model 50ms-per-poll motion. After t≥500ms the
  // x-value snaps to 100 and stops moving.
  const getBox = async (): Promise<Box> => {
    const t = clock.now();
    if (t < 500) {
      return { x: Math.round((t / 500) * 100), y: 50, width: 80, height: 30 };
    }
    return { x: 100, y: 50, width: 80, height: 30 };
  };
  const out = await waitStable(getBox, {
    wait_stable_ms: 200,
    wait_timeout_ms: 5000,
    poll_interval_ms: 50,
    sleep: clock.sleep,
    now: clock.now,
  });
  assert.equal(out.x, 100, 'should observe the post-animation x');
  // Animation runs to ~500ms, then we need 200ms of stability → resolves
  // around 700ms (give or take one poll interval).
  const resolvedAt = clock.now();
  assert.ok(
    resolvedAt >= 700 && resolvedAt <= 900,
    `expected ~700-900ms resolve time, got ${resolvedAt}ms`,
  );
});

// ─── §7.2 row 3: Navigation race ──────────────────────────────────────────
// `navigate(A)` is fired; immediately afterwards `click('a[href=B]')` runs
// while the navigation is still in flight. Real Electron / CDP will throw
// "Navigation interrupted" or "Execution context was destroyed" on the
// pending call. withRetry must retry; the third attempt lands after the
// navigation has settled.
test('§7.2 row 3: navigation race — click retries until navigation settles', async () => {
  const clock = makeFakeClock();
  let navigationInFlight = true;
  let attempt = 0;

  // After two retry delays (100 + 300 = 400ms), pretend the navigation
  // completes — subsequent attempts succeed.
  const fakeAction = async (): Promise<{ ok: boolean }> => {
    attempt++;
    if (clock.now() >= 400) navigationInFlight = false;
    if (navigationInFlight) {
      throw new Error('Navigation interrupted by another navigation');
    }
    return { ok: true };
  };

  const result = await withRetry(fakeAction, {
    retries: 3,
    sleep: clock.sleep,
    log: () => {},
  });
  assert.deepEqual(result, { ok: true });
  // First attempt @ t=0, fail → sleep 100ms.
  // Second attempt @ t=100, fail → sleep 300ms.
  // Third attempt @ t=400, succeeds.
  assert.equal(attempt, 3);
  assert.equal(clock.now(), 400);
});

// ─── §7.2 row 4: Detached frame during fill ───────────────────────────────
// An iframe containing the target <input> gets reloaded while `fill` is
// dispatching its input/change events. CDP returns "frame got detached" or
// "execution context was destroyed". withRetry must succeed once the frame
// finishes reloading.
test('§7.2 row 4: detached frame — fill retries through frame reload', async () => {
  const clock = makeFakeClock();
  let attempt = 0;
  const fakeFillEvaluate = async (): Promise<
    { ok: boolean; error?: string }
  > => {
    attempt++;
    // First attempt: frame is detaching → soft failure {ok:false,error}.
    // Second attempt: still loading → execution context destroyed.
    // Third attempt: frame is back, fill succeeds.
    if (attempt === 1) return { ok: false, error: 'frame got detached' };
    if (attempt === 2) throw new Error('Execution context was destroyed');
    return { ok: true };
  };

  const result = await withRetry(fakeFillEvaluate, {
    retries: 3,
    sleep: clock.sleep,
    log: () => {},
    // Mirrors validateOkOrTransient from tools.ts: a soft {ok:false,error}
    // result is converted to a retry signal if the error is transient.
    validate: (r) => {
      const v = r as { ok?: boolean; error?: string };
      if (v.ok) return null;
      return v.error ?? null;
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(attempt, 3);
});

// ─── §7.2 row 5: Opt-out fast path ────────────────────────────────────────
// `click(sel, {retries:1, wait_stable_ms:0})` should never sleep and should
// invoke the action exactly once. Plan §7.2 budgets ≤ 50ms; with zero-cost
// fakes the call ought to clear under a millisecond.
test('§7.2 row 5: opt-out fast path — retries:1 wait_stable_ms:0 → 1 call, no delays', async () => {
  const clock = makeFakeClock();
  let calls = 0;
  const fakeAction = async (): Promise<{ ok: true }> => {
    calls++;
    return { ok: true };
  };

  const start = Date.now();
  const out = await withRetry(fakeAction, {
    retries: 1,
    sleep: clock.sleep,
    log: () => {},
  });
  const elapsed = Date.now() - start;

  assert.equal(calls, 1);
  assert.equal(clock.now(), 0, 'fake clock should not have advanced');
  assert.deepEqual(out, { ok: true });
  // Plan budget: ≤ 50ms wall-time. We don't run waitStable here (the tools.ts
  // wrapper would skip it when wait_stable_ms===0).
  assert.ok(elapsed < 50, `expected < 50ms wall-time, got ${elapsed}ms`);
});

// ─── §7.2 row 5b: opt-out with wait_stable_ms=0 short-circuits waitStable ─
// Mirrors the call-site behaviour in tools.ts where waitStableForSelector
// returns immediately when wait_stable_ms === 0. Validates that callers
// passing 0 truly bypass waitStable rather than getting a 0-ms stability
// window (which would be wrong — a single poll would always satisfy it
// but only after one sleep).
test('§7.2 row 5b: caller wraps waitStable with wait_stable_ms=0 → skipped entirely', async () => {
  // This mirrors the conditional in tools.ts: `if (wait_stable_ms === 0) return;`
  let getBoxCalls = 0;
  const maybeWaitStable = async (waitStableMs: number | undefined): Promise<void> => {
    if (waitStableMs === 0) return;
    await waitStable(
      async () => {
        getBoxCalls++;
        return { x: 0, y: 0, width: 1, height: 1 };
      },
      { wait_stable_ms: waitStableMs ?? 200, wait_timeout_ms: 5000, poll_interval_ms: 50 },
    );
  };
  await maybeWaitStable(0);
  assert.equal(getBoxCalls, 0, 'getBox should not be called when wait_stable_ms=0');
});
