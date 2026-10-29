// Copyright 2026 The MathWorks, Inc.
//
// The first paint of a table view, for one fixture, built by the route the extension takes for
// it — and the answers that view gives afterwards: a deferred row opened, a Variable Editor
// opened, a row selected for the Property Inspector.
//
// THE ROUTES ARE THE PROVIDERS', REPLAYED. Each provider builds its payload inside a module that
// imports `vscode`, which vitest cannot load, so what a webview is sent is assembled here from
// the same vscode-free functions in the same order. Where a provider does something inline — an
// envelope literal, a private helper, a one-line rule — it is copied here with a
// `// mirrors <File>.ts:<line>` comment, so that a reader can hold the two side by side. These
// copies are the price of pinning a payload no unit test can reach; everything that is a
// function in src/ is called, not copied.
//
// WHAT IS LEFT OUT, on purpose: the Usage column fill, which each provider runs between building
// the rows and posting them (usage.test.ts pins it on its own, over whole folders, because its
// answer depends on the folder and not on the file); and the cap fallback, which only runs when
// `postMessage` refuses a payload, which no fixture comes near.
import { unzipSync } from 'fflate';
import { DATA_PART_XML, DataModel, isMatFile, isModelFile, isSlddFile, type ParseWarning } from 'data-explorer-core';
import { getModel, getModelForBinaryTab, findNode, invalidate, releaseIfUnviewed } from '../../src/view/model/workspace/SlddModel.js';
import { newSourceCache, parsedModelForOpenTab } from '../../src/host/sourceCache.js';
import { rowPlannerFor, type PlanOptions, type RowPlanner } from '../../src/view/model/rows/rowPlanner.js';
import { COLUMNS, COLUMN_LABELS, COLUMN_GROUPS } from '../../src/view/model/rows/rowBuilder.js';
import { lazyRowsBanner } from '../../src/view/model/rows/lazyRows.js';
import { refuseIfUnreadable, sourceWarnings, warningBanner, type WarningBanner } from '../../src/view/model/rows/parseWarnings.js';
import { captureBaseline, clearBaseline, computeModified } from '../../src/host/slddBaseline.js';
import { clipMarkOfDoc } from '../../src/host/clipMarks.js';
import { clipboardState } from '../../src/host/clipboard.js';
import { sectionRules, wholeFileRules } from '../../src/view/model/actions/sectionRules.js';
import { readSlddParts } from '../../src/view/model/workspace/slddContent.js';
import {
  exceedsStringDecodeLimit,
  exceedsTextSyncLimit,
  isEditableJsonSlddBytes,
  isZipBytes,
} from '../../src/host/slddFormat.js';
import { describeSource } from '../../src/host/refusal.js';
import { SaveMarks } from '../../src/host/saveMarks.js';
import { answerChildRequest } from '../../src/view/model/rows/childRequest.js';
import { answerMatrixRequest } from '../../src/view/model/matrix/matrixRequest.js';
import { InspectorSelection } from '../../src/view/model/inspector/inspectorSelection.js';
import { InspectorPage } from '../../src/view/model/inspector/inspectorPage.js';
import { binaryEditSrcId } from '../../src/view/model/ids/srcId.js';
import { bytesOf, fakeFile, nameOf } from './fixtures.js';

/**
 * Which editor a file lands in when it is opened the ordinary way — an Explorer click, which
 * reaches the default `dataExplorer.binaryView` (package.json) or, for a MAT-file, its own
 * default `dataExplorer.matView`.
 *
 * mirrors BinaryEditorProvider.ts:282 (a MAT-file goes to its editor) and :298-370 (a `.sldd` is
 * classified by its bytes: editable JSON to the text-backed table, a zip to the binary dictionary
 * editor, anything else stays read-only here). A `.prj` or `matlab.toml` is a page, not a table,
 * and project.test.ts answers it.
 */
export type Route =
  /** BinaryEditorProvider: a model, or a dictionary neither editable view can hold. */
  | { kind: 'readonly'; notice: string | undefined }
  /** SlddTextEditorProvider: a JSON dictionary. */
  | { kind: 'text' }
  /** BinarySlddEditorProvider: a compressed (zip) dictionary. */
  | { kind: 'zip' }
  /** MatEditorProvider: a MAT-file. */
  | { kind: 'mat' }
  /** VS Code's own text editor, for a JSON dictionary too large to decode; no webview at all. */
  | { kind: 'none' };

