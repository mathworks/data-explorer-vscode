// Copyright 2026 The MathWorks, Inc.
//
// A table edit in a JSON .sldd repaints the one entry it changed from the text it just WROTE,
// instead of going looking for that edit as if someone else had made it.
//
// WHAT CHANGED. Editing one cell used to cost, in order: parse the whole document to check it
// is valid JSON (~92 ms on a 46 MB customer dictionary), parse it again to rebuild a model
// that was already correct (~190 ms), mutate the node, reserialize the entry, scan for its
// span (~101 ms), splice — and then, on the change event that splice fires, scan the array a
// third time and re-parse the changed element (~120 ms) to arrive at an entry the host had
// everything it needed to build. Everything before "mutate the node" and after "splice" is
// recovery work that only a change the host did NOT make actually needs.
//
// So applyEdit keeps the model it is holding, mutates the entry in place, and the repaint
// rebuilds that one entry from the entry text the splice wrote: ~7 ms, against ~290 ms of
// re-discovery.
//
// WHY FROM THE TEXT AND NOT STRAIGHT FROM THE MUTATED NODE — which is what the binary
// provider does, and would be 4 ms cheaper still. A mutation is not a re-parse, and where the
// two disagree the difference is a row the user watches change under them at the next wide
// repaint. Three such disagreements are known today: renaming an entry does not re-derive
// what the systemComposer catalog says it IS, renaming a nested row the format cannot express
// changes a model the text will not follow, and a Description a node accepts but never
// serializes stays on screen. All three are model-layer bugs, all three are live in a binary
// dictionary right now, and none of them has to be fixed before this path can be exactly as
// correct as the re-parse it replaces. Reading the entry back out of its own text is what
// makes that true by construction instead of by argument.
//
// Three claims, and they are what this file pins:
//
//  1. NARROW === WIDE. The rows the host paints for the entry it edited must be, cell for
//     cell, the rows a re-parse of the whole spliced document would have painted for it.
//     They came from that re-parse until now, so any difference is a visible change.
//
//  2. THE INDEX STAYS HONEST. A node id is a PATH, so a rename rekeys the node and its
//     descendants. The re-parse used to repair the session's index as a side effect; the
//     in-place mutation has to say so (mutateEntry), or findNodeById stops resolving the row
//     the edit is about — and the replace op that rebuilds the entry unindexes it by the ids
//     the mutation left behind, so a skipped repair strands them.
//
//  3. THE HOST ONLY TRUSTS ITS OWN EDIT. The repaint token is spent only on a change event
//     that reports exactly the range replacement that was submitted (planOwnEdit /
//     isEchoOfEdit) — a token left over from an edit whose event never arrived must not be
//     spent on someone else's keystroke, which would repaint one entry and leave stale rows
//     for whatever really changed.
//
// And one claim underneath all of it: while the rows and the model have stayed in step with
// the text, the text still PARSES — which is what lets the edit skip the validity gate. The
// host's own splice writes one entries-array element that is valid JSON on its own; the
// sweep at the bottom pins the other half, the bytes the host did NOT write: a change narrow
// enough to plan is a change that left the document parseable.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildEntryRows } from '../src/host/rowBuilder.js';
import { findEntrySpan, detectIndent } from '../src/host/entrySplice.js';
import { indexEntries } from '../src/host/jsonEntryScan.js';
import { entrySelectorOf } from '../src/host/entrySelector.js';
import { reserializeEntry } from '../src/host/structuralEdit.js';
import { mutateEntry, applyEntryOps } from '../src/host/entryOps.js';
import { planEntrySync, isEchoOfEdit, planOwnEdit } from '../src/host/jsonEntrySync.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Three JSON dictionaries with different insides, because the claim is about what
// serialize()/parse round-trips: plain values and MATLAB containers, real Simulink objects
// (Min/Max/Unit/DataType and nested rows), and architectural entries.
const FIXTURES: Array<{ label: string; text: string }> = [
  { label: 'numeric_json.sldd', text: read('./fixtures/numeric_json.sldd') },
  { label: 'mcos/all.sldd', text: read('./fixtures/mcos/all.sldd') },
  { label: 'arch.sldd', text: read('./fixtures/arch.sldd') },
];

