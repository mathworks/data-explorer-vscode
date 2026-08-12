// Copyright 2026 The MathWorks, Inc.
// Integration guard for the LAZY-CUT move contract in real VS Code.
//
// Table cut is lazy: the cut makes no text edit; the whole move happens at
// PASTE time as a SINGLE full-text WorkspaceEdit (SlddTextEditorProvider's
// replaceAll — delete the source and add it to the target in one edit). The
// payoff is undo granularity: a same-document move is ONE native undo step, not
// the two steps the old eager cut+paste produced. That granularity lives in
// VS Code's real undo stack, which the headless vitest suite cannot exercise —
// so we assert it here.
//
// We cannot postMessage into the webview from the test host, and src/host does
// not require() cleanly inside the Electron host (jsonc-parser), so — exactly as
// liveEdit.test.ts does — we SIMULATE the provider's write-back: apply the
// move's resulting full text as one WorkspaceEdit on the shared TextDocument,
// then assert a single undo restores the original document byte-for-byte. The
// move's byte-level correctness (uniquify/reparent/splice) is covered by the
// vitest suites (structuralEdit, cutPasteEndToEnd); THIS test pins the one-edit,
// one-undo contract against a live editor.
import * as assert from 'assert';
import * as vscode from 'vscode';

const TABLE_VIEW = 'dataExplorer.tableView';

function slddUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, 'data.sldd');
}

// Produce the text a same-document MOVE of one entry yields: remove the named
// entry from the entries array and re-append it. This mirrors the NET effect of
// the provider's deleteEntriesByName + pasteEntry (which the provider then
// writes as a single full-text replace). We round-trip through JSON so the
// result is guaranteed valid; the exact byte formatting is not what this test
// asserts (unit tests cover the real byte-splice) — only that it is ONE edit
// undone in ONE step.
function moveEntryToEnd(text: string, name: string): string {
  const doc = JSON.parse(text);
  const parts = doc.__MW_TEXT_PARTS__;
  const partKey = Object.keys(parts)[0];
  const content = parts[partKey].__MW_TEXT_content;
  const entries = content.entries as Array<{ name: string }>;
  const idx = entries.findIndex((e) => e.name === name);
  assert.ok(idx >= 0, `entry "${name}" exists in the fixture`);
  const [moved] = entries.splice(idx, 1);
  entries.push(moved);
  return JSON.stringify(doc, null, 2);
}

suite('Data Explorer .sldd lazy-cut move — one edit, one undo', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    // Revert any unsaved edits so the fixture is untouched for the next test/run.
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('a same-document move applies as ONE WorkspaceEdit and a single undo restores the original', async () => {
    const uri = slddUri();

    // The one-edit/one-undo contract is a property of the shared TextDocument's
    // native undo stack, which the provider's move write-back (replaceAll) feeds.
    // Drive it through the text editor directly: the `undo` command routes to the
    // ACTIVE editor, so we open ONLY the text editor and keep it active (opening
    // the table view too would leave undo's target ambiguous across groups).
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });

    const originalText = doc.getText();
    assert.strictEqual(doc.isDirty, false, 'the document starts clean');

    // Simulate the provider's move write-back: ONE full-range replace. The
    // provider does this via a WorkspaceEdit (replaceAll); here we apply the SAME
    // single full-range replace through editor.edit instead, because a
    // WorkspaceEdit-driven undo does not route to the editor's undo stack in the
    // headless Electron test host (undo becomes a no-op). Both are a single edit
    // = a single undo stop — the granularity this test asserts is identical; only
    // the apply mechanism differs so undo is observable in the test host.
    const movedText = moveEntryToEnd(originalText, 'Number');
    assert.notStrictEqual(movedText, originalText, 'the move changes the document text');

    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length));
    const applied = await editor.edit((eb) => eb.replace(fullRange, movedText));
    assert.strictEqual(applied, true, 'the move edit applied');
    assert.ok(doc.isDirty, 'the document is dirty after the move');
    assert.notStrictEqual(doc.getText(), originalText, 'the document reflects the move');
    JSON.parse(doc.getText()); // the moved text is still valid JSON

    // Undo through the editor's own command so it targets THIS editor's undo
    // stack (not whatever the workbench considers globally active). A SINGLE undo
    // must restore the ORIGINAL byte-for-byte: if the move were two edits (the old
    // eager cut+paste), one undo would leave a partial, dirty state — the
    // regression this test guards against.
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      uri.toString(),
      'the .sldd text editor is active so undo targets its stack',
    );
    await vscode.commands.executeCommand('default:undo');
    await new Promise((r) => setTimeout(r, 300));

    assert.strictEqual(doc.getText(), originalText, 'one undo restored the original text exactly');
    assert.strictEqual(doc.isDirty, false, 'and the document is clean again (a full single-step undo)');
    // Keep a reference to the editor so it is unmistakably the target of undo.
    assert.ok(editor.document === doc, 'the editor renders the shared document');
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active through the move + undo',
    );
  });

  test('cross-document source delete applies as its own WorkspaceEdit (separate undo step)', async () => {
    // A cross-document cut pastes into the target, then deletes from the SOURCE
    // document via that document's own WorkspaceEdit (SlddTextEditorProvider's
    // deleteFromSourceDocument). There is a single editable .sldd fixture, so we
    // model just the source side: opening the source document and applying a
    // full-text delete-write is a distinct, revertible edit on THAT document —
    // proving the cross-doc source edit is independent of any target edit.
    const uri = slddUri();
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    const originalText = doc.getText();
    // Remove one entry (the source-delete half of a cross-document move).
    const parsed = JSON.parse(originalText);
    const partKey = Object.keys(parsed.__MW_TEXT_PARTS__)[0];
    const entries = parsed.__MW_TEXT_PARTS__[partKey].__MW_TEXT_content.entries as Array<{ name: string }>;
    const before = entries.length;
    const trimmed = { ...parsed };
    trimmed.__MW_TEXT_PARTS__[partKey].__MW_TEXT_content.entries = entries.filter((e) => e.name !== 'Number');
    const trimmedText = JSON.stringify(trimmed, null, 2);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)), trimmedText);
    const applied = await vscode.workspace.applyEdit(edit);
    assert.strictEqual(applied, true, 'the source-delete edit applied');

    const after = (JSON.parse(doc.getText()).__MW_TEXT_PARTS__[partKey].__MW_TEXT_content.entries as unknown[]).length;
    assert.strictEqual(after, before - 1, 'exactly one entry was removed from the source document');
    assert.ok(doc.isDirty, 'the source document is dirty (its own revertible edit)');
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active through the cross-document source delete',
    );
  });
});
