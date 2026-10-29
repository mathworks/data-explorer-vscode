// Copyright 2026 The MathWorks, Inc.
import 'data-explorer-view/theme.css';
import './webview-page.css';
import './vscode-theme.css';
import {
  connectTable,
  defineTreeTable,
  buildContextMenuItems,
  shouldShowContextMenu,
  shouldOpenCellEditor,
  resolveShortcutAction,
  type ClipboardState,
  type MenuRow,
} from 'data-explorer-view/tree-table';
import { defineContextMenu, type ContextMenuItem } from 'data-explorer-view/context-menu';
import { defineErrorDialog } from 'data-explorer-view/error-dialog';
import { defineVariableEditor } from 'data-explorer-view/variable-editor';
import { setIconBase } from 'data-explorer-view/icon';
import { renderBanners, renderError } from './banners.js';
import {
  messageSource,
  dropDecision,
  type DragMode,
  type DropTarget,
  sectionRowIdOf,
  type SectionRule,
  sectionNameFromRowId,
  WHOLE_FILE_SECTION,
} from 'data-explorer-view/model';
import { vscodePort } from './vscodePort.js';
import type { DragDescriptor } from '../host/dragState.js';
import type { HostToTableMessage } from '../common/protocol.js';

// Importing a widget no longer registers it, so this comes first: before the shell's table is
// looked up and before any overlay is created, each finds its element already defined. The icon
// base too, before the first row draws one: the icons copy:icons puts in dist/webview/icons,
// relative to the shell's <base href> (dist/webview).
setIconBase('./icons/');
defineTreeTable();
defineContextMenu();
defineErrorDialog();
defineVariableEditor();

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
// The Variable Editor: a glyph in a matrix Value cell asks for a grid. connectTable opens and
// fills it (below); it is made here with the other overlays so the shells stay interchangeable.
const variableEditor = overlay('dex-variable-editor');
// Menu state cached from host messages so the menu builds synchronously on
// right-click (no round-trip): whether the doc is editable, and clipboard state.
let editable = false;
// Whether the document has a plain-text view "Location in Text" can reveal a row
// in (JSON .sldd yes, compressed-binary .sldd no). Gates that menu item + Cmd+L.
let hasTextView = false;
let clipboardState: ClipboardState = { canPaste: false, mode: null, items: [] };
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

// The rule of a document that is ONE target: a MAT-file has no section layer, so its host
// posts a single rule for the whole file, under WHOLE_FILE_SECTION ('', the spelling host and
// webview share — sectionRules.wholeFileRules). No dictionary posts one, so for every
// dictionary this is null and nothing below changes.
function wholeFileRule(): SectionRule | null {
  return sectionRulesList.find((r) => r.sectionName === WHOLE_FILE_SECTION) ?? null;
}

// Resolve the section a row belongs to, at any depth — the rule a paste into it or a drop
// on it has to satisfy. The walk lives in operands.ts because that is where the host's own
// walk is mirrored and tested; a one-level lookup here used to answer null for a nested
// child, which now reads as "no destination" and would refuse a paste the host accepts.
//
// A row with no section ancestor — a MAT-file's variable, or anything under one — and no
// row at all (null, or '' from a drop on the empty body) resolve to the whole-file rule,
// which is the document's one target when it has one, and null when it does not.
function sectionRuleForRow(rowId: string | null): SectionRule | null {
  const sectionRowId = rowId ? sectionRowIdOf(rowId, (table.rows ?? []) as MenuRow[]) : null;
  if (sectionRowId == null) return wholeFileRule();
  const sectionName = sectionNameFromRowId(sectionRowId);
  if (sectionName == null) return null;
  return sectionRulesList.find((r) => r.sectionName === sectionName) ?? null;
}