const openUris: string[] = [];
function reset(uri: string): void {
  if (!openUris.includes(uri)) openUris.push(uri);
  DataModel.removeDataSource(uri);
  invalidate(uri);
}
afterAll(() => openUris.forEach((uri) => reset(uri)));

/** The top-level entry a node belongs to. */
function owningEntry(node: any): any {
  let n = node;
  while (n && !n.isEntry) n = n.parent;
  return n;
}

/**
 * Whether `root` still reaches `node` through its children.
 *
 * Descending rather than walking `parent` upwards on purpose: a node dropped from its parent's
 * children keeps pointing AT that parent, and the question here is whether the tree — the thing
 * the index and the rows are built from — still holds it.
 */
function isUnder(node: any, root: any): boolean {
  if (root === node) return true;
  for (const child of (root?.children ?? []) as any[]) {
    if (isUnder(node, child)) return true;
  }
  return false;
}

/** The entry a section+name pair names, in the model passed. */
function entryNamed(model: any, sectionName: string, entryName: string): any {
  const section = ((model?.children ?? []) as any[]).find((s) => s.name === sectionName);
  return ((section?.children ?? []) as any[]).find((e) => e.name === entryName) ?? null;
}

const isCellObject = (v: any): boolean => !!v && typeof v === 'object' && !Array.isArray(v);
const cellText = (v: any): string => (isCellObject(v) ? String(v.text ?? '') : v == null ? '' : String(v));

// Every column a row can carry an editor for: the four the table treats specially plus the
// object-valued ones (Min/Max/Unit and the schema Code Generation columns).
const COLUMNS = [
  'Name',
  'Value',
  'Description',
  'DataType',
  'Min',
  'Max',
  'Unit',
  'Complexity',
  'Dimensions',
  'DimensionsMode',
  'StorageClass',
  'Alignment',
];

/**
 * The columns of one row the TABLE will open an editor on — dex-tree-table's
 * `_onCellDblClickIfEditable`, transcribed.
 *
 * Transcribed rather than approximated because the sweep below is only as good as its scope:
 * a pair the table can submit and this misses is an edit nothing checks, and a pair the table
 * cannot submit but this invents is a failure about a feature that does not exist (which is
 * how this test first "failed" on a DataType edit no user can make — the cell is a plain
 * string, so the table never opens an editor on it).
 */
function editableColumns(row: any): string[] {
  const out: string[] = [];
  for (const col of COLUMNS) {
    const raw = row[col];
    if (col === 'Name') {
      if (isCellObject(raw) && raw.editable === true) out.push(col);
    } else if (col === 'Value') {
      if (isCellObject(raw) ? raw.editable === true : row._valueEditable === true) out.push(col);
    } else if (col === 'Description') {
      if (row._valueEditable !== false) out.push(col);
    } else if (isCellObject(raw) && raw.editable === true) out.push(col);
  }
  return out;
}

/** One cell edit the table can submit: which node, which column, and text it would accept. */
interface Pair {
  nodeId: string;
  columnId: string;
  value: string;
  /** Whether the row IS its entry's own row, rather than one nested inside it. */
  entryRow: boolean;
}

// Text for a column whose editor is free-form. A cell that carries `options` is a dropdown and
// takes one of those instead (below), whatever the column.
const FREE_TEXT: Record<string, (current: string) => string> = {
  Name: (cur) => `${cur}_renamed`,
  Value: () => '42',
  Description: () => 'edited by the equivalence sweep',
  DataType: () => 'single',
  Min: () => '-7',
  Max: () => '77',
  Unit: () => 'm/s',
  Dimensions: () => '[1 2]',
};

/** Every (row, column, value) the table could commit against this fixture. */
function pairsOf(uri: string, label: string, text: string): Pair[] {
  reset(uri);
  const model = getModel(uri, label, text);
  const pairs: Pair[] = [];
  for (const section of (model.children ?? []) as any[]) {
    for (const entry of (section.children ?? []) as any[]) {
      for (const row of buildEntryRows(entry, section.name, new Set<string>()) as any[]) {
        // Read off the model rather than off the id's shape: an entry name may itself hold a
        // "/" (mcos/all.sldd has several), so counting path segments misclassifies exactly the
        // fixtures whose renames are most worth sweeping.
        const entryRow = row.ID === entry.id;
        for (const columnId of editableColumns(row)) {
          const raw = row[columnId];
          const current = columnId === 'Name' ? String(raw.label ?? '') : cellText(raw);
          const options: string[] | undefined = isCellObject(raw) ? raw.options : undefined;
          if (options?.length) {
            pairs.push({ nodeId: row.ID, columnId, entryRow, value: options.find((o) => o !== current) ?? options[0] });
            continue;
          }
          const free = FREE_TEXT[columnId];
          // No silent skipping: a new editable column with a free-form editor has to be
          // given a value here rather than quietly dropping out of the sweep.
          expect(free, `the sweep knows what to type into "${columnId}" (row ${row.ID})`).toBeTruthy();
          pairs.push({ nodeId: row.ID, columnId, entryRow, value: free(current) });
        }
      }
    }
  }
  reset(uri);
  return pairs;
}

