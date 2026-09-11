// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { renderWebviewHtml, BANNERS_HTML } from './webviewHtml.js';
import { getModel, invalidate, findNode, peekModel } from './SlddModel.js';
import { findEntrySpan, detectIndent } from './entrySplice.js';
import {
  buildRows,
  buildEntryRows,
  COLUMNS,
  COLUMN_LABELS,
  COLUMN_GROUPS,
  type ClipMark,
} from './rowBuilder.js';
import { captureBaseline, computeModified, isEntryModified, clearBaseline } from './slddBaseline.js';
import {
  applyEntryOps,
  findEntryByName,
  findEntryBySelector,
  insertOp,
  mutateEntry,
  opsOfPastedEntries,
  patchOfPairs,
  removeOp,
  type AppliedOp,
  type EntryOpPair,
} from './entryOps.js';
import {
  isEchoOfEdit,
  planEntrySync,
  planKnownChange,
  planKnownOps,
  planOwnEdit,
  type HostEdit,
  type KnownEdit,
  type RangeReplacement,
} from './jsonEntrySync.js';
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
  type DeleteTarget,
} from './editorHub.js';
import { sectionRules } from './sectionRules.js';
import {
  deleteEntry,
  deleteChild,
  addChild as addChildEdit,
  pasteEntries,
  deleteEntriesByName,
  findOwningEntry,
  resolveSectionForPaste,
  reserializeEntry,
  buildDragSnapshot,
  type StructuralResult,
  type TextPatch,
} from './structuralEdit.js';
import { minimalReplacement } from './minimalEdit.js';
import { copyEntriesToClipboard } from './clipboardAction.js';
import { annotateDataRows, annotateDataRowsNow } from './usageGraph.js';
import { sourceWarnings, warningBanner } from './parseWarnings.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import { parsesAsJson } from './slddFormat.js';
import { entrySelectorOf, type EntrySelector } from './entrySelector.js';
import { catalogRenameOf, scJsonRenameEdits } from './scRename.js';
import { buildSectionRowId } from '../common/sectionRowId.js';
import { basename } from '../common/pathUtil.js';
import type { TableToHostMessage } from '../common/protocol.js';

