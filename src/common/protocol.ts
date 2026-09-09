// Copyright 2026 The MathWorks, Inc.
// Shared message-protocol types for the webview <-> host postMessage boundary.
//
// These are the single source of truth for the `{ type, ... }` envelopes that
// cross between the extension host (providers) and the webviews (table-main,
// pi-main). They are TYPES ONLY — they erase at build time and change no runtime
// behavior. They are applied at the RECEIVERS (each `onDidReceiveMessage` /
// `window.addEventListener('message')` handler), where discriminating on
// `.type` narrows the union so field names and payload shapes are checked at
// compile time. The send sites are left untyped on purpose: some dispatch a
// runtime-chosen `type` (keyboard shortcut / context-menu action id), which a
// strict send-side type would fight without any behavior benefit.
//
// `rows` / `groups` / `columns` are intentionally loose (`any[]` / `unknown`):
// they flow into the vendored table/inspector components (typed `any`) and are
// mapped with narrower callbacks, so a stricter element type would introduce new
// contravariant-callback errors rather than catch real bugs.

import type { SectionRule } from '../host/sectionRules.js';
import type { DragDescriptor } from '../host/dragState.js';
import type { ClipboardMode } from '../host/clipboard.js';
import type { WarningBanner } from '../host/parseWarnings.js';

// --- Host -> Webview (table view: table-main.ts) ------------------------------

/** Full table repaint: rows + column metadata + edit/read-only mode. */
export interface SetRowsMessage {
  type: 'setRows';
  rows: any[];
  columns: unknown;
  columnLabels: unknown;
  columnGroups?: unknown;
  editable: boolean;
  /** Persistent read-only banner text (e.g. size-limited JSON .sldd). */
  notice?: string;
  /**
   * What the parse could not read, when it could not read something — absent for a
   * clean read, so a view that never sets it shows no banner.
   *
   * Separate from `notice` because they answer different questions: `notice` explains
   * the MODE this view is in (read-only, and why), while this says the DATA is short.
   * A file can be both, and folding them into one string would force a choice.
   */
  warnings?: WarningBanner;
  /**
   * Whether this document is backed by a plain-text view the "Location in Text"
   * action can reveal a row in. True for JSON .sldd (a TextDocument); false/absent
   * for compressed-binary .sldd, whose only text payload is internal XML with no
   * user-facing text editor — so the action is omitted there rather than dead.
   */
  hasTextView?: boolean;
}

/**
 * Entry-scoped repaint: replace the rows of ONE entry subtree, leaving every other
 * row in the table untouched.
 *
 * The narrow counterpart to `setRows`, for an edit the host knows is confined to a
 * single entry (a value edit, a rename, adding or deleting a nested child). A
 * `setRows` is the wrong shape for those: it costs a re-parse of the whole
 * dictionary plus every row, which on a real customer .sldd is seconds of latency
 * and a ~67 MB payload to express a one-cell change.
 *
 * `rows` is `buildEntryRows` output — the entry row first, then its flattened
 * descendants — and an empty array removes the subtree.
 */
export interface UpdateEntryRowsMessage {
  type: 'updateEntryRows';
  /**
   * The entry row whose subtree these rows replace, as the TABLE currently spells
   * it. On a rename that is the entry's OLD id: the rows on screen still carry it,
   * and the replacement rows carry the new one.
   */
  entryRowId: string;
  rows: any[];
}

/**
 * Entry-scoped INSERT: add the rows of ONE new entry to a section, leaving every
 * other row untouched.
 *
 * `updateEntryRows` covers an entry that is already on screen — including removing
 * it, with an empty `rows`. An entry that is NEW to the table (a paste, a drop, the
 * undo of a delete) has no run to splice over, so it needs the position stated
 * instead: which section it joins, and which of that section's entries it goes
 * before.
 *
 * `beforeRowId` is the entry row the new rows precede; absent means "last in this
 * section", which is where a paste lands (the fragment goes in at the end of the
 * dictionary's entry list, so a re-read would put it there too — the narrow insert
 * has to agree with the wide rebuild, or the row order changes under the user on
 * the next full repaint).
 */
export interface InsertEntryRowsMessage {
  type: 'insertEntryRows';
  /** The section row (`section:<name>`) the new entry belongs to. */
  sectionRowId: string;
  /** The entry row the new rows go before; absent appends to the section. */
  beforeRowId?: string;
  rows: any[];
}

