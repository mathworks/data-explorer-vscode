// Copyright 2026 The MathWorks, Inc.
//
// Writable custom editor for COMPRESSED-BINARY (zip/XML) .sldd files. A binary
// .sldd is an OPC/zip package whose only editable text payload is data/chunk0.xml;
// all other parts pass through verbatim. The document holds that chunkXml string
// as its single edit surface plus the pass-through parts. Every table edit is a
// pure string transform on chunkXml (xmlStructuralEdit), replacing only the touched
// entry's <Object>…</Object> with what core's spliceEntryObject writes for it: the
// entry's bytes with what the edit changed written from the model, laid out as the
// chunk is, and every byte around it as it was. Untouched entries stay byte-identical —
// the same risk profile as the JSON .sldd table view.
//
// Unlike SlddTextEditorProvider (backed by a native TextDocument), this is a
// CustomEditorProvider: it owns its own edit stack via onDidChangeCustomDocument,
// and re-zips on save. Undo and redo restore the chunk text, and rebuild the entries
// they change from that text (entryOps' fragments), so an undone entry keeps the
// bytes it came from. The save gate (writeTo) makes two checks before it writes, and
// a refusal leaves the file on disk untouched:
//  - it re-reads chunkXml and refuses the save if the chunk does not read back, so a
//    serializer bug that breaks the markup, or a chunk core would read as an empty
//    dictionary, becomes a failed save;
//  - it compares chunkXml with the chunk as last read or saved, entry by entry, with
//    a scan of the markup rather than core's reader (binarySaveGate.ts, the
//    maintainer's D12 addendum): an entry no edit changed must be its bytes, and an
//    edited one must keep every part the edit did not change (core's
//    keptPartsViolations), or the save is refused, naming the entry.
// Neither checks that an edited value is right. A loss the reader and writer share
// re-reads as unchanged, which is why the second check compares bytes, found by a scan
// of the markup, and never a re-read of them; an edited part is written from the
// model, and keeping that right is core's writers' job.
//
// The model is registered in the global DataModel singleton under a srcId that
// PREFIXES the URI, so it never collides with the read-only BinaryEditorProvider's
// cached model of the same file.
import * as vscode from 'vscode';
import { unzipSync, zipSync } from 'fflate';
import { renderTableWebview } from './webviewHtml.js';
import { buildEntryRows, clipMarkKey, splitClipMarkKey, COLUMNS, COLUMN_LABELS, COLUMN_GROUPS, type ClipMark } from './rowBuilder.js';
import { rowPlannerFor } from './rowPlanner.js';
import { LAZY_ROW_BUDGET, lazyRowsBanner } from './lazyRows.js';
import { answerChildRequest } from './childRequest.js';
import { sectionRules } from './sectionRules.js';
// DATA_PART_XML is core's name for the one zip member holding the entries, and the four
// sites below are three roles of one rule: two lookups, the exclusion in
// `passThroughParts`, and the re-insert in `writeTo`. Drift between them does not throw —
// see `passThroughParts` — so they take the name core's own reader looks up.
import {
  DataModel,
  DATA_PART_XML,
  findEntryObjectSpan,
  entrySelectorOf,
  planDeletion,
  spliceEntryObject,
  type ParseWarning,
} from 'data-explorer-core';
// Never parseBinarySlddParts directly: readSlddParts is the same read plus the rule
// that a dictionary this host could not read is not passed on as an empty one, which
// the reader itself no longer enforces (it recovers and warns instead).
import { readSlddParts } from './slddContent.js';
import { changedEntryKeys, savedChunkRefusal, SavedChunk, uncheckableEntries } from './binarySaveGate.js';
import { chunkEntryKey, entryKey, scanChunkEntries } from './chunkEntries.js';
import { isZipBytes } from './slddFormat.js';
import { sourceWarnings, warningBanner } from './parseWarnings.js';
import { postOrReport } from './postPayload.js';
import {
  findOwningEntry,
  refuseDisallowedPaste,
  sectionByName,
  sectionTarget,
  buildDragSnapshot,
  reselectAfterRemoval,
  type SectionTarget,
} from './structuralEdit.js';
import { copyEntriesToClipboard } from './clipboardAction.js';
import { captureBaseline, computeModified, isEntryModified, clearBaseline } from './slddBaseline.js';
import {
  deleteEntryXml,
  deleteChildXml,
  deleteChildrenXml,
  addChildXml,
  addNewEntryXml,
  pasteEntriesXml,
  deleteEntriesByNameXml,
  type StructuralResult,
} from './xmlStructuralEdit.js';
import {
  catalogFunctionRenameOf,
  catalogRenameOf,
  scXmlFunctionRenamePatch,
  scXmlRenamePatch,
  type ScPartPatch,
} from './scRename.js';
import {
  applyEntryOps,
  entryRecord,
  findEntryByName,
  insertOp,
  mutateEntry,
  opsOfPastedEntries,
  patchOfPairs,
  removalPairs,
  removeEntries,
  removeOp,
  replaceOp,
  type AppliedOp,
  type EntryOp,
  type EntryOpPair,
  type EntryPatch,
  type EntryRecord,
} from './entryOps.js';
import { buildSectionRowId } from '../common/sectionRowId.js';
import { getClipboard, clipboardState } from './clipboard.js';
import { setDrag, getDrag, clearDrag } from './dragState.js';
import {
  registerWebview,
  unregisterWebview,
  registerAddGalleryView,
  unregisterAddGalleryView,
  registerSourceDeleter,
  unregisterSourceDeleter,
  broadcastClipboardState,
  broadcastDragState,
  deleteFromSource,
} from './editorHub.js';
import { basename } from '../common/pathUtil.js';
import { runTransfer, type TransferAdapter, type TransferDeps } from './transfer.js';
import { clipboardRegister, dragRegister } from './transferRegisters.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import { answerMatrixRequest } from './matrixRequest.js';
import { binaryEditSrcId } from '../common/srcId.js';
import type { TableToHostMessage } from '../common/protocol.js';
import { EditStackMirror, OVERWRITE, REVERT, type DiskStamp } from './diskConflict.js';
import { followDisk, refuseIfChangedOnDisk, stampOf, watchDisk, type FollowedDocument } from './diskFollow.js';

// viewType of the default byte-backed view (BinaryEditorProvider), which owns the rule
// that picks an editor from a .sldd's bytes. A constant here rather than an import,
// because importing that provider would be circular — the same reason it spells this
// provider's viewType out as a constant of its own.
const BINARY_VIEW_TYPE = 'dataExplorer.binaryView';

/** A source deleter's answer when nothing in the document answers to the names it was given. */
const NOT_FOUND = 'nothing in it answers to that name any more';

/**
 * One open view of a document: the two ways the document can ask it to repaint.
 *
 * A document can have several views — "Split Editor" resolves a second webview panel
 * against the SAME document — and they share one model, so a change is applied to the
 * model once at document scope and then painted once per view. That is why this is an
 * interface rather than the single repaint callback it replaces: a document with two
 * panels used to keep only the last one's, so an undo repainted one panel and left the
 * other showing pre-undo rows (and closing either panel left undo repainting nothing
 * at all).
 */
interface DocumentView {
  /**
   * Repaint every row.
   *
   * `from` says where the tree comes from. `'chunk'` (the default) re-registers the source
   * from chunkXml, which is what every caller that swapped the text under the model needs —
   * the wide fallback exists precisely because the model may not match the text any more.
   * `'registered'` paints the source the session already holds, for the one caller that has
   * just registered a tree built from that same chunkXml itself (a save) and would
   * otherwise pay a whole second parse to produce the same tree.
   */
  repaintAll(from?: ModelSource): void;
  /** Repaint just the rows the applied ops touched. */
  repaintOps(applied: AppliedOp[]): void;
}

/** Where a wide repaint gets its tree — see `DocumentView.repaintAll`. */
type ModelSource = 'chunk' | 'registered';

/**
 * One read of a document's `data/chunk0.xml`, kept so it is not read twice.
 *
 * All three fields travel together on purpose:
 *
 *  - `warnings` is the sink core's parse filled, and `DataModel.addDataSource` appends the
 *    node layer's findings to the SAME array. Handing the content on without its sink
 *    would register a source that reports only half of what reading the file found.
 *  - `chunkXml` is the exact payload this was read from, so a later reuse can check that
 *    it is still the document's payload. A save awaits its `writeFile`, and the webview
 *    can land an edit on that await — reusing a read of the pre-edit text after that
 *    happened would register a model the text no longer matches.
 */
interface ParsedChunk {
  chunkXml: string;
  content: Record<string, unknown>;
  warnings: ParseWarning[];
}

/**
 * The zip members a document carries through untouched: every member except the one its
 * entries live in, which this editor holds as `chunkXml` and re-inserts on save.
 *
 * One function for the two reads that need it — the one that OPENS a document and the one
 * that REPLACES an open one — because the exclusion is a single rule, and a second copy of
 * it that missed would not throw.
 *
 * What it would cost is worth stating precisely, because it is NOT correctness today and a
 * comment claiming otherwise invites someone to "prove" it with a test that cannot exist.
 * Measured against the pinned core: a bag that still held the data member would be ignored
 * by `readSlddParts` (`parseBinarySlddParts` reads only `metadata/mwcoreProperties.xml` and
 * the System Composer part out of that bag) and then overwritten by `writeTo`, which
 * re-inserts the member from `chunkXml` after spreading the bag. So the saved package would
 * be byte-identical.
 *
 * The cost is memory: a second copy of the whole payload held for the lifetime of every open
 * document, which on the 47.8 MB dictionary this editor exists for is 47.8 MB of duplicate.
 * And it is a correctness cost the moment core starts reading the data member out of the bag
 * it is handed — which is why the exclusion stays, and why the test that pins it asserts the
 * BAG (integration: `binarySlddEdit.test.ts`) rather than the saved bytes, which cannot tell.
 */
