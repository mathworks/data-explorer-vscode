// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// What the TABLE does with an answer to `requestChildren` — driven through the listener
// that ships.
//
// rowUpdates.test.ts pins `mergeChildRows` and treeTableLazyRows.test.ts pins the
// component's twisty. Between them sits the message branch in table-main.ts, and that is
// where the interesting half is: which arrivals get installed, which get dropped, and
// which say something to the user. A copy of that branch written here would be one rule
// on two paths — it would keep passing after the shipped one changed — so this imports
// table-main.ts and dispatches real `MessageEvent`s at it, the way linkRoute.test.ts and
// readonlyEditorGate.test.ts drive their halves. See the memory
// `table-main-is-importable`: two stubs in place before the dynamic import, once per
// file, because a module body runs once per test FILE and this one wires window and body
// listeners.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
// `join(import.meta.dirname, …)`, not `fileURLToPath(import.meta.url)`: under happy-dom
// `import.meta.url` is an http URL, which fileURLToPath rejects.
import { join } from 'node:path';

// The REAL strip markup, read out of the shell all three providers interpolate, because
// the assertion below is about a banner being visible and hand-written markup here would
// be a copy of the shell that agreement with the shell is the whole point of.
const BANNERS_HTML = /BANNERS_HTML = `([\s\S]*?)`;/.exec(
  readFileSync(join(import.meta.dirname, '..', 'src/host/webviewHtml.ts'), 'utf8'),
)![1];

const posted: any[] = [];
let table: any;

const errorBanner = () => document.getElementById('dex-error')!;
const idsOf = () => ((table.rows ?? []) as any[]).map((r) => r.ID);
const rowOf = (id: string) => ((table.rows ?? []) as any[]).find((r) => r.ID === id);

/** Hand the table a message exactly as the host's `postMessage` does. */
function send(data: any): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

/**
 * A planned payload: one section, one entry whose children were held back.
 *
 * `_lazy` on `A` is the whole premise — the host stamped it because its children did not
 * fit — and `setRows` is also what clears the error banner, so this doubles as the reset
 * between tests.
 */
function paint(): void {
  send({
    type: 'setRows',
    docUri: 'file:///fx/big.mat',
    rows: [
      { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
      { ID: 'A', parent: 'section:design', Name: { label: 'A' }, _lazy: true },
      { ID: 'B', parent: 'section:design', Name: { label: 'B' } },
    ],
    columns: ['Name', 'Value'],
    columnLabels: { Name: 'Name', Value: 'Value' },
    editable: false,
  });
}

const kids = [
  { ID: 'A.k0', parent: 'A', Name: { label: 'k0' } },
  { ID: 'A.k1', parent: 'A', Name: { label: 'k1' } },
];

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = `${BANNERS_HTML}<dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>`;
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
});

beforeEach(() => {
  posted.length = 0;
  paint();
});

describe('opening a deferred row asks the host about it', () => {
  it('relays the row id the component asked about', () => {
    // The component decides WHEN to ask (treeTableLazyRows.test.ts); this is the one
    // line that turns that into a message, and a read-only `.mat` is navigated entirely
    // through it — so it must not be gated on `editable`, which this payload is not.
    table.dispatchEvent(new CustomEvent('dex-request-children', { detail: { nodeId: 'A' } }));
    expect(posted).toEqual([{ type: 'requestChildren', nodeId: 'A' }]);
  });

  it('asks nothing for an empty or missing id', () => {
    // `findNode('')` would answer for no node, and the table would then clear a twisty
    // on the strength of an answer about nothing.
    table.dispatchEvent(new CustomEvent('dex-request-children', { detail: { nodeId: '' } }));
    table.dispatchEvent(new CustomEvent('dex-request-children', { detail: {} }));
    expect(posted).toEqual([]);
  });
});

describe('an answer that fit', () => {
  it('puts the children straight after their parent and unmarks it', () => {
    send({ type: 'childRows', nodeId: 'A', rows: kids, truncated: 0 });
    expect(idsOf()).toEqual(['section:design', 'A', 'A.k0', 'A.k1', 'B']);
    // Unmarked, so the next expand of this row costs no round trip.
    expect(rowOf('A')._lazy).toBeUndefined();
  });

  it('leaves the rest of the table alone — this is a merge, not a payload', () => {
    // Deliberately NOT routed through the `setRows` path: that one clears the error,
    // closes an open matrix grid and re-derives the columns. The user opened one row.
    send({ type: 'childRows', nodeId: 'A', rows: kids, truncated: 0 });
    expect(rowOf('B')).toEqual({ ID: 'B', parent: 'section:design', Name: { label: 'B' } });
    expect(table.columns).toEqual(['Name', 'Value']);
  });

  it('says nothing to the user, because nothing was lost', () => {
    send({ type: 'childRows', nodeId: 'A', rows: kids, truncated: 0 });
    expect(errorBanner().style.display).toBe('none');
  });

  it('takes an empty answer as "no children after all"', () => {
    send({ type: 'childRows', nodeId: 'A', rows: [], truncated: 0 });
    expect(idsOf()).toEqual(['section:design', 'A', 'B']);
    expect(errorBanner().style.display).toBe('none');
  });
});

describe('an answer the host could not fit', () => {
  it('names the rows that are not there, because they have no twisty to offer', () => {
    // The one loss a fetch can still inflict: a node with more direct children than a
    // whole delivery holds (core builds a cell's children uncapped). The payload's own
    // banner cannot say this — it was composed before the user opened anything — so the
    // answer carries the count and it is said here, in the strip, where a message is not
    // painted over by the full-bleed table.
    send({ type: 'childRows', nodeId: 'A', rows: kids, truncated: 143257 });
    expect(errorBanner().style.display).toBe('block');
    expect(errorBanner().textContent).toContain('143,257');
    // And the rows that DID come are still merged: a partial answer is worth having.
    expect(idsOf()).toEqual(['section:design', 'A', 'A.k0', 'A.k1', 'B']);
  });

  it('clears on the next payload, so it cannot outlive the view it describes', () => {
    send({ type: 'childRows', nodeId: 'A', rows: kids, truncated: 7 });
    expect(errorBanner().style.display).toBe('block');
    paint();
    expect(errorBanner().style.display).toBe('none');
  });
});

describe('an answer the table has stopped waiting for', () => {
  it('drops an answer about a row that is no longer here', () => {
    // A repaint rebuilt the tree while the fetch was in flight. Appending the orphans
    // would put rows under a parent the table does not have — which the tree walk reads
    // as top-level, so they would render alongside the sections.
    send({ type: 'childRows', nodeId: 'gone', rows: kids, truncated: 0 });
    expect(idsOf()).toEqual(['section:design', 'A', 'B']);
  });

  it('says nothing about a truncation the user cannot see either', () => {
    // The count describes rows under a row that is no longer in the table, so a banner
    // about it would name something the user has no way to look at.
    send({ type: 'childRows', nodeId: 'gone', rows: kids, truncated: 500 });
    expect(errorBanner().style.display).toBe('none');
  });
});
