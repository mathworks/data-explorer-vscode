// Copyright 2026 The MathWorks, Inc.
//
// The ceiling on a table payload, and the two things that made an 8 MB `.mat`
// (2,016,325 rows, 704 MiB of JSON) hang the view on its loading spinner for ever:
// no cap on the rows a payload may carry, and a post whose failure no `try/catch`
// could see. One suite, because they are one bug — the cap is what stops the
// payload being undeliverable, and the post guard is what makes an undeliverable
// payload SAY so instead of going quiet.
import { describe, it, expect, vi } from 'vitest';
import { DataModel } from 'data-explorer-core';
import { capRows, rowCapBanner, MAX_TABLE_ROWS } from '../src/host/rowCap.js';
import { postOrReport } from '../src/host/postPayload.js';
import { buildMatRows } from '../src/host/matRowBuilder.js';

const row = (id: string, parent?: string) => ({ ID: id, parent, Name: id });

describe('capRows', () => {
  it('hands back the SAME array when nothing is dropped', () => {
    // Not a copy: every table under the cap pays this call, and the common case has
    // to be free. `total` still answers, so the banner rule has one input shape.
    const rows = [row('a'), row('b')];
    const capped = capRows(rows, 10);
    expect(capped.rows).toBe(rows);
    expect(capped.total).toBe(2);
  });

  it('keeps the first `max` rows in order and reports the pre-cap count', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')];
    const capped = capRows(rows, 2);
    expect(capped.rows.map((r) => r.ID)).toEqual(['a', 'b']);
    expect(capped.total).toBe(4);
    expect(rows).toHaveLength(4); // the caller's array is not mutated
  });

  it('defaults to MAX_TABLE_ROWS', () => {
    expect(capRows(new Array(MAX_TABLE_ROWS + 5).fill(row('x'))).rows).toHaveLength(MAX_TABLE_ROWS);
  });

  it('stays inside V8 maximum string length for a row ten times the measured size', () => {
    // The budget this cap was chosen from, pinned so that RAISING the cap has to
    // re-argue it. The file that prompted this averaged 366 bytes of JSON per row;
    // a row carrying a long name, a wide value and a usage cell naming a dozen
    // blocks is several times that, and the payload has to survive the worst shape
    // rather than the measured one — JSON.stringify throws `RangeError: Invalid
    // string length` past this limit, and that throw is what hung the view.
    const V8_MAX_STRING = 536_870_888;
    const WORST_ROW_BYTES = 3660;
    expect(MAX_TABLE_ROWS * WORST_ROW_BYTES).toBeLessThan(V8_MAX_STRING);
  });

  it('leaves every surviving row with its parent still in the payload', () => {
    // The reason the cut is a PREFIX and not a sample. The webview builds its tree
    // from each row's `parent` id, so a row whose parent did not arrive cannot be
    // placed at all. Asserted over rows from the real builder — a hand-written list
    // would be in whatever order the test chose, which is the thing under test.
    const uri = 'ms://cap.mat';
    DataModel.removeDataSource(uri);
    const leaf = (name: string, v: number) => ({
      name, className: 'double', dimensions: [1, 1],
      isComplex: false, isLogical: false, value: [v], fields: null,
    });
    // A struct array, which is the shape that produced two million rows: elements
    // whose fields are themselves structs, so the flatten is several levels deep.
    const mat = DataModel.addMatSourceParsed(
      uri,
      {
        header: 'MATLAB 5.0',
        variables: [
          {
            name: 'songs', className: 'struct', dimensions: [1, 3],
            isComplex: false, isLogical: false, value: null,
            fields: {
              tempo: [leaf('tempo', 120), leaf('tempo', 128), leaf('tempo', 140)],
              events: [
                { name: 'events', className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null,
                  fields: { tick: leaf('tick', 1), note: leaf('note', 60) } },
                { name: 'events', className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null,
                  fields: { tick: leaf('tick', 2), note: leaf('note', 62) } },
                { name: 'events', className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null,
                  fields: { tick: leaf('tick', 3), note: leaf('note', 64) } },
              ],
            },
          } as any,
        ],
      } as any,
      { path: uri },
    );
    const all = buildMatRows(mat);
    expect(all.length).toBeGreaterThan(6); // non-vacuous: there is something to cut

    // Every prefix, not just one: the cut lands wherever the cap falls, so the
    // invariant has to hold at every depth the walk passes through.
    for (let max = 1; max < all.length; max++) {
      const present = new Set(capRows(all, max).rows.map((r: any) => r.ID));
      for (const r of capRows(all, max).rows) {
        if ((r as any).parent) expect(present.has((r as any).parent)).toBe(true);
      }
      expect(present.size).toBe(max);
    }
  });
});

describe('rowCapBanner', () => {
  it('passes the parse banner straight through when nothing was dropped', () => {
    const parse = { headline: 'One part of this file could not be read.', details: ['x is missing'] };
    expect(rowCapBanner(capRows([row('a')], 10), parse)).toBe(parse);
    expect(rowCapBanner(capRows([row('a')], 10), undefined)).toBeUndefined();
  });

  it('says how many rows of how many, with thousands separators', () => {
    const banner = rowCapBanner({ rows: new Array(100_000), total: 2_016_325 }, undefined);
    expect(banner!.headline).toContain('first 100,000 of 2,016,325');
    expect(banner!.details).toEqual([]);
  });

  it('never tells the user to search for a row it did not send', () => {
    // The search box filters the payload, so a row past the cap cannot be found by
    // searching. Advice that cannot work reads as the table being broken.
    const banner = rowCapBanner({ rows: new Array(10), total: 99 }, undefined);
    expect(banner!.headline).not.toMatch(/search/i);
  });

  it('folds a parse banner into the details under the cap headline', () => {
    const parse = { headline: '2 parts of this file could not be read.', details: ['a', 'b'] };
    const banner = rowCapBanner({ rows: new Array(10), total: 99 }, parse);
    expect(banner!.headline).toContain('first 10 of 99');
    expect(banner!.details).toEqual(['2 parts of this file could not be read.', 'a', 'b']);
  });
});

describe('postOrReport', () => {
  it('posts once and reports delivery when the payload goes out', async () => {
    const postMessage = vi.fn().mockResolvedValue(true);
    await expect(postOrReport({ postMessage }, { type: 'setRows' }, 'f.mat')).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('turns an undeliverable payload into the error banner', async () => {
    // The whole bug: vscode's postMessage is async and serializes inside itself, so
    // this rejection is what a caller's try/catch never saw. The webview ends its
    // wait on `setRows` or `error` and nothing else, so without this message the
    // spinner runs for ever.
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new RangeError('Invalid string length'))
      .mockResolvedValue(true);
    await expect(postOrReport({ postMessage }, { type: 'setRows' }, 'allMidi.mat')).resolves.toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0]).toEqual({
      type: 'error',
      message: 'Failed to show allMidi.mat: Invalid string length',
    });
  });

  it('stays quiet when the fallback cannot be delivered either', async () => {
    // A disposed webview rejects both posts. There is nothing left to tell, and an
    // unhandled rejection raised from the rejection handler is how one reported bug
    // becomes two.
    const postMessage = vi.fn().mockRejectedValue(new Error('Webview is disposed'));
    await expect(postOrReport({ postMessage }, { type: 'setRows' }, 'f.mat')).resolves.toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });
});
