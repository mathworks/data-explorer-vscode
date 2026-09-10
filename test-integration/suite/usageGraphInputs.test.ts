// Copyright 2026 The MathWorks, Inc.
// What the workspace usage graph is allowed to be thrown away for.
//
// The graph is built by READING FILES FROM DISK (readForScan → workspace.fs.readFile) across
// the workspace and the open tabs. Two things follow, and the second used to be missed:
//
//   - an unsaved edit cannot change one edge in it, so a keystroke, an undo and a redo are
//     not grounds to drop it. Dropping it cost ~5.8 s to rebuild over a folder of real
//     dictionaries (measured; 4 files, 98 MB) — awaited, because the Usage column of the very
//     repaint that keystroke triggered wanted it. That is what made an undo take 7 seconds.
//   - which TABS are open does change what it reads, since open tabs are unioned into the
//     scan so a single file opened with no workspace folder still resolves its own usage.
//
// So the graph now checks its own inputs: it holds the tab list it was built from and goes
// stale when that list changes. Nothing else has to remember to invalidate it — a tab merely
// going dirty (which fires the same onDidChangeTabs as an open) leaves the list identical, and
// that is decided here rather than at the event, where it was decided wrongly.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  annotateDataRowsNow,
  ensureUsageGraph,
  invalidateUsageGraph,
} from '../../src/host/usageGraph';

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

/** True while the graph is cached: the one query that answers WITHOUT a rebuild. */
const cached = (): boolean => annotateDataRowsNow(wsUri('data.sldd').toString(), []);

suite('The usage graph keeps itself until its inputs change', () => {
  test('a dirty buffer does not stale it; opening a tab does', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    invalidateUsageGraph();
    await ensureUsageGraph();
    assert.ok(cached(), 'a built graph answers without a rebuild');

    // A buffer change, with no tab opened or closed: openTextDocument does not open a tab.
    const uri = wsUri('data.sldd');
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, doc.positionAt(0), ' ');
    assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
    assert.ok(doc.isDirty, 'the document is dirty');
    try {
      assert.ok(cached(), 'an unsaved edit is not a change to anything the graph read');

      // Opening a tab IS: its file joins the scan.
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(wsUri('params.sldd')));
      assert.ok(!cached(), 'the tab list it was built from changed, so it went stale');
      await ensureUsageGraph();
      assert.ok(cached(), 'and the next query rebuilt it against the new tab list');
    } finally {
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  }).timeout(60000);
});
