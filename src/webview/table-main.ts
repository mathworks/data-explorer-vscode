// Copyright 2026 The MathWorks, Inc.
import './components/styles/global.css';
import './vscode-theme.css';
import './components/dex-tree-table.js';
import './components/dex-context-menu.js';
import './components/dex-error-dialog.js';
import './components/dex-variable-editor.js';
import { installMatrixOpen } from './matrixOpen.js';
import { renderBanners } from './banners.js';
import { nextExpandedIds, spliceEntryRows } from './rowUpdates.js';
import { buildContextMenuItems, shouldShowContextMenu, shouldOpenCellEditor, resolveShortcutAction, type ClipboardState, type MenuRow } from './menuItems.js';
import { dropDecision, type DragMode, type DropTarget, type DragSource } from './dropDecision.js';
import type { SectionRule } from '../host/sectionRules.js';
import type { DragDescriptor } from '../host/dragState.js';
import { isSectionRowId, sectionNameFromRowId } from '../common/sectionRowId.js';
import type { HostToTableMessage } from '../common/protocol.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

// Markup owns the CONTENT element, because only the shell knows where the table
// sits on screen. This module owns every OVERLAY, because none of them has a
// place in the shell's layout — each is a self-positioning, initially hidden
// popover appended to <body>.
//
// This split is not a style preference. The webview HTML is assembled as a string
// by three separate host providers (SlddTextEditorProvider,
// BinarySlddEditorProvider, BinaryEditorProvider), so any tag required in markup
// is one rule spread over three paths — and a provider that misses it produces a
// null here, i.e. a crash or a silently dead feature in that view only.
// BinaryEditorProvider had exactly that: no <dex-error-dialog>, so save errors
// never surfaced there. Creating them here makes the shells interchangeable.
const table = document.querySelector('dex-tree-table') as any;

function overlay(tag: string): any {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el as any;
}

const contextMenu = overlay('dex-context-menu');
const errorDialog = overlay('dex-error-dialog');
// The Variable Editor: a glyph in a matrix Value cell asks for a grid. The table
// is the event source because the glyph lives inside its shadow tree.
const variableEditor = overlay('dex-variable-editor');
const matrixOpen = installMatrixOpen(table, variableEditor);

// Menu state cached from host messages so the menu builds synchronously on
// right-click (no round-trip): whether the doc is editable, and clipboard state.
let editable = false;
// Whether the document has a plain-text view "Location in Text" can reveal a row
// in (JSON .sldd yes, compressed-binary .sldd no). Gates that menu item + Cmd+L.
let hasTextView = false;
let clipboardState: ClipboardState = { canPaste: false, mode: null };
// The row id under the last right-click, relayed with the chosen action.
let lastContextRowId: string | null = null;

// This document's uri + its section drop-rules, shipped by the host with each
// setRows. Together with the broadcast drag descriptor they let the predictor
// run dropDecision entirely client-side on dragover (no host round-trip).
let docUri = '';
let sectionRulesList: SectionRule[] = [];
// The in-flight drag broadcast from the host (null when no drag is active).
// Because a drag can originate in another webview, this — not local
// dataTransfer — is the authoritative source of what is being dragged.
let dragDescriptor: DragDescriptor | null = null;

// Resolve the section a row belongs to: a section header (`section:<name>`) is
// that section; a data row carries its section via its `parent` (also a header
// id). Returns the matching SectionRule, or null if it can't be resolved.
function sectionRuleForRow(rowId: string): SectionRule | null {
  let sectionName = sectionNameFromRowId(rowId);
  if (sectionName == null) {
    const row = (table.rows ?? []).find((r: { ID: string; parent?: string | null }) => r.ID === rowId);
    const parent = row?.parent;
    if (typeof parent === 'string') sectionName = sectionNameFromRowId(parent);
  }
  if (sectionName == null) return null;
  return sectionRulesList.find((r) => r.sectionName === sectionName) ?? null;
}