function passThroughParts(zip: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) if (member !== DATA_PART_XML) parts[member] = data;
  return parts;
}

/**
 * One read of the file behind a document, with the stamp it was read under.
 *
 * The stat comes BEFORE the read, so a write that lands between the two leaves an old stamp
 * on new bytes. The next save then asks about a conflict it did not need to. The other order
 * would leave a new stamp on old bytes, and the next save would silently overwrite the write
 * it missed.
 */
interface DiskRead {
  stamp: DiskStamp | undefined;
  zip: Record<string, Uint8Array>;
}

async function readDisk(uri: vscode.Uri): Promise<DiskRead> {
  const stamp = await stampOf(uri);
  const bytes = await vscode.workspace.fs.readFile(uri);
  return { stamp, zip: unzipSync(bytes) };
}

const recordName = (record: EntryRecord): string => String(record.name ?? '');
const recordUuid = (record: EntryRecord): string | undefined => {
  const uuid = (record.metadata as Record<string, unknown> | undefined)?.uuid;
  return typeof uuid === 'string' && uuid ? uuid : undefined;
};

/**
 * The entries an edit changes, by entryKey: those its patch names — every op that builds an
 * entry carries its record, and a removal's record is the inverse op's, on the other side — or,
 * for an edit that could not state a patch, those whose text differs between its two chunks.
 */
function keysOfEdit(before: string, after: string, patch?: EntryPatch): Set<string> {
  const keys = new Set<string>();
  for (const op of patch ? [...patch.undo, ...patch.redo] : []) {
    if (op.kind !== 'remove') keys.add(entryKey(recordName(op.record), recordUuid(op.record)));
  }
  return keys.size > 0 || before === after ? keys : changedEntryKeys(before, after);
}

/**
 * For each entry an edit's patch rebuilds in its slot, its key before the edit (its undo
 * record's), by the row id it has after the edit, which is the one its undo op addresses.
 */
function keysBeforeEdit(patch: EntryPatch): Map<string, string> {
  const keys = new Map<string, string>();
  for (const op of patch.undo) {
    if (op.kind === 'replace') keys.set(op.rowId, entryKey(recordName(op.record), recordUuid(op.record)));
  }
  return keys;
}

/** How many ops look their fragment up one at a time; more share one scan of the chunk. */
const FRAGMENT_LOOKUPS = 4;

/**
 * Give each op that rebuilds an entry that entry's `<Object>` text in `chunk`, the chunk state
 * the op restores, so the entry it rebuilds keeps the bytes it came from (entryOps'
 * EntryFragment). Once per op: an op restores the same chunk every time it runs. A few ops each
 * look theirs up with core's findEntryObjectSpan, which on the largest dictionary measured
 * (207 MB) is ~6× faster than a scan; more share one scan. One cut from the wrong place costs
 * nothing but the provenance: entryOps uses a fragment only when it reads as exactly the entry
 * the op's record names.
 */
function cutFragments(chunk: string, ops: EntryOp[]): void {
  const wanting = ops.filter((op) => op.kind !== 'remove' && op.fragment === undefined) as Exclude<
    EntryOp,
    { kind: 'remove' }
  >[];
  if (wanting.length === 0) return;
  if (wanting.length <= FRAGMENT_LOOKUPS) {
    for (const op of wanting) {
      const span = findEntryObjectSpan(chunk, { name: recordName(op.record), uuid: recordUuid(op.record) });
      op.fragment = span ? chunk.slice(span.offset, span.offset + span.length) : null;
    }
    return;
  }
  const scan = scanChunkEntries(chunk);
  const found = new Map<string, { start: number; end: number }[]>();
  for (const entry of scan.clean ? scan.entries : []) {
    const key = chunkEntryKey(entry);
    found.set(key, [...(found.get(key) ?? []), entry]);
  }
  for (const op of wanting) {
    const list = found.get(entryKey(recordName(op.record), recordUuid(op.record)));
    op.fragment = list?.length === 1 ? chunk.slice(list[0].start, list[0].end) : null;
  }
}

class BinarySlddDocument implements vscode.CustomDocument, FollowedDocument {
  chunkXml: string;
  readonly zipMeta: Record<string, Uint8Array>;

  /**
   * The chunk as this document last read or wrote it — opened, saved, reverted or reloaded —
   * which the save gate holds a save to (binarySaveGate.ts). A document restored from a hot-exit
   * backup read the backup, so that is its chunk until it is saved: the edits in a backup were
   * made in another session, and nothing is left that could check them.
   */
  saved: SavedChunk;

  /**
   * The entries the edits since `saved` have changed, by entryKey: every entry not in here must
   * be its bytes in `saved`. Each edit adds what it changes, and so does each undo and redo of
   * it, so an entry edited and then undone stays in here. That is safe, since an entry back to
   * its bytes passes either way. Emptied whenever `saved` is replaced.
   */
  edited = new Set<string>();

  /**
   * The entries the edits since `saved` have changed while core's check could not be held to
   * them, each key mapped to every key that entry has gone by (binarySaveGate's
   * uncheckableEntries): the save gate refuses any of them whose text is not `saved`'s. Asked
   * when each edit is made, while the entry's node still holds the bytes it was read from, since
   * a redo or a re-read rebuilds the node from the text the edit wrote. Like `edited`, each undo
   * and redo puts its edit's back, and it is emptied whenever `saved` is replaced.
   */
  unchecked = new Map<string, ReadonlySet<string>>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChange.event;

  /** The open views of this document, registered by resolveCustomEditor. */
  readonly views = new Set<DocumentView>();

  /**
   * Whether the on-open baseline has been captured. Document-scoped, not per view:
   * captureBaseline is keyed by URI and OVERWRITES, so a second panel opened after an
   * edit would re-baseline against the edited content and clear every Modified mark.
   */
  baselineCaptured = false;

  /**
   * Whether the bytes behind this document are not a zip, so this editor is the wrong one
   * for them — see the misroute guard in `openCustomDocument`. Such a document holds no
   * content at all; `resolveCustomEditor` hands the file back to the default view and
   * disposes its panel before anything reads `chunkXml`.
   */
  readonly misrouted: boolean;

  // --- Following the file on disk (the rules are in diskConflict.ts) ---

  /**
   * This document's copy of the dirty flag VS Code keeps, which the API gives no way to
   * read. The watcher uses it to choose between reloading and keeping unsaved edits.
   */
  readonly edits: EditStackMirror;

  /**
   * The file's mtime+size as this view last loaded, reverted to, or wrote it. A save compares
   * the disk with this, and the watcher ignores any event that leaves the disk matching it.
   * That is how the view's own saves are kept from counting as outside changes.
   */
  stamp: DiskStamp | undefined;

  /**
   * A save was refused because the file changed on disk, and nothing has resolved that yet.
   * This mirrors VS Code's conflict state for a text file: a later save, auto-save included,
   * does not ask again unless `promptsForConflict` says so. Cleared by a save that writes
   * and by a revert.
   */
  inConflict = false;

  /** The Overwrite / Revert prompt is showing. */
  conflictPromptOpen = false;

  /**
   * The outside version the user answered Overwrite for. A save writes over that version
   * without asking. A later outside change has a different stamp, so it is asked about
   * again. Cleared by any save that writes and by a revert.
   */
  overwriteStamp: DiskStamp | undefined;

  /** A save is in flight. The watcher waits, so it never reloads in the middle of one. */
  saving = false;

