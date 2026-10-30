// Copyright 2026 The MathWorks, Inc.
// Two saves of a compressed-binary .sldd whose writes land out of order, inside real VS Code.
//
// VS Code cancels a save's token when it starts another save of the same document, and from then on
// ignores the first one's result (settledSave.ts), but the first save's write goes on: a slow disk, a
// large dictionary, a save pressed twice or an autosave beside Ctrl+S. Its write can then land after
// the newer save's, and the file holds the older bytes.
//
// Here the first save's write is held (the provider's writeUserFile, as a slow disk holds one), a
// second save of a newer edit writes, and then the first lands. The save after that is the one this
// suite asks about: it writes the newest edits. Before this editor moved onto view's engine it was
// refused as a fault in the editor ("Refusing to save: entry "gravity" would be written with bytes
// other than the file's"), the save gate holding the chunk to the older file with the edit it
// differs by given to the newer save; the engine gives that edit back when the older save lands.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { unzipSync } from 'fflate';
import { quiet, token, waitFor } from './tools/hostHarness';
import { closeAll, entryRow, openBinary, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

  test('a save whose write lands after a newer save leaves the file older, and the next save writes the newest edits', async () => {
    const tab = await openBinary(opened, dir, 'save_order.sldd');
    const rows = { gravity: entryRow(tab.view.posts, 'gravity'), scalarD: entryRow(tab.view.posts, 'scalarD') };
    const shown: Record<string, string> = { gravity: '9.81', scalarD: String(rows.scalarD.Value) };
    const edit = async (name: 'gravity' | 'scalarD', value: string) => {
      const before = tab.events.length;
      tab.view.send({ type: 'edit', rowId: rows[name].ID, columnId: 'Value', oldValue: shown[name], newValue: value });
      await waitFor(`the edit of ${name} to reach the document`, () => tab.events.length > before);
      shown[name] = value;
    };

    // The first save's write is held, as a slow disk holds one.
    const write = tab.provider.writeUserFile;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let writes = 0;
    tab.provider.writeUserFile = async (uri, bytes) => {
      if (++writes === 1) await held;
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
    release();
    await firstSave;
    assert.strictEqual(valueOnDisk(tab.path, 'gravity'), '9.7', 'the first save landed last: the file holds the older edit');

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
});
