// Copyright 2026 The MathWorks, Inc.
//
// Location in Text (the row menu's item, Cmd/Ctrl+L), from the JSON dictionary's table: the text
// editor opens on the dictionary, beside the table (there is no table tab here, only its panel), with
// the row's entry selected, its `{...}` in the JSON. A row under an entry (a struct's field) has no text of its own, so its entry is
// selected. A row the table cannot place is said in the table, and nothing opens.
//
// The span is view's (the JSON engine's `locateInText`), and the webview's half, the item and the
// key posting `locateInText` for the row, is test/tableMainTextView.test.ts. This is the host's
// half, which only a real window shows: the provider's message, and the editor VS Code opens.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { childrenOf, isEntryRow, nameOf, quiet, waitFor } from './tools/hostHarness';
import { closeAll, errorsIn, openJson, type JsonTab, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The text editor on `uri` that has the focus, if that is where the focus is. */
const textEditorOn = (uri: vscode.Uri): vscode.TextEditor | undefined => {
  const editor = vscode.window.activeTextEditor;
  return editor?.document.uri.toString() === uri.toString() ? editor : undefined;
};

/** The JSON value the editor's selection spans, or undefined when it spans none. */
function selected(editor: vscode.TextEditor | undefined): any {
  if (!editor || editor.selection.isEmpty) return undefined;
  try {
    return JSON.parse(editor.document.getText(editor.selection));
  } catch {
    return undefined;
  }
}

suite('Location in Text, from the JSON dictionary’s table', () => {
  const opened: Opened = [];
  let dir: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-locate-'));
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    closeAll(opened);
    await quiet(200, 'the closed editors to let go of the file before its directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  const rowsOf = (j: JsonTab): any[] => j.view.posts.filter((m) => m.type === 'setRows').pop()?.rows ?? [];
  const entryRow = (j: JsonTab, name: string): any => {
    const row = rowsOf(j).find((r) => isEntryRow(r) && nameOf(r) === name);
    assert.ok(row, `the table has an entry row for "${name}"`);
    return row;
  };

  /** Ask for `rowId`'s place in the text, and answer the entry the editor that opens has selected. */
  async function locate(j: JsonTab, rowId: string, what: string): Promise<{ editor: vscode.TextEditor; entry: any }> {
    j.view.send({ type: 'locateInText', rowId });
    let editor: vscode.TextEditor | undefined;
    await waitFor(`the text editor, with ${what} selected`, () => selected((editor = textEditorOn(j.uri)))?.name === what, 20000, () =>
      editor ? `selected: ${JSON.stringify(editor.document.getText(editor.selection).slice(0, 80))}` : 'no text editor on the file has the focus',
    );
    return { editor: editor!, entry: selected(editor) };
  }

  test("an entry's row selects the entry's object in the text, in a text editor on the dictionary", async () => {
    const j = await openJson(opened, dir, 'locate.sldd');
    const { editor, entry } = await locate(j, entryRow(j, 'gravity').ID, 'gravity');
    assert.strictEqual(editor.document.getText(), j.doc.getText(), 'the dictionary’s own text, which the table edits');
    assert.strictEqual(entry.value?._array_class, 'Simulink.Parameter', 'the whole entry, its value with it');
    const text = editor.document.getText(editor.selection);
    assert.ok(text.startsWith('{') && text.endsWith('}'), 'from its opening brace to its closing one');
    const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === j.uri.toString());
    assert.ok(tab, 'a text tab on the file');
    assert.deepStrictEqual(errorsIn(j.view.posts), []);
  });

  test("a field's row selects the entry it is a field of", async () => {
    const j = await openJson(opened, dir, 'locate.sldd');
    const struct = entryRow(j, 'myStruct');
    const field = childrenOf(rowsOf(j), struct.ID).find((r) => nameOf(r) === 'b');
    assert.ok(field, 'myStruct has a row for its field b');
    const { entry } = await locate(j, field.ID, 'myStruct');
    assert.deepStrictEqual(entry.value?._fields, ['a', 'b', 'c']);
  });

  test('a row the table cannot place is said in the table, and opens nothing', async () => {
    const j = await openJson(opened, dir, 'locate.sldd');
    j.view.send({ type: 'locateInText', rowId: `${j.uri.toString()}/design/noSuchEntry` });
    await waitFor('the table to say so', () => errorsIn(j.view.posts).length > 0);
    assert.deepStrictEqual(errorsIn(j.view.posts), ['Could not locate the item in the model.']);
    await quiet(300, 'a text editor, had the row opened one, to open');
    assert.strictEqual(textEditorOn(j.uri), undefined, 'no text editor on the file');
  });
});
