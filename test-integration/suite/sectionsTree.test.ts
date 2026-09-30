// Copyright 2026 The MathWorks, Inc.
// Integration tests for SectionsTreeProvider, run inside a real VS Code so the
// `vscode` API (workspace.findFiles, TreeItem, ThemeIcon, Uri) is genuine. The
// provider builds a cross-format relationship graph from the fixture workspace
// (binary.sldd, data.sldd, model.slx) and maps each GraphNode to a TreeItem.
// The pure graph logic is covered by the vitest suite (graphModel); here we
// assert the vscode-adapter contract the unit suite cannot reach: the actual
// tree structure over the workspace and the TreeItem shape (collapsibility,
// contextValue, open command, health resourceUri) for each node kind.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SectionsTreeProvider } from '../../src/host/SectionsTreeProvider';
import { HEALTH_QUERY } from '../../src/host/health';

function extensionUri(): vscode.Uri {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return ext!.extensionUri;
}

// Find a node among a level by label (labels are unique per level in the fixture).
function byLabel(nodes: { label: string }[], label: string) {
  return nodes.find((n) => n.label === label);
}

suite('SectionsTreeProvider', () => {
  let provider: SectionsTreeProvider;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    provider = new SectionsTreeProvider(extensionUri());
  });

  test('roots are the workspace folder group', async () => {
    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 1, 'one top-level group for the flat fixture workspace');
    const group = roots[0];
    assert.strictEqual(group.kind, 'group');
    assert.strictEqual(group.groupKind, 'folder');
    assert.ok(group.hasChildren, 'the folder group is expandable');
  });

  test('the folder group contains the three fixture files', async () => {
    const [group] = await provider.getChildren();
    const children = await provider.getChildren(group);
    const labels = children.map((c) => c.label).sort();
    assert.deepStrictEqual(labels, ['binary.sldd', 'data.sldd', 'model.slx']);

    assert.strictEqual(byLabel(children, 'binary.sldd')!.kind, 'sldd');
    assert.strictEqual(byLabel(children, 'data.sldd')!.kind, 'sldd');
    assert.strictEqual(byLabel(children, 'model.slx')!.kind, 'model');
  });

  test('the model surfaces an unresolved reference and an External Data group', async () => {
    const [group] = await provider.getChildren();
    const children = await provider.getChildren(group);
    const model = byLabel(children, 'model.slx')!;
    assert.ok(model.hasChildren, 'model.slx is expandable');

    const modelChildren = await provider.getChildren(model);
    const missing = byLabel(modelChildren, 'plant.slx');
    assert.ok(missing, 'the missing model reference (plant.slx) is present');
    assert.strictEqual(missing!.kind, 'missing');

    const external = byLabel(modelChildren, 'External Data');
    assert.ok(external, 'the External Data group is present');
    assert.strictEqual(external!.kind, 'group');
  });

  test('getTreeItem for a real file: collapsible off, open command, file contextValue', async () => {
    const [group] = await provider.getChildren();
    const children = await provider.getChildren(group);
    const item = provider.getTreeItem(byLabel(children, 'data.sldd')!);

    assert.strictEqual(item.label, 'data.sldd');
    assert.strictEqual(item.contextValue, 'slddFile');
    assert.ok(item.command, 'a real file row carries an open command');
    assert.strictEqual(item.command!.command, 'dataExplorer.openFile');
    // data.sldd has an empty reference list, so it is a leaf (not collapsible).
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('getTreeItem for a folder group: expandable, group contextValue, no command', async () => {
    const [group] = await provider.getChildren();
    const item = provider.getTreeItem(group);
    assert.strictEqual(item.contextValue, 'dexFolderGroup');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.strictEqual(item.command, undefined, 'a folder group is a directory: no file to open');
  });

  // A PROJECT group header is the one group row that is also a file — the `.prj` — and it
  // opens to the project page. The fixture workspace is deliberately project-free (every
  // other test here reads it as one folder group), so the .prj arrives for the length of
  // this test and leaves again: a permanent one would re-shape the tree for every suite
  // that reads this workspace.
  test('getTreeItem for a project group: opens the .prj, which is the project page', async () => {
    const prj = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'ClickProj.prj');
    await vscode.workspace.fs.writeFile(prj, Buffer.from('<?xml version="1.0"?>\n<Project/>\n'));
    try {
      // `findFiles` runs a fresh search, but this file is milliseconds old: poll on a fresh
      // provider instead of asserting the first answer, so a slow search service reads as
      // slow rather than as a missing feature.
      let fresh = new SectionsTreeProvider(extensionUri());
      let group = (await fresh.getChildren()).find((r) => r.groupKind === 'project');
      const deadline = Date.now() + 20000;
      while (!group) {
        assert.ok(Date.now() < deadline, 'timed out waiting for ClickProj.prj to reach the tree');
        await new Promise((r) => setTimeout(r, 100));
        fresh = new SectionsTreeProvider(extensionUri());
        group = (await fresh.getChildren()).find((r) => r.groupKind === 'project');
      }

      assert.strictEqual(group.label, 'ClickProj', 'labelled by project name, not file name');
      const item = fresh.getTreeItem(group);
      assert.strictEqual(item.contextValue, 'dexProjectGroup');
      assert.ok(item.command, 'the project header carries an open command');
      assert.strictEqual(item.command!.command, 'dataExplorer.openFile');
      assert.strictEqual(
        (item.command!.arguments![0] as vscode.Uri).toString(),
        prj.toString(),
        'and opens the .prj itself',
      );
      assert.ok(item.tooltip, 'and says what clicking it does');
      // Still a container: the members are reachable and the page is reachable.
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    } finally {
      await vscode.workspace.fs.delete(prj, { useTrash: false });
    }
  });

  test('a project header left over from an earlier graph offers no open', async () => {
    await provider.getChildren(); // prime the uri map from the real folder
    const item = provider.getTreeItem({
      kind: 'group',
      groupKind: 'project',
      groupKey: '/gone',
      uriString: 'file:///gone/Old.prj',
      label: 'Old',
      ancestors: new Set<string>(),
      cycle: false,
      hasChildren: false,
    });
    assert.strictEqual(item.contextValue, 'dexProjectGroup');
    assert.strictEqual(item.command, undefined, 'no open for a .prj that is not in the folder');
  });

  test('getTreeItem for a missing reference: warning icon, no open command', async () => {
    const [group] = await provider.getChildren();
    const model = byLabel(await provider.getChildren(group), 'model.slx')!;
    const missing = byLabel(await provider.getChildren(model), 'plant.slx')!;
    const item = provider.getTreeItem(missing);

    assert.strictEqual(item.contextValue, 'slddMissing');
    assert.strictEqual(item.description, 'unresolved reference');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.ok(item.iconPath instanceof vscode.ThemeIcon, 'missing rows use a ThemeIcon (warning)');
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'warning');
  });

  test('an open, dirty document badges its tree row as modified via the resourceUri query', async () => {
    const ws = vscode.workspace.workspaceFolders![0];
    const uri = vscode.Uri.joinPath(ws.uri, 'data.sldd');

    // Open and dirty the document so healthOf() reports "modified".
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    try {
      await editor.edit((eb) => eb.insert(new vscode.Position(0, 0), ' '));
      assert.ok(doc.isDirty, 'the document is dirty');

      const [group] = await provider.getChildren();
      const node = byLabel(await provider.getChildren(group), 'data.sldd')!;
      const item = provider.getTreeItem(node);
      assert.ok(item.resourceUri, 'a modified row carries a resourceUri');
      assert.ok(
        item.resourceUri!.query.includes(`${HEALTH_QUERY}=modified`),
        `expected a modified health query, got "${item.resourceUri!.query}"`,
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('refresh() fires the change event and leaves the graph queryable', async () => {
    await provider.getChildren(); // prime the cached graph
    let fired = false;
    const sub = provider.onDidChangeTreeData(() => (fired = true));
    provider.refresh();
    sub.dispose();
    assert.ok(fired, 'refresh emits onDidChangeTreeData');

    // The graph is still queryable — refresh() re-renders from the one it has, and
    // rebuild() is what re-reads the folder (see treeRefreshKeepsGraph).
    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 1);
  });
});
