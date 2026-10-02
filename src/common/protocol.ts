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

import type { ProjectPage } from 'data-explorer-core';
import type { MspProject } from './msp.js';
import type { SectionRule } from '../host/sectionRules.js';
import type { DragDescriptor } from '../host/dragState.js';
import type { ClipboardMode } from '../host/clipboard.js';
import type { DropFacts } from '../host/dropFacts.js';
import type { WarningBanner } from '../host/parseWarnings.js';
import type { MatrixPayload } from '../host/matrixPayload.js';

// --- Host -> Webview (table view: table-main.ts) ------------------------------

/** Full table repaint: rows + column metadata + edit/read-only mode. */
export interface SetRowsMessage {
  type: 'setRows';
  /**
   * The uri of the document these rows came from, so the webview can answer a link into
   * itself without a host round-trip (see webview/linkRoute.ts).
   *
   * On `setRows` rather than `sectionRules` because only the two EDITABLE providers post
   * that one — it carries drop rules, which a read-only .slx/.mat view has none of. Hang
   * the uri off it and a read-only table never learns its own identity, so its links take
   * the host path while a dictionary's take the local one: the same rule behaving two ways
   * depending on which provider had drop rules to send.
   *
   * Declared required to say every provider owes it, though `webview.postMessage` is
   * untyped, so what actually holds the four call sites is a test in
   * test/messageDispatch.test.ts.
   */
  docUri: string;
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
  /**
   * What the clipboard holds, payload-free — so the menu can ask the target section
   * whether a paste may land there before offering it, exactly as a dragover asks.
   * Never the entry records: on a 47.8 MB dictionary that is a 67 MB postMessage.
   */
  items: DropFacts[];
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

/**
 * Select rows by id — the rows the host's edit just made the answer to "where am I".
 *
 * PLURAL, and the same spelling as the webview's own `select`, because the count is a
 * property of the EDIT and not of the channel: a rename re-keys one row, a delete leaves
 * one survivor, but a multi-entry paste or drop adds N and the user's next gesture is
 * about all N. Sending the last of them (which is what a single `rowId` reduced this to)
 * loses the rest silently — the entries are in the file and only one is selected.
 */
export interface SelectRowsMessage {
  type: 'selectRows';
  rowIds: string[];
}

/**
 * Put a row's Name cell straight into inline rename.
 *
 * Sent after the `selectRows` for an entry the host has just CREATED from the Add gallery,
 * because a new entry's name is the one thing the gallery cannot supply: core names it from the
 * class's own stem — `Param`, `Param1`, `Param2` for a `Simulink.Parameter` — and the user's
 * next act is always to say what it really is. Stated by the host rather than inferred in the webview from "a selectRows that
 * arrived with an insert" — a paste and a drop are exactly that too, and their names came
 * from the entries the user already had.
 *
 * Separate from `selectRows` rather than a flag on it, because the two are answered at
 * different times: the selection can be held until the row exists (pendingSelectIds), and so
 * can this, but a row that is never renameable still selects.
 */
export interface BeginRenameMessage {
  type: 'beginRename';
  rowId: string;
}

/**
 * Open the Add gallery, as if its button had been clicked.
 *
 * The keyboard's way in. A webview cannot own a VS Code keybinding for a control inside itself,
 * so the accelerator is a contributed command (`dataExplorer.addEntry`) that lands in the host
 * and posts this to the focused table. It toggles, exactly as the button does — the same gesture
 * arriving by another road, rather than a second way to open the same popover.
 *
 * Carries nothing: where the gallery goes and how wide it is are measured in the webview from
 * the table's own box, and the host knows neither.
 */
export interface OpenAddGalleryMessage {
  type: 'openAddGallery';
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

// --- Host -> Webview (both table and inspector: the Variable Editor's cells) ---

/**
 * The cells for a matrix the webview asked about, or why there are none.
 *
 * Sent only in answer to `requestMatrix`, never unprompted. The rows themselves
 * carry a `MatrixDescriptor` — name, class, shape, node id — which is what the
 * glyph and the panel title need; the cells are fetched when a panel actually
 * opens. A 1000x1000 entry is 4 MB of cell strings, and stamping that onto a row
 * meant every griddable matrix in a file crossed this boundary whether or not
 * anyone looked at one.
 *
 * `nodeId` is echoed so a late answer to a panel the user already closed, or
 * re-opened on a different row, can be dropped instead of painted.
 *
 * Exactly one of `matrix` / `message` is set. `message` exists because a descriptor
 * is not a promise: whether the cells lay out is only discoverable by laying them
 * out, which is the work the descriptor exists to skip. So the panel has to be able
 * to say "could not read this" rather than show an empty grid.
 */
export interface MatrixCellsMessage {
  type: 'matrixCells';
  nodeId: string;
  matrix?: MatrixPayload;
  message?: string;
}

// --- Host -> Webview (project main page: project-main.ts) ---------------------

/**
 * Render a project's main page.
 *
 * One message and one repaint: unlike the table there is no entry-scoped update to
 * make, because a `.prj` is never edited here and the only thing that changes the
 * page is the store changing on disk — at which point every figure on it is stale.
 *
 * `root` is the one thing the page cannot derive. The store records nothing absolute
 * (that is what keeps a project portable), so the folder path shown under the
 * project's name comes from the document URI, which only the host has.
 */
export interface SetProjectMessage {
  type: 'setProject';
  /** core's `buildProjectPage` output — every figure on the page is derived there. */
  page: ProjectPage;
  /** The project folder's filesystem path, for display. */
  root: string;
  /**
   * What a Managed Simulink Project adds — absent for every project that is not one,
   * which is every project this extension has ever opened until now. See common/msp.ts:
   * the page's MSP markup hangs entirely off this key being present, so a non-MSP
   * project's page is unchanged by its existence.
   */
  msp?: MspProject;
  /** What the parse could not read — absent for a clean read. */
  warnings?: WarningBanner;
}

/** Every message the project page can receive from the host. */
export type HostToProjectMessage = SetProjectMessage | ErrorMessage;

/** Every message the table webview can receive from the host. */
export type HostToTableMessage =
  | SetRowsMessage
  | UpdateEntryRowsMessage
  | InsertEntryRowsMessage
  | SectionRulesMessage
  | ClipboardStateMessage
  | DragStateMessage
  | SelectByNameMessage
  | SelectRowsMessage
  | BeginRenameMessage
  | OpenAddGalleryMessage
  | ErrorMessage
  | ValidationErrorMessage
  | MatrixCellsMessage;

/** Every message the property-inspector webview can receive from the host. */
export type HostToPropsMessage = ShowPropsMessage | EmptyMessage | MatrixCellsMessage;

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

/**
 * Structural clipboard/tree actions.
 *
 * Copy/Cut/Delete carry the whole SELECTION, because the user's gesture was made over
 * it; the host resolves what that means (whole entries for copy/cut, rows for delete —
 * an operation's granularity follows whether it needs a destination). Paste and Add
 * Child carry one row: paste needs a single destination section, and Add Child a single
 * parent, so both are offered only at a single-row selection.
 */
export interface CopyMessage {
  type: 'copy';
  rowIds: string[];
}
export interface CutMessage {
  type: 'cut';
  rowIds: string[];
}
export interface DeleteMessage {
  type: 'delete';
  rowIds: string[];
}
export interface PasteMessage {
  type: 'paste';
  rowId: string;
}
export interface AddChildMessage {
  type: 'addChild';
  rowId: string;
}

/**
 * Create one new default entry from the Add gallery.
 *
 * Names the SECTION rather than a row, which is what makes the gallery independent of the
 * selection: every tile carries its own destination (a Constant is architectural data
 * wherever the cursor happens to be), so there is no "current section" to get wrong. The
 * class name is core's, and core's `addEntry` is what re-checks that the section admits it.
 */
export interface AddEntryMessage {
  type: 'addEntry';
  /** Core's section key — `design`, `arch` or `config`. */
  section: string;
  /** The `$class` (or class-map key) to create. */
  className: string;
  /**
   * Whether the new row should go straight into inline rename.
   *
   * True for an unpinned add, where naming the entry is the user's next act and the popover
   * has already closed to get out of the way. False during a pinned run: prompting mid-run
   * would interrupt the very batch the pin asked for.
   */
  rename: boolean;
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

/**
 * A Variable Editor panel is opening on this node: send its cells.
 *
 * The one message the TABLE sends that is a question rather than a command, and the
 * reason the row's `_matrix` carries no cells (see `MatrixCellsMessage`). `nodeId` is
 * the ROW's node, not the matrix owner's — a property row's matrix lives on its
 * `Value` child, and the host re-runs its own `matrixForRow` rule on this id rather
 * than trusting the webview to have resolved it the same way.
 *
 * Shared with `PropsToHostMessage` rather than reinvented: the Property Inspector
 * opens the same panel on the same kind of value, and the two would otherwise be one
 * rule along two paths — the defect this codebase keeps relearning.
 */
export interface RequestMatrixMessage {
  type: 'requestMatrix';
  nodeId: string;
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
  | AddEntryMessage
  | LocateInTextMessage
  | NavigateMessage
  | UndoRedoMessage
  | DragStartMessage
  | DragEndMessage
  | DropMessage
  | RequestMatrixMessage;

/**
 * A link on the project page was activated: open what it names.
 *
 * Carries a PROJECT-ROOT-RELATIVE path, which is how core's parse spells every path
 * in the store, and resolving it is the host's job because only the host knows where
 * the project root is. Deliberately not `NavigateMessage`, which names a row inside
 * an already-open document (`name@srcId`); this names a file on disk that may not be
 * open at all.
 *
 * What to DO with it is decided by the host after it stats the target, not stated
 * here: a folder cannot be opened as an editor, and the store does not say which of
 * the two a path is — a shortcut can target a folder, and a designated location
 * usually does.
 */
export interface OpenFileMessage {
  type: 'openFile';
  path: string;
  /**
   * The path names a project FOLDER, and what the user asked for is the project in it.
   * Sent only by a component row, where the store records `Ref="../plant"` — a folder,
   * which would otherwise be revealed in the Explorer, one click short of the page that
   * answers the question. Absent everywhere else, so no existing row changes behaviour.
   */
  preferProject?: boolean;
}

/** Every message the host receives from the project page. */
export type ProjectToHostMessage = ReadyMessage | OpenFileMessage;

/** Every message the host receives from the property-inspector webview. */
// `NavigateMessage` is reused rather than reinvented: a clicked cross-reference means the
// same thing from either webview, and the host answers both with the same closure. The
// same goes for `RequestMatrixMessage`: the inspector's Value row opens the same Variable
// Editor the table's does, and it is answered by the same function.
export type PropsToHostMessage = ReadyMessage | NavigateMessage | RequestMatrixMessage;