// The menu for the CURRENT selection, anchored at `anchorRowId` (the right-clicked row,
// or the primary selection for a keyboard chord).
//
// Both triggers go through here so they cannot disagree — the keyboard does not re-derive
// enablement, it builds this and reads the item. That is what makes "a shortcut can never
// do something the menu wouldn't" true rather than commented.
//
// `selection` is the current one but for a right-click on no row, which is a gesture on the
// document rather than on what is selected: its menu is the one a selection of nothing gets.
function menuFor(anchorRowId: string | null, selection: string[] = selectedRowIds()): ContextMenuItem[] {
  const rule = sectionRuleForRow(anchorRowId);
  return buildContextMenuItems({
    rows: (table.rows ?? []) as MenuRow[],
    selectedRowIds: selection,
    anchorRowId,
    clipboard: clipboardState,
    editable,
    hasTextView,
    // Paste's allow-check needs the target section's rules; without them the item is
    // offered only as far as "the clipboard is non-empty" can justify. The section's name
    // and this document's uri are what tell a cut pasted back where it came from.
    pasteTarget: rule
      ? { sectionName: rule.sectionName, sectionLabel: rule.sectionLabel, isDerived: rule.isDerived, allowedTypes: rule.allowedTypes }
      : null,
    docUri,
  });
}

function selectedRowIds(): string[] {
  const ids = table.selectedRowIds;
  return Array.isArray(ids) ? (ids as string[]) : [];
}

// Send an action to the host with the operand shape that action takes: Copy/Cut/Delete
// carry the selection (the host resolves it), the rest carry the one row they act on.
const SELECTION_ACTIONS = new Set(['copy', 'cut', 'delete']);

function postAction(actionId: string, anchorRowId: string | null): void {
  if (actionId === 'undo' || actionId === 'redo') {
    vscode.postMessage({ type: actionId });
    return;
  }
  if (SELECTION_ACTIONS.has(actionId)) {
    vscode.postMessage({ type: actionId, rowIds: selectedRowIds() });
    return;
  }
  if (!anchorRowId) {
    // A paste anchored at no row targets the document itself; '' is how the host is told
    // so. Only a one-target document can be that target (wholeFileRule). Its menu is the
    // only one that offers it, and this says so again here rather than trusting every
    // path that reaches postAction to have asked: a dictionary's host has no section to
    // put a row-less paste in.
    if (actionId === 'paste' && wholeFileRule()) vscode.postMessage({ type: 'paste', rowId: '' });
    return;
  }
  vscode.postMessage({ type: actionId, rowId: anchorRowId });
}

// The predictor injected into the table: given the row under the cursor ('' for the
// empty body) and the drag mode, run the pure dropDecision against the broadcast drag
// descriptor and this document's section rules. Returns null when there's no active drag or
// the target section can't be resolved, which the table reads as a refusal: a drag the host
// never announced (a file from the OS, text from another app) is not one this table takes.
function predictDrop(
  targetRowId: string,
  mode: DragMode,
): { canDrop: boolean; cursor: string; tooltip: string; noop: boolean } | null {
  if (!dragDescriptor) return null;
  const rule = sectionRuleForRow(targetRowId);
  if (!rule) return null;
  const target: DropTarget = {
    docUri,
    sectionName: rule.sectionName,
    sectionLabel: rule.sectionLabel,
    isDerived: rule.isDerived,
    allowedTypes: rule.allowedTypes,
  };
  // The descriptor IS a DragSource (the source document, and each item's own section).
  return dropDecision(dragDescriptor, target, mode);
}

// Whether a value read off a message is an object — the one shape every list element below
// has to be before a field of it is read.
function isRecord(x: unknown): x is Record<string, any> {
  return typeof x === 'object' && x !== null;
}

// The well-formed rules of a `sectionRules` message. A rule with no section name answers no
// row; an allow-list that is not a list is no restriction, as an absent one is.
function wellFormedRules(rules: unknown): SectionRule[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((r): r is SectionRule => isRecord(r) && typeof r.sectionName === 'string')
    .map((r) => (Array.isArray(r.allowedTypes) ? r : { ...r, allowedTypes: [] }));
}

