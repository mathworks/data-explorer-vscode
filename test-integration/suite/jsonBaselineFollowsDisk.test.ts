// Copyright 2026 The MathWorks, Inc.
// What a JSON .sldd's "Modified" marks are measured against: the file on disk.
//
// A mark says an entry differs from what the file holds. The table took that baseline ONCE — from
// the document's text, the first time it painted — and replaced it only on a save. Three ordinary
// ways of opening or getting back to a file broke that:
//
//   - the file changes on disk while the document is clean, and VS Code reloads it: every entry
//     the other tool changed was marked Modified in a document with nothing to save;
//   - the user reverts: the document goes back to the file — which may itself have changed on
//     disk meanwhile — and the marks stayed measured against the text it was opened with;
//   - the document is already dirty when the table opens (a window restored with unsaved
//     changes, or edits made in the text view first): the baseline was the EDITED text, so the
//     entries that differ from the file showed nothing at all.
//
// The first two need the real host: what VS Code reports at a reload and a revert — and that it
// reports a reload with no dirty-state event at all — is what the table has to read it from. The
// dirty open is view's JSON engine's test now (its baseline.test.ts).
import * as assert from 'assert';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { ctx, fakeTable, isEntryRow, nameOf, quiet, rowNamed, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const marked = (rows: any[]): string[] => rows.filter((r) => isEntryRow(r) && r.Status === 'Modified').map(nameOf);

/** The `{...}` span of the entries[] element whose "name" is `name`. */
function spanOf(text: string, name: string): { offset: number; length: number } {
  const idx = text.indexOf(`"name": ${JSON.stringify(name)}`);
  assert.ok(idx >= 0, `the text spells the entry "${name}"`);
  const start = text.lastIndexOf('{', idx);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { offset: start, length: i + 1 - start };
  }
  throw new Error(`no element span for "${name}"`);
}

/** `text` with the entry Number holding `value` — as another tool would write it. */
function withNumber(text: string, value: number): string {
  const span = spanOf(text, 'Number');
  const record = JSON.parse(text.slice(span.offset, span.offset + span.length));
  record.value = value;
  return text.slice(0, span.offset) + JSON.stringify(record, null, '\t') + text.slice(span.offset + span.length);
}

const write = (uri: vscode.Uri, text: string) => vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));

suite('A JSON .sldd table marks what differs from the file on disk', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('a file changed on disk and reloaded is not marked Modified', async () => {
    const uri = wsUri('json_baseline_reload_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));

      const next = withNumber(doc.getText(), 7);
      await write(uri, next);
      await waitFor('VS Code to reload the document', () => doc.getText() === next, 20000);
      assert.ok(!doc.isDirty, 'the reloaded document has nothing to save');
      await waitFor('the table to show the value the file now holds', () => rowNamed(table.rows(), 'Number').Value === '7');
      await quiet(1000, 'a repaint of the marks');

      assert.deepStrictEqual(marked(table.rows()), [], 'no entry differs from the file, so none is marked');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);

  test('a revert to a file changed on disk clears the marks', async () => {
    const uri = wsUri('json_baseline_revert_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));

      // An unsaved edit in the table, then another tool changes the same entry on disk.
      const row = rowNamed(table.rows(), 'Number');
      table.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: '1', newValue: '77' });
      await waitFor('the edit to make the document dirty', () => doc.isDirty);
      await waitFor('the edit to be marked', () => marked(table.rows()).includes('Number'));
      const onDisk = withNumber(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)), 9);
      await write(uri, onDisk);

      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await waitFor('the revert to bring the file back', () => !doc.isDirty && doc.getText() === onDisk, 20000);
      await waitFor('the table to show the value the file holds', () => rowNamed(table.rows(), 'Number').Value === '9');
      await quiet(1000, 'a repaint of the marks');

      assert.deepStrictEqual(marked(table.rows()), [], 'the document is the file again, so nothing is marked');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);

  test('an edit to a clean document does not read the file to tell it from a reload', async () => {
    // A reload says itself only by leaving the text equal to the file, so a change to a clean
    // document is checked against the file — and the check read the WHOLE file, in every tab, on
    // the first edit after every save (47.8 MB per tab on a real dictionary, after every
    // autosave). The file cannot have been reloaded if it has not changed since the document
    // last matched it, which its size and modification time say for the price of a stat.
    //
    // Counted through a file system of the test's own, since the reads go through
    // `workspace.fs`, which cannot be wrapped.
    const dir = mkdtempSync(join(tmpdir(), 'dex-count-'));
    const disk = new CountingFs(dir);
    const registered = vscode.workspace.registerFileSystemProvider('dexcount', disk);
    const uri = vscode.Uri.from({ scheme: 'dexcount', path: '/json_baseline_no_read.sldd' });
    writeFileSync(disk.real(uri), await vscode.workspace.fs.readFile(wsUri('data.sldd')));
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));
      await quiet(300, 'the open settling');
      disk.reads = 0;

      const next = withNumber(doc.getText(), 8);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), next);
      assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
      await waitFor('the document to be dirty', () => doc.isDirty);
      await waitFor('the table to show the edit', () => rowNamed(table.rows(), 'Number').Value === '8');
      await quiet(500, 'a check of the file against the edit');

      assert.strictEqual(disk.reads, 0, 'the file was not read');
      assert.deepStrictEqual(marked(table.rows()), ['Number'], 'and the edit is marked as the change it is');
    } finally {
      table.close();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      registered.dispose();
      // The temporary folder goes too: a run left one behind for every run before it.
      rmSync(dir, { recursive: true, force: true });
    }
  }).timeout(60000);
});

/** A file system over a temporary folder, counting the whole-file reads made of it. */
class CountingFs implements vscode.FileSystemProvider {
  reads = 0;
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;
  constructor(private readonly root: string) {}
  real(uri: vscode.Uri): string {
    return join(this.root, uri.path);
  }
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }
  stat(uri: vscode.Uri): vscode.FileStat {
    const st = statSync(this.real(uri));
    return { type: vscode.FileType.File, ctime: st.ctimeMs, mtime: st.mtimeMs, size: st.size };
  }
  readDirectory(): [string, vscode.FileType][] {
    return [];
  }
  createDirectory(): void {}
  readFile(uri: vscode.Uri): Uint8Array {
    this.reads++;
    return readFileSync(this.real(uri));
  }
  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    writeFileSync(this.real(uri), content);
  }
  delete(uri: vscode.Uri): void {
    rmSync(this.real(uri), { force: true });
  }
  rename(): void {}
}