/** What one comparison needs: the rows the host would paint, and the text it spliced. */
interface Edited {
  rows: any[];
  before: any[];
  newText: string;
  /** The id the rows on screen carry — pre-rename. */
  rowIdOnScreen: string;
  /** The id the model gives the entry once the repaint has rebuilt it — post-rename. */
  entryId: string;
  entryName: string;
  sectionName: string;
}

/**
 * The whole host-side edit, minus the VS Code glue: mutate the node in the model that is
 * already built, splice the entry's reserialized text, and repaint that entry by reading it
 * back out of the bytes just written (planOwnEdit + applyEntryOps).
 *
 * Composed from the real modules because SlddTextEditorProvider imports `vscode` and cannot
 * run under vitest — the same arrangement as jsonEntryScopedSync.test.ts beside it. What the
 * provider adds is the WorkspaceEdit and the postMessage; every decision is here.
 *
 * Returns null when setProperty refuses the value — the provider answers that with a
 * validation error and a repaint of the entry it did not change, which is what `before` is for.
 */
function editInPlace(uri: string, label: string, text: string, pair: Pair): Edited | null {
  reset(uri);
  const model = getModel(uri, label, text);
  const node = findNode(uri, pair.nodeId);
  expect(node, `the fixture still holds "${pair.nodeId}"`).not.toBeNull();
  const entry = owningEntry(node);
  const sectionName = entry.parent?.name ?? '';
  // Both snapshots a rename invalidates: the entry as the TEXT still spells it, and the id
  // the ROWS on screen still carry.
  const selector = entrySelectorOf(entry);
  const rowIdOnScreen: string = entry.id;
  const before = buildEntryRows(entry, sectionName, new Set<string>());

  const result = mutateEntry(entry, () => node.setProperty(pair.columnId, pair.value));
  if (result && typeof result === 'object' && (result as any).error) {
    // A refused edit has to leave the model as the text still reads it, because the provider
    // answers a refusal by repainting that entry: a half-applied mutation would paint rows
    // the document does not say.
    expect(buildEntryRows(entry, sectionName, new Set<string>()), `refused ${pair.columnId} on "${pair.nodeId}"`).toEqual(before);
    return null;
  }

  // INVARIANT 2, on every case rather than only the renames: the session's index says exactly
  // what the tree says. The node the user typed into is findable while it is still in the tree —
  // and NOT findable once an edit has taken it out of it, which a value edit can do (a
  // Parameter's Value row exists only while its value has elements to expand). An index that
  // still answered for a detached node would resolve the next edit onto rows nothing shows.
  const stillThere = isUnder(node, entry);
  expect(
    DataModel.findNodeById(node.id) ?? null,
    `"${node.id}" is ${stillThere ? 'indexed' : 'gone'} after ${pair.columnId}`,
  ).toBe(stillThere ? node : null);

  const span = findEntrySpan(text, selector);
  expect(span, `the text still spells "${selector.name}"`).not.toBeNull();
  const entryText = reserializeEntry(entry, detectIndent(text));
  const newText = text.slice(0, span!.offset) + entryText + text.slice(span!.offset + span!.length);

  // The change event that splice fires, and what the host makes of it.
  const submitted = { rangeOffset: span!.offset, rangeLength: span!.length, text: entryText };
  const plan = planOwnEdit([{ ...submitted }], { entryId: entry.id, rowId: rowIdOnScreen, submitted });
  expect(plan, `the host recognises its own edit (${pair.columnId} on "${pair.nodeId}")`).not.toBeNull();
  expect(plan!.entryRowId, 'and repaints over the run the table is showing').toBe(rowIdOnScreen);
  const applied = applyEntryOps(model, [plan!.op]);
  expect(applied[0].kind).toBe('replace');
  const fresh = (applied[0] as any).entry;
  const rows = buildEntryRows(fresh, sectionName, new Set<string>());
  return {
    rows,
    before,
    newText,
    rowIdOnScreen,
    entryId: fresh.id as string,
    entryName: fresh.name as string,
    sectionName,
  };
}

