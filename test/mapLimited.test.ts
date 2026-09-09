// Copyright 2026 The MathWorks, Inc.
// The two properties the workspace scans depend on `mapLimited` for. Both are
// invisible in a passing scan — a scan that read the folder in the wrong order, or
// read all of it at once, still produces a graph; it just produces a differently
// ordered one, or a dead extension host (see scanRead.ts). So they are pinned here,
// against a fake "read" whose completion order is deliberately the reverse of its
// input order, which is the case a naive `push`-as-they-finish version passes only
// by accident.
import { describe, it, expect } from 'vitest';
import { mapLimited, SCAN_READ_CONCURRENCY } from '../src/host/mapLimited.js';

// Resolves after `ticks` microtask turns, so completion order is controllable
// without timers (which would make this test slow and flaky in equal measure).
async function afterTicks<T>(ticks: number, value: T): Promise<T> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  return value;
}

describe('mapLimited', () => {
  it('resolves in input order even when the work completes in reverse', async () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    const done: number[] = [];
    const out = await mapLimited(
      items,
      async (n) => {
        // Item 0 finishes last, item 7 first.
        const v = await afterTicks((items.length - n) * 3, `v${n}`);
        done.push(n);
        return v;
      },
      items.length,
    );
    expect(out).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
    // The premise: they really did finish out of order, so the assertion above is
    // testing index-writing and not a coincidence.
    expect(done).not.toEqual(items);
  });

  it('never runs more than `limit` at once, and still visits every item', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    const out = await mapLimited(
      items,
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await afterTicks((n % 5) + 1, null);
        seen.push(n);
        inFlight--;
        return n * 2;
      },
      4,
    );
    expect(peak).toBe(4);
    expect(out).toEqual(items.map((n) => n * 2));
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it('keeps every worker busy: a slow item does not idle the other slots', async () => {
    // The reason for one shared cursor rather than fixed chunks. Item 0 is far slower
    // than the rest; with chunking, the three other slots in its chunk would sit idle
    // until it finished. With a shared cursor, they take the remaining items, so the
    // whole run takes about as long as the slow item alone.
    const items = Array.from({ length: 12 }, (_, i) => i);
    let concurrentWithSlow = 0;
    let slowRunning = false;
    await mapLimited(
      items,
      async (n) => {
        if (n === 0) {
          slowRunning = true;
          await afterTicks(60, null);
          slowRunning = false;
          return n;
        }
        await afterTicks(2, null);
        if (slowRunning) concurrentWithSlow++;
        return n;
      },
      4,
    );
    // All 11 fast items ran while item 0 was still going.
    expect(concurrentWithSlow).toBe(11);
  });

  it('handles the degenerate inputs a scan can legitimately hand it', async () => {
    expect(await mapLimited([], async (n: number) => n)).toEqual([]);
    // Fewer items than the limit: worker count is clamped, so no worker spins on an
    // empty list (and `Array.from({length: 0})` is what stops it from hanging).
    expect(await mapLimited([7], async (n) => n + 1, 8)).toEqual([8]);
  });

  it('defaults to the scan concurrency', async () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    await mapLimited(items, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await afterTicks((n % 3) + 1, null);
      inFlight--;
    });
    expect(peak).toBe(SCAN_READ_CONCURRENCY);
  });

  it('rejects if the work rejects, rather than resolving a half-filled array', async () => {
    // A read failure is swallowed by `readForScan` before it reaches here, so this is
    // about the contract, not about scan behaviour: a caller that does throw must not
    // get a silently short result set.
    await expect(
      mapLimited([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
