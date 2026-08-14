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
import { renderWebviewHtml } from './webviewHtml.js';
import { buildRows, COLUMNS, COLUMN_LABELS, COLUMN_GROUPS, type ClipMark } from './rowBuilder.js';
import { sectionRules } from './sectionRules.js';
import { parseBinarySlddParts } from '../dex/datamodel/parser/BinarySlddParser.js';
import { serializeEntryToXml } from '../dex/datamodel/parser/BinarySlddSerializer.js';
import DataModel from '../dex/core/DataModel.js';
import '../dex/datamodel/node/NodeClassMap.js';
import { findOwningEntry, resolveSectionForPaste } from './structuralEdit.js';
import { captureBaseline, computeModified, clearBaseline } from './slddBaseline.js';
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
import { setClipboard, getClipboard, clearClipboard, clipboardState } from './clipboard.js';
import { setDrag, getDrag, clearDrag, type DragRegisterItem } from './dragState.js';
import {
  registerWebview,
  unregisterWebview,
  registerSourceDeleter,
  unregisterSourceDeleter,
  broadcastClipboardState,
  broadcastDragState,
  deleteFromSource,
} from './editorHub.js';
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

    // Rebuild the model from the live chunkXml (+ pass-through parts).
    const buildModel = () => {
      DataModel.removeDataSource(document.srcId);
      const content = parseBinarySlddParts(document.chunkXml, document.zipMeta);
      return DataModel.addDataSource(document.srcId, content, { path: name });
    };
    const findNode = (rowId: string): any => {
      const found = (DataModel as any).findNodeById?.(rowId);
      return found ?? null;
    };

    const post = () => {
      try {
        const node = buildModel();
        if (!initialized) {
          captureBaseline(uriString, node);
          initialized = true;
        }
        const modified = computeModified(uriString, node);
        const clip = getClipboard();
        const clipMark: ClipMark | undefined =
          clip && clip.sourceDocUri === uriString && clip.payload.name
            ? { name: clip.payload.name as string, section: clip.sourceSection, mode: clip.mode }
            : undefined;
        const rows = buildRows(node, modified, clipMark);
        webview.postMessage({
          type: 'setRows',
          rows,
          columns: COLUMNS,
          columnLabels: COLUMN_LABELS,
          columnGroups: COLUMN_GROUPS,
          editable: true,
        });
        webview.postMessage({ type: 'sectionRules', docUri: uriString, rules: sectionRules(node) });
        webview.postMessage({ type: 'clipboardState', ...clipboardState() });
        drainNavigateSelect(webview, uriString);
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to parse ${name}: ${(err as Error).message}` });
      }
    };
    document._afterMutate = post;

    // Register with the cross-provider hub so clipboard/drag state broadcasts
    // from ANY .sldd table (JSON or binary) reach this webview, and so a
    // cross-document move whose SOURCE is this binary .sldd can complete its
    // source-delete via a format-appropriate edit (an in-memory chunkXml splice
    // pushed onto this document's own undo stack, then a repaint).
    registerWebview(webview, post);
    registerSourceDeleter(uriString, (names) => {
      const before = document.chunkXml;
      const after = deleteEntriesByNameXml(before, names);
      if (after === before) return;
      document.pushEdit('Move (remove source)', before, after);
      post();
    });

    // Apply a structural transform: build model, locate node, run transform, push edit.
    const applyStructural = (
      rowId: string,
      transform: (xml: string, node: any, model: any) => StructuralResult,
      label: string,
    ) => {
      try {
        const model = buildModel();
        const node = findNode(rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
          return;
        }
        const before = document.chunkXml;
        const { newText, selectId } = transform(before, node, model);
        document.pushEdit(label, before, newText);
        post();
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    // Value edit / rename: mutate node, reserialize its owning entry, splice.
    const applyEdit = (msg: { rowId: string; columnId: string; oldValue: string; newValue: string }) => {
      try {
        buildModel();
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
        const entryNameForLookup = entry.name;
        const result = node.setProperty(msg.columnId, msg.newValue);
        if (result && typeof result === 'object' && result.error) {
          webview.postMessage({
            type: 'validationError',
            reason: result.reason,
            invalidValue: msg.newValue,
            previousValue: msg.oldValue,
          });
          post();
          return;
        }
        const before = document.chunkXml;
        const frag = serializeEntryToXml(entry).replace(/\n$/, '');
        const span = findEntryObjectSpan(before, entryNameForLookup);
        if (!span) {
          webview.postMessage({ type: 'error', message: 'Could not locate the entry text to update.' });
          return;
        }
        const after = before.slice(0, span.offset) + frag + before.slice(span.offset + span.length);
        document.pushEdit('Edit ' + msg.columnId, before, after);
        post();
        if (msg.columnId === 'Name') webview.postMessage({ type: 'selectRow', rowId: node.id });
      } catch (err) {
        webview.postMessage({ type: 'error', message: 'Failed to apply edit: ' + (err as Error).message });
      }
    };

    const applyCopy = (rowId: string, mode: 'cut' | 'copy') => {
      try {
        buildModel();
        const node = findNode(rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: `Could not ${mode} the selected item.` });
          return;
        }
        const entry = findOwningEntry(node);
        if (!entry) {
          webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
          return;
        }
        setClipboard(entry.serialize() as Record<string, unknown>, mode, entry.parent?.name ?? '', uriString);
        // Broadcast so every other open .sldd table (JSON or binary) enables
        // Paste and this view repaints to show the cut/copied affordance.
        broadcastClipboardState();
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to ${mode}: ${(err as Error).message}` });
      }
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
        const srcName = (clip.payload.name as string) || '';

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
          before = deleteEntriesByNameXml(before, [srcName]);
          DataModel.removeDataSource(document.srcId);
          DataModel.addDataSource(document.srcId, parseBinarySlddParts(before, document.zipMeta), { path: name });
        }
        const freshModel = (DataModel as any).getDataSource?.(document.srcId) ?? model;
        const freshSection = resolveSectionForPaste(freshModel, findNode(rowId), rowId) ?? section;
        const { newText, selectId } = pasteEntryXml(before, freshSection, clip.payload);
        document.pushEdit('Paste', document.chunkXml, newText);
        post();
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
        // A cross-document cut removes the source from ITS document via that
        // document's own format-appropriate deleter (JSON or binary), a second
        // native undo step — exactly a cut in one file + paste in another.
        if (isCut && !sameDoc && clip.sourceDocUri && srcName) {
          await deleteFromSource(clip.sourceDocUri, [srcName]);
        }
        if (isCut) {
          clearClipboard();
          broadcastClipboardState();
        }
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    // --- Drag start: snapshot the dragged rows into the host drag register ------
    // Mirrors SlddTextEditorProvider.applyDragStart: each dragged row's owning
    // entry is serialized (the payload the drop pastes) alongside the display
    // facts (class/kind) the target webview needs to predict the drop, then the
    // payload-free descriptor is broadcast so every open table renders feedback.
    const applyDragStart = (msg: { rowIds: string[] }): void => {
      try {
        buildModel();
        const rowIds = Array.isArray(msg.rowIds) ? msg.rowIds : [];
        const items: DragRegisterItem[] = [];
        let sourceSection = '';
        let sourceSectionLabel = '';
        let sourceIsDerived = false;
        for (const rowId of rowIds) {
          const node = findNode(rowId);
          if (!node) continue;
          const entry = findOwningEntry(node);
          if (!entry || !entry.isEntry) continue;
          const payload = entry.serialize() as Record<string, unknown>;
          const value = payload.value as Record<string, unknown> | undefined;
          const arrayClass = (value && typeof value === 'object' && (value._array_class as string)) || '';
          items.push({
            payload,
            className: entry.className ?? '',
            arrayClass,
            kind: entry.kind ?? '',
            isMatlabVariable: !arrayClass,
            isScalarNumeric: entry.isScalarNumeric === true,
          });
          const section = entry.parent;
          if (section) {
            sourceSection = section.name ?? '';
            sourceSectionLabel = section.displayName ?? section.name ?? '';
            sourceIsDerived = !!entry.isDerived;
          }
        }
        if (items.length === 0) clearDrag();
        else setDrag(uriString, sourceSection, sourceSectionLabel, sourceIsDerived, items);
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
        const sourceNames = drag.items
          .map((it) => (it.payload.name as string) || '')
          .filter((n) => n.length > 0);

        const before = document.chunkXml;
        let working = before;
        // A same-document move removes the originals first so the pasted copies
        // keep their names, then re-parses so the paste's uniqueness check sees
        // the post-delete namespace. A copy, or a cross-document move, leaves this
        // document's originals untouched here.
        if (isMove && sameDoc && sourceNames.length) {
          working = deleteEntriesByNameXml(working, sourceNames);
        }
        DataModel.removeDataSource(document.srcId);
        DataModel.addDataSource(document.srcId, parseBinarySlddParts(working, document.zipMeta), { path: name });
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
          await deleteFromSource(drag.sourceDocUri, sourceNames);
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
        );
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
    <dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>
    <dex-context-menu></dex-context-menu>
    <dex-error-dialog></dex-error-dialog>`,
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
      const node = DataModel.addDataSource(
        document.srcId,
        parseBinarySlddParts(document.chunkXml, document.zipMeta),
        { path: basename(document.uri.path) || 'document' },
      );
      captureBaseline(document.uri.toString(), node);
    } catch {
      /* leave baseline as-is on parse failure */
    }
  }

  // Save gate: re-parse chunkXml before zipping. On failure, throw — VS Code keeps
  // the document dirty and shows the error; the on-disk file is never touched.
  private async writeTo(document: BinarySlddDocument, dest: vscode.Uri): Promise<void> {
    try {
      parseBinarySlddParts(document.chunkXml, document.zipMeta);
    } catch (err) {
      throw new Error('Refusing to save: the document did not re-parse (' + (err as Error).message + ').');
    }
    const zipEntries: Record<string, Uint8Array> = { ...document.zipMeta };
    zipEntries['data/chunk0.xml'] = new TextEncoder().encode(document.chunkXml);
    const zipped = zipSync(zipEntries, { level: 6 });
    await vscode.workspace.fs.writeFile(dest, zipped);
  }
}