export function routeOf(name: string, bytes: Uint8Array): Route {
  if (isMatFile(name)) return { kind: 'mat' };
  if (!isSlddFile(name)) return { kind: 'readonly', notice: undefined };
  if (exceedsStringDecodeLimit(bytes) && !isZipBytes(bytes)) return { kind: 'none' };
  if (isEditableJsonSlddBytes(bytes) && !exceedsTextSyncLimit(bytes)) return { kind: 'text' };
  if (isZipBytes(bytes) && !exceedsStringDecodeLimit(bytes)) return { kind: 'zip' };
  // mirrors BinaryEditorProvider.ts:352-357, the one read-only banner this view sets itself.
  const mb = Math.round(bytes.byteLength / (1024 * 1024));
  const notice = isEditableJsonSlddBytes(bytes)
    ? `Read-only: this dictionary is ${mb} MB, above VS Code's 50 MB editing limit. ` +
      `To edit the JSON directly, use "Reopen Editor With… → Text Editor"; ` +
      `this view refreshes when you save.`
    : undefined;
  return { kind: 'readonly', notice };
}

/** A table view of one fixture, open: what it painted first, and how it answers after that. */
export interface TableView {
  route: Route['kind'];
  uriString: string;
  /** The messages the view posts on first paint, in post order. */
  messages: any[];
  /** The rows of that paint's `setRows`, or none when it painted an error. */
  rows: any[];
  /** The `childRows` a `requestChildren` for `nodeId` is answered with. */
  children(nodeId: string): Promise<any>;
  /** The `matrixCells` a `requestMatrix` for `nodeId` is answered with. */
  matrix(nodeId: string): any;
  /** What the Property Inspector is sent when `rowId` alone is selected, or undefined for nothing. */
  select(rowId: string): any;
  /** Close the view: drop everything it registered, so the next fixture opens into a clean session. */
  close(): void;
}

/** A webview that keeps what it is sent. */
function recorder(): { posted: any[]; postMessage(m: unknown): Promise<boolean> } {
  const posted: any[] = [];
  return { posted, postMessage: (m) => (posted.push(m), Promise.resolve(true)) };
}

/**
 * What every view answers alike once it is painted (tableDispatch's common handlers): the fetch
 * of a deferred row and of a matrix through the shared answers each provider wires, and a
 * selection through the inspector extension.ts wires to all four.
 */
function answers(
  uriString: string,
  name: string,
  planner: RowPlanner,
  childOpts: PlanOptions | undefined,
): Pick<TableView, 'children' | 'matrix' | 'select'> {
  return {
    // The Usage filler is a no-op for the reason the payload skips it (see the header).
    async children(nodeId) {
      const view = recorder();
      await answerChildRequest(view, uriString, nodeId, name, async () => false, planner, childOpts);
      return view.posted[0];
    },
    matrix(nodeId) {
      const view = recorder();
      answerMatrixRequest(view, uriString, nodeId);
      return view.posted[0];
    },
    select(rowId) {
      const view = recorder();
      const page = new InspectorPage((m) => void view.postMessage(m));
      // A pane that is open and has loaded, so a node it is handed is posted at once.
      page.opened();
      page.loaded();
      // mirrors PropertiesViewProvider.ts:42-48, the Inspector extension.ts:97 hands the selection.
      const inspector = new InspectorSelection(
        { showNode: (node, from) => page.show(node, from), clear: () => page.clear() },
        findNode,
      );
      inspector.show(uriString, [rowId]);
      const [message] = view.posted;
      return message?.type === 'showProps' ? message : undefined;
    },
  };
}

/** The error banner each provider posts when its first paint throws. */
const failed = (message: string) => ({ type: 'error', message });

/**
 * Open `rel` in the view its route picks and paint it with `budget` rows — LAZY_ROW_BUDGET for
 * what a user sees, a small one to make a fixture defer rows the way only a huge file does.
 */
