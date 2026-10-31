// Copyright 2026 The MathWorks, Inc.
// Two saves of a compressed-binary .sldd whose writes land out of order, inside real VS Code.
//
// VS Code cancels a save's token when it starts another save of the same document, and from then on
// ignores the first one's result (settledSave.ts), but the first save's write goes on: a slow disk, a
// large dictionary, a save pressed twice or an autosave beside Ctrl+S. Its write can then land after
// the newer save's, and the file holds the older bytes while VS Code shows the tab clean.
//
// Here the first save's write is held (the provider's writeUserFile, as a slow disk holds one), a
// second save of a newer edit writes, and then the first lands. The engine answers that it landed
// behind the newer save, and the first save writes the document once more as it stands, which is
// what the newer save wrote (settledSave.ts): the file holds the newer edit, and the tab is clean over
// it. An edit made before the first lands leaves the tab dirty over the older file instead, and the
// next save writes it. The save after these writes the newest edits. Before this editor moved onto
// view's engine it was refused as a fault in the editor ("Refusing to save: entry "gravity" would be
// written with bytes other than the file's"), the save gate holding the chunk to the older file with
// the edit it differs by given to the newer save; the engine gives that edit back when the older
// save lands.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { unzipSync } from 'fflate';
import { quiet, token, waitFor } from './tools/hostHarness';
import { closeAll, entryRow, openBinary, type BinaryTab, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Edit = (name: 'gravity' | 'scalarD', value: string) => Promise<void>;

/** The Value of the Simulink.Parameter or the double `name` holds in the dictionary at `path`. */
function valueOnDisk(path: string, name: string): string | undefined {
  const chunk = new TextDecoder().decode(unzipSync(readFileSync(path))['data/chunk0.xml']);
  const at = chunk.indexOf(`<P Name="Name" Class="char">${name}</P>`);
  const end = chunk.indexOf('</Object>', at);
  return /<P Name="Value" Class="double">([^<]*)<\/P>/.exec(chunk.slice(at, end))?.[1];
}

suite('Binary .sldd: saves whose writes land out of order', () => {
  let dir = '';
  const opened: Opened = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-save-order-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** The dictionary opened, and an edit of an entry's Value as the table sends one. */
  async function open(): Promise<{ tab: BinaryTab; edit: Edit }> {
    const tab = await openBinary(opened, dir, 'save_order.sldd');
    const rows = { gravity: entryRow(tab.view.posts, 'gravity'), scalarD: entryRow(tab.view.posts, 'scalarD') };
    const shown: Record<string, string> = { gravity: '9.81', scalarD: String(rows.scalarD.Value) };
    const edit = async (name: 'gravity' | 'scalarD', value: string) => {
      const before = tab.events.length;
      tab.view.send({ type: 'edit', rowId: rows[name].ID, columnId: 'Value', oldValue: shown[name], newValue: value });
      await waitFor(`the edit of ${name} to reach the document`, () => tab.events.length > before);
      shown[name] = value;
    };
    return { tab, edit };
  }

  /**
   * The user edits gravity to 9.7 and saves, and the save's write is held, as a slow disk holds one.
   * VS Code starts the next save, cancelling this one's token; the user has edited gravity to 9.6,
   * and that save writes. Answers the first save, still writing, what lets its write land, and the
   * count of writes. With `extraWriteFails`, the third write fails, as a full disk fails one.
   */
  async function saveBehindANewerOne(tab: BinaryTab, edit: Edit, extraWriteFails = false) {
    const write = tab.provider.writeUserFile;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let writes = 0;
    tab.provider.writeUserFile = async (uri, bytes) => {
      if (++writes === 1) await held;
      if (writes === 3 && extraWriteFails) throw new Error('ENOSPC: no space left on device');
      return write(uri, bytes);
    };

    await edit('gravity', '9.7');
    const first = new vscode.CancellationTokenSource();
    const firstSave = tab.provider.saveCustomDocument(tab.doc, first.token);
    await waitFor("the first save's write to start", () => writes === 1);
    // VS Code starts the next save: it cancels this one's token, and ignores what it answers.
    first.cancel();
    await edit('gravity', '9.6');
    await tab.provider.saveCustomDocument(tab.doc, token());
    assert.strictEqual(valueOnDisk(tab.path, 'gravity'), '9.6', 'the second save wrote the newer edit');
    assert.strictEqual(tab.doc.edits.dirty, false, 'and the tab is clean over it');
    return { firstSave, release, writes: () => writes };
  }

  test('a save whose write lands after a newer save writes the newer edits over it, and the next save writes the newest', async () => {
    const { tab, edit } = await open();
    const late = await saveBehindANewerOne(tab, edit);
    late.release();
    await late.firstSave;
    assert.strictEqual(
      valueOnDisk(tab.path, 'gravity'),
      '9.6',
      'the first save landed last and wrote the document again as it stands: the file holds the newer edit',
    );
    assert.strictEqual(late.writes(), 3, 'one write more');
    assert.strictEqual(tab.doc.edits.dirty, false, 'and the tab is clean over the newer edit');

    // The user edits again, and saves.
    await edit('scalarD', '42');
    await tab.provider.saveCustomDocument(tab.doc, token());
    assert.deepStrictEqual(
      [valueOnDisk(tab.path, 'gravity'), valueOnDisk(tab.path, 'scalarD')],
      ['9.6', '42.0'],
      'the save writes the newest edit of each entry (a double as core writes one)',
    );
    assert.strictEqual(tab.doc.edits.dirty, false);
  });

  test('an edit made before the late save lands leaves the tab dirty over the older file, for the next save', async () => {
    const { tab, edit } = await open();
    const late = await saveBehindANewerOne(tab, edit);
    await edit('scalarD', '42');
    late.release();
    await late.firstSave;
    assert.strictEqual(valueOnDisk(tab.path, 'gravity'), '9.7', 'the first save landed last: the file holds the older edit');
    assert.strictEqual(late.writes(), 2, 'and nothing wrote over it, the edit since being the next save\'s');
    assert.strictEqual(tab.doc.edits.dirty, true, 'the tab is not clean over the older file');

    await tab.provider.saveCustomDocument(tab.doc, token());
    assert.deepStrictEqual([valueOnDisk(tab.path, 'gravity'), valueOnDisk(tab.path, 'scalarD')], ['9.6', '42.0']);
    assert.strictEqual(tab.doc.edits.dirty, false);
  });

  test('an extra write that fails leaves the tab unsaved over the older file, and tells the user once', async () => {
    const { tab, edit } = await open();
    const told: string[] = [];
    tab.provider.showError = (message) => void told.push(message);
    const late = await saveBehindANewerOne(tab, edit, true);
    late.release();
    await late.firstSave;
    assert.strictEqual(valueOnDisk(tab.path, 'gravity'), '9.7', 'the first save landed last: the file holds the older edit');
    assert.strictEqual(late.writes(), 3, 'and the write over it failed');
    assert.strictEqual(tab.changes.length, 1, 'VS Code was told the document changed, with no edit to undo');
    assert.strictEqual(tab.doc.edits.dirty, true, 'the tab is not clean over the older file');
    assert.deepStrictEqual(told, ["Couldn't finish saving save_order.sldd; the file on disk may be older than the editor. Save again."]);

    // The user saves again.
    await tab.provider.saveCustomDocument(tab.doc, token());
    assert.strictEqual(valueOnDisk(tab.path, 'gravity'), '9.6');
    assert.strictEqual(tab.doc.edits.dirty, false);
    assert.strictEqual(told.length, 1);
  });
});
