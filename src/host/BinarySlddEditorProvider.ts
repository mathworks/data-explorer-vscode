// Copyright 2026 The MathWorks, Inc.
//
// Writable custom editor for COMPRESSED-BINARY (zip/XML) .sldd files. A binary
// .sldd is an OPC/zip package whose only editable text payload is data/chunk0.xml;
// all other parts pass through verbatim. The document holds that chunkXml string
// as its single edit surface plus the pass-through parts. Every table edit is a
// pure string transform on chunkXml (xmlStructuralEdit), regenerating only the
// touched entry's <Object> fragment so untouched entries stay byte-identical —
// the same risk profile as the JSON .sldd table view.
//
// Unlike SlddTextEditorProvider (backed by a native TextDocument), this is a
// CustomEditorProvider: it owns its own edit stack via onDidChangeCustomDocument,
// and re-zips on save. The save gate re-parses chunkXml before writing, so a
// serializer bug becomes a failed save, never a corrupted file.
//
// The model is registered in the global DataModel singleton under a srcId that
// PREFIXES the URI, so it never collides with the read-only BinaryEditorProvider's
// cached model of the same file.
import * as vscode from 'vscode';
import { unzipSync, zipSync } from 'fflate';
import { renderWebviewHtml, BANNERS_HTML } from './webviewHtml.js';
import { buildRows, buildEntryRows, COLUMNS, COLUMN_LABELS, COLUMN_GROUPS, type ClipMark } from './rowBuilder.js';
import { sectionRules } from './sectionRules.js';
import { serializeEntryToXml, DataModel, type ParseWarning } from 'data-explorer-core';
// Never parseBinarySlddParts directly: readSlddParts is the same read plus the rule
// that a dictionary this host could not read is not passed on as an empty one, which
// the reader itself no longer enforces (it recovers and warns instead).
import { readSlddParts } from './slddContent.js';
import { DATA_PART_XML } from '../common/slddParts.js';
import { sourceWarnings, warningBanner } from './parseWarnings.js';
import { findOwningEntry, resolveSectionForPaste, buildDragSnapshot } from './structuralEdit.js';
import { copyEntryToClipboard } from './clipboardAction.js';
import { captureBaseline, computeModified, isEntryModified, clearBaseline } from './slddBaseline.js';
import {
  deleteEntryXml,
  deleteChildXml,
  addChildXml,
  pasteEntryXml,
  pasteEntriesXml,
  deleteEntriesByNameXml,
  type StructuralResult,
} from './xmlStructuralEdit.js';
import { findEntryObjectSpan } from './xmlEntrySplice.js';
import { catalogRenameOf, scXmlRenamePatch, type ScPartPatch } from './scRename.js';
import {
  applyEntryOps,
  entryRecord,
  findEntryByName,
  findEntryBySelector,
  insertAnchorOf,
  insertOp,
  mutateEntry,
  patchOfPairs,
  removeOp,
  replaceOp,
  type AppliedOp,
  type EntryOp,
  type EntryOpPair,
  type EntryPatch,
} from './entryOps.js';
import { buildSectionRowId } from '../common/sectionRowId.js';
import { getClipboard, clearClipboard, clipboardState } from './clipboard.js';
import { setDrag, getDrag, clearDrag } from './dragState.js';
import {
  registerWebview,
  unregisterWebview,
  registerSourceDeleter,
  unregisterSourceDeleter,
  broadcastClipboardState,
  broadcastDragState,
  deleteFromSource,
} from './editorHub.js';
import { entrySelectorOf } from './entrySelector.js';
import { basename } from '../common/pathUtil.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import type { TableToHostMessage } from '../common/protocol.js';

// srcId prefix so the editable model never collides with the read-only
// BinaryEditorProvider's cached model of the same URI (DataModel is a singleton).
const SRC_PREFIX = 'binedit:';

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

class BinarySlddDocument implements vscode.CustomDocument {
  chunkXml: string;
  readonly zipMeta: Record<string, Uint8Array>;
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