// The predictor injected into the table: given the row under the cursor and the
// drag mode, run the pure dropDecision against the broadcast drag descriptor and
// this document's section rules. Returns null when there's no active drag or the
// target section can't be resolved, so the table falls back to default behavior.
function predictDrop(
  targetRowId: string,
  mode: DragMode,
): { canDrop: boolean; cursor: string; tooltip: string; noop: boolean } | null {
  if (!dragDescriptor) return null;
  const rule = sectionRuleForRow(targetRowId);
  if (!rule) return null;
  const source: DragSource = {
    docUri: dragDescriptor.docUri,
    sectionName: dragDescriptor.sectionName,
    sectionLabel: dragDescriptor.sectionLabel,
    isDerived: dragDescriptor.isDerived,
    items: dragDescriptor.items,
  };
  const target: DropTarget = {
    docUri,
    sectionName: rule.sectionName,
    sectionLabel: rule.sectionLabel,
    isDerived: rule.isDerived,
    allowedTypes: rule.allowedTypes,
  };
  return dropDecision(source, target, mode);
}

// A row id the host asked us to select once it exists in the table. Set on a
// rename (the row's id changes, so the old selection is stale); applied as soon
// as a matching row is present, otherwise held until the rebuilt rows arrive.
let pendingSelectId: string | null = null;

function applyPendingSelection(): void {
  if (!pendingSelectId) return;
  const rows = (table.rows ?? []) as { ID: string }[];
  if (!rows.some((r) => r.ID === pendingSelectId)) return;
  table.selectedRowIds = [pendingSelectId];
  // Keep the host (Property Inspector) in sync with the re-selected row.
  vscode.postMessage({ type: 'select', rowIds: [pendingSelectId] });
  pendingSelectId = null;
}

// A name a navigation asked us to select once its row exists. Set on a cross-tab
// Usage-link click (the target is identified by name — block or variable — not
// by hierarchical id); applied as soon as a matching row is present, else held
// until rows arrive. Setting selectedRowIds makes the table expand ancestors and
// scroll the row into view.
let pendingSelectName: string | null = null;

function applyPendingNameSelection(): void {
  if (!pendingSelectName) return;
  const rows = (table.rows ?? []) as { ID: string; Name?: { label?: string }; _blockKey?: string }[];
  // Two grammars share this one channel. A variable target (and a block in a file
  // written before SIDs existed) is a NAME and matches the Name label; a block
  // target is core's block KEY — the SID — which is not printed anywhere, so it is
  // matched against the `_blockKey` the row publishes. Without that second pass a
  // `blocks:65@f14.slx` click would open the model and select nothing, since the
  // row it means reads `<SID: 65>`. Name first, so every pre-SID target keeps its
  // existing answer when a same-spelled key also exists.
  const match =
    rows.find((r) => r.Name?.label === pendingSelectName) ??
    rows.find((r) => r._blockKey === pendingSelectName);
  if (!match) return;
  table.selectedRowIds = [match.ID];
  vscode.postMessage({ type: 'select', rowIds: [match.ID] });
  pendingSelectName = null;
}

// Loading spinner, shown only if the first payload is slow to arrive. The host
// runs a synchronous parse (and, on first open, a whole-workspace usage-graph
// scan) before it can post 'setRows', which can take several seconds on a large
// file. Rather than flash a spinner on every open, we arm a timer at boot and
// reveal the overlay only if that gap exceeds the delay below; a fast open hides
// the (never-shown) overlay and cancels the timer, so it never flashes. The
// webview renderer runs this timer independently of the busy extension host.
const LOADING_SPINNER_DELAY_MS = 500;
let loadingTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
  loadingTimer = undefined;
  const el = document.getElementById('dex-loading');
  if (el) el.style.display = 'flex';
}, LOADING_SPINNER_DELAY_MS);

// Cancel the pending reveal and hide the overlay. Called on the first payload
// (setRows) or on error — either ends the wait.
function hideLoading(): void {
  if (loadingTimer !== undefined) {
    clearTimeout(loadingTimer);
    loadingTimer = undefined;
  }
  const el = document.getElementById('dex-loading');
  if (el) el.style.display = 'none';
}

function showError(message: string): void {
  const el = document.getElementById('dex-error');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}