// Custom editor for EDITABLE JSON .sldd, backed by VS Code's native TextDocument
// (CustomTextEditorProvider). Because every edit is a WorkspaceEdit on that
// TextDocument, undo/redo, dirty state, save, and revert are all handled
// natively by VS Code — a SINGLE undo stack shared with the plain-text view.
// Editing in either the table or the text view live-syncs to the other, and
// Cmd+Z / Cmd+Shift+Z work identically in both.
//
// Binary .sldd / .slx / .mat / .prj are handled by the read-only
// BinaryEditorProvider instead (they can't be opened as text documents).
export class SlddTextEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'dataExplorer.tableView';

  // Clipboard and drag state are shared across BOTH the JSON and binary table
  // editors (they back the same webview + the same singletons), so the live-
  // webview registry and its broadcasts live in editorHub.ts. Without the
  // broadcast, a second already-open .sldd would never learn the clipboard now
  // has content (Paste stays disabled), and a drag begun in one .sldd would not
  // reach another to predict its drop. See editorHub.js.

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;

  // Handle a Usage-column link click: open the referenced file and select the
  // target row there (wired in extension.ts to the shared navigate handler).
  public onNavigate?: (target: string) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };

    // Give the table tab a distinct table glyph instead of VS Code's default
    // JSON `{}` icon (which the plain-text view of the same .sldd also shows, so
    // the two tabs would otherwise be indistinguishable). Reuse the built-in
    // `$(table)` codicon — the same icon as the "View as Table" toolbar button —
    // so it tracks the theme's icon color automatically.
    webviewPanel.iconPath = new vscode.ThemeIcon('table');

    const uriString = document.uri.toString();
    const name = basename(document.uri.path) || 'document';

    // Capture the on-open baseline once so per-entry "Modified" marks are diffed
    // against the initial content.
    let initialized = false;

    /**
     * Whether both the tree this document holds and every row on screen were built from the
     * text as it now reads.
     *
     * The precondition of the entry-scoped repaint, and the reason a stretch of invalid
     * JSON cannot leave a stale row behind. While the document does not parse, each
     * keystroke's repaint fails and paints nothing; if the keystroke that finally makes it
     * parse were repainted narrowly, only the entry that keystroke was in would be
     * refreshed — every other entry the user touched during the invalid stretch would keep
     * the rows it had before. So a failed repaint withdraws the narrow path until a full
     * one has succeeded.
     *
     * It covers the MODEL as well as the rows because that is what lets an edit keep the
     * tree it is holding instead of re-parsing 46 MB to rebuild one that was already
     * correct (see liveModel), and what lets it skip the validity gate: a tree built from
     * this text is proof the text parsed. Every path that leaves the two out of step has to
     * clear it — which is the one obligation this flag imposes and the only way it can lie.
     */
    let modelInSync = false;

    // If the clipboard's cut/copied entry lives in THIS document, the mark its source
    // row should carry, so the table can render the cut (dimmed) / copied (dashed)
    // affordance. Cleared automatically once the clipboard empties on paste.
    //
    // Shared by the full and entry-scoped repaints, so a cut affordance renders the same
    // way whichever one painted it: one that appeared or vanished depending on which
    // repaint the user happened to trigger would be a bug visible only after an edit.
    // A ClipMark still names ONE entry, so a clipboard holding several marks only the
    // first of them — the rest of the cut sources show no affordance until the mark
    // becomes a set of keys.
    const clipMarkOfDoc = (): ClipMark | undefined => {
      const clip = getClipboard();
      const first = clip?.items[0];
      return clip && clip.sourceDocUri === uriString && first?.payload.name
        ? { name: first.payload.name as string, section: first.sourceSection, mode: clip.mode }
        : undefined;
    };

    /**
     * The tree for this document — the one already built when it still says what the text
     * says, a fresh parse when it does not.
     *
     * The registered tree, not this module's cache: `invalidate` is called on every keystroke
     * in an open .sldd (extension.ts drops the cache so the tree view and the usage graph
     * re-read), so getModel would re-parse every time. On a 47.8 MB customer dictionary that
     * parse is ~190 ms, paid on a keypress the user is waiting on.
     *
     * Deliberately does NOT touch modelInSync: a rebuild here brings the MODEL up to the text
     * and leaves the ROWS wherever they were, so the narrow repaint stays withdrawn until a
     * full one has run.
     */
    const liveModel = (): any => {
      if (modelInSync) {
        const held = peekModel(uriString);
        if (held) return held;
      }
      invalidate(uriString);
      return getModel(uriString, name, document.getText());
    };

    /**
     * Bring the model back in step with the text, painting nothing.
     *
     * For the one case that needs it: an edit that mutated the tree and then could not write
     * the text. Re-parsing is the repair — the text is the truth in this format — and the rows
     * on screen still match it, so nothing has to be repainted; what must not happen is
     * leaving a mutated tree that the text does not say, for the next edit to build on.
     */
    const rebuildModel = (): void => {
      invalidate(uriString);
      try {
        getModel(uriString, name, document.getText());
      } catch {
        // The text does not parse, so nothing can be trusted: the next repaint goes wide and
        // reports the parse error.
        modelInSync = false;
      }
    };

    // Rebuild the model from the live TextDocument text and push rows to the
    // webview. Called on open, on every text change that is not a single entry's
    // (see syncOneEntry), and on save. The Usage column is filled asynchronously
    // from the shared workspace usage graph.
    //
    // Returns when the rows are on the wire, for the same reason postEntryRows does: a banner
    // that has to outlive a repaint has to be posted after it.
    const post = (): Promise<void> => {
      try {
        invalidate(uriString);
        const node = getModel(uriString, name, document.getText());
        if (!initialized) {
          captureBaseline(uriString, node);
          initialized = true;
        }
        const modified = computeModified(uriString, node);
        const clipMark = clipMarkOfDoc();
        const rows = buildRows(node, modified, clipMark);
        // Every row below is built from `node`, which getModel just parsed from the live
        // text and registered as this document's source.
        modelInSync = true;
        // Fill the Usage column from the shared usage graph, then post. The graph
        // builds lazily on first use and is cached, so only the very first open in
        // a session pays the scan cost; subsequent posts resolve near-instantly.
        return annotateDataRows(uriString, rows)
          .catch(() => false)
          .then(() => {
            webview.postMessage({
              type: 'setRows',
              rows,
              columns: COLUMNS,
              columnLabels: COLUMN_LABELS,
              columnGroups: COLUMN_GROUPS,
              editable: true,
              // Backed by a TextDocument, so "Location in Text" has a target.
              hasTextView: true,
              // Recomputed on every repaint, which for this view means on every
              // keystroke in the plain-text editor: a dictionary the user is midway
              // through fixing should stop warning the moment it reads whole.
              warnings: warningBanner(sourceWarnings(node)),
            });
            // Ship this document's section drop-rules so the webview can predict
            // a drop (dropDecision) live on dragover without a host round-trip.
            webview.postMessage({ type: 'sectionRules', docUri: uriString, rules: sectionRules(node) });
            webview.postMessage({ type: 'clipboardState', ...clipboardState() });
            // The mark these rows CARRY, not the one the clipboard holds now: a copy that
            // happened while the rows were in flight is behind them in the webview's queue, so
            // what is on screen is `clipMark`, and the next broadcast has to see the difference.
            paintedMark = clipMark;
            drainNavigateSelect(webview, uriString);
          });
      } catch (err) {
        invalidate(uriString);
        // Nothing was painted, so what is on screen is older than the text (see
        // modelInSync): the next repaint has to be a full one.
        modelInSync = false;
        webview.postMessage({
          type: 'error',
          message: `Failed to parse ${name}: ${(err as Error).message}`,
        });
        return Promise.resolve();
      }
    };

    // One entry's rows, as a full rebuild would have built them: the two whole-model passes
    // post() runs are asked about a single entry here (computeModified would serialize all
    // 64,700 entries of a big dictionary to answer about one). Everything else about the view —
    // columns, banners, section rules, the clipboard state — is what the last setRows left,
    // because none of it can change under an edit inside one entry.
    const entryRowsOf = (entry: any): any[] => {
      const modified = new Set<string>();
      if (isEntryModified(uriString, entry)) modified.add(entry.name);
      const mark = clipMarkOfDoc();
      const sectionName = entry.parent?.name ?? '';
      // Pre-matched by section exactly as buildRows does it: entry names are unique
      // within a section, not across the file, so only the marked entry's own section
      // may carry the mark.
      const sectionMark = mark && mark.section === sectionName ? mark : undefined;
      return buildEntryRows(entry, sectionName, modified, sectionMark);
    };

    /**
     * Repaint ONE entry: splice its rows over the run the table already holds under `entryRowId`.
     *
     * Returns the promise, for the callers that have something to say AFTER the rows: fresh rows
     * clear the error banner (see the webview's `updateEntryRows`), so a banner posted beside
     * them has to come second or it is wiped by them.
     */
    const postEntryRows = (entryRowId: string, entry: any): Promise<void> => {
      const rows = entryRowsOf(entry);
      return annotateDataRows(uriString, rows)
        .catch(() => false)
        .then(() => {
          void webview.postMessage({ type: 'updateEntryRows', entryRowId, rows });
        });
    };

    /**
     * The same repaint, posted in THIS synchronous run — which is the only way an edit can be on
     * screen before the host goes off to do the rest of the work.
     *
     * A postMessage issued from a promise callback cannot reach the renderer until the host next
     * yields, and on the edit path that is ~100 ms of span scan away. Measured in real VS Code
     * against a host that then blocks for 120 ms: posted synchronously the renderer has it in
     * 1 ms, posted from a `.then` it has it in 120 ms. Which makes the await for the Usage graph —
     * the only asynchronous thing about a repaint — the difference between an edit that appears
     * instantly and one that appears when the scan is done.
     *
     * When the graph is COLD the rows still go out now, and the Usage column catches up in a
     * second post. Usage is the one cell this document cannot answer on its own, and the graph
     * that answers it spans the workspace: over a folder of real dictionaries a rebuild costs
     * ~5.8 s (measured; 4 files, 98 MB). Holding 180 ms of finished rows for it is how an undo
     * came to take seven seconds. A column that fills in a moment later is the smaller cost,
     * and it is only ever paid when something invalidated the graph.
     */
    const postEntryRowsNow = (entryRowId: string, entry: any): void => {
      const rows = entryRowsOf(entry);
      const filled = annotateDataRowsNow(uriString, rows);
      void webview.postMessage({ type: 'updateEntryRows', entryRowId, rows });
      if (!filled) void postEntryRows(entryRowId, entry);
    };

    /**
     * Repaint what a STRUCTURAL change did: entries that left the table, arrived in it, or were
     * rebuilt — as the rows those three amount to, and nothing else.
     *
     * The rest of this provider's narrow repaints are one entry replaced in place, which is
     * every edit INSIDE an entry. A delete, a paste, a drop and their undos change which
     * entries the dictionary has, so the row COUNT changes and the rows the table keeps are the
     * ones the host never mentions. That is the whole message set: an empty replacement is a
     * removal (see spliceEntryRows), an insert has to be told its place, and the webview
     * answers a message it cannot place by asking for a full payload rather than guessing.
     *
     * Posted in THIS synchronous run for the same reason postEntryRowsNow is: a postMessage from
     * a `.then` cannot reach the renderer until the host next yields, which on these paths is a
     * text write away. A cold Usage graph is caught up in a second post per entry.
     *
     * Same shape as the binary provider's repaintOps, deliberately — a delete has to mean the
     * same thing in the two .sldd formats, and the way these two once differed is exactly the
     * bug class this repo keeps finding.
     */
    const repaintOps = (applied: readonly AppliedOp[]): void => {
      try {
        for (const op of applied) {
          if (op.kind === 'remove') {
            // An empty replacement IS the removal — see spliceEntryRows.
            void webview.postMessage({ type: 'updateEntryRows', entryRowId: op.entryRowId, rows: [] });
            continue;
          }
          const section = op.entry?.parent;
          if (!section) throw new Error(`"${op.entry?.name}" is not in a section.`);
          const rows = entryRowsOf(op.entry);
          const filled = annotateDataRowsNow(uriString, rows);
          if (op.kind === 'replace') {
            void webview.postMessage({ type: 'updateEntryRows', entryRowId: op.entryRowId, rows });
          } else {
            void webview.postMessage({
              type: 'insertEntryRows',
              sectionRowId: buildSectionRowId(section.name),
              beforeRowId: op.beforeRowId,
              rows,
            });
          }
          // The rows are on screen; the Usage column follows when the graph is cold. Addressed
          // by the entry's CURRENT id, which for an insert is the run just added.
          if (!filled) void postEntryRows(op.kind === 'replace' ? op.entryRowId : op.entry.id, op.entry);
        }
      } catch (err) {
        // The model change has already landed, so the table must not be left showing the rows
        // from before it. Repaint wide, then say so — after, because fresh rows are how the
        // webview learns a failure is over and would wipe a banner posted first.
        void post().then(() =>
          webview.postMessage({ type: 'error', message: `Failed to update the row: ${(err as Error).message}` }),
        );
      }
    };

    /**
     * What the table edit in flight will need when its own change event arrives: the entry it
     * changed, the row id the screen holds that entry under, and the range replacement it
     * submitted.
     *
     * Set immediately before the WorkspaceEdit and spent by the very next change event,
     * whatever that event turns out to be — an expectation that outlived its edit must not be
     * waiting when someone types in the text view. What makes spending it safe is that the
     * event has to PROVE it is that edit, byte for byte (planOwnEdit / isEchoOfEdit); a
     * mismatch costs the wide repaint the user has always had, never a wrong row.
     */
    let hostEdit: HostEdit | null = null;

    /**
     * A write whose rows are ALREADY on screen — so the change event it fires has nothing left
     * to paint.
     *
     * The structural edits (delete an entry, paste, drop, move) change the model with ops and
     * paint before they write, exactly as a cell edit does. Their echo cannot then be a
     * confirmation the way a cell edit's is: the bytes a delete writes are an element and a
     * comma removed, a paste's are an element with no name in the model yet, and neither reads
     * back as "this one entry now says that". Nothing narrow can plan them, so the change event
     * would fall through to the wide repaint — 1.4 s on a 47.8 MB dictionary, spent rebuilding
     * rows the user is already looking at.
     *
     * Same one-shot, prove-it-first rule as `hostEdit`: set immediately before the write, spent
     * by the very next change event, and honoured only if that event is this write byte for byte
     * (isEchoOfEdit). A write whose event never arrives leaves the flag behind, and the next
     * change — a keystroke in the text view, an undo — cannot match it, so it costs a repaint
     * rather than skipping one.
     */
    let paintedWrite: RangeReplacement | null = null;

    /**
     * The edits this host has written to this document, newest last — kept PAST their own
     * events, because VS Code can hand any of them back at any time as an undo or a redo.
     *
     * That is the whole reason an undo was slow: the change event says only "these bytes
     * replaced those", so the host went looking for the entry it had already written down —
     * `document.getText()` (35 ms on a 47.8 MB dictionary) and a full structural walk of it
     * (138 ms), for an element it could name from memory. See planKnownChange.
     *
     * Bounded, because undo history is not: the last sixteen edits cover the depth anyone
     * undoes interactively, and the cost of a miss is the scan, which is what every undo used
     * to cost. Each holds two entry-sized strings, so this is kilobytes beside a document
     * measured in tens of megabytes.
     *
     * Bounded by SIZE too, since one edit is not: a same-document move writes a region reaching
     * from the entry it took out to the end of the entries array, which on a real dictionary is
     * megabytes of text in each direction. Sixteen of those held to save a repaint is the wrong
     * trade — that undo repaints wide, as it always has.
     */
    const knownEdits: KnownEdit[] = [];
    const REMEMBER_LIMIT = 1_000_000;
    const remember = (edit: KnownEdit): void => {
      if (edit.submitted.text.length + edit.replaced.length > REMEMBER_LIMIT) return;
      knownEdits.push(edit);
      if (knownEdits.length > 16) knownEdits.shift();
    };

    /**
     * Repaint the entry THIS host just wrote, from the bytes it wrote.
     *
     * The whole point of step 2: the change event a table edit fires tells the host nothing it
     * does not already know, so it does not have to be treated like a stranger's keystroke.
     * Instead of scanning the array for the element that changed and re-parsing it (~120 ms on
     * a 46 MB dictionary, on top of the ~101 ms span scan and the ~92 ms validity parse the
     * edit no longer pays), the entry is rebuilt from the text that was submitted and its rows
     * spliced over the run the table is holding.
     *
     * Rebuilding rather than repainting from the mutated node — 7 ms rather than 3 — is what
     * keeps this exactly as correct as the re-parse it replaces: the rows come from the file's
     * own bytes, so a mutation the format cannot express (a rename with nowhere to go, a
     * Description that is never serialized, an architectural kind that is re-derived on read)
     * shows on screen as what the file will say, not as what the user typed.
     *
     * For a table edit those rows are now a CONFIRMATION: applyEdit painted the same entry from
     * the mutated node before it wrote a byte, because waiting for this event costs ~200 ms on a
     * big dictionary and the model had the answer immediately. So this is where the file gets the
     * last word — over a paint it agrees with cell for cell, swept in jsonHostEditRepaint. It
     * still repaints rather than merely reconciling the model: the day the two disagree, the
     * bytes are what the user should be left looking at.
     */
    // A change event as the plain range replacements every path here reasons about. One reading
    // of an event, so the four of them cannot disagree about what it said.
    const changesOf = (e: vscode.TextDocumentChangeEvent): RangeReplacement[] =>
      e.contentChanges.map((c) => ({
        rangeOffset: c.rangeOffset,
        rangeLength: c.rangeLength,
        text: c.text,
      }));

    const syncOwnEdit = (e: vscode.TextDocumentChangeEvent, hint: HostEdit | null): boolean => {
      if (!hint) return false;
      const plan = planOwnEdit(changesOf(e), hint);
      if (!plan) return false;
      // Same two preconditions the text-view path has: rows that match the text, and a tree
      // still registered for this document to apply the op to.
      if (!modelInSync) return false;
      const model = peekModel(uriString);
      if (!model) return false;
      try {
        const applied = applyEntryOps(model, [plan.op]);
        const op = applied[0];
        // PRECONDITION (untested): applyEntryOps answers a `replace` op with a `replace`, one
        // per op. Checked rather than asserted so a shape change falls back to the full repaint
        // instead of painting rows for an entry it did not resolve.
        if (!op || op.kind !== 'replace') return false;
        void postEntryRows(plan.entryRowId, op.entry);
        return true;
      } catch {
        // The model may now be half-changed, so the caller's full repaint is the repair: it
        // re-parses the text, which is the truth in this format.
        invalidate(uriString);
        modelInSync = false;
        return false;
      }
    };

    /**
     * Repaint an UNDO or a REDO of one of this host's own STRUCTURAL edits — a delete, a paste,
     * a drop, a move.
     *
     * The sibling below recovers a cell edit's undo by re-parsing the bytes that came back,
     * because those bytes are one element and an element says everything about the entry it
     * names. These edits write bytes that say nothing on their own: a deleted element and the
     * comma that held it, an insertion the model has no name for yet, a move spanning two places
     * at once. So what they MEANT is remembered with them as model ops, and either direction is
     * recognised byte-for-byte at its exact offset (planKnownOps).
     *
     * Applying those ops is what makes the undo cost the edit: the entry comes back from the
     * record the delete kept, rather than out of a fresh parse of 47.8 MB, and only the rows it
     * occupies are repainted.
     *
     * Same two state preconditions as every narrow path — rows that match the text, and a tree
     * still registered to apply the ops to. A refusal costs the wide repaint, which is what
     * every structural undo used to cost.
     */
    const syncKnownOps = (e: vscode.TextDocumentChangeEvent): boolean => {
      if (e.contentChanges.length !== 1 || knownEdits.length === 0) return false;
      if (!modelInSync) return false;
      const model = peekModel(uriString);
      if (!model) return false;
      const ops = planKnownOps(changesOf(e), knownEdits);
      if (!ops || ops.length === 0) return false;
      try {
        repaintOps(applyEntryOps(model, ops));
        return true;
      } catch {
        // The model may now be half-changed, so the caller's full repaint is the repair: it
        // re-parses the text, which is the truth in this format.
        invalidate(uriString);
        modelInSync = false;
        return false;
      }
    };

    /**
     * Repaint the entry an UNDO or a REDO of one of this host's own edits touched.
     *
     * The last leg of the round trip. A table edit paints from the model at once and its echo
     * is recognised (syncOwnEdit) — but pressing Cmd+Z on that same edit arrived as a
     * stranger's change and paid the full recovery below, ~175 ms of reading and walking 47.8 MB
     * to find an element the host wrote itself. Now the pair it wrote is remembered
     * (knownEdits) and either direction of it is matched byte-for-byte at its exact offset, so
     * the changed element is the text already in hand.
     *
     * The row id comes from the entry as the MODEL now holds it, read before the op detaches
     * it: an undo and its edit are one document apart, so by the time this runs the rows on
     * screen are the ones that edit painted — including the name a rename gave them, which is
     * the id the undone rows have to be spliced over.
     *
     * Same two state preconditions as the paths either side of it, and a refusal costs the
     * recovery path, which is what an undo used to cost always.
     */
    const syncKnownChange = (e: vscode.TextDocumentChangeEvent): boolean => {
      if (e.contentChanges.length !== 1 || knownEdits.length === 0) return false;
      if (!modelInSync) return false;
      const model = peekModel(uriString);
      if (!model) return false;
      try {
        const plan = planKnownChange(model, changesOf(e), knownEdits);
        if (!plan) return false;
        const entryRowId = plan.entry.id;
        const applied = applyEntryOps(model, [
          { kind: 'replace', rowId: plan.entry.id, record: plan.record },
        ]);
        const op = applied[0];
        // PRECONDITION (untested): applyEntryOps answers a `replace` op with a `replace`, one
        // per op. Checked rather than asserted so a shape change falls back to the full repaint
        // instead of painting rows for an entry it did not resolve.
        if (!op || op.kind !== 'replace') return false;
        // In THIS run, so the undone value is on screen ~1 ms after Cmd+Z — see
        // postEntryRowsNow.
        postEntryRowsNow(entryRowId, op.entry);
        return true;
      } catch {
        // The model may now be half-changed, so the caller's full repaint is the repair: it
        // re-parses the text, which is the truth in this format.
        invalidate(uriString);
        modelInSync = false;
        return false;
      }
    };

    /**
     * Sync ONE entry from the text, or say no.
     *
     * The narrow answer to "the text changed, and the host did not change it": find the entry
     * the change is inside, rebuild that entry from its own JSON, and repaint its rows. What it
     * replaces is a full re-parse + full row rebuild + full postMessage on every keystroke —
     * ~1.3 s of host work and a ~120 MB payload on a 46 MB dictionary, against ~82 ms to
     * locate the entry and 0.3 ms to rebuild it.
     *
     * Still the path for a table edit whose own event did not come back recognisable
     * (syncOwnEdit ran first and refused), which is why it takes the hint too: the row id on
     * screen is what a rename makes it unable to work out for itself.
     *
     * Returns false for anything it is not sure about, and the caller repaints the old way.
     * See jsonEntrySync.ts for what "sure" means; the checks that live HERE are the ones
     * about state rather than text:
     *   - one content change, because a batch's later offsets are stated against the text
     *     before the batch and so do not locate anything in the text after it;
     *   - rows that match the text (modelInSync) and a tree still registered for this
     *     document to apply the op to.
     */
    const syncOneEntry = (e: vscode.TextDocumentChangeEvent, hint: HostEdit | null): boolean => {
      if (e.contentChanges.length !== 1) return false;
      if (!modelInSync) return false;
      const model = peekModel(uriString);
      if (!model) return false;
      try {
        const change = e.contentChanges[0];
        const plan = planEntrySync(model, e.document.getText(), {
          rangeOffset: change.rangeOffset,
          text: change.text,
        });
        if (!plan) return false;
        // Honoured only when it names the very entry the plan resolved, so a hint left over
        // from an edit of another entry cannot move this repaint onto the wrong run of rows.
        const entryRowId = hint && hint.entryId === plan.entry.id ? hint.rowId : plan.entry.id;
        const applied = applyEntryOps(model, [
          { kind: 'replace', rowId: plan.entry.id, record: plan.record },
        ]);
        const op = applied[0];
        // PRECONDITION (untested): applyEntryOps answers a `replace` op with a `replace`,
        // one per op. Checked rather than asserted so a shape change here falls back to the
        // full repaint instead of painting rows for an entry it did not resolve.
        if (!op || op.kind !== 'replace') return false;
        // In THIS run, not from a promise: an undo, a redo and a keystroke in the text view all
        // arrive here, and the rows are already built — see postEntryRowsNow.
        postEntryRowsNow(entryRowId, op.entry);
        return true;
      } catch {
        // The model may now be half-changed, so the caller's full repaint is not just a
        // fallback but the repair: it re-parses the text, which is the truth in this
        // format, and re-registers the tree built from it.
        invalidate(uriString);
        modelInSync = false;
        return false;
      }
    };

    /**
     * The clipboard mark this view has already painted, and the narrow repaint that keeps it
     * current.
     *
     * A cut or copy makes no document edit, yet the source row must gain or lose its affordance,
     * so the hub asks every open table to repaint on every clipboard broadcast — and "repaint"
     * used to mean the whole table here, which made a copy in ANY open .sldd cost this document a
     * full re-parse and rebuild (~1.4 s on a 47.8 MB dictionary). At most TWO entries can be
     * affected: the one that just took the mark and the one that held it before. A broadcast that
     * changes neither — the usual case, the mark belonging to another document — now costs
     * nothing at all.
     *
     * An affected entry that is no longer in the model is skipped rather than repainted wide: its
     * rows are already gone (a cut+paste moves the very entry that held the mark), so there is
     * nothing left to un-dim.
     *
     * Same shape as the binary provider's repaintClipMark, deliberately — the affordance has to
     * mean the same thing in the two .sldd formats. The one difference is the guard below, which
     * this format needs and that one has no equivalent of: rows here can be older than the text
     * (see modelInSync), and only a full repaint can fix that.
     */
    let paintedMark: ClipMark | undefined;
    const markKey = (mark?: ClipMark): string =>
      mark ? JSON.stringify([mark.mode, mark.section, mark.name]) : '';
    const repaintClipMark = (): void => {
      const next = clipMarkOfDoc();
      if (markKey(paintedMark) === markKey(next)) return;
      // The rows on screen are not what the text says, so painting two entries over them would
      // leave the rest stale — this is the wide repaint every broadcast used to be.
      if (!modelInSync) {
        void post();
        return;
      }
      const affected = [paintedMark, next].filter((m): m is ClipMark => !!m);
      let model: any;
      try {
        model = liveModel();
      } catch {
        // No tree to name the affected entries in — and a throw here would break the hub's
        // broadcast to every OTHER view. The wide repaint is both the fallback and where the
        // parse error gets reported; paintedMark is left alone because nothing was painted.
        void post();
        return;
      }
      paintedMark = next;
      const ops: AppliedOp[] = [];
      const seen = new Set<string>();
      for (const mark of affected) {
        const entry = findEntryByName(model, mark.section, mark.name);
        // Both marks can name the same entry (a copy re-taken as a cut), and its rows only need
        // painting once.
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        ops.push({ kind: 'replace', entryRowId: entry.id, entry });
      }
      if (ops.length > 0) repaintOps(ops);
    };

    // Track this webview (mapped to its repaint) so clipboard-state changes from
    // any editor reach it — including a lazy cut, which only marks the clipboard
    // and needs a repaint to show the source row's affordance.
    registerWebview(webview, repaintClipMark);
    // Register how to delete named entries from THIS document, so a cross-
    // document move whose SOURCE is this .sldd can complete its source-delete
    // via a format-appropriate edit (here: a full-text WorkspaceEdit).
    registerSourceDeleter(uriString, (targets) => deleteFromSourceDocument(uriString, targets));

    /**
     * Write ONE region of the document. Feeds VS Code's native undo stack (so undo/redo and
     * the dirty flag are automatic) and fires onDidChangeTextDocument, which repaints the
     * table and any open text view.
     *
     * Every write in this provider is byte-scoped, because a WorkspaceEdit is stored as it was
     * handed over: a full-document replace makes VS Code rewrite all 47.8 MB of a real
     * dictionary to say a 1 KB thing, and keeps that rewrite as the undo step, so undoing it
     * costs the same again. The region comes from the transform that knows it (structuralEdit's
     * TextPatch) or, for the folded multi-step writes that cannot name one, from comparing the
     * two texts (minimalReplacement).
     *
     * Throws when the document refuses the write. VS Code refuses a WorkspaceEdit whose document
     * moved under it, and a refusal is a dropped edit — which, now that every structural path
     * paints before it writes, would leave the table showing an edit the file never took. The
     * callers' repair (undoPaint, or the wide repaint) is what makes that visible instead of
     * silent.
     */
    const writePatch = async (patch: TextPatch): Promise<void> => {
      const edit = new vscode.WorkspaceEdit();
      const range = new vscode.Range(
        document.positionAt(patch.offset),
        document.positionAt(patch.offset + patch.length),
      );
      edit.replace(document.uri, range, patch.text);
      const written = await vscode.workspace.applyEdit(edit);
      if (!written) throw new Error('the document rejected the edit (it may have changed on disk)');
    };

    // The one region to write to make the document read exactly `newText`, for the folded
    // multi-step edits that cannot name theirs. Named rather than written here, because a caller
    // that paints before it writes has to REMEMBER what it wrote (see paintedWrite).
    const patchFor = (result: { newText: string; patch?: TextPatch }, ownText: string): TextPatch =>
      result.patch ?? minimalReplacement(ownText, result.newText);

    // The range replacement a patch amounts to, as a change event will report it back.
    const submittedOf = (patch: TextPatch): RangeReplacement => ({
      rangeOffset: patch.offset,
      rangeLength: patch.length,
      text: patch.text,
    });

    // Guard against applying an edit while the text view holds invalid JSON
    // (a mid-edit state). Returns true when the current text parses; otherwise
    // posts an error banner and returns false so the caller can bail.
    //
    // A tree built from this text is already proof that it parses, so an in-step document is
    // waved through instead of parsed a second time (~92 ms of the ~290 ms an edit used to
    // spend before it changed anything). Out of step, the parse happens — which is exactly the
    // case the guard exists for, since that is what a mid-edit text view looks like.
    const ensureValidJson = (): boolean => {
      if (modelInSync || parsesAsJson(document.getText())) return true;
      webview.postMessage({
        type: 'error',
        message:
          "Can't apply edit — the document has invalid JSON (likely mid-edit in the text view). Fix the text, then retry.",
      });
      return false;
    };

    /**
     * Take back a paint the text never confirmed, and say why.
     *
     * The price of painting before writing: for the ~200 ms between the two the screen is ahead
     * of the file, and every way out of that window that is not a successful write has to put
     * the file's answer back — or the user is left looking at an edit that did not happen.
     *
     * Re-reads the text (the truth in this format, and the repair for a tree that was mutated
     * for a write that failed), repaints the entry from it, and posts the banner AFTER those
     * rows: fresh rows are how the webview learns a failure is over, so a banner posted before
     * them is one they wipe (see the `updateEntryRows` handler in table-main).
     */
    const undoPaint = (entryRowId: string, message: string): void => {
      rebuildModel();
      const fresh = findNode(uriString, entryRowId);
      if (fresh) {
        void postEntryRows(entryRowId, fresh).then(() => webview.postMessage({ type: 'error', message }));
      } else {
        // The re-read cannot find what was painted — pathological (the write that failed is the
        // reason the entry is still spelled the way the rows say), and the one case where
        // correcting the screen is worth the ~700 ms a full repaint costs on a big dictionary.
        void post().then(() => webview.postMessage({ type: 'error', message }));
      }
    };

    // --- Value edit / rename (byte-scoped entry-span splice) --------------------
    //
    // The edit path, and the one place in this provider where nothing is re-discovered: it
    // changes the tree it is already holding, paints the entry it changed, and then writes it.
    // What it used to do first — parse the document to check it is valid, then parse it again to
    // rebuild a model that was already right — cost ~282 ms of the ~290 ms an edit spent on a
    // 47.8 MB dictionary before anything changed.
    //
    // The ORDER of what is left is the point, and it is cheapest-first on purpose:
    //
    //   mutate the model          ~0.2 ms
    //   PAINT                     ~0.3 ms  posted synchronously, so the table has the answer
    //                                      ~1 ms after the keystroke — see postEntryRowsNow
    //   locate the entry's text  ~100 ms   a full structural walk of 47.8 MB (findEntrySpan)
    //   write the text          ~90–200 ms VS Code's cost for a 1.2 KB splice into a 1.6 M-line
    //                                      document, plus the change event it fires later still
    //
    // Locating first would read better — refuse before touching anything — but it puts the whole
    // ~100 ms scan ahead of the paint and hands back none of the win, which is the entire reason
    // the order is this way round. The cost of paying it in this order is that everything after
    // the paint can still fail, so both exits below (no span, anything thrown) call undoPaint.
    //
    // The paint used to be last, on that change event: the host wrote the text, waited for VS
    // Code to hand it back, and rebuilt the entry from the bytes (syncOwnEdit). Correct, and a
    // quarter of a second of waiting for an answer the model had all along — which is why a
    // binary dictionary, whose provider paints from the mutated node and touches no
    // TextDocument at all, felt immediate on the same file. The echo repaint still runs and is
    // still what the file says; it now CONFIRMS a paint rather than being it. The two agree
    // cell for cell — swept over every editable cell of three dictionaries in
    // jsonHostEditRepaint.test.ts, which is what makes painting early honest rather than
    // optimistic.
    const applyEdit = async (msg: {
      rowId: string;
      columnId: string;
      oldValue: string;
      newValue: string;
    }): Promise<void> => {
      // The entry this edit has already changed in the model and shown the user, if it got that
      // far — what a failure has to take back. Set the moment the mutation succeeds, so it reads
      // as "the screen and the tree may be ahead of the file", which is the exact window
      // undoPaint exists to close. Null before that: nothing to take back.
      let paintedRowId: string | null = null;
      try {
        if (!ensureValidJson()) return;
        const currentText = document.getText();

        liveModel();
        const node = findNode(uriString, msg.rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: 'Could not locate the edited item in the model.' });
          return;
        }

        // Owning top-level entry; pre-edit name for span lookup (rename mutates it).
        const entry = findOwningEntry(node);
        if (!entry) {
          webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
          return;
        }
        // Snapshot the entry's selector BEFORE the mutation: a rename changes
        // `name`, and the span lookup has to find the entry as the text still
        // spells it. The uuid half is rename-stable, and is what keeps the lookup
        // off a same-named entry in another namespace (see entrySelector.ts).
        const entrySelectorForLookup = entrySelectorOf(entry);
        const isRename = msg.columnId === 'Name';
        // And its row id, for the same reason one step further on: the rows on screen
        // carry the entry as the table last painted it, so the repaint this edit
        // triggers has to splice over THAT id, not the one a rename is about to mint.
        const entryRowIdOnScreen = entry.id;
        // And the rename to carry into the System Composer catalog, for the same
        // before-the-mutation reason: the catalog names the entry as the document still
        // does. Null for all but a rename of a catalogued architectural entry.
        const catalogRename = catalogRenameOf(msg.columnId, msg.newValue, node, entry);

        // Mutated through entryOps so the session's node index follows a rename: an id is a
        // PATH, so renaming an entry rekeys it and everything under it. The wide re-parse used
        // to repair that as a side effect — and the repaint's replace op, which detaches this
        // very subtree, unindexes it by the ids the mutation leaves behind.
        const result = mutateEntry(entry, () => node.setProperty(msg.columnId, msg.newValue));
        if (result && typeof result === 'object' && result.error) {
          // Invalid cell input: show the dex error dialog inside the webview
          // (scoped to the table view, not a window-blocking native modal),
          // then repaint so the cell reverts from the rejected text back to
          // its previous value. A refused setProperty changes nothing, so the
          // entry's own rows are all that need repainting — and they still say
          // what the text says.
          webview.postMessage({
            type: 'validationError',
            reason: result.reason,
            invalidValue: msg.newValue,
            previousValue: msg.oldValue,
          });
          void postEntryRows(entryRowIdOnScreen, entry);
          return;
        }

        // PAINT — synchronously, and before anything expensive: the model now says what the user
        // typed, and the renderer has it ~1 ms after the keystroke. Everything below this line
        // (~100 ms of span scan, ~90–200 ms of VS Code writing the text, and the change event it
        // fires later still) happens with the answer already on screen.
        //
        // From here to the write the screen is ahead of the file, so every way out of that
        // window that is not a write has to take the paint back (undoPaint).
        paintedRowId = entryRowIdOnScreen;
        postEntryRowsNow(entryRowIdOnScreen, entry);
        // After a rename node.id reflects the new name, and the rows just posted carry it —
        // so the row to re-select exists by the time this arrives.
        if (isRename) webview.postMessage({ type: 'selectRow', rowId: node.id });

        // --- and only now the expensive half: where in 47.8 MB of text that entry lives ------
        const indent = detectIndent(currentText);
        const entryText = reserializeEntry(entry, indent);
        const span = findEntrySpan(currentText, entrySelectorForLookup);
        if (!span) {
          // The tree has been mutated and painted, and the text cannot be — so the two now
          // disagree, and the text is the truth here.
          undoPaint(entryRowIdOnScreen, 'Could not locate the entry text to update.');
          return;
        }
        // The System Composer interface dictionary is a part of THIS document, and it lists
        // the entry BY NAME — so a rename that changes only the entry leaves the file
        // saying two different things: the entry is no longer classified (a struct type
        // re-reads as a plain data interface) and the catalog defines an interface no entry
        // backs. Empty for every rename no definition carries, which is nearly all of them.
        const scEdits = catalogRename
          ? scJsonRenameEdits(currentText, catalogRename.oldName, catalogRename.newName)
          : [];

        // Byte-scoped range replace: only the edited entry's span changes, so
        // sibling entries stay byte-identical. Native undo groups this edit.
        const startPos = document.positionAt(span.offset);
        const endPos = document.positionAt(span.offset + span.length);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(startPos, endPos), entryText);
        // In the SAME WorkspaceEdit, so the two halves of one rename are one undo step and
        // cannot be half-applied. Every range is addressed against the pre-edit text, which
        // is what both spans were found in, and the catalog part cannot overlap the entries
        // array either span was scanned from.
        scEdits.forEach((scEdit) => {
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(scEdit.start), document.positionAt(scEdit.end)),
            scEdit.text,
          );
        });
        // Set last, immediately before the edit, so the change event this edit fires is
        // the one that spends it (see hostEdit). The entry id is read AFTER the mutation
        // (a rename has already moved it) while the row id was read before, which is the
        // whole reason both are carried.
        //
        // No hint when the catalog rode along: the event will report several changes, which
        // is not an echo of one entry span and not a change any narrow path can plan, so it
        // takes the wide repaint. Said here rather than discovered there — a rename that
        // reclassifies an entry is exactly the case whose rows have to come from a re-read.
        const submitted = { rangeOffset: span.offset, rangeLength: span.length, text: entryText };
        hostEdit =
          scEdits.length > 0
            ? null
            : { entryId: entry.id, rowId: entryRowIdOnScreen, submitted };
        // Awaited but no longer waited ON: the table was painted before this line and the echo
        // this fires only confirms it (syncOwnEdit). What the await is still for is the answer —
        // VS Code refuses a WorkspaceEdit whose document moved under it, and a refusal is a
        // dropped edit, which the tree, the rows and the file would otherwise disagree about in
        // silence. Thrown so the one repair below covers it too.
        const written = await vscode.workspace.applyEdit(edit);
        if (!written) throw new Error('the document rejected the edit (it may have changed on disk)');
        // Remembered only now that the document really holds it, and only for the single-span
        // shape: an undo of this edit will write `replaced` back over `entryText` at the same
        // offset, which is a change the host can recognise instead of going looking for
        // (syncKnownChange). A rename that carried the catalog with it is several ranges, whose
        // undo reports several changes and is planned by nothing narrow.
        if (scEdits.length === 0) {
          remember({
            submitted,
            replaced: currentText.slice(span.offset, span.offset + span.length),
          });
        }
      } catch (err) {
        hostEdit = null;
        const message = 'Failed to apply edit: ' + (err as Error).message;
        if (paintedRowId) {
          // Whatever threw may have left the tree saying something the document does not — and,
          // since it threw after the paint, the screen too.
          undoPaint(paintedRowId, message);
        } else {
          // Nothing was painted and nothing was mutated, so the rows on screen are the ones the
          // last repaint left and they still say what the file says. The banner is the whole
          // answer.
          webview.postMessage({ type: 'error', message });
        }
      }
    };

    // --- Copy (read-only; snapshots the entry into the host clipboard) ----------
    // Shared with the binary provider, which is what makes a failed copy report
    // the same way in both formats (it used to be silent here).
    const applyCopy = (msg: { rowId: string }, mode: 'cut' | 'copy'): void => {
      copyEntriesToClipboard([msg.rowId], mode, uriString, {
        refresh: () => {
          const currentText = document.getText();
          invalidate(uriString);
          getModel(uriString, name, currentText);
        },
        findNode: (rowId) => findNode(uriString, rowId),
        post: (message) => webview.postMessage(message),
        broadcast: broadcastClipboardState,
      });
    };

    // --- Structural edits (delete / add-child / paste / drop) -------------------
    //
    // Every one of them now has the shape the value edit above has — change the model, PAINT,
    // then write the text — and for the same reason: the model can answer at once, and everything
    // after the paint (locating the text, VS Code writing it, the change event it fires) happens
    // with the answer already on screen. What used to happen instead was that the write's change
    // event triggered the WIDE repaint: re-parse the document, diff every entry for its Modified
    // mark, rebuild every row, post the lot — ~1.45 s and ~120 MB on a 47.8 MB dictionary, to add
    // one row or take one away.
    //
    // What each edit changed is ALSO stated as entry-level ops, kept beside the bytes it wrote, so
    // its undo can be applied rather than discovered (syncKnownOps). Both directions therefore
    // cost what the edit cost.
    //
    // They are three functions rather than one because they differ in who is ahead of whom:
    //   a nested child added or deleted — the transform mutates the model and reserializes the
    //     owning entry's own span, so as far as the text is concerned it IS a value edit, and it
    //     rides the same hostEdit/knownEdits rules;
    //   a top-level ENTRY deleted — the transform is text-only (it needs the entry still attached
    //     to work out where the selection lands), so the model change is an op applied beside it;
    //   paste and drop — the transform attaches its new nodes itself (prepareEntryForPaste must,
    //     to ask the section for a unique name), so the model is already ahead and what is owed is
    //     the session index and the ops (opsOfPastedEntries).
    //
    // A structural paint is the one repaint that cannot be taken back row by row — an entry may
    // have left the table or arrived in it — so a write that fails resyncs the whole view instead.
    // That is the old cost, paid only when an edit did not happen.
    const resyncWide = (message: string): void => {
      void post().then(() => webview.postMessage({ type: 'error', message }));
    };

    /**
     * The prologue every structural edit shares: the mid-edit JSON gate, a tree that matches the
     * text, and the node the row names — resolved ONCE, because which shape a delete takes
     * depends on what the row turned out to be.
     */
    const onStructuralTarget = async (rowId: string, run: (node: any) => Promise<void>): Promise<void> => {
      let node: any;
      try {
        if (!ensureValidJson()) return;
        liveModel();
        node = findNode(uriString, rowId);
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
        return;
      }
      if (!node) {
        webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
        return;
      }
      await run(node);
    };

    /**
     * A structural edit WITHIN one entry: add a nested child, delete one.
     *
     * Entry-scoped in both halves — the transform reserializes the owning entry's span, and the
     * repaint replaces that entry's run of rows — so nothing else in the table moves and nothing
     * else in the text changes. Which also means the bytes it writes are an entry span replaced by
     * an entry span, exactly what a cell edit writes: its echo is confirmed and its undo planned
     * by the paths that already read an element back out of the bytes (syncOwnEdit,
     * syncKnownChange), with no ops to remember.
     */
    const applyEntryStructural = async (
      node: any,
      transform: (text: string, node: any) => StructuralResult,
    ): Promise<void> => {
      // What a failure has to take back, set the moment the screen is ahead of the file. See
      // applyEdit, whose window this is the same one.
      let paintedRowId: string | null = null;
      try {
        const currentText = document.getText();
        const entry = findOwningEntry(node);
        if (!entry) {
          webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
          return;
        }
        // A nested child changes nothing about the entry's own name, so the id the rows carry and
        // the id the model spells are one id.
        const entryRowId = entry.id;

        // Through entryOps for the reason applyEdit is: the transform adds or removes a node
        // inside this subtree, a node id is a PATH, and nothing re-indexes the ids beneath it now
        // that the repaint no longer re-parses the document.
        const result = mutateEntry(entry, () => transform(currentText, node));

        // PAINT — in this run, before the ~100 ms span scan the transform already did and the
        // write below.
        paintedRowId = entryRowId;
        postEntryRowsNow(entryRowId, entry);
        if (result.selectId) webview.postMessage({ type: 'selectRow', rowId: result.selectId });

        const patch = patchFor(result, currentText);
        const submitted = submittedOf(patch);
        // Set immediately before the write, so the event this write fires is the one that spends
        // it (see hostEdit).
        hostEdit = { entryId: entry.id, rowId: entryRowId, submitted };
        await writePatch(patch);
        remember({ submitted, replaced: currentText.slice(patch.offset, patch.offset + patch.length) });
      } catch (err) {
        hostEdit = null;
        const message = 'Failed to apply edit: ' + (err as Error).message;
        // The tree was mutated and the rows painted for a write that did not happen, and the text
        // is the truth in this format.
        if (paintedRowId) undoPaint(paintedRowId, message);
        else webview.postMessage({ type: 'error', message });
      }
    };

    /**
     * Delete a top-level ENTRY: its element leaves the array, its run of rows leaves the table.
     *
     * The one shape whose transform touches no model at all, because it needs the entry where it
     * stands: which element to cut is the entry's selector, and where the selection lands is its
     * neighbour's row. So the model change is an op applied beside it — and captured BEFORE it,
     * while the entry still has a section and a position for an undo to put it back in.
     */
    const applyDeleteEntry = async (entry: any): Promise<void> => {
      let painted = false;
      try {
        const currentText = document.getText();
        const model = peekModel(uriString);
        if (!model) throw new Error('the document has no model to edit');
        const entryRowId = entry.id;
        const pairs: EntryOpPair[] = [{ redo: removeOp(entryRowId), undo: insertOp(entry) }];

        const result = deleteEntry(currentText, entry);
        // Model, then paint: the removal takes the entry out of the tree and its rows out of the
        // table, and the row id is all either of them needs.
        const applied = applyEntryOps(model, [pairs[0].redo]);
        painted = true;
        repaintOps(applied);
        if (result.selectId) webview.postMessage({ type: 'selectRow', rowId: result.selectId });

        const patch = patchFor(result, currentText);
        const submitted = submittedOf(patch);
        // The rows are already on screen, and the bytes this writes — an element and the comma
        // that held it, gone — are not an element anything can read back. Both facts are what the
        // change event needs to be told (paintedWrite), and what its undo needs (the ops).
        paintedWrite = submitted;
        await writePatch(patch);
        remember({
          submitted,
          replaced: currentText.slice(patch.offset, patch.offset + patch.length),
          patch: patchOfPairs(pairs),
        });
      } catch (err) {
        paintedWrite = null;
        const message = 'Failed to apply edit: ' + (err as Error).message;
        if (painted) resyncWide(message);
        else webview.postMessage({ type: 'error', message });
      }
    };

    const applyDelete = (msg: { rowId: string }): Promise<void> =>
      onStructuralTarget(msg.rowId, (node) =>
        // A top-level entry leaves the dictionary; a nested child leaves its entry.
        node.isEntry ? applyDeleteEntry(node) : applyEntryStructural(node, deleteChild),
      );

    const applyAddChild = (msg: { rowId: string }): Promise<void> =>
      onStructuralTarget(msg.rowId, (node) => applyEntryStructural(node, addChildEdit));

    // Cut is LAZY: it only marks the entry on the clipboard (in cut mode) and
    // makes no text edit yet. The source is removed at PASTE time — so a
    // same-document move becomes a single combined WorkspaceEdit (one undo step)
    // and the cut source row can show its dimmed affordance until pasted. This
    // mirrors data explorer's ClipboardService, whose cut() marks only.
    const applyCut = (msg: { rowId: string }): void => applyCopy(msg, 'cut');

    // --- Location in Text (reveal the row's entry in the plain-text view) -------
    // Resolve the right-clicked row to its owning top-level entry, locate that
    // entry's `{...}` span in the live JSON, then open the native text editor and
    // reveal the span. Nested children (struct fields, bus elements) have no
    // standalone JSON span, so we fall back to their owning entry's object — the
    // same entry-scoped granularity every other structural operation uses.
    const applyLocateInText = async (msg: { rowId: string }): Promise<void> => {
      try {
        const currentText = document.getText();
        invalidate(uriString);
        getModel(uriString, name, currentText);
        const node = findNode(uriString, msg.rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
          return;
        }
        const entry = findOwningEntry(node);
        if (!entry) {
          webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
          return;
        }
        const span = findEntrySpan(currentText, entrySelectorOf(entry));
        if (!span) {
          webview.postMessage({ type: 'error', message: `Could not locate "${entry.name}" in the text.` });
          return;
        }
        const startPos = document.positionAt(span.offset);
        const endPos = document.positionAt(span.offset + span.length);
        // showTextDocument opens the native text editor (same view as
        // "View as Text") beside the table and selects the entry's span,
        // scrolling it into view. A second tab for the same URI is expected —
        // table and text coexist (see the viewAsText note in extension.ts).
        await vscode.window.showTextDocument(document, {
          selection: new vscode.Range(startPos, endPos),
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to locate in text: ${(err as Error).message}` });
      }
    };

    // The target section of a paste or a drop, from the row that was clicked or dropped on —
    // which may be a section HEADER (`section:<name>`), the only target an empty section has.
    // findNode cannot resolve a header id, which is why these two paths resolve their own
    // section rather than going through onStructuralTarget, whose node lookup would bail.
    const targetSection = (model: any, rowId: string): any =>
      resolveSectionForPaste(model, findNode(uriString, rowId), rowId);

    /**
     * A same-document move's REMOVALS, stated as ops and applied to the live model — or nothing,
     * which means this move cannot take the narrow path at all.
     *
     * Nothing is the honest answer for two different reasons, and the caller owes the same thing
     * for both: re-read the model from the trimmed text, as this path always used to. The model it
     * is holding would otherwise keep an entry the text has just lost — and that is not only a
     * stale row, it is a WRONG PASTE: `prepareEntryForPaste` asks the section for a unique name,
     * so a source still standing there pushes the copy to "PI1" and the move renames what it
     * moved.
     *
     * Narrow for ANY number of sources. An undo replays the inverse ops in reverse order
     * (patchOfPairs) and each insert names the index its entry held when it was taken out, not
     * before the others — which is why the capture below is interleaved with the removals rather
     * than done up front. The binary provider's drop has always removed N this way.
     */
    const moveRemovals = (
      model: any,
      targets: readonly EntrySelector[],
    ): { pairs: EntryOpPair[]; applied: AppliedOp[] } | null => {
      const pairs: EntryOpPair[] = [];
      const applied: AppliedOp[] = [];
      try {
        // INTERLEAVED on purpose: each undo op is captured against the model as it
        // stands at that moment, then applied. `insertOp` reads the entry's index at
        // call time and `patchOfPairs` REVERSES the undo list, so the inverses replay
        // last-removed-first — each insert restoring into the section it was taken
        // from. Worked through: [P,Q,R], remove P then Q -> insertOp(P) captures 0,
        // insertOp(Q) captures 0 (Q slid down), and the reverse replay inserts Q at 0
        // then P at 0, yielding [P,Q,R]. Capturing all the ops up front is what would
        // be wrong here.
        for (const target of targets) {
          const source = findEntryBySelector(model, target);
          if (!source) return null;
          const pair: EntryOpPair = { redo: removeOp(source.id), undo: insertOp(source) };
          pairs.push(pair);
          applied.push(...applyEntryOps(model, [pair.redo]));
        }
      } catch {
        // Half-applied at worst, and the caller's re-read discards it whole.
        return null;
      }
      return { pairs, applied };
    };

    // Now that the clipboard carries N items, this body and applyDrop's are the same
    // shape end to end — which is the point: a paste IS a drop whose source register is
    // the clipboard rather than the drag register. Left as two functions for now; the
    // duplication is noted here so the next reader knows it is seen, not missed.
    const applyPaste = async (msg: { rowId: string }): Promise<void> => {
      let painted = false;
      try {
        if (!ensureValidJson()) return;
        const clip = getClipboard();
        if (!clip) {
          webview.postMessage({ type: 'error', message: 'Nothing to paste — the clipboard is empty.' });
          return;
        }

        // Resolve the target section first, so we can detect a same-section cut
        // (a no-op the same-document drag path also refuses) before any edit.
        const docText = document.getText();
        let model = liveModel();
        let section = targetSection(model, msg.rowId);
        if (!section) {
          webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
          return;
        }

        const isCut = clip.mode === 'cut';
        const sameDoc = clip.sourceDocUri === uriString;
        // Each cut entry's identity, carried on the payload the clipboard snapped at
        // cut time — so the source-delete removes the entries the user actually cut,
        // not same-named entries in another section's namespace.
        const srcSelectors = clip.items.map((it) => entrySelectorOf(it.payload));
        const named = srcSelectors.filter((s) => !!s.name);

        // A cut pasted back into the very section every item came from is a no-op:
        // deleting then re-adding the same entries would just churn the document. With
        // mixed sources it is NOT a no-op — the items from elsewhere really do move —
        // so the whole paste proceeds, and the same-section ones are removed and
        // re-added under the names they already had.
        if (isCut && sameDoc && clip.items.every((it) => it.sourceSection === section.name)) {
          clearClipboard();
          broadcastClipboardState();
          return;
        }

        // What the edit amounts to in the model, and what it leaves to repaint: the removals a
        // move makes, then the entries the paste attaches.
        const pairs: EntryOpPair[] = [];
        const applied: AppliedOp[] = [];
        let narrow = true;

        // A same-document cut is a MOVE: remove the source first (in the same
        // text) so the paste keeps the original name. This makes the whole move ONE
        // WorkspaceEdit = one undo step (mirrors the same-document drag-move).
        //
        // And with it goes the paste's ability to name the region it changes: its patch is stated
        // against this trimmed text, not against the document, so only the two texts together say
        // what to write.
        let workingText = docText;
        let againstDocument = true;
        if (isCut && sameDoc && named.length) {
          workingText = deleteEntriesByName(docText, named);
          againstDocument = false;
          const removals = moveRemovals(model, named);
          if (removals) {
            pairs.push(...removals.pairs);
            applied.push(...removals.applied);
          } else {
            narrow = false;
            modelInSync = false;
            invalidate(uriString);
            model = getModel(uriString, name, workingText);
            section = targetSection(model, msg.rowId);
            if (!section) {
              webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
              return;
            }
          }
        }

        // Read AFTER any removal, because a move within one section shortens the very array the
        // paste is about to append to. Everything from here on is what the paste added.
        const addedFrom = (section.children as any[]).length;
        const pasted = pasteEntries(workingText, section, clip.items.map((it) => it.payload));
        if (narrow) {
          const added = opsOfPastedEntries(section, addedFrom);
          pairs.push(...added.pairs);
          applied.push(...added.applied);
          // PAINT — the model already holds the pasted entry (prepareEntryForPaste attached it),
          // so the rows go out now, ahead of the write.
          painted = true;
          repaintOps(applied);
        } else {
          // The tree registered above describes the trimmed text, not the document: the change
          // event this write fires has to repaint the old way, from a re-parse.
          modelInSync = false;
        }
        const selectIds = pasted.selectIds;
        if (selectIds.length) webview.postMessage({ type: 'selectRow', rowId: selectIds[selectIds.length - 1] });

        const patch = againstDocument ? patchFor(pasted, docText) : minimalReplacement(docText, pasted.newText);
        const submitted = submittedOf(patch);
        if (narrow) paintedWrite = submitted;
        await writePatch(patch);
        if (narrow) {
          remember({
            submitted,
            replaced: docText.slice(patch.offset, patch.offset + patch.length),
            patch: patchOfPairs(pairs),
          });
        }

        try {
          // A cross-document cut removes the source from ITS document via that
          // document's own format-appropriate deleter (the source may be a binary
          // .sldd), a second native undo step — exactly a cut in one file + paste
          // in another. The hub dispatches to whichever provider owns the source.
          if (isCut && !sameDoc && clip.sourceDocUri && named.length) {
            await deleteFromSource(clip.sourceDocUri, named);
          }
        } finally {
          // The cut is consumed by the paste that already succeeded above, so it
          // is cleared even if the source-delete throws — otherwise the clipboard
          // keeps a live cut of an entry that now also exists here, and the next
          // paste duplicates it again. deleteFromSourceDocument's invalid-JSON
          // path already returns (rather than throws) and clears the clipboard,
          // reporting a copy the user must finish by hand; a throw is the same
          // situation and must not behave differently. A copy stays on the
          // clipboard for re-paste.
          //
          // The broadcast's repaint costs this view nothing: the only row here the emptied
          // clipboard could change is the cut source's, and a same-document cut has just removed
          // it, so repaintClipMark finds nothing to un-dim.
          if (isCut) {
            clearClipboard();
            broadcastClipboardState();
          }
        }
      } catch (err) {
        paintedWrite = null;
        const message = `Failed to apply edit: ${(err as Error).message}`;
        // Rows for entries that arrived or left cannot be put back one run at a time — the wide
        // repaint is the repair, and it is only ever reached by an edit that did not happen.
        if (painted) resyncWide(message);
        else webview.postMessage({ type: 'error', message });
      }
    };

    // --- Drag start: snapshot the dragged rows into the host drag register ------
    // Mirrors applyCopy but for possibly-many rows: each row's owning entry is
    // serialized (the payload the eventual paste uses) alongside the display
    // facts (class/kind) the webview needs to predict the drop. Then broadcast
    // the payload-free descriptor so every open table can render live feedback.
    // The snapshot itself is shared with BinarySlddEditorProvider
    // (buildDragSnapshot); only getting a live model differs between the formats.
    const applyDragStart = (msg: { rowIds: string[] }): void => {
      try {
        const currentText = document.getText();
        invalidate(uriString);
        getModel(uriString, name, currentText);
        const snap = buildDragSnapshot(msg.rowIds, (rowId) => findNode(uriString, rowId));
        if (snap.items.length === 0) {
          clearDrag();
        } else {
          setDrag(uriString, snap.sourceSection, snap.sourceSectionLabel, snap.sourceIsDerived, snap.items);
        }
        broadcastDragState();
      } catch {
        clearDrag();
        broadcastDragState();
      }
    };

    // --- Drag end: clear the register and tell every webview the drag is over ---
    const applyDragEnd = (): void => {
      clearDrag();
      broadcastDragState();
    };

    // --- Drop: complete the drag as copy/cut + paste ----------------------------
    // A drop is exactly the cut/copy-paste it mirrors: paste the dragged payloads
    // into the target section; for a MOVE, first remove the sources (so names are
    // preserved, just as cut-then-paste does). Same-document moves delete + paste
    // in one text; a cross-document move deletes from the source document via its
    // own edit. The target section is resolved from the dropped-on row, which may
    // be a section header (an empty section's only drop target).
    const applyDrop = async (msg: { rowId: string; mode: 'copy' | 'move' }): Promise<void> => {
      let painted = false;
      try {
        if (!ensureValidJson()) return;
        const drag = getDrag();
        if (!drag || drag.items.length === 0) {
          webview.postMessage({ type: 'error', message: 'Nothing to drop.' });
          return;
        }
        const payloads = drag.items.map((it) => it.payload);
        const isMove = msg.mode === 'move';
        const sameDoc = drag.sourceDocUri === uriString;
        // Selectors, not names: a multi-select move must remove the exact entries
        // that were dragged, and one of them may share a name with an entry in a
        // different namespace of the source document (see entrySelector.ts).
        const sourceTargets = drag.items
          .map((it) => entrySelectorOf(it.payload))
          .filter((s) => s.name.length > 0);

        const docText = document.getText();
        let model = liveModel();
        let section = targetSection(model, msg.rowId);
        if (!section) {
          webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
          return;
        }

        const pairs: EntryOpPair[] = [];
        const applied: AppliedOp[] = [];
        let narrow = true;

        // A same-document move removes the originals first so the pasted copies
        // keep their names (mirrors cut-then-paste). A copy, or a cross-document
        // move, leaves this document's originals untouched here.
        //
        // And with it goes the paste's ability to name the region it changes: its patch is
        // stated against this trimmed text, not against the document.
        let workingText = docText;
        let againstDocument = true;
        if (isMove && sameDoc) {
          workingText = deleteEntriesByName(docText, sourceTargets);
          againstDocument = false;
          const removals = moveRemovals(model, sourceTargets);
          if (removals) {
            pairs.push(...removals.pairs);
            applied.push(...removals.applied);
          } else {
            // See moveRemovals: the model has to be re-read from the trimmed text, or the paste
            // renames the entries it is moving.
            narrow = false;
            modelInSync = false;
            invalidate(uriString);
            model = getModel(uriString, name, workingText);
            section = targetSection(model, msg.rowId);
            if (!section) {
              webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' });
              return;
            }
          }
        }

        // After the removals, for the same reason applyPaste reads it there.
        const addedFrom = (section.children as any[]).length;
        const dropped = pasteEntries(workingText, section, payloads);
        if (narrow) {
          const added = opsOfPastedEntries(section, addedFrom);
          pairs.push(...added.pairs);
          applied.push(...added.applied);
          painted = true;
          repaintOps(applied);
        } else {
          modelInSync = false;
        }
        const selectIds = dropped.selectIds;
        if (selectIds.length) webview.postMessage({ type: 'selectRow', rowId: selectIds[selectIds.length - 1] });

        const patch = againstDocument ? patchFor(dropped, docText) : minimalReplacement(docText, dropped.newText);
        const submitted = submittedOf(patch);
        if (narrow) paintedWrite = submitted;
        await writePatch(patch);
        if (narrow) {
          remember({
            submitted,
            replaced: docText.slice(patch.offset, patch.offset + patch.length),
            patch: patchOfPairs(pairs),
          });
        }

        // Cross-document move: remove the originals from the SOURCE document via
        // ITS OWN format-appropriate deleter (the source may be a binary .sldd),
        // a second native undo step — exactly like a cut in one file + paste in
        // another. The hub dispatches to whichever provider owns the source.
        if (isMove && !sameDoc) {
          await deleteFromSource(drag.sourceDocUri, sourceTargets);
        }

        clearDrag();
        broadcastDragState();
      } catch (err) {
        paintedWrite = null;
        const message = `Failed to apply edit: ${(err as Error).message}`;
        if (painted) resyncWide(message);
        else webview.postMessage({ type: 'error', message });
      }
    };

    // Remove named entries from a document that is NOT this webview's, for a
    // cross-file move. Opens the target document (whether or not its table is
    // open) and applies a full-text replace as one WorkspaceEdit.
    //
    // The strict-JSON gate matters more here than on the paths that edit THIS
    // document: the source is a different file, so nothing the user did in this
    // table tells them what state it is in — it may be open in a text view with
    // half-typed JSON, or have been left invalid by an external tool. The splice
    // is tolerant enough to still find and remove a span in that text, which
    // writes back a file that was already broken and is now missing an entry too
    // (and, because it is invalid, no longer openable as a table to see that).
    // Refusing leaves the source untouched; the move's paste half has already
    // succeeded, so the user is left with a copy rather than a mangled original.
    const deleteFromSourceDocument = async (sourceUri: string, targets: DeleteTarget[]): Promise<void> => {
      const uri = vscode.Uri.parse(sourceUri);
      const srcDoc = await vscode.workspace.openTextDocument(uri);
      const srcText = srcDoc.getText();
      if (!parsesAsJson(srcText)) {
        webview.postMessage({
          type: 'error',
          message:
            `Moved the entries here, but couldn't remove them from ${basename(uri.path)} — that file has invalid JSON. ` +
            'Fix it, then delete the originals.',
        });
        return;
      }
      const trimmed = deleteEntriesByName(srcText, targets);
      if (trimmed === srcText) return;
      // Byte-scoped, for the same reason every write to THIS document is: the source may be
      // another 47.8 MB dictionary, and removing one entry from it should not rewrite it.
      const patch = minimalReplacement(srcText, trimmed);
      const edit = new vscode.WorkspaceEdit();
      const range = new vscode.Range(
        srcDoc.positionAt(patch.offset),
        srcDoc.positionAt(patch.offset + patch.length),
      );
      edit.replace(uri, range, patch.text);
      await vscode.workspace.applyEdit(edit);
    };

    // --- Message wiring ---------------------------------------------------------
    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (msg?.type === 'ready') {
        void post();
      } else if (msg?.type === 'select') {
        this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      } else if (msg?.type === 'edit') {
        void applyEdit(msg);
      } else if (msg?.type === 'copy') {
        applyCopy(msg, 'copy');
      } else if (msg?.type === 'delete') {
        void applyDelete(msg);
      } else if (msg?.type === 'addChild') {
        void applyAddChild(msg);
      } else if (msg?.type === 'cut') {
        applyCut(msg);
      } else if (msg?.type === 'paste') {
        void applyPaste(msg);
      } else if (msg?.type === 'dragStart') {
        applyDragStart(msg);
      } else if (msg?.type === 'dragEnd') {
        applyDragEnd();
      } else if (msg?.type === 'drop') {
        void applyDrop(msg);
      } else if (msg?.type === 'locateInText') {
        void applyLocateInText(msg);
      } else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target);
      } else if (msg?.type === 'undo' || msg?.type === 'redo') {
        // Single native stack: the table view is the active editor when its menu
        // is used, so this targets the shared TextDocument undo history.
        void vscode.commands.executeCommand(msg.type);
      }
    });

    // Live cross-tab selection: if a navigation targets THIS already-open file,
    // select the row immediately (the just-opened case is drained in post()).
    const navSub = wireNavigateSelect(webview, uriString);

    // Repaint on ANY change to this document: table edits, text-view edits, undo,
    // and redo all arrive here. A change inside ONE entry repaints just that entry's
    // rows; anything else rebuilds every row, and setRows (webview side) preserves
    // expansion and re-applies selection, so the tree doesn't collapse under the user.
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== uriString) return;
      // An event carrying NO content changes changed no text, so nothing on screen can be
      // stale because of it. VS Code fires one for the dirty-state flip after every edit (and
      // again when a save clears it), and the narrow repaint refuses any change count but one
      // — so this phantom went wide: re-parse the document, rebuild every row, postMessage the
      // lot. ~1.6 s on a 47.8 MB dictionary, after every edit, undo, redo and save, behind
      // which the user's next keystroke waited.
      //
      // Returned BEFORE the hint is spent, deliberately: which of the two events arrives first
      // is VS Code's business, and an expectation dropped by the empty one would send the
      // host's own edit down the recovery path it exists to avoid.
      if (e.contentChanges.length === 0) return;
      // Spent or dropped here, exactly once, whichever branch the event takes: an expectation
      // that survived its own event must not be waiting for the next one.
      const hint = hostEdit;
      hostEdit = null;
      // Spent on the same terms, and first: a structural edit painted its own rows before it
      // wrote, so if this event is that write there is nothing left to do. Checked before
      // anything that reads the document, since being sure costs three comparisons.
      const painted = paintedWrite;
      paintedWrite = null;
      if (painted && isEchoOfEdit(changesOf(e), painted)) return;
      // The host's own edit first, since it is the one case that needs no discovery at all.
      if (syncOwnEdit(e, hint)) return;
      // Then an undo or a redo of an edit it wrote earlier: the other change it needs no
      // discovery for, and the one the recovery path below was making the user wait ~175 ms of
      // reading and walking for. Structural first — a delete's undo and a cell edit's are
      // recognised the same way, but only one of them has an element in the bytes to read.
      if (syncKnownOps(e)) return;
      if (syncKnownChange(e)) return;
      if (syncOneEntry(e, hint)) return;
      void post();
    });

    // On save, re-capture the baseline so per-row "Modified" marks clear.
    const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() === uriString) {
        invalidate(uriString);
        try {
          captureBaseline(uriString, getModel(uriString, name, doc.getText()));
        } catch {
          /* leave baseline as-is on parse failure */
        }
        void post();
      }
    });

    // The editor/title "View as Text" toggle is gated on the built-in
    // `activeCustomEditorId == dataExplorer.tableView` context key (set
    // automatically by VS Code), so no custom context key is needed here.

    webview.html = this.getHtml(webview, distRoot);
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
      changeSub.dispose();
      saveSub.dispose();
      navSub.dispose();
      clearBaseline(uriString);
    });
  }

  private getHtml(webview: vscode.Webview, distRoot: vscode.Uri): string {
    return renderWebviewHtml(webview, distRoot, {
      scriptFile: 'table.js',
      title: 'Data Explorer',
      body: `    <div id="dex-error" role="alert" style="display:none;color:var(--vscode-errorForeground,#f14c4c);padding:8px;font-family:var(--vscode-font-family,sans-serif);"></div>
${BANNERS_HTML}
    <dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>`,
    });
  }
}
