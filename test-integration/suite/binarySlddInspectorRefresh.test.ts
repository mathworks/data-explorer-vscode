// Copyright 2026 The MathWorks, Inc.
//
// The Property Inspector and a compressed-binary .sldd whose selected entry changes under it,
// inside real VS Code.
//
// The inspector is handed a node when a row is selected, and builds its rows from it once. An
// edit, an undo or a redo, a save, a revert and a reload from disk each leave the table showing
// nodes rebuilt under the same ids, and the inspector went on showing the one it was handed, so
// it said a value the table no longer did until the user clicked another row. The provider now
// says when the document's tree changed (`onChanged`), and extension.ts answers that with the
// inspector's one re-resolve (src/host/inspectorSelection.ts, unit-tested on its own), as it
// answers the MAT-file editor's `onReplaced`. There is no route to the registered provider here
// (activate() returns no API), so this test wires its own provider to its own InspectorSelection
// the way activate() does, and reads what the inspector was asked to show.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { unzipSync, zipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { InspectorSelection } from '../../src/host/inspectorSelection';
import { buildPropertyGroups } from '../../src/host/piBuilder';
import { findNode } from '../../src/host/SlddModel';
import { ctx, fakePanel, quiet, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 'data/chunk0.xml';
/** MATLAB-written, 40 entries; `scalarD` is a double, 3.14. */
const PARAMS = ['test', 'parity', 'artifacts', 'binary', 'params.sldd'];

/** The Value the inspector's rows say for `node`. */
const valueOf = (node: any): string | undefined =>
  buildPropertyGroups(node)
    .flatMap((g) => g.properties)
    .find((p) => p.name === 'Value')?.value;

suite('Binary .sldd: the Property Inspector follows the entry it shows', () => {
  let dir: string;
  let path: string;
  let uri: vscode.Uri;
  let fixture: Uint8Array;
  let provider: BinarySlddEditorProvider;
  let doc: any;
  let view: ReturnType<typeof fakePanel>;
  const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
  /**
   * Every node the inspector was asked to show, with the Value its rows said, read when it was
   * asked, as PropertiesViewProvider builds its rows; null for a clear.
   */
  let shown: ({ node: any; value: string | undefined } | null)[];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    fixture = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ctx().extensionUri, ...PARAMS));
  });

  setup(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dex-binpi-'));
    path = join(dir, 'params.sldd');
    uri = vscode.Uri.file(path);
    writeFileSync(path, fixture);
    provider = new BinarySlddEditorProvider(ctx());
    shown = [];
    edits.length = 0;
    // As activate() wires the registered provider.
    const selection = new InspectorSelection(
      { showNode: (node) => void shown.push({ node, value: valueOf(node) }), clear: () => void shown.push(null) },
      findNode,
    );
    provider.onSelect = (uriString, rowIds) => selection.show(uriString, rowIds);
    provider.onChanged = (uriString) => selection.refresh(uriString);
    provider.onDidChangeCustomDocument((e) => edits.push(e));
    doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    view = fakePanel();
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first rows', () => view.posts.some((p) => p.type === 'setRows'));
  });

  teardown(async () => {
    view.close();
    doc.dispose();
    await quiet(200, 'the disposed watcher to stop watching before its directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  const entry = (name: string): any => {
    const found = (DataModel.getDataSource(doc.srcId) as any)?.children
      .flatMap((s: any) => s.children)
      .find((e: any) => e.name === name);
    assert.ok(found, `the document's model holds ${name}`);
    return found;
  };
  /** What the inspector shows now: the Value of the node it was last asked to show. */
  const showing = (): string | undefined => {
    const last = shown[shown.length - 1];
    assert.ok(last, 'the inspector shows a node');
    return last.value;
  };
  /** The node the inspector was last asked to show. */
  const showingNode = (): any => shown[shown.length - 1]?.node;
  const select = (name: string) => view.send({ type: 'select', rowIds: [entry(name).id] });
  const setValue = (name: string, value: string) =>
    view.send({ type: 'edit', rowId: entry(name).id, columnId: 'Value', oldValue: '', newValue: value });

  test('an edit, its undo and its redo of the shown entry each show its value as it now is', async () => {
    select('scalarD');
    assert.strictEqual(showing(), '3.14');
    setValue('scalarD', '42');
    assert.strictEqual(showing(), '42', 'the edit');
    edits[edits.length - 1].undo();
    assert.strictEqual(showing(), '3.14', 'its undo');
    edits[edits.length - 1].redo();
    assert.strictEqual(showing(), '42', 'its redo');
    assert.strictEqual(showingNode(), entry('scalarD'), 'from the node the session holds now');
  });

  test('a save, a revert and a reload from disk each show the node the document holds after it', async () => {
    select('scalarD');
    setValue('scalarD', '42');
    await provider.saveCustomDocument(doc, token());
    assert.strictEqual(showingNode(), entry('scalarD'), 'the save re-registered the tree, and the inspector its node');
    assert.strictEqual(showing(), '42');

    setValue('scalarD', '7');
    assert.strictEqual(showing(), '7');
    await provider.revertCustomDocument(doc, token());
    assert.strictEqual(showing(), '42', 'the revert');
    assert.strictEqual(showingNode(), entry('scalarD'));

    // Another program writes the file; the clean document follows it (diskFollow.ts). Touched
    // until the watcher, which starts asynchronously, has seen it: see binarySlddOutsideChange.
    const zip = unzipSync(new Uint8Array(await vscode.workspace.fs.readFile(uri)));
    const saved = new TextDecoder().decode(zip[CHUNK]);
    const changed = saved.replace(
      /(<P Name="Name" Class="char">scalarD<\/P>[\s\S]*?<P Name="Value" Class="double">)[^<]*</,
      (_, head: string) => `${head}5<`,
    );
    assert.notStrictEqual(changed, saved, 'the outside write changes scalarD');
    zip[CHUNK] = new TextEncoder().encode(changed);
    const outside = zipSync(zip, { level: 6 });
    writeFileSync(path, outside);
    let next = 0;
    await waitFor('the inspector to show the value the file now holds', () => {
      if (showing() === '5') return true;
      if (Date.now() >= next) {
        const later = new Date(statSync(path).mtimeMs + 1000);
        utimesSync(path, later, later);
        next = Date.now() + 400;
      }
      return false;
    });
    assert.strictEqual(showingNode(), entry('scalarD'));
  });

  test('a delete of the shown entry leaves the inspector to the table, which reports the selection that follows', async () => {
    select('scalarD');
    const before = shown.length;
    view.send({ type: 'delete', rowIds: [entry('scalarD').id] });
    assert.ok(!chunkHas(doc, 'scalarD'), 'the entry is gone');
    assert.ok(!shown.slice(before).includes(null), 'not cleared here: the table says what is selected next');
    const landing = view.posts.filter((p) => p.type === 'selectRows').pop();
    assert.ok(landing, 'and the table is told which row to select');
  });

  test('an edit of another entry shows the selected one again, unchanged', async () => {
    select('scalarD');
    setValue('negD', '1');
    assert.strictEqual(showing(), '3.14');
    assert.strictEqual(showingNode(), entry('scalarD'));
  });
});

const chunkHas = (doc: any, name: string): boolean => (doc.chunkXml as string).includes(`>${name}<`);
