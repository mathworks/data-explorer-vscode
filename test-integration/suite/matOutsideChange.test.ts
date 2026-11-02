// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file editor, and the two answers to a save refused because the file changed on disk
// that only the binary .sldd editor had tests for (binarySlddOutsideChange.test.ts): the prompt's
// Overwrite, and `files.saveConflictResolution: overwriteFileOnDisk`. Both editors follow the disk
// through the same diskFollow.ts, and this pins that a MAT-file takes the same answers the same
// way. The Revert answer, which goes through VS Code's own revert of a real tab, is
// saveConflictInTab.test.ts's.
//
// Each test works on a copy in tmpdir, outside the workspace folder, as matEdit.test.ts does.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { quiet, token, waitFor } from './tools/hostHarness';
import { closeAll, matFixture, openMat, readMat, variableRow, type MatTab, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Write the file as another program would, with an mtime later than any the view has seen. */
function writeOutside(path: string, bytes: Uint8Array): void {
  const before = statSync(path).mtimeMs;
  writeFileSync(path, bytes);
  const later = new Date(Math.max(Date.now(), before) + 2000);
  utimesSync(path, later, later);
}

/** Set a `files.*` setting for the whole profile, and wait until this host reads it back. */
async function setFiles(key: string, value: string | undefined, uri: vscode.Uri): Promise<void> {
  await vscode.workspace.getConfiguration('files').update(key, value, vscode.ConfigurationTarget.Global);
  await waitFor(`files.${key} to read back`, () => vscode.workspace.getConfiguration('files', uri).inspect(key)?.globalValue === value);
}

const isCancellation = (err: unknown): boolean => err instanceof vscode.CancellationError;
const disk = (m: MatTab) => new Uint8Array(readFileSync(m.path));
/** The variables core reads back from the file on disk, by name, with the Value each shows. */
const saved = (m: MatTab): Map<string, string> =>
  readMat(disk(m), (mat) => new Map((mat.children as any[]).map((v) => [v.name, v.toRow().Value])));

const CONFLICT = "Failed to save 'cases.mat': The content of the file is newer. Do you want to overwrite the file with your changes?";

suite('MAT-file editor: Overwrite, and overwriteFileOnDisk, for a file changed on disk', () => {
  const opened: Opened = [];
  let dir: string;
  /** Every message the provider asked the user, and the answer to give next. */
  let asked: string[];
  let answer: string | undefined;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-mat-outside-'));
    asked = [];
    answer = undefined;
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** cases.mat, opened, with the prompt answered by `answer`. */
  async function open(): Promise<MatTab> {
    const m = await openMat(opened, dir, 'cases.mat', matFixture('cases.mat'));
    m.provider.askSaveConflict = async (message: string) => {
      asked.push(message);
      return answer;
    };
    return m;
  }

  const edit = async (m: MatTab, name: string, value: string) => {
    const row = variableRow(m.view.posts, name);
    m.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: row.Value, newValue: value });
    await waitFor(`the edit of ${name} to reach the table`, () => variableRow(m.view.posts, name).Value === value);
    assert.strictEqual(m.doc.edits.dirty, true, 'an unsaved edit');
  };

  test('Overwrite writes over the version it was asked about, and a newer one is asked about again', async () => {
    const m = await open();
    await edit(m, 'scalarD', '42');
    writeOutside(m.path, matFixture('pv_basic.mat'));
    answer = 'Overwrite';
    await assert.rejects(() => m.provider.saveCustomDocument(m.doc, token()), isCancellation, 'the save is refused');
    await waitFor('the Overwrite answer to be taken', () => m.doc.overwriteStamp !== undefined && !m.doc.conflictPromptOpen);
    assert.deepStrictEqual(asked, [CONFLICT], 'VS Code’s own wording, once');

    // Overwrite saves through VS Code, which reaches the provider VS Code registered, not this
    // one. So the save it causes is made here directly.
    await m.provider.saveCustomDocument(m.doc, token());
    assert.strictEqual(saved(m).get('scalarD'), '42', 'the edit is on disk now');
    assert.ok(!saved(m).has('p'), 'over the outside version, which held p');
    assert.strictEqual(m.doc.edits.dirty, false);
    assert.strictEqual(asked.length, 1, 'without asking again');

    // The answer was about that version only.
    await edit(m, 'negD', '7');
    const again = matFixture('nested_handles.mat');
    writeOutside(m.path, again);
    answer = undefined;
    await assert.rejects(() => m.provider.saveCustomDocument(m.doc, token()), isCancellation);
    await waitFor('the second prompt', () => asked.length === 2);
    assert.deepStrictEqual(disk(m), again, 'a newer outside write is asked about again, and not overwritten');
    assert.strictEqual(m.doc.edits.dirty, true, 'and the edit stays unsaved');
  });

  test('files.saveConflictResolution: overwriteFileOnDisk saves without asking', async () => {
    const m = await open();
    await edit(m, 'scalarD', '42');
    writeOutside(m.path, matFixture('pv_basic.mat'));
    await setFiles('saveConflictResolution', 'overwriteFileOnDisk', m.uri);
    try {
      await m.provider.saveCustomDocument(m.doc, token());
    } finally {
      await setFiles('saveConflictResolution', undefined, m.uri);
    }
    assert.strictEqual(saved(m).get('scalarD'), '42', 'the edit overwrote the outside change');
    assert.ok(!saved(m).has('p'), 'which held p');
    assert.strictEqual(m.doc.edits.dirty, false);
    assert.deepStrictEqual(asked, []);
  });
});
