// Copyright 2026 The MathWorks, Inc.
//
// A closed tab gives its tree back.
//
// Every tab registers the tree it shows in core's session under its own uri, and SlddModel
// caches the same tree beside it. Neither was ever released for the two views that register under
// the bare uri: `BinaryDocument.dispose()` was empty, and the text editor's last-view teardown
// cleared its baseline and its deleter but not its source. So every file opened in a window stayed
// parsed until the window closed.
//
// The decision lives in the providers' dispose closures, which import `vscode`, so the unit suite
// can only test the count those closures call (slddModel.test.ts). Here the real providers are
// driven, through the same fake panel the other host tests use, and what is asserted is the
// session itself. Each fixture is a copy in tmpdir, outside the workspace folder, so the
// extension's own watchers and folder scans never see it.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel } from 'data-explorer-core';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { parsedModelForTab } from '../../src/host/sourceReads';
import { ctx, fakePanel, quiet, token, waitFor, ws } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const painted = (posts: any[]): boolean => posts.some((p) => p?.type === 'setRows');

suite('a closed tab releases what it registered', () => {
  let dir: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-release-'));
  });

  teardown(() => rmSync(dir, { recursive: true, force: true }));

  /** A copy of a workspace fixture in this test's tmpdir. */
  const copyOf = (fixture: string, as: string): vscode.Uri => {
    const path = join(dir, as);
    copyFileSync(vscode.Uri.joinPath(ws(), fixture).fsPath, path);
    return vscode.Uri.file(path);
  };

  test('a read-only document releases its source when VS Code disposes it', async () => {
    const uri = copyOf('model.slx', 'released.slx');
    const provider = new BinaryEditorProvider(ctx());
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first rows', () => painted(view.posts));
    assert.ok(DataModel.hasDataSource(uri.toString()), 'the open tab registered its model');

    // The PANEL closing is not the document closing: VS Code keeps the document while any
    // other editor holds it, and disposes it after the last one.
    view.close();
    assert.ok(DataModel.hasDataSource(uri.toString()), 'still registered while the document is alive');

    doc.dispose();
    assert.ok(!DataModel.hasDataSource(uri.toString()), 'the disposed document released its model');
  });

  test('a read that finishes after its document closed registers nothing and paints nothing', async () => {
    const uri = copyOf('model.slx', 'late.slx');
    const provider = new BinaryEditorProvider(ctx());
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    await provider.resolveCustomEditor(doc, view.panel, token());
    // The read starts on 'ready' and is asynchronous; the tab closes before it can land.
    view.send({ type: 'ready' });
    view.close();
    doc.dispose();

    // Wait for the read itself rather than for a time. The tab's read is the shared parse of
    // this model, so asking for the same parse here resolves once that one has; everything the
    // provider does between that parse and registering it is synchronous, so a macrotask after
    // it is past the point where the registration would have happened.
    await parsedModelForTab(uri);
    await quiet(200, 'a registration or a paint by the read that finished after its tab closed');
    assert.ok(
      !DataModel.hasDataSource(uri.toString()),
      'the late read did not re-register a model whose tab is gone',
    );
    assert.ok(!painted(view.posts), 'and did not paint a closed tab');
  });

  test('a text table releases its source when its last view closes, and not before', async () => {
    const uri = copyOf('data.sldd', 'two_views.sldd');
    const doc = await vscode.workspace.openTextDocument(uri);
    // ONE provider for both panels, as the extension registers exactly one.
    const provider = new SlddTextEditorProvider(ctx());

    const first = fakePanel();
    await provider.resolveCustomTextEditor(doc, first.panel, token());
    first.send({ type: 'ready' });
    await waitFor('the first tab’s rows', () => painted(first.posts));
    const second = fakePanel();
    await provider.resolveCustomTextEditor(doc, second.panel, token());
    second.send({ type: 'ready' });
    await waitFor('the second tab’s rows', () => painted(second.posts));
    assert.ok(DataModel.hasDataSource(uri.toString()), 'the open document registered its dictionary');

    first.close();
    assert.ok(
      DataModel.hasDataSource(uri.toString()),
      'a split panel closing leaves the dictionary to the one still showing it',
    );

    second.close();
    assert.ok(!DataModel.hasDataSource(uri.toString()), 'the last view closing released the dictionary');
  });

  test('a read-only document closing does not take the source from an open text table', async () => {
    // Both register under the SAME srcId (a JSON .sldd over the sync limit lands in the read-only
    // view; "Reopen Editor With" moves between the two), so one count covers both providers.
    const uri = copyOf('data.sldd', 'shared.sldd');
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = new SlddTextEditorProvider(ctx());
    const view = fakePanel();
    await text.resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the table’s rows', () => painted(view.posts));

    // Opened and disposed without a panel: resolving one would redirect a JSON .sldd this small
    // to the editable view for real, and the document's lifetime is the whole subject.
    const binary = new BinaryEditorProvider(ctx());
    const other = await binary.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    other.dispose();
    // Twice, which must still count once: a second release would spend the text table's hold.
    other.dispose();
    assert.ok(DataModel.hasDataSource(uri.toString()), 'the text table still holds the dictionary');

    view.close();
    assert.ok(!DataModel.hasDataSource(uri.toString()), 'and gives it up when it closes');
  });
});
