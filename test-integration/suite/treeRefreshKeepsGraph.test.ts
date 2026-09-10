// Copyright 2026 The MathWorks, Inc.
// What the Data Explorer tree must NOT re-read when a document goes dirty.
//
// The tree's rows are a relationship graph over every supported file in the folder, built by
// READING THOSE FILES FROM DISK (readForScan → workspace.fs.readFile — never the editor's
// buffer). So an unsaved keystroke cannot change a single edge in it: rebuilding the graph on
// a text change re-reads the whole folder to produce the graph it already had. Over a folder
// of real dictionaries that is 5.7 s (measured; 4 files, 98 MB) per keystroke, undo and redo,
// and it was a large part of why an undo in a big dictionary took seven seconds.
//
// The one thing a keystroke DOES change is the modified badge, and that comes from
// `getTreeItem` asking the document whether it is dirty — so re-rendering the rows is enough
// for it, which is what `refresh()` now is. Re-reading the folder is `rebuild()`, for the
// events that change what is on disk: create, delete, save, folder added.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SectionsTreeProvider } from '../../src/host/SectionsTreeProvider';
import { decode } from '../../src/host/health';

function extUri(): vscode.Uri {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return ext!.extensionUri;
}

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

/**
 * The file rows the tree shows at the top of the folder.
 *
 * A root is a file nothing else in the folder references, so this list is a direct readout of
 * the reference edges the graph was built from: link binary.sldd from another dictionary and
 * it stops being a root of its own.
 */
async function topFileLabels(tree: SectionsTreeProvider): Promise<string[]> {
  const roots = await tree.getChildren();
  const out: string[] = [];
  for (const r of roots) {
    if (r.kind === 'group') out.push(...(await tree.getChildren(r)).map((c) => c.label));
    else out.push(r.label);
  }
  return out.sort();
}

suite('The Data Explorer tree rebuilds only when the folder changed', () => {
  test('refresh() re-renders from the graph it has; rebuild() re-reads the folder', async () => {
    const uri = wsUri('data.sldd');
    const original = await vscode.workspace.fs.readFile(uri);
    const tree = new SectionsTreeProvider(extUri());
    const before = await topFileLabels(tree);
    assert.ok(before.includes('binary.sldd'), 'binary.sldd starts out an unreferenced root row');

    try {
      // Change the FOLDER, not a buffer: data.sldd now links binary.sldd, so a graph built
      // from disk after this cannot list binary.sldd as a root of its own.
      const linked = new TextDecoder()
        .decode(original)
        .replace('{', '{\n  "Dictionary References": ["binary.sldd"],');
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(linked));

      tree.refresh();
      assert.deepStrictEqual(
        await topFileLabels(tree),
        before,
        'refresh() answered from the graph it already had, without reading the folder again',
      );

      tree.rebuild();
      const after = await topFileLabels(tree);
      assert.ok(
        !after.includes('binary.sldd'),
        `rebuild() read the folder again and saw the new link (rows: ${JSON.stringify(after)})`,
      );
    } finally {
      await vscode.workspace.fs.writeFile(uri, original);
    }
  }).timeout(60000);

  test('a refresh() is enough to badge a document that just went dirty', async () => {
    const uri = wsUri('data.sldd');
    const tree = new SectionsTreeProvider(extUri());
    const rowFor = async (): Promise<vscode.TreeItem> => {
      const roots = await tree.getChildren();
      for (const r of roots) {
        const kids = r.kind === 'group' ? await tree.getChildren(r) : [r];
        const hit = kids.find((k) => k.label === 'data.sldd');
        if (hit) return tree.getTreeItem(hit);
      }
      throw new Error('data.sldd is not a row in the tree');
    };

    assert.strictEqual(
      decode((await rowFor()).resourceUri?.query),
      null,
      'the file starts clean, so its row carries no health state',
    );

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    try {
      // Dirty the document without saving — what a keystroke, an undo and a redo all do.
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, doc.positionAt(0), ' ');
      assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
      assert.ok(doc.isDirty, 'the document is dirty');

      tree.refresh();
      assert.strictEqual(
        decode((await rowFor()).resourceUri?.query),
        'modified',
        'the row is badged modified without the folder being read again',
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  }).timeout(60000);
});