export async function openTable(rel: string, budget: number): Promise<TableView> {
  const name = nameOf(rel);
  const raw = bytesOf(rel);
  const route = routeOf(name, new Uint8Array(raw));
  switch (route.kind) {
    case 'readonly':
      return openReadOnly(rel, name, raw, route.notice, budget);
    case 'text':
      return openText(rel, name, raw, budget);
    case 'zip':
      return openZip(rel, name, raw, budget);
    case 'mat':
      return openMat(rel, name, raw, budget);
    case 'none':
      throw new Error(`${rel} opens in VS Code's text editor, not a table`);
  }
}

/** BinaryEditorProvider's `post`, from `invalidate` to the `setRows` (BinaryEditorProvider.ts:451-509). */
async function openReadOnly(
  rel: string,
  name: string,
  raw: ArrayBuffer,
  notice: string | undefined,
  budget: number,
): Promise<TableView> {
  const file = fakeFile(rel);
  const uriString = file.uriString;
  const planner = rowPlannerFor(name);
  const messages: any[] = [];
  let rows: any[] = [];
  try {
    invalidate(uriString);
    // The route tabRoute.test.ts pins: a model through the shared parse, everything else through
    // its bytes. mirrors sourceReads.ts:115 parsedModelForTab, over a cache of this view's own.
    const node = await getModelForBinaryTab(uriString, name, {
      parsed: async () => {
        const parsed = await parsedModelForOpenTab(newSourceCache(), file, `v1:${file.path}`, async () => raw);
        if (!parsed) throw new Error(`Could not read ${file.path}.`);
        return parsed;
      },
      bytes: async () => raw,
    });
    const planned = planner.payload(node, budget);
    rows = planned.rows;
    const parseBanner = warningBanner(sourceWarnings(node));
    // mirrors BinaryEditorProvider.ts:492-509, the payload literal.
    messages.push({
      type: 'setRows',
      docUri: uriString,
      rows,
      columns: COLUMNS,
      columnLabels: COLUMN_LABELS,
      columnGroups: COLUMN_GROUPS,
      editable: false,
      notice,
      warnings: lazyRowsBanner(planned.plan, parseBanner),
    });
  } catch (err) {
    // mirrors BinaryEditorProvider.ts:530-535.
    invalidate(uriString);
    messages.push(failed(`Failed to parse ${name}: ${(err as Error).message}`));
  }
  return {
    route: 'readonly',
    uriString,
    messages,
    rows,
    ...answers(uriString, name, planner, undefined),
    close: () => void releaseIfUnviewed(uriString),
  };
}

/** SlddTextEditorProvider's `paintWide`, on a document opened clean (SlddTextEditorProvider.ts:423-490). */
async function openText(rel: string, name: string, raw: ArrayBuffer, budget: number): Promise<TableView> {
  const uriString = fakeFile(rel).uriString;
  const planner = rowPlannerFor(name);
  // `document.getText()`: VS Code decodes the file as UTF-8 and drops a byte-order mark, which is
  // what TextDecoder does by default.
  const text = new TextDecoder().decode(raw);
  const describe = describeSource(uriString, name);
  const messages: any[] = [];
  let rows: any[] = [];
  try {
    invalidate(uriString);
    const node = getModel(uriString, name, text);
    // A document opened clean owes its baseline (slddBaseline.baselineOwed), so the first paint
    // takes it, and so marks nothing modified.
    captureBaseline(uriString, node);
    const modified = computeModified(uriString, node);
    const clipMark = clipMarkOfDoc(uriString);
    const planned = planner.payload(node, budget, { modifiedNames: modified, clipMark });
    rows = planned.rows;
    // mirrors SlddTextEditorProvider.ts:468-484, the payload literal.
    messages.push({
      type: 'setRows',
      docUri: uriString,
      rows,
      columns: COLUMNS,
      columnLabels: COLUMN_LABELS,
      columnGroups: COLUMN_GROUPS,
      editable: true,
      hasTextView: true,
      warnings: lazyRowsBanner(planned.plan, warningBanner(sourceWarnings(node))),
    });
    // mirrors SlddTextEditorProvider.ts:489-490.
    messages.push({ type: 'sectionRules', docUri: uriString, rules: sectionRules(node) });
    messages.push({ type: 'clipboardState', ...clipboardState() });
  } catch (err) {
    // mirrors SlddTextEditorProvider.ts:500-508.
    invalidate(uriString);
    messages.push(failed(`Failed to parse ${name}: ${describe((err as Error).message)}`));
  }
  return {
    route: 'text',
    uriString,
    messages,
    rows,
    ...answers(uriString, name, planner, undefined),
    close: () => {
      releaseIfUnviewed(uriString);
      clearBaseline(uriString);
    },
  };
}

