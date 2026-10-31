// Copyright 2026 The MathWorks, Inc.
// Two saves of a MAT-file whose writes land out of order, inside real VS Code: the MAT-file editor's
// twin of binarySlddSaveOrder.test.ts, which says how a save's write comes to land behind a newer one.
//
// The first save's write is held (the provider's writeUserFile, as a slow disk holds one), a second
// save of a newer edit writes, and then the first lands, over it. The engine answers that it landed
// behind the newer save, and the first save writes the document once more as it stands, which is
// what the newer save wrote (settledSave.ts): the file holds the newer edit, and the tab is clean over
// it. An edit made before the first lands leaves the tab dirty over the older file instead, and the
// next save writes it.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { quiet, token, waitFor } from './tools/hostHarness';
import { closeAll, matFixture, openMat, readMat, type MatTab, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Edit = (name: 'scalarD' | 'negD', value: string) => Promise<void>;

/** The Value core shows for the top-level variable `name` of the MAT-file at `path`. */
function valueOnDisk(path: string, name: string): string | undefined {
  const bytes = new Uint8Array(readFileSync(path));
  return readMat(bytes, (mat) => mat.children.find((v: any) => v.name === name)?.toRow().Value);
}

suite('MAT-file: saves whose writes land out of order', () => {
  let dir = '';
  const opened: Opened = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-mat-save-order-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** The MAT-file opened, and an edit of a variable's Value as the table sends one. */
  async function open(): Promise<{ tab: MatTab; edit: Edit }> {
    const tab = await openMat(opened, dir, 'save_order.mat', matFixture('cases.mat'));
    const edit = async (name: 'scalarD' | 'negD', value: string) => {
      const before = tab.events.length;
      tab.view.send({ type: 'edit', rowId: tab.variable(name).id, columnId: 'Value', oldValue: '', newValue: value });
      await waitFor(`the edit of ${name} to reach the document`, () => tab.events.length > before);
    };
    return { tab, edit };
  }

  /**
   * The user edits scalarD to 7 and saves, and the save's write is held, as a slow disk holds one.
   * VS Code starts the next save, cancelling this one's token; the user has edited scalarD to 8, and
   * that save writes. Answers the first save, still writing, what lets its write land, and the count
   * of writes.
   */
  async function saveBehindANewerOne(tab: MatTab, edit: Edit) {
    const write = tab.provider.writeUserFile;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let writes = 0;
    tab.provider.writeUserFile = async (uri, bytes) => {
      if (++writes === 1) await held;
      return write(uri, bytes);
    };

    await edit('scalarD', '7');
    const first = new vscode.CancellationTokenSource();
    const firstSave = tab.provider.saveCustomDocument(tab.doc, first.token);
    await waitFor("the first save's write to start", () => writes === 1);
    // VS Code starts the next save: it cancels this one's token, and ignores what it answers.
    first.cancel();
    await edit('scalarD', '8');
    await tab.provider.saveCustomDocument(tab.doc, token());
    assert.strictEqual(valueOnDisk(tab.path, 'scalarD'), '8', 'the second save wrote the newer edit');
    assert.strictEqual(tab.doc.edits.dirty, false, 'and the tab is clean over it');
    return { firstSave, release, writes: () => writes };
  }

  test('a save whose write lands after a newer save writes the newer edits over it, and the next save writes the newest', async () => {
    const { tab, edit } = await open();
    const late = await saveBehindANewerOne(tab, edit);
    late.release();
    await late.firstSave;
    assert.strictEqual(
      valueOnDisk(tab.path, 'scalarD'),
      '8',
      'the first save landed last and wrote the document again as it stands: the file holds the newer edit',
    );
    assert.strictEqual(late.writes(), 3, 'one write more');
    assert.strictEqual(tab.doc.edits.dirty, false, 'and the tab is clean over the newer edit');

    // The user edits again, and saves.
    await edit('negD', '42');
    await tab.provider.saveCustomDocument(tab.doc, token());
    assert.deepStrictEqual([valueOnDisk(tab.path, 'scalarD'), valueOnDisk(tab.path, 'negD')], ['8', '42']);
    assert.strictEqual(tab.doc.edits.dirty, false);
  });

  test('an edit made before the late save lands leaves the tab dirty over the older file, for the next save', async () => {
    const { tab, edit } = await open();
    const late = await saveBehindANewerOne(tab, edit);
    await edit('negD', '42');
    late.release();
    await late.firstSave;
    assert.strictEqual(valueOnDisk(tab.path, 'scalarD'), '7', 'the first save landed last: the file holds the older edit');
    assert.strictEqual(late.writes(), 2, "and nothing wrote over it, the edit since being the next save's");
    assert.strictEqual(tab.doc.edits.dirty, true, 'the tab is not clean over the older file');

    await tab.provider.saveCustomDocument(tab.doc, token());
    assert.deepStrictEqual([valueOnDisk(tab.path, 'scalarD'), valueOnDisk(tab.path, 'negD')], ['8', '42']);
    assert.strictEqual(tab.doc.edits.dirty, false);
  });
});
