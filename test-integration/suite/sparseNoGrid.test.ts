// Copyright 2026 The MathWorks, Inc.
// A sparse array is offered no Variable Editor grid in any editor that opens one, and a dense
// array of the same shape still is — asserted on what the providers actually post.
//
// data-explorer-core 1.36.3 holds a sparse array as its non-zeros and has no grid for one: its
// `displayElements()` answers null, and `isSparse` is true. A row's glyph is stamped from
// matrixPayload's gate WITHOUT building the cells, so a gate that did not ask `isSparse` left a
// glyph on every 2-D sparse array that opened onto "This value could not be read as a table."
// The unit suite has that rule over stubs and parsed nodes (matrixPayload.test.ts,
// sparseNoGrid.test.ts); this is the part only a real host can say: the rows each provider
// hands its webview, and its answer to the `requestMatrix` a glyph click sends, through the
// three editors and four formats a sparse array arrives in.
//
// The fixtures are data-explorer-core's MATLAB-written reference files (its
// test/fixtures/sparse at v1.36.2, made by make_sparse_fixtures.m there), in
// test-integration/fixtures/sparse — beside the workspace folder, so findFiles never returns
// them and they cannot move the workspace-wide counts other suites assert. Every sparse
// variable sits beside a dense twin of the same class and shape.
//
// The no-grid tests need core 1.36.3 and are skipped on an older core, where a sparse array
// has no `isSparse` and its grid still opens. The dense tests run on any core.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { MatEditorProvider } from '../../src/host/MatEditorProvider';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { ctx, fakePanel, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

function fixtureUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'sparse', name);
}

// The core this run is linked against. `test:integration` builds the extension and bundles
// this file from node_modules immediately before it runs, so the package on disk there is the
// core under test — a tarball installed over the pin included.
function coreVersion(): string {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  const pkg = join(ext!.extensionPath, 'node_modules', 'data-explorer-core', 'package.json');
  const version = String(JSON.parse(readFileSync(pkg, 'utf8')).version);
  // Unreadable is an error, not "older": read as older it would skip the tests that matter.
  assert.match(version, /^\d+\.\d+\.\d+/, `a readable data-explorer-core version (${version})`);
  return version;
}

function atLeast(version: string, min: string): boolean {
  const have = version.split(/[.-]/).slice(0, 3).map(Number);
  const want = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
}

// 2-D, within the grid's size cap, and sparse: class and shape alone would admit each. Paths
// are by Name label from the entry down; a Parameter's grid would sit on its entry row, which
// shows the Value's literal, and on its Value row.
const SPARSE = [
  'spAllZero', 'spBig', 'spComplex', 'spDiag', 'spLogical', 'spNonFinite', 'spSingle',
  'pSp', 'pSp/Value', 'pSpComplex', 'pSpComplex/Value', 'pSpLogical', 'pSpLogical/Value',
  'st/sp',
];

// The dense twins, same classes and shapes, with the cell count of each grid.
const DENSE: Record<string, number> = {
  dAllZero: 12, dComplex: 12, dDiag: 100, dLogical: 6, dNonFinite: 4, dSingle: 6,
  pDense: 9, 'pDense/Value': 9,
};

interface Opened {
  view: ReturnType<typeof fakePanel>;
  dispose: () => void;
}

// Each format through the editor the extension opens it in. The text dictionary is a
// TextDocument; the others are custom documents.
const VENUES: { file: string; open: (uri: vscode.Uri) => Promise<Opened> }[] = [
  { file: 'sparse_values.mat', open: (uri) => openCustom(new MatEditorProvider(ctx()), uri) },
  { file: 'sparse_ws.slx', open: (uri) => openCustom(new BinaryEditorProvider(ctx()), uri) },
  { file: 'sparse_binary.sldd', open: (uri) => openCustom(new BinarySlddEditorProvider(ctx()), uri) },
  {
    file: 'sparse_text.sldd',
    open: async (uri) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      const view = fakePanel();
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
      return { view, dispose: () => view.close() };
    },
  },
];

async function openCustom(provider: any, uri: vscode.Uri): Promise<Opened> {
  const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  await provider.resolveCustomEditor(doc, view.panel, token());
  return {
    view,
    dispose: () => {
      view.close();
      doc.dispose?.();
    },
  };
}

