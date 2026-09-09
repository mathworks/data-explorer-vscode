// Copyright 2026 The MathWorks, Inc.
// Undo and redo of an edit to a compressed-binary .sldd, inside real VS Code.
//
// This format has no TextDocument, so its undo is not VS Code's: the provider pushes an
// edit onto the custom-document stack and VS Code hands back the `undo`/`redo` closures it
// will call. What those closures do is the whole contract:
//
//   - they restore data/chunk0.xml (the bytes a save then writes), and
//   - they bring the MODEL back in step from the ops the edit recorded, WITHOUT re-parsing
//     the payload — which on a real customer dictionary (2.6 MB zipped, 31,345 entries) is
//     the difference between ~4.3 s and ~0.2 ms, and a 74 MB postMessage against 684 bytes.
//
// The vitest suite covers the ops themselves (binaryEntryScopedEdit). What only real VS Code
// can show is this side: a document edit reaching the provider's event at all, the closures
// running against a model registered from a genuinely unzipped payload, and every open view
// of the document being repainted rather than only the last one resolved.
//
// A webview cannot be driven from the test host (see cutPasteUndo.test.ts), so the edit is
// pushed the way the message handler pushes it — the model op first, then pushEdit with the
// patch for both directions — instead of by clicking a cell.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { applyEntryOps, entryRecord } from '../../src/host/entryOps';

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

function token() {
  return new vscode.CancellationTokenSource().token;
}

function makePanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel('test.binSlddUndo', 'test', vscode.ViewColumn.One, {
    enableScripts: true,
  });
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A working copy of the fixture, so a save in this suite cannot touch the fixture itself. */
async function workingCopy(name: string): Promise<vscode.Uri> {
  const dst = wsUri(name);
  await vscode.workspace.fs.copy(wsUri('binary.sldd'), dst, { overwrite: true });
  return dst;
}

/** The first entry of the first non-empty section. */
function firstEntry(root: any): any {
  for (const section of root.children as any[]) {
    if (section.children.length > 0) return section.children[0];
  }
  return null;
}