// The table's display half of the protocol is view's: connectTable over messageSource (below)
// paints setRows, updateEntryRows, insertEntryRows and childRows, answers the matrix glyph,
// shows errors in the banner strip and keeps selection and expansion across a repaint. What is
// left here is this extension's: the editing state a setRows carries, the host's selection,
// rename and navigation requests, and the editing messages. Every handler reads its message as
// the protocol types it (protocol.ts), but the postMessage boundary is untyped, and a throw
// inside this listener is a table that stops answering without a word, so a message that is not
// an object is ignored and the state messages keep what is well-formed.
//
// Registered BEFORE the table's source, so that for a setRows the editing state (editable, the
// Add button, row drag) is set before the rows are installed, in the order it always was.
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToTableMessage;
  if (!isRecord(msg)) return;
  if (msg.type === 'setRows') {
    editable = !!msg.editable;
    hasTextView = !!msg.hasTextView;
    // A row drag is a structural edit, so it needs an editable document.
    table.rowDrag = editable;
    // Every table gets setRows, including the read-only ones that never receive
    // sectionRules — so this is the assignment that lets a .slx or .prj view answer a link
    // into itself. Guarded so a provider that has not been updated leaves the old value
    // rather than blanking it.
    docUri = typeof msg.docUri === 'string' ? msg.docUri : docUri;
    // The `+ Add` button exists only where entries can be created, which is the same
    // condition the context menu is gated on — the editable views. A read-only view gets
    // no button rather than a dead one.
    table.canAdd = editable;
    // A MAT-file's gallery offers the classes its host lists, a dictionary's every tile.
    table.addClasses = msg.add && Array.isArray(msg.add.classes) ? msg.add.classes.filter((c) => typeof c === 'string') : null;
    // A view that is read-only now has no drop rule left that is about it. Only then: an
    // editable payload's rules are re-sent AFTER it (the providers post sectionRules behind
    // setRows), so wiping them here would leave the view rule-less until the next message —
    // or for good, from a host that posts first.
    if (!editable) sectionRulesList = [];
    // NOT the broadcast drag (dragDescriptor): it mirrors the host's drag register, which a
    // repaint does not end — the register keeps the rows it snapped at drag start, and the
    // host broadcasts the end itself (dragEnd, and after every drop). Cleared here, a repaint
    // landing mid-drag (a file changed on disk, a Usage repost) would leave this table
    // refusing the rest of that drag.
  } else if (msg.type === 'selectByName') {
    // Cross-tab navigation: select the row whose name matches (block or
    // variable). Applied now if present, else held until the next setRows.
    if (typeof msg.name === 'string') handle.selectByName(msg.name);
  } else if (msg.type === 'selectRows') {
    // Select rows by id (a rename changed one, a paste added several). Applied now if they
    // are all present, else held until a rebuild brings the rest. Either way the host has
    // said what is selected, so a vanished selection's pending clear is moot.
    handle.select(Array.isArray(msg.rowIds) ? msg.rowIds : []);
  } else if (msg.type === 'beginRename') {
    // Open the name editor on a just-created entry. Applied now if its row is already here
    // (the host paints the new rows before it asks), else held until the repaint arrives.
    if (typeof msg.rowId === 'string') handle.beginRename(msg.rowId);
  } else if (msg.type === 'openAddGallery') {
    // The Add-gallery accelerator (dataExplorer.addEntry) arriving from the host. Handed
    // straight to the same method the button calls, so the keyboard and the pointer share
    // one path — including the toggle, and including the no-op on a view that cannot add.
    table.toggleAddGallery();
  } else if (msg.type === 'clipboardState') {
    clipboardState = {
      canPaste: !!msg.canPaste,
      mode: msg.mode ?? null,
      items: Array.isArray(msg.items) ? msg.items.filter(isRecord) : [],
      // Where the entries came from, when the host says: what lets Paste refuse a cut
      // pasted back into its own section (menuItems, isNoopMove).
      sourceDocUri: typeof msg.sourceDocUri === 'string' ? msg.sourceDocUri : undefined,
    };
  } else if (msg.type === 'sectionRules') {
    docUri = typeof msg.docUri === 'string' ? msg.docUri : docUri;
    sectionRulesList = wellFormedRules(msg.rules);
  } else if (msg.type === 'dragState') {
    // The host broadcasts the in-flight drag (or null when it ends) to every
    // webview, so a drag started in another tab predicts correctly here.
    const d: unknown = msg.descriptor;
    dragDescriptor = isRecord(d) && Array.isArray(d.items)
      ? ({ ...d, items: d.items.filter(isRecord) } as DragDescriptor)
      : null;
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
  } else if (msg.type === 'refused') {
    // A refused Add Child, Delete or Add: the same dialog, titled by the gesture, which stays
    // until it is closed. A banner would be cleared by the next repaint.
    errorDialog.show({ title: msg.title, reason: msg.reason });
  } else if (msg.type === 'editText') {
    // The whole text of a Value shown as a summary, asked for as its editor opens: the editor
    // opens on it. None (the value changed under the request): core's reason, where it gives one.
    if (typeof msg.text === 'string') table.openWholeValueEditor?.(msg.rowId, msg.text);
    else if (typeof msg.reason === 'string') errorDialog.show({ title: 'Cannot Edit', reason: msg.reason });
  }
});