function clearError(): void {
  const el = document.getElementById('dex-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

// Hand a new row array to the table and re-derive everything that depends on it.
//
// Shared by the two repaint messages — the whole-table `setRows` and the
// entry-scoped `updateEntryRows` — because every rule here is about ROWS and none
// of them is about how many arrived. Written once so the narrow path cannot drift
// from the wide one: an entry-scoped repaint that forgot to invalidate
// `_visibleRowsCache`, or to re-apply a pending selection, would be a bug visible
// only after an edit and only on one of the two paths.
function installRows(rows: any[]): void {
  // Preserve the current selection across the rebuild if the row still exists.
  // EVERY repaint (value edit, structural edit, text-view edit, undo, redo)
  // arrives here, so this is what keeps selection stable through all of them.
  const prevSelected: string[] = Array.isArray(table.selectedRowIds) ? table.selectedRowIds : [];
  const prevExpanded: Set<string> | null = table._expandedIds instanceof Set ? table._expandedIds : null;
  table.rows = rows;
  // Preserve expansion (keep still-existing expanded ids); default to
  // sections-only on first load. Never collapse the tree under the user.
  table._expandedIds = nextExpandedIds(prevExpanded, rows);
  table._visibleRowsCache = null;
  const present = new Set(rows.map((r: { ID: string }) => r.ID));
  const stillSelected = prevSelected.filter((id) => present.has(id));
  if (stillSelected.length > 0) table.selectedRowIds = stillSelected;
  if (typeof table.requestUpdate === 'function') table.requestUpdate();
  // A rename/structural edit posts selectRow then triggers this rebuild;
  // re-apply now that the row with the new id exists.
  applyPendingSelection();
  // A cross-tab navigation may be waiting for its target row to appear.
  applyPendingNameSelection();
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToTableMessage;
  if (msg.type === 'updateEntryRows') {
    // Entry-scoped repaint: splice this entry's rows over the run already on
    // screen. Nothing else about the view changes, so columns, banners, editable
    // and the section rules are all left exactly as the last setRows set them.
    const spliced = spliceEntryRows((table.rows ?? []) as any[], msg.entryRowId, msg.rows ?? []);
    if (!spliced) {
      // The table doesn't hold the entry the host repainted, so the two are out of
      // step and a splice would silently drop the edit. Ask for a full payload
      // instead — which is exactly what `ready` requests, and what every provider
      // already answers with post().
      vscode.postMessage({ type: 'ready' });
      return;
    }
    // Same reason setRows closes it: the grid is anchored to a cell in the rows
    // being replaced, and its anchor glyph may not survive the repaint.
    matrixOpen.close();
    // Only a SUCCEEDING edit repaints this narrowly (every failure path in the host
    // resyncs with a full setRows instead), so reaching here clears a banner left
    // over from an earlier failure — as setRows does, for the same reason.
    clearError();
    installRows(spliced);
  } else if (msg.type === 'setRows') {
    hideLoading();
    clearError();
    // Every row is about to be replaced, so an open grid describes a payload the
    // user can no longer see the source of — and its anchor glyph may not survive
    // the repaint. Close it rather than leave it floating over new data.
    matrixOpen.close();
    // The banner strip: the persistent read-only notice (size-limited JSON .sldd)
    // and what the parse could not read. Passed together because they stack in one
    // container whose total height the table is offset by; either can be absent,
    // and a payload carrying neither clears the strip.
    renderBanners(table, {
      notice: typeof msg.notice === 'string' ? msg.notice : undefined,
      warnings: msg.warnings,
    });
    const rows = msg.rows ?? [];
    editable = !!msg.editable;
    hasTextView = !!msg.hasTextView;
    table.columns = msg.columns ?? null;
    table.columnLabels = msg.columnLabels ?? null;
    table.columnGroups = (msg.columnGroups as Record<string, string> | undefined) ?? null;
    installRows(rows);
  } else if (msg.type === 'selectByName') {
    // Cross-tab navigation: select the row whose name matches (block or
    // variable). Apply now if present, else hold until the next setRows.
    pendingSelectName = typeof msg.name === 'string' ? msg.name : null;
    applyPendingNameSelection();
  } else if (msg.type === 'selectRow') {
    // Re-select a row by id (e.g. after a rename changed its id). Apply now if
    // the row is already present, else stash until the next setRows rebuild.
    pendingSelectId = typeof msg.rowId === 'string' ? msg.rowId : null;
    applyPendingSelection();
  } else if (msg.type === 'clipboardState') {
    clipboardState = { canPaste: !!msg.canPaste, mode: msg.mode ?? null };
  } else if (msg.type === 'sectionRules') {
    docUri = typeof msg.docUri === 'string' ? msg.docUri : docUri;
    sectionRulesList = Array.isArray(msg.rules) ? msg.rules : [];
  } else if (msg.type === 'dragState') {
    // The host broadcasts the in-flight drag (or null when it ends) to every
    // webview, so a drag started in another tab predicts correctly here.
    dragDescriptor = msg.descriptor ?? null;
  } else if (msg.type === 'error') {
    hideLoading();
    showError(msg.message);
  } else if (msg.type === 'validationError') {
    // Invalid cell edit: modal scoped to this webview (not the whole window).
    // The host follows this message with a repaint of the rejected row's entry, so
    // the cell is back to its previous value by the time the dialog is dismissed.
    errorDialog.show({
      title: 'Invalid Value',
      reason: msg.reason,
      invalidValue: msg.invalidValue,
      validValue: msg.previousValue,
    });
  }
});

// Read-only documents never open the inline cell editor. The vendored table
// opens it on double-click and on Enter, gating only on per-row flags (which we
// keep intact for cell coloring). Intercept both gestures in the CAPTURE phase
// — before they reach the component's shadow-internal handlers — and swallow
// them when the document is read-only. This is document-level (table) readonly,
// distinct from the row-level coloring flag.
table.addEventListener(
  'dblclick',
  (e: Event) => {
    if (!shouldOpenCellEditor(editable)) e.stopPropagation();
  },
  true,
);
table.addEventListener(
  'keydown',
  (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter' && !shouldOpenCellEditor(editable)) {
      e.stopPropagation();
    }
  },
  true,
);