/** This document's section drop-rules, for client-side drop prediction. */
export interface SectionRulesMessage {
  type: 'sectionRules';
  docUri: string;
  rules: SectionRule[];
}

/** Broadcast clipboard state so every open table builds its menu synchronously. */
export interface ClipboardStateMessage {
  type: 'clipboardState';
  canPaste: boolean;
  mode: ClipboardMode | null;
}

/** Broadcast the in-flight drag descriptor (null when no drag is active). */
export interface DragStateMessage {
  type: 'dragState';
  descriptor: DragDescriptor | null;
}

/** Select the row whose name matches (cross-tab navigation). */
export interface SelectByNameMessage {
  type: 'selectByName';
  name: string;
}

/** Re-select a row by id (e.g. after a rename changed its id). */
export interface SelectRowMessage {
  type: 'selectRow';
  rowId: string;
}

/** Transient red error banner. */
export interface ErrorMessage {
  type: 'error';
  message: string;
}

/** Invalid cell edit: show the scoped validation dialog and revert the cell. */
export interface ValidationErrorMessage {
  type: 'validationError';
  reason: string;
  invalidValue: unknown;
  previousValue: unknown;
}

// --- Host -> Webview (property inspector: pi-main.ts) -------------------------

/** Render the property groups for the selected node. */
export interface ShowPropsMessage {
  type: 'showProps';
  groups: any[];
}

/** Clear the inspector (nothing selected). */
export interface EmptyMessage {
  type: 'empty';
}

/** Every message the table webview can receive from the host. */
export type HostToTableMessage =
  | SetRowsMessage
  | UpdateEntryRowsMessage
  | InsertEntryRowsMessage
  | SectionRulesMessage
  | ClipboardStateMessage
  | DragStateMessage
  | SelectByNameMessage
  | SelectRowMessage
  | ErrorMessage
  | ValidationErrorMessage;

/** Every message the property-inspector webview can receive from the host. */
export type HostToPropsMessage = ShowPropsMessage | EmptyMessage;

// --- Webview -> Host (table view -> providers) --------------------------------

/** Webview booted and is ready to receive its first payload. */
export interface ReadyMessage {
  type: 'ready';
}

/** Row selection changed (relayed to the Property Inspector). */
export interface SelectMessage {
  type: 'select';
  rowIds: string[];
}

/** A committed cell edit / rename to write back into the JSON text. */
export interface EditMessage {
  type: 'edit';
  rowId: string;
  columnId: string;
  oldValue: string;
  newValue: string;
}

/** Structural clipboard/tree actions, all targeting a single row. */
export interface CopyMessage {
  type: 'copy';
  rowId: string;
}
export interface CutMessage {
  type: 'cut';
  rowId: string;
}
export interface PasteMessage {
  type: 'paste';
  rowId: string;
}
export interface DeleteMessage {
  type: 'delete';
  rowId: string;
}
export interface AddChildMessage {
  type: 'addChild';
  rowId: string;
}

/** Jump to the row's location in the plain-text view. */
export interface LocateInTextMessage {
  type: 'locateInText';
  rowId: string;
}

/** A Usage-column link was clicked; open the referenced target. */
export interface NavigateMessage {
  type: 'navigate';
  target: string;
}

/** Document-level native undo / redo. */
export interface UndoRedoMessage {
  type: 'undo' | 'redo';
}

/** Drag started: snapshot these rows into the host drag register. */
export interface DragStartMessage {
  type: 'dragStart';
  rowIds: string[];
}

/** Drag ended: clear the host drag register. */
export interface DragEndMessage {
  type: 'dragEnd';
}

/** Drop completed: apply the move/copy against the target row. */
export interface DropMessage {
  type: 'drop';
  rowId: string;
  mode: 'copy' | 'move';
}

/** Every message the host receives from the table webview. */
export type TableToHostMessage =
  | ReadyMessage
  | SelectMessage
  | EditMessage
  | CopyMessage
  | CutMessage
  | PasteMessage
  | DeleteMessage
  | AddChildMessage
  | LocateInTextMessage
  | NavigateMessage
  | UndoRedoMessage
  | DragStartMessage
  | DragEndMessage
  | DropMessage;

/** Every message the host receives from the property-inspector webview. */
export type PropsToHostMessage = ReadyMessage;