// The table, fed by the host through view's connectTable: the same rules table-main used to
// hold (installRows, the vanished-selection clear, pending selections, lazy rows, the matrix
// glyph, local links, Ctrl+F), now one implementation every app shares. The banners are drawn
// in this shell's strip (banners.ts), whose height the full-bleed table is offset by; the menu is
// this file's (menu: false), because it is the editing menu.
const handle = connectTable(table, messageSource(vscodePort(vscode)), {
  variableEditor,
  menu: false,
  banners: (banners) => {
    renderError(table, banners.error);
    renderBanners(table, { notice: banners.notice, warnings: banners.warnings });
  },
});

// Relay row selection to the host, for the Property Inspector, which is another webview: the
// user's, and the ones the table applies for the host and for a link.
handle.on('select', (rowIds) => vscode.postMessage({ type: 'select', rowIds }));

// A link the table does not answer itself goes to the host, which opens the referenced file and
// selects the row there (see navigate.ts): each table is its own webview, with no page around
// it to navigate within.
handle.on('navigate', ({ target }) => vscode.postMessage({ type: 'navigate', target }));

// Whether this keystroke is TEXT ENTRY rather than a gesture on the grid: the search
// box, the column-filter popup, the inline cell editor. Read off the COMPOSED PATH,
// because every one of those fields lives inside the table's shadow tree and `e.target`
// at this listener is the host element, which tells us nothing about where the caret is.
//
// The rule lives here once because both capture guards below need it and they must not
// disagree: a key that a field owns is not the table's to claim.
function isTypingInField(ev: KeyboardEvent): boolean {
  const active = (ev.composedPath?.()[0] as HTMLElement) ?? (ev.target as HTMLElement);
  const tag = active?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
}

// Read-only documents never open the inline cell editor. The table component
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
    const ev = e as KeyboardEvent;
    // Only Enter on the GRID is the cell-editor gesture this gate exists for. Enter in a
    // FIELD belongs to that field: the search box commits a search with it and the
    // column-filter popup applies with it. Without this exemption, a read-only view (.slx,
    // .mdl, .prj, a read-only MAT-file) had a search box that did nothing at all — the
    // keystroke died here, one element above the box, and .sldd looked fine because it is
    // editable.
    if (ev.key === 'Enter' && !isTypingInField(ev) && !shouldOpenCellEditor(editable)) {
      e.stopPropagation();
    }
  },
  true,
);

// Cmd/Ctrl+L: jump to the selected row's location in the plain-text view — the
// keyboard equivalent of the "Location in Text" menu action, and gated by that item.
table.addEventListener(
  'keydown',
  (e: Event) => {
    const ev = e as KeyboardEvent;
    if ((ev.key === 'l' || ev.key === 'L') && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
      const anchorRowId = selectedRowIds()[0] ?? null;
      if (!anchorRowId) return;
      const item = menuFor(anchorRowId).find((i) => i.id === 'locateInText');
      if (!item || item.disabled) return;
      ev.preventDefault();
      ev.stopPropagation();
      postAction('locateInText', anchorRowId);
    }
  },
  true,
);

