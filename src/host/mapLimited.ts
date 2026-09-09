// Copyright 2026 The MathWorks, Inc.
// Bounded-concurrency map — the vscode-free half of scanRead.ts, split out so the two
// properties below can be pinned by vitest rather than inferred from a passing scan.
// scanRead.ts re-exports it; read that file for WHY a scan is bounded at all.

/**
 * How many files a scan reads at once.
 *
 * `Promise.all` over the whole folder made every file's bytes coexist, so the peak
 * was the SUM of the folder rather than the size of its largest few files. Bounded
 * concurrency keeps the scans overlapping (they are I/O bound, and serial reads made
 * folder-open visibly slow) while capping how much is in flight.
 */
export const SCAN_READ_CONCURRENCY = 8;

/**
 * `items.map(fn)` with at most `limit` calls in flight, resolving in INPUT ORDER.
 *
 * Order is part of the contract, not a side effect: the usage graph lists the blocks
 * in a cell in the order their models were summarised, and an order that depended on
 * which read finished first rendered the same cell differently between two opens. So
 * the workers write into a pre-sized array by index — never `push` in completion order.
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit: number = SCAN_READ_CONCURRENCY,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  // One shared cursor across all workers, so a worker that finishes early takes the
  // next item rather than waiting on a chunk boundary: one huge file in a fixed-size
  // chunk would otherwise idle the rest of its chunk's slots until it finished.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
