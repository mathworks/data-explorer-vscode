// Copyright 2026 The MathWorks, Inc.
// Integration tests for the workspace name index, run inside a real VS Code so
// `vscode.workspace.findFiles` and `workspace.fs.readFile` resolve against the
// fixture workspace (binary.sldd, data.sldd, params.sldd, model.slx). The pure
// name-extraction rules are unit-tested in view's test/nameExtract.test.ts; here we
// prove the end-to-end contract the vitest suite cannot reach: the index builds a
// COMPLETE name list from files that are never OPENED (the whole point of eager,
// standalone indexing), and reads an unsaved buffer over the file. What it lists from
// each format, and that a name in two files is two records, are view's tests now (its
// test/nameIndex.test.ts, over the same fixtures).
import * as assert from 'assert';
import * as vscode from 'vscode';
import { invalidate, ensureIndex, listEntries, reindexFile } from '../../src/host/nameIndex';

function slddUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, 'data.sldd');
}

suite('workspace name index', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    // Start from a clean slate so each test triggers a full, deterministic build
    // off the on-disk fixtures (no leakage from a prior test's edits/reindex).
    invalidate();
  });

  test('builds a complete index from files that are never opened', async () => {
    // No editor is opened here — listEntries() alone drives the eager scan.
    await ensureIndex();
    const entries = await listEntries();
    assert.ok(entries.length > 0, 'the index is non-empty');

    // Every record carries the four fields the search overlay relies on.
    for (const e of entries) {
      assert.ok(e.name, 'a record has a non-empty name');
      assert.ok(e.sourceUri, 'a record has a source URI');
      assert.ok(e.sourceLabel, 'a record has a source label (basename)');
      assert.ok(
        ['sldd', 'mat', 'workspace', 'block'].includes(e.kind),
        `a record has a known kind (got ${e.kind})`,
      );
    }
  });

  test('reindex after an UNSAVED rename indexes the buffer, not the file on disk', async () => {
    // reindexFile is driven by onDidChangeTextDocument, which fires per keystroke
    // on a buffer that has NOT been written yet. Reading disk there re-derives the
    // pre-edit names, so a rename in an open .sldd left search offering the old
    // name (which no longer resolves to a row) and never the new one, until save.
    // The reindex looked healthy — it ran, it just re-read the wrong bytes.
    //
    // This needs a real TextDocument with a real dirty state, which is why it
    // lives here rather than in the vitest suite.
    const uri = slddUri();
    const doc = await vscode.workspace.openTextDocument(uri);
    const originalText = doc.getText();

    try {
      await ensureIndex();
      assert.ok(
        (await listEntries()).some((e) => e.name === 'Number' && e.sourceLabel === 'data.sldd'),
        'the on-disk name is indexed to begin with',
      );

      const renamed = originalText.replace(/"name": "Number"/, '"name": "NumberRenamedUnsaved"');
      assert.notStrictEqual(renamed, originalText, 'the fixture contains the entry being renamed');
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)), renamed);
      assert.strictEqual(await vscode.workspace.applyEdit(edit), true, 'the rename edit applied');
      assert.ok(doc.isDirty, 'the document is dirty — nothing has been written to disk');

      await reindexFile(uri);
      const names = (await listEntries())
        .filter((e) => e.sourceLabel === 'data.sldd')
        .map((e) => e.name);
      assert.ok(names.includes('NumberRenamedUnsaved'), 'the unsaved new name is searchable');
      assert.ok(!names.includes('Number'), 'the stale on-disk name is gone');
    } finally {
      // Discard the buffer so the fixture is untouched for every later test and
      // nothing is ever written to disk. Rewriting the original text back would
      // restore the CONTENT but leave the document dirty (the edit stays on the
      // undo stack), which would then leak into any later test that cares about
      // dirty state — so revert the document instead.
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      if (doc.isDirty || doc.getText() !== originalText) {
        const revert = new vscode.WorkspaceEdit();
        revert.replace(
          uri,
          new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
          originalText,
        );
        await vscode.workspace.applyEdit(revert);
      }
      invalidate();
    }
  });

  test('a CLEAN open document still indexes from disk', async () => {
    // The buffer is only preferred while DIRTY. A clean document's buffer and disk
    // agree, and preferring the buffer unconditionally would make the full build()
    // depend on which editors happen to be open.
    //
    // Reverting a buffer to its original text does NOT clear its dirty flag — the
    // edit is still on the undo stack — so this reverts through the editor command
    // rather than assuming a prior test left the document clean.
    const uri = slddUri();
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.isDirty) {
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }
    if (doc.isDirty) {
      // Some hosts do not route the revert command (see the undo-capability probe
      // in cutPasteUndo.test.ts). Nothing to assert about the clean path then.
      return;
    }

    await reindexFile(uri);
    const names = (await listEntries()).filter((e) => e.sourceLabel === 'data.sldd').map((e) => e.name);
    assert.ok(names.includes('Number'), 'the on-disk name is indexed for a clean document');
  });

  test('a compressed-binary .sldd can never present as a dirty text document', async () => {
    // The premise the dirtyBytesOf comment rests on. If a zip COULD be mirrored
    // as a TextDocument, getText() would hand back its bytes decoded as UTF-8 and
    // re-encoding that is lossy — the zip would stop parsing and the file would
    // silently drop out of search. VS Code refuses the open outright, which is a
    // stronger guarantee than the isDirty check alone: there is no text buffer for
    // a zip to prefer in the first place.
    //
    // Pinned as a test because it is a host behaviour this module DEPENDS on rather
    // than one it controls, so a future VS Code that starts allowing the open (e.g.
    // via an encoding setting) should surface here rather than as names quietly
    // vanishing from search.
    const ws = vscode.workspace.workspaceFolders?.[0];
    assert.ok(ws, 'a workspace folder must be open');
    const uri = vscode.Uri.joinPath(ws.uri, 'binary.sldd');

    await ensureIndex();
    const before = (await listEntries()).filter((e) => e.sourceLabel === 'binary.sldd').length;
    assert.ok(before > 0, 'the zip .sldd contributes names to begin with');

    await assert.rejects(
      () => Promise.resolve(vscode.workspace.openTextDocument(uri)),
      /binary/i,
      'VS Code refuses to mirror a zip .sldd as a TextDocument',
    );
    assert.ok(
      !vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString()),
      'no text document exists for the zip',
    );

    // And the reindex is unaffected: it reads disk and parses the zip.
    await reindexFile(uri);
    const after = (await listEntries()).filter((e) => e.sourceLabel === 'binary.sldd').length;
    assert.strictEqual(after, before, 'the zip .sldd still contributes the same names');
  });
});