  disposed = false;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    public readonly uri: vscode.Uri,
    chunkXml: string,
    zipMeta: Record<string, Uint8Array>,
    misrouted = false,
    fromBackup = false,
  ) {
    this.chunkXml = chunkXml;
    this.saved = new SavedChunk(chunkXml);
    this.zipMeta = zipMeta;
    this.misrouted = misrouted;
    // VS Code reports a document restored from a hot-exit backup as dirty, though it has no
    // edits, until it is saved or reverted.
    this.edits = new EditStackMirror(fromBackup);
  }

  /** Something to dispose with this document: today, its watcher. */
  track(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  // Prefixed, so this editable model never collides with the read-only
  // BinaryEditorProvider's cached model of the same uri (DataModel is a singleton). The
  // prefix and its removal live together in common/srcId.ts — a link target core builds out
  // of this srcId has to be read back as a document, which is what needs the pair to agree.
  get srcId(): string {
    return binaryEditSrcId(this.uri.toString());
  }

  /**
   * The `meta.path` this document's source is registered with. NOT a display name: the
   * tree node is named from `srcId` (`SlddNode.parse` takes it as the node's name), the
   * `source-empty` warning quotes `srcId` too, and this extension's webview never reads
   * the DTO's `path`. Its one live reader is core's `openSourceNamed`, which is how a
   * model's `gravity@params.sldd` link finds an already-open dictionary.
   *
   * From `uri.path`, which is DECODED, rather than from the srcId, which is not. That
   * lookup tries the srcId's own basename first, and for this provider the srcId is
   * `binaryEditSrcId(uri.toString())` — percent-encoded, so a dictionary named `my
   * params.sldd` is `my%20params.sldd` there and matches nothing a model recorded. The
   * decoded basename is the only spelling that answers for a file with a space in its
   * name, which on the paths MATLAB projects live on is the common case, not the corner.
   *
   * One getter rather than a `basename(...)` at each registration because this document
   * is registered from TWO places under the same srcId — `resolveCustomEditor`, for every
   * paint and mid-transform rebuild, and `reBaseline` after a save — and if they
   * disagreed, saving would change whether a model's link to this dictionary resolves.
   */
  get metaPath(): string {
    return basename(this.uri.path) || 'document';
  }

  /**
   * Push an edit onto VS Code's native undo stack.
   *
   * `patch` names the entries each direction changes, so undo and redo can bring the
   * model and the rows back in step WITHOUT re-parsing. It is optional, and every
   * caller that cannot state one (or whose snapshot failed) simply omits it: the
   * direction then repaints the old way, from a re-parse of the text it just restored.
   * That is the safety property the narrow paths rest on — a missing or wrong patch
   * costs latency, never correctness.
   *
   * `part` is a pass-through zip member this edit also changed — today only the System
   * Composer catalog, which a rename of an architectural entry has to move because it
   * lists the entry by name. It travels with the chunk in both directions, and it forces
   * both of them WIDE: what a catalogued rename changes is how an entry CLASSIFIES, and
   * only a re-read of the chunk and the parts together derives that. The entry ops would
   * rebuild it against the catalog the model is holding, which is a step ahead.
   */
  pushEdit(label: string, before: string, after: string, patch?: EntryPatch, part?: ScPartPatch): void {
    // What the save gate is told this edit changes, in both directions — see `edited`.
    const changed = keysOfEdit(before, after, patch);
    // And which of those entries the check cannot be held to, asked now — see `unchecked`.
    const uncheckable = uncheckableEntries(
      DataModel.getDataSource(this.srcId) ?? null,
      changed,
      patch ? keysBeforeEdit(patch) : null,
    );
    this.chunkXml = after;
    this.markEdited(changed);
    this.markUnchecked(uncheckable);
    if (part) this.zipMeta[part.member] = part.after;
    // The dirty-flag copy moves with VS Code's stack: this push, and each undo or redo VS
    // Code asks for through the two closures below.
    this.edits.pushed();
    this._onDidChange.fire({
      document: this,
      label,
      undo: () => {
        this.edits.undone();
        this.markEdited(changed);
        this.markUnchecked(uncheckable);
        this.chunkXml = before;
        if (part) this.zipMeta[part.member] = part.before;
        this.applyOps(part ? undefined : patch?.undo);
      },
      redo: () => {
        this.edits.redone();
        this.markEdited(changed);
        this.markUnchecked(uncheckable);
        this.chunkXml = after;
        if (part) this.zipMeta[part.member] = part.after;
        this.applyOps(part ? undefined : patch?.redo);
      },
    });
  }

  private markEdited(keys: ReadonlySet<string>): void {
    for (const key of keys) this.edited.add(key);
  }

  /** Record entries in `unchecked`, each group the keys of one entry, joined to any it shares one with. */
  markUnchecked(groups: Iterable<Iterable<string>>): void {
    for (const group of groups) {
      const keys = new Set<string>(group);
      for (const key of [...keys]) for (const alias of this.unchecked.get(key) ?? []) keys.add(alias);
      for (const key of keys) this.unchecked.set(key, keys);
    }
  }

  /**
   * Make this document hold what `read` found on disk: the chunk, the pass-through parts, and
   * the stamp they were read under. Shared by a revert and by the watcher's reload, so both
   * replace the document the same way.
   */
  applyDisk(read: DiskRead): void {
    const chunk = read.zip[DATA_PART_XML];
    if (chunk) {
      this.chunkXml = new TextDecoder().decode(chunk);
      // What a save is held to from now on, and nothing yet edited against it.
      this.saved = new SavedChunk(this.chunkXml);
      this.edited = new Set();
      this.unchecked = new Map();
      // The parts too, and for the same reason: an edit can have patched one of them (a
      // rename carried into the System Composer catalog), and a revert that restored only
      // the chunk would leave the entry named as the file spells it beside a catalog that
      // no longer classifies it — then write that pair out on the next save.
      this.resetParts(read.zip);
      // Only when the content was replaced. A file with no chunk left the document as it
      // was, so the next save must still treat the disk as changed.
      this.stamp = read.stamp;
      // The document now holds what is on disk, so there is nothing left to be in conflict
      // with.
      this.inConflict = false;
      this.overwriteStamp = undefined;
    }
    // Wide on purpose: a revert replaces the whole document, so there is no narrower
    // truth to tell the table than "everything you are showing came from elsewhere".
    this.repaintAll();
  }

  /**
   * Replace every pass-through part, for a read that replaced the whole document.
   *
   * In place, because `zipMeta` is the object `writeTo` re-zips and `readSlddParts` reads
   * the catalog out of — handing either of them a different object later is how a revert
   * ends up writing a chunk from disk beside a part an undone edit patched.
   */
  resetParts(zip: Record<string, Uint8Array>): void {
    for (const member of Object.keys(this.zipMeta)) delete this.zipMeta[member];
    Object.assign(this.zipMeta, passThroughParts(zip));
  }

  /**
   * Bring the model and every view in step with a chunkXml just swapped under them.
   *
   * The narrow route needs both halves to succeed — the model ops AND a live model to
   * apply them to — so anything unexpected falls back to the wide repaint. That is a
   * complete recovery even from a half-applied op list: repaintAll re-registers the
   * source from chunkXml, which is already the text this restore intended.
   */
  applyOps(ops?: EntryOp[]): void {
    if (ops && ops.length > 0) {
      try {
        const model = DataModel.getDataSource(this.srcId);
        if (model) {
          // chunkXml is already the text this undo or redo restores: what the ops rebuild
          // their entries from.
          cutFragments(this.chunkXml, ops);
          this.repaintOps(applyEntryOps(model, ops));
          return;
        }
      } catch {
        /* fall through to the wide repaint */
      }
    }
    this.repaintAll();
  }

  repaintAll(from: ModelSource = 'chunk'): void {
    // Copied because a repaint can dispose a view (an error path re-registers), and a
    // Set mutated mid-iteration is how one view's failure silently skips another's.
    for (const view of [...this.views]) view.repaintAll(from);
  }

  repaintOps(applied: AppliedOp[]): void {
    for (const view of [...this.views]) view.repaintOps(applied);
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables.splice(0)) d.dispose();
    DataModel.removeDataSource(this.srcId);
    this._onDidChange.dispose();
  }
}

export class BinarySlddEditorProvider implements vscode.CustomEditorProvider<BinarySlddDocument> {
  public static readonly viewType = 'dataExplorer.binarySlddView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;
  // Handle a Usage-column link click (wired in extension.ts).
  public onNavigate?: (target: string, referrer?: string) => void;

  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  /**
   * Ask the user about a save refused because the file changed on disk, and resolve with
   * the button they chose. A property so that the integration suite, which cannot click a
   * notification, can answer for them.
   *
   * An error notification, because VS Code shows its own version of this prompt as one.
   */
  askSaveConflict: (message: string) => Thenable<string | undefined> = (message) =>
    vscode.window.showErrorMessage(message, OVERWRITE, REVERT);

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<BinarySlddDocument> {
    const source = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri;
    // The FILE's stamp, even when the content comes from a backup, because the file is
    // what a save will write over. Taken before the read, for the reason given at readDisk.
    const stamp = await stampOf(uri);
    const bytes = await vscode.workspace.fs.readFile(source);
    // A custom editor's selector is a filename glob, and the two .sldd formats are not
    // distinguishable by name — so "Reopen Editor With…" offers THIS view for every
    // *.sldd, including a JSON one, which has nothing for `unzipSync` to read. That
    // unzip used to throw here, before any panel existed, which the user saw as
    // "invalid zip data" on a file the default view opens perfectly well.
    //
    // Answer it the way the default view answers the mirror case, by handing the file
    // back rather than by classifying it here: `resolveCustomEditor` reopens it with
    // `dataExplorer.binaryView`, which owns the one format-to-editor rule. Deciding
    // "JSON ⇒ the table view" locally would be that rule's second copy, and would get
    // the over-the-sync-limit dictionary wrong — the default view keeps that one
    // read-only, because the text-backed table cannot resolve it at all.
    //
    // Restoring a hot-exit backup reaches here too, and `writeTo` always writes a zip,
    // so a backup takes the normal path.
    if (!isZipBytes(bytes)) return new BinarySlddDocument(uri, '', {}, true);
    const zip = unzipSync(bytes);
    const chunk = zip[DATA_PART_XML];
    if (!chunk) throw new Error(`Missing ${DATA_PART_XML} in binary SLDD`);
    const chunkXml = new TextDecoder().decode(chunk);
    const doc = new BinarySlddDocument(uri, chunkXml, passThroughParts(zip), false, !!openContext.backupId);
    doc.stamp = stamp;
    // Relay the document's edit events to the provider-level emitter VS Code listens on.
    doc.onDidChangeCustomDocument((e) => this._onDidChangeCustomDocument.fire(e));
    doc.track(this.watchDisk(doc));
    return doc;
  }

