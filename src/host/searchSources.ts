// Copyright 2026 The MathWorks, Inc.
// Global search over ENTRY NAMES inside data sources — the named entries a
// Simulink data source contains (dictionary/MAT variables, model-workspace
// params, block signals). This is deliberately scoped:
//   - NOT file names — VS Code's built-in Search panel / quick-open covers those.
//   - NOT cell values — each table's in-tab search covers those.
// It's presented as a QuickPick overlay (not a tree/view) so it never competes
// with the built-in Search view for panel real estate: it pops up, resolves, and
// dismisses on accept.
import * as vscode from 'vscode';
import type { NameRecord, EntryKind } from './nameIndex.js';
import { themeIconFor } from './iconMap.js';

// Per-kind dex icon id, mapped to a ThemeIcon via themeIconFor. Chosen to echo
// how each kind renders elsewhere in the extension.
const ICON_ID_BY_KIND: Record<EntryKind, string> = {
  sldd: 'wsDefault',
  mat: 'wsNumeric',
  workspace: 'wsParameters',
  block: 'wsSignal',
};

function iconIdForKind(kind: EntryKind): string {
  return ICON_ID_BY_KIND[kind];
}

// A QuickPick item that carries its originating NameRecord so onDidAccept can
// resolve the picked entry back to its source file + entry name.
interface EntryItem extends vscode.QuickPickItem {
  entry: NameRecord;
}

// Show the search overlay. `listEntries` supplies the (lazily built) name index;
// `reveal` opens the entry's source and selects the row. Both are injected so
// this module stays free of the index/editor wiring (that lives in extension.ts).
export async function searchDataSources(
  listEntries: () => Promise<NameRecord[]>,
  reveal: (sourceUri: string, entryName: string) => void | Promise<void>,
): Promise<void> {
  const qp = vscode.window.createQuickPick<EntryItem>();
  qp.title = 'Search Data Source Entries';
  qp.placeholder = 'Search entries by name across all data sources';
  qp.matchOnDescription = true;

  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (picked) void reveal(picked.entry.sourceUri, picked.entry.name);
  });
  qp.onDidHide(() => qp.dispose());

  qp.busy = true;
  qp.show();
  try {
    const records = await listEntries();
    records.sort(
      (a, b) => a.name.localeCompare(b.name) || a.sourceLabel.localeCompare(b.sourceLabel),
    );
    qp.items = records.map((rec) => ({
      label: rec.name,
      description: rec.sourceLabel,
      iconPath: themeIconFor(iconIdForKind(rec.kind)),
      entry: rec,
    }));
  } finally {
    qp.busy = false;
  }
}
