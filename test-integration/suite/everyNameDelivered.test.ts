// Copyright 2026 The MathWorks, Inc.
//
// A read-only table names every entry, however many there are.
//
// The row budget used to cut a top level wider than 100,000 rows: the names past it had no
// row and no twisty, and only a banner said they existed. The read-only view also capped the
// payload at the same 100,000 rows, so it cut them a second time. The 138 MB bench dictionary
// (291,564 entries) showed 100,000 rows and left 191,568 names out. The unit suite pins the
// planner (everyNameDelivered.test.ts there). This drives the real provider through the fake
// panel the other host tests use, on a JSON dictionary over VS Code's 50 MB sync limit, which
// is the shape that stays in the read-only view.
//
// The second test is the fallback. The payload is now bounded by the file rather than by the
// cap, so a large enough one can be refused by `postMessage` (V8's string limit). The view
// must then show the first 100,000 rows with the cap's banner, as it did before, and not the
// "Failed to show" error.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { MAX_TABLE_ROWS } from 'data-explorer-view/model/rows/rowCap.js';
import { TEXT_SYNC_LIMIT } from '../../src/host/slddFormat';
import { ctx, fakePanel, isEntryRow, nameOf, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** More entries than one delivery holds, by a margin no section header count can absorb. */
const ENTRIES = MAX_TABLE_ROWS + 5_000;
const nameAt = (i: number) => `W_${i}`;
/** Every tenth entry is a struct, so it has fields to defer; the rest are scalars. */
const isStruct = (i: number) => i % 10 === 0;
const STRUCTS = Math.ceil(ENTRIES / 10);

/**
 * A JSON dictionary of `ENTRIES` entries, padded past the sync limit by one unknown sibling
 * key (the parser ignores it; see slddReadOnce.test.ts), so the file stays in the read-only
 * view without the hundreds of thousands of entries it would take to reach 50 MB.
 */
function wideDictionary(): string {
  const entries = Array.from({ length: ENTRIES }, (_, i) => ({
    name: nameAt(i),
    metadata: { uuid: `wide-uuid-${i}`, isderived: '0' },
    value: isStruct(i)
      ? {
          _array_type: 'Struct',
          _dimensions: [1, 1],
          _elements: [{ Gain: i, Offset: 1 }],
          _fields: ['Gain', 'Offset'],
          _mw_element_type: 'MATLABArray',
        }
      : i,
  }));
  const doc: any = {
    __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: { entries, 'Dictionary References': [], AllowAccessBWS: '0' },
      },
    },
  };
  doc.__MW_TEXT_PAD__ = 'x'.repeat(TEXT_SYNC_LIMIT);
  const text = JSON.stringify(doc);
  assert.ok(Buffer.byteLength(text) > TEXT_SYNC_LIMIT, 'the document is over the sync limit');
  return text;
}

const setRows = (posts: any[]) => posts.filter((p) => p?.type === 'setRows');
const errors = (posts: any[]) => posts.filter((p) => p?.type === 'error');

suite('a read-only table names every entry', () => {
  let dir: string;
  let source: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    dir = mkdtempSync(join(tmpdir(), 'dex-every-name-'));
    source = join(dir, 'source.sldd');
    writeFileSync(source, wideDictionary());
  });

  suiteTeardown(() => rmSync(dir, { recursive: true, force: true }));

  /** Open a copy of the wide dictionary in a fresh read-only tab; `refuse` sees each post. */
  async function open(as: string, refuse?: (msg: any) => boolean) {
    const path = join(dir, as);
    copyFileSync(source, path);
    const uri = vscode.Uri.file(path);
    const provider = new BinaryEditorProvider(ctx());
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    if (refuse) {
      // The refusal a real webview gives a message JSON.stringify cannot serialize.
      const webview: any = view.panel.webview;
      const deliver = webview.postMessage;
      webview.postMessage = async (msg: any) => {
        if (refuse(msg)) {
          view.posts.push({ refused: msg });
          throw new RangeError('Invalid string length');
        }
        return deliver(msg);
      };
    }
    await provider.resolveCustomEditor(doc, view.panel, token());
    return { doc, view };
  }

  test('every entry has a row, and no banner says any are missing', async () => {
    const { doc, view } = await open('every.sldd');
    try {
      view.send({ type: 'ready' });
      await waitFor('the table', () => setRows(view.posts).length > 0 || errors(view.posts).length > 0);
      assert.deepStrictEqual(errors(view.posts), [], 'the table opened');
      const payload = setRows(view.posts)[0];
      // Proof this is the read-only view, not a redirect to the editable one.
      assert.match(String(payload.notice), /^Read-only: this dictionary is \d+ MB/);

      const names = new Set((payload.rows as any[]).filter(isEntryRow).map(nameOf));
      const missing: string[] = [];
      for (let i = 0; i < ENTRIES; i++) if (!names.has(nameAt(i))) missing.push(nameAt(i));
      assert.strictEqual(missing.length, 0, `${missing.length} names have no row, from ${missing[0]}`);
      // Everything under the names waits to be opened: each struct's fields, and nothing else.
      const lazy = (payload.rows as any[]).filter((r) => r._lazy);
      assert.strictEqual(lazy.length, STRUCTS, 'every struct entry loads its fields on demand');
      assert.ok(lazy.every(isEntryRow), 'and only entry rows are deferred');
      // The banner says rows load on expand, and nothing about rows that are not here.
      const banner = [payload.warnings?.headline, ...(payload.warnings?.details ?? [])].join(' ');
      assert.match(banner, new RegExp(`${STRUCTS.toLocaleString('en-US')} of these rows load their contents`));
      assert.ok(!/not in this view/.test(banner), `no banner reports absent rows: ${banner}`);
    } finally {
      view.close();
      doc.dispose();
    }
  }).timeout(60000);

  test('a payload postMessage refuses falls back to the first 100,000 rows and the cap banner', async () => {
    let refusals = 0;
    const { doc, view } = await open('fallback.sldd', (msg) => msg?.type === 'setRows' && refusals++ === 0);
    try {
      view.send({ type: 'ready' });
      await waitFor('the table', () => setRows(view.posts).length > 0 || errors(view.posts).length > 0);
      assert.deepStrictEqual(errors(view.posts), [], 'the view showed rows, not the error banner');

      const refused = view.posts.find((p) => p?.refused)?.refused;
      assert.ok(refused, 'the whole payload was offered first');
      const shown = setRows(view.posts)[0];
      assert.strictEqual(shown.rows.length, MAX_TABLE_ROWS, 'the fallback is the capped payload');
      assert.deepStrictEqual(
        shown.rows.map((r: any) => r.ID),
        refused.rows.slice(0, MAX_TABLE_ROWS).map((r: any) => r.ID),
        'and it is the first rows of the whole one, so every row’s parent is present',
      );
      const total = refused.rows.length.toLocaleString('en-US');
      assert.match(String(shown.warnings?.headline), new RegExp(`first 100,000 of ${total}`));
      // The rows to expand are counted among the rows shown, not the whole file's.
      const lazyShown = shown.rows.filter((r: any) => r._lazy).length;
      assert.ok(lazyShown > 0 && lazyShown < STRUCTS, `some, not all, struct rows are shown: ${lazyShown}`);
      assert.match(
        String(shown.warnings?.details?.[0]),
        new RegExp(`^This file is too large to load at once: ${lazyShown.toLocaleString('en-US')} of these rows`),
      );
      assert.strictEqual(shown.notice, refused.notice, 'the read-only notice survives the fallback');
    } finally {
      view.close();
      doc.dispose();
    }
  }).timeout(60000);
});