  constructor(
    public readonly uri: vscode.Uri,
    chunkXml: string,
    zipMeta: Record<string, Uint8Array>,
  ) {
    this.chunkXml = chunkXml;
    this.zipMeta = zipMeta;
  }

  get srcId(): string {
    return SRC_PREFIX + this.uri.toString();
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
    this.chunkXml = after;
    if (part) this.zipMeta[part.member] = part.after;
    this._onDidChange.fire({
      document: this,
      label,
      undo: () => {
        this.chunkXml = before;
        if (part) this.zipMeta[part.member] = part.before;
        this.applyOps(part ? undefined : patch?.undo);
      },
      redo: () => {
        this.chunkXml = after;
        if (part) this.zipMeta[part.member] = part.after;
        this.applyOps(part ? undefined : patch?.redo);
      },
    });
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
    DataModel.removeDataSource(this.srcId);
    this._onDidChange.dispose();
  }
}

export class BinarySlddEditorProvider implements vscode.CustomEditorProvider<BinarySlddDocument> {
  public static readonly viewType = 'dataExplorer.binarySlddView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;
  // Handle a Usage-column link click (wired in extension.ts).
  public onNavigate?: (target: string) => void;

  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<BinarySlddDocument> {
    const source = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri;
    const bytes = await vscode.workspace.fs.readFile(source);
    const zip = unzipSync(bytes);
    const chunk = zip[DATA_PART_XML];
    if (!chunk) throw new Error(`Missing ${DATA_PART_XML} in binary SLDD`);
    const chunkXml = new TextDecoder().decode(chunk);
    const doc = new BinarySlddDocument(uri, chunkXml, passThroughParts(zip));
    // Relay the document's edit events to the provider-level emitter VS Code listens on.
    doc.onDidChangeCustomDocument((e) => this._onDidChangeCustomDocument.fire(e));
    return doc;
  }