for (const { label, text } of FIXTURES) {
  describe(`a cell edit repaints the entry it wrote, from what it wrote — ${label}`, () => {
    const uri = `test://host-edit-${label}`;
    const pairs = pairsOf(uri, label, text);

    it('has enough editable cells to make the sweep meaningful', () => {
      expect(pairs.length).toBeGreaterThan(20);
      // Both kinds of target, because a nested row is the one whose entry is not itself the
      // node that changed.
      expect(pairs.some((p) => p.entryRow)).toBe(true);
      expect(pairs.some((p) => !p.entryRow)).toBe(true);
    });

    // INVARIANT 1, swept over every cell the table can commit: the rows the host paints for
    // the entry it edited are the rows the whole-document re-parse it no longer does would
    // have painted for that entry.
    it('paints the rows a re-parse of the spliced text would paint', () => {
      let compared = 0;
      for (const pair of pairs) {
        const done = editInPlace(uri, label, text, pair);
        if (!done) continue;
        const where = `${pair.columnId} := ${JSON.stringify(pair.value)} on "${pair.nodeId}"`;

        // getModel parses: a splice that broke the JSON throws here rather than comparing.
        reset(uri);
        const reparsed = getModel(uri, label, done.newText);
        const entry = entryNamed(reparsed, done.sectionName, done.entryName);
        expect(entry, `"${done.entryName}" survives the splice (${where})`).toBeTruthy();
        // The id the wide path would give it has to be the id the narrow path gave it, or the
        // NEXT edit on that row cannot be resolved.
        expect(entry.id, `the two paths agree on the entry's id (${where})`).toBe(done.entryId);
        const theirs = buildEntryRows(entry, done.sectionName, new Set<string>());
        // NOT to within a tolerance: every cell, on every row, of every entry these three
        // dictionaries hold. The known model-layer disagreements the header lists are exactly
        // the ones this path does not inherit, because it reads the entry back from the text —
        // including the architectural rename characterised below, where the two agree on an
        // answer that is WRONG in the file and right on screen.
        expect(theirs, where).toEqual(done.rows);
        compared++;
      }
      // The sweep must actually have compared something — every pair being refused would make
      // it vacuous.
      expect(compared, 'edits that round-tripped identically').toBeGreaterThan(pairs.length / 4);
    });

    // The reason the repaint carries a row id of its own rather than reading the model's.
    it('leaves a renamed entry answering to an id the rows on screen do not carry', () => {
      const renames = pairs.filter((p) => p.columnId === 'Name' && p.entryRow);
      expect(renames.length).toBeGreaterThan(0);
      let renamed = 0;
      for (const { nodeId, value } of renames) {
        reset(uri);
        getModel(uri, label, text);
        const entry = findNode(uri, nodeId);
        const before: string = entry.id;
        const result = mutateEntry(entry, () => entry.setProperty('Name', value));
        if (result && typeof result === 'object' && (result as any).error) continue;
        renamed++;
        expect(entry.id, 'the model now spells the entry with its new name').not.toBe(before);
        expect(DataModel.findNodeById(entry.id), 'and the index answers to the new id').toBe(entry);
        expect(DataModel.findNodeById(before), 'while the old id is gone').toBeFalsy();
      }
      expect(renamed).toBeGreaterThan(0);
    });
  });
}

