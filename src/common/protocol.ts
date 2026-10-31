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
// THE READ HALF IS VIEW'S. The messages that carry a table and its inspector (setRows, the entry
// repaints, error, childRows, matrixCells, showProps, empty; ready, select, requestChildren,
// requestMatrix) are data-explorer-view's documented wire format (its model's wire.ts), which
// view's messageSource and serveTable speak, and which this extension's webviews take through
// connectTable and connectInspector. They are imported from there, so the host and the webviews
// speak exactly the format view documents. What is declared here is this extension's own:
// setRows' two VS Code-only fields, editing, navigation and the project page.

import type { ProjectPage } from 'data-explorer-core';
import type {
  ChildRowsMessage,
  EmptyMessage,
  ErrorMessage,
  InsertEntryRowsMessage,
  MatrixCellsMessage,
  MspProject,
  ReadyMessage,
  RequestChildrenMessage,
  RequestMatrixMessage,
  SectionRule,
  DropFacts,
  SelectMessage,
  SetRowsMessage as WireSetRowsMessage,
  ShowPropsMessage,
  UpdateEntryRowsMessage,
  WarningBanner,
} from 'data-explorer-view/model';

export type {
  ChildRowsMessage,
  EmptyMessage,
  ErrorMessage,
  InsertEntryRowsMessage,
  MatrixCellsMessage,
  ReadyMessage,
  RequestChildrenMessage,
  RequestMatrixMessage,
  SelectMessage,
  ShowPropsMessage,
  UpdateEntryRowsMessage,
};
import type { ClipboardMode, DragDescriptor } from 'data-explorer-view/model';

// --- Host -> Webview (table view: table-main.ts) ------------------------------

/**
 * Full table repaint: the wire's setRows (rows, columns, docUri, editable, notice, warnings), plus
 * what only this extension's table reads: whether there is a text view to locate a row in, and
 * what the Add gallery offers.
 */
export interface SetRowsMessage extends WireSetRowsMessage {
  /**
   * Whether this document is backed by a plain-text view the "Location in Text"
   * action can reveal a row in. True for JSON .sldd (a TextDocument); false/absent
   * for compressed-binary .sldd, whose only text payload is internal XML with no
   * user-facing text editor — so the action is omitted there rather than dead.
   */
  hasTextView?: boolean;
  /**
   * What the Add gallery offers. Absent: every tile, a dictionary's, each naming its section.
   * `{classes}`: a MAT-file's, the tiles of the classes core says the file can take a new
   * variable of (MatNode.getAllowedTypes), in no section.
   */
  add?: { classes: readonly string[] };
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
   *
   * `sectionName` is the section each entry was copied or cut from ('' for a MAT-file's
   * variable), as a drag descriptor's items carry it. Optional: a host that does not send it
   * (with `sourceDocUri`) only loses the menu's knowledge that a cut pasted back where it
   * came from is a no-op.
   */
  items: (DropFacts & { sectionName?: string })[];
  /** The document the entries were copied or cut from. See `items`. */
  sourceDocUri?: string;
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

/** Invalid cell edit: show the scoped validation dialog and revert the cell. */
export interface ValidationErrorMessage {
  type: 'validationError';
  reason: string;
  invalidValue: unknown;
  previousValue: unknown;
}

/**
 * A gesture refused before it changed anything (Add Child, Delete, Add): shown in the dialog a
 * refused cell edit is shown in, titled by the gesture, with why (host/refusal.ts). A dialog and
 * not the banner, because the next repaint clears the banner.
 */
export interface RefusedMessage {
  type: 'refused';
  title: string;
  reason: string;
}

/**
 * The answer to `RequestEditTextMessage`: the whole text of the row's Value, which seeds its editor,
 * or null where there is none to edit (the value changed under the request), with core's reason
 * where it gives one (`valueEditRefusal`).
 */
export interface EditTextMessage {
  type: 'editText';
  rowId: string;
  text: string | null;
  reason?: string;
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
   * which is every project this extension has ever opened until now. See data-explorer-view's src/model/ids/msp.ts:
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
  | RefusedMessage
  | EditTextMessage
  | MatrixCellsMessage
  | ChildRowsMessage;

/** Every message the property-inspector webview can receive from the host. */
export type HostToPropsMessage = ShowPropsMessage | EmptyMessage | MatrixCellsMessage;

// --- Webview -> Host (table view -> providers) --------------------------------

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
  /**
   * The row the paste is anchored at, whose section it lands in. '' is no row — the
   * document itself — sent only by a table whose document is ONE target (a MAT-file, whose
   * host posted a whole-file `sectionRules` rule): a right-click on its empty body, or Cmd+V
   * with nothing selected. A dictionary posts no such rule, so it is never sent ''.
   */
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
  /**
   * The row dropped on. '' is the table's empty body, for the reason `PasteMessage.rowId`
   * can be '': only a one-target document's table allows a drop there, which is how an empty
   * MAT-file takes one.
   */
  rowId: string;
  mode: 'copy' | 'move';
}

/**
 * The whole text of a Value the row shows as a summary for its size (`<1x500 double>`), asked for
 * as its editor opens. The table's third question: the row carries only a MARKER that there is
 * such a text (`_hasEditText`), and the text, which can run to 200,000 characters, is fetched when
 * the user opens the editor, as a matrix's cells are when the Variable Editor opens. Answered by
 * `EditTextMessage`.
 */
export interface RequestEditTextMessage {
  type: 'requestEditText';
  rowId: string;
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
  | RequestMatrixMessage
  | RequestChildrenMessage
  | RequestEditTextMessage;

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
