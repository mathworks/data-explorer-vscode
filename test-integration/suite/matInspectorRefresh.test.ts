// Copyright 2026 The MathWorks, Inc.
//
// The Property Inspector and a MAT-file whose selected variable changes under it, inside real
// VS Code — the MAT-file editor's half of what binarySlddInspectorRefresh.test.ts holds the binary
// .sldd editor to.
//
// The inspector is handed a node when a row is selected, and builds its rows from it once. A
// MAT-file's tree is its document, and an edit changes the variable in place, so an inspector that
// was told only of a reload went on showing the value from before every edit, undo and redo until
// the user clicked another row. The provider now says whenever the tree changed (`onChanged`): a
// gesture, a paste, a move out of the file, an undo or a redo, a revert and a reload. extension.ts
// answers it with the inspector's one re-resolve (inspectorSelection.ts), as it answers the binary
// editor's. There is no route to the registered provider here (activate() returns no API), so this
// test wires its own provider to its own InspectorSelection the way activate() does.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel } from 'data-explorer-core';
import { MatEditorProvider } from '../../src/host/MatEditorProvider';
import { InspectorSelection } from '../../src/host/inspectorSelection';
import { buildPropertyGroups } from '../../src/host/piBuilder';
import { findNode } from '../../src/host/SlddModel';
import { clearClipboard } from '../../src/host/clipboard';
import { ctx, fakePanel, quiet, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ctx().extensionUri.fsPath, 'test-integration', 'fixtures', 'mat', name)));

/** The Value the inspector's rows say for `node`. */
const valueOf = (node: any): string | undefined =>
  buildPropertyGroups(node)
    .flatMap((g) => g.properties)
    .find((p) => p.name === 'Value')?.value;

suite('MAT-file: the Property Inspector follows the variable it shows', () => {
  let dir: string;
  let provider: MatEditorProvider;
  /** Every node the inspector was asked to show, with the Value its rows said then; null for a clear. */
  let shown: ({ node: any; value: string | undefined } | null)[];
  /** Every document the provider said changed. */
  let changed: string[];
  const opened: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];
  const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-matpi-'));
    provider = new MatEditorProvider(ctx());
    shown = [];
    changed = [];
    edits.length = 0;
    // As activate() wires the registered provider.
    const selection = new InspectorSelection(
      { showNode: (node) => void shown.push({ node, value: valueOf(node) }), clear: () => void shown.push(null) },
      findNode,
    );
    provider.onSelect = (uriString, rowIds) => selection.show(uriString, rowIds);
    provider.onChanged = (uriString) => {
      changed.push(uriString);
      selection.refresh(uriString);
    };
    provider.onDidChangeCustomDocument((e) => edits.push(e));
  });

  teardown(async () => {
    for (const { doc, view } of opened.splice(0)) {
      view.close();
      doc.dispose();
    }
    clearClipboard();
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  async function open(name: string, as = name) {
    const path = join(dir, as);
    writeFileSync(path, fixture(name));
    const uri = vscode.Uri.file(path);
    const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    opened.push({ doc, view });
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor(`${as}'s first rows`, () => view.posts.some((p) => p.type === 'setRows'));
    const variable = (n: string): any => {
      const found = (DataModel.getDataSource(doc.srcId) as any)?.children.find((v: any) => v.name === n);
      assert.ok(found, `${as} holds ${n}`);
      return found;
    };
    return { path, uri, doc, view, variable };
  }

  /** What the inspector shows now: the Value of the node it was last asked to show. */
  const showing = (): string | undefined => {
    const last = shown[shown.length - 1];
    assert.ok(last, 'the inspector shows a node');
    return last.value;
  };
  const showingNode = (): any => shown[shown.length - 1]?.node;

  test('an edit, its undo and its redo of the shown variable each show its value as it now is', async () => {
    const o = await open('cases.mat');
    o.view.send({ type: 'select', rowIds: [o.variable('scalarD').id] });
    const was = showing();
    assert.strictEqual(was, '3.141592653589793');
    o.view.send({ type: 'edit', rowId: o.variable('scalarD').id, columnId: 'Value', oldValue: '', newValue: '42' });
    assert.strictEqual(showing(), '42', 'the edit');
    await edits[edits.length - 1].undo();
    assert.strictEqual(showing(), was, 'its undo');
    await edits[edits.length - 1].redo();
    assert.strictEqual(showing(), '42', 'its redo');
    assert.strictEqual(showingNode(), o.variable('scalarD'), 'from the node the session holds now');
  });

  test('a paste into the file, and a move of the shown variable out of it, each say the tree changed', async () => {
    const a = await open('pv_basic.mat', 'a.mat');
    const b = await open('pv_basic.mat', 'b.mat');
    a.view.send({ type: 'select', rowIds: [a.variable('x').id] });
    changed.length = 0;
    a.view.send({ type: 'copy', rowIds: [a.variable('str').id] });
    a.view.send({ type: 'paste', rowId: '' });
    await waitFor('the paste', () => changed.includes(a.uri.toString()));
    assert.strictEqual(showingNode(), a.variable('x'), 'the shown variable, shown again from the tree');

    changed.length = 0;
    a.view.send({ type: 'cut', rowIds: [a.variable('x').id] });
    b.view.send({ type: 'paste', rowId: '' });
    await waitFor('the move out of a.mat', () => changed.includes(a.uri.toString()));
    assert.ok(changed.includes(b.uri.toString()), 'and the paste into b.mat');
    assert.ok(!shown.includes(null), 'a variable gone is left to the table, not cleared here');
  });

  test('a revert and a reload from disk each show the node the document holds after it', async () => {
    const o = await open('cases.mat');
    o.view.send({ type: 'select', rowIds: [o.variable('scalarD').id] });
    o.view.send({ type: 'edit', rowId: o.variable('scalarD').id, columnId: 'Value', oldValue: '', newValue: '42' });
    await provider.saveCustomDocument(o.doc, token());
    o.view.send({ type: 'edit', rowId: o.variable('scalarD').id, columnId: 'Value', oldValue: '', newValue: '7' });
    assert.strictEqual(showing(), '7');
    await provider.revertCustomDocument(o.doc, token());
    assert.strictEqual(showing(), '42', 'the revert');
    assert.strictEqual(showingNode(), o.variable('scalarD'), 'from the tree the revert registered');

    // Another program writes the file; the clean document follows it (diskFollow.ts). Touched
    // until the watcher, which starts asynchronously, has seen it.
    writeFileSync(o.path, fixture('cases.mat'));
    let next = 0;
    await waitFor('the inspector to show the value the file now holds', () => {
      if (showing() === '3.141592653589793') return true;
      if (Date.now() >= next) {
        const later = new Date(statSync(o.path).mtimeMs + 1000);
        utimesSync(o.path, later, later);
        next = Date.now() + 400;
      }
      return false;
    });
    assert.strictEqual(showingNode(), o.variable('scalarD'));
  });
});
