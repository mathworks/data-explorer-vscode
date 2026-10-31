// Copyright 2026 The MathWorks, Inc.
//
// A JSON dictionary's table gestures, undone and redone by VS Code itself: each gesture made through the
// text-table editor and saved, then VS Code's undo and a save, which must write the original file byte
// for byte, then its redo and a save, which must write the gesture's save byte for byte. Cell edits, adds
// and deletes, and the gallery, a paste and a move, on the edit fixtures' values_text.sldd.
//
// The table's own Undo is VS Code's `undo` on the dictionary's TextDocument, which holds every edit the
// table wrote as a WorkspaceEdit. Whether a test host applies `undo` to such an edit at all is probed
// first, on a scratch document (see cutPasteUndo.test.ts, whose canary probes an editor's own edit). On a
// desktop host where it does not, the round trips are skipped and say why, rather than failing for a
// reason that says nothing about the table. On CI (`CI` set), whose window does undo, a failed probe is a
// failure with its reason: a skip there would hide the very regression this test is for.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSectionRowId } from 'data-explorer-view/model';
import { waitFor } from './tools/hostHarness';
import { closeAll, fixturePath, type Opened } from './tools/tables';
import { nodeAt } from './tools/editorSaves';
import { answered, openTab, take, type Tab } from './tools/gestures';
import { registers } from '../../src/host/windowRegisters';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (): string => fixturePath('editbash', 'values_text.sldd');

/** Whether `undo`, run with a document's editor active, takes back a WorkspaceEdit applied to it. */
async function hostUndoesWorkspaceEdits(): Promise<boolean> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) return false;
  const scratch = vscode.Uri.joinPath(ws.uri, 'undo-canary-workspace-edit.txt');
  try {
    await vscode.workspace.fs.writeFile(scratch, Buffer.from('canary\n'));
    const doc = await vscode.workspace.openTextDocument(scratch);
    const before = doc.getText();
    const edit = new vscode.WorkspaceEdit();
    edit.insert(scratch, new vscode.Position(0, 0), 'x');
    if (!(await vscode.workspace.applyEdit(edit)) || doc.getText() === before) return false;
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('undo');
    await waitFor('the canary undo to land', () => doc.getText() === before, 1500);
    return true;
  } catch {
    return false;
  } finally {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.workspace.fs.delete(scratch, { useTrash: false }).then(undefined, () => undefined);
  }
}

/** The table's edit of one cell: the message it sends, with the text the cell shows as the old value. */
function cellEdit(tab: Tab, path: string, columnId: string, text: string): any {
  const node = nodeAt(tab.model(), path);
  assert.ok(node, `the table has a row at ${path}`);
  const row = node.toRow();
  const cell = row?.[columnId];
  const oldValue = columnId === 'Name' ? String(row?.Name?.label ?? '') : String(cell && typeof cell === 'object' ? (cell.text ?? '') : (cell ?? ''));
  return { type: 'edit', rowId: node.id, columnId, oldValue, newValue: text };
}

/** `undo` or `redo` with the document's editor active, and the document changed by it. */
async function run(doc: vscode.TextDocument, command: 'undo' | 'redo'): Promise<void> {
  await vscode.window.showTextDocument(doc, { preview: false });
  const version = doc.version;
  await vscode.commands.executeCommand(command);
  await waitFor(`the ${command} to land`, () => doc.version !== version, 5000);
}

/** One gesture on a fresh copy of the fixture, saved, undone and saved, redone and saved. */
async function roundTrip(label: string, gesture: (tab: Tab) => Promise<{ edited: boolean; answer: string; reason?: string }>): Promise<void> {
  const opened: Opened = [];
  registers.clearClipboard();
  registers.clearDrag();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dex-json-undo-redo-'));
    const tab = await openTab('json', opened, dir, 'values_text.sldd', fixture());
    const original = readFileSync(tab.path);
    const r = await gesture(tab);
    assert.ok(r.edited, `${label}: the gesture made an edit (${r.answer}: ${r.reason ?? ''})`);
    await tab.save();
    const made = readFileSync(tab.path);
    assert.ok(!made.equals(original), `${label}: the save changed the file`);
    await run(tab.doc!, 'undo');
    await tab.save();
    assert.ok(readFileSync(tab.path).equals(original), `${label}: undone and saved, the file is the original byte for byte`);
    await run(tab.doc!, 'redo');
    await tab.save();
    assert.ok(readFileSync(tab.path).equals(made), `${label}: redone and saved, the file is the gesture's save byte for byte`);
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    closeAll(opened);
    registers.clearClipboard();
  }
}

const NO_UNDO =
  'this VS Code host does not apply `undo` to a WorkspaceEdit (a scratch document kept the edit), so a ' +
  'round trip would say nothing about the table';

suite('A JSON dictionary table gesture, undone and redone by VS Code', () => {
  let undoAvailable = false;

  /** Go on where the host undoes; skip with the reason on a desktop that does not; fail on CI. */
  function needUndo(test: Mocha.Context): void {
    if (undoAvailable) return;
    if (process.env.CI) assert.fail(`on CI, ${NO_UNDO}`);
    test.skip();
  }

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    undoAvailable = await hostUndoesWorkspaceEdits();
    if (!undoAvailable) console.log(`[jsonTableUndoRedo] ${process.env.CI ? 'FAILING' : 'SKIPPING'}: ${NO_UNDO}.`);
  });

  test('cell edits: undo saves the original bytes, redo saves the edit\'s', async function () {
    needUndo(this);
    this.timeout(60000);
    for (const [path, column, text] of [
      ['dScalar', 'Value', '7'],
      ['dRow(1)', 'Value', '7'],
      ['strRow(1)', 'Value', '"abc"'],
      ['sLeaves.dScalar', 'Value', '[1;2;3]'],
      ['sNest.c{2}.s', 'Name', 'zz_new'],
    ]) {
      await roundTrip(`${column} of ${path} = ${text}`, (tab) => answered(tab, cellEdit(tab, path, column, text)));
    }
  });

  test('adds and deletes: undo saves the original bytes, redo saves the edit\'s', async function () {
    needUndo(this);
    this.timeout(60000);
    for (const [op, path] of [
      ['addChild', 'sLeaves.dRow'],
      ['delete', 'cNest{1}{2}{1}'],
      ['delete', 'pStruct.Value.b(1)'],
    ]) {
      await roundTrip(`${op} ${path}`, (tab) => {
        const node = nodeAt(tab.model(), path);
        assert.ok(node, `the table has a row at ${path}`);
        return answered(tab, op === 'addChild' ? { type: 'addChild', rowId: node.id } : { type: 'delete', rowIds: [node.id] });
      });
    }
  });

  test('the gallery, a paste and a move: undo saves the original bytes, redo saves the edit\'s', async function () {
    needUndo(this);
    this.timeout(60000);
    await roundTrip('gallery add of a Simulink.Parameter', (tab) => answered(tab, { type: 'addEntry', section: 'design', className: 'Simulink.Parameter', rename: false }));
    await roundTrip('copy and paste of bus into Design Data', async (tab) => {
      const taken = await take(tab, 'design', 'bus', 'copy');
      if (taken) return { ...taken, edited: false };
      return answered(tab, { type: 'paste', rowId: buildSectionRowId('design') });
    });
    await roundTrip('move of dScalar into Other Data', async (tab) => {
      const taken = await take(tab, 'design', 'dScalar', 'cut');
      if (taken) return { ...taken, edited: false };
      return answered(tab, { type: 'paste', rowId: buildSectionRowId('other') });
    });
  });
});