// ---------------------------------------------------------------------------------------
// The three mutation/re-parse disagreements the header names, stated outright — the reason
// the repaint reads the entry back from the text instead of from the node.
// ---------------------------------------------------------------------------------------
describe('renaming a row the format has no name for — a rename the file will not keep', () => {
  const text = read('./fixtures/mcos/all.sldd');
  const uri = 'test://host-edit-nested-rename';

  it('renames it in the model, and the text comes back saying what it always said', () => {
    reset(uri);
    getModel(uri, 'mcos/all.sldd', text);
    // A Simulink.Parameter's "Value" row is not a named child in the file — it is the shape
    // the parser gives a value with elements to expand. The table offers its Name cell an
    // editor all the same (the row carries editable: true), so a user can type into it.
    const row = findNode(uri, `${uri}/design/ParamMat/Value`);
    expect(row, 'the fixture still holds a matrix-valued parameter').toBeTruthy();
    const entry = owningEntry(row);
    const selector = entrySelectorOf(entry);

    expect(mutateEntry(entry, () => row.setProperty('Name', 'Value_renamed')), 'the model accepts it').toBe(true);
    expect(buildEntryRows(entry, 'design', new Set<string>())[1].Name.label).toBe('Value_renamed');

    const span = findEntrySpan(text, selector)!;
    const entryText = reserializeEntry(entry, detectIndent(text));
    expect(entryText, 'and serialize has nowhere to put it').not.toContain('Value_renamed');

    reset(uri);
    const newText = text.slice(0, span.offset) + entryText + text.slice(span.offset + span.length);
    const reread = entryNamed(getModel(uri, 'mcos/all.sldd', newText), 'design', 'ParamMat');
    // So the edit is discarded, and the honest table says so at once rather than showing a
    // name that will not survive the next read. Worth fixing where the row is built (do not
    // offer the editor) rather than here.
    expect(buildEntryRows(reread, 'design', new Set<string>())[1].Name.label).toBe('Value');
  });
});


describe('renaming an architectural entry — a file-level bug this path neither causes nor hides', () => {
  const text = read('./fixtures/arch.sldd');
  const uri = 'test://host-edit-arch-rename';

  const rowOf = (entry: any) => buildEntryRows(entry, 'arch', new Set<string>())[0];
  const kindOf = (row: any) => `${row.Kind} / ${row.Name.iconId}`;

  it('demotes a struct type to a data interface, and the mutated node does not notice', () => {
    reset(uri);
    const model = getModel(uri, 'arch.sldd', text);
    // A Simulink.Bus is a struct type or a data interface depending on what the file's
    // systemComposer catalog says about it BY NAME (SlddNode.parse threads the catalog into
    // every parseEntry). So renaming one leaves the catalog describing a name the dictionary
    // no longer has, and the entry comes back as the plain interface it now looks like.
    const entry = entryNamed(model, 'arch', 'StructType');
    expect(kindOf(rowOf(entry))).toBe('Struct Type / typeStruct');

    const selector = entrySelectorOf(entry);
    expect(mutateEntry(entry, () => entry.setProperty('Name', 'StructType_renamed'))).toBe(true);
    // The node the mutation returns still says what it was PARSED as: classification is not
    // re-derived by a rename. Repainting from it would show a struct type the file no longer
    // describes — which is why this path repaints from the text instead.
    expect(kindOf(rowOf(entry)), 'the mutated node keeps its old classification').toBe('Struct Type / typeStruct');

    const span = findEntrySpan(text, selector)!;
    const newText =
      text.slice(0, span.offset) + reserializeEntry(entry, detectIndent(text)) + text.slice(span.offset + span.length);
    reset(uri);
    const reread = entryNamed(getModel(uri, 'arch.sldd', newText), 'arch', 'StructType_renamed');
    // The rename cost the entry its kind, and this is what the FILE now says: a save here is
    // silent data loss, on both formats, and it wants fixing in the data model (the rename
    // should carry the catalog with it). Until it is, the honest table is the one that shows
    // it — which the sweep above proves this repaint does, byte for byte.
    expect(kindOf(rowOf(reread)), 'a re-read demotes it').toBe('Data Interface / typeBus');
  });
});