  /**
   * Follow the file on disk, the way VS Code follows a text file it has open (diskFollow.ts,
   * shared with the MAT-file editor): reload a clean document from what the disk now holds,
   * through the same `applyDisk` a revert uses, and leave unsaved edits alone.
   */
  private watchDisk(document: BinarySlddDocument): vscode.Disposable {
    return watchDisk(document, () => followDisk(document, () => readDisk(document.uri), (read) => document.applyDisk(read)));
  }

  async resolveCustomEditor(
    document: BinarySlddDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Not a zip, so not ours — see the misroute guard in openCustomDocument. Reopen with
    // the default byte-backed view, which routes on the bytes, and dispose THIS panel so
    // only the tab that cannot render the file goes away.
    if (document.misrouted) {
      await vscode.commands.executeCommand('vscode.openWith', document.uri, BINARY_VIEW_TYPE);
      webviewPanel.dispose();
      return;
    }

    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    webviewPanel.iconPath = new vscode.ThemeIcon('table');
    const uriString = document.uri.toString();
    const name = document.metaPath;

    // Which builder plans this file's rows AND answers a fetch for them (rowPlanner.ts).
    // Planning an editable view is admissible for the reasons set out in
    // SlddTextEditorProvider: the names are all delivered, each entry's rows stay one
    // contiguous run for the splice, and an edit resolves through the model, not the rows.
    const planner = rowPlannerFor(name);

    // Register `xml` as this document's source and answer the tree. Every rebuild in
    // this provider goes through here — paint, the two mid-transform rebuilds — so
    // that a source registered halfway through a cut/paste is the same shape as the
    // one paint builds, warnings included. The sink is threaded rather than left to
    // default because the two halves of the read report separately: the zip parser
    // fills this array, then SlddNode.parse appends to the same one, and a fresh list
    // at the second step would drop everything the first found.
    const registerModel = (xml: string) => {
      DataModel.removeDataSource(document.srcId);
      const warnings: ParseWarning[] = [];
      const content = readSlddParts(xml, document.zipMeta, warnings);
      return DataModel.addDataSource(document.srcId, content, { path: name }, warnings);
    };
    // Rebuild the model from the live chunkXml (+ pass-through parts).
    const buildModel = () => registerModel(document.chunkXml);
    // The model as it already stands, WITHOUT re-parsing — what every edit should
    // start from.
    //
    // At rest the registered source describes exactly document.chunkXml. The only
    // things that change chunkXml are pushEdit and revertCustomDocument, and each of
    // them either changes the model to match (an edit mutates it in place or applies
    // entry ops; see entryOps.ts) or re-registers it wholesale (the wide repaint).
    // Nothing can handle a message in between: every one of those stretches is
    // synchronous up to the repaint.
    //
    // Re-parsing here instead is what made an edit cost seconds: on a real customer
    // dictionary (75 MB of data/chunk0.xml, 31k entries) fast-xml-parser alone takes
    // ~3s, and applyEdit paid it once before touching the model and post() paid it
    // again afterwards to rebuild a tree that was already correct.
    const liveModel = () => (DataModel as any).getDataSource?.(document.srcId) ?? buildModel();
    // Every path that takes the entry-scoped repaint mutates through entryOps.mutateEntry —
    // shared with the JSON provider so that "an edit that keeps its model repairs the node
    // index" is one rule rather than a habit each provider keeps separately. The paths that
    // fall back to post() do not need it: post() re-registers, which is the same repair at
    // whole-source scope. See entryOps.ts for why it is an obligation and not bookkeeping.
    const findNode = (rowId: string): any => {
      const found = (DataModel as any).findNodeById?.(rowId);
      return found ?? null;
    };

    // The clipboard mark this document's rows should carry, if any. Shared by the
    // full and entry-scoped repaints so a cut/copied entry renders its affordance
    // the same way whichever one painted it.
    // Every entry the clipboard holds carries the mark, each keyed by its OWN source
    // section: a multi-row cut can span sections, so one shared section would dim the
    // wrong rows.
    const clipMarkOfDoc = (): ClipMark | undefined => {
      const clip = getClipboard();
      if (!clip || clip.sourceDocUri !== uriString) return undefined;
      const keys = new Set<string>();
      for (const it of clip.items) {
        const name = it.payload.name;
        if (typeof name === 'string' && name) keys.add(clipMarkKey(it.sourceSection, name));
      }
      return keys.size ? { keys, mode: clip.mode } : undefined;
    };

    const post = (from: ModelSource = 'chunk') => {
      try {
        // 'registered' is only ever passed by a caller that has just registered a tree
        // built from this document's chunkXml (see saveCustomDocument); liveModel falls
        // back to building one if the source is somehow gone, so this cannot paint from
        // nothing.
        const node = from === 'registered' ? liveModel() : buildModel();
        if (!document.baselineCaptured) {
          captureBaseline(uriString, node);
          document.baselineCaptured = true;
        }
        const modified = computeModified(uriString, node);
        const clipMark = clipMarkOfDoc();
        const planned = planner.payload(node, LAZY_ROW_BUDGET, { modifiedNames: modified, clipMark });
        const rows = planned.rows;
        // Through postOrReport, and NOT awaited: the postMessage itself (and the
        // serialization that can fail in it) still happens in this synchronous run, so
        // the paint is as prompt as it was; only the error report is deferred. Without
        // it, a payload too large for the webview RPC rejects where the catch below
        // cannot see it and the table waits on its spinner for ever. Not capped, unlike
        // the read-only view: these rows are editable — see SlddTextEditorProvider.
        void postOrReport(
          webview,
          {
            type: 'setRows',
            docUri: uriString,
            rows,
            columns: COLUMNS,
            columnLabels: COLUMN_LABELS,
            columnGroups: COLUMN_GROUPS,
            editable: true,
            // What the read of this dictionary could not read, and what the plan held
            // back. Rebuilt with the model on every repaint rather than captured on open,
            // because an edit rewrites chunkXml and the answer is about the chunk as it
            // stands — a warning that outlived the part it was about would be worse than
            // none.
            warnings: lazyRowsBanner(planned.plan, warningBanner(sourceWarnings(node))),
          },
          name,
        );
        webview.postMessage({ type: 'sectionRules', docUri: uriString, rules: sectionRules(node) });
        webview.postMessage({ type: 'clipboardState', ...clipboardState() });
        paintedMark = clipMarkOfDoc();
        drainNavigateSelect(webview, uriString);
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to parse ${name}: ${(err as Error).message}` });
      }
    };

    // One entry's rows, stamped the way buildRows would stamp them.
    //
    // The per-entry form of the two whole-model passes post() runs: the baseline diff
    // and the clipboard mark. Both are asked about ONE entry here — computeModified
    // would serialize all 31,000 of them to answer about one — and both must answer the
    // same as the wide path, or a "Modified" dot or a cut affordance would appear and
    // disappear depending on which repaint the user happened to trigger.
    const entryRows = (entry: any, section: any): any[] => {
      // A set rather than a boolean keeps buildEntryRows' existing contract, which also
      // lets it CLEAR a stale mark — see the Status comment in rowBuilder.
      const modified = new Set<string>();
      if (isEntryModified(uriString, entry)) modified.add(entry.name);
      // Planned to the same budget the payload used, so a repaint of one huge entry
      // cannot post more than the RPC carries — see the note at the sibling call site in
      // SlddTextEditorProvider.
      return buildEntryRows(entry, section.name, modified, clipMarkOfDoc(), undefined, LAZY_ROW_BUDGET);
    };

    /**
     * Repaint only the rows the applied ops touched.
     *
     * The fast path, and the reason an edit and its undo are milliseconds instead of
     * seconds. It rebuilds nothing but the affected entries' subtrees — from the model
     * that is already correct — and sends only those rows, which the webview splices
     * over the runs it already holds. No re-parse, no 130k-row rebuild, no 67 MB
     * postMessage.
     *
     * The row ids in an op are the ones the TABLE spells, which on a rename is the
     * entry's OLD id: the splice has to find the run that is on screen, not the one
     * that will be. See AppliedOp.
     *
     * Any surprise here — an entry that ended up detached, a row build that throws —
     * falls back to the wide repaint, which builds these same rows by the other path.
     */
    const repaintOps = (applied: AppliedOp[]) => {
      try {
        for (const op of applied) {
          if (op.kind === 'remove') {
            // An empty replacement IS the removal — see spliceEntryRows.
            webview.postMessage({ type: 'updateEntryRows', entryRowId: op.entryRowId, rows: [] });
            continue;
          }
          const section = op.entry?.parent;
          if (!section) throw new Error(`"${op.entry?.name}" is not in a section.`);
          const rows = entryRows(op.entry, section);
          if (op.kind === 'replace') {
            webview.postMessage({ type: 'updateEntryRows', entryRowId: op.entryRowId, rows });
          } else {
            webview.postMessage({
              type: 'insertEntryRows',
              sectionRowId: buildSectionRowId(section.name),
              beforeRowId: op.beforeRowId,
              rows,
            });
          }
        }
      } catch (err) {
        // The model change already landed, so the table must not be left showing the
        // rows from before it. Repaint wide, then say so — after, because the repaint
        // clears the banner the message writes.
        post();
        webview.postMessage({ type: 'error', message: `Failed to update the row: ${(err as Error).message}` });
      }
    };

    // Repaint ONE entry, the shape every within-entry edit takes.
    const postEntry = (entry: any, entryRowId: string) => repaintOps([{ kind: 'replace', entryRowId, entry }]);

    /**
     * The clipboard mark this view has already painted, and the narrow repaint that
     * keeps it current.
     *
     * A cut or copy makes no document edit, yet the source row must gain or lose its
     * affordance, so the hub asks every open table to repaint on every clipboard
     * broadcast — and "repaint" used to mean the whole table, which made a copy in ANY
     * open .sldd cost this document a full re-parse. Only the entries the two marks
     * name can be affected: the ones the clipboard just took and the ones it held
     * before. A broadcast that changes neither (the usual case — the mark belongs to
     * another document) now costs nothing at all.
     *
     * An affected entry that is no longer in the model is skipped rather than repainted
     * wide: its rows are already gone (a cut+paste moves the very entry that held the
     * mark), so there is nothing left to un-dim.
     */
    let paintedMark: ClipMark | undefined;
    // Order-independent: the same entries marked in a different order is the SAME mark,
    // and repainting for it would be a repaint the user's rows do not need.
    const markKey = (mark?: ClipMark): string =>
      mark ? JSON.stringify([mark.mode, [...mark.keys].sort()]) : '';
    const repaintClipMark = () => {
      const next = clipMarkOfDoc();
      if (markKey(paintedMark) === markKey(next)) return;
      // Every entry either mark names: the ones losing the affordance and the ones
      // gaining it. A key present in both yields one repaint (the `seen` guard below),
      // as does a copy re-taken as a cut.
      const affected = new Set<string>([...(paintedMark?.keys ?? []), ...(next?.keys ?? [])]);
      let model: any;
      try {
        model = liveModel();
      } catch {
        // No tree to name the affected entries in (liveModel re-reads the chunk when none is
        // registered, and that read failed). The wide repaint is both the fallback and where
        // the read error is reported; paintedMark is left alone because nothing was painted.
        // As in the JSON view, where this guard came from.
        post();
        return;
      }
      paintedMark = next;
      const ops: AppliedOp[] = [];
      const seen = new Set<string>();
      for (const key of affected) {
        const { section, name } = splitClipMarkKey(key);
        const entry = findEntryByName(model, section, name);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        ops.push({ kind: 'replace', entryRowId: entry.id, entry });
      }
      if (ops.length > 0) repaintOps(ops);
    };

    const view: DocumentView = { repaintAll: post, repaintOps };
    document.views.add(view);

    /**
     * Run a patch/op-list builder, or give up.
     *
     * Every op list is a best effort: serializing an entry, or naming the one an op
     * addresses, can fail in ways that must not fail the EDIT — the text transform has
     * already succeeded by then, and an undo that repaints wide is merely slow. So a
     * builder that throws or gives up yields nothing, and that edit takes the old wide
     * path in both directions.
     */
    const attempt = <T>(build: () => T | undefined): T | undefined => {
      try {
        return build();
      } catch {
        return undefined;
      }
    };

    // Register with the cross-provider hub so clipboard/drag state broadcasts
    // from ANY .sldd table (JSON or binary) reach this webview, and so a
    // cross-document move whose SOURCE is this binary .sldd can complete its
    // source-delete via a format-appropriate edit (an in-memory chunkXml splice
    // pushed onto this document's own undo stack, then a repaint).
    registerWebview(webview, repaintClipMark);
    // And so the Add-gallery keybinding, which has no view of its own to act on, can open
    // this one's gallery when this is the panel the user is looking at.
    registerAddGalleryView(webviewPanel, () => void webview.postMessage({ type: 'openAddGallery' }));
    registerSourceDeleter(uriString, (targets) => {
      const before = document.chunkXml;
      const after = deleteEntriesByNameXml(before, targets);
      // Nothing answers to those names any more: renamed or deleted since the cut. Said, because
      // the move's other half has landed and the user is left holding a copy.
      if (after === before) return { removed: false, reason: NOT_FOUND };
      // The model half of the delete, narrowly when every target resolves to exactly
      // one live entry. Deliberately keyed on the SAME targets the text splice used, so
      // the two halves cannot remove different entries. removalPairs refuses before it
      // removes anything, so a target it cannot settle costs the narrow path and no more:
      // the wide repaint below rebuilds from the chunk that is already right.
      const removal = attempt(() => removalPairs(liveModel(), targets) ?? undefined);
      document.pushEdit('Move (remove source)', before, after, removal ? patchOfPairs(removal.pairs) : undefined);
      // Repainted through the document (not this view) so every view of it repaints —
      // this deleter runs on behalf of ANOTHER document's drop, so the view it belongs to
      // is not the one being interacted with.
      if (removal) document.repaintOps(removal.applied);
      else document.repaintAll();
      return { removed: true };
    });

    /**
     * A structural transform WITHIN one entry: add a nested child, delete one.
     *
     * Always entry-scoped, even when the target row IS the entry (a top-level Bus
     * gaining an element): a nested child is a row inside the entry's run, so the whole
     * entry's rows are rebuilt and nothing else in the table moves. Deleting the ENTRY
     * itself is the other shape — see applyDeleteEntry.
     *
     * Both directions of the undo are a `replace` of that one entry, from a record
     * snapshotted on either side of the transform. That is what makes an undo cost the
     * same as the edit: the entry is rebuilt from its own serialized state instead of
     * the dictionary being re-parsed to recover it.
     */
    const applyStructural = (
      rowId: string,
      transform: (xml: string, node: any) => StructuralResult,
      label: string,
    ) => {
      liveModel();
      const node = findNode(rowId);
      if (!node) {
        webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
        return;
      }
      const entry = findOwningEntry(node);
      if (!entry) {
        webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
        return;
      }
      // Snapshot before the transform, which mutates the model: the entry's pre-edit
      // state is the whole undo, and its id is what the table still shows.
      const entryRowId = entry.id;
      const undoOps = attempt(() => [replaceOp(entry, entryRowId)]);
      try {
        const before = document.chunkXml;
        // Through mutateEntry: these transforms mutate the model (addChildToModel /
        // removeChildFromModel) before they splice the text, and the repaint that follows
        // skips the re-parse that used to repair the node index.
        const { newText, selectId } = mutateEntry(entry, () => transform(before, node));
        const redoOps = attempt(() => [replaceOp(entry, entryRowId)]);
        document.pushEdit(label, before, newText, undoOps && redoOps ? { undo: undoOps, redo: redoOps } : undefined);
        document.repaintOps([{ kind: 'replace', entryRowId, entry }]);
        if (selectId) webview.postMessage({ type: 'selectRows', rowIds: [selectId] });
      } catch (err) {
        // These transforms mutate the model BEFORE they splice the text
        // (removeChildFromModel / addChildToModel), so a transform that throws half-way
        // leaves a model that no longer matches chunkXml. The edit path now trusts that
        // model instead of re-deriving it, so the mismatch has to be undone here rather
        // than waiting for the next repaint to paper over it. First, because the repaint
        // clears the error banner the message writes.
        document.repaintAll();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    /**
     * Delete a whole top-level entry.
     *
     * The one structural edit that changes WHICH entries the dictionary has, so it is
     * the one that cannot be a `replace`: forward it is a remove, and its undo is an
     * insert of the record at the position it came from. That position matters — undo
     * restores the text with the entry back in its original place in the XML entry list,
     * and a re-parse of that text would order it there, so the model has to agree.
     *
     * deleteEntryXml is a text-only splice by design (it leaves the entry in the model,
     * which used to catch up by being re-parsed), so the model half is an op here.
     */
    const applyDeleteEntry = (entry: any) => {
      const entryRowId = entry.id;
      // Both lists are read while the entry is still attached: insertOp needs its
      // section and index, and both need its serialized state.
      const patch = attempt(() => ({ undo: [insertOp(entry)], redo: [removeOp(entryRowId)] }));
      try {
        const before = document.chunkXml;
        // Before the model op: deleteEntryXml picks the row to select next from the
        // entry's siblings, and the entry has to still be among them.
        const { newText, selectId } = deleteEntryXml(before, entry);
        const applied = applyEntryOps(liveModel(), [removeOp(entryRowId)]);
        document.pushEdit('Delete', before, newText, patch);
        document.repaintOps(applied);
        if (selectId) webview.postMessage({ type: 'selectRows', rowIds: [selectId] });
      } catch (err) {
        // Nothing was pushed, so chunkXml is untouched; the model may not be. Rebuild
        // from the text, which is the state the user still has.
        document.repaintAll();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    /**
     * Delete SEVERAL rows as ONE edit.
     *
     * Delete acts on ROWS (see webview/operands.ts), so its operands can mix whole entries
     * with nested children of other entries. This format's undo stack is this document's
     * own and steps by pushEdit, so the whole gesture is ONE push: one `after` string built
     * by folding every removal, and one op list describing all of them. applyDrop already
     * has this shape for N payloads — deliberately, because a drop IS a paste and a delete
     * of the same N.
     *
     * READ THE MODEL FIRST, for the reason the JSON path does: a removal takes its node out
     * of the tree, so the selectors the splice needs, the row to select afterwards, and the
     * records the ops carry are all read while the nodes are still attached. A child group's
     * UNDO record in particular has to be captured before its children go — after, it would
     * describe the entry the delete produced, and undo would restore the deletion.
     */
    const applyDeleteMany = (rowIds: readonly string[]) => {
      const model = liveModel();
      const plan = planDeletion(rowIds, (rowId) => findNode(rowId));
      if (!plan.entries.length && !plan.childGroups.length) {
        webview.postMessage({ type: 'error', message: 'Could not locate the items in the model.' });
        return;
      }
      // Read off the live tree, before anything leaves it.
      const selectors = plan.entries.map((entry) => entrySelectorOf(entry));
      const doomed = new Set<any>(plan.entries);
      const lastEntry = plan.entries[plan.entries.length - 1];
      const entrySelectId = lastEntry
        ? reselectAfterRemoval(
            ((lastEntry.parent?.children ?? []) as any[]).filter((e) => e === lastEntry || !doomed.has(e)),
            lastEntry,
            buildSectionRowId(lastEntry.parent?.name ?? ''),
          )
        : null;

      try {
        const before = document.chunkXml;
        let working = before;
        const childPairs: EntryOpPair[] = [];
        const applied: AppliedOp[] = [];
        let childSelectId: string | null = null;
        for (const group of plan.childGroups) {
          // Before the removal: this record is what an undo restores.
          const undoOp = attempt(() => replaceOp(group.entry, group.entry.id));
          const result = mutateEntry(group.entry, () => deleteChildrenXml(working, group.children));
          working = result.newText;
          childSelectId = result.selectId ?? childSelectId;
          const redoOp = attempt(() => replaceOp(group.entry, group.entry.id));
          if (undoOp && redoOp) childPairs.push({ redo: redoOp, undo: undoOp });
          applied.push({ kind: 'replace', entryRowId: group.entry.id, entry: group.entry });
        }
        working = deleteEntriesByNameXml(working, selectors);

        // The entries leave the model through the one removal every path shares, whose undo
        // ops are captured interleaved with the removals — captured up front, as they were
        // here, an undo of [P, Q] out of [P, Q, R] put them back as [P, R, Q]. It refuses
        // before removing anything, and a refusal costs only the narrow undo: the entries
        // still leave, by plain ops, as a single delete's do when its record will not serialize.
        const entryRemoval = attempt(() => removeEntries(model, plan.entries));
        if (entryRemoval) applied.push(...entryRemoval.applied);
        else applied.push(...applyEntryOps(model, plan.entries.map((entry) => removeOp(entry.id))));

        // The op list is all-or-nothing: a group whose record would not serialize left no
        // pair, and a patch missing one op would restore a partial state. No patch means
        // both directions repaint wide, which is merely slow (see `attempt`).
        const complete = !!entryRemoval && childPairs.length === plan.childGroups.length;
        const patch = complete ? patchOfPairs([...childPairs, ...entryRemoval!.pairs]) : undefined;

        document.pushEdit('Delete', before, working, patch);
        document.repaintOps(applied);
        const landing = entrySelectId ?? childSelectId;
        if (landing) webview.postMessage({ type: 'selectRows', rowIds: [landing] });
      } catch (err) {
        // Nothing was pushed, so chunkXml is untouched; the model may not be — the child
        // removals happen before the splice. Rebuild from the text, then say so (the
        // repaint clears the banner, so it goes first).
        document.repaintAll();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    /**
     * Delete whichever rows the gesture named.
     *
     * One row keeps the two shapes it already had — a child leaving is a `replace` of its
     * owning entry, an entry leaving is a `remove` — because they are cheaper and
     * better-tested than the fold, and because a single delete is the common case.
     */
    const applyDelete = (rowIds: readonly string[]) => {
      if (rowIds.length !== 1) {
        applyDeleteMany(rowIds);
        return;
      }
      liveModel();
      const node = findNode(rowIds[0]);
      if (!node) {
        webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
        return;
      }
      if (node.isEntry) applyDeleteEntry(node);
      else applyStructural(rowIds[0], (xml, n) => deleteChildXml(xml, n), 'Delete');
    };

    // Value edit / rename: mutate node, reserialize its owning entry, splice.
    const applyEdit = (msg: { rowId: string; columnId: string; oldValue: string; newValue: string }) => {
      try {
        liveModel();
        const node = findNode(msg.rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: 'Could not locate the edited item in the model.' });
          return;
        }
        const entry = findOwningEntry(node);
        if (!entry) {
          webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
          return;
        }
        // Snapshot the entry's identity BEFORE the mutation, twice over, because a
        // rename moves both halves of it. `entrySelectorForLookup` is the entry as the
        // XML still spells it (the span lookup must find the old text; the uuid half
        // also keeps it off a same-named entry in another namespace), and `entryRowId`
        // is the id the TABLE still spells it under (the row splice must find the run
        // that is on screen, not the one that will be).
        const entrySelectorForLookup = entrySelectorOf(entry);
        const entryRowId = entry.id;
        // Third thing read before the mutation: the rename to carry into the System Composer
        // catalog, which names the entry as the file still does. Null for all but a rename of
        // a catalogued architectural entry.
        const catalogRename = catalogRenameOf(msg.columnId, msg.newValue, node, entry);
        // And a service interface's function, which the catalog keeps a copy of under the
        // interface's definition. Never non-null together with catalogRename.
        const functionRename = catalogFunctionRenameOf(msg.columnId, msg.newValue, node, entry);
        // The undo half of the patch has to be snapshotted here: this is the only moment
        // the pre-edit state exists. (Through attempt, so an entry that will not
        // serialize costs this edit its fast undo and not the edit itself.)
        const beforeRecord = attempt(() => entryRecord(entry));
        const result = mutateEntry(entry, () => node.setProperty(msg.columnId, msg.newValue));
        if (result && typeof result === 'object' && result.error) {
          webview.postMessage({
            type: 'validationError',
            reason: result.reason,
            invalidValue: msg.newValue,
            previousValue: msg.oldValue,
          });
          // A rejected edit leaves the model untouched (setProperty validates before it
          // mutates), so repainting this entry from it is what puts the cell back.
          postEntry(entry, entryRowId);
          return;
        }
        const before = document.chunkXml;
        // Core writes the entry and splices it: its bytes, with what the edit changed written
        // from the model, laid out as this chunk is, and every byte around it as it was.
        const after = spliceEntryObject(before, entry, entrySelectorForLookup);
        if (after === null) {
          // The node is already mutated and the text is not, so the model no longer
          // describes the file. Rebuild from the text — the edit is refused, so the
          // orphan mutation has to go rather than sit there looking applied. Before the
          // message, because the repaint it triggers CLEARS the error banner.
          document.repaintAll();
          webview.postMessage({ type: 'error', message: 'Could not locate the entry text to update.' });
          return;
        }
        // Each direction addresses the entry by the id the OTHER one leaves behind, and a
        // RENAME makes those two different: the model now holds the new id, so that is
        // what undo has to find; once undo has run they both hold the old one again, so
        // that is what redo has to find.
        const redoOps = attempt(() => [replaceOp(entry, entryRowId)]);
        const patch =
          beforeRecord && redoOps
            ? { undo: [{ kind: 'replace' as const, rowId: entry.id, record: beforeRecord }], redo: redoOps }
            : undefined;
        // The catalog is a zip member this document only passes through, so carrying the
        // rename into it is a member swap rather than a text edit — computed here, after the
        // validation gate, so a rejected edit does not pay for reading the part. Null unless
        // the catalog spells what was renamed: a definition carrying the entry's name, or the
        // function listed under its interface.
        const scPart = catalogRename
          ? scXmlRenamePatch(document.zipMeta, catalogRename.oldName, catalogRename.newName)
          : functionRename
            ? scXmlFunctionRenamePatch(document.zipMeta, functionRename)
            : null;
        document.pushEdit('Edit ' + msg.columnId, before, after, patch, scPart ?? undefined);
        document.repaintOps([{ kind: 'replace', entryRowId, entry }]);
        if (msg.columnId === 'Name') webview.postMessage({ type: 'selectRows', rowIds: [node.id] });
      } catch (err) {
        // Same reason as the not-found branch above, in both halves: setProperty may have landed
        // before the throw, and the repaint clears the banner the message writes.
        document.repaintAll();
        webview.postMessage({ type: 'error', message: 'Failed to apply edit: ' + (err as Error).message });
      }
    };

    // Shared with the JSON provider so both formats report an identical failure.
    const applyCopy = (rowIds: readonly string[], mode: 'cut' | 'copy') => {
      copyEntriesToClipboard(rowIds, mode, uriString, {
        // From the model as it stands. A cut/copy changes no text at all, so a re-parse
        // here could only reproduce the tree that is already there — and on a real
        // customer dictionary that is ~3s to serialize one entry.
        refresh: () => {
          liveModel();
        },
        findNode,
        post: (message) => webview.postMessage(message),
        broadcast: broadcastClipboardState,
      });
    };

    // --- Paste and drop: one transfer, two registers -------------------------------
    //
    // What a paste or a drop MEANS is transfer.ts's, shared with the JSON view: which register
    // and when it is let go of, the target resolved before anything changes, the same-section
    // no-op, a same-document move as ONE edit that removes the sources first so the pasted
    // copies keep their names, a cross-document move as the paste here and then the delete in
    // the source's own format (editorHub), and what each way of failing says. What is left here
    // is what an edit IS in this format: XML splices folded into chunkXml, pushed as one edit
    // with the entry ops that let its undo and redo skip the re-parse.
    //
    // A fresh adapter per transfer, though this one keeps no state of its own: the whole edit
    // is synchronous from chunkXml to pushEdit, so nothing can land in between and there is no
    // half-written state for onFailure to know about.
    const transferAdapter = (): TransferAdapter<SectionTarget> => ({
      docUri: uriString,
      resolveTarget: (rowId) => sectionTarget(liveModel(), findNode(rowId), rowId),
      validate: (target, payloads) => refuseDisallowedPaste(target.section, payloads),
      commit: ({ target, payloads, removeFirst, label }) => {
        let section = target.section;
        const before = document.chunkXml;
        let working = before;
        // The forward changes in the order they happen, each with its inverse.
        const pairs: EntryOpPair[] = [];
        const applied: AppliedOp[] = [];
        let narrow = true;
        // A same-document move removes the sources first so the pasted copies can keep their
        // names — from the text AND from the model, because the uniqueness check inside the
        // paste reads the MODEL's namespace and a source still standing there would push the
        // copy to `Name1`.
        if (removeFirst.length > 0) {
          working = deleteEntriesByNameXml(working, removeFirst);
          const removal = removalPairs(target.model, removeFirst);
          if (removal) {
            pairs.push(...removal.pairs);
            applied.push(...removal.applied);
          } else {
            // The model cannot say which entries the selectors mean, so it catches up the old
            // way, and the target section is found again in the tree that replaced it — by
            // name, not through the row, which may have been one of the entries just removed.
            narrow = false;
            section = sectionByName(registerModel(working), target.sectionName);
            if (!section) throw new Error('Could not resolve the target section.');
          }
        }
        // The fold attaches each new entry to the section itself (that is prepareEntryForPaste's
        // job, and the uniqueness check needs it), APPENDING it — so whatever it added is the
        // tail this count marks off. Indexing each new subtree and describing it for the undo
        // stack is entryOps' job (opsOfPastedEntries), the call the JSON view makes too: a node
        // id is a PATH, so an entry that joined the tree outside an op is in no index, and the
        // row the paste selects would not resolve for the next edit.
        const addedFrom = (section.children as any[]).length;
        const { newText, selectIds } = pasteEntriesXml(working, section, payloads);
        const added = opsOfPastedEntries(section, addedFrom);
        pairs.push(...added.pairs);
        applied.push(...added.applied);
        document.pushEdit(label, before, newText, narrow ? patchOfPairs(pairs) : undefined);
        if (narrow) document.repaintOps(applied);
        else document.repaintAll();
        if (selectIds.length) webview.postMessage({ type: 'selectRows', rowIds: selectIds });
      },
      // A paste attaches its new nodes to the model before it can fail on the text, and a move
      // has taken its sources out, so the model may be a step ahead of chunkXml. Rebuild from
      // the text, which is the state the user still has — first, because the repaint clears
      // the banner.
      onFailure: (err) => {
        document.repaintAll();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      },
      report: (message) => void webview.postMessage({ type: 'error', message }),
    });
    const transferDeps: TransferDeps = { deleteFromSource };

    const applyPaste = (rowId: string) =>
      runTransfer({ rowId }, clipboardRegister(broadcastClipboardState), transferAdapter(), transferDeps);

    /**
     * Create ONE new default entry from the Add gallery.
     *
     * The same edit as a paste with nothing on the clipboard: one fragment into the XML, one
     * insert op for the undo stack, one narrow repaint. What the entry IS comes from
     * `createEntry` (inside addNewEntryXml) — core's `addEntry`, shared with the JSON path, so
     * an add in a compressed dictionary produces the same class, name and stamps as an add in
     * a text one. The section is named by the message, because a gallery tile carries its own
     * destination rather than reading one off the selection.
     *
     * Synchronous end to end — `chunkXml` in, `pushEdit` out — so a pinned run of tile clicks
     * arriving faster than a write needs no queue here. The JSON provider's add does (see
     * `queueAddEntry` there): its write is a `WorkspaceEdit` it has to await, so two handlers
     * can interleave around it. Same gesture, two document kinds, one of them exposed.
     */
    const applyAddEntry = (msg: { section: string; className: string; rename: boolean }): void => {
      try {
        const model = liveModel();
        const section = sectionByName(model, msg.section);
        if (!section) {
          webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
          return;
        }
        const before = document.chunkXml;
        // Before the add: the mark the new tail is measured from (see the transfer commit).
        const addedFrom = (section.children as any[]).length;
        const { newText, selectId } = addNewEntryXml(before, section, msg.className);
        // Indexes the new subtree and states the insert for the undo — owed because the entry
        // joined the tree inside `addEntry` rather than through an op.
        const added = opsOfPastedEntries(section, addedFrom);
        document.pushEdit('Add', before, newText, patchOfPairs(added.pairs));
        document.repaintOps(added.applied);
        if (selectId) {
          webview.postMessage({ type: 'selectRows', rowIds: [selectId] });
          // After the selection, which expands and scrolls the row into view. Unpinned only:
          // during a pinned run the next click is another tile, not a name.
          if (msg.rename) webview.postMessage({ type: 'beginRename', rowId: selectId });
        }
      } catch (err) {
        // `addEntry` attaches the new node before the XML splice can fail, so the model may be
        // a step ahead of chunkXml. Rebuild from the text — the state the user still has —
        // first, because the repaint clears the banner.
        document.repaintAll();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    // --- Drag start: snapshot the dragged rows into the host drag register ------
    // Each dragged row's owning entry is serialized (the payload the drop pastes)
    // alongside the display facts (class/kind) the target webview needs to predict
    // the drop, then the payload-free descriptor is broadcast so every open table
    // renders feedback. The snapshot itself is shared with SlddTextEditorProvider
    // (buildDragSnapshot); only getting a live model differs between the formats.
    const applyDragStart = (msg: { rowIds: string[] }): void => {
      try {
        // From the model as it stands: starting a drag changes no text, so a re-parse
        // could only rebuild the tree that is already there. See applyCopy.
        liveModel();
        const snap = buildDragSnapshot(msg.rowIds, findNode);
        if (snap.items.length === 0) clearDrag();
        else setDrag(uriString, snap.items);
        broadcastDragState();
      } catch (err) {
        clearDrag();
        broadcastDragState();
        // Said, as a failed copy is — see SlddTextEditorProvider's applyDragStart.
        webview.postMessage({ type: 'error', message: `Failed to drag: ${(err as Error).message}` });
      }
    };

    const applyDragEnd = (): void => {
      clearDrag();
      broadcastDragState();
    };

    // --- Drop: the drag register's transfer --------------------------------------
    // The same transfer as a paste (above), read from the drag register, which is captured
    // as the drop arrives and let go of however the drop ends.
    const applyDrop = (msg: { rowId: string; mode: 'copy' | 'move' }) =>
      runTransfer({ rowId: msg.rowId }, dragRegister(msg.mode, broadcastDragState), transferAdapter(), transferDeps);

    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (msg?.type === 'ready') post();
      else if (msg?.type === 'select') this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      else if (msg?.type === 'edit') applyEdit(msg);
      else if (msg?.type === 'copy') applyCopy(msg.rowIds, 'copy');
      else if (msg?.type === 'cut') applyCopy(msg.rowIds, 'cut');
      else if (msg?.type === 'delete') applyDelete(msg.rowIds);
      else if (msg?.type === 'addChild') applyStructural(msg.rowId, (xml, node) => addChildXml(xml, node), 'Add child');
      else if (msg?.type === 'paste') void applyPaste(msg.rowId);
      else if (msg?.type === 'addEntry') applyAddEntry(msg);
      else if (msg?.type === 'dragStart') applyDragStart(msg);
      else if (msg?.type === 'dragEnd') applyDragEnd();
      else if (msg?.type === 'drop') void applyDrop(msg);
      else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target, uriString);
      } else if (msg?.type === 'requestMatrix') {
        // A Variable Editor panel is opening: send its cells. One shared answer for
        // all four webview hosts — see matrixRequest.ts.
        answerMatrixRequest(webview, uriString, msg.nodeId);
      } else if (msg?.type === 'requestChildren') {
        // A row the payload deferred is being opened: send the rows under it
        // (childRequest.ts). The filler is a no-op because THIS view's payload fills no
        // Usage column either — a fetched row has to match its siblings, and matching
        // means empty here. `uriString` resolves because findNode prefers the global
        // registry, which is keyed by the node id this provider's prefixed srcId is
        // embedded in; that is the same lookup the Property Inspector's selection uses.
        void answerChildRequest(webview, uriString, msg.nodeId, name, async () => false, planner);
      } else if (msg?.type === 'undo' || msg?.type === 'redo') void vscode.commands.executeCommand(msg.type);
    });

    const navSub = wireNavigateSelect(webview, uriString);

    webview.html = renderTableWebview(webview, distRoot);

    webviewPanel.onDidDispose(() => {
      unregisterWebview(webview);
      unregisterAddGalleryView(webviewPanel);
      document.views.delete(view);
      // If a drag originated from this now-closing view, drop it so a stale
      // register can't complete against another document.
      if (getDrag()?.sourceDocUri === uriString) {
        clearDrag();
        broadcastDragState();
      }
      sub.dispose();
      navSub.dispose();
      // Only once the LAST view of this document closes. Both of these are keyed by URI,
      // i.e. document-scoped, so tearing them down when ANY view closed left a surviving
      // split panel unable to complete a cross-document move and showing no Modified
      // marks at all — while the document itself stayed open and editable.
      if (document.views.size === 0) {
        unregisterSourceDeleter(uriString);
        clearBaseline(uriString);
      }
    });
  }

  // --- Save / backup / revert (the safety gate lives here) ---
  async saveCustomDocument(document: BinarySlddDocument, _token: vscode.CancellationToken): Promise<void> {
    // A save used to read the dictionary THREE times — the gate, then the re-baseline,
    // then the repaint's rebuild — for three trees that describe the same unchanged
    // chunkXml. On a real 2.6 MB dictionary that is ~3.1 s each, so ~9 s of a save spent
    // re-deriving what the first read already had. Now: read once, here.
    //
    // The disk check runs AFTER the gate and the zip, right before the write. It can only
    // see changes made before it runs, so the later it runs, the smaller the gap a change
    // can slip through. It also keeps the gate synchronous up to the first await, which is
    // what lets a save read the text the user actually saved (see writeTo).
    const at = document.edits.here();
    document.saving = true;
    let gated: ParsedChunk | null;
    // The edits this save writes. writeTo gates them before its first await, so an edit that
    // lands while the write is in flight goes into a fresh set and stays unsaved, as its text
    // does. A save that fails wrote nothing, so they go back.
    const edited = document.edited;
    const unchecked = document.unchecked;
    try {
      const writing = this.writeTo(document, document.uri, 'save', () =>
        refuseIfChangedOnDisk(document, BinarySlddEditorProvider.viewType, (m) => this.askSaveConflict(m)),
      );
      document.edited = new Set();
      document.unchecked = new Map();
      gated = await writing;
      // What the next save is held to: the text this one wrote, not chunkXml, which an edit
      // on the write's await may have moved on.
      if (gated) document.saved = new SavedChunk(gated.chunkXml);
      // What a later save and the watcher compare the disk with. The watcher's event for
      // this write then finds the disk matching, and ignores it.
      document.stamp = await stampOf(document.uri);
    } catch (err) {
      for (const key of edited) document.edited.add(key);
      document.markUnchecked(new Set(unchecked.values()));
      throw err;
    } finally {
      document.saving = false;
    }
    document.edits.saved(at);
    document.inConflict = false;
    document.overwriteStamp = undefined;
    // Re-baseline to the just-saved content so per-row "Modified" marks clear,
    // then repaint (mirrors SlddTextEditorProvider's onDidSaveTextDocument path).
    // Baseline BEFORE painting, or the paint diffs against the pre-save baseline and
    // stamps "Modified" on rows the save just made clean.
    this.reBaseline(document, gated);
    // Wide on purpose: a save clears the Modified mark on EVERY row that had one, which
    // is the one repaint that is genuinely about the whole table. From 'registered'
    // because the line above has just put the saved tree there.
    document.repaintAll('registered');
  }

  async saveCustomDocumentAs(
    document: BinarySlddDocument,
    dest: vscode.Uri,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    await this.writeTo(document, dest);
  }

  async revertCustomDocument(document: BinarySlddDocument, _token: vscode.CancellationToken): Promise<void> {
    // VS Code marks the document clean as it asks for this, without waiting for it, so the
    // dirty-flag copy is clean from here too. A revert also ends a save conflict, as it does
    // for a text file, whether or not the read below succeeds.
    document.edits.reverted();
    document.inConflict = false;
    document.overwriteStamp = undefined;
    document.applyDisk(await readDisk(document.uri));
  }

  async backupCustomDocument(
    document: BinarySlddDocument,
    ctx: vscode.CustomDocumentBackupContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    // 'backup', NOT 'save' — and this is the difference the user feels most.
    //
    // VS Code asks for a hot-exit backup about a second after every edit to a dirty
    // custom document, and this used to run the save gate: on a real 2.6 MB dictionary
    // that is 3.1 s of re-parse plus 0.7 s of zip, all of it synchronous on the
    // extension host. So an undo pressed just after an edit did not wait on the undo —
    // which is 0.3 ms of entry ops — it waited behind THIS. (Redo felt instant because
    // the undo had returned the document to clean, so VS Code deleted the backup
    // instead of writing another one.)
    //
    // A backup is a scratch copy of what the editor already holds, so verifying it
    // proves nothing the save gate will not prove again before the user's file on disk
    // is touched.
    await this.writeTo(document, ctx.destination, 'backup');
    return {
      id: ctx.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(ctx.destination);
        } catch {
          /* already gone */
        }
      },
    };
  }

  // Re-capture the per-URI baseline from the document's current chunkXml so
  // per-row "Modified" marks reset after a save. Rebuilds the model under the
  // document's srcId (the same source post() paints from) and snapshots it.
  //
  // `gated` is the read the save gate already did — reused when it is still a read of the
  // document's payload, which is the normal path and the reason a save reads a big
  // dictionary once instead of three times. If chunkXml moved on under it (an edit landing
  // on the save's `writeFile` await), or if a caller brought nothing, this reads it again:
  // this method's contract is "get a tree that matches chunkXml and snapshot it", and
  // skipping it instead would leave every edited row wearing a "Modified" dot after a
  // successful save.
  private reBaseline(document: BinarySlddDocument, gated?: ParsedChunk | null): void {
    try {
      const reuse = gated && gated.chunkXml === document.chunkXml ? gated : null;
      DataModel.removeDataSource(document.srcId);
      // The sink is threaded here too, though nothing reads it on this path: this
      // re-registration is what the session holds until the next post(), and a node
      // that carries its warnings on one route into the session and not on another is
      // how a source silently stops reporting. When the gate's read is reused, its sink
      // comes with it — the node layer must append to the list the parse already filled,
      // or the re-registered source reports only half of what the file's read found.
      const warnings: ParseWarning[] = reuse?.warnings ?? [];
      const content = reuse?.content ?? readSlddParts(document.chunkXml, document.zipMeta, warnings);
      const node = DataModel.addDataSource(
        document.srcId,
        content,
        { path: document.metaPath },
        warnings,
      );
      captureBaseline(document.uri.toString(), node);
    } catch {
      /* leave baseline as-is on parse failure */
    }
  }

  // Write chunkXml + the pass-through zip parts back out as a .sldd.
  //
  // Two callers, and they want different things from it:
  //
  //  - 'save' overwrites a file the user owns, so it is GATED: re-parse chunkXml first
  //    and throw on failure — VS Code then keeps the document dirty and shows the
  //    error, and the on-disk file is never touched. This is the call site the
  //    reads-as-empty rule in readSlddParts matters most for: a chunk the reader cannot
  //    read yields a dictionary with no entries, and zipping that over the file on disk
  //    would take every entry with it, silently. Then the chunk is held to the chunk as
  //    last read or saved (binarySaveGate.ts): what no edit changed must be its bytes,
  //    and an edited entry must keep what the edit did not change. Neither check says
  //    an edited value is right (see the header). It also compresses properly, because
  //    the result is what the user keeps.
  //
  //  - 'backup' writes VS Code's hot-exit scratch copy, which is thrown away when the
  //    document goes clean or closes cleanly. It skips the gate (see
  //    backupCustomDocument — that parse is seconds of extension-host time between an
  //    edit and the next thing the user does) and compresses at level 1, which on a
  //    2.6 MB dictionary is 0.65 s against 0.74 s for a file nobody keeps.
  //
  // The gate's read is RETURNED rather than dropped, because the caller that re-baselines
  // after a save needs exactly it: a second read of the same string is seconds of work for
  // an answer already in hand. 'backup' gates nothing, so it has nothing to return.
  //
  // `beforeWrite` runs after the zip and before the write, and a throw from it means nothing
  // is written. A save passes its disk check here. Everything up to that call is synchronous,
  // so the text gated and zipped is the text the document held when the save was called.
  // An edit arriving on the check's await is not written, and stays unsaved.
  private async writeTo(
    document: BinarySlddDocument,
    dest: vscode.Uri,
    mode: 'save' | 'backup' = 'save',
    beforeWrite?: () => Promise<void>,
  ): Promise<ParsedChunk | null> {
    let gated: ParsedChunk | null = null;
    if (mode === 'save') {
      try {
        const warnings: ParseWarning[] = [];
        const chunkXml = document.chunkXml;
        gated = { chunkXml, content: readSlddParts(chunkXml, document.zipMeta, warnings), warnings };
      } catch (err) {
        throw new Error('Refusing to save: the document did not re-parse (' + (err as Error).message + ').');
      }
      const refusal = savedChunkRefusal(
        document.saved,
        gated.chunkXml,
        document.edited,
        DataModel.getDataSource(document.srcId) ?? null,
        document.unchecked,
      );
      if (refusal) throw new Error(refusal);
    }
    const zipEntries: Record<string, Uint8Array> = { ...document.zipMeta };
    zipEntries[DATA_PART_XML] = new TextEncoder().encode(document.chunkXml);
    const zipped = zipSync(zipEntries, { level: mode === 'save' ? 6 : 1 });
    if (beforeWrite) await beforeWrite();
    await vscode.workspace.fs.writeFile(dest, zipped);
    return gated;
  }
}