// mirrors BinarySlddEditorProvider.ts:234 passThroughParts (module-private).
function passThroughParts(zip: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) if (member !== DATA_PART_XML) parts[member] = data;
  return parts;
}

// mirrors BinarySlddEditorProvider.ts:265 chunkOf (module-private).
function chunkOf(zip: Record<string, Uint8Array>): string {
  const chunk = zip[DATA_PART_XML];
  if (!chunk) throw new Error(`Missing ${DATA_PART_XML} in binary SLDD`);
  return new TextDecoder().decode(chunk);
}

/** BinarySlddEditorProvider's open and first `post` (BinarySlddEditorProvider.ts:684-842). */
async function openZip(rel: string, name: string, raw: ArrayBuffer, budget: number): Promise<TableView> {
  const uriString = fakeFile(rel).uriString;
  // mirrors BinarySlddEditorProvider.ts:463 srcId: prefixed, so it never meets the read-only
  // view's registration of the same uri.
  const srcId = binaryEditSrcId(uriString);
  const planner = rowPlannerFor(name);
  const describe = describeSource(srcId, name);
  // openCustomDocument (:709-710). A zip with no data part throws here, before any panel exists,
  // so no webview is sent anything and VS Code reports the failure itself. Recorded all the same,
  // under a type no host message has, so such a fixture is pinned as failing to open rather than
  // dropped from the corpus. None does today.
  let chunkXml: string;
  let zipMeta: Record<string, Uint8Array>;
  try {
    const zip = unzipSync(new Uint8Array(raw));
    chunkXml = chunkOf(zip);
    zipMeta = passThroughParts(zip);
  } catch (err) {
    return {
      route: 'zip',
      uriString,
      messages: [{ type: 'openFailed', message: (err as Error).message }],
      rows: [],
      ...answers(uriString, name, planner, undefined),
      close: () => DataModel.removeDataSource(srcId),
    };
  }
  const messages: any[] = [];
  let rows: any[] = [];
  try {
    // mirrors BinarySlddEditorProvider.ts:768 registerModel.
    DataModel.removeDataSource(srcId);
    const warnings: ParseWarning[] = [];
    const content = readSlddParts(chunkXml, zipMeta, warnings);
    const node = DataModel.addDataSource(srcId, content, { path: name }, warnings);
    captureBaseline(uriString, node);
    const modified = computeModified(uriString, node);
    const clipMark = clipMarkOfDoc(uriString);
    const planned = planner.payload(node, budget, { modifiedNames: modified, clipMark });
    rows = planned.rows;
    // mirrors BinarySlddEditorProvider.ts:824-838, the payload literal.
    messages.push({
      type: 'setRows',
      docUri: uriString,
      rows,
      columns: COLUMNS,
      columnLabels: COLUMN_LABELS,
      columnGroups: COLUMN_GROUPS,
      editable: true,
      warnings: lazyRowsBanner(planned.plan, warningBanner(sourceWarnings(node))),
    });
    // mirrors BinarySlddEditorProvider.ts:841-842.
    messages.push({ type: 'sectionRules', docUri: uriString, rules: sectionRules(node) });
    messages.push({ type: 'clipboardState', ...clipboardState() });
  } catch (err) {
    // mirrors BinarySlddEditorProvider.ts:845.
    messages.push(failed(`Failed to parse ${name}: ${describe((err as Error).message)}`));
  }
  return {
    route: 'zip',
    uriString,
    messages,
    rows,
    ...answers(uriString, name, planner, undefined),
    close: () => {
      DataModel.removeDataSource(srcId);
      clearBaseline(uriString);
    },
  };
}

// mirrors MatEditorProvider.ts:626 allowedClasses (module-private).
function allowedClasses(mat: any): readonly string[] {
  if (typeof mat?.getAllowedTypes !== 'function') return ['MatlabVariable'];
  const classes = mat.getAllowedTypes();
  return Array.isArray(classes) ? classes.filter((c: unknown): c is string => typeof c === 'string') : [];
}

