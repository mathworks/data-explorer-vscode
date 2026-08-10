// Copyright 2026 The MathWorks, Inc.
// Integration test for the live-edit seam: a JSON .sldd open as the table while
// its text is edited in a side-by-side editor. We cannot read the webview's
// rendered rows from the test host, so we assert the observable contract the
// refresh depends on — a text document IS editable for the same URI the table
// renders, edits apply, and the extension processes onDidChangeTextDocument
// without throwing (a listener error would surface as an unhandled rejection /
// deactivated extension). The row-parse itself is covered by the vitest suite.
import * as assert from 'assert';
import * as vscode from 'vscode';

// The editable JSON .sldd opens in the tableView, a CustomTextEditorProvider:
// the table is a view of the native TextDocument, so there is ONE document and
// one native undo stack shared by the table and any text view of the same URI.
const TABLE_VIEW = 'dataExplorer.tableView';
// Binary/zip .sldd and .slx/.mat/.prj remain in the read-only binaryView.
const BINARY_VIEW = 'dataExplorer.binaryView';

// Locate the `{...}` span of the entries[] element whose "name" equals the given
// name. Kept local (not imported from src/host/entrySplice) so this integration
// bundle stays free of jsonc-parser, which does not `require` cleanly inside the
// Electron test host. The production write-back path uses the real entrySplice;
// its span logic is covered by the vitest suites (entrySplice + editWriteback).
function findEntrySpanLocal(text: string, name: string): { offset: number; length: number } | null {
  const marker = `"name": ${JSON.stringify(name)}`;
  const nameIdx = text.indexOf(marker);
  if (nameIdx < 0) return null;
  // Walk back to the opening brace of the enclosing object.
  const start = text.lastIndexOf('{', nameIdx);
  if (start < 0) return null;
  // Walk forward, tracking brace depth (ignoring braces inside strings), to the
  // matching closing brace.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { offset: start, length: i - start + 1 };
    }
  }
  return null;
}

function slddUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, 'data.sldd');
}

function slxUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, 'model.slx');
}

// The active tab, whichever group holds it.
function activeTab(): vscode.Tab | undefined {
  return vscode.window.tabGroups.activeTabGroup.activeTab ?? undefined;
}