/** The rows of the first whole-table paint, driven the way the webview drives it. */
async function paint(view: Opened['view']): Promise<any[]> {
  view.send({ type: 'ready' });
  await waitFor('the table paint', () => view.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
  const failed = view.posts.find((p) => p.type === 'error');
  assert.ok(!failed, `the tab posted an error: ${failed?.message}`);
  return view.posts.find((p) => p.type === 'setRows').rows;
}

/** The provider's answer to a glyph click on the row with this id. */
async function fetchMatrix(view: Opened['view'], nodeId: string): Promise<any> {
  const answered = () => view.posts.find((p) => p.type === 'matrixCells' && p.nodeId === nodeId);
  view.send({ type: 'requestMatrix', nodeId });
  await waitFor(`the matrixCells answer for ${nodeId}`, () => !!answered());
  return answered();
}

// Each row by its path of Name labels from the entry down. Section headers are not part of a
// path; a .mat has none.
function rowsByPath(rows: any[]): Map<string, any> {
  const byId = new Map(rows.map((r) => [r.ID, r]));
  const pathOf = (row: any): string => {
    const parent = byId.get(row.parent);
    const label = String(row.Name?.label ?? row.Name);
    return parent && !String(parent.ID).startsWith('section:') ? `${pathOf(parent)}/${label}` : label;
  };
  const out = new Map<string, any>();
  for (const row of rows) if (!String(row.ID).startsWith('section:')) out.set(pathOf(row), row);
  return out;
}

suite('a sparse array is offered no Variable Editor grid', () => {
  let opened: Opened | undefined;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    opened?.dispose();
    opened = undefined;
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('the fixtures are outside the workspace, so findFiles never returns them', async () => {
    const found = await vscode.workspace.findFiles('**/*.{slx,mdl,sldd,mat}');
    for (const { file } of VENUES) {
      const uri = fixtureUri(file);
      await vscode.workspace.fs.stat(uri); // the fixture must exist
      assert.ok(!found.some((u) => u.toString() === uri.toString()), `${file} must not be discoverable via findFiles`);
    }
  });

  for (const venue of VENUES) {
    test(`${venue.file}: no sparse row carries a glyph, and a click on one fetches no grid (core >= 1.36.3)`, async function () {
      if (!atLeast(coreVersion(), '1.36.3')) this.skip();
      opened = await venue.open(fixtureUri(venue.file));
      const rows = rowsByPath(await paint(opened.view));
      // The rows are there; only the glyph is not.
      for (const path of SPARSE) assert.ok(rows.get(path), `${venue.file} has a row for ${path}`);
      // EXACTLY the dense twins carry one: no sparse row, and nothing else either.
      const stamped = [...rows].filter(([, r]) => r._matrix).map(([p]) => p).sort();
      assert.deepStrictEqual(stamped, Object.keys(DENSE).sort(), `${venue.file}: the rows with a grid glyph`);
      // A fetch for a sparse row — a panel opened just before a repaint, say — answers with the
      // reason and no cells, from the same gate the glyph comes from. Asked by row ID, so the
      // dense twin asked the same way is the control: it shows the ID names a node this
      // provider finds, and the refusal is the gate's rather than a failed lookup.
      const control = await fetchMatrix(opened.view, rows.get('dDiag').ID);
      assert.strictEqual(control.matrix?.cells?.length, 100, `${venue.file}: dDiag fetched by its row ID`);
      for (const path of ['spDiag', 'pSp']) {
        const answer = await fetchMatrix(opened.view, rows.get(path).ID);
        assert.strictEqual(answer.matrix, undefined, `${venue.file}: ${path} fetched no grid`);
        assert.strictEqual(answer.message, 'This value could not be read as a table.');
      }
    }).timeout(60000);

    test(`${venue.file}: every dense twin carries its glyph, and a click on it fetches every cell`, async () => {
      opened = await venue.open(fixtureUri(venue.file));
      const rows = rowsByPath(await paint(opened.view));
      for (const [path, cells] of Object.entries(DENSE)) {
        const row = rows.get(path);
        assert.ok(row?._matrix, `${venue.file}: ${path} carries a grid glyph`);
        const answer = await fetchMatrix(opened.view, row._matrix.nodeId);
        assert.strictEqual(answer.matrix?.cells?.length, cells, `${venue.file}: ${path} fetched its ${cells} cells`);
      }
    }).timeout(60000);
  }
});
