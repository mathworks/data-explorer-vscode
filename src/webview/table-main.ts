// Copyright 2026 The MathWorks, Inc.
import '../dex/styles/global.css';
import './vscode-theme.css';
import '../dex/components/dex-tree-table.js';
import '../dex/components/dex-context-menu.js';
import '../dex/components/dex-error-dialog.js';
import { nextExpandedIds } from './rowUpdates.js';
import { buildContextMenuItems, shouldShowContextMenu, shouldOpenCellEditor, resolveShortcutAction, type ClipboardState, type MenuRow } from './menuItems.js';
import { dropDecision, type DragMode, type DropTarget, type DragSource } from './dropDecision.js';
import type { SectionRule } from '../host/sectionRules.js';
import type { DragDescriptor } from '../host/dragState.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const table = document.querySelector('dex-tree-table') as any;
const contextMenu = document.querySelector('dex-context-menu') as any;
const errorDialog = document.querySelector('dex-error-dialog') as any;

// Menu state cached from host messages so the menu builds synchronously on
// right-click (no round-trip): whether the doc is editable, and clipboard state.
let editable = false;
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
  let sectionName: string | null = null;
  if (rowId.indexOf('section:') === 0) {
    sectionName = rowId.slice('section:'.length);
  } else {
    const row = (table.rows ?? []).find((r: { ID: string; parent?: string | null }) => r.ID === rowId);
    const parent = row?.parent;
    if (typeof parent === 'string' && parent.indexOf('section:') === 0) {
      sectionName = parent.slice('section:'.length);
    }
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
  const rows = (table.rows ?? []) as { ID: string; Name?: { label?: string } }[];
  const match = rows.find((r) => r.Name?.label === pendingSelectName);
  if (!match) return;
  table.selectedRowIds = [match.ID];
  vscode.postMessage({ type: 'select', rowIds: [match.ID] });
  pendingSelectName = null;
}

// Hide the initial loading spinner. The host runs a synchronous parse (and, on
// first open, a whole-workspace usage-graph scan) before it can post the first
// message, so this covers the several-second gap between 'ready' and 'setRows'.
// Called on the first payload (setRows) or on error — either ends the wait.
function hideLoading(): void {
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

// Persistent, informational read-only banner (e.g. a JSON .sldd too large to
// edit). Distinct from the transient red #dex-error. The table fills the panel
// (position:absolute;inset:0), so when the banner is shown we offset the table's
// top by the banner's measured height — measured, not hardcoded, so it stays
// correct when the message wraps at narrow widths. Only the read-only binary
// view renders #dex-notice; in the editable table view it's absent and this
// no-ops.
function setNotice(message: string | undefined): void {
  const el = document.getElementById('dex-notice');
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.style.display = 'block';
    // Offset after layout so offsetHeight reflects the (possibly wrapped) banner.
    requestAnimationFrame(() => {
      table.style.top = el.offsetHeight + 'px';
    });
  } else {
    el.textContent = '';
    el.style.display = 'none';
    table.style.top = '';
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === 'setRows') {
    hideLoading();
    clearError();
    // Persistent read-only notice (size-limited JSON .sldd). Undefined for the
    // editable table view and for expected-read-only binary .sldd, so it hides.
    setNotice(typeof msg.notice === 'string' ? msg.notice : undefined);
    const rows = msg.rows ?? [];
    editable = !!msg.editable;
    table.columns = msg.columns ?? null;
    table.columnLabels = msg.columnLabels ?? null;
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
    // The host has already re-posted setRows, so the cell reverted to its
    // previous value before this dialog appears.
    errorDialog?.show({
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
      if (!editable) return;
      const selected = Array.isArray(table.selectedRowIds) ? table.selectedRowIds : [];
      const rowId = selected[0];
      // Section rows carry no owning entry; the host would reject them, so skip.
      if (typeof rowId !== 'string' || rowId.startsWith('section:')) return;
      ev.preventDefault();
      ev.stopPropagation();
      vscode.postMessage({ type: 'locateInText', rowId });
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
    if (action !== 'paste' && rowId.startsWith('section:')) return;
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
  const items = buildContextMenuItems(row, clipboardState, editable);
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
