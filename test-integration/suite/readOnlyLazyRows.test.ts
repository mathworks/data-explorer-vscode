// Copyright 2026 The MathWorks, Inc.
//
// A read-only table opens a row its payload held back (`requestChildren`, answered by
// BinaryEditorProvider through view's answerChildRequest).
//
// A payload is planned to a row budget: whole levels of the tree, and the rows below the last level
// that fits are held back, each row on that frontier marked `_lazy`. Opening one asks the host for
// the rows under it, and the table marks the row fetched when the answer arrives, whatever it holds.
// So the answer must be the rows under THAT row, for its id; and a row the host cannot find (gone
// from the file, or never there) must still be answered, with no rows, or its twisty would look live
// and do nothing for the rest of the session. The planner and the answer are view's, unit-tested
// there; this drives the real provider through the fake panel the other host tests use.
//
// The file is everyNameDelivered.test.ts's shape: a JSON dictionary of more entries than one
// delivery holds, padded past VS Code's 50 MB sync limit so that it stays in the read-only view.
// Every name has a row, and the fields of every tenth entry, a struct, are held back.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { MAX_TABLE_ROWS } from 'data-explorer-view/host';
import { TEXT_SYNC_LIMIT } from '../../src/host/slddFormat';
import { ctx, fakePanel, isEntryRow, nameOf, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ENTRIES = MAX_TABLE_ROWS + 5_000;
const nameAt = (i: number) => `W_${i}`;
/** Every tenth entry is a struct, `Gain` its number and `Offset` 1; the rest are scalars. */
const isStruct = (i: number) => i % 10 === 0;

function wideDictionary(): string {
  const entries = Array.from({ length: ENTRIES }, (_, i) => ({
    name: nameAt(i),
    metadata: { uuid: `lazy-uuid-${i}`, isderived: '0' },
    value: isStruct(i)
      ? { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ Gain: i, Offset: 1 }], _fields: ['Gain', 'Offset'], _mw_element_type: 'MATLABArray' }
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
  // An unknown sibling key the parser ignores (see slddReadOnce.test.ts), past the sync limit.
  doc.__MW_TEXT_PAD__ = 'x'.repeat(TEXT_SYNC_LIMIT);
  const text = JSON.stringify(doc);
  assert.ok(Buffer.byteLength(text) > TEXT_SYNC_LIMIT, 'the document is over the sync limit');
  return text;
}

const childRows = (posts: any[]) => posts.filter((p) => p?.type === 'childRows');
const errors = (posts: any[]) => posts.filter((p) => p?.type === 'error');

suite('A read-only table opens a row it held back', () => {
  let dir: string;
  let uri: vscode.Uri;
  let view: ReturnType<typeof fakePanel>;
  let doc: Awaited<ReturnType<BinaryEditorProvider['openCustomDocument']>>;
  /** The payload's rows. */
  let rows: any[];

  suiteSetup(async function () {
    this.timeout(60000);
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    dir = mkdtempSync(join(tmpdir(), 'dex-lazy-rows-'));
    const path = join(dir, 'wide.sldd');
    writeFileSync(path, wideDictionary());
    uri = vscode.Uri.file(path);
    const provider = new BinaryEditorProvider(ctx());
    doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    view = fakePanel();
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the table', () => view.posts.some((p) => p?.type === 'setRows') || errors(view.posts).length > 0, 60000);
    assert.deepStrictEqual(errors(view.posts), [], 'the table opened');
    const payload = view.posts.find((p) => p?.type === 'setRows');
    // Proof this is the read-only view, not a redirect to the editable one.
    assert.match(String(payload.notice), /^Read-only: this dictionary is \d+ MB/);
    rows = payload.rows;
  });

  suiteTeardown(() => {
    view?.close();
    doc?.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Ask for the rows under `nodeId` as the table does, and answer the reply for it. */
  async function open(nodeId: unknown, what: string): Promise<any> {
    const asked = childRows(view.posts).length;
    view.send({ type: 'requestChildren', nodeId });
    await waitFor(`the rows under ${what}`, () => childRows(view.posts).length > asked);
    const answers = childRows(view.posts).slice(asked);
    assert.strictEqual(answers.length, 1, `one answer for ${what}`);
    return answers[0];
  }

  test('the rows under a held-back row arrive for that row, and are its own', async () => {
    const entry = (i: number) => rows.find((r) => isEntryRow(r) && nameOf(r) === nameAt(i));
    // A struct deep in the file and the first one, in that order: an answer is matched by id, not
    // by being the latest.
    for (const i of [52_340, 0]) {
      const row = entry(i);
      assert.ok(row?._lazy, `${nameAt(i)} is held back`);
      assert.ok(!rows.some((r) => r.parent === row.ID), 'and none of its rows are in the payload');
      const answer = await open(row.ID, nameAt(i));
      assert.strictEqual(answer.nodeId, row.ID, 'the answer is for the row asked');
      assert.deepStrictEqual(
        answer.rows.map((r: any) => [nameOf(r), r.parent, r.Value]),
        [
          ['Gain', row.ID, String(i)],
          ['Offset', row.ID, '1'],
        ],
        `the fields of ${nameAt(i)}`,
      );
      assert.strictEqual(answer.truncated, 0);
    }
    assert.deepStrictEqual(errors(view.posts), []);
  });

  test('a row the file does not hold, or no row at all, is answered with no rows', async () => {
    const gone = `${uri.toString()}/design/W_gone`;
    assert.deepStrictEqual(await open(gone, 'a row the file does not hold'), { type: 'childRows', nodeId: gone, rows: [], truncated: 0 });
    assert.deepStrictEqual(await open('', 'an empty id'), { type: 'childRows', nodeId: '', rows: [], truncated: 0 });
    assert.deepStrictEqual(errors(view.posts), [], 'and nothing went wrong');
    // The table still answers after them.
    const struct = rows.find((r) => isEntryRow(r) && nameOf(r) === nameAt(10));
    assert.strictEqual((await open(struct.ID, nameAt(10))).rows.length, 2);
  });
});