// Cmd/Ctrl+L: jump to the selected row's location in the plain-text view — the
// keyboard equivalent of the "Location in Text" context-menu action. Gated on
// editable (read-only formats have no text view). Uses the same host message the
// menu dispatches, so the resolution path (row → owning entry → span) is shared.
table.addEventListener(
  'keydown',
  (e: Event) => {
    const ev = e as KeyboardEvent;
    if ((ev.key === 'l' || ev.key === 'L') && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
      // No text view (compressed-binary .sldd) → no "Location in Text" target.
      if (!editable || !hasTextView) return;
      const selected = Array.isArray(table.selectedRowIds) ? table.selectedRowIds : [];
      const rowId = selected[0];
      // Section rows carry no owning entry; the host would reject them, so skip.
      if (typeof rowId !== 'string' || isSectionRowId(rowId)) return;
      ev.preventDefault();
      ev.stopPropagation();
      vscode.postMessage({ type: 'locateInText', rowId });
    }
  },
  true,
);

// Cmd/Ctrl+F: focus the search/filter input above the table. The built-in
// webview find widget is not enabled for these panels, so this chord is free to
// claim. Pure client-side (no host round-trip) — just forward focus to the
// component's filter input. Skipped with modifiers we don't own (Shift/Alt).
table.addEventListener(
  'keydown',
  (e: Event) => {
    const ev = e as KeyboardEvent;
    if ((ev.key === 'f' || ev.key === 'F') && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      ev.stopPropagation();
      table.focusFilter?.();
    }
  },
  true,
);

// Cut/Copy/Paste/Delete keyboard shortcuts — the keyboard equivalents of the
// context-menu actions (whose labels advertise these chords). Enablement mirrors
// buildContextMenuItems exactly (same editable / clipboard / per-row-flag gates),
// so a shortcut can never do something the menu wouldn't. Capture phase, so it
// runs before the table component's own key handling; skipped while a cell
// editor or the filter input is focused (there the chord is text editing). The
// selected row is the target — copy/cut/delete/addChild carry its id; paste
// targets its owning section (host resolves that from the row id).
table.addEventListener(
  'keydown',
  (e: Event) => {
    if (!editable) return;
    const ev = e as KeyboardEvent;
    const action = resolveShortcutAction(ev);
    if (!action) return;

    // While typing in the inline cell editor or the column filter, C/X/V and
    // Delete/Backspace are text editing — let the field handle them natively.
    const active = (ev.composedPath?.()[0] as HTMLElement) ?? (ev.target as HTMLElement);
    const tag = active?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) {
      return;
    }

    const rowId = (Array.isArray(table.selectedRowIds) ? table.selectedRowIds : [])[0];
    // Every action needs a selected row. Paste accepts a section header (it
    // targets that section); the rest need a data row, since section headers
    // carry no capability flags.
    if (typeof rowId !== 'string') return;
    if (action !== 'paste' && isSectionRowId(rowId)) return;
    const row = (table.rows ?? []).find((r: MenuRow) => r.ID === rowId) ?? null;
    // Gate on the same capability the menu uses, so shortcuts match the menu.
    const enabled =
      action === 'copy'
        ? !!row?._canCopy
        : action === 'cut' || action === 'delete'
          ? !!row?._canDelete
          : /* paste */ clipboardState.canPaste;
    if (!enabled) return;

    ev.preventDefault();
    ev.stopPropagation();
    vscode.postMessage({ type: action, rowId });
  },
  true,
);