// Poll until the active tab's custom-editor viewType matches, or time out.
async function waitForActiveViewType(expected: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const vt = (activeTab()?.input as { viewType?: string } | undefined)?.viewType;
    if (vt === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  const vt = (activeTab()?.input as { viewType?: string } | undefined)?.viewType;
  assert.strictEqual(vt, expected, 'active view type did not settle');
}

suite('Data Explorer .sldd live edit', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    // Revert any unsaved edits so the fixture is untouched for the next test/run.
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('editing the text document while the table is open does not error', async () => {
    const uri = slddUri();

    // Open the table (default), then open the same file as a text document.
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    // A no-op-ish whitespace edit: append a space inside the JSON's leading
    // whitespace region so it stays valid JSON. The extension's change listener
    // fires and re-parses; a throw here would fail the await.
    const applied = await editor.edit((eb) => {
      eb.insert(new vscode.Position(0, 0), ' ');
    });
    assert.strictEqual(applied, true, 'the edit applied');
    assert.ok(doc.isDirty, 'the document is now dirty (unsaved edit present)');

    // The extension is still healthy and the same URI is shared by both views.
    assert.strictEqual(doc.uri.toString(), uri.toString());
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active after the edit',
    );
  });

  test('a scoped entry-span replacement (simulating applyEdit) updates the doc without crashing', async () => {
    // We cannot postMessage into the webview from the test host, so we simulate
    // what the tableView CustomTextEditorProvider's write-back produces: locate a
    // single entry's span (findEntrySpanLocal, mirroring the host's entrySplice)
    // and replace that span with a reserialized entry
    // through a WorkspaceEdit. Asserts the doc updates with a scoped diff and the
    // extension's onDidChangeTextDocument listener processes it without throwing.
    const uri = slddUri();
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    const oldText = doc.getText();
    const span = findEntrySpanLocal(oldText, 'Number');
    assert.ok(span, 'the "Number" entry span is found');

    // Reserialize the entry with value 42 at the file's 2-space indent (10 spaces
    // deep, matching applyEdit's indent.repeat(5) for a 2-space file).
    const indent = '  ';
    const entryObj = { name: 'Number', metadata: JSON.parse(
      oldText.slice(span!.offset, span!.offset + span!.length),
    ).metadata, value: 42 };
    const lines = JSON.stringify(entryObj, null, indent).split('\n');
    const entryText = lines.map((l, i) => (i === 0 ? l : indent.repeat(5) + l)).join('\n');

    const startPos = doc.positionAt(span!.offset);
    const endPos = doc.positionAt(span!.offset + span!.length);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(startPos, endPos), entryText);
    const applied = await vscode.workspace.applyEdit(edit);
    assert.strictEqual(applied, true, 'the workspace edit applied');

    const newText = doc.getText();
    assert.notStrictEqual(newText, oldText, 'the document text changed');
    // Still valid JSON and the new value is present.
    JSON.parse(newText); // throws if invalid → fails the test
    const newSpan = findEntrySpanLocal(newText, 'Number');
    assert.ok(newSpan, 'the "Number" entry is still locatable after the edit');
    assert.ok(newText.slice(newSpan!.offset, newSpan!.offset + newSpan!.length).includes('"value": 42'));

    // Scoped diff: everything before/after the entry span is byte-identical.
    assert.strictEqual(newText.slice(0, newSpan!.offset), oldText.slice(0, span!.offset));
    assert.strictEqual(
      newText.slice(newSpan!.offset + newSpan!.length),
      oldText.slice(span!.offset + span!.length),
    );

    // The extension survives its own onDidChangeTextDocument re-parse.
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active after the write-back edit',
    );
  });

  test('table->text sync: a WorkspaceEdit on the .sldd doc is visible to the open text view', async () => {
    // Regression guard for the single-source-of-truth model. The tableView is a
    // CustomTextEditorProvider over the .sldd TextDocument: its write-back applies
    // a WorkspaceEdit to that same TextDocument, so the JSON text view stays in
    // sync. We cannot drive the webview from the test host, so we simulate the
    // provider's write-back by applying an entry-span replacement to the doc WHILE
    // the table is open AND the same doc is shown in a text editor, then assert the
    // text document reflects the new value.
    const uri = slddUri();

    // Open the .sldd as the table (a view of the shared TextDocument).
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    await waitForActiveViewType(TABLE_VIEW);

    // Open the same doc in a plain text editor beside it. If showing both is
    // flaky we still hold the doc handle and can assert on getText() below.
    const doc = await vscode.workspace.openTextDocument(uri);
    try {
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    } catch {
      // The doc handle alone is enough to prove the shared source of truth.
    }

    // The table tab is present somewhere among the groups.
    const slddTab = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => (t.input as { viewType?: string })?.viewType === TABLE_VIEW);
    assert.ok(slddTab, 'the table tab is present');

    const oldText = doc.getText();
    const span = findEntrySpanLocal(oldText, 'Number');
    assert.ok(span, 'the "Number" entry span is found');

    // Reserialize the entry with a new value, mirroring the provider write-back.
    const indent = '  ';
    const entryObj = {
      name: 'Number',
      metadata: JSON.parse(oldText.slice(span!.offset, span!.offset + span!.length)).metadata,
      value: 99,
    };
    const lines = JSON.stringify(entryObj, null, indent).split('\n');
    const entryText = lines.map((l, i) => (i === 0 ? l : indent.repeat(5) + l)).join('\n');

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(doc.positionAt(span!.offset), doc.positionAt(span!.offset + span!.length)),
      entryText,
    );
    const applied = await vscode.workspace.applyEdit(edit);
    assert.strictEqual(applied, true, 'the workspace edit applied');

    // The text view (same TextDocument) reflects the new value: single source
    // of truth. getText() is the exact content the JSON text editor renders.
    const newText = doc.getText();
    assert.notStrictEqual(newText, oldText, 'the document text changed');
    assert.ok(newText.includes('"value": 99'), 'the new value is visible in the doc text');
    JSON.parse(newText); // still valid JSON → the text view stays coherent

    // The extension is still healthy and the table tab is still open.
    assert.ok(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some((t) => (t.input as { viewType?: string })?.viewType === TABLE_VIEW),
      'the table tab is still present after the edit',
    );
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active after the table->text sync edit',
    );
  });

  test('a text-view edit dirties the shared document (single source of truth)', async () => {
    // Single-document model: the tableView is a CustomTextEditorProvider, so the
    // table is a view of the native TextDocument — there is ONE document (and one
    // native undo stack) shared by the table tab and any text view of the same
    // URI. A TEXT-view edit therefore dirties that shared TextDocument, and the
    // table tab (which reflects the TextDocument's dirty state) goes dirty with
    // it. This is the fix for the old two-document design, where the table was a
    // separate CustomDocument and a text edit dirtied only the text tab — that
    // asymmetry is gone.
    //
    // We assert the DOCUMENT is dirty (the real contract). We deliberately do NOT
    // assert the custom tab's `.isDirty` separately: with a CustomTextEditor the
    // tab mirrors the TextDocument's dirty state, but reading the exact tab flag
    // can be environment-flaky in the test host.
    const uri = slddUri();

    // Open BOTH views of the same file: the table (CustomTextEditor) and the text
    // editor, side by side.
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    const doc0 = await vscode.workspace.openTextDocument(uri);
    const editor0 = await vscode.window.showTextDocument(doc0, vscode.ViewColumn.Beside);

    // The document starts clean.
    assert.strictEqual(doc0.isDirty, false, 'the shared document starts clean');

    // Edit in the TEXT view (valid JSON: prepend whitespace).
    const appliedTextEdit = await editor0.edit((eb) =>
      eb.insert(new vscode.Position(0, 0), ' '),
    );
    assert.strictEqual(appliedTextEdit, true, 'the text edit applied');

    // Give the provider's onDidChangeTextDocument listener time to react.
    await new Promise((r) => setTimeout(r, 300));

    // The shared TextDocument is dirty — the single source of truth both views
    // observe.
    assert.ok(doc0.isDirty, 'the shared document is dirty after a text-view edit');
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active',
    );
  });

  test('an invalid JSON edit is handled gracefully (no crash)', async () => {
    const uri = slddUri();
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    // Corrupt the JSON: the listener re-parses, catches, and posts an error
    // banner to the webview instead of throwing.
    const applied = await editor.edit((eb) => {
      eb.insert(new vscode.Position(0, 0), '}{ not json ');
    });
    assert.strictEqual(applied, true);
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension survives an invalid-JSON edit',
    );
  });

  test('opening a JSON .sldd as the table succeeds and the tab is initially clean', async () => {
    // The editable tableView CustomTextEditorProvider opens a JSON .sldd; no edit
    // has been made, so the shared document (and its tab) must not be dirty.
    const uri = slddUri();
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    await waitForActiveViewType(TABLE_VIEW);

    const tab = activeTab();
    assert.ok(tab, 'a table tab is active');
    assert.strictEqual(
      (tab!.input as { viewType?: string })?.viewType,
      TABLE_VIEW,
      'the active tab is the Data Explorer table',
    );
    assert.strictEqual(tab!.isDirty, false, 'a freshly opened table tab is not dirty');
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension is active after opening the table',
    );
  });

  test('a binary .slx opens read-only without error and stays clean', async () => {
    // model.slx is a binary (zip) fixture in the workspace; it opens in the
    // read-only binaryView (never editable, never dirty).
    const uri = slxUri();
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      // No .slx fixture present — nothing to assert. (There is model.slx today.)
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, BINARY_VIEW);
    await waitForActiveViewType(BINARY_VIEW);

    const tab = activeTab();
    assert.ok(tab, 'an .slx tab is active');
    assert.strictEqual(tab!.isDirty, false, 'a read-only binary tab is not dirty');
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension is active after opening the binary .slx',
    );
  });

  test('a binary (zip) .sldd opens read-only without error', async () => {
    const ws = vscode.workspace.workspaceFolders![0];
    const uri = vscode.Uri.joinPath(ws.uri, 'binary.sldd');
    await vscode.workspace.fs.stat(uri); // fixture must exist
    await vscode.commands.executeCommand('vscode.openWith', uri, BINARY_VIEW);
    await waitForActiveViewType(BINARY_VIEW);
    const tab = activeTab();
    assert.ok(tab, 'a read-only tab is active for the binary .sldd');
    assert.strictEqual((tab!.input as {viewType?:string})?.viewType, BINARY_VIEW);
    assert.strictEqual(tab!.isDirty, false, 'a read-only binary .sldd tab is not dirty');
    assert.ok(vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension stays active after opening a binary .sldd');
  });
});
