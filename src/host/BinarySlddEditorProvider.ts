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
import { renderWebviewHtml, LOADING_OVERLAY_HTML, BANNERS_HTML } from './webviewHtml.js';
import { buildRows, buildEntryRows, COLUMNS, COLUMN_LABELS, COLUMN_GROUPS, type ClipMark } from './rowBuilder.js';
import { sectionRules } from './sectionRules.js';
import { serializeEntryToXml, DataModel, type ParseWarning } from 'data-explorer-core';
// Never parseBinarySlddParts directly: readSlddParts is the same read plus the rule
// that a dictionary this host could not read is not passed on as an empty one, which
// the reader itself no longer enforces (it recovers and warns instead).
import { readSlddParts } from './slddContent.js';
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

class BinarySlddDocument implements vscode.CustomDocument {
  chunkXml: string;
  readonly zipMeta: Record<string, Uint8Array>;
  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChange.event;

  // Assigned by the provider so undo/redo can trigger a repaint of the webview.
  _afterMutate?: () => void;

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

  // Push an edit onto VS Code's native undo stack.
  pushEdit(label: string, before: string, after: string): void {
    this.chunkXml = after;
    this._onDidChange.fire({
      document: this,
      label,
      undo: () => {
        this.chunkXml = before;
        this._afterMutate?.();
      },
      redo: () => {
        this.chunkXml = after;
        this._afterMutate?.();
      },
    });
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
    const chunk = zip['data/chunk0.xml'];
    if (!chunk) throw new Error('Missing data/chunk0.xml in binary SLDD');
    const chunkXml = new TextDecoder().decode(chunk);
    const zipMeta: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') zipMeta[k] = v;
    const doc = new BinarySlddDocument(uri, chunkXml, zipMeta);
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

    // Capture the on-open baseline once so per-entry "Modified" marks are diffed
    // against the initial content. post() rebuilds the model on every call, so
    // this flag (not a one-shot in openCustomDocument) guards the first capture.
    let initialized = false;

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
    // At rest the registered source is exactly the parse of document.chunkXml: the
    // only things that change chunkXml are pushEdit (whose every caller then
    // repaints), the undo/redo closures, and revertCustomDocument — and all of them
    // end in post()/_afterMutate, which re-registers. The two mid-transform
    // registerModel calls in applyPaste/applyDrop are inside synchronous stretches
    // that also end in post(), so no message can be handled while the source is a
    // model of something other than chunkXml.
    //
    // Re-parsing here instead is what made an edit cost seconds: on a real customer
    // dictionary (75 MB of data/chunk0.xml, 31k entries) fast-xml-parser alone takes
    // ~3s, and applyEdit paid it once before touching the model and post() paid it
    // again afterwards to rebuild a tree that was already correct.
    const liveModel = () => (DataModel as any).getDataSource?.(document.srcId) ?? buildModel();
    /**
     * Mutate `entry`'s subtree in place, with the session's node index repaired around
     * it — the other half of not re-parsing, and paired with it deliberately.
     *
     * A node id is a PATH, so renaming an entry (or a nested child) rekeys everything
     * beneath it. Re-registering the source used to fix that as a side effect of
     * re-parsing; an edit that skips the re-parse has to say so explicitly, or
     * findNodeById stops resolving the very row ids this edit is about to paint and the
     * NEXT edit on that row fails with "could not locate the edited item". Adding a
     * child leaves it unfindable the same way; removing one leaves a detached node
     * resolving, which is worse.
     *
     * So: every path that takes the entry-scoped repaint mutates through here. The
     * paths that fall back to post() do not need it — post() re-registers, which is the
     * same repair at whole-source scope.
     */
    const mutateEntry = <T>(entry: any, mutate: () => T): T => DataModel.mutateSubtree(entry, mutate);
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

    const post = () => {
      try {
        const node = buildModel();
        if (!initialized) {
          captureBaseline(uriString, node);
          initialized = true;
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
        drainNavigateSelect(webview, uriString);
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to parse ${name}: ${(err as Error).message}` });
      }
    };
    /**
     * Repaint ONE entry's rows, for an edit confined to that entry.
     *
     * The fast path, and the reason the edit round-trip is milliseconds instead of
     * seconds. It rebuilds nothing but the edited entry's subtree — from the model
     * the edit already mutated in place — and sends only those rows, which the
     * webview splices over the run it already holds. No re-parse, no 130k-row
     * rebuild, no 67 MB postMessage.
     *
     * `entryRowId` is the id the TABLE currently spells this entry's rows under, and
     * the caller must snapshot it BEFORE mutating: a rename changes entry.id, and
     * the splice has to find the run that is on screen, not the one that will be.
     *
     * Falls back to a full repaint for an entry with no section parent — a detached
     * node has no place in the table's row order, so there is no run to splice.
     */
    const postEntry = (entry: any, entryRowId: string) => {
      try {
        const section = entry?.parent;
        if (!section) {
          post();
          return;
        }
        // The one-entry form of the diff post() runs over the whole model. Passing a
        // set (rather than a boolean) keeps buildEntryRows' existing contract, which
        // also lets it CLEAR a stale mark — see the Status comment in rowBuilder.
        const modified = new Set<string>();
        if (isEntryModified(uriString, entry)) modified.add(entry.name);
        const mark = clipMarkOfDoc();
        // Pre-matched by section exactly as buildRows does it: entry names are only
        // unique within a section, so only the marked entry's own section may carry it.
        const sectionMark = mark && mark.section === section.name ? mark : undefined;
        const rows = buildEntryRows(entry, section.name, modified, sectionMark);
        webview.postMessage({ type: 'updateEntryRows', entryRowId, rows });
      } catch (err) {
        // The edit itself already landed, so the table must not be left showing the
        // pre-edit rows: fall back to the wide repaint, which builds these same rows by
        // the other path. Then say so — after, because the repaint clears the banner.
        post();
        webview.postMessage({ type: 'error', message: `Failed to update the row: ${(err as Error).message}` });
      }
    };

    document._afterMutate = post;

    // Register with the cross-provider hub so clipboard/drag state broadcasts
    // from ANY .sldd table (JSON or binary) reach this webview, and so a
    // cross-document move whose SOURCE is this binary .sldd can complete its
    // source-delete via a format-appropriate edit (an in-memory chunkXml splice
    // pushed onto this document's own undo stack, then a repaint).
    registerWebview(webview, post);
    registerSourceDeleter(uriString, (targets) => {
      const before = document.chunkXml;
      const after = deleteEntriesByNameXml(before, targets);
      if (after === before) return;
      document.pushEdit('Move (remove source)', before, after);
      post();
    });

    // Apply a structural transform: locate node, run transform, push edit, repaint.
    //
    // `scopeOf` names the entry whose rows the transform can only have changed, or
    // null when the edit changes WHICH entries exist and so needs the full rebuild.
    // It is per-call-site rather than derived here because the answer depends on the
    // action, not just the node: adding a child to a top-level Bus is entry-scoped
    // even though the target IS an entry, while deleting that same Bus is not.
    const applyStructural = (
      rowId: string,
      transform: (xml: string, node: any, model: any) => StructuralResult,
      label: string,
      scopeOf: (node: any) => any,
    ) => {
      const model = liveModel();
      const node = findNode(rowId);
      if (!node) {
        webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
        return;
      }
      // Snapshot before the transform: the within-entry transforms mutate the model,
      // and a mutated entry's id is not necessarily the one the table still shows.
      const scoped = scopeOf(node);
      const scopedRowId = scoped?.id ?? '';
      try {
        const before = document.chunkXml;
        // Through mutateEntry when the edit is entry-scoped: these transforms mutate the
        // model (addChildToModel / removeChildFromModel) before they splice the text, and
        // the repaint that follows skips the re-parse that used to repair the index.
        const { newText, selectId } = scoped
          ? mutateEntry(scoped, () => transform(before, node, model))
          : transform(before, node, model);
        document.pushEdit(label, before, newText);
        if (scoped) postEntry(scoped, scopedRowId);
        else post();
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
      } catch (err) {
        // The within-entry transforms mutate the model BEFORE they splice the text
        // (removeChildFromModel / addChildToModel), so a transform that throws
        // half-way leaves a model that no longer matches chunkXml. The edit path now
        // trusts that model instead of re-deriving it, so the mismatch has to be
        // undone here rather than waiting for the next repaint to paper over it.
        // First, because the repaint clears the error banner the message writes.
        post();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
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
          post();
          webview.postMessage({ type: 'error', message: 'Could not locate the entry text to update.' });
          return;
        }
        const after = before.slice(0, span.offset) + frag + before.slice(span.offset + span.length);
        document.pushEdit('Edit ' + msg.columnId, before, after);
        postEntry(entry, entryRowId);
        if (msg.columnId === 'Name') webview.postMessage({ type: 'selectRow', rowId: node.id });
      } catch (err) {
        // Same reason as the !span branch, in both halves: setProperty may have landed
        // before the throw, and the repaint clears the banner the message writes.
        post();
        webview.postMessage({ type: 'error', message: 'Failed to apply edit: ' + (err as Error).message });
      }
    };

    // Shared with the JSON provider so both formats report an identical failure.
    const applyCopy = (rowId: string, mode: 'cut' | 'copy') => {
      copyEntryToClipboard(rowId, mode, uriString, {
        resolveNode: (id) => {
          buildModel();
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
        const model = buildModel();
        const node = findNode(rowId);
        const section = resolveSectionForPaste(model, node, rowId);
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

        // A cut into the SAME section is a no-op move: just clear the mark.
        if (isCut && sameDoc && clip.sourceSection === section.name) {
          clearClipboard();
          post();
          return;
        }

        let before = document.chunkXml;
        // A same-document cut deletes the source first, then re-parses so the
        // paste's uniqueness check sees the post-delete namespace.
        if (isCut && sameDoc && srcName) {
          before = deleteEntriesByNameXml(before, [srcSelector]);
          registerModel(before);
        }
        const freshModel = (DataModel as any).getDataSource?.(document.srcId) ?? model;
        const freshSection = resolveSectionForPaste(freshModel, findNode(rowId), rowId) ?? section;
        const { newText, selectId } = pasteEntryXml(before, freshSection, clip.payload);
        document.pushEdit('Paste', document.chunkXml, newText);
        post();
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
        buildModel();
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

        const before = document.chunkXml;
        let working = before;
        // A same-document move removes the originals first so the pasted copies
        // keep their names, then re-parses so the paste's uniqueness check sees
        // the post-delete namespace. A copy, or a cross-document move, leaves this
        // document's originals untouched here.
        if (isMove && sameDoc && sourceTargets.length) {
          working = deleteEntriesByNameXml(working, sourceTargets);
        }
        registerModel(working);
        const model = (DataModel as any).getDataSource?.(document.srcId);
        const section = resolveSectionForPaste(model, findNode(msg.rowId), msg.rowId);
        if (!section) {
          webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
          post();
          return;
        }

        const { newText, selectIds } = pasteEntriesXml(working, section, payloads);
        document.pushEdit(isMove ? 'Move' : 'Copy', before, newText);
        post();
        if (selectIds.length) webview.postMessage({ type: 'selectRow', rowId: selectIds[selectIds.length - 1] });

        // Cross-document move: remove the originals from the SOURCE document via
        // its own deleter (a second native undo step on that document).
        if (isMove && !sameDoc) {
          await deleteFromSource(drag.sourceDocUri, sourceTargets);
        }

        clearDrag();
        broadcastDragState();
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (msg?.type === 'ready') post();
      else if (msg?.type === 'select') this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      else if (msg?.type === 'edit') applyEdit(msg);
      else if (msg?.type === 'copy') applyCopy(msg.rowId, 'copy');
      else if (msg?.type === 'cut') applyCopy(msg.rowId, 'cut');
      else if (msg?.type === 'delete')
        applyStructural(
          msg.rowId,
          (xml, node) => (node.isEntry ? deleteEntryXml(xml, node) : deleteChildXml(xml, node)),
          'Delete',
          // Deleting a nested child changes only its entry's rows. Deleting the ENTRY
          // changes which entries the table has — and deleteEntryXml is a text-only
          // splice that leaves the model holding the entry it just removed, so this is
          // also the path that needs the re-parse to catch the model up.
          (node) => (node.isEntry ? null : findOwningEntry(node)),
        );
      else if (msg?.type === 'addChild')
        applyStructural(
          msg.rowId,
          (xml, node) => addChildXml(xml, node),
          'Add child',
          // Always entry-scoped, even when the target IS the entry (a top-level Bus
          // gaining an element): a new child is a new row INSIDE the entry's run.
          (node) => findOwningEntry(node),
        );
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
    <dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>
${LOADING_OVERLAY_HTML}`,
    });

    webviewPanel.onDidDispose(() => {
      unregisterWebview(webview);
      unregisterSourceDeleter(uriString);
      // If a drag originated from this now-closing view, drop it so a stale
      // register can't complete against another document.
      if (getDrag()?.sourceDocUri === uriString) {
        clearDrag();
        broadcastDragState();
      }
      sub.dispose();
      navSub.dispose();
      document._afterMutate = undefined;
      clearBaseline(uriString);
    });
  }

  // --- Save / backup / revert (the safety gate lives here) ---
  async saveCustomDocument(document: BinarySlddDocument, _token: vscode.CancellationToken): Promise<void> {
    await this.writeTo(document, document.uri);
    // Re-baseline to the just-saved content so per-row "Modified" marks clear,
    // then repaint (mirrors SlddTextEditorProvider's onDidSaveTextDocument path).
    this.reBaseline(document);
    document._afterMutate?.();
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
    const chunk = zip['data/chunk0.xml'];
    if (chunk) document.chunkXml = new TextDecoder().decode(chunk);
    document._afterMutate?.();
  }

  async backupCustomDocument(
    document: BinarySlddDocument,
    ctx: vscode.CustomDocumentBackupContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    await this.writeTo(document, ctx.destination);
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
  private reBaseline(document: BinarySlddDocument): void {
    try {
      DataModel.removeDataSource(document.srcId);
      // The sink is threaded here too, though nothing reads it on this path: this
      // re-registration is what the session holds until the next post(), and a node
      // that carries its warnings on one route into the session and not on another is
      // how a source silently stops reporting.
      const warnings: ParseWarning[] = [];
      const node = DataModel.addDataSource(
        document.srcId,
        readSlddParts(document.chunkXml, document.zipMeta, warnings),
        { path: basename(document.uri.path) || 'document' },
        warnings,
      );
      captureBaseline(document.uri.toString(), node);
    } catch {
      /* leave baseline as-is on parse failure */
    }
  }

  // Save gate: re-parse chunkXml before zipping. On failure, throw — VS Code keeps
  // the document dirty and shows the error; the on-disk file is never touched. This
  // is the call site the reads-as-empty rule in readSlddParts matters most for: a
  // chunk the reader cannot read yields a dictionary with no entries, and zipping
  // that over the file on disk would take every entry with it, silently.
  private async writeTo(document: BinarySlddDocument, dest: vscode.Uri): Promise<void> {
    try {
      readSlddParts(document.chunkXml, document.zipMeta);
    } catch (err) {
      throw new Error('Refusing to save: the document did not re-parse (' + (err as Error).message + ').');
    }
    const zipEntries: Record<string, Uint8Array> = { ...document.zipMeta };
    zipEntries['data/chunk0.xml'] = new TextEncoder().encode(document.chunkXml);
    const zipped = zipSync(zipEntries, { level: 6 });
    await vscode.workspace.fs.writeFile(dest, zipped);
  }
}