  async resolveCustomEditor(
    document: BinarySlddDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    webviewPanel.iconPath = new vscode.ThemeIcon('table');
    const uriString = document.uri.toString();
    const name = basename(document.uri.path) || 'document';

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
    const clipMarkOfDoc = (): ClipMark | undefined => {
      const clip = getClipboard();
      return clip && clip.sourceDocUri === uriString && clip.payload.name
        ? { name: clip.payload.name as string, section: clip.sourceSection, mode: clip.mode }
        : undefined;
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
        const rows = buildRows(node, modified, clipMark);
        webview.postMessage({
          type: 'setRows',
          rows,
          columns: COLUMNS,
          columnLabels: COLUMN_LABELS,
          columnGroups: COLUMN_GROUPS,
          editable: true,
          // What the read of this dictionary could not read. Rebuilt with the model on
          // every repaint rather than captured on open, because an edit rewrites
          // chunkXml and the answer is about the chunk as it stands — a warning that
          // outlived the part it was about would be worse than none.
          warnings: warningBanner(sourceWarnings(node)),
        });
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
      const mark = clipMarkOfDoc();
      // Pre-matched by section exactly as buildRows does it: entry names are only
      // unique within a section, so only the marked entry's own section may carry it.
      const sectionMark = mark && mark.section === section.name ? mark : undefined;
      return buildEntryRows(entry, section.name, modified, sectionMark);
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
     * open .sldd cost this document a full re-parse. At most TWO entries can be
     * affected: the one that just took the mark and the one that held it before. A
     * broadcast that changes neither (the usual case — the mark belongs to another
     * document) now costs nothing at all.
     *
     * An affected entry that is no longer in the model is skipped rather than repainted
     * wide: its rows are already gone (a cut+paste moves the very entry that held the
     * mark), so there is nothing left to un-dim.
     */
    let paintedMark: ClipMark | undefined;
    const markKey = (mark?: ClipMark): string =>
      mark ? JSON.stringify([mark.mode, mark.section, mark.name]) : '';
    const repaintClipMark = () => {
      const next = clipMarkOfDoc();
      if (markKey(paintedMark) === markKey(next)) return;
      const affected = [paintedMark, next].filter((m): m is ClipMark => !!m);
      paintedMark = next;
      const model = liveModel();
      const ops: AppliedOp[] = [];
      const seen = new Set<string>();
      for (const mark of affected) {
        const entry = findEntryByName(model, mark.section, mark.name);
        // Both marks can name the same entry (a copy re-taken as a cut), and its rows
        // only need painting once.
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
    registerSourceDeleter(uriString, (targets) => {
      const before = document.chunkXml;
      const after = deleteEntriesByNameXml(before, targets);
      if (after === before) return;
      // The model half of the delete, narrowly when every target resolves to exactly
      // one live entry. Deliberately keyed on the SAME targets the text splice used, so
      // the two halves cannot remove different entries.
      const patch = attempt<EntryPatch>(() => {
        const model = liveModel();
        const entries = targets.map((t) => findEntryBySelector(model, t));
        if (entries.some((e) => !e)) return undefined;
        return {
          // Reversed, because undo applies the inverses in reverse order — see
          // applyEntryOps.
          undo: entries.map((e) => insertOp(e)).reverse(),
          redo: entries.map((e) => removeOp(e.id)),
        };
      });
      document.pushEdit('Move (remove source)', before, after, patch);
      // Applied through the document (not directly) so the model change happens once
      // and every view of it repaints — this deleter runs on behalf of ANOTHER
      // document's drop, so the view it belongs to is not the one being interacted with.
      document.applyOps(patch?.redo);
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
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
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
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
      } catch (err) {
        // Nothing was pushed, so chunkXml is untouched; the model may not be. Rebuild
        // from the text, which is the state the user still has.
        document.repaintAll();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    /**
     * Delete whichever the target row is: one nested child, or a whole entry.
     *
     * The two are different SHAPES of change rather than two cases of one — deleting a
     * child leaves the dictionary's entry list alone, so it is a `replace` of the owning
     * entry, while deleting an entry is a `remove` — so they split here, before either
     * path decides anything.
     */
    const applyDelete = (rowId: string) => {
      liveModel();
      const node = findNode(rowId);
      if (!node) {
        webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
        return;
      }
      if (node.isEntry) applyDeleteEntry(node);
      else applyStructural(rowId, (xml, n) => deleteChildXml(xml, n), 'Delete');
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
        const frag = serializeEntryToXml(entry).replace(/\n$/, '');
        const span = findEntryObjectSpan(before, entrySelectorForLookup);
        if (!span) {
          // The node is already mutated and the text is not, so the model no longer
          // describes the file. Rebuild from the text — the edit is refused, so the
          // orphan mutation has to go rather than sit there looking applied. Before the
          // message, because the repaint it triggers CLEARS the error banner.
          document.repaintAll();
          webview.postMessage({ type: 'error', message: 'Could not locate the entry text to update.' });
          return;
        }
        const after = before.slice(0, span.offset) + frag + before.slice(span.offset + span.length);
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
        // a definition actually carries the name.
        const scPart = catalogRename
          ? scXmlRenamePatch(document.zipMeta, catalogRename.oldName, catalogRename.newName)
          : null;
        document.pushEdit('Edit ' + msg.columnId, before, after, patch, scPart ?? undefined);
        document.repaintOps([{ kind: 'replace', entryRowId, entry }]);
        if (msg.columnId === 'Name') webview.postMessage({ type: 'selectRow', rowId: node.id });
      } catch (err) {
        // Same reason as the !span branch, in both halves: setProperty may have landed
        // before the throw, and the repaint clears the banner the message writes.
        document.repaintAll();
        webview.postMessage({ type: 'error', message: 'Failed to apply edit: ' + (err as Error).message });
      }
    };

    // Shared with the JSON provider so both formats report an identical failure.
    const applyCopy = (rowId: string, mode: 'cut' | 'copy') => {
      copyEntryToClipboard(rowId, mode, uriString, {
        // From the model as it stands. A cut/copy changes no text at all, so a re-parse
        // here could only reproduce the tree that is already there — and on a real
        // customer dictionary that is ~3s to serialize one entry.
        resolveNode: (id) => {
          liveModel();
          return findNode(id);
        },
        post: (message) => webview.postMessage(message),
        broadcast: broadcastClipboardState,
      });
    };

    const applyPaste = async (rowId: string) => {
      try {
        const clip = getClipboard();
        if (!clip) {
          webview.postMessage({ type: 'error', message: 'Nothing to paste — the clipboard is empty.' });
          return;
        }
        const model = liveModel();
        const node = findNode(rowId);
        let section = resolveSectionForPaste(model, node, rowId);
        if (!section) {
          webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
          return;
        }
        const isCut = clip.mode === 'cut';
        const sameDoc = clip.sourceDocUri === uriString;
        // Identity from the payload the clipboard snapped at cut time, so the
        // source-delete can't hit a same-named entry in another namespace.
        const srcSelector = entrySelectorOf(clip.payload);
        const srcName = srcSelector.name;

        // A cut into the SAME section is a no-op move: just clear the mark. The broadcast
        // repaints the at-most-two rows that can carry one, and nothing else.
        if (isCut && sameDoc && clip.sourceSection === section.name) {
          clearClipboard();
          broadcastClipboardState();
          return;
        }

        const before = document.chunkXml;
        let working = before;
        // The forward changes in the order they happen, each with its inverse.
        const pairs: EntryOpPair[] = [];
        const applied: AppliedOp[] = [];
        let narrow = true;
        // A same-document cut removes the source first so the pasted copy can keep the
        // source's name — from the text AND from the model, because the uniqueness check
        // inside the paste reads the MODEL's namespace and a source still standing there
        // would push the copy to `Name1`.
        if (isCut && sameDoc && srcName) {
          working = deleteEntriesByNameXml(working, [srcSelector]);
          const src = findEntryBySelector(model, srcSelector);
          if (src) {
            pairs.push({ redo: removeOp(src.id), undo: insertOp(src) });
            applied.push(...applyEntryOps(model, [removeOp(src.id)]));
          } else {
            // The model cannot say which entry the clipboard means, so it catches up the
            // old way — and the target section has to be re-resolved against the tree
            // that just replaced it.
            narrow = false;
            const rebuilt = registerModel(working);
            section = resolveSectionForPaste(rebuilt, findNode(rowId), rowId) ?? section;
          }
        }

        // pasteEntryXml attaches the new entry to the section itself (that is
        // prepareEntryForPaste's job, and the uniqueness check needs it), APPENDING it —
        // so whatever it added is the tail this count marks off.
        const addedFrom = (section.children as any[]).length;
        const { newText, selectId } = pasteEntryXml(working, section, clip.payload);
        for (const entry of (section.children as any[]).slice(addedFrom)) {
          // The one thing attaching a node does not do: put it in the session's index.
          DataModel.indexSubtree(entry);
          pairs.push({ redo: insertOp(entry), undo: removeOp(entry.id) });
          applied.push({ kind: 'insert', entry, beforeRowId: insertAnchorOf(entry) });
        }
        document.pushEdit('Paste', before, newText, narrow ? patchOfPairs(pairs) : undefined);
        if (narrow) document.repaintOps(applied);
        else document.repaintAll();
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
        try {
          // A cross-document cut removes the source from ITS document via that
          // document's own format-appropriate deleter (JSON or binary), a second
          // native undo step — exactly a cut in one file + paste in another.
          if (isCut && !sameDoc && clip.sourceDocUri && srcName) {
            await deleteFromSource(clip.sourceDocUri, [srcSelector]);
          }
        } finally {
          // Cleared even if the source-delete throws: the paste above already
          // succeeded, so leaving the cut live means the next paste duplicates the
          // entry again. Matches the JSON provider.
          if (isCut) {
            clearClipboard();
            broadcastClipboardState();
          }
        }
      } catch (err) {
        // A paste attaches its new node to the model before it can fail on the text, so
        // the model may be a step ahead of chunkXml. Rebuild from the text, which is the
        // state the user still has — first, because the repaint clears the banner.
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
        else setDrag(uriString, snap.sourceSection, snap.sourceSectionLabel, snap.sourceIsDerived, snap.items);
        broadcastDragState();
      } catch {
        clearDrag();
        broadcastDragState();
      }
    };

    const applyDragEnd = (): void => {
      clearDrag();
      broadcastDragState();
    };

    // --- Drop: complete the drag as copy/move + paste ---------------------------
    // Identical in shape to SlddTextEditorProvider.applyDrop, using the XML
    // transforms. A same-document move deletes the sources first (in the same
    // text) so the pasted copies keep their names; a cross-document move pastes
    // here, then deletes from the SOURCE document via the hub (which dispatches
    // to the source's own format-appropriate deleter — JSON or binary).
    const applyDrop = async (msg: { rowId: string; mode: 'copy' | 'move' }): Promise<void> => {
      try {
        const drag = getDrag();
        if (!drag || drag.items.length === 0) {
          webview.postMessage({ type: 'error', message: 'Nothing to drop.' });
          return;
        }
        const payloads = drag.items.map((it) => it.payload);
        const isMove = msg.mode === 'move';
        const sameDoc = drag.sourceDocUri === uriString;
        // Selectors, not bare names: a dragged entry's name is unique only within
        // its namespace, so deleting by name alone could splice out a same-named
        // entry in another section. See entrySelector.ts.
        const sourceTargets = drag.items
          .map((it) => entrySelectorOf(it.payload))
          .filter((s) => s.name.length > 0);

        const model = liveModel();
        const before = document.chunkXml;
        let working = before;
        // The forward changes in the order they happen, each with its inverse.
        const pairs: EntryOpPair[] = [];
        const applied: AppliedOp[] = [];
        let narrow = true;
        let section = resolveSectionForPaste(model, findNode(msg.rowId), msg.rowId);
        // A same-document move removes the originals first so the pasted copies keep
        // their names — from the text and from the model, whose namespace the paste's
        // uniqueness check reads. A copy, or a cross-document move, leaves this
        // document's originals untouched here.
        if (isMove && sameDoc && sourceTargets.length) {
          working = deleteEntriesByNameXml(working, sourceTargets);
          const sources = sourceTargets.map((t) => findEntryBySelector(model, t));
          if (sources.every((e) => !!e)) {
            const seen = new Set<string>();
            for (const src of sources) {
              // A multi-select drag can list the same entry twice (two selected rows of
              // one entry), and removing it twice would throw on the second op — the same
              // reason deleteEntriesByNameXml re-finds each span.
              if (seen.has(src.id)) continue;
              seen.add(src.id);
              pairs.push({ redo: removeOp(src.id), undo: insertOp(src) });
              applied.push(...applyEntryOps(model, [removeOp(src.id)]));
            }
          } else {
            // At least one source is not something the model can name unambiguously, so
            // it catches up the old way and the target section is re-resolved against the
            // tree that replaced it.
            narrow = false;
            const rebuilt = registerModel(working);
            section = resolveSectionForPaste(rebuilt, findNode(msg.rowId), msg.rowId);
          }
        }
        if (!section) {
          webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
          document.repaintAll();
          return;
        }

        // The fold attaches each new entry to the section as it goes (see
        // foldPasteEntries), appending — so what it added is the tail after this count.
        const addedFrom = (section.children as any[]).length;
        const { newText, selectIds } = pasteEntriesXml(working, section, payloads);
        for (const entry of (section.children as any[]).slice(addedFrom)) {
          DataModel.indexSubtree(entry);
          pairs.push({ redo: insertOp(entry), undo: removeOp(entry.id) });
          applied.push({ kind: 'insert', entry, beforeRowId: insertAnchorOf(entry) });
        }
        document.pushEdit(isMove ? 'Move' : 'Copy', before, newText, narrow ? patchOfPairs(pairs) : undefined);
        if (narrow) document.repaintOps(applied);
        else document.repaintAll();
        if (selectIds.length) webview.postMessage({ type: 'selectRow', rowId: selectIds[selectIds.length - 1] });

        // Cross-document move: remove the originals from the SOURCE document via
        // its own deleter (a second native undo step on that document).
        if (isMove && !sameDoc) {
          await deleteFromSource(drag.sourceDocUri, sourceTargets);
        }

        clearDrag();
        broadcastDragState();
      } catch (err) {
        // Same as applyPaste: the fold attaches nodes as it goes, so a failure part-way
        // can leave the model ahead of chunkXml. Rebuild from the text.
        document.repaintAll();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (msg?.type === 'ready') post();
      else if (msg?.type === 'select') this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      else if (msg?.type === 'edit') applyEdit(msg);
      else if (msg?.type === 'copy') applyCopy(msg.rowId, 'copy');
      else if (msg?.type === 'cut') applyCopy(msg.rowId, 'cut');
      else if (msg?.type === 'delete') applyDelete(msg.rowId);
      else if (msg?.type === 'addChild') applyStructural(msg.rowId, (xml, node) => addChildXml(xml, node), 'Add child');
      else if (msg?.type === 'paste') void applyPaste(msg.rowId);
      else if (msg?.type === 'dragStart') applyDragStart(msg);
      else if (msg?.type === 'dragEnd') applyDragEnd();
      else if (msg?.type === 'drop') void applyDrop(msg);
      else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target);
      } else if (msg?.type === 'undo' || msg?.type === 'redo') void vscode.commands.executeCommand(msg.type);
    });

    // Live cross-tab selection: if a navigation targets THIS already-open file,
    // select the row immediately (the just-opened case is drained in post()).
    const navSub = wireNavigateSelect(webview, uriString);

    webview.html = renderWebviewHtml(webview, distRoot, {
      scriptFile: 'table.js',
      title: 'Data Explorer',
      body: `    <div id="dex-error" role="alert" style="display:none;color:var(--vscode-errorForeground,#f14c4c);padding:8px;font-family:var(--vscode-font-family,sans-serif);"></div>
${BANNERS_HTML}
    <dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>`,
    });

    webviewPanel.onDidDispose(() => {
      unregisterWebview(webview);
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
    const gated = await this.writeTo(document, document.uri);
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
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    const zip = unzipSync(bytes);
    const chunk = zip[DATA_PART_XML];
    if (chunk) {
      document.chunkXml = new TextDecoder().decode(chunk);
      // The parts too, and for the same reason: an edit can have patched one of them (a
      // rename carried into the System Composer catalog), and a revert that restored only
      // the chunk would leave the entry named as the file spells it beside a catalog that
      // no longer classifies it — then write that pair out on the next save.
      document.resetParts(zip);
    }
    // Wide on purpose: a revert replaces the whole document, so there is no narrower
    // truth to tell the table than "everything you are showing came from elsewhere".
    document.repaintAll();
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
        { path: basename(document.uri.path) || 'document' },
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
  //    would take every entry with it, silently. It also compresses properly, because
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
  private async writeTo(
    document: BinarySlddDocument,
    dest: vscode.Uri,
    mode: 'save' | 'backup' = 'save',
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
    }
    const zipEntries: Record<string, Uint8Array> = { ...document.zipMeta };
    zipEntries[DATA_PART_XML] = new TextEncoder().encode(document.chunkXml);
    const zipped = zipSync(zipEntries, { level: mode === 'save' ? 6 : 1 });
    await vscode.workspace.fs.writeFile(dest, zipped);
    return gated;
  }
}
