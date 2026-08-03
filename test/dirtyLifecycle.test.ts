// Copyright 2026 The MathWorks, Inc.
//
// PRIMARY coverage for the .sldd dirty-state / per-row "Modified" lifecycle.
//
// The provider (BinaryEditorProvider) is an editable CustomEditorProvider whose
// save/revert reset a per-URI baseline and whose applyEdit closure splices a
// reserialized entry into a working-copy string. That class depends on `vscode`
// and cannot be imported under vitest, so — exactly like editWriteback.test.ts —
// this suite reproduces the pure lifecycle composition using the real modules:
//   SlddModel  (getModelFromBytes / findNode / invalidate)
//   slddBaseline (captureBaseline / computeModified / clearBaseline)
//   rowBuilder  (buildRows with modifiedNames)
//   entrySplice (findEntrySpan / detectIndent)
// and asserts the observable contract the provider relies on: an edit marks
// exactly its entry Modified vs the baseline; save re-baselines to clean; a
// text-level content change is detected the same way; revert restores baseline
// cleanliness; and invalid edits are refused with no text change.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModelFromBytes, findNode, invalidate } from '../src/host/SlddModel.js';
import { captureBaseline, computeModified, clearBaseline } from '../src/host/slddBaseline.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { findEntrySpan, detectIndent } from '../src/host/entrySplice.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
  'utf8',
);

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** Parse `text` fresh under `uri`, invalidating any cached (mutated) model first. */
function parse(uri: string, text: string): any {
  invalidate(uri);
  return getModelFromBytes(uri, 'data.sldd', text ? toArrayBuffer(text) : toArrayBuffer(''));
}

/** Resolve the model row ID for the top-level entry with the given name. */
function rowIdFor(uri: string, text: string, entryName: string): string {
  const model = parse(uri, text);
  const rows = buildRows(model);
  const row = rows.find(
    (r: any) => r.Name?.label === entryName && !String(r.ID).startsWith('section:'),
  );
  if (!row) throw new Error(`no row for entry "${entryName}"`);
  return row.ID;
}

/**
 * Mirror of BinaryEditorProvider.applyEdit's working-copy splice: apply a cell
 * edit to the cached model, reserialize just the owning entry, and splice it
 * back into the document text. Returns the new full document text, or an
 * `{ error }` object (shaped like the host's refusal) when setProperty rejects.
 *
 * Parses fresh under `uri` (invalidating first) — getModelFromBytes caches by
 * uri and setProperty mutates in place, so a stale cached model would bleed.
 */
function editEntry(
  text: string,
  uri: string,
  rowId: string,
  columnId: string,
  newValue: string,
): string | { error: string } {
  parse(uri, text); // ensure a fresh cached model for findNode
  const node = findNode(uri, rowId);
  if (!node) throw new Error(`no node for row "${rowId}"`);
  let entry: any = node;
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

describe('.sldd dirty-state / Modified lifecycle', () => {
  it('1. an edit marks exactly that entry Modified vs the baseline', () => {
    const uri = 'test://life-edit.sldd';
    clearBaseline(uri);
    const id = rowIdFor(uri, fixtureText, 'Number');

    // Capture the on-open baseline from the original content.
    const base = parse(uri, fixtureText);
    captureBaseline(uri, base);
    expect(computeModified(uri, base).size).toBe(0);

    // Edit Number's value 1 -> 42 (working-copy splice).
    const out = editEntry(fixtureText, uri, id, 'Value', '42');
    expect(typeof out).toBe('string');
    const newText = out as string;

    // Re-parse the working copy and diff against the baseline.
    const model = parse(uri, newText);
    const modified = computeModified(uri, model);
    expect(modified).toEqual(new Set(['Number']));
    expect(modified.size).toBe(1);

    // buildRows paints Status=Modified only on the edited entry's row.
    const rows = buildRows(model, modified);
    const numberRow = rows.find((r: any) => r.Name?.label === 'Number');
    expect(numberRow.Status).toBe('Modified');
    const siblingRow = rows.find((r: any) => r.Name?.label === 'PI');
    expect(siblingRow.Status).toBeFalsy();
  });

  it('2. save resets the baseline so no rows are Modified', () => {
    const uri = 'test://life-save.sldd';
    clearBaseline(uri);
    const id = rowIdFor(uri, fixtureText, 'Number');
    captureBaseline(uri, parse(uri, fixtureText));

    const newText = editEntry(fixtureText, uri, id, 'Value', '42') as string;
    expect(typeof newText).toBe('string');
    // Sanity: it IS modified before save.
    expect(computeModified(uri, parse(uri, newText)).size).toBe(1);

    // Simulate saveCustomDocument: re-parse the written text and re-capture.
    const saved = parse(uri, newText);
    captureBaseline(uri, saved);

    const model = parse(uri, newText);
    expect(computeModified(uri, model).size).toBe(0);
    const rows = buildRows(model, computeModified(uri, model));
    expect(rows.some((r: any) => r.Status === 'Modified')).toBe(false);
  });

  it('3. a text-level content change is detected the same way', () => {
    const uri = 'test://life-text.sldd';
    clearBaseline(uri);
    captureBaseline(uri, parse(uri, fixtureText));

    // Simulate a raw JSON text edit: change PI's value in the text directly.
    const editedText = fixtureText.replace(
      '"value": 3.141592653589793',
      '"value": 3.14',
    );
    expect(editedText).not.toBe(fixtureText); // the replacement actually changed the text
    expect(() => JSON.parse(editedText)).not.toThrow();

    const model = parse(uri, editedText);
    const modified = computeModified(uri, model);
    expect(modified.has('PI')).toBe(true);
    expect(modified.size).toBe(1);
  });

  it('4. revert restores baseline cleanliness', () => {
    const uri = 'test://life-revert.sldd';
    clearBaseline(uri);
    const id = rowIdFor(uri, fixtureText, 'Number');
    captureBaseline(uri, parse(uri, fixtureText));

    const newText = editEntry(fixtureText, uri, id, 'Value', '42') as string;
    expect(computeModified(uri, parse(uri, newText)).size).toBe(1);

    // Simulate revertCustomDocument: re-read the ORIGINAL disk content, re-capture.
    const reverted = parse(uri, fixtureText);
    captureBaseline(uri, reverted);
    expect(computeModified(uri, parse(uri, fixtureText)).size).toBe(0);
  });

  it('5. an invalid edit is rejected with no text change', () => {
    const uri = 'test://life-invalid.sldd';
    clearBaseline(uri);

    // Non-numeric value for a numeric entry.
    const idNum = rowIdFor(uri, fixtureText, 'Number');
    const badValue = editEntry(fixtureText, uri, idNum, 'Value', 'not_a_number');
    expect(typeof badValue).toBe('object');
    expect((badValue as { error: string }).error).toBeTruthy();

    // Invalid MATLAB name (starts with a digit).
    const idChar = rowIdFor(uri, fixtureText, 'char');
    const badName = editEntry(fixtureText, uri, idChar, 'Name', '123bad');
    expect(typeof badName).toBe('object');
    expect((badName as { error: string }).error).toBeTruthy();
  });
});
