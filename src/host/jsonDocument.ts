// Copyright 2026 The MathWorks, Inc.
//
// The JSON dictionary editor's document: view's JSON dictionary engine (data-explorer-view/host
// `JsonEngine`), which holds what belongs to the document rather than to one of its tables (the
// Status column's baseline, where it came from, the file's stamp, every table's repaint), with VS
// Code's end of every hook it takes. One engine per open document, shared by its tables and made by
// the first of them (perDocument.ts), as the editor's own document state was.
//
// The text is the TextDocument's (textDocumentStore.ts): its edits are WorkspaceEdits, its undo,
// redo, dirty state, save, revert, reload and hot-exit backup VS Code's own. The tree is read into
// the registry over core's module-level session (`defaultRegistry`), where the Property Inspector,
// the other editors and extension.ts's keystroke invalidate find it. Notices are notifications, the
// registers are this extension's (hubRegisters.ts), the Usage column is the workspace's usage graph.
import * as vscode from 'vscode';
import type { Notify } from 'data-explorer-view/model';
import { JsonEngine, defaultRegistry } from 'data-explorer-view/host';
import { hubRegisters } from './hubRegisters.js';
import { PerDocument } from './perDocument.js';
import { textDocumentStore, type TextDocumentApi } from './textDocumentStore.js';
import { annotateDataRows, annotateDataRowsNow } from './usageGraph.js';
import { subscribeUsageRepost } from './usageRepostWatch.js';

/** A notice of the engine's, said as VS Code says one (the JSON engine says only a transfer's warning). */
const notify: Notify = (notice) => {
  if (notice.level === 'warning') void vscode.window.showWarningMessage(notice.message);
  else if (notice.level === 'error') void vscode.window.showErrorMessage(notice.message);
  else if (notice.ms === undefined) vscode.window.setStatusBarMessage(notice.message);
  else vscode.window.setStatusBarMessage(notice.message, notice.ms);
};

/** VS Code's end of a TextDocument's text: a WorkspaceEdit, the workspace's document events, Undo and Redo. */
const textApi = (document: vscode.TextDocument): TextDocumentApi<vscode.Position> => ({
  applyEdit: (replacements) => {
    const edit = new vscode.WorkspaceEdit();
    for (const r of replacements) edit.replace(document.uri, new vscode.Range(r.start, r.end), r.text);
    return vscode.workspace.applyEdit(edit);
  },
  onDidChangeTextDocument: (listener) => vscode.workspace.onDidChangeTextDocument(listener),
  onDidSaveTextDocument: (listener) => vscode.workspace.onDidSaveTextDocument(listener),
  undo: () => void vscode.commands.executeCommand('undo'),
  redo: () => void vscode.commands.executeCommand('redo'),
  reasons: { undo: vscode.TextDocumentChangeReason.Undo, redo: vscode.TextDocumentChangeReason.Redo },
});

const engines = new PerDocument<JsonEngine>();

function engineOf(document: vscode.TextDocument, name: string): JsonEngine {
  const uri = document.uri.toString();
  return new JsonEngine({
    registry: defaultRegistry,
    uri,
    name,
    text: textDocumentStore(document, textApi(document)),
    registers: hubRegisters(),
    notify,
    usage: {
      fill: (rows) => annotateDataRows(uri, rows),
      fillNow: (rows) => annotateDataRowsNow(uri, rows),
    },
    // A model created or deleted in the workspace can add or remove a block that uses one of the
    // document's entries (usageRepostWatch.ts).
    usageReposts: { subscribe: (repost, busy) => subscribeUsageRepost(repost, busy) },
    // The file behind the document, for its baseline: its stamp and its bytes, or null when they
    // cannot be had.
    disk: {
      stat: async () => {
        try {
          const stat = await vscode.workspace.fs.stat(document.uri);
          return { mtime: stat.mtime, size: stat.size };
        } catch {
          return null;
        }
      },
      read: async () => {
        try {
          return await vscode.workspace.fs.readFile(document.uri);
        } catch {
          return null;
        }
      },
    },
    // The editor posts a paint's rows, then in the same run what follows them and its own drain.
    trailerAfterDelivery: true,
  });
}

/**
 * A table of `document`, named `name`, until its `close()`: the document's engine, made by its first
 * table, and closed with its last. `changed` is called after every repaint of this table, once its
 * rows are sent (the provider's own onChanged).
 */
export function openJsonTable(
  document: vscode.TextDocument,
  name: string,
  changed: () => void,
): { table: ReturnType<JsonEngine['view']>; close(): void } {
  const held = engines.open(document.uri.toString(), () => engineOf(document, name));
  const table = held.value.view({ changed });
  return {
    table,
    close: () => {
      // Its registers, its listeners and its hold on the tree; with the last table the document's
      // source deleter and its baseline, and then the engine.
      table.dispose();
      held.close();
    },
  };
}
