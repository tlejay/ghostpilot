// Unit tests for src/main/mcp/auto-retry.ts — plan §7.1 (7 tests).
//
// Run:  node --experimental-strip-types --test tests/unit/auto-retry.test.ts
// All tests use injected fake-clock + fake-sleep so real wall time is never spent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  withRetry,
  waitStable,
  isTransientError,
  DEFAULT_TRANSIENT_PATTERNS,
  type Box,
} from '../../src/main/mcp/auto-retry.ts';

/**
 * Fake sleep that records every delay it's asked for. Doesn't actually wait —
 * just advances a virtual clock so waitStable's `now()` reads after a sleep
 * reflect elapsed virtual time.
 */
function makeFakeClock() {
  let now = 0;
  const delays: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms);
    now += ms;
  };
  return {
    sleep,
    now: () => now,
    delays,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

// ─── Test 1: success on 1st attempt → 1 call, 0 delays ────────────────────
test('withRetry: success on 1st call → 1 invocation, no delay', async () => {
  const clock = makeFakeClock();
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      return { ok: true };
    },
    { retries: 3, sleep: clock.sleep, log: () => {} },
  );
  assert.equal(calls, 1);
  assert.deepEqual(clock.delays, []);
  assert.deepEqual(result, { ok: true });
});

// ─── Test 2: fail twice then succeed → 3 calls, delays [100, 300] ─────────
test('withRetry: fail 2 then succeed → 3 calls, delays [100, 300]', async () => {
  const clock = makeFakeClock();
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error('node is detached');
      return 'success';
    },
    { retries: 3, sleep: clock.sleep, log: () => {} },
  );
  assert.equal(calls, 3);
  assert.deepEqual(clock.delays, [100, 300]);
  assert.equal(result, 'success');
});

// ─── Test 3: always fails transient → exhaust retries, throw last ─────────
test('withRetry: always fails transient → 3 calls, throws after exhaust', async () => {
  const clock = makeFakeClock();
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error('target closed');
        },
        { retries: 3, sleep: clock.sleep, log: () => {} },
      ),
    /target closed/,
  );
  assert.equal(calls, 3);
  // Two delays (between attempts 1→2 and 2→3); none after the final attempt.
  assert.deepEqual(clock.delays, [100, 300]);
});

// ─── Test 4: non-transient → 1 call, no retry, throws immediately ─────────
test('withRetry: non-transient error → 1 call, throws immediately', async () => {
  const clock = makeFakeClock();
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error('permission denied');
        },
        { retries: 3, sleep: clock.sleep, log: () => {} },
      ),
    /permission denied/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(clock.delays, []);
});

// ─── Test 5: classifier table for every pattern in §4.4 ───────────────────
test('isTransientError: matches every pattern in §4.4 and rejects non-matches', () => {
  // (message, expected) — covers every entry in DEFAULT_TRANSIENT_PATTERNS
  // plus a handful of must-not-match negatives.
  const table: Array<[string, boolean]> = [
    // §4.4 patterns
    ['Node is detached from document', true],
    ['element is not attached to the DOM', true],
    ['Target closed.', true],
    ['Execution context was destroyed.', true],
    ['Object has been destroyed', true],
    ['Cannot find context with specified id', true],
    ['Element is not visible', true],
    ['Navigation interrupted by another navigation', true],
    ['frame got detached', true],
    // waitStable failure → also transient (auto-retry will re-try the whole
    // wait+act sequence, often the page settles by then).
    ['element is not stable after 5000ms', true],
    // Case insensitivity per the /i flag.
    ['NODE IS DETACHED', true],
    // Must NOT retry on these.
    ['permission denied', false],
    ['invalid selector: $$$', false],
    ['ReferenceError: foo is not defined', false],
    ['Server returned 500', false],
    ['', false],
  ];
  for (const [msg, want] of table) {
    assert.equal(
      isTransientError(msg),
      want,
      `classifier got "${msg}" wrong (expected ${want})`,
    );
  }
  // Sanity: every default pattern is actually a RegExp (catches accidental
  // string regression of the constant export).
  for (const p of DEFAULT_TRANSIENT_PATTERNS) {
    assert.ok(p instanceof RegExp);
  }
});

// ─── Test 6: waitStable on animating element → never stable → timeout ─────
test('waitStable: animating element → timeout', async () => {
  const clock = makeFakeClock();
  let n = 0;
  // Each poll returns a box that has moved by 1px — never stable.
  const getBox = async (): Promise<Box> => ({
    x: n++,
    y: 0,
    width: 10,
    height: 10,
  });
  await assert.rejects(
    () =>
      waitStable(getBox, {
        wait_stable_ms: 200,
        wait_timeout_ms: 500,
        poll_interval_ms: 50,
        sleep: clock.sleep,
        now: clock.now,
      }),
    /not stable/,
  );
  // Virtual clock should be at-or-past the timeout when we threw.
  assert.ok(clock.now() >= 500, `clock at ${clock.now()}ms should be ≥ 500ms`);
});

// ─── Test 7: waitStable on static element → resolves quickly ──────────────
test('waitStable: static element → resolves after stable window', async () => {
  const clock = makeFakeClock();
  const stableBox: Box = { x: 10, y: 20, width: 100, height: 30 };
  const getBox = async (): Promise<Box> => stableBox;
  const out = await waitStable(getBox, {
    wait_stable_ms: 200,
    wait_timeout_ms: 5000,
    poll_interval_ms: 50,
    sleep: clock.sleep,
    now: clock.now,
  });
  assert.deepEqual(out, stableBox);
  // Should resolve roughly when stable window elapses (we polled past 200ms
  // and slept the poll interval between each — < 350ms total).
  assert.ok(clock.now() <= 350, `resolved too late at ${clock.now()}ms`);
});

// ─── Bonus: validate() can convert a soft result-failure to a retry ───────
test('withRetry: validate() converts {ok:false} into a transient retry', async () => {
  const clock = makeFakeClock();
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 2) return { ok: false, error: 'node is detached' };
      return { ok: true };
    },
    {
      retries: 3,
      sleep: clock.sleep,
      log: () => {},
      validate: (r) => {
        const v = r as { ok: boolean; error?: string };
        return v.ok ? null : (v.error ?? 'unknown');
      },
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(clock.delays, [100]);
});

// ─── Bonus: retries<1 clamped to 1 (plan Q3: retries=0 invalid, min=1) ────
test('withRetry: retries<=0 clamped to a single attempt', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error('node is detached');
        },
        { retries: 0, sleep: async () => {}, log: () => {} },
      ),
    /node is detached/,
  );
  assert.equal(calls, 1);
});