suite('Binary .sldd undo/redo', () => {
  let provider: BinarySlddEditorProvider;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => (provider = new BinarySlddEditorProvider(ctx())));

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('undo and redo restore the payload and the model without re-parsing it', async () => {
    const uri = await workingCopy('binary_undo_copy.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    const sub = provider.onDidChangeCustomDocument((e) => edits.push(e));
    const panel = makePanel();
    await provider.resolveCustomEditor(doc, panel, token());
    await settle(500);
    assert.ok(panel.webview.html.includes('dex-tree-table'), 'the real render shell is up');
    // The model is registered by a repaint, which the webview asks for with `ready`.
    // Trigger one here instead of waiting on the webview's timing, then close the view so
    // a late `ready` cannot rebuild the tree underneath the assertions below — they are
    // about the registered tree still being the SAME tree. (Nothing else can: a message
    // is only delivered at an await, and the stretch that follows has none.)
    (doc as any).repaintAll();
    panel.dispose();

    const srcId = (doc as unknown as { srcId: string }).srcId;
    const root: any = DataModel.getDataSource(srcId);
    assert.ok(root, 'resolving the editor registered the document’s model');
    const entry = firstEntry(root);
    assert.ok(entry, 'the fixture has an entry to edit');
    assert.strictEqual(entry.name, 'Kp', 'the fixture entry is the one this test renames');

    const before = (doc as unknown as { chunkXml: string }).chunkXml;
    assert.ok(before.includes('>Kp<'), 'the payload spells the entry name');
    const after = before.replace('>Kp<', '>Ki<');

    // The rename, as the provider's applyEdit performs it: change the model first, then
    // push the edit with a patch that names the entry by the id the OTHER direction leaves
    // behind — a rename makes those two ids different, which is what makes it worth testing.
    const beforeRecord = entryRecord(entry);
    const preId: string = entry.id;
    const applied = applyEntryOps(root, [{ kind: 'replace', rowId: preId, record: { ...beforeRecord, name: 'Ki' } }]);
    const renamed = (applied[0] as any).entry;
    const postId: string = renamed.id;
    assert.notStrictEqual(postId, preId, 'the rename moved the entry’s id');
    (doc as any).pushEdit('Edit Name', before, after, {
      undo: [{ kind: 'replace', rowId: postId, record: beforeRecord }],
      redo: [{ kind: 'replace', rowId: preId, record: entryRecord(renamed) }],
    });

    assert.strictEqual(edits.length, 1, 'the document edit reached the provider’s event');
    const edit = edits[0];
    assert.strictEqual(edit.label, 'Edit Name', 'and carries the label VS Code shows in Undo');
    assert.strictEqual((doc as any).chunkXml, after, 'the edit swapped the payload');

    edit.undo();
    assert.strictEqual((doc as any).chunkXml, before, 'undo restored the payload text');
    assert.strictEqual(
      DataModel.getDataSource(srcId),
      root,
      'undo did NOT re-parse: the same tree is still registered',
    );
    const restored: any = DataModel.findNodeById(preId);
    assert.ok(restored, 'the pre-edit row id resolves again, so the next edit on that row works');
    assert.strictEqual(restored.name, 'Kp', 'and it is the pre-edit entry');
    assert.strictEqual(DataModel.findNodeById(postId), null, 'the renamed id is gone with it');

    edit.redo();
    assert.strictEqual((doc as any).chunkXml, after, 'redo swapped the payload back');
    assert.strictEqual(DataModel.getDataSource(srcId), root, 'redo did not re-parse either');
    const redone: any = DataModel.findNodeById(postId);
    assert.ok(redone, 'the renamed id resolves after redo');
    assert.strictEqual(redone.name, 'Ki');
    assert.strictEqual(DataModel.findNodeById(preId), null, 'and the pre-edit id is gone again');

    // What undo leaves behind is what a save writes — the point of restoring the payload
    // rather than only the rows.
    edit.undo();
    await provider.saveCustomDocument(doc, token());
    const zip = unzipSync(await vscode.workspace.fs.readFile(uri));
    assert.strictEqual(
      new TextDecoder().decode(zip['data/chunk0.xml']),
      before,
      'the saved payload is the undone one',
    );

    sub.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });

  test('every open view is repainted, narrowly when the edit says how and wide when it does not', async () => {
    // Two things at once, because they are the same mechanism: a document repaints EVERY
    // registered view (a split panel used to be dropped, leaving one table showing
    // pre-undo rows), and it chooses the narrow repaint only when the edit carried a
    // patch — an edit that could not state one must fall back to the wide repaint rather
    // than leave the table stale.
    const uri = await workingCopy('binary_undo_views.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    const sub = provider.onDidChangeCustomDocument((e) => edits.push(e));
    const panel = makePanel();
    await provider.resolveCustomEditor(doc, panel, token());
    await settle(500);
    // Register the model through the live view, then close it — same reason as above.
    (doc as any).repaintAll();
    panel.dispose();
    await settle(100);

    // Stand-in views, which is the only way to observe WHICH repaint ran: a real webview
    // panel cannot be asked what it was sent.
    const calls: string[] = [];
    const views = (doc as any).views as Set<{ repaintAll(): void; repaintOps(a: unknown[]): void }>;
    views.clear();
    for (const tag of ['a', 'b']) {
      views.add({
        repaintAll: () => calls.push(`${tag}:all`),
        repaintOps: () => calls.push(`${tag}:ops`),
      });
    }

    const srcId = (doc as unknown as { srcId: string }).srcId;
    const root: any = DataModel.getDataSource(srcId);
    assert.ok(root, 'the document’s model is registered');
    const entry = firstEntry(root);
    assert.ok(entry, 'the fixture has an entry to name in the patch');
    const record = entryRecord(entry);
    const before = (doc as unknown as { chunkXml: string }).chunkXml;

    // With a patch: both views repaint narrowly.
    (doc as any).pushEdit('Edit Name', before, before.replace('>Kp<', '>Ki<'), {
      undo: [{ kind: 'replace', rowId: entry.id, record }],
      redo: [{ kind: 'replace', rowId: entry.id, record }],
    });
    edits[0].undo();
    assert.deepStrictEqual(calls, ['a:ops', 'b:ops'], 'a patched undo repaints both views, narrowly');

    // Without one: both views repaint wide, from the text the undo just restored.
    calls.length = 0;
    (doc as any).pushEdit('Add child', before, before.replace('>Kp<', '>Ki<'));
    edits[1].undo();
    assert.deepStrictEqual(calls, ['a:all', 'b:all'], 'an undo with nothing to apply repaints both views, wide');
    assert.strictEqual((doc as any).chunkXml, before, 'either way the payload is restored');

    sub.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  });
});