describe('a Description the format cannot hold — a pre-existing loss, not this change', () => {
  const { label, text } = FIXTURES[0];

  it('is accepted, shown, and gone on the next read', () => {
    const uri = 'test://host-edit-description-loss';
    reset(uri);
    const model = getModel(uri, label, text);
    // A plain MATLAB variable: `{name, metadata, value}` on disk, with no property bag to
    // carry a Description. Its class declares the prop anyway, so setProperty's generic tail
    // writes it onto the node, the row shows it, and serialize never emits it.
    const entry = entryNamed(model, 'design', 'Number');
    expect(entry, 'the fixture still holds a plain numeric variable').toBeTruthy();
    expect(mutateEntry(entry, () => entry.setProperty('Description', 'why this exists'))).toBe(true);
    expect(buildEntryRows(entry, 'design', new Set<string>())[0].Description).toBe('why this exists');
    expect(JSON.stringify(entry.serialize())).not.toContain('why this exists');

    // The same loss on both formats. What differs is what the user SEES: a binary dictionary
    // keeps the typed text on screen (its repaint comes from the mutated node) until the next
    // wide repaint drops it, while here the repaint reads the entry back out of the text the
    // splice wrote — which has no Description in it — so the cell reverts immediately, exactly
    // as it does today. Worth fixing in the model (refuse it, or persist it), together with the
    // question of whether the cell should offer an editor at all.
    const newText = (() => {
      const span = findEntrySpan(text, entrySelectorOf(entry))!;
      return text.slice(0, span.offset) + reserializeEntry(entry, detectIndent(text)) + text.slice(span.offset + span.length);
    })();
    reset(uri);
    const reread = entryNamed(getModel(uri, label, newText), 'design', 'Number');
    expect(buildEntryRows(reread, 'design', new Set<string>())[0].Description).toBe('');
  });
});

// ---------------------------------------------------------------------------------------
// INVARIANT 2, stated as the hazard it exists for.
// ---------------------------------------------------------------------------------------
describe('mutateEntry — the repair the re-parse used to do for free', () => {
  const { label, text } = FIXTURES[0];

  it('a rename mutated WITHOUT it leaves the session pointing at the old id', () => {
    const uri = 'test://host-edit-unrepaired';
    reset(uri);
    const model = getModel(uri, label, text);
    const entry = (model.children as any[]).flatMap((s: any) => s.children)[0];
    const before: string = entry.id;
    // Exactly what applyEdit used to do, and what it still does under mutateEntry — the
    // difference is only the index bookkeeping around it.
    expect(entry.setProperty('Name', `${String(entry.name)}_renamed`)).toBe(true);
    expect(entry.id).not.toBe(before);
    // The node is sitting right there and the session cannot find it: the next edit on that
    // row reports "could not locate the edited item".
    expect(DataModel.findNodeById(entry.id)).toBeFalsy();
    expect(DataModel.findNodeById(before), 'and the id it does hold names a name nothing has').toBe(entry);
  });

  it('returns what the mutation returned, so a refusal reaches the caller', () => {
    const uri = 'test://host-edit-refusal';
    reset(uri);
    const model = getModel(uri, label, text);
    const entries = (model.children as any[]).flatMap((s: any) => s.children);
    const result = mutateEntry(entries[0], () => entries[0].setProperty('Name', entries[1].name));
    expect(result && typeof result === 'object' && (result as any).error).toBe(true);
    // A refused rename changes nothing, so the index is untouched either way.
    expect(DataModel.findNodeById(entries[0].id)).toBe(entries[0]);
  });
});

// ---------------------------------------------------------------------------------------
// INVARIANT 3.
// ---------------------------------------------------------------------------------------
describe('isEchoOfEdit — spending the repaint token only on the edit that made it', () => {
  const submitted = { rangeOffset: 120, rangeLength: 45, text: '{ "name": "A" }' };

  it('accepts the one change that reports exactly what was submitted', () => {
    expect(isEchoOfEdit([{ ...submitted }], submitted)).toBe(true);
  });

  it('refuses a change at another offset, of another length, or with other text', () => {
    expect(isEchoOfEdit([{ ...submitted, rangeOffset: 121 }], submitted)).toBe(false);
    expect(isEchoOfEdit([{ ...submitted, rangeLength: 44 }], submitted)).toBe(false);
    expect(isEchoOfEdit([{ ...submitted, text: '{ "name": "B" }' }], submitted)).toBe(false);
  });

  it('refuses a batch, even one holding the submitted change', () => {
    // A batch's later offsets are stated against the text before the batch, so nothing in it
    // locates anything in the text after it — the same reason the narrow sync refuses one.
    expect(isEchoOfEdit([{ ...submitted }, { rangeOffset: 0, rangeLength: 0, text: 'x' }], submitted)).toBe(false);
    expect(isEchoOfEdit([{ rangeOffset: 0, rangeLength: 0, text: 'x' }, { ...submitted }], submitted)).toBe(false);
  });

  it('refuses an event that changed nothing', () => {
    expect(isEchoOfEdit([], submitted)).toBe(false);
  });
});

