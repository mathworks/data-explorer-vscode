// Copyright 2026 The MathWorks, Inc.
//
// PRIMARY coverage for the .sldd table→text write-back feature.
//
// The webview UI (double-click a cell → `dex-edit-completed`) cannot be driven
// from the integration test host, so this vitest suite reproduces the pure text
// transform that `BinaryEditorProvider.applyEdit` performs and asserts it against
// the real model. It exercises the genuine modules — SlddModel (getModel/findNode),
// node.setProperty/serialize, and entrySplice (findEntrySpan/detectIndent) —
// i.e. everything except the thin VS Code WorkspaceEdit glue.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { findEntrySpan, detectIndent } from '../src/host/entrySplice.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
  'utf8',
);

/** Resolve the model row ID for the top-level entry with the given name. */
function rowIdFor(uri: string, text: string, entryName: string): string {
  const model = getModel(uri, 'data.sldd', text);
  const rows = buildRows(model);
  const row = rows.find((r: any) => r.Name?.label === entryName && !String(r.ID).startsWith('section:'));
  if (!row) throw new Error(`no row for entry "${entryName}"`);
  return row.ID;
}

/**
 * Mirror of BinaryEditorProvider.applyEdit's pure text transform: apply the
 * cell edit to the cached model, reserialize just the owning entry, and splice
 * it back into the document text. Returns the new full document text, or an
 * `{ error }` object (shaped like the host's refusal) when setProperty rejects.
 */
function writeBack(
  text: string,
  uri: string,
  rowId: string,
  columnId: string,
  newValue: string,
): string | { error: string } {
  const model = getModel(uri, 'data.sldd', text);
  void model; // ensure the model is cached for findNode
  const node = findNode(uri, rowId);
  let entry = node;
  while (entry && !entry.isEntry) entry = entry.parent;
  const oldName = entry.name;
  const result = node.setProperty(columnId, newValue);
  if (result !== true) return { error: result.reason };
  const indent = detectIndent(text);
  const lines = JSON.stringify(entry.serialize(), null, indent).split('\n');
  const entryText = lines.map((l, i) => (i === 0 ? l : indent.repeat(5) + l)).join('\n');
  const span = findEntrySpan(text, oldName);
  if (!span) throw new Error(`findEntrySpan could not locate "${oldName}"`);
  return text.slice(0, span.offset) + entryText + text.slice(span.offset + span.length);
}

/**
 * Assert the write-back is scoped to a single entry: everything before the
 * edited entry's span is byte-identical, and everything after is byte-identical.
 * `oldName` is the span key used for the lookup (the pre-edit name).
 */
