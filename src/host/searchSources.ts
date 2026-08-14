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
import { filterEntries } from './searchFilter.js';
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

// Cap on how many matches we hand to the QuickPick at once. The QuickPick list
// has NO virtual scrolling (unlike the table), so pushing the whole index — tens
// of thousands of entries for a large data source — makes it open and filter
// sluggishly. We do our own filtering on each keystroke and show at most this
// many results; a broad query is truncated with a hint rather than dumped whole.
const MAX_RESULTS = 500;

function toItem(rec: NameRecord): EntryItem {
  return {
    label: rec.name,
    description: rec.sourceLabel,
    iconPath: themeIconFor(iconIdForKind(rec.kind)),
    entry: rec,
  };
}

// Show the search overlay. `listEntries` supplies the (lazily built) name index;
// `reveal` opens the entry's source and selects the row. Both are injected so
// this module stays free of the index/editor wiring (that lives in extension.ts).
//
// The list starts EMPTY and populates only as the user types: we filter the
// in-memory index ourselves and set `qp.items` to the (capped) matches, rather
// than handing the entire index to the un-virtualized QuickPick.
export async function searchDataSources(
  listEntries: () => Promise<NameRecord[]>,
  reveal: (sourceUri: string, entryName: string) => void | Promise<void>,
): Promise<void> {
  const qp = vscode.window.createQuickPick<EntryItem>();
  qp.title = 'Search Data Source Entries';
  qp.placeholder = 'Type to search entries by name across all data sources';
  qp.matchOnDescription = true;
  // We supply already-filtered items, so don't let the QuickPick filter again on
  // top of our results (it would hide matches whose label doesn't literally
  // contain the query in order).
  qp.matchOnDetail = false;

  let records: NameRecord[] = [];

  // Recompute the visible items for the current query. Empty query → empty list
  // (nothing shown until the user types). Otherwise case-insensitive substring
  // match on the entry name and its source label, capped at MAX_RESULTS.
  const refresh = (): void => {
    qp.items = filterEntries(records, qp.value, MAX_RESULTS).map(toItem);
  };

  qp.onDidChangeValue(refresh);
  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (picked) void reveal(picked.entry.sourceUri, picked.entry.name);
  });
  qp.onDidHide(() => qp.dispose());

  qp.busy = true;
  qp.show();
  try {
    records = await listEntries();
    records.sort(
      (a, b) => a.name.localeCompare(b.name) || a.sourceLabel.localeCompare(b.sourceLabel),
    );
  } finally {
    qp.busy = false;
  }
  // The user may have typed while the index was loading; render now that it's in.
  refresh();
}
