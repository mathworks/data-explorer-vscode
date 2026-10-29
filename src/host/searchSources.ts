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
import { MAX_SEARCH_RESULTS, searchEntries, sortNameRecords, type SearchItem } from 'data-explorer-view/model';
import type { NameRecord } from './nameIndex.js';
import { themeIconFor } from './iconMap.js';

// A QuickPick item that carries its originating NameRecord so onDidAccept can
// resolve the picked entry back to its source file + entry name.
interface EntryItem extends vscode.QuickPickItem {
  entry: NameRecord;
  revealName: string;
}

// What each match says is view's (`searchItem`: the name, a block's path and the file, the icon
// its kind shows, the name a pick reveals), so a search in an app reads as this one does. What is
// VS Code's is the icon: view names one of its icons, and the QuickPick draws a ThemeIcon for it.
//
// Capped at MAX_SEARCH_RESULTS (500): the QuickPick list has NO virtual scrolling (unlike the
// table), so pushing the whole index — tens of thousands of entries for a large data source —
// makes it open and filter sluggishly. We do our own filtering on each keystroke and show at
// most that many results; a broad query is truncated rather than dumped whole.
function toItem(item: SearchItem): EntryItem {
  return {
    label: item.label,
    description: item.description,
    iconPath: themeIconFor(item.iconId),
    entry: item.entry,
    revealName: item.revealName,
  };
}

// Show the search overlay. `listEntries` supplies the (lazily built) name index;
// `reveal` opens the entry's source and selects the row, and is handed the record's
// `selectName` when it has one — a block travels as its SID, which is what the row
// publishes and not what it prints. Both are injected so this module stays free of the
// index/editor wiring (that lives in extension.ts).
//
// The list starts EMPTY and populates only as the user types: we filter the
// in-memory index ourselves and set `qp.items` to the (capped) matches, rather
// than handing the entire index to the un-virtualized QuickPick.
export async function searchDataSources(
  listEntries: () => Promise<NameRecord[]>,
  reveal: (sourceUri: string, selectName: string) => void | Promise<void>,
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
  // match on the entry name and its source label, capped at MAX_SEARCH_RESULTS.
  const refresh = (): void => {
    qp.items = searchEntries(records, qp.value, MAX_SEARCH_RESULTS).map(toItem);
  };

  qp.onDidChangeValue(refresh);
  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (picked) void reveal(picked.entry.sourceUri, picked.revealName);
  });
  qp.onDidHide(() => qp.dispose());

  qp.busy = true;
  qp.show();
  try {
    records = sortNameRecords(await listEntries());
  } finally {
    qp.busy = false;
  }
  // The user may have typed while the index was loading; render now that it's in.
  refresh();
}
