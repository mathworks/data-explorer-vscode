// Copyright 2026 The MathWorks, Inc.
//
// PRIMARY coverage for the "Location in Text" context-menu action.
//
// The webview UI (right-click → dex-action `locateInText`) and the VS Code
// `showTextDocument` reveal can't be driven from a unit test. What CAN be tested
// — and is the whole substance of the feature — is the pure resolution the host
// performs before it reveals: row id → model node → owning top-level entry →
// findEntrySpan → the `{...}` byte span that becomes the text-editor selection.
// This suite exercises the genuine modules (SlddModel, findOwningEntry,
// findEntrySpan) exactly as SlddTextEditorProvider.applyLocateInText does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { findEntrySpan } from '../src/host/entrySplice.js';
import { findOwningEntry } from '../src/host/structuralEdit.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
  'utf8',
);

/**
 * Mirror of SlddTextEditorProvider.applyLocateInText's pure resolution: from a
 * clicked row id, resolve the owning entry and its JSON span. Returns the span
 * offset/length (what positionAt turns into the reveal selection), or an
 * `{ error }` object shaped like the host's refusal path.
 */
function locate(text: string, uri: string, rowId: string): { offset: number; length: number } | { error: string } {
  getModel(uri, 'data.sldd', text);
  const node = findNode(uri, rowId);
  if (!node) return { error: 'no node' };
  const entry = findOwningEntry(node);
  if (!entry) return { error: 'no entry' };
  const span = findEntrySpan(text, entry.name);
  if (!span) return { error: 'no span' };
  return span;
}

/** Resolve the row ID for a row by its Name label (entry or nested child). */
function rowIdByName(uri: string, text: string, name: string): string {
  const model = getModel(uri, 'data.sldd', text);
  const row = buildRows(model).find((r: any) => r.Name?.label === name);
  if (!row) throw new Error(`no row for "${name}"`);
  return row.ID;
}

/** Resolve the `section:` row ID for a section by its Name label. */
function sectionRowId(uri: string, text: string, sectionLabel: string): string {
  const model = getModel(uri, 'data.sldd', text);
  const row = buildRows(model).find(
    (r: any) => r.Name?.label === sectionLabel && String(r.ID).startsWith('section:'),
  );
  if (!row) throw new Error(`no section row for "${sectionLabel}"`);
  return row.ID;
}

describe('Location in Text (row → owning entry → JSON span)', () => {
  it('a top-level scalar entry resolves to its own span, pointing at its object', () => {
    const uri = 'test://loc-scalar.sldd';
    invalidate(uri);
    const id = rowIdByName(uri, fixtureText, 'Number');
    invalidate(uri);

    const span = locate(fixtureText, uri, id);
    expect('offset' in span).toBe(true);
    const { offset, length } = span as { offset: number; length: number };

    // The span brackets the entry's `{...}` object, and that object contains the
    // entry's own name — i.e. the reveal lands on the right entry.
    const slice = fixtureText.slice(offset, offset + length);
    expect(slice.startsWith('{')).toBe(true);
    expect(slice.trimEnd().endsWith('}')).toBe(true);
    expect(slice).toContain('"name": "Number"');
  });

  it('a nested child falls back to the span of its owning top-level entry', () => {
    // "NestedStruct" is a struct entry with nested children. Pick a child row
    // (any row whose id is under the entry but is not the entry itself).
    const uri = 'test://loc-nested.sldd';
    invalidate(uri);
    const model = getModel(uri, 'data.sldd', fixtureText);
    const rows = buildRows(model);
    const entryRow = rows.find((r: any) => r.Name?.label === 'NestedStruct');
    expect(entryRow).toBeTruthy();
    // A descendant row: shares the entry id prefix but isn't the entry row.
    const childRow = rows.find(
      (r: any) =>
        String(r.ID).startsWith(entryRow.ID + '/') && r.ID !== entryRow.ID,
    );
    expect(childRow, 'fixture NestedStruct should have a nested child row').toBeTruthy();
    invalidate(uri);

    const childSpan = locate(fixtureText, uri, childRow.ID);
    const entrySpan = findEntrySpan(fixtureText, 'NestedStruct');
    // The child resolves to exactly the owning entry's span — same granularity
    // every other structural op uses.
    expect(childSpan).toEqual(entrySpan);
  });

  it('a section header cannot be located (no owning entry)', () => {
    // Section rows have no owning entry, so the host reports an error rather
    // than revealing anything. (The webview also disables the item for them.)
    const uri = 'test://loc-section.sldd';
    invalidate(uri);
    // The Design Data section holds these fixture entries.
    const id = sectionRowId(uri, fixtureText, 'Design Data');
    invalidate(uri);

    const result = locate(fixtureText, uri, id);
    expect('error' in result).toBe(true);
  });

  it('an unknown row id resolves to no node (error path)', () => {
    const uri = 'test://loc-missing.sldd';
    invalidate(uri);
    getModel(uri, 'data.sldd', fixtureText);
    const result = locate(fixtureText, uri, 'design/DoesNotExist');
    expect(result).toEqual({ error: 'no node' });
  });

  it('every top-level entry row resolves to a valid, non-empty span', () => {
    // Guard the general contract: for any entry the menu offers the action on,
    // the resolution yields a real span (never a silent miss).
    const uri = 'test://loc-all.sldd';
    invalidate(uri);
    const model = getModel(uri, 'data.sldd', fixtureText);
    const entryRows = buildRows(model).filter(
      (r: any) => !String(r.ID).startsWith('section:'),
    );
    expect(entryRows.length).toBeGreaterThan(0);
    for (const row of entryRows) {
      const span = locate(fixtureText, uri, row.ID);
      expect('offset' in span, `row ${row.ID} should resolve to a span`).toBe(true);
      const { offset, length } = span as { offset: number; length: number };
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(length).toBeGreaterThan(0);
      expect(offset + length).toBeLessThanOrEqual(fixtureText.length);
    }
  });
});