describe('planOwnEdit — the entry the host wrote, read back out of what it wrote', () => {
  const entryText = '{\n  "name": "Gain_renamed",\n  "value": 42\n}';
  const submitted = { rangeOffset: 200, rangeLength: 38, text: entryText };
  const hint = { entryId: 'doc/design/Gain_renamed', rowId: 'doc/design/Gain', submitted };

  it('replaces the entry the MODEL names, over the row the TABLE shows', () => {
    const plan = planOwnEdit([{ ...submitted }], hint);
    expect(plan).not.toBeNull();
    // The two ids are different halves of a rename and neither substitutes for the other: the
    // op has to resolve the node as the model now spells it, and the splice has to land on the
    // run the webview is holding, which still carries the old name.
    expect(plan!.op).toEqual({
      kind: 'replace',
      rowId: 'doc/design/Gain_renamed',
      record: { name: 'Gain_renamed', value: 42 },
    });
    expect(plan!.entryRowId).toBe('doc/design/Gain');
  });

  it('refuses a change that is not the echo of the submitted edit', () => {
    expect(planOwnEdit([{ ...submitted, rangeOffset: 201 }], hint)).toBeNull();
    expect(planOwnEdit([], hint)).toBeNull();
    expect(planOwnEdit([{ ...submitted }, { rangeOffset: 0, rangeLength: 0, text: 'x' }], hint)).toBeNull();
  });

  it('refuses text that is not one JSON object, rather than half-applying it', () => {
    // Unreachable through applyEdit (the text is an entry this host just serialized), so it is
    // here as the boundary it is: nothing downstream should have to ask whether the record it
    // was handed is a record. A refusal costs the wide repaint, which reads the same bytes.
    for (const text of ['{ "name": "A", ', '[1, 2]', '"just a string"', '42', 'null']) {
      expect(planOwnEdit([{ ...submitted, text }], { ...hint, submitted: { ...submitted, text } }), text).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------
// The claim underneath the dropped validity gate.
// ---------------------------------------------------------------------------------------
for (const { label, text } of FIXTURES) {
  describe(`a change narrow enough to plan leaves the document parseable — ${label}`, () => {
    const uri = `test://host-edit-induction-${label}`;

    // The gate applyEdit no longer pays (JSON.parse of the whole document, ~84 ms on a 46 MB
    // dictionary) is replaced by "the rows and the model have stayed in step with the text".
    // That is only as good as this: a keystroke in the text view either keeps the document
    // valid, or it is refused and the wide repaint reports the parse error. If a plan could
    // survive text that no longer parses, the edit path would splice into a broken document.
    it('every planned change parses, and the malformed ones are refused', () => {
      reset(uri);
      const model = getModel(uri, label, text);
      const elements = indexEntries(text)!.elements;
      expect(elements.length).toBeGreaterThan(2);

      let planned = 0;
      let refused = 0;
      for (const el of elements) {
        const end = el.offset + el.length;
        const points = [el.offset, el.offset + 1, Math.floor((el.offset + end) / 2), end - 1, end];
        // Insertions that break structure where they land in it, plus a deletion and an
        // overwrite: between them they hit strings, keys, numbers and braces.
        const probes: Array<{ length: number; insert: string }> = [
          { length: 0, insert: '"' },
          { length: 0, insert: '{' },
          { length: 0, insert: ',' },
          { length: 0, insert: '9' },
          { length: 1, insert: '' },
          { length: 1, insert: 'z' },
        ];
        for (const at of points) {
          for (const probe of probes) {
            const newText = text.slice(0, at) + probe.insert + text.slice(at + probe.length);
            const plan = planEntrySync(model, newText, { rangeOffset: at, text: probe.insert });
            if (!plan) {
              refused++;
              continue;
            }
            planned++;
            const what = probe.insert ? `inserting ${JSON.stringify(probe.insert)}` : 'deleting a character';
            expect(
              () => JSON.parse(newText),
              `${what} at ${at} in "${el.name}" was planned, so it must still parse`,
            ).not.toThrow();
          }
        }
      }
      // Both halves have to happen, or the sweep is proving nothing: some probes are ordinary
      // edits inside a value, and some are the malformed ones the plan must refuse.
      expect(planned).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
    });
  });
}