/** MatEditorProvider's document and first `post` (MatEditorProvider.ts:254-786). */
async function openMat(rel: string, name: string, raw: ArrayBuffer, budget: number): Promise<TableView> {
  const uriString = fakeFile(rel).uriString;
  const srcId = binaryEditSrcId(uriString);
  const planner = rowPlannerFor(name);
  // mirrors MatEditorProvider.ts:284 describe and :289 describeBanner.
  const describe = (err: unknown): string =>
    describeSource(srcId, name)(err instanceof Error ? err.message : String(err));
  const describeBanner = (banner: WarningBanner | undefined): WarningBanner | undefined =>
    banner && { headline: describe(banner.headline), details: banner.details.map((d) => describe(d)) };
  // mirrors MatEditorProvider.ts:710 stamps: a fresh document's clipboard mark, and its Status
  // column measured against a save it has not had (MatDocument.marks, a fresh SaveMarks).
  const stamps = (): PlanOptions => ({ canCopy: true, clipMark: clipMarkOfDoc(uriString) });
  const close = () => DataModel.removeDataSource(srcId);

  // mirrors MatEditorProvider.ts:254 MatDocument.model.
  let mat: any;
  try {
    DataModel.removeDataSource(srcId);
    const node = DataModel.addMatSource(srcId, raw, { path: name });
    try {
      refuseIfUnreadable(sourceWarnings(node));
    } catch (err) {
      DataModel.removeDataSource(srcId);
      throw err;
    }
    mat = node;
  } catch (err) {
    // mirrors MatEditorProvider.ts:729 treeOrError.
    return {
      route: 'mat',
      uriString,
      messages: [failed(`Failed to parse ${name}: ${describe(err)}`)],
      rows: [],
      ...answers(uriString, name, planner, stamps()),
      close,
    };
  }

  // mirrors MatEditorProvider.ts:298 MatDocument.serialize, which the notice below asks.
  const serialize = (): void => {
    let out: ReturnType<typeof DataModel.serializeSource>;
    try {
      out = DataModel.serializeSource(srcId);
    } catch (err) {
      throw new Error(describe(err));
    }
    if (!out || out.kind !== 'binary' || !(out.bytes instanceof Uint8Array)) {
      throw new Error(`Cannot save "${name}": it is not held as a MAT-file. Nothing was written.`);
    }
  };
  // mirrors MatEditorProvider.ts:696 readOnlyNotice.
  const readOnlyNotice = (m: any): string | undefined => {
    if (!m.readOnly) return undefined;
    try {
      serialize();
    } catch (err) {
      return `Read-only: ${(err as Error).message}`;
    }
    return `Read-only: ${name} is laid out in a way a save could not keep as it is, so it opens for viewing only.`;
  };

  const messages: any[] = [];
  let rows: any[] = [];
  try {
    // mirrors MatEditorProvider.ts:714 build.
    const opts = { ...stamps(), savedStatus: new SaveMarks<any>().marks() };
    const planned = planner.payload(mat, budget, opts);
    rows = planned.rows;
    const notice = readOnlyNotice(mat);
    // mirrors MatEditorProvider.ts:766-778, the payload literal.
    messages.push({
      type: 'setRows',
      docUri: uriString,
      rows,
      columns: COLUMNS,
      columnLabels: COLUMN_LABELS,
      columnGroups: COLUMN_GROUPS,
      editable: !notice,
      notice,
      add: { classes: allowedClasses(mat) },
      warnings: describeBanner(lazyRowsBanner(planned.plan, warningBanner(sourceWarnings(mat)))),
    });
    // mirrors MatEditorProvider.ts:786-787.
    messages.push({ type: 'sectionRules', docUri: uriString, rules: notice ? [] : wholeFileRules(mat, name) });
    messages.push({ type: 'clipboardState', ...clipboardState() });
  } catch (err) {
    // mirrors MatEditorProvider.ts:794.
    messages.push(failed(`Failed to show ${name}: ${describe(err)}`));
  }
  return {
    route: 'mat',
    uriString,
    messages,
    rows,
    ...answers(uriString, name, planner, stamps()),
    close,
  };
}

/** Whether the fixture's tree is a model, for the Usage fill (usage.test.ts). */
export const isModelFixture = (rel: string): boolean => isModelFile(nameOf(rel));