function assertScopedDiff(oldText: string, newText: string, oldName: string, newName: string): void {
  const oldSpan = findEntrySpan(oldText, oldName)!;
  const newSpan = findEntrySpan(newText, newName)!;
  expect(oldSpan).not.toBeNull();
  expect(newSpan).not.toBeNull();
  // The prefix (before the edited entry) is untouched.
  expect(newText.slice(0, newSpan.offset)).toBe(oldText.slice(0, oldSpan.offset));
  // The suffix (after the edited entry) is untouched.
  expect(newText.slice(newSpan.offset + newSpan.length)).toBe(
    oldText.slice(oldSpan.offset + oldSpan.length),
  );
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

describe('.sldd table→text write-back (round-trip)', () => {
  it('value edit round-trips and stays scoped to the one entry', () => {
    // "Number" is a plain scalar entry (value: 1). Edit it to 42.
    const uri = 'test://wb-value.sldd';
    invalidate(uri);
    const id = rowIdFor(uri, fixtureText, 'Number');
    invalidate(uri);

    const out = writeBack(fixtureText, uri, id, 'Value', '42');
    expect(typeof out).toBe('string');
    const newText = out as string;

    // Still valid JSON.
    expect(isValidJson(newText)).toBe(true);

    // Re-parsing shows the new value on that entry.
    invalidate(uri);
    const model = getModel(uri, 'data.sldd', newText);
    const rows = buildRows(model);
    const numberRow = rows.find((r: any) => r.Name?.label === 'Number');
    expect(numberRow.Value).toBe('42');

    // Diff is scoped to the "Number" entry: siblings byte-identical.
    assertScopedDiff(fixtureText, newText, 'Number', 'Number');

    // Sanity: an untouched sibling ("PI") is present unchanged in both texts.
    const piSpan = findEntrySpan(fixtureText, 'PI')!;
    const piSlice = fixtureText.slice(piSpan.offset, piSpan.offset + piSpan.length);
    expect(newText).toContain(piSlice);
  });

  it('rename round-trips: span located by the OLD name, new name applied', () => {
    // Rename "char" → a new unique name.
    const uri = 'test://wb-rename.sldd';
    invalidate(uri);
    const id = rowIdFor(uri, fixtureText, 'char');
    invalidate(uri);

    // The helper looks up the span by the pre-edit name; confirm that lookup
    // succeeds on the original text (this is what write-back relies on).
    expect(findEntrySpan(fixtureText, 'char')).not.toBeNull();

    const out = writeBack(fixtureText, uri, id, 'Name', 'charRenamed');
    expect(typeof out).toBe('string');
    const newText = out as string;

    expect(isValidJson(newText)).toBe(true);
    expect(newText).toContain('"name": "charRenamed"');
    // Old name no longer present as an entry name.
    expect(findEntrySpan(newText, 'char')).toBeNull();
    expect(findEntrySpan(newText, 'charRenamed')).not.toBeNull();

    // The entry now reports the new name after re-parse.
    invalidate(uri);
    const model = getModel(uri, 'data.sldd', newText);
    const rows = buildRows(model);
    expect(rows.some((r: any) => r.Name?.label === 'charRenamed')).toBe(true);
    expect(rows.some((r: any) => r.Name?.label === 'char')).toBe(false);

    // Scoped: everything outside the renamed entry is byte-identical (lookup by
    // old name in old text, new name in new text).
    assertScopedDiff(fixtureText, newText, 'char', 'charRenamed');
  });

  it('rename yields a new node id that matches a row in the rebuilt tree', () => {
    // The rename re-selection relies on: after setProperty('Name'), node.id
    // reflects the new name, and the rebuilt tree contains a row with that exact
    // ID. If these ever diverge, the host would post a selectRow id that no row
    // has and the selection would be lost — the very bug this guards.
    const uri = 'test://wb-reselect.sldd';
    invalidate(uri);
    const model = getModel(uri, 'data.sldd', fixtureText);

    // Record the pre-rename row id, then rename the node in that same model.
    const oldId = buildRows(model).find((r: any) => r.Name?.label === 'char').ID;
    const node = findNode(uri, oldId);
    expect(node.setProperty('Name', 'charRenamed')).toBe(true);

    // The new id is derived from the new name.
    const newId: string = node.id;
    expect(newId.endsWith('charRenamed')).toBe(true);
    expect(newId).not.toBe(oldId);

    // The rebuilt tree (what post() sends after the rename) has a row with the
    // new id — so the host's selectRow(newId) will match and selection survives.
    const rows = buildRows(model);
    expect(rows.some((r: any) => r.ID === newId)).toBe(true);
    expect(rows.some((r: any) => r.ID === oldId)).toBe(false);
  });

  it('rejects an invalid value with no text change', () => {
    // Setting "Number"'s value to a non-numeric string is rejected by the model.
    const uri = 'test://wb-badvalue.sldd';
    invalidate(uri);
    const id = rowIdFor(uri, fixtureText, 'Number');
    invalidate(uri);

    const out = writeBack(fixtureText, uri, id, 'Value', 'not_a_number');
    expect(typeof out).toBe('object');
    expect((out as { error: string }).error).toBeTruthy();
  });

  it('rejects a duplicate name with no text change', () => {
    // Renaming "char" to "string" (an existing sibling) is rejected.
    const uri = 'test://wb-dupname.sldd';
    invalidate(uri);
    const id = rowIdFor(uri, fixtureText, 'char');
    invalidate(uri);

    const out = writeBack(fixtureText, uri, id, 'Name', 'string');
    expect(typeof out).toBe('object');
    expect((out as { error: string }).error).toContain('already exists');
  });

  it('rejects an invalid MATLAB name with no text change', () => {
    // A name that starts with a digit is rejected by validateMatlabName.
    const uri = 'test://wb-badname.sldd';
    invalidate(uri);
    const id = rowIdFor(uri, fixtureText, 'char');
    invalidate(uri);

    const out = writeBack(fixtureText, uri, id, 'Name', '123bad');
    expect(typeof out).toBe('object');
    expect((out as { error: string }).error).toBeTruthy();
  });
});