// Cut/Copy/Paste/Delete keyboard shortcuts — the keyboard half of the context-menu
// actions (whose labels advertise these chords). Enablement is not re-derived here: the
// menu for the current selection IS the authority, so the chord does exactly what
// clicking that item would, on exactly the same rows. Capture phase, so it runs before
// the table component's own key handling; skipped while a cell editor or the filter
// input is focused (there the chord is text editing).
table.addEventListener(
  'keydown',
  (e: Event) => {
    if (!editable) return;
    const ev = e as KeyboardEvent;
    const action = resolveShortcutAction(ev);
    if (!action) return;

    // While typing in the inline cell editor, the search box or the column filter, C/X/V
    // and Delete/Backspace are text editing — let the field handle them natively.
    if (isTypingInField(ev)) return;

    // The primary selection anchors the gesture, the same way the right-clicked row
    // does: it is what a paste targets the section of. With nothing selected the anchor is
    // no row, and the menu for that offers only Paste — enabled only where the document is
    // one target (an empty MAT-file pastes into the file), so a dictionary's Cmd+V with
    // nothing selected still does nothing.
    const anchorRowId = selectedRowIds()[0] ?? null;
    // Absent (a section selection offers no Copy at all) or disabled → do nothing, and
    // let the key through rather than swallowing it.
    const item = menuFor(anchorRowId).find((i) => i.id === action);
    if (!item || item.disabled) return;

    ev.preventDefault();
    ev.stopPropagation();
    postAction(action, anchorRowId);
  },
  true,
);

// Right-click: build the menu for the current selection synchronously, anchored at
// the clicked row, then show it. The table component has already settled the
// selection (a click outside it replaces it) and prevented the native browser menu.
table.addEventListener('dex-table-context-menu', (e: Event) => {
  // Read-only views (.slx/.mdl/.prj, a MAT-file shown read-only, a JSON .sldd too large to
  // edit) have no menu at all: no cell editor and no right-click actions.
  if (!shouldShowContextMenu(editable)) return;
  const detail = (e as CustomEvent).detail;
  lastContextRowId = detail.rowId ?? null;
  if (lastContextRowId === null) {
    // A right-click on no row (the space under the rows, or an empty table) is a gesture
    // on the document. Only a one-target document has a menu there — Paste into the file,
    // Undo/Redo — so a dictionary's empty space stays inert, as it always was.
    if (!wholeFileRule()) return;
    contextMenu.show(detail.x, detail.y, menuFor(null, []));
    return;
  }
  contextMenu.show(detail.x, detail.y, menuFor(lastContextRowId));
});

// A menu item was chosen: relay it to the host with that action's operands.
contextMenu.addEventListener('dex-action', (e: Event) => {
  postAction((e as CustomEvent).detail.actionId as string, lastContextRowId);
});

// Inject the drop predictor so the table can render live cursor + tooltip
// feedback on dragover (backed by the pure dropDecision + host-shipped rules).
table.dropPredictor = predictDrop;

// Drag lifecycle → host. On drag start the host snapshots the dragged rows into
// its drag register and broadcasts the descriptor; on end it clears + rebroad-
// casts; on drop it completes the move/copy as paste (+ source delete). All
// gated on an editable document, the fact table.rowDrag is set from, so a read-only
// view never starts or takes one.
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
  // '' is a drop on the empty body, which the predictor allows only into a one-target
  // document — the drag twin of a paste anchored at no row, and refused here on the same
  // terms as that paste (postAction).
  const rowId = typeof detail?.targetRowId === 'string' ? detail.targetRowId : '';
  if (rowId === '' && !wholeFileRule()) return;
  vscode.postMessage({ type: 'drop', rowId, mode: detail.mode });
});

// A tile in the Add gallery was clicked: ask the host to create one entry of that class in
// the section the tile names. Nothing about the current selection is sent, and that is the
// point — a tile carries its own destination, so the add means the same thing wherever the
// cursor happens to be. Gated on `editable` like every other structural gesture; the button
// does not exist on a read-only view (table.canAdd), so this is the second lock on a door
// that has no handle.
table.addEventListener('dex-add-entry', (e: Event) => {
  if (!editable) return;
  const detail = (e as CustomEvent).detail;
  vscode.postMessage({
    type: 'addEntry',
    section: detail.section,
    className: detail.className,
    rename: !!detail.rename,
  });
});

// A Value editor is opening on a summary: ask the host for the whole text it stands for, which the
// row does not carry (answered by an `editText` message, above).
table.addEventListener('dex-edit-text-request', (e: Event) => {
  if (!editable) return;
  const rowId = (e as CustomEvent).detail?.rowId;
  if (typeof rowId === 'string') vscode.postMessage({ type: 'requestEditText', rowId });
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