// Right-click: build the menu synchronously from the selected row's flags and
// the cached clipboard/editable state, then show it. The table component has
// already selected the row and prevented the native browser menu.
table.addEventListener('dex-table-context-menu', (e: Event) => {
  // Read-only documents (.mat/.slx/.prj, binary/zip .sldd) have no menu at all:
  // no cell editor and no right-click actions.
  if (!shouldShowContextMenu(editable)) return;
  const detail = (e as CustomEvent).detail;
  lastContextRowId = detail.rowId ?? null;
  const row = (table.rows ?? []).find((r: MenuRow) => r.ID === detail.rowId) ?? null;
  const items = buildContextMenuItems(row, clipboardState, editable, hasTextView);
  contextMenu.show(detail.x, detail.y, items);
});

// A menu item was chosen: relay it to the host. Undo/Redo are document-level
// (no row); the rest carry the right-clicked row id.
contextMenu.addEventListener('dex-action', (e: Event) => {
  const actionId = (e as CustomEvent).detail.actionId as string;
  if (actionId === 'undo' || actionId === 'redo') {
    vscode.postMessage({ type: actionId });
    return;
  }
  if (!lastContextRowId) return;
  vscode.postMessage({ type: actionId, rowId: lastContextRowId });
});

// Inject the drop predictor so the table can render live cursor + tooltip
// feedback on dragover (backed by the pure dropDecision + host-shipped rules).
table.dropPredictor = predictDrop;

// Drag lifecycle → host. On drag start the host snapshots the dragged rows into
// its drag register and broadcasts the descriptor; on end it clears + rebroad-
// casts; on drop it completes the move/copy as paste (+ source delete). All
// gated on editable so read-only views never initiate a structural drag.
table.addEventListener('dex-row-drag-start', (e: Event) => {
  if (!editable) return;
  const rowIds = (e as CustomEvent).detail?.rowIds ?? [];
  vscode.postMessage({ type: 'dragStart', rowIds });
});
table.addEventListener('dex-row-drag-end', () => {
  vscode.postMessage({ type: 'dragEnd' });
});
table.addEventListener('dex-row-drop', (e: Event) => {
  if (!editable) return;
  const detail = (e as CustomEvent).detail;
  vscode.postMessage({ type: 'drop', rowId: detail.targetRowId, mode: detail.mode });
});

// Relay row selection to the host (for PI + tree sync in later phases).
table.addEventListener('dex-row-selected', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  vscode.postMessage({ type: 'select', rowIds: detail.rowIds ?? [] });
});

// A Usage-column link was clicked. The target tab isn't this webview, so relay
// the raw target to the host, which opens the referenced file and selects the
// row there (see navigate.ts). Cross-tab navigation is host-mediated because
// each table is its own webview (unlike the vendored dex-app's in-page nav).
table.addEventListener('dex-link-clicked', (e: Event) => {
  const target = (e as CustomEvent).detail?.target;
  if (typeof target === 'string') vscode.postMessage({ type: 'navigate', target });
});

// Relay committed cell edits to the host for write-back into the JSON text.
table.addEventListener('dex-edit-completed', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  vscode.postMessage({
    type: 'edit',
    rowId: detail.rowId,
    columnId: detail.columnId,
    oldValue: detail.oldValue,
    newValue: detail.newValue,
  });
});

vscode.postMessage({ type: 'ready' });
